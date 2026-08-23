import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured, wrapReadOnly, forwardParams, okTruncated, truncateSchema, selectFields, requireFilters } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, runBatch, destructiveGuard } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const EVENT_STATUSES = [
  "pending",
  "attending",
  "processed",
  "self-processed",
  "cancelled",
  "hidden",
] as const;

export function registerEventTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "get_event",
    {
      title: "Obtener evento por ID",
      description: "Evento por ID con relaciones.",
      inputSchema: z.object({
              id: z.string().describe("ID del evento"),
              truncate: truncateSchema,
              fields: z.array(z.string()).optional(),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/events/${args.id}`);
      const data = selectFields(res.data as Record<string, unknown>, args.fields);
      return args.truncate ? okTruncated(data, args.truncate) : ok(data);
    }),
  );

  server.registerTool(
    "list_events",
    {
      title: "Listar eventos",
      description:
        "Lista eventos (alarmas). Requiere accountId. Catálogos: gavriel://catalog/events-types",
      inputSchema: z.object({
              ...paginationSchema,
              accountId: z.string(),
              accountNumber: z.string().optional(),
              port: z.string().optional(),
              eventCode: z.string().optional(),
              eventTypeName: z.string().optional(),
              search: z.string().optional().describe("Búsqueda libre"),
              requiresIntervention: z.boolean().optional(),
              pending: z.boolean().optional().describe("Solo eventos pendientes"),
              inProgress: z.boolean().optional().describe("Solo eventos en curso"),
              bridgeId: z.string().optional(),
              connectionId: z.string().optional(),
              dateFrom: z.iso.datetime({ offset: true }).optional().describe("ISO datetime, ej 2026-08-01T00:00:00.000Z"),
              dateTo: z.iso.datetime({ offset: true }).optional().describe("ISO datetime"),
              fields: z.array(z.string()).optional().describe("Campos a retornar por evento"),
            }),
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const filtered = requireFilters(args, ["accountId"], "list_events");
      if (filtered) return filtered;
      const params: Record<string, unknown> = {
        page: args.page,
        limit: args.limit,
        sortBy: "createdAt",
        sortDirection: "desc",
        ...forwardParams(args as Record<string, unknown>, [
          "accountId", "accountNumber", "port", "eventCode", "eventTypeName",
          "search", "requiresIntervention", "pending", "inProgress",
          "bridgeId", "connectionId", "dateFrom", "dateTo",
        ]),
      };
      const res = await client.get("/events", params);
      const data = selectFields(res.data as Record<string, unknown>, args.fields);
      return okStructured(data);
    }),
  );

  registerTool(
    server, role, "full", "mark_events_processed",
    {
      title: "Marcar eventos como procesados (ESCRITURA)",
      description:
        "Marca eventos como procesados. Requiere confirm.",
      inputSchema: {
        eventIds: z.array(z.string()).min(1).describe("IDs de los eventos a marcar"),
        status: z
          .enum(EVENT_STATUSES)
          .default("processed")
          .describe("Estado a asignar (por defecto processed)"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const exec = {
        tool: "mark_events_processed",
        method: "PATCH",
        path: args.eventIds.map((id) => `/events/${id}`).join(", "),
        params: { eventIds: args.eventIds, status: args.status },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        // ponytail: N eventos = N PATCH seriales (la cola del cliente ya
        // serializa). No se confirmó endpoint bulk contra el bundle (ver
        // TIER3_PENDIENTE.md); si aparece uno, reemplazar el loop.
        const results = [];
        for (const id of args.eventIds) {
          const r = await client.patch(`/events/${id}`, { status: args.status });
          results.push({ id, status: r.status, data: r.data });
        }
        return { status: 200, data: { results } };
      }).then(ok);
    },
  );

  registerTool(
    server, role, "full", "bulk_mark_events_by_filter",
    {
      title: "Marcar eventos por filtro (ESCRITURA MASIVA)",
      description:
        "Resuelve eventos con filtros (cuenta obligatoria) y los marca al estado indicado. " +
        "Sin confirm muestra los IDs afectados; con confirm ejecuta los PATCH en lote.",
      inputSchema: {
        accountId: z.string().describe("ID de la cuenta"),
        port: z.string().optional(),
        eventCode: z.string().optional(),
        dateFrom: z.iso.datetime({ offset: true }).optional().describe("ISO datetime"),
        dateTo: z.iso.datetime({ offset: true }).optional().describe("ISO datetime"),
        targetStatus: z.enum(EVENT_STATUSES).default("processed").describe("Estado a asignar"),
        maxEvents: z.number().int().min(1).max(200).default(50).describe("Tope de eventos por ejecución"),
        confirm: confirmSchema,
      },
    },
    async (args, ctx) => {
      const params: Record<string, unknown> = {
        accountId: args.accountId,
        limit: args.maxEvents,
        sortBy: "createdAt",
        sortDirection: "desc",
      };
      if (args.port) params.port = args.port;
      if (args.eventCode) params.eventCode = args.eventCode;
      if (args.dateFrom) params.dateFrom = args.dateFrom;
      if (args.dateTo) params.dateTo = args.dateTo;
      const res = await client.get("/events", params);
      const items = Array.isArray(res.data)
        ? res.data
        : ((res.data as { data?: unknown[] } | null)?.data ?? []);
      if (!items.length) return ok({ matchedCount: 0, nota: "Ningún evento coincide con el filtro." });
      const ids = items.map((i) => String((i as Record<string, unknown>).id));
      const exec = {
        tool: "bulk_mark_events_by_filter",
        method: "PATCH",
        path: `/events (${ids.length} eventos por filtro accountId=${args.accountId})`,
        params: { eventIds: ids, status: args.targetStatus },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          ids.map((id) => ({ id, run: () => client.patch(`/events/${id}`, { status: args.targetStatus }) })),
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_mark_events_by_filter", exec, ctx.mcpReq.elicitInput)).then(ok);
    },
  );
}
