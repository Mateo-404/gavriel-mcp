import type { GavrielClient } from "../gavrielClient.js";
import { ok, okTruncated, truncateSchema, selectFields, wrapReadOnly, buildBody, fieldsSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerServiceTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "get_service_panel",
    {
      title: "Obtener panel de servicios",
      description: "Panel de servicios.",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/services/panel");
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "get_service_panel_summary",
    {
      title: "Obtener resumen del panel de servicios",
      description: "Resumen del panel.",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/services/panel/summary");
      return okTruncated(res.data, args.truncate);
    }),
  );

  server.registerTool(
    "list_technician_agenda",
    {
      title: "Listar agenda de técnicos",
      description: "Agenda del técnico.",
      inputSchema: z.object({
              userId: z.string(),
              date: z.iso.date().describe("Fecha (YYYY-MM-DD)"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/services/technician-agenda", {
        userId: args.userId,
        date: args.date,
      });
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields), args.truncate);
    }),
  );

  server.registerTool(
    "get_service",
    {
      title: "Obtener servicio",
      description: "Servicio por ID.",
      inputSchema: z.object({
              id: z.string(),
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/services/${args.id}`);
      return ok(selectFields(res.data as Record<string, unknown>, args.fields));
    }),
  );

  registerTool(
    server, role, "full", "schedule_service",
    {
      title: "Agendar servicio (ESCRITURA)",
      description: "PATCH /services/{id}/schedule con fecha de agendado. Requiere confirm: true.",
      inputSchema: {
        serviceId: z.string(),
        scheduledDate: z.string().describe("Fecha de agendado (ISO datetime)"),
        slotCount: z.number().int().optional().describe("Cantidad de slots"),
        assignedUserId: z.string().optional().describe("Técnico asignado"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["scheduledDate"], optional: ["slotCount", "assignedUserId"] });
      return requireConfirm(
        args.confirm,
        { tool: "schedule_service", method: "PATCH", path: `/services/${args.serviceId}/schedule`, params: body },
        client,
        () => client.patch(`/services/${args.serviceId}/schedule`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_service",
    {
      title: "Actualizar servicio (ESCRITURA)",
      description:
        "PATCH /services/{id} con los campos a modificar (solo envía los provistos). Requiere confirm: true.",
      inputSchema: {
        serviceId: z.string(),
        accountId: z.string().optional(),
        type: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignedUserId: z.string().optional(),
        categoryId: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["accountId", "type", "title", "description", "priority", "assignedUserId", "categoryId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_service", method: "PATCH", path: `/services/${args.serviceId}`, params: body },
        client,
        () => client.patch(`/services/${args.serviceId}`, body),
      ).then(ok);
    },
  );
}
