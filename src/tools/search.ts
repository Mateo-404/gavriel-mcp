import type { GavrielClient } from "../gavrielClient.js";
import { ok, wrapReadOnly } from "./shared.js";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

// Mismos estados que events.ts.
const EVENT_STATUSES = ["pending", "attending", "processed", "self-processed", "cancelled", "hidden"] as const;

export function registerSearchTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "search_accounts",
    {
      title: "Buscar cuentas (resumen)",
      description:
        "Usar para ubicar rápido el ID de una cuenta por texto (devuelve solo id, accountNumber y name). " +
        "No usar si necesitás paginación/filtros por name o code (ver list_accounts) ni el detalle (ver get_account). Output: [{id, accountNumber, name}]",
      inputSchema: z.object({
              query: z.string().min(1).describe("Texto de búsqueda (nombre o código de cuenta)"),
              limit: z.number().int().min(1).max(25).default(10).describe("Máximo de resultados (default 10, máx 25)"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const res = await client.get("/accounts", { search: args.query, limit: args.limit }, { signal: ctx.mcpReq.signal });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data as { data?: unknown[] } | null)?.data ?? [];
      const results = list.map((a) => {
        const r = a as Record<string, unknown>;
        return { id: r.id, accountNumber: r.accountNumber, name: r.name };
      });
      return ok(results);
    }),
  );

  server.registerTool(
    "search_tickets",
    {
      title: "Buscar tickets (resumen)",
      description:
        "Usar para un vistazo rápido de tickets con campos reducidos. " +
        "No usar si necesitás todos los campos, paginación o más filtros (ver list_tickets) ni un ticket puntual (ver get_ticket). Output: [{id, title, status, priority, accountId, createdAt}]",
      inputSchema: z.object({
              status: z.enum(TICKET_STATUSES).optional().describe("Filtrar por estado"),
              priority: z.enum(TICKET_PRIORITIES).optional().describe("Filtrar por prioridad"),
              accountId: z.string().optional().describe("Filtrar por ID de cuenta"),
              accountSearch: z.string().optional().describe("Buscar tickets de una cuenta por nombre/número"),
              limit: z.number().int().min(1).max(50).default(15).describe("Máximo de resultados (default 15, máx 50)"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const params: Record<string, unknown> = {
        page: 1, limit: args.limit, sortBy: "createdAt", sortDirection: "desc",
      };
      if (args.status) params.status = args.status;
      if (args.priority) params.priority = args.priority;
      if (args.accountId) params.accountId = args.accountId;
      if (args.accountSearch) params.accountSearch = args.accountSearch;
      const res = await client.get("/tickets", params, { signal: ctx.mcpReq.signal });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data as { data?: unknown[] } | null)?.data ?? [];
      const results = list.map((t) => {
        const r = t as Record<string, unknown>;
        return { id: r.id, title: r.title, status: r.status, priority: r.priority, accountId: r.accountId, createdAt: r.createdAt };
      });
      return ok(results);
    }),
  );

  server.registerTool(
    "search_events",
    {
      title: "Buscar eventos (resumen)",
      description:
        "Usar para un vistazo rápido de eventos con campos reducidos (backend lento: siempre filtrar por accountId y/o fechas). " +
        "No usar si necesitás puerto/código/bridge o todos los campos (ver list_events) ni un evento puntual (ver get_event). Output: [{id, type, accountName, port, status, createdAt}]",
      inputSchema: z.object({
              accountId: z.string().describe("ID de cuenta (requerido para evitar queries lentas)"),
              status: z.enum(EVENT_STATUSES).optional().describe("Estado del evento"),
              dateFrom: z.string().optional().describe("Fecha inicio ISO datetime"),
              dateTo: z.string().optional().describe("Fecha fin ISO datetime"),
              limit: z.number().int().min(1).max(50).default(15).describe("Máximo de resultados (default 15, máx 50)"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const params: Record<string, unknown> = {
        page: 1, limit: args.limit, sortBy: "createdAt", sortDirection: "desc",
        accountId: args.accountId,
      };
      if (args.status === "pending") params.pending = true;
      else if (args.status) params.status = args.status;
      if (args.dateFrom) params.dateFrom = args.dateFrom;
      if (args.dateTo) params.dateTo = args.dateTo;
      const res = await client.get("/events", params, { signal: ctx.mcpReq.signal });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data as { data?: unknown[] } | null)?.data ?? [];
      const results = list.map((e) => {
        const r = e as Record<string, unknown>;
        const account = r.account as Record<string, unknown> | undefined;
        const eventsType = r.eventsType as Record<string, unknown> | undefined;
        return {
          id: r.id,
          type: eventsType?.name ?? r.eventTypeName ?? null,
          accountName: account?.name ?? null,
          port: r.port ?? null,
          status: r.status,
          createdAt: r.createdAt,
        };
      });
      return ok(results);
    }),
  );

  server.registerTool(
    "search_users",
    {
      title: "Buscar usuarios (resumen)",
      description:
        "Usar para ubicar usuarios por nombre o email con campos reducidos. " +
        "No usar para el listado completo/paginado de usuarios (ver list_users). " +
        "Output: [{id, name, email, role}]",
      inputSchema: z.object({
              query: z.string().optional().describe("Texto de búsqueda (nombre o email)"),
              limit: z.number().int().min(1).max(25).default(10).describe("Máximo de resultados (default 10, máx 25)"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const params: Record<string, unknown> = { page: 1, limit: args.limit };
      if (args.query) params.search = args.query;
      const res = await client.get("/users", params, { signal: ctx.mcpReq.signal });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data as { data?: unknown[] } | null)?.data ?? [];
      const results = list.map((u) => {
        const r = u as Record<string, unknown>;
        return { id: r.id, name: r.name, email: r.email, role: r.role };
      });
      return ok(results);
    }),
  );
}
