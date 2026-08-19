import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okTruncated, wrapReadOnly, forwardParams, truncateSchema, requireFilters } from "./shared.js";
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
        "Audit log. Requiere entityType. Catálogos: gavriel://catalog/tickets/status-options",
      inputSchema: {
        ...paginationSchema,
        entityType: z.enum(AUDIT_ENTITY_TYPES),
        action: z.string().optional(),
        userId: z.string().optional(),
        accountId: z.string().optional(),
        entityId: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().optional().describe("ISO datetime"),
        endDate: z.string().optional().describe("ISO datetime"),
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const filtered = requireFilters(args, ["entityType"], "audit_logs");
      if (filtered) return filtered;
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["entityType", "action", "userId", "accountId", "entityId", "search", "startDate", "endDate"]) };
      const res = await client.get("/audit/logs", params);
      if (res.status === 403) return err("403: sin permiso audit:read. Pedile al admin que active ese permiso en Gavriel.");
      return okTruncated(res.data, args.truncate);
    }),
  );
}
