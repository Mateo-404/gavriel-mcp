import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CLIENT_LABEL, FILE_CLIENTS, configPath, opencodeEntry, tomlHas, tomlRemove, tomlUpsert, type Client, type Entry } from "./clients.js";
import { confirm } from "./io.js";
import { binaryServe, runningAsBinary } from "./paths.js";

export interface InstallOpts {
  client: Client;
  name: string;
  profile: string;
  role?: string;
  toolsets?: string;
  dryRun: boolean;
  yes: boolean;
  force?: boolean;
  serverPath?: string;
  /** Comando exacto del servidor (lo usa el instalador; pisa serverPath y la detección). */
  serve?: { command: string; args: string[] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Sin import.meta (el CLI también se empaqueta como CJS/SEA): se parte de argv[1] (dist/cli.js → dist/index.js)
// o del binario hermano gavriel-mcp-<plat>-<arch>. --server-path pisa todo.
// shortcut: si el binario no se llama node se usa "node" del PATH para scripts .js, cuando haya otro runtime, parametrizar.
export function resolveServer(serverPath?: string): { command: string; args: string[] } {
  if (!serverPath && runningAsBinary()) return binaryServe(); // el propio ejecutable: `gavriel mcp serve`
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
export function buildEntry(o: Pick<InstallOpts, "profile" | "role" | "toolsets" | "serve" | "serverPath">): Entry {
  const env: Record<string, string> = { GAVRIEL_PROFILE: o.profile };
  if (o.role) env.GAVRIEL_MCP_ROLE = o.role;
  if (o.toolsets) env.GAVRIEL_MCP_TOOLSETS = o.toolsets;
  return { ...(o.serve ?? resolveServer(o.serverPath)), env };
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
  if (!isObj(v)) return v;
  const mask = (env: unknown): unknown =>
    isObj(env) ? Object.fromEntries(Object.entries(env).map(([k, x]) => [k, /pass|token|secret|key|seed/i.test(k) ? "***" : x])) : env;
  return { ...v, ...(isObj(v.env) && { env: mask(v.env) }), ...(isObj(v.environment) && { environment: mask(v.environment) }) };
}

// Escritura atómica (temp en el mismo directorio + rename) con copia de respaldo del archivo previo.
function writeSafely(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak-${Date.now()}`);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

function readJsonObject(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} no es JSON válido (¿tiene comentarios?); no se modifica. Agregá la entrada a mano.`);
  }
  if (!isObj(parsed)) throw new Error(`${file} no contiene un objeto JSON; no se modifica.`);
  return parsed;
}

const done = (client: Client): string =>
  client === "desktop" ? "Listo. Reiniciá Claude Desktop para cargar el servidor." : `Listo. Reiniciá ${CLIENT_LABEL[client]} para cargar el servidor.`;

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
  const file = configPath(o.client);
  console.log(`Archivo: ${file}\nEntrada "${o.name}" (${CLIENT_LABEL[o.client]}):\n${JSON.stringify(o.client === "opencode" ? opencodeEntry(entry) : entry, null, 2)}`);

  let render: () => string;
  let existing: unknown;
  if (o.client === "codex") {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (tomlHas(text, o.name)) existing = "tabla [mcp_servers." + o.name + "] ya presente en config.toml";
    render = () => tomlUpsert(text, o.name, entry);
  } else {
    const cfg = readJsonObject(file);
    const section = o.client === "opencode" ? "mcp" : "mcpServers";
    if (cfg[section] !== undefined && !isObj(cfg[section])) throw new Error(`"${section}" en ${file} no es un objeto; no se modifica.`);
    const servers = (isObj(cfg[section]) ? cfg[section] : {}) as Record<string, unknown>;
    if (Object.hasOwn(servers, o.name)) existing = maskEntry(servers[o.name]);
    render = () => `${JSON.stringify({ ...cfg, [section]: { ...servers, [o.name]: o.client === "opencode" ? opencodeEntry(entry) : entry } }, null, 2)}\n`;
  }
  if (existing !== undefined) {
    console.log(`Ya existe una entrada "${o.name}":\n${typeof existing === "string" ? existing : JSON.stringify(existing, null, 2)}`);
    if (!o.force) {
      if (o.dryRun) return console.log("(dry-run: sin --force no se reemplazaría)");
      throw new Error(`Ya existe "${o.name}" en la configuración; usá --force para reemplazarla.`);
    }
  }
  if (o.dryRun) return console.log("(dry-run: no se escribió nada)");
  if (!o.yes && !(await confirm(`¿Escribir en la configuración de ${CLIENT_LABEL[o.client]}?`))) throw new Error("Cancelado");
  writeSafely(file, render());
  console.log(done(o.client));
}

export interface UninstallMcpOpts {
  name: string;
  dryRun: boolean;
  yes: boolean;
  /** Clientes a limpiar; por defecto todos los que tienen archivo. */
  clients?: readonly Client[];
}

/** Quita la entrada del MCP de los clientes con archivo (con backup y escritura atómica). Devuelve cuántos cambió. */
export async function mcpUninstall(o: UninstallMcpOpts): Promise<number> {
  let changed = 0;
  for (const client of o.clients ?? FILE_CLIENTS) {
    if (client === "code") continue;
    const file = configPath(client);
    const label = CLIENT_LABEL[client];
    if (!existsSync(file)) { console.log(`${label}: no hay configuración en ${file}`); continue; }
    let next: string | undefined;
    if (client === "codex") {
      const r = tomlRemove(readFileSync(file, "utf8"), o.name);
      if (r.removed) next = r.text;
    } else {
      const cfg = readJsonObject(file);
      const section = client === "opencode" ? "mcp" : "mcpServers";
      const servers = cfg[section];
      if (isObj(servers) && Object.hasOwn(servers, o.name)) {
        const { [o.name]: _removed, ...rest } = servers;
        next = `${JSON.stringify({ ...cfg, [section]: rest }, null, 2)}\n`;
      }
    }
    if (next === undefined) { console.log(`${label}: no hay una entrada "${o.name}".`); continue; }
    if (o.dryRun) { console.log(`(dry-run: quitaría "${o.name}" de ${file})`); changed++; continue; }
    if (!o.yes && !(await confirm(`¿Quitar "${o.name}" de la configuración de ${label}?`))) throw new Error("Cancelado");
    writeSafely(file, next);
    console.log(`${label}: entrada "${o.name}" quitada. Reiniciá ${label}.`);
    changed++;
  }
  return changed;
}
