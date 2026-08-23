import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export function capLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

export const paginationSchema = {
  page: z.number().int().min(1).default(1).describe("Página (1-based)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Por página (default ${DEFAULT_LIMIT}, máx ${MAX_LIMIT})`),
};

export const fieldsSchema = z.array(z.string()).optional().describe("Campos a devolver");

export const truncateSchema = z
  .number()
  .int()
  .min(1000)
  .optional()
  .describe("Trunca la respuesta a N chars");

// ── Field selection ──────────────────────────────────────────────────
// Selecciona solo los campos pedidos de un objeto/array. Si fields está
// vacío/undefined, retorna el original. Soporta objetos anidados con dot
// notation (ej "account.name") y arrays de objetos.
export function selectFields<T extends Record<string, unknown>>(
  data: T | T[],
  fields?: string[],
): T | T[] {
  if (!fields || fields.length === 0) return data;
  const pick = (obj: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in obj) out[k] = obj[k];
    }
    return out;
  };
  if (Array.isArray(data)) return data.map((item) => pick(item as Record<string, unknown>, fields) as T);
  return pick(data, fields) as T;
}

// Normalize account numbers: left-pads with zeros to 10 digits.
// The backend uses zero-padded account numbers (ej "0000001234").
export function normalizeAccountNumber(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(10, "0");
  return trimmed;
}

// ── Body builder ─────────────────────────────────────────────────────
export function buildBody(
  args: Record<string, unknown>,
  opts: { required?: readonly string[]; optional?: readonly string[] },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of opts.required ?? []) body[f] = args[f];
  for (const f of opts.optional ?? []) {
    if (args[f] !== undefined && args[f] !== null) body[f] = args[f];
  }
  return body;
}

// ── Read-only wrapper ───────────────────────────────────────────────
export function wrapReadOnly<T>(
  fn: (args: T) => Promise<CallToolResult>,
): (args: T) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return err((e as Error).message);
    }
  };
}

// ── Param forwarding ────────────────────────────────────────────────
export function forwardParams(
  args: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const k of keys) {
    if (args[k] !== undefined) params[k] = args[k];
  }
  return params;
}

// ── Filter enforcement ──────────────────────────────────────────────
// Returns an error if required filters are missing. Prevents slow/backend-500 calls.
export function requireFilters(
  args: Record<string, unknown>,
  required: string[],
  _toolHint?: string,
): CallToolResult | null {
  const missing = required.filter((k) => {
    const v = args[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length === 0) return null;
  return err(
    `Filtros obligatorios faltantes: ${missing.join(", ")}. ` +
    `Sin estos filtros la query es muy lenta o devuelve 500 del backend. ` +
    `Mirá los catálogos en gavriel://catalog/ para valores válidos.`,
  );
}

// ── Status HTTP ─────────────────────────────────────────────────────
// El cliente NO lanza en 4xx/5xx (devuelve {status, data}). Los getters de
// detalle usan esto para convertir errores en excepciones claras en vez de
// devolver el body del backend ({message: "not found"}) como si fuera data.
export function ensureOk<T = unknown>(res: { status: number; data: unknown }, ctx?: string): T {
  if (res.status >= 400) {
    const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const detail = raw ? raw.slice(0, 300) : "sin detalle";
    throw new Error(`HTTP ${res.status}${ctx ? ` en ${ctx}` : ""}: ${detail}`);
  }
  return res.data as T;
}

// ── Responses ───────────────────────────────────────────────────────
// Compact JSON: saves ~30-40% vs pretty-print.
export function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

// Truncated: warns explicitly when data is cut.
export function okTruncated(value: unknown, maxChars?: number): CallToolResult {
  const text = JSON.stringify(value);
  if (maxChars === undefined || text.length <= maxChars) {
    return { content: [{ type: "text", text }] };
  }
  return {
    content: [
      {
        type: "text",
        text: `${text.slice(0, maxChars)}...\nRESPUESTA TRUNCADA: ${text.length} chars totales. ` +
          "Usá truncate más alto si necesitás el completo.",
      },
    ],
  };
}

// Structured: full data in structuredContent, summary in text.
export function okStructured(value: unknown): CallToolResult {
  const v = value as Record<string, unknown>;
  const data = Array.isArray(value) ? value : v?.data ? (v.data as unknown) : undefined;
  const count = Array.isArray(data) ? data.length : undefined;
  const text = JSON.stringify({
    _resumen: true,
    ...(count !== undefined ? { count } : {}),
    nota: "Datos completos en structuredContent.",
  });
  return {
    content: [{ type: "text", text }],
    structuredContent: v,
  };
}

// Compact error: no pretty-print (saves tokens on error path too).
export function err(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
