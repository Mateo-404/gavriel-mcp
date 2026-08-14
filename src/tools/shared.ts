import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export function capLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

export const paginationSchema = {
  page: z.number().int().min(1).default(1).describe("Número de página (1-based)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Cantidad por página (default ${DEFAULT_LIMIT}, máximo ${MAX_LIMIT})`),
};

// JSON compacto (sin indentación): ahorra ~30-40% de tokens vs pretty-print.
// Los logs (writes.log/perf.log) usan su propio formato legible.
export function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

// Variante con tope de chars: si el JSON excede maxChars, corta y avisa.
// Ideal para listados grandes (default limit 25 ya es mucho texto).
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
          "Llamá de nuevo con truncate=false si necesitás el JSON completo.",
      },
    ],
  };
}

// Respuesta estructurada para tools con outputSchema: el dato completo va en
// structuredContent (tipado para el cliente), y el texto lleva un resumen
// breve para no duplicar el payload (2x tokens) ni esconder los datos.
export function okStructured(value: unknown): CallToolResult {
  const v = value as Record<string, unknown>;
  const data = Array.isArray(value) ? value : v?.data ? (v.data as unknown) : undefined;
  const count = Array.isArray(data) ? data.length : undefined;
  const text = JSON.stringify({
    _resumen: true,
    ...(count !== undefined ? { count } : {}),
    nota: "Datos completos en structuredContent (JSON estructurado).",
  });
  return {
    content: [{ type: "text", text }],
    structuredContent: v,
  };
}

export function err(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
  };
}
