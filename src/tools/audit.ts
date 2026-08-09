import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const AUDIT_ENTITY_TYPES = [
  "ACCOUNT", "TICKET", "INTERVENTION", "EVENT", "USER", "ZONE",
  "CONNECTION", "COMPANY", "AUTHENTICATION", "SYSTEM",
] as const;

export function registerAuditTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "audit_logs",
    {
      title: "Logs de auditoría",
      description:
        "GET /audit/logs con filtros. El sistema registra acciones sobre cuentas, tickets, intervenciones, eventos, usuarios, etc. IMPORTANTE: el backend es lento — siempre filtrar por entityType y/o accountId/entityId/rango de fechas; sin filtros tarda ~3 min y termina en error 500.",
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
      },
    },
    async (args) => {
      try {
        const params: Record<string, unknown> = { page: args.page, limit: args.limit };
        for (const k of ["entityType", "action", "userId", "accountId", "entityId", "search", "startDate", "endDate"] as const) {
          const v = (args as Record<string, unknown>)[k];
          if (v !== undefined) params[k] = v;
        }
        const res = await client.get("/audit/logs", params);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
