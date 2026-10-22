import { mkdirSync, appendFileSync, statSync, renameSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

let LOG_DIR = join(homedir(), ".local", "share", "gavriel-mcp");
const LOG_FILE = () => join(LOG_DIR, "writes.log");
const PERF_FILE = () => join(LOG_DIR, "perf.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logDirReady = false;

export function setLogDir(dir: string): void {
  LOG_DIR = dir;
  try { mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
  logDirReady = true;
}

function ensureLogDir(): void {
  if (logDirReady) return;
  setLogDir(LOG_DIR);
}

// ── Redacción ───────────────────────────────────────────────────────
// Se compara por palabras (camelCase/snake partidos) para no tapar campos de negocio como
// el `code` de un evento, statusCode, zipCode o author*; solo claves tipo credencial.
const SENSITIVE_SUBSTR = /password|passwd|token|secret|authorization|cookie|apikey|bearer|credential|twofactor|twofa|verificationcode|cloudliveviewverification|totp/;
const SENSITIVE_WORDS = new Set(["pass", "pwd", "jwt", "otp", "seed", "2fa", "pin"]);
const SENSITIVE_KEY = {
  test(k: string): boolean {
    if (k === "clearCloudLiveViewSecret") return false; // flag booleano, no el secreto
    const words = k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/);
    return SENSITIVE_SUBSTR.test(words.join("")) || words.some((w) => SENSITIVE_WORDS.has(w));
  },
};

/** Copia recursiva con los valores de claves sensibles reemplazados por [REDACTED]. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[DEPTH]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacción por regex de texto no-JSON (cuerpos truncados, form-encoded, headers). */
export function redactText(raw: string): string {
  return raw
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(\b[\w-]*(?:pass(?:word|wd)?|pwd|token|secret|jwt|otp|totp|api[_-]?key|authorization|cookie|credential)[\w-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi,
      "$1[REDACTED]",
    );
}

/** rawBody es un string (posible JSON): se redacta si parsea, si no por regex y luego se trunca. */
function redactRaw(raw: string): string {
  try {
    return JSON.stringify(redact(JSON.parse(raw)));
  } catch {
    // Primero redactar, después truncar: cortar antes podría dejar un valor sensible sin su clave.
    const t = redactText(raw);
    return t.length > 500 ? `${t.slice(0, 500)}…[truncated ${raw.length}]` : t;
  }
}

// ── Escritura no bloqueante con rotación por tamaño ─────────────────
const pending = new Map<string, string[]>();
let flushing: Promise<void> | null = null;
// Líneas que se están escribiendo ahora: si el proceso sale a mitad, el handler de exit las completa.
const inflight = new Map<string, string>();

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
  } catch { /* no existe todavía */ }
}

function enqueue(file: string, line: string): void {
  const q = pending.get(file) ?? [];
  q.push(line);
  pending.set(file, q);
  flushing ??= Promise.resolve().then(flush);
}

async function flush(): Promise<void> {
  try {
    for (const [file, lines] of [...pending]) {
      pending.delete(file);
      rotateIfNeeded(file);
      const chunk = lines.join("");
      inflight.set(file, chunk);
      await appendFile(file, chunk, "utf8").catch((e: Error) =>
        console.error(`[auditLog] no se pudo escribir ${file}: ${e.message}`),
      );
      inflight.delete(file);
    }
  } finally {
    flushing = null;
    if (pending.size) flushing = Promise.resolve().then(flush);
  }
}

/** Espera a que se vuelque la cola (tests / shutdown ordenado). */
export async function flushLogs(): Promise<void> {
  while (flushing) await flushing;
}

// Al salir se vuelca lo que quede en cola (síncrono: el loop ya no corre).
// shortcut: si el append en vuelo ya escribió parte, puede duplicar esas líneas (mejor que perderlas).
process.on("exit", () => {
  for (const [file, chunk] of inflight) {
    try { appendFileSync(file, chunk, "utf8"); } catch { /* best effort */ }
  }
  for (const [file, lines] of pending) {
    try { appendFileSync(file, lines.join(""), "utf8"); } catch { /* best effort */ }
  }
});

function write(file: string, entry: Record<string, unknown>): void {
  try {
    ensureLogDir();
    const safe = redact({ timestamp: new Date().toISOString(), ...entry }) as Record<string, unknown>;
    if (typeof entry.rawBody === "string") safe.rawBody = redactRaw(entry.rawBody);
    enqueue(file, `${JSON.stringify(safe)}
`);
  } catch (err) {
    console.error(`[auditLog] no se pudo escribir ${file}: ${(err as Error).message}`);
  }
}

// Ledger de rendimiento (MEASURE): mide la latencia real por endpoint para
// decidir optimizaciones con datos, no por intuición. Ver PERF.md.
export function logPerf(entry: {
  method: string;
  path: string;
  status?: number;
  ms: number;
}): void {
  write(PERF_FILE(), entry);
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
  write(LOG_FILE(), entry);
}
