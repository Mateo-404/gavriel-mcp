import type { GavrielClient } from "../gavrielClient.js";
import { err, okTruncated, ensureOk } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Role } from "./roles.js";

// Exportado para poder recorrerlo desde tests (ver isAllowed más abajo).
export const READ_PREFIXES = [
  "/account-contacts",
  "/account-users",
  "/accounts",
  "/events-types",
  "/events-codes",
  "/events-formats",
  "/events-chart",
  "/events",
  "/interventions/account",
  "/interventions",
  "/tickets",
  "/ticket-categories",
  "/activities",
  "/me/conversations",
  "/conversations",
  "/audit/logs",
  "/auth/me",
  "/auth/profile",
  "/bridges",
  "/connections",
  "/users",
  "/companies",
  "/services",
  "/services/panel",
  "/technician-agenda",
  "/technician-locations",
  "/technician-slot-configs",
  "/roles",
  "/protocols",
  "/intervention-categories",
  "/device-brands",
  "/device-models",
  "/device-connection-types",
  "/device-taxonomies",
  "/device-kinds",
  "/orders",
  "/orders-products",
  "/orderstates",
  "/posts",
  "/products",
  "/states",
  "/cities",
  "/jurisdictions",
  "/zones",
  "/monitoring",
  "/useful-contacts",
  "/files",
  "/files/stats",
  "/partitions",
  "/devices",
] as const;

// Devuelve el path normalizado o null si es sospechoso (traversal, encoding,
// query/fragment embebidos, caracteres de control, backslash).
export function normalizePath(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (!raw.startsWith("/") || /\.\.|[%?#\\\x00-\x1f]/.test(raw)) return null;
  const p = raw.replace(/\/+/g, "/").replace(/\/$/, "");
  return p === "" ? null : p;
}

// Exportada solo para poder testear la whitelist directamente desde
// scripts/selfcheck.mjs sin tener que simular un McpServer completo.
export function isAllowed(path: string): boolean {
  const p = normalizePath(path);
  if (!p) return false;
  return READ_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

const SENSITIVE_QUERY_KEY = /pass|token|secret|auth|2fa/i;

// Solo claves simples y valores primitivos (o arrays de ellos); descarta el resto.
export function sanitizeQuery(q?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!q) return undefined;
  const out: Record<string, unknown> = {};
  const prim = (v: unknown) => ["string", "number", "boolean"].includes(typeof v);
  for (const [k, v] of Object.entries(q)) {
    if (!/^[\w.[\]-]{1,64}$/.test(k) || SENSITIVE_QUERY_KEY.test(k)) continue;
    if (prim(v) || (Array.isArray(v) && v.every(prim))) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function nearest(path: string): string[] {
  const seg = path.split("/")[1]?.slice(0, 4) ?? "";
  const near = READ_PREFIXES.filter((p) => seg && p.slice(1).startsWith(seg));
  return (near.length ? near : READ_PREFIXES.slice(0, 5)).slice(0, 5);
}

export function registerRawGetTool(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "get",
    {
      title: "GET libre sobre la API (solo lectura)",
      description:
        "GET a cualquier path permitido (whitelist de prefijos de lectura) con query opcional. Útil para endpoints sin tool específica. NO ejecuta escrituras.",
      inputSchema: z.object({
              path: z.string().describe("Ruta de la API, ej /tickets/{id} o /connections"),
              query: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Query params (ej { page: 1, limit: 25 })"),
              truncate: z
                .number()
                .int()
                .min(1000)
                .optional()
                .describe("Máx chars del JSON compacto (default: completo)"),
            }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const path = normalizePath(args.path);
      if (!path || !isAllowed(path)) {
        return err(`Path no permitido. Prefijos cercanos: ${nearest(path ?? "").join(", ")}. Preferí las tools específicas.`);
      }
      try {
        const res = await client.get(path, sanitizeQuery(args.query as Record<string, unknown> | undefined));
        return okTruncated(ensureOk(res, path), args.truncate);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
