import type { GavrielClient } from "../gavrielClient.js";
import { ok, wrapReadOnly } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

export function registerDashboardTools(server: McpServer, client: GavrielClient): void {
  server.registerTool(
    "get_account_dashboard",
    {
      title: "Dashboard de cuenta (compuesto)",
      description:
        "Combina info de cuenta + dispositivos + intervenciones + eventos pendientes en UNA sola llamada. " +
        "Ahorra 4 llamadas vs hacer cada una por separado.",
      inputSchema: z.object({
              id: z.string().describe("ID de la cuenta"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const [accountRes, devicesRes, interventionsRes, eventsRes] = await Promise.allSettled([
        client.get(`/accounts/${args.id}`),
        client.get(`/accounts/${args.id}/devices`),
        client.get(`/interventions/account/${args.id}/open`),
        client.get("/events", { accountId: args.id, pending: true, limit: 50 }),
      ]);

      const account = accountRes.status === "fulfilled"
        ? (() => { const a = accountRes.value.data as Record<string, unknown>; return { id: a.id, name: a.name, accountNumber: a.accountNumber, phone: a.phone, address: a.address }; })()
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

      const events = eventsRes.status === "fulfilled"
        ? (Array.isArray(eventsRes.value.data) ? eventsRes.value.data : (eventsRes.value.data as { data?: unknown[] } | null)?.data ?? [])
        : [];

      return ok({
        account,
        devices,
        openInterventions: interventions.length,
        pendingEvents: events.length,
      });
    }),
  );

  server.registerTool(
    "get_ticket_context",
    {
      title: "Contexto de ticket (compuesto)",
      description:
        "Combina ticket + cuenta + actividades en UNA sola llamada. " +
        "Útil para entender un ticket sin hacer múltiples queries.",
      inputSchema: z.object({
              id: z.string().describe("ID del ticket"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const [ticketRes, activitiesRes] = await Promise.allSettled([
        client.get(`/tickets/${args.id}`),
        client.get(`/activities/ticket/${args.id}`),
      ]);

      const ticket = ticketRes.status === "fulfilled" ? ticketRes.value.data : null;
      const ticketRecord = ticket as Record<string, unknown> | null;
      const accountId = ticketRecord?.accountId as string | undefined;

      let account = null;
      if (accountId) {
        try {
          const accountRes = await client.get(`/accounts/${accountId}`);
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
        "Combina evento + cuenta + conexión en UNA sola llamada. " +
        "Útil para entender un evento sin hacer múltiples queries.",
      inputSchema: z.object({
              id: z.string().describe("ID del evento"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const eventRes = await client.get(`/events/${args.id}`);
      const event = eventRes.data as Record<string, unknown>;
      const account = event.account as Record<string, unknown> | undefined;
      const connection = event.connection as Record<string, unknown> | undefined;

      let accountDetail = null;
      if (account?.id) {
        try {
          const accountRes = await client.get(`/accounts/${account.id}`);
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
        "Lista cuentas con eventos pendientes y sus detalles. " +
        "Útil para procesamiento masivo de eventos.",
      inputSchema: z.object({
              limit: z.number().int().min(1).max(50).default(10).describe("Máximo de cuentas a mostrar"),
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const accountsRes = await client.get("/events/accounts-with-pending-events");
      const accounts = Array.isArray(accountsRes.data)
        ? accountsRes.data.slice(0, args.limit)
        : [];

      const results = await Promise.allSettled(
        accounts.map(async (a: Record<string, unknown>) => {
          const eventsRes = await client.get("/events", { accountId: a.id, pending: true, limit: 50 });
          const eventsData = eventsRes.data;
          const events = Array.isArray(eventsData) ? eventsData : [];
          return {
            accountId: a.id,
            accountName: a.name,
            accountNumber: a.accountNumber,
            pendingEvents: events.length,
            events: events.map((e: Record<string, unknown>) => ({ id: e.id, port: e.port, createdAt: e.createdAt })).slice(0, 5),
          };
        }),
      );

      const dashboard = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<unknown>).value);

      return ok(dashboard);
    }),
  );
}
