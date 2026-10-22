import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
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

// Valores conocidos (ver gavriel://catalog/tickets/status-options y priority-options).
export const TICKET_STATUSES = ["open", "in_progress", "pending_customer", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const fieldsSchema = z.array(z.string()).optional().describe("Campos a devolver");

export const truncateSchema = z
  .number()
  .int()
  .min(1000)
  .optional()
  .describe("Trunca la respuesta a N chars");

// ── Field selection ──────────────────────────────────────────────────
// Selecciona solo los campos pedidos de un objeto/array. Si fields está
// vacío/undefined, retorna el original. Sobre un envelope {data:[...], meta}
// proyecta cada ítem de data y conserva meta y el resto de las claves.
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
  if (data && Array.isArray((data as Record<string, unknown>).data)) {
    const env = data as Record<string, unknown>;
    return { ...env, data: (env.data as Record<string, unknown>[]).map((i) => pick(i, fields)) } as unknown as T;
  }
  return pick(data, fields) as T;
}

// Id seguro para paths: la API usa uuid/numéricos/slugs. Reusar en toda tool de escritura.
export const idSchema = z.string().regex(/^[\w-]+$/, "ID inválido (solo letras, números, _ y -)");

// Total de un listado: meta.pagination.total (envelope real) > meta.total > total > largo del array.
export function totalOf(d: unknown): number {
  if (Array.isArray(d)) return d.length;
  const o = d as { total?: unknown; data?: unknown; meta?: { total?: unknown; pagination?: { total?: unknown } } } | null;
  for (const t of [o?.meta?.pagination?.total, o?.meta?.total, o?.total]) if (typeof t === "number") return t;
  return Array.isArray(o?.data) ? o.data.length : 0;
}

// Ítems de un listado: array directo o envelope {data:[...]}.
export function itemsOf(d: unknown): Record<string, unknown>[] {
  const l = Array.isArray(d) ? d : (d as { data?: unknown } | null)?.data;
  return Array.isArray(l) ? (l as Record<string, unknown>[]) : [];
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
  opts: { required?: readonly string[]; optional?: readonly string[]; nullable?: readonly string[] },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of opts.required ?? []) body[f] = args[f];
  for (const f of opts.optional ?? []) {
    if (args[f] === undefined) continue;
    // null explícito solo en campos nullable (limpiar la relación); en el resto se omite.
    if (args[f] !== null || opts.nullable?.includes(f)) body[f] = args[f];
  }
  return body;
}

// ── Read-only wrapper ───────────────────────────────────────────────
export function wrapReadOnly<
  T,
>(
  fn: (args: T, ctx: ServerContext) => Promise<CallToolResult>,
): (args: T, ctx: ServerContext) => Promise<CallToolResult> {
  return async (args, ctx) => {
    try {
      return await fn(args, ctx);
    } catch (e) {
      const cause = (e as { cause?: { message?: string } }).cause?.message;
      return err(cause ? `${(e as Error).message} (causa: ${cause})` : (e as Error).message);
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
// structuredContent exige un objeto: arrays se envuelven en {data}, primitivos no llevan.
function toStructured(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return { data: value };
  if (value !== null && typeof value === "object") return value as Record<string, unknown>;
  return undefined;
}

// Compact JSON: saves ~30-40% vs pretty-print. El texto queda completo para
// clientes que ignoran structuredContent.
export function ok(value: unknown): CallToolResult {
  const text = JSON.stringify(value) ?? "null";
  const structuredContent = toStructured(value);
  return { content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) };
}

// Truncated: corta en límites de ítem de array (JSON siempre válido) y avisa.
export function okTruncated(value: unknown, maxChars?: number): CallToolResult {
  const text = JSON.stringify(value) ?? "null";
  if (maxChars === undefined || text.length <= maxChars) return ok(value);
  const note = (kept?: number, total?: number) =>
    kept !== undefined
      ? `Respuesta truncada: se devuelven ${kept} de ${total} ítems. Usá truncate más alto o paginá para el completo.`
      : `Respuesta truncada: ${text.length} chars totales. Usá truncate más alto si necesitás el completo.`;
  // Array de primer nivel, o {data|items|rows: [...]}: se descartan ítems finales.
  const v = value as Record<string, unknown>;
  const key = Array.isArray(value) ? null : (["data", "items", "rows"].find((k) => Array.isArray(v?.[k])) ?? undefined);
  if (Array.isArray(value) || key) {
    const arr = (Array.isArray(value) ? value : v[key as string]) as unknown[];
    const wrap = (n: number) =>
      Array.isArray(value) ? { data: arr.slice(0, n), _truncado: note(n, arr.length) } : { ...v, [key as string]: arr.slice(0, n), _truncado: note(n, arr.length) };
    // Búsqueda binaria del mayor n que entra (al menos 1 ítem).
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (JSON.stringify(wrap(mid)).length <= maxChars) lo = mid; else hi = mid - 1;
    }
    return ok(wrap(Math.max(1, lo)));
  }
  // Fallback no-array: preview como string dentro de un JSON válido.
  return ok({ _truncadoPreview: text.slice(0, maxChars), _truncado: note() });
}

// Structured: igual que ok(); el texto lleva el payload completo (no un stub).
export function okStructured(value: unknown): CallToolResult {
  return ok(value);
}

// Compact error: no pretty-print (saves tokens on error path too).
export function err(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
