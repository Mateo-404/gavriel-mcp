import type { GavrielClient } from "../gavrielClient.js";
import { err, okTruncated } from "./shared.js";
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
  "/integrations",
  "/interventions/account",
  "/interventions",
  "/tickets",
  "/ticket-categories",
  "/activities",
  "/me/conversations",
  "/conversations",
  "/audit/logs",
  "/auth",
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

// Exportada solo para poder testear la whitelist directamente desde
// scripts/selfcheck.mjs sin tener que simular un McpServer completo.
export function isAllowed(path: string): boolean {
  if (!path.startsWith("/")) return false;
  return READ_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
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
      const path = args.path.startsWith("/") ? args.path : `/${args.path}`;
      if (!isAllowed(path)) {
        return err(
          `Path no permitido: ${path}. Whitelist: ${READ_PREFIXES.join(", ")}. ` +
            "Si falta un endpoint de lectura, agregalo en src/tools/rawGet.ts.",
        );
      }
      try {
        const res = await client.get(path, args.query as Record<string, unknown> | undefined);
        return okTruncated(res.data, args.truncate);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
