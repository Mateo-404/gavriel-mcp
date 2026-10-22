import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Dónde y en qué formato registra cada cliente MCP. Lógica pura (rutas y texto); la E/S vive en mcpInstall.ts.
export type Client = "desktop" | "code" | "codex" | "opencode";
export const CLIENTS: readonly Client[] = ["desktop", "code", "codex", "opencode"];
/** Clientes con archivo de configuración editable (Claude Code solo imprime su comando). */
export const FILE_CLIENTS: readonly Client[] = ["desktop", "codex", "opencode"];

export const CLIENT_LABEL: Record<Client, string> = {
  desktop: "Claude Desktop", code: "Claude Code", codex: "Codex", opencode: "OpenCode",
};

export type Entry = { command: string; args: string[]; env: Record<string, string> };

export function configPath(client: Client): string {
  const home = homedir();
  switch (client) {
    case "desktop":
      if (process.env.GAVRIEL_CLAUDE_DESKTOP_CONFIG) return resolve(process.env.GAVRIEL_CLAUDE_DESKTOP_CONFIG);
      if (process.platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      if (process.platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      return join(home, ".config", "Claude", "claude_desktop_config.json");
    case "codex":
      if (process.env.GAVRIEL_CODEX_CONFIG) return resolve(process.env.GAVRIEL_CODEX_CONFIG);
      return join(process.env.CODEX_HOME || join(home, ".codex"), "config.toml");
    case "opencode":
      if (process.env.GAVRIEL_OPENCODE_CONFIG) return resolve(process.env.GAVRIEL_OPENCODE_CONFIG);
      return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "opencode.json");
    default:
      throw new Error(`${client} no tiene archivo de configuración`);
  }
}

/** Interpreta "desktop,codex", "all" o un solo cliente; "all" = los que tienen archivo (no Claude Code). */
export function parseClients(value: string | undefined, def: readonly Client[] = ["desktop"]): Client[] {
  if (value === undefined || value === "") return [...def];
  if (value === "all") return [...FILE_CLIENTS];
  const list = value.split(",").map((s) => s.trim());
  const bad = list.filter((c) => !CLIENTS.includes(c as Client));
  if (bad.length > 0) throw new Error(`Cliente inválido: ${bad.join(", ")}. Válidos: ${CLIENTS.join(", ")}, all`);
  return [...new Set(list)] as Client[];
}

// ── OpenCode (JSON): { mcp: { <name>: { type: "local", command: [...], environment: {...}, enabled: true } } } ──
export const opencodeEntry = (e: Entry): Record<string, unknown> => ({
  type: "local", command: [e.command, ...e.args], environment: e.env, enabled: true,
});

// ── Codex (TOML): [mcp_servers.<name>] command/args + [mcp_servers.<name>.env] ──
const bareKey = (s: string): boolean => /^[A-Za-z0-9_-]+$/.test(s);
const tomlKey = (s: string): string => (bareKey(s) ? s : JSON.stringify(s));
// Cadena literal ('...') sin escapes si se puede (rutas de Windows); si no, básica con escapes JSON (válidos en TOML).
const tomlStr = (s: string): string => (/['\x00-\x1f\x7f]/.test(s) ? JSON.stringify(s) : `'${s}'`);

const HEADER = /^\s*\[\s*([^\]\[]+?)\s*\]\s*(?:#.*)?$/;
const canon = (h: string): string => h.split(".").map((p) => p.trim().replace(/^["']|["']$/g, "")).join(".");

function ownedBy(header: string, name: string): boolean {
  const c = canon(header);
  return c === `mcp_servers.${name}` || c.startsWith(`mcp_servers.${name}.`);
}

export function tomlHas(text: string, name: string): boolean {
  return text.split(/\r?\n/).some((l) => {
    const m = HEADER.exec(l);
    return m ? ownedBy(m[1], name) : false;
  });
}

/** Quita las tablas [mcp_servers.<name>] y [mcp_servers.<name>.*] sin tocar el resto del archivo. */
export function tomlRemove(text: string, name: string): { text: string; removed: boolean } {
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  for (const line of text.split(/\r?\n/)) {
    const m = HEADER.exec(line);
    if (m) skipping = ownedBy(m[1], name);
    else if (/^\s*\[\[/.test(line)) skipping = false;
    if (skipping) { removed = true; continue; }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop(); // sin líneas en blanco de sobra al final
  return { text: out.length ? `${out.join("\n")}\n` : "", removed };
}

export function tomlUpsert(text: string, name: string, e: Entry): string {
  const base = tomlRemove(text, name).text;
  const key = tomlKey(name);
  const lines = [
    `[mcp_servers.${key}]`,
    `command = ${tomlStr(e.command)}`,
    `args = [${e.args.map(tomlStr).join(", ")}]`,
    "",
    `[mcp_servers.${key}.env]`,
    ...Object.entries(e.env).map(([k, v]) => `${tomlKey(k)} = ${tomlStr(v)}`),
  ];
  return `${base}${base ? "\n" : ""}${lines.join("\n")}\n`;
}
