import type { GavrielClient } from "../gavrielClient.js";
import { err, paginationSchema, MAX_LIMIT, okTruncated, truncateSchema, selectFields, wrapReadOnly, forwardParams, fieldsSchema, ensureOk } from "./shared.js";
import { seg } from "./writeHelpers.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Role } from "./roles.js";

export function registerMonitoringTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "list_connections",
    {
      title: "Listar conexiones",
      description: "Usar cuando necesitás listar conexiones filtrando por bridge, tipo o texto. No usar para salud general (ver health).",
      inputSchema: z.object({
              ...paginationSchema,
              bridgeId: z.string().optional().describe("ID del bridge"),
              type: z.string().optional().describe("Tipo de conexión: server o client (otro valor da 500 en el backend)"),
              activated: z.boolean().optional().describe("Solo conexiones activadas"),
              search: z.string().optional().describe("Búsqueda libre"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: args.page, limit: args.limit, ...forwardParams(args as Record<string, unknown>, ["bridgeId", "type", "activated", "search"]) };
      const res = await client.get("/connections", params);
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "get_connection_report",
    {
      title: "Reporte de conexión",
      description: "Usar cuando necesitás el reporte de una conexión por ID (ver list_connections para obtenerlo).",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/connections/report/${seg(args.id)}`);
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "list_bridge_logs",
    {
      title: "Logs de bridge",
      description: "Usar cuando necesitás los logs de un bridge en un puerto (paginado por nextToken) para diagnosticar fallas.",
      inputSchema: z.object({
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
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { port: args.port };
      if (args.nextToken !== undefined) params.nextToken = args.nextToken;
      if (args.limit !== undefined) params.limit = args.limit;
      const res = await client.get(`/bridges/${seg(args.id)}/logs`, params);
      return okTruncated(selectFields(ensureOk(res) as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "get_bridge_disk_space",
    {
      title: "Disco del bridge",
      description: "Usar cuando sospechás que un bridge se quedó sin espacio y necesitás su uso de disco.",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/bridges/${seg(args.id)}/disk-space`);
      return okTruncated(ensureOk(res), args.truncate);
    }),
  );

  server.registerTool(
    "list_accounts_pending_events",
    {
      title: "Cuentas con eventos pendientes",
      description: "Usar cuando necesitás saber qué cuentas tienen eventos pendientes de atender. Para el detalle ver get_pending_events_dashboard.",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/events/accounts-with-pending-events");
      return okTruncated(ensureOk(res), args.truncate);
    }),
  );

  server.registerTool(
    "get_monitoring_events_chart",
    {
      title: "Gráfico de eventos",
      description: "Usar cuando necesitás la serie temporal de eventos de monitoreo para graficar o detectar picos.",
      inputSchema: z.object({
              connectionId: z.string().optional(),
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const path = args.connectionId
        ? "/monitoring/events-chart"
        : "/monitoring/all-connections-events-chart";
      try {
        const res = await client.get(path, args.connectionId ? { connectionId: args.connectionId } : undefined);
        return okTruncated(ensureOk(res), args.truncate);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_technician_locations",
    {
      title: "Ubicación de técnicos",
      description: "Usar cuando necesitás la última ubicación conocida de los técnicos en campo.",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/technician-locations/latest");
      return okTruncated(ensureOk(res), args.truncate);
    }),
  );
}
