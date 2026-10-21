import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confirm } from "./io.js";

export interface InstallOpts {
  client: "desktop" | "code";
  name: string;
  profile: string;
  role?: string;
  toolsets?: string;
  dryRun: boolean;
  yes: boolean;
}

function desktopConfigPath(): string {
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

// El server MCP es dist/index.js (hermano de dist/cli.js). Nunca se escriben secretos: solo el nombre del perfil.
export function buildEntry(o: InstallOpts): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { GAVRIEL_PROFILE: o.profile };
  if (o.role) env.GAVRIEL_MCP_ROLE = o.role;
  if (o.toolsets) env.GAVRIEL_MCP_TOOLSETS = o.toolsets;
  return { command: process.execPath, args: [resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.js")], env };
}

export async function mcpInstall(o: InstallOpts): Promise<void> {
  const entry = buildEntry(o);
  if (o.client === "code") {
    const envArgs = Object.entries(entry.env).map(([k, v]) => `-e ${k}=${v}`).join(" ");
    console.log(`claude mcp add ${o.name} ${envArgs} -- "${entry.command}" "${entry.args[0]}"`);
    return;
  }
  const file = desktopConfigPath();
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`${file} no es JSON válido; no se modifica.`);
    }
  }
  const next = { ...cfg, mcpServers: { ...cfg.mcpServers, [o.name]: entry } };
  console.log(`Archivo: ${file}\nEntrada "${o.name}":\n${JSON.stringify(entry, null, 2)}`);
  if (o.dryRun) return console.log("(dry-run: no se escribió nada)");
  if (!o.yes && !(await confirm("¿Escribir en la configuración de Claude Desktop?"))) throw new Error("Cancelado");
  if (existsSync(file)) copyFileSync(file, `${file}.bak-${Date.now()}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  console.log("Listo. Reiniciá Claude Desktop para cargar el servidor.");
}
