import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { confirm } from "./io.js";

export interface InstallOpts {
  client: "desktop" | "code";
  name: string;
  profile: string;
  role?: string;
  toolsets?: string;
  dryRun: boolean;
  yes: boolean;
  force?: boolean;
  serverPath?: string;
}

type Entry = { command: string; args: string[]; env: Record<string, string> };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function desktopConfigPath(): string {
  if (process.env.GAVRIEL_CLAUDE_DESKTOP_CONFIG) return resolve(process.env.GAVRIEL_CLAUDE_DESKTOP_CONFIG);
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

// Sin import.meta (el CLI también se empaqueta como CJS/SEA): se parte de argv[1] (dist/cli.js → dist/index.js)
// o del binario hermano gavriel-mcp-<plat>-<arch>. --server-path pisa todo.
// shortcut: si el binario no se llama node se usa "node" del PATH para scripts .js, cuando haya otro runtime, parametrizar.
export function resolveServer(serverPath?: string): { command: string; args: string[] } {
  const isNode = /^node(\.exe)?$/i.test(basename(process.execPath));
  const forFile = (file: string): { command: string; args: string[] } =>
    /\.[cm]?js$/.test(file) ? { command: isNode ? process.execPath : "node", args: [file] } : { command: file, args: [] };
  if (serverPath) {
    const abs = resolve(serverPath);
    if (!existsSync(abs)) throw new Error(`--server-path no existe: ${abs}`);
    return forFile(abs);
  }
  const candidates: string[] = [];
  try {
    if (process.argv[1]) candidates.push(join(dirname(realpathSync(process.argv[1])), "index.js"));
  } catch {
    // argv[1] inexistente: seguir con el binario hermano
  }
  const exe = `gavriel-mcp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  candidates.push(join(dirname(process.execPath), exe));
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`No se encontró el servidor MCP (probé: ${candidates.join(", ")}). Usá --server-path <ruta>.`);
  return forFile(found);
}

// Nunca se escriben secretos: solo el nombre del perfil.
export function buildEntry(o: InstallOpts): Entry {
  const env: Record<string, string> = { GAVRIEL_PROFILE: o.profile };
  if (o.role) env.GAVRIEL_MCP_ROLE = o.role;
  if (o.toolsets) env.GAVRIEL_MCP_TOOLSETS = o.toolsets;
  return { ...resolveServer(o.serverPath), env };
}

const quotePosix = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const quotePs = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const quoteCmd = (s: string): string => `"${s.replace(/"/g, '""')}"`;

export function claudeCodeArgv(name: string, entry: Entry): string[] {
  const env = Object.entries(entry.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return ["claude", "mcp", "add", name, ...env, "--", entry.command, ...entry.args];
}

// Muestra la entrada sin valores sensibles (otra instalación pudo guardar secretos en env).
function maskEntry(v: unknown): unknown {
  if (!isObj(v) || !isObj(v.env)) return v;
  const env = Object.fromEntries(Object.entries(v.env).map(([k, x]) => [k, /pass|token|secret|key|seed/i.test(k) ? "***" : x]));
  return { ...v, env };
}

export async function mcpInstall(o: InstallOpts): Promise<void> {
  const entry = buildEntry(o);
  if (o.client === "code") {
    const argv = claudeCodeArgv(o.name, entry);
    if (process.platform === "win32") {
      console.log(`PowerShell:\n  ${argv.map(quotePs).join(" ")}\ncmd:\n  ${argv.map(quoteCmd).join(" ")}`);
    } else {
      console.log(`Shell:\n  ${argv.map(quotePosix).join(" ")}`);
    }
    console.log(`Argumentos (JSON):\n${JSON.stringify(argv)}`);
    return;
  }
  const file = desktopConfigPath();
  let cfg: Record<string, unknown> = {};
  if (existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`${file} no es JSON válido; no se modifica.`);
    }
    if (!isObj(parsed)) throw new Error(`${file} no contiene un objeto JSON; no se modifica.`);
    if (parsed.mcpServers !== undefined && !isObj(parsed.mcpServers)) throw new Error(`"mcpServers" en ${file} no es un objeto; no se modifica.`);
    cfg = parsed;
  }
  const servers = (isObj(cfg.mcpServers) ? cfg.mcpServers : {}) as Record<string, unknown>;
  console.log(`Archivo: ${file}\nEntrada "${o.name}":\n${JSON.stringify(entry, null, 2)}`);
  if (Object.hasOwn(servers, o.name)) {
    console.log(`Ya existe una entrada "${o.name}":\n${JSON.stringify(maskEntry(servers[o.name]), null, 2)}`);
    if (!o.force) {
      if (o.dryRun) return console.log("(dry-run: sin --force no se reemplazaría)");
      throw new Error(`Ya existe "${o.name}" en la configuración; usá --force para reemplazarla.`);
    }
  }
  if (o.dryRun) return console.log("(dry-run: no se escribió nada)");
  if (!o.yes && !(await confirm("¿Escribir en la configuración de Claude Desktop?"))) throw new Error("Cancelado");
  const next = { ...cfg, mcpServers: { ...servers, [o.name]: entry } };
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak-${Date.now()}`);
  // Escritura atómica: temp en el mismo directorio + rename, para no dejar el JSON a medias.
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  console.log("Listo. Reiniciá Claude Desktop para cargar el servidor.");
}
