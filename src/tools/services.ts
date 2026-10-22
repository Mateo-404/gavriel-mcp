import type { GavrielClient } from "../gavrielClient.js";
import { ok, okTruncated, truncateSchema, selectFields, wrapReadOnly, buildBody, fieldsSchema, idSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerServiceTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "get_service_panel",
    {
      title: "Obtener panel de servicios",
      description: "Usar cuando necesitás el panel completo de servicios (pendientes/agendados). Para solo totales ver get_service_panel_summary.",
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
      description: "Usar cuando solo necesitás los totales del panel de servicios. Para el detalle ver get_service_panel.",
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
      description: "Usar cuando necesitás la agenda de un técnico en una fecha (YYYY-MM-DD) para ver disponibilidad o agendar con schedule_service.",
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
      description: "Usar cuando ya tenés el ID de un servicio y querés su detalle. No usar para el panel general (ver get_service_panel).",
      inputSchema: z.object({
              id: z.string(),
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/services/${seg(args.id)}`);
      return ok(selectFields(res.data as Record<string, unknown>, args.fields));
    }),
  );

  registerTool(
    server, role, "full", "schedule_service",
    {
      title: "Agendar servicio",
      description: "PATCH /services/{id}/schedule con fecha de agendado. Requiere confirm: true.",
      inputSchema: {
        serviceId: idSchema,
        scheduledDate: z.string().describe("Fecha de agendado (ISO datetime)"),
        slotCount: z.number().int().optional().describe("Cantidad de slots"),
        assignedUserId: idSchema.optional().describe("Técnico asignado"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["scheduledDate"], optional: ["slotCount", "assignedUserId"] });
      return requireConfirm(
        args.confirm,
        { tool: "schedule_service", method: "PATCH", path: `/services/${seg(args.serviceId)}/schedule`, params: body },
        client,
        () => client.patch(`/services/${seg(args.serviceId)}/schedule`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_service",
    {
      title: "Actualizar servicio",
      description:
        "PATCH /services/{id} con los campos a modificar (solo envía los provistos). Requiere confirm: true.",
      inputSchema: {
        serviceId: idSchema,
        accountId: idSchema.optional(),
        type: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignedUserId: idSchema.optional(),
        categoryId: idSchema.optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["accountId", "type", "title", "description", "priority", "assignedUserId", "categoryId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_service", method: "PATCH", path: `/services/${seg(args.serviceId)}`, params: body },
        client,
        () => client.patch(`/services/${seg(args.serviceId)}`, body),
      ).then(ok);
    },
  );
}
