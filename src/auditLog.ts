import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

let LOG_DIR = `${process.env.HOME || "."}/.local/share/gavriel-mcp`;
const LOG_FILE = () => join(LOG_DIR, "writes.log");
const PERF_FILE = () => join(LOG_DIR, "perf.log");

let logDirReady = false;

export function setLogDir(dir: string): void {
  LOG_DIR = dir;
  try { mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
  logDirReady = true;
}

function ensureLogDir(): void {
  if (logDirReady) return;
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* already exists */ }
  logDirReady = true;
}

// Ledger de rendimiento (MEASURE): mide la latencia real por endpoint para
// decidir optimizaciones con datos, no por intuición. Ver PERF.md.
export function logPerf(entry: {
  method: string;
  path: string;
  status?: number;
  ms: number;
}): void {
  try {
    ensureLogDir();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    appendFileSync(PERF_FILE(), `${line}\n`, "utf8");
  } catch (err) {
    console.error(`[auditLog] no se pudo escribir ${PERF_FILE()}:`, err);
  }
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
    ensureLogDir();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    appendFileSync(LOG_FILE(), `${line}\n`, "utf8");
  } catch (err) {
    console.error(`[auditLog] no se pudo escribir ${LOG_FILE()}:`, err);
  }
}

export function writesLogPath(): string {
  return LOG_FILE();
}
