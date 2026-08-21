import type { GavrielClient } from "../gavrielClient.js";
import { ok, wrapReadOnly } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSearchTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "search_accounts",
    {
      title: "Buscar cuentas (resumen)",
      description:
        "Busca cuentas por nombre o código y devuelve solo id, accountNumber y name. " +
        "Para el resultado completo usar get_account(id). Output: [{id, accountNumber, name}]",
      inputSchema: {
        query: z.string().min(1).describe("Texto de búsqueda (nombre o código de cuenta)"),
        limit: z.number().int().min(1).max(25).default(10).describe("Máximo de resultados (default 10, máx 25)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/accounts", { search: args.query, limit: args.limit });
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
        "Busca tickets con filtros y devuelve campos reducidos. " +
        "Para el detalle completo usar get_ticket(id). Output: [{id, title, status, priority, accountId, createdAt}]",
      inputSchema: {
        status: z.string().optional().describe("Filtrar por estado (open, in_progress, resolved, closed)"),
        priority: z.string().optional().describe("Filtrar por prioridad (low, medium, high, urgent)"),
        accountId: z.string().optional().describe("Filtrar por ID de cuenta"),
        accountSearch: z.string().optional().describe("Buscar tickets de una cuenta por nombre/número"),
        limit: z.number().int().min(1).max(50).default(15).describe("Máximo de resultados (default 15, máx 50)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = {
        page: 1, limit: args.limit, sortBy: "createdAt", sortDirection: "desc",
      };
      if (args.status) params.status = args.status;
      if (args.priority) params.priority = args.priority;
      if (args.accountId) params.accountId = args.accountId;
      if (args.accountSearch) params.accountSearch = args.accountSearch;
      const res = await client.get("/tickets", params);
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
        "Busca eventos con filtros y devuelve campos reducidos. Backend lento: siempre filtrar por accountId y/o rango de fechas. " +
        "Para el detalle completo usar get_event(id). Output: [{id, type, accountName, port, status, createdAt}]",
      inputSchema: {
        accountId: z.string().describe("ID de cuenta (requerido para evitar queries lentas)"),
        status: z.string().optional().describe("Estado del evento (pending, attending, processed, etc.)"),
        dateFrom: z.string().optional().describe("Fecha inicio ISO datetime"),
        dateTo: z.string().optional().describe("Fecha fin ISO datetime"),
        limit: z.number().int().min(1).max(50).default(15).describe("Máximo de resultados (default 15, máx 50)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = {
        page: 1, limit: args.limit, sortBy: "createdAt", sortDirection: "desc",
        accountId: args.accountId,
      };
      if (args.status) params.pending = args.status === "pending";
      if (args.dateFrom) params.dateFrom = args.dateFrom;
      if (args.dateTo) params.dateTo = args.dateTo;
      const res = await client.get("/events", params);
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
        "Busca usuarios por nombre o email y devuelve campos reducidos. " +
        "Output: [{id, name, email, role}]",
      inputSchema: {
        query: z.string().optional().describe("Texto de búsqueda (nombre o email)"),
        limit: z.number().int().min(1).max(25).default(10).describe("Máximo de resultados (default 10, máx 25)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = { page: 1, limit: args.limit };
      if (args.query) params.search = args.query;
      const res = await client.get("/users", params);
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
