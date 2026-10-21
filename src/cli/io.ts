import { createInterface } from "node:readline/promises";

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question: string): Promise<boolean> {
  return /^(s|si|sí|y|yes)$/i.test(await ask(`${question} [s/N] `));
}

// Entrada sin eco (password, semilla). Sin TTY (pipe) lee una línea normal.
export function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    let buf = "";
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          finish();
          return resolve(buf.trim());
        }
        if (c === "\u0003") {
          finish();
          return reject(new Error("Cancelado"));
        }
        buf = c === "\u007f" || c === "\b" ? buf.slice(0, -1) : buf + c;
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
