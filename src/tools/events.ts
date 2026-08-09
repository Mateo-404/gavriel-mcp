import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";

const EVENT_STATUSES = [
  "pending",
  "attending",
  "processed",
  "self-processed",
  "cancelled",
  "hidden",
] as const;

export function registerEventTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "list_events",
    {
      title: "Listar eventos",
      description:
        "Lista eventos (alarmas) con filtros. Parámetros y paginación duros (máx 200). Los estados de evento son: pending, attending, processed, self-processed, cancelled, hidden. IMPORTANTE: el backend es lento — siempre filtrar por accountId y/o rango de fechas acotado, nunca llamar sin filtros (puede tardar 60s+ o dar 500).",
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
    },
    async (args) => {
      try {
        const params: Record<string, unknown> = {
          page: args.page,
          limit: args.limit,
          sortBy: "createdAt",
          sortDirection: "desc",
        };
        for (const k of [
          "accountId", "accountNumber", "port", "eventCode", "eventTypeName",
          "search", "requiresIntervention", "pending", "inProgress",
          "bridgeId", "connectionId", "dateFrom", "dateTo",
        ] as const) {
          const v = (args as Record<string, unknown>)[k];
          if (v !== undefined) params[k] = v;
        }
        const res = await client.get("/events", params);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "mark_events_processed",
    {
      title: "Marcar eventos como procesados (ESCRITURA)",
      description:
        "Marca uno o más eventos como procesados (PATCH /events/{id} con status=processed). Requiere confirm: true para ejecutarse; sin confirm devuelve un preview de lo que haría.",
      inputSchema: {
        eventIds: z.array(z.string()).min(1).describe("IDs de los eventos a marcar"),
        status: z
          .enum(EVENT_STATUSES)
          .default("processed")
          .describe("Estado a asignar (por defecto processed)"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const exec = {
        tool: "mark_events_processed",
        method: "PATCH",
        path: args.eventIds.map((id) => `/events/${id}`).join(", "),
        params: { eventIds: args.eventIds, status: args.status },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
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
