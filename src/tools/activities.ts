import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, wrapReadOnly, buildBody } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const ACTIVITY_TYPES = [
  "MESSAGE",
  "TASK",
  "NOTIFICATION",
  "REMINDER",
  "ALERT",
  "UPDATE",
] as const;

export function registerActivityTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_activities_by_ticket",
    {
      title: "Listar actividades de ticket",
      description: "Actividades/comentarios de un ticket.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/activities/ticket/${args.id}`);
      return ok(res.data);
    }),
  );

  server.registerTool(
    "get_activity_stats",
    {
      title: "Estadísticas de actividades",
      description: "Estadísticas globales de actividades.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (_args) => {
      const res = await client.get("/activities/stats");
      return ok(res.data);
    }),
  );

  registerTool(
    server, role, "full", "mark_activity_read",
    {
      title: "Marcar actividad como leída (ESCRITURA)",
      description:
        "PATCH /activities/{id}/mark-as-read. Marca una actividad como leída. Requiere confirm: true.",
      inputSchema: {
        activityId: z.string(),
        readAt: z
          .string()
          .optional()
          .describe("ISO datetime de lectura (si no viene, usa la fecha actual)"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const body = { readAt: args.readAt ?? new Date().toISOString() };
      const path = `/activities/${args.activityId}/mark-as-read`;
      return requireConfirm(
        args.confirm,
        { tool: "mark_activity_read", method: "PATCH", path, params: body },
        client,
        () => client.patch(path, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "mark_activity_unread",
    {
      title: "Marcar actividad como no leída (ESCRITURA)",
      description:
        "PATCH /activities/{id}/mark-as-unread. Marca una actividad como no leída. Requiere confirm: true.",
      inputSchema: {
        activityId: z.string(),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const path = `/activities/${args.activityId}/mark-as-unread`;
      return requireConfirm(
        args.confirm,
        { tool: "mark_activity_unread", method: "PATCH", path, params: {} },
        client,
        () => client.patch(path, {}),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_activity",
    {
      title: "Actualizar actividad (ESCRITURA)",
      description:
        "PATCH /activities/{id}. Actualiza campos de una actividad (solo envía los provistos). Requiere confirm: true.",
      inputSchema: {
        activityId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        type: z.enum(ACTIVITY_TYPES).optional(),
        assignedUserId: z.string().optional().nullish(),
        ticketId: z.string().optional().nullish(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["title", "description", "type", "assignedUserId", "ticketId"],
      });
      const path = `/activities/${args.activityId}`;
      return requireConfirm(
        args.confirm,
        { tool: "update_activity", method: "PATCH", path, params: body },
        client,
        () => client.patch(path, body),
      ).then(ok);
    },
  );
}
