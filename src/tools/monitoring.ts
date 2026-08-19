import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, MAX_LIMIT, okTruncated, truncateSchema, selectFields, wrapReadOnly, forwardParams } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "./roles.js";

export function registerMonitoringTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexiones",
      description: "Conexiones con filtros.",
      inputSchema: {
        ...paginationSchema,
        bridgeId: z.string().optional().describe("ID del bridge"),
        type: z.string().optional().describe("Tipo de conexión"),
        activated: z.boolean().optional().describe("Solo conexiones activadas"),
        search: z.string().optional().describe("Búsqueda libre"),
        truncate: truncateSchema,
        fields: z.array(z.string()).optional().describe("Campos a retornar"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["bridgeId", "type", "activated", "search"]) };
      const res = await client.get("/connections", params);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "get_connection_report",
    {
      title: "Reporte de conexión",
      description: "Reporte de conexión.",
      inputSchema: {
        id: z.string(),
        truncate: truncateSchema,
        fields: z.array(z.string()).optional().describe("Campos a retornar"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/connections/report/${args.id}`);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "list_bridge_logs",
    {
      title: "Logs de bridge",
      description: "Logs de bridge paginados.",
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
        truncate: truncateSchema,
        fields: z.array(z.string()).optional().describe("Campos a retornar"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { port: args.port };
      if (args.nextToken !== undefined) params.nextToken = args.nextToken;
      if (args.limit !== undefined) params.limit = args.limit;
      const res = await client.get(`/bridges/${args.id}/logs`, params);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "get_bridge_disk_space",
    {
      title: "Disco del bridge",
      description: "Disco del bridge.",
      inputSchema: {
        id: z.string(),
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/bridges/${args.id}/disk-space`);
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "list_accounts_pending_events",
    {
      title: "Cuentas con eventos pendientes",
      description: "Cuentas con eventos pendientes.",
      inputSchema: {
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/events/accounts-with-pending-events");
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "get_monitoring_events_chart",
    {
      title: "Gráfico de eventos",
      description: "Gráfico de eventos.",
      inputSchema: {
        connectionId: z.string().optional(),
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const path = args.connectionId
        ? "/monitoring/events-chart"
        : "/monitoring/all-connections-events-chart";
      const res = await client.get(path, args.connectionId ? { connectionId: args.connectionId } : undefined);
      return okTruncated(res.data, args.truncate);
    },
  );

  server.registerTool(
    "get_technician_locations",
    {
      title: "Ubicación de técnicos",
      description: "Ubicación de técnicos.",
      inputSchema: {
        truncate: truncateSchema,
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/technician-locations/latest");
      return okTruncated(res.data, args.truncate);
    }),
  );
}
