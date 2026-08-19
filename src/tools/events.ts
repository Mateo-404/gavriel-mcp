import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured, wrapReadOnly, forwardParams, okTruncated } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
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
      description: "Devuelve el evento completo con relaciones (account, connection, eventsCode, eventsType).",
      inputSchema: {
        id: z.string().describe("ID del evento"),
        truncate: z.number().int().min(1000).optional().describe("Máx chars del JSON compacto (default: completo)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/events/${args.id}`);
      return args.truncate ? okTruncated(res.data, args.truncate) : ok(res.data);
    }),
  );

  server.registerTool(
    "list_events",
    {
      title: "Listar eventos",
      description:
        "Lista eventos (alarmas) con filtros. Estados: pending, attending, processed, self-processed, cancelled, hidden. IMPORTANTE: backend lento — filtrar siempre por accountId y/o rango de fechas acotado (sin filtros: 60s+ o 500).",
      inputSchema: {
        ...paginationSchema,
        accountId: z.string().optional(),
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
        dateFrom: z.string().optional().describe("ISO datetime, ej 2026-08-01T00:00:00.000Z"),
        dateTo: z.string().optional().describe("ISO datetime"),
      },
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
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
      return okStructured(res.data);
    }),
  );

  registerTool(
    server, role, "full", "mark_events_processed",
    {
      title: "Marcar eventos como procesados (ESCRITURA)",
      description:
        "Marca eventos como procesados (PATCH /events/{id}; status=processed). Requiere confirm: true; sin confirm devuelve preview.",
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
}
