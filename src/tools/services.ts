import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, wrapReadOnly, buildBody } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerServiceTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "get_service_panel",
    {
      title: "Obtener panel de servicios",
      description: "GET /services/panel.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async () => {
      const res = await client.get("/services/panel");
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_service_panel_summary",
    {
      title: "Obtener resumen del panel de servicios",
      description: "GET /services/panel/summary.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async () => {
      const res = await client.get("/services/panel/summary");
      return ok(res.data);
    }),
  );

  server.registerTool(
    "list_technician_agenda",
    {
      title: "Listar agenda de técnicos",
      description: "GET /services/technician-agenda con userId y fecha.",
      inputSchema: {
        userId: z.string(),
        date: z.string().describe("Fecha (ISO 8601)"),
      },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/services/technician-agenda", {
        userId: args.userId,
        date: args.date,
      });
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_service",
    {
      title: "Obtener servicio",
      description: "GET /services/{id}.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/services/${args.id}`);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_technician_locations",
    {
      title: "Obtener ubicaciones de técnicos",
      description: "GET /technician-locations/latest.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async () => {
      const res = await client.get("/technician-locations/latest");
      return ok(res.data);
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
