import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, wrapReadOnly, buildBody, okTruncated, truncateSchema, selectFields, fieldsSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
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
      title: "Actividades de ticket",
      description: "Actividades de un ticket.",
      inputSchema: z.object({
              id: z.string(),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get(`/activities/ticket/${args.id}`);
      return okTruncated(selectFields(res.data as Record<string, unknown>, args.fields as string[] | undefined), args.truncate);
    }),
  );

  server.registerTool(
    "get_activity_stats",
    {
      title: "Stats de actividades",
      description: "Stats de actividades.",
      inputSchema: z.object({
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const res = await client.get("/activities/stats");
      return okTruncated(res.data, args.truncate);
    }),
  );

  registerTool(
    server, role, "full", "mark_activity_read",
    {
      title: "Marcar leída (ESCRITURA)",
      description: "PATCH /activities/{id}/mark-as-read. Requiere confirm: true.",
      inputSchema: {
        activityId: z.string(),
        readAt: z
          .iso.datetime({ offset: true })
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
      title: "Marcar no leída (ESCRITURA)",
      description: "PATCH /activities/{id}/mark-as-unread. Requiere confirm: true.",
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
      description: "PATCH /activities/{id}. Requiere confirm: true.",
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
