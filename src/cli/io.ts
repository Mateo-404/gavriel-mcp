import { createInterface, type Interface } from "node:readline";

// Error de entrada: exitCode 130 si fue Ctrl-C, 1 si se cerró stdin (EOF).
export class InputError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

// Un único lector compartido: con stdin por pipe, un readline por pregunta pierde las líneas ya bufferizadas.
let rl: Interface | undefined;
let ended = false;
const buffered: string[] = [];
const waiters: { resolve: (l: string) => void; reject: (e: Error) => void }[] = [];

function failAll(err: Error): void {
  for (const w of waiters.splice(0)) w.reject(err);
}

function reader(): Interface {
  if (rl) return rl;
  ended = false;
  const r = createInterface({ input: process.stdin, output: process.stderr, terminal: Boolean(process.stdin.isTTY) });
  r.on("line", (l) => {
    const w = waiters.shift();
    if (w) w.resolve(l);
    else buffered.push(l);
  });
  r.on("close", () => {
    ended = true;
    failAll(new InputError("Entrada cerrada", 1));
  });
  r.on("SIGINT", () => failAll(new InputError("Cancelado", 130)));
  rl = r;
  return r;
}

// Cierra el lector (idempotente); se llama al terminar el CLI para que stdin no retenga el proceso.
export function closeInput(): void {
  rl?.removeAllListeners("close");
  rl?.close();
  rl = undefined;
}

export function ask(question: string): Promise<string> {
  const r = reader();
  if (buffered.length > 0) {
    process.stderr.write(question);
    return Promise.resolve((buffered.shift() as string).trim());
  }
  if (ended) return Promise.reject(new InputError("Entrada cerrada", 1));
  return new Promise((resolve, reject) => {
    waiters.push({ resolve: (l) => resolve(l.trim()), reject });
    r.setPrompt(question);
    r.prompt();
  });
}

export async function confirm(question: string): Promise<boolean> {
  return /^(s|si|sí|y|yes)$/i.test(await ask(`${question} [s/N] `));
}

const CR = "\r";
const LF = "\n";
const CTRL_C = "\u0003";
const DEL = "\u007f";
const BS = "\b";

// Entrada sin eco (password, semilla). Sin TTY (pipe) lee del mismo lector compartido (el prompt va a stderr).
export function askHidden(question: string, stdin: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stderr): Promise<string> {
  if (!stdin.isTTY) return ask(question);
  closeInput(); // el modo raw no debe convivir con el eco de readline
  return new Promise((resolve, reject) => {
    output.write(question);
    let buf = "";
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      output.write(LF);
    };
    const onData = (chunk: string): void => {
      if (chunk.startsWith("\u001b")) return; // flechas, Supr, etc.: no editan el texto
      for (const c of chunk) {
        if (c === CR || c === LF) {
          finish();
          return resolve(buf.trim());
        }
        if (c === CTRL_C) {
          finish();
          return reject(new InputError("Cancelado", 130));
        }
        if (c === DEL || c === BS) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            output.write("\b \b");
          }
        } else if (c >= " ") {
          buf += c;
          output.write("*"); // se ve la longitud, nunca el contenido
        }
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

export function rowsOf(data: unknown): Record<string, unknown>[] {
  const d = data as { data?: unknown; items?: unknown; rows?: unknown } | unknown[];
  const arr = Array.isArray(d) ? d : (d?.data ?? d?.items ?? d?.rows);
  return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
}

// Tabla con las primeras columnas escalares cortas del primer registro.
export function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return console.log("(sin resultados)");
  const cols = Object.entries(rows[0])
    .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
    .map(([k]) => k)
    .slice(0, 6);
  const cell = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").slice(0, 40);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]): string => vals.map((v, i) => v.padEnd(width[i])).join("  ");
  console.log(line(cols));
  for (const r of rows) console.log(line(cols.map((c) => cell(r[c]))));
}
