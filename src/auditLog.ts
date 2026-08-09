import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

let LOG_DIR = `${process.env.HOME || "."}/.local/share/gavriel-mcp`;
const LOG_FILE = () => join(LOG_DIR, "writes.log");

export function setLogDir(dir: string): void {
  LOG_DIR = dir;
}

export interface AuditEntry {
  timestamp: string;
  tool: string;
  method: string;
  path: string;
  params: unknown;
  userEmail: string | null;
  requestId?: string;
  responseStatus?: number;
  responseBody?: unknown;
  rawBody?: string;
  ok?: boolean;
  error?: string;
}

export function logWrite(
  entry: Omit<AuditEntry, "timestamp"> & { timestamp?: string },
): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    appendFileSync(LOG_FILE(), `${line}\n`, "utf8");
  } catch (err) {
    console.error(`[auditLog] no se pudo escribir ${LOG_FILE()}:`, err);
  }
}

export function writesLogPath(): string {
  return LOG_FILE();
}
