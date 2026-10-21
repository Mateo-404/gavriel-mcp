import type { GavrielClient } from "../gavrielClient.js";
import { ok, ensureOk, wrapReadOnly } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

const CACHE_TTL = 5 * 60_000;
const CONCURRENCY = 5;

export function registerDashboardTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "get_account_dashboard",
    {
      title: "Dashboard de cuenta (compuesto)",
      description:
        "Usar para el panorama operativo de una cuenta en una sola llamada (cuenta + dispositivos + intervenciones abiertas + eventos pendientes). " +
        "No usar si solo necesitás la ficha (ver get_account) ni listar eventos con filtros (ver list_events).",
      inputSchema: z.object({
              id: z.string().describe("ID de la cuenta"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const [accountRes, devicesRes, interventionsRes, eventsRes] = await Promise.allSettled([
        client.get(`/accounts/${args.id}`, undefined, { signal: ctx.mcpReq.signal }),
        client.get(`/accounts/${args.id}/devices`, undefined, { ttl: CACHE_TTL, signal: ctx.mcpReq.signal }),
        client.get(`/interventions/account/${args.id}/open`, undefined, { signal: ctx.mcpReq.signal }),
        client.get("/events", { accountId: args.id, pending: true, limit: 50 }, { signal: ctx.mcpReq.signal }),
      ]);

      const account = accountRes.status === "fulfilled"
        ? (() => {
            const a = ensureOk<Record<string, unknown>>(accountRes.value, `cuenta ${args.id}`);
            return { id: a.id, name: a.name, accountNumber: a.accountNumber, phone: a.phone, address: a.address };
          })()
        : { error: "No se pudo obtener la cuenta" };

      const devices = devicesRes.status === "fulfilled"
        ? (Array.isArray(devicesRes.value.data) ? devicesRes.value.data : []).map((d: Record<string, unknown>) => {
            const brand = d.brand as Record<string, unknown> | undefined;
            const model = d.model as Record<string, unknown> | undefined;
            return { id: d.id, serialNumber: d.serialNumber, brand: brand?.name, model: model?.name, status: d.status };
          })
        : [];

      const interventions = interventionsRes.status === "fulfilled"
        ? (Array.isArray(interventionsRes.value.data) ? interventionsRes.value.data : [])
        : [];

      const ev = eventsRes.status === "fulfilled" ? eventsRes.value.data : null;
      const evTotal = (ev as { total?: number } | null)?.total;
      const pendingEvents = typeof evTotal === "number"
        ? evTotal
        : (Array.isArray(ev) ? ev : (ev as { data?: unknown[] } | null)?.data ?? []).length;

      return ok({
        account,
        devices,
        openInterventions: interventions.length,
        pendingEvents,
      });
    }),
  );

  server.registerTool(
    "get_ticket_context",
    {
      title: "Contexto de ticket (compuesto)",
      description:
        "Usar para entender un ticket con su cuenta y actividades en una sola llamada. " +
        "No usar si solo necesitás ticket + actividades (ver get_ticket) ni para listar/buscar (ver list_tickets / search_tickets).",
      inputSchema: z.object({
              id: z.string().describe("ID del ticket"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const [ticketRes, activitiesRes] = await Promise.allSettled([
        client.get(`/tickets/${args.id}`, undefined, { signal: ctx.mcpReq.signal }),
        client.get(`/activities/ticket/${args.id}`, undefined, { signal: ctx.mcpReq.signal }),
      ]);

      const ticket = ticketRes.status === "fulfilled"
        ? ensureOk<Record<string, unknown>>(ticketRes.value, `ticket ${args.id}`)
        : null;
      const accountId = (ticket as Record<string, unknown> | null)?.accountId as string | undefined;

      const inline = (ticket as Record<string, unknown> | null)?.account as Record<string, unknown> | undefined;
      let account = null;
      if (inline?.id) {
        account = { id: inline.id, name: inline.name, phone: inline.phone, email: inline.email };
      } else if (accountId) {
        try {
          const accountRes = await client.get(`/accounts/${accountId}`, undefined, { signal: ctx.mcpReq.signal });
          const a = accountRes.data as Record<string, unknown>;
          account = { id: a.id, name: a.name, phone: a.phone, email: a.email };
        } catch {
          account = { id: accountId, error: "No se pudo obtener la cuenta" };
        }
      }

      const activities = activitiesRes.status === "fulfilled"
        ? (Array.isArray(activitiesRes.value.data) ? activitiesRes.value.data : []).map((a: Record<string, unknown>) => ({ id: a.id, title: a.title, type: a.type, createdAt: a.createdAt }))
        : [];

      return ok({ ticket, account, activities });
    }),
  );

  server.registerTool(
    "get_event_context",
    {
      title: "Contexto de evento (compuesto)",
      description:
        "Usar para entender un evento con su cuenta y conexión en una sola llamada. " +
        "No usar si solo necesitás el evento (ver get_event) ni para listar/buscar (ver list_events / search_events).",
      inputSchema: z.object({
              id: z.string().describe("ID del evento"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const eventRes = await client.get(`/events/${args.id}`, undefined, { signal: ctx.mcpReq.signal });
      const event = ensureOk<Record<string, unknown>>(eventRes, `evento ${args.id}`);
      const account = event.account as Record<string, unknown> | undefined;
      const connection = event.connection as Record<string, unknown> | undefined;

      let accountDetail = null;
      if (account?.id) {
        try {
          const accountRes = await client.get(`/accounts/${account.id}`, undefined, { signal: ctx.mcpReq.signal });
          const a = accountRes.data as Record<string, unknown>;
          accountDetail = { id: a.id, name: a.name, phone: a.phone, email: a.email };
        } catch {
          accountDetail = { id: account.id, name: account.name };
        }
      }

      return ok({
        event: { id: event.id, status: event.status, createdAt: event.createdAt, port: event.port },
        account: accountDetail,
        connection: connection ? { id: connection.id, type: connection.type, activated: connection.activated } : null,
      });
    }),
  );

  server.registerTool(
    "get_pending_events_dashboard",
    {
      title: "Dashboard de eventos pendientes",
      description:
        "Usar para ver qué cuentas tienen eventos pendientes (con detalle) antes de procesarlos en masa. " +
        "No usar para eventos de una cuenta concreta con filtros (ver list_events) ni para su panorama (ver get_account_dashboard).",
      inputSchema: z.object({
              limit: z.number().int().min(1).max(50).default(10).describe("Máximo de cuentas a mostrar"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args, ctx) => {
      const accountsRes = await client.get("/events/accounts-with-pending-events", undefined, { signal: ctx.mcpReq.signal });
      const accounts = Array.isArray(accountsRes.data)
        ? accountsRes.data.slice(0, args.limit)
        : [];

      // Pool de CONCURRENCY workers; solo se piden los 5 eventos que se muestran.
      const dashboard: unknown[] = [];
      let next = 0;
      const worker = async () => {
        while (next < accounts.length) {
          const a = accounts[next++] as Record<string, unknown>;
          try {
            const eventsRes = await client.get("/events", { accountId: a.id, pending: true, limit: 5 }, { signal: ctx.mcpReq.signal });
            const d = eventsRes.data as unknown;
            const events: Record<string, unknown>[] = Array.isArray(d) ? d : (d as { data?: Record<string, unknown>[] } | null)?.data ?? [];
            const total = (d as { total?: number } | null)?.total;
            dashboard.push({
              accountId: a.id,
              accountName: a.name,
              accountNumber: a.accountNumber,
              pendingEvents: typeof total === "number" ? total : events.length,
              events: events.map((e) => ({ id: e.id, port: e.port, createdAt: e.createdAt })),
            });
          } catch {
            // cuenta omitida (igual que antes con allSettled)
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));

      return ok(dashboard);
    }),
  );
}
