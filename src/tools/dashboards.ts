import type { GavrielClient } from "../gavrielClient.js";
import { ok, ensureOk, wrapReadOnly, totalOf, itemsOf } from "./shared.js";
import { seg } from "./writeHelpers.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

const CACHE_TTL = 5 * 60_000;
const CONCURRENCY = 5;

// Resultado de un sub-call: data si fue 2xx; si no, deja un warning y devuelve undefined.
function dataOrWarn(r: PromiseSettledResult<{ status: number; data: unknown }>, label: string, warnings: string[]): unknown {
  try {
    if (r.status === "rejected") throw r.reason;
    return ensureOk(r.value, label);
  } catch (e) {
    warnings.push(`${label}: ${(e as Error).message}`);
    return undefined;
  }
}

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
      const id = seg(args.id);
      const warnings: string[] = [];
      const [accountRes, devicesRes, interventionsRes, eventsRes] = await Promise.allSettled([
        client.get(`/accounts/${id}`, undefined, { signal: ctx.mcpReq.signal }),
        client.get(`/accounts/${id}/devices`, undefined, { ttl: CACHE_TTL, signal: ctx.mcpReq.signal }),
        client.get(`/interventions/account/${id}/open`, undefined, { signal: ctx.mcpReq.signal }),
        client.get("/events", { accountId: args.id, pending: true, limit: 50 }, { signal: ctx.mcpReq.signal }),
      ]);

      const a = dataOrWarn(accountRes, `cuenta ${args.id}`, warnings) as Record<string, unknown> | undefined;
      const account = a
        ? { id: a.id, name: a.name, accountNumber: a.accountNumber, phone: a.phone, address: a.address }
        : { error: "No se pudo obtener la cuenta" };

      const devicesData = dataOrWarn(devicesRes, "dispositivos", warnings);
      const devices = itemsOf(devicesData).map((d) => {
        const brand = d.brand as Record<string, unknown> | undefined;
        const model = d.model as Record<string, unknown> | undefined;
        return { id: d.id, serialNumber: d.serialNumber, brand: brand?.name, model: model?.name, status: d.status };
      });

      const interventionsData = dataOrWarn(interventionsRes, "intervenciones abiertas", warnings);
      const ev = dataOrWarn(eventsRes, "eventos pendientes", warnings);

      return ok({
        account,
        devices,
        openInterventions: interventionsData === undefined ? null : itemsOf(interventionsData).length,
        pendingEvents: ev === undefined ? null : totalOf(ev),
        ...(warnings.length ? { warnings } : {}),
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
      const warnings: string[] = [];
      const [ticketRes, activitiesRes] = await Promise.allSettled([
        client.get(`/tickets/${seg(args.id)}`, undefined, { signal: ctx.mcpReq.signal }),
        client.get(`/activities/ticket/${seg(args.id)}`, undefined, { signal: ctx.mcpReq.signal }),
      ]);

      // Sin ticket no hay contexto: error claro en vez de {ticket:null}.
      if (ticketRes.status === "rejected") throw ticketRes.reason;
      const ticket = ensureOk<Record<string, unknown>>(ticketRes.value, `ticket ${args.id}`);
      const accountId = ticket.accountId as string | undefined;

      const inline = ticket.account as Record<string, unknown> | undefined;
      let account = null;
      if (inline?.id) {
        account = { id: inline.id, name: inline.name, phone: inline.phone, email: inline.email };
      } else if (accountId) {
        try {
          const accountRes = await client.get(`/accounts/${seg(accountId)}`, undefined, { signal: ctx.mcpReq.signal });
          const a = ensureOk<Record<string, unknown>>(accountRes, `cuenta ${accountId}`);
          account = { id: a.id, name: a.name, phone: a.phone, email: a.email };
        } catch (e) {
          warnings.push((e as Error).message);
          account = { id: accountId, error: "No se pudo obtener la cuenta" };
        }
      }

      const activities = itemsOf(dataOrWarn(activitiesRes, "actividades", warnings))
        .map((a) => ({ id: a.id, title: a.title, type: a.type, createdAt: a.createdAt }));

      return ok({ ticket, account, activities, ...(warnings.length ? { warnings } : {}) });
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
      const eventRes = await client.get(`/events/${seg(args.id)}`, undefined, { signal: ctx.mcpReq.signal });
      const warnings: string[] = [];
      const event = ensureOk<Record<string, unknown>>(eventRes, `evento ${args.id}`);
      const account = event.account as Record<string, unknown> | undefined;
      const connection = event.connection as Record<string, unknown> | undefined;

      let accountDetail = null;
      if (account?.id) {
        try {
          const accountRes = await client.get(`/accounts/${seg(String(account.id))}`, undefined, { signal: ctx.mcpReq.signal });
          const a = ensureOk<Record<string, unknown>>(accountRes, `cuenta ${account.id}`);
          accountDetail = { id: a.id, name: a.name, phone: a.phone, email: a.email };
        } catch (e) {
          warnings.push((e as Error).message);
          accountDetail = { id: account.id, name: account.name };
        }
      }

      return ok({
        event: { id: event.id, status: event.status, createdAt: event.createdAt, port: event.port },
        account: accountDetail,
        connection: connection ? { id: connection.id, type: connection.type, activated: connection.activated } : null,
        ...(warnings.length ? { warnings } : {}),
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
      const accounts = itemsOf(ensureOk(accountsRes, "cuentas con eventos pendientes")).slice(0, args.limit);

      // Pool de CONCURRENCY workers; resultados por índice para conservar el orden original.
      const rows: unknown[] = new Array(accounts.length);
      const warnings: string[] = [];
      let next = 0;
      const worker = async () => {
        while (next < accounts.length) {
          const i = next++;
          const a = accounts[i];
          try {
            const eventsRes = await client.get("/events", { accountId: a.id, pending: true, limit: 5 }, { signal: ctx.mcpReq.signal });
            const d = ensureOk(eventsRes, `eventos de cuenta ${a.id}`);
            const events = itemsOf(d);
            rows[i] = {
              accountId: a.id,
              accountName: a.name,
              accountNumber: a.accountNumber,
              pendingEvents: totalOf(d),
              events: events.map((e) => ({ id: e.id, port: e.port, createdAt: e.createdAt })),
            };
          } catch (e) {
            warnings.push(`cuenta ${a.id}: ${(e as Error).message}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));

      const dashboard = rows.filter((r) => r !== undefined);
      return ok(warnings.length ? { dashboard, warnings } : dashboard);
    }),
  );
}
