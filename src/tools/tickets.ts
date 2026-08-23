import type { GavrielClient } from "../gavrielClient.js";
import { ok, paginationSchema, okTruncated, buildBody, wrapReadOnly, forwardParams, truncateSchema, selectFields, fieldsSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const singleOrArray = z.union([z.string(), z.array(z.string())]).optional();

const ACTIVITY_TYPES = [
  "MESSAGE", "TASK", "NOTIFICATION", "REMINDER", "ALERT", "UPDATE",
] as const;

function addWriteTicketTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "lite", "create_ticket",
    {
      title: "Crear ticket (ESCRITURA)",
      description:
        "POST /tickets. status y priority se validan contra catálogos (gavriel://catalog/tickets/*). La descripción se envía como texto/HTML.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.string().default("medium"),
        status: z.string().default("open"),
        accountId: z.string().optional().nullish(),
        categoryId: z.string().optional().nullish(),
        assignedUserId: z.string().optional().nullish(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["title", "priority", "status"],
        optional: ["description", "accountId", "categoryId", "assignedUserId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_ticket", method: "POST", path: "/tickets", params: body },
        client,
        () => client.post("/tickets", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "lite", "update_ticket",
    {
      title: "Actualizar ticket (ESCRITURA)",
      description:
        "PATCH /tickets/{id}. Solo envía los campos provistos. Para cerrar con resolución usar close_ticket.",
      inputSchema: {
        ticketId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.string().optional(),
        status: z.string().optional(),
        accountId: z.string().optional().nullish(),
        categoryId: z.string().optional().nullish(),
        assignedUserId: z.string().optional().nullish(),
        resolution: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["title", "description", "priority", "status", "accountId", "categoryId", "assignedUserId", "resolution"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_ticket", method: "PATCH", path: `/tickets/${args.ticketId}`, params: body },
        client,
        () => client.patch(`/tickets/${args.ticketId}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "close_ticket",
    {
      title: "Cerrar ticket (ESCRITURA)",
      description:
        "PATCH /tickets/{id}/close con resolución.",
      inputSchema: {
        ticketId: z.string(),
        resolution: z.string().describe("Resolución / comentario de cierre"),
        confirm: confirmSchema,
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const body = { resolution: args.resolution };
      return requireConfirm(
        args.confirm,
        { tool: "close_ticket", method: "PATCH", path: `/tickets/${args.ticketId}/close`, params: body },
        client,
        () => client.patch(`/tickets/${args.ticketId}/close`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "add_ticket_activity",
    {
      title: "Agregar actividad a ticket (ESCRITURA)",
      description:
        "POST /activities: comentario/actividad en un ticket. type: MESSAGE|TASK|NOTIFICATION|REMINDER|ALERT|UPDATE (default MESSAGE). Requiere confirm: true.",
      inputSchema: {
        ticketId: z.string(),
        title: z.string().describe("Título de la actividad (requerido por la API)"),
        description: z.string().optional(),
        type: z.enum(ACTIVITY_TYPES).default("MESSAGE"),
        assignedUserId: z.string().optional().nullish(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["ticketId", "title", "type"],
        optional: ["description", "assignedUserId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "add_ticket_activity", method: "POST", path: "/activities", params: body },
        client,
        () => client.post("/activities", body),
      ).then(ok);
    },
  );
}

export function registerTicketTools(server: McpServer, client: GavrielClient, role: Role): void {
  addWriteTicketTools(server, client, role);

  server.registerTool(
    "list_tickets",
    {
      title: "Listar tickets",
      description:
        "Lista tickets con filtros.",
      inputSchema: z.object({
              ...paginationSchema,
              search: z.string().optional().describe("Búsqueda libre (título/descripción)"),
              status: singleOrArray.describe(
                "Estado(s). Ver gavriel://catalog/tickets/status-options para valores válidos.",
              ),
              priority: singleOrArray.describe(
                "Prioridad(es). Ver gavriel://catalog/tickets/priority-options para valores válidos.",
              ),
              accountSearch: z.string().optional().describe("Busca tickets de una cuenta por nombre/número"),
              accountId: z.string().optional(),
              categoryId: z.string().optional(),
              assignedUserId: z.string().optional(),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = {
        page: args.page,
        limit: args.limit,
        sortBy: "createdAt",
        sortDirection: "desc",
        ...forwardParams(args as Record<string, unknown>, ["search", "status", "priority", "accountSearch", "accountId", "categoryId", "assignedUserId"]),
      };
      const res = await client.get("/tickets", params);
      const data = args.fields ? selectFields(res.data as Record<string, unknown>[], args.fields) : res.data;
      return args.truncate ? okTruncated(data, args.truncate) : ok(data);
    }),
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Obtener ticket por ID",
      description: "Ticket y sus actividades.",
      inputSchema: z.object({
              id: z.string().describe("ID del ticket"),
              include: z.array(z.enum(["activities"])).optional().describe("Secciones extra (default: activities)"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const ticket = await client.get(`/tickets/${args.id}`);
      const shouldFetchActivities = !args.include || args.include.includes("activities");
      if (shouldFetchActivities) {
        const activities = await client.get(`/activities/ticket/${args.id}`);
        const result = { ticket: ticket.data, activities: activities.data };
        const filtered = args.fields ? selectFields(result as Record<string, unknown>, args.fields) : result;
        return args.truncate ? okTruncated(filtered, args.truncate) : ok(filtered);
      }
      const filtered = args.fields ? selectFields(ticket.data as Record<string, unknown>, args.fields) : ticket.data;
      return args.truncate ? okTruncated(filtered, args.truncate) : ok(filtered);
    }),
  );

  server.registerTool(
    "ticket_stats",
    {
      title: "Estadísticas de tickets",
      description: "Estadísticas globales de tickets (GET /tickets/stats).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async () => {
      const res = await client.get("/tickets/stats");
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_open_technical_tickets_count",
    {
      title: "Conteo de tickets técnicos abiertos",
      description:
        "GET /tickets/open-technical-count. Con accountId filtra por cuenta.",
      inputSchema: z.object({ accountId: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const params: Record<string, unknown> = {};
      if (args.accountId) params.accountId = args.accountId;
      const res = await client.get("/tickets/open-technical-count", params);
      return ok(res.data);
    }),
  );
}
