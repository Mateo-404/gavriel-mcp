import type { GavrielClient } from "../gavrielClient.js";
import { ok, ensureOk, paginationSchema, okStructured, wrapReadOnly, forwardParams, okTruncated, truncateSchema, selectFields, requireFilters, fieldsSchema, idSchema, itemsOf, isoDateTime } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, runBatch, destructiveGuard, okOrInput, seg } from "./writeHelpers.js";
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
      description: "Usar cuando ya tenés el ID del evento y querés sus relaciones. No usar para listar/buscar (ver list_events / search_events) ni si querés también cuenta y conexión (ver get_event_context).",
      inputSchema: z.object({
              id: z.string().describe("ID del evento"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const res = await client.get(`/events/${seg(args.id)}`, undefined, { signal: ctx.mcpReq.signal });
      const data = selectFields(res.data as Record<string, unknown>, args.fields);
      return args.truncate ? okTruncated(data, args.truncate) : ok(data);
    }),
  );

  server.registerTool(
    "list_events",
    {
      title: "Listar eventos",
      description:
        "Usar cuando necesitás eventos (alarmas) de una cuenta con filtros completos (puerto, código, bridge, conexión, fechas) y paginación. Requiere accountId. No usar para un vistazo rápido con campos reducidos (ver search_events) ni para un evento puntual (ver get_event). Catálogos: gavriel://catalog/events-types",
      inputSchema: z.object({
              ...paginationSchema,
              accountId: z.string(),
              accountNumber: z.string().optional(),
              port: z.string().optional().describe("Puerto/zona del evento"),
              eventCode: z.string().optional().describe("Código de evento (ver gavriel://catalog/events-codes)"),
              eventTypeName: z.string().optional(),
              search: z.string().optional().describe("Búsqueda libre"),
              requiresIntervention: z.boolean().optional(),
              pending: z.boolean().optional().describe("Solo eventos pendientes"),
              inProgress: z.boolean().optional().describe("Solo eventos en curso"),
              bridgeId: z.string().optional().describe("ID del bridge (ver list_connections)"),
              connectionId: z.string().optional().describe("ID de la conexión"),
              dateFrom: isoDateTime.optional().describe("ISO datetime, ej 2026-08-01T00:00:00.000Z"),
              dateTo: isoDateTime.optional().describe("ISO datetime"),
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
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
      const res = await client.get("/events", params, { signal: ctx.mcpReq.signal });
      ensureOk(res, "list_events");
      const data = selectFields(res.data as Record<string, unknown>, args.fields);
      return okStructured(data);
    }),
  );

  registerTool(
    server, role, "full", "mark_events_processed",
    {
      title: "Marcar eventos como procesados",
      description:
        "Usar para cambiar el estado (default processed) de hasta 50 eventos por ID. Destructiva: pide aprobación humana. Para muchos eventos de una cuenta ver bulk_mark_events_by_filter.",
      inputSchema: {
        eventIds: z.array(idSchema).min(1).max(50).describe("IDs de los eventos a marcar (máx 50)"),
        status: z
          .enum(EVENT_STATUSES)
          .default("processed")
          .describe("Estado a asignar (por defecto processed)"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args, ctx) => {
      const exec = {
        tool: "mark_events_processed",
        method: "PATCH",
        path: args.eventIds.map((id) => `/events/${seg(id)}`).join(", "),
        params: { eventIds: args.eventIds, status: args.status },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        // ponytail: N eventos = N PATCH seriales (la cola del cliente ya
        // serializa). No se confirmó endpoint bulk (ver
        // TIER3_PENDIENTE.md); si aparece uno, reemplazar el loop.
        const results = [];
        for (const id of args.eventIds) {
          const r = await client.patch(`/events/${seg(id)}`, { status: args.status });
          results.push({ id, status: r.status, data: r.data });
        }
        return { status: 200, data: { results } };
      }, destructiveGuard("mark_events_processed", exec, ctx)).then(okOrInput);
    },
  );

  registerTool(
    server, role, "full", "bulk_mark_events_by_filter",
    {
      title: "Marcar eventos por filtro (masivo)",
      description:
        "Usar para marcar en lote los eventos de una cuenta que cumplen un filtro (por defecto solo pendientes). " +
        "Dos pasos: sin confirm devuelve los IDs afectados; para ejecutar, repetí la llamada con confirm:true y esos mismos IDs en eventIds " +
        "(si el conjunto cambió entre preview y confirm no ejecuta). Destructiva: pide aprobación humana.",
      inputSchema: {
        accountId: idSchema.describe("ID de la cuenta"),
        port: z.string().optional(),
        eventCode: z.string().optional(),
        dateFrom: isoDateTime.optional().describe("ISO datetime"),
        dateTo: isoDateTime.optional().describe("ISO datetime"),
        onlyPending: z.boolean().default(true).describe("Solo eventos pendientes (default true)"),
        targetStatus: z.enum(EVENT_STATUSES).default("processed").describe("Estado a asignar"),
        maxEvents: z.number().int().min(1).max(200).default(50).describe("Tope de eventos por ejecución"),
        eventIds: z.array(idSchema).max(200).optional().describe("IDs devueltos por el preview; obligatorio con confirm:true"),
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
      if (args.onlyPending) params.pending = true;
      if (args.port) params.port = args.port;
      if (args.eventCode) params.eventCode = args.eventCode;
      if (args.dateFrom) params.dateFrom = args.dateFrom;
      if (args.dateTo) params.dateTo = args.dateTo;
      const res = await client.get("/events", params, { signal: ctx.mcpReq.signal });
      ensureOk(res, "listado de eventos");
      const ids = itemsOf(res.data).map((i) => String(i.id));
      if (!ids.length) return ok({ matchedCount: 0, nota: "Ningún evento coincide con el filtro." });
      if (args.confirm === true) {
        // El conjunto queda fijado por el preview: debe coincidir exacto con el actual.
        const pinned = args.eventIds ?? [];
        const same = pinned.length === ids.length && pinned.every((id) => ids.includes(id));
        if (!same) {
          return ok({
            ok: false,
            writeStatus: "not_executed",
            mensaje: "confirm:true requiere eventIds idéntico al preview; el conjunto actual difiere (o falta eventIds). Revisá y reintentá con estos IDs.",
            eventIds: ids,
          });
        }
      }
      const exec = {
        tool: "bulk_mark_events_by_filter",
        method: "PATCH",
        path: `/events (${ids.length} eventos por filtro accountId=${args.accountId})`,
        params: { eventIds: ids, status: args.targetStatus },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          ids.map((id) => ({ id, run: (signal) => client.patch(`/events/${seg(id)}`, { status: args.targetStatus }, signal) })),
          ctx,
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_mark_events_by_filter", exec, ctx)).then(okOrInput);
    },
  );
}
