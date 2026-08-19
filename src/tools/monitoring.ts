import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, MAX_LIMIT, okTruncated, wrapReadOnly, forwardParams } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "./roles.js";

export function registerMonitoringTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexiones",
      description: "GET /connections con filtros opcionales (bridge, tipo, activa, búsqueda).",
      inputSchema: {
        ...paginationSchema,
        bridgeId: z.string().optional().describe("ID del bridge"),
        type: z.string().optional().describe("Tipo de conexión"),
        activated: z.boolean().optional().describe("Solo conexiones activadas"),
        search: z.string().optional().describe("Búsqueda libre"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["bridgeId", "type", "activated", "search"]) };
      const res = await client.get("/connections", params);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_connection_report",
    {
      title: "Obtener reporte de conexión",
      description: "GET /connections/report/{id}.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/connections/report/${args.id}`);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_bridge_logs",
    {
      title: "Listar logs de bridge",
      description: "GET /bridges/{id}/logs, paginado por puerto con nextToken.",
      inputSchema: {
        id: z.string(),
        port: z.string().describe("Puerto (obligatorio)"),
        nextToken: z.string().optional().describe("Token de continuación"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Cantidad por página (máximo ${MAX_LIMIT})`),
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
      const params: Record<string, unknown> = { port: args.port };
      if (args.nextToken !== undefined) params.nextToken = args.nextToken;
      if (args.limit !== undefined) params.limit = args.limit;
      const res = await client.get(`/bridges/${args.id}/logs`, params);
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "get_bridge_disk_space",
    {
      title: "Obtener espacio en disco de bridge",
      description: "GET /bridges/{id}/disk-space.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/bridges/${args.id}/disk-space`);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_accounts_pending_events",
    {
      title: "Listar cuentas con eventos pendientes",
      description: "GET /events/accounts-with-pending-events. Cuentas con eventos pendientes para intervención masiva.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async () => {
      const res = await client.get("/events/accounts-with-pending-events");
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_monitoring_events_chart",
    {
      title: "Obtener gráfico de eventos de monitoreo",
      description:
        "GET /monitoring/events-chart con connectionId, o /monitoring/all-connections-events-chart si no se pasa.",
      inputSchema: { connectionId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const path = args.connectionId
        ? "/monitoring/events-chart"
        : "/monitoring/all-connections-events-chart";
      const res = await client.get(path, args.connectionId ? { connectionId: args.connectionId } : undefined);
      return ok(res.data);
    },
  );
}
