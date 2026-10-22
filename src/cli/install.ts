import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { confirm } from "./io.js";
import type { Client } from "./clients.js";
import { mcpInstall, mcpUninstall } from "./mcpInstall.js";
import { defaultInstallDir, exeName, pathAdd, pathHas, pathRemove, runningAsBinary } from "./paths.js";
import * as ui from "./ui.js";

export interface InstallOpts {
  dir?: string;
  path: boolean; // agregar la carpeta al PATH del usuario
  register: readonly Client[]; // clientes MCP donde registrar (vacío = ninguno)
  profile?: string;
  role?: string;
  toolsets?: string;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
}

const log = (kind: "ok" | "info" | "warn" | "fail", msg: string): void => console.log(ui.line(kind, msg, process.stdout));

// ── PATH de usuario en Windows ─────────────────────────────────────────────
// Se lee/escribe el valor CRUDO del registro (HKCU\Environment\Path) como REG_EXPAND_SZ: SetEnvironmentVariable
// expandiría los %VARS% y los dejaría fijos. Después se avisa a las ventanas abiertas (WM_SETTINGCHANGE).
const PS = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
const PS_BASE = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
const PS_GET =
  "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$false);" +
  "[Console]::Out.Write([string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames))";
const PS_SET =
  "$v=[Console]::In.ReadToEnd();" +
  "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true);" +
  "$k.SetValue('Path',$v,[Microsoft.Win32.RegistryValueKind]::ExpandString);" +
  "Add-Type -Namespace GavrielWin -Name Native -MemberDefinition '[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);';" +
  "$r=[UIntPtr]::Zero;[GavrielWin.Native]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r)|Out-Null";

export function readUserPath(): string | null {
  const r = spawnSync(PS, [...PS_BASE, PS_GET], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  return r.status === 0 ? r.stdout : null;
}
export function writeUserPath(value: string): boolean {
  const r = spawnSync(PS, [...PS_BASE, PS_SET], { input: value, encoding: "utf8", windowsHide: true, timeout: 15000 });
  return r.status === 0;
}

/** Agrega/quita `dir` del PATH del usuario. Devuelve true si cambió algo. Solo Windows; en Unix informa. */
function updatePath(dir: string, mode: "add" | "remove", dryRun: boolean): boolean {
  if (process.platform !== "win32") {
    const inPath = pathHas(process.env.PATH ?? "", dir);
    if (mode === "add" && !inPath) log("warn", `${dir} no está en tu PATH. Agregá a tu shell: export PATH="${dir}:$PATH"`);
    return false;
  }
  const current = readUserPath();
  if (current === null) {
    log("warn", "No se pudo leer el PATH del usuario; agregá la carpeta a mano.");
    return false;
  }
  const next = mode === "add" ? pathAdd(current, dir) : pathRemove(current, dir);
  if (next === current) return false;
  if (dryRun) return true;
  if (!writeUserPath(next)) {
    log("warn", "No se pudo actualizar el PATH del usuario.");
    return false;
  }
  return true;
}

// ── Instalación ────────────────────────────────────────────────────────────
function copyExecutable(src: string, dest: string): "copied" | "same" {
  if (existsSync(dest) && resolve(dest).toLowerCase() === resolve(src).toLowerCase()) return "same";
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${process.pid}`;
  copyFileSync(src, tmp);
  chmodSync(tmp, 0o755);
  try {
    renameSync(tmp, dest);
  } catch {
    // Windows: no se puede pisar un .exe en uso, pero sí renombrarlo; se limpia en la próxima instalación.
    rmSync(`${dest}.old`, { force: true });
    renameSync(dest, `${dest}.old`);
    renameSync(tmp, dest);
    try { rmSync(`${dest}.old`); } catch { /* sigue en uso: se limpia después */ }
  }
  return "copied";
}

export async function install(o: InstallOpts): Promise<void> {
  if (!runningAsBinary()) {
    throw new Error("`gavriel install` se ejecuta desde el binario (gavriel.exe). Desde el código fuente: pnpm run install:cli");
  }
  const dir = resolve(o.dir ?? defaultInstallDir());
  const dest = join(dir, exeName());
  if (!o.yes && !o.dryRun) {
    if (!process.stdin.isTTY) throw new Error("Instalación sin terminal interactiva: agregá --yes para confirmar.");
    if (!(await confirm(`¿Instalar gavriel en ${dir}?`))) throw new Error("Cancelado");
  }
  const steps: string[] = [];
  rmSync(`${dest}.old`, { force: true });
  if (o.dryRun) steps.push(`copiaría ${process.execPath} → ${dest}`);
  else steps.push(copyExecutable(process.execPath, dest) === "same" ? `ya estaba instalado en ${dest}` : `instalado en ${dest}`);
  for (const s of steps) log(o.dryRun ? "info" : "ok", s);

  if (o.path) {
    const changed = updatePath(dir, "add", o.dryRun);
    log(changed ? (o.dryRun ? "info" : "ok") : "info", changed ? `${o.dryRun ? "agregaría" : "agregado"} ${dir} al PATH del usuario (abrí una terminal nueva)` : `${dir} ya está en el PATH`);
  }

  if (!o.dryRun) {
    const v = spawnSync(dest, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    if (v.status !== 0) throw new Error(`El ejecutable instalado no responde: ${(v.stderr || v.error?.message || "").trim()}`);
    log("ok", `verificado: ${v.stdout.trim()}`);
  }

  if (o.register.length > 0) {
    const { loadStore } = await import("../profiles.js");
    const store = loadStore();
    const profile = o.profile ?? store.active ?? undefined;
    if (!profile || !Object.hasOwn(store.profiles, profile)) {
      log("warn", "Todavía no hay una cuenta: ejecutá `gavriel login` y después `gavriel mcp install` para registrar el MCP en Claude.");
    } else {
      for (const client of o.register) {
        await mcpInstall({
          client, name: "gavriel", profile, role: o.role ?? store.profiles[profile].role, toolsets: o.toolsets ?? store.profiles[profile].toolsets,
          dryRun: o.dryRun, yes: true, force: o.force, serve: { command: dest, args: ["mcp", "serve"] },
        }).catch((e) => log("warn", `${client}: ${(e as Error).message}`));
      }
    }
  }
  if (!o.dryRun) log("info", "Siguiente paso: abrí una terminal nueva y ejecutá `gavriel` (o `gavriel login`).");
}

export interface UninstallOpts { dir?: string; unregister: boolean; purge: boolean; dryRun: boolean; yes: boolean }

export async function uninstall(o: UninstallOpts): Promise<void> {
  const dir = resolve(o.dir ?? defaultInstallDir());
  const dest = join(dir, exeName());
  if (!o.yes && !o.dryRun) {
    if (!process.stdin.isTTY) throw new Error("Desinstalación sin terminal interactiva: agregá --yes para confirmar.");
    if (!(await confirm(`¿Desinstalar gavriel de ${dir}${o.purge ? " y borrar cuentas y secretos" : ""}?`))) throw new Error("Cancelado");
  }
  if (o.unregister) await mcpUninstall({ name: "gavriel", dryRun: o.dryRun, yes: true }).catch((e) => log("warn", `Claude Desktop: ${(e as Error).message}`));
  if (o.purge) {
    const { loadStore, saveStore, configDir } = await import("../profiles.js");
    const { clearPassword, clearTotpSeed, clearTrustedToken } = await import("../secrets.js");
    const store = loadStore();
    for (const p of Object.values(store.profiles)) {
      if (o.dryRun) continue;
      clearTrustedToken(p.email, true);
      clearPassword(p.email);
      clearTotpSeed(p.email);
    }
    if (!o.dryRun) {
      saveStore({ active: null, profiles: Object.create(null) });
      rmSync(configDir(), { recursive: true, force: true });
    }
    log(o.dryRun ? "info" : "ok", `${o.dryRun ? "borraría" : "borradas"} ${Object.keys(store.profiles).length} cuenta(s) y sus secretos`);
  }
  if (updatePath(dir, "remove", o.dryRun)) log(o.dryRun ? "info" : "ok", `${o.dryRun ? "quitaría" : "quitado"} ${dir} del PATH del usuario`);
  if (!o.dryRun) { try { rmSync(`${dest}.old`, { force: true }); } catch { /* en uso */ } }
  if (existsSync(dest)) {
    if (o.dryRun) log("info", `borraría ${dest}`);
    else {
      try {
        rmSync(dest);
        log("ok", `borrado ${dest}`);
      } catch {
        // Windows: el exe en ejecución no se puede borrar pero sí renombrar; queda un .old inofensivo.
        rmSync(`${dest}.old`, { force: true });
        renameSync(dest, `${dest}.old`);
        log("ok", `retirado ${dest} (queda ${exeName()}.old; se borra solo en la próxima instalación o a mano)`);
      }
    }
  } else log("info", `${dest} no existe`);
  if (!o.dryRun && existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
}
