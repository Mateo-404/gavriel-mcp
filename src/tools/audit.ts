import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okTruncated, wrapReadOnly, forwardParams } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "./roles.js";

const AUDIT_ENTITY_TYPES = [
  "ACCOUNT", "TICKET", "INTERVENTION", "EVENT", "USER", "ZONE",
  "CONNECTION", "COMPANY", "AUTHENTICATION", "SYSTEM",
] as const;

export function registerAuditTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "audit_logs",
    {
      title: "Logs de auditoría",
      description:
        "GET /audit/logs con filtros (acciones sobre cuentas, tickets, intervenciones, eventos, usuarios). IMPORTANTE: backend lento — filtrar siempre por entityType y/o accountId/entityId/rango de fechas (sin filtros: ~3 min y 500).",
      inputSchema: {
        ...paginationSchema,
        entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
        action: z.string().optional(),
        userId: z.string().optional(),
        accountId: z.string().optional(),
        entityId: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().optional().describe("ISO datetime"),
        endDate: z.string().optional().describe("ISO datetime"),
        truncate: z
          .number()
          .int()
          .min(1000)
          .optional()
          .describe("Máx chars del JSON compacto (default: completo)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["entityType", "action", "userId", "accountId", "entityId", "search", "startDate", "endDate"]) };
      const res = await client.get("/audit/logs", params);
      return okTruncated(res.data, args.truncate);
    }),
  );
}
