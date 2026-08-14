import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, paginationSchema, okStructured } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const singleOrArray = z.union([z.string(), z.array(z.string())]).optional();

const ACTIVITY_TYPES = [
  "MESSAGE", "TASK", "NOTIFICATION", "REMINDER", "ALERT", "UPDATE",
] as const;

function addWriteTicketTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "full", "create_ticket",
    {
      title: "Crear ticket (ESCRITURA)",
      description:
        "POST /tickets. status y priority se validan contra catálogos (gavriel://catalog/tickets/*). La descripción se envía como texto/HTML. Requiere confirm: true.",
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
      const body: Record<string, unknown> = {
        title: args.title,
        priority: args.priority,
        status: args.status,
      };
      for (const f of ["description", "accountId", "categoryId", "assignedUserId"] as const) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined && v !== null) body[f] = v;
      }
      return requireConfirm(
        args.confirm,
        { tool: "create_ticket", method: "POST", path: "/tickets", params: body },
        client,
        () => client.post("/tickets", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_ticket",
    {
      title: "Actualizar ticket (ESCRITURA)",
      description:
        "PATCH /tickets/{id}. Solo envía los campos provistos. Para cerrar con resolución usar close_ticket. Requiere confirm: true.",
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
      const body: Record<string, unknown> = {};
      for (const f of ["title", "description", "priority", "status", "accountId", "categoryId", "assignedUserId", "resolution"] as const) {
        const v = (args as Record<string, unknown>)[f];
        if (v !== undefined && v !== null) body[f] = v;
      }
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
        "PATCH /tickets/{id}/close con resolución. Requiere confirm: true.",
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
      const body: Record<string, unknown> = {
        ticketId: args.ticketId,
        title: args.title,
        type: args.type,
      };
      if (args.description) body.description = args.description;
      if (args.assignedUserId) body.assignedUserId = args.assignedUserId;
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
        "Lista tickets de Gavriel con filtros. El sistema tiene +170.000 tickets: siempre acotar con filtros o paginación chica. Respuesta: { data, meta.pagination }.",
      inputSchema: {
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
      },
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const params: Record<string, unknown> = {
          page: args.page,
          limit: args.limit,
          sortBy: "createdAt",
          sortDirection: "desc",
        };
        for (const k of ["search", "status", "priority", "accountSearch", "accountId", "categoryId", "assignedUserId"] as const) {
          const v = (args as Record<string, unknown>)[k];
          if (v !== undefined) params[k] = v;
        }
        const res = await client.get("/tickets", params);
        return okStructured(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Obtener ticket por ID",
      description: "Devuelve el ticket y sus actividades (comentarios) asociadas.",
      inputSchema: { id: z.string().describe("ID del ticket") },
      outputSchema: z.object({}).passthrough(),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const [ticket, activities] = await Promise.all([
          client.get(`/tickets/${args.id}`),
          client.get(`/activities/ticket/${args.id}`),
        ]);
        return okStructured({ ticket: ticket.data, activities: activities.data });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "ticket_stats",
    {
      title: "Estadísticas de tickets",
      description: "Estadísticas globales de tickets (GET /tickets/stats).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const res = await client.get("/tickets/stats");
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_open_technical_tickets_count",
    {
      title: "Conteo de tickets técnicos abiertos",
      description:
        "GET /tickets/open-technical-count. Con accountId filtra por cuenta.",
      inputSchema: { accountId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const params: Record<string, unknown> = {};
        if (args.accountId) params.accountId = args.accountId;
        const res = await client.get("/tickets/open-technical-count", params);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
