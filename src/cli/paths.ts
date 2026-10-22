import { isSea } from "node:sea";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** true si corre como ejecutable único (SEA); en desarrollo (node dist/cli.js) es false. */
export const runningAsBinary = (): boolean => {
  try {
    return isSea();
  } catch {
    return false;
  }
};

export const exeName = (): string => (process.platform === "win32" ? "gavriel.exe" : "gavriel");

/** Windows: %LOCALAPPDATA%\Programs\Gavriel (sin admin). Linux/macOS: ~/.local/bin. Override: GAVRIEL_INSTALL_DIR. */
export function defaultInstallDir(): string {
  if (process.env.GAVRIEL_INSTALL_DIR) return process.env.GAVRIEL_INSTALL_DIR;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Gavriel");
  return join(homedir(), ".local", "bin");
}

/** Comando que lanza el servidor MCP desde el binario: el instalado si existe; si no, el ejecutable actual. */
export function binaryServe(): { command: string; args: string[] } {
  const installed = join(defaultInstallDir(), exeName());
  return { command: existsSync(installed) ? installed : process.execPath, args: ["mcp", "serve"] };
}

// ── PATH (lógica pura; la escritura al registro vive en install.ts) ─────────
const sep = (): string => (process.platform === "win32" ? ";" : ":");
const norm = (p: string): string => {
  const t = p.trim().replace(/[\\/]+$/, "");
  return process.platform === "win32" ? t.toLowerCase() : t;
};
const parts = (value: string): string[] => value.split(sep()).filter((s) => s.length > 0);

export const pathHas = (value: string, dir: string): boolean => parts(value).some((p) => norm(p) === norm(dir));
export function pathAdd(value: string, dir: string): string {
  return pathHas(value, dir) ? value : [...parts(value), dir].join(sep());
}
export function pathRemove(value: string, dir: string): string {
  return parts(value).filter((p) => norm(p) !== norm(dir)).join(sep());
}
