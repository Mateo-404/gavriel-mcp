import type { GavrielClient } from "../gavrielClient.js";
import { ok, wrapReadOnly, okTruncated, truncateSchema, selectFields, fieldsSchema, idSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, seg, destructiveGuard, okOrInput } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const INTERVENTION_STATUSES = [
  "in_progress",
  "waiting",
  "transferred",
  "closed",
  "observation",
] as const;

export function registerInterventionTools(server: McpServer, client: GavrielClient, role: Role): void {
  server.registerTool(
    "list_interventions",
    {
      title: "Intervenciones de cuenta",
      description: "Usar cuando necesitás las intervenciones de una cuenta (todas o solo las abiertas). No usar para crearlas/cerrarlas (ver create_intervention / close_intervention).",
      inputSchema: z.object({
              id: z.string().describe("ID de la cuenta"),
              openOnly: z.boolean().default(false).describe("Solo intervenciones abiertas"),
              truncate: truncateSchema,
              fields: fieldsSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const path = args.openOnly
        ? `/interventions/account/${seg(args.id)}/open`
        : `/interventions/account/${seg(args.id)}`;
      const res = await client.get(path);
      return okTruncated(selectFields(Array.isArray(res.data) ? res.data : [], args.fields as string[] | undefined), args.truncate);
    }),
  );

  registerTool(
    server, role, "lite", "create_intervention",
    {
      title: "Crear intervención",
      description: "Usar para abrir una intervención sobre una cuenta (POST /interventions). No usar para varias cuentas (ver create_bulk_interventions).",
      inputSchema: {
        accountId: idSchema.describe("ID de la cuenta a intervenir"),
        assignedUserId: idSchema.optional().describe(
          "Usuario asignado. Si se omite, la API puede requerirlo — el frontend siempre lo envía.",
        ),
        currentStatus: z
          .enum(INTERVENTION_STATUSES)
          .default("in_progress")
          .describe("Estado inicial de la intervención"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = {
        accountId: args.accountId,
        ...(args.assignedUserId ? { assignedUserId: args.assignedUserId } : {}),
        currentStatus: args.currentStatus,
      };
      return requireConfirm(
        args.confirm,
        { tool: "create_intervention", method: "POST", path: "/interventions", params: body },
        client,
        () => client.post("/interventions", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "create_bulk_interventions",
    {
      title: "Intervenciones masivas",
      description: "Usar para abrir la misma intervención sobre varias cuentas (máx 50; POST /interventions/bulk). Destructiva: pide aprobación humana.",
      inputSchema: {
        accountIds: z.array(idSchema).min(1).max(50).describe("IDs de cuentas"),
        assignedUserId: idSchema.describe("Usuario asignado"),
        reason: z.string().min(1).describe("Motivo de la intervención"),
        eventTypeId: idSchema.optional().describe("ID del tipo de evento a procesar"),
        confirm: confirmSchema,
      },
    },
    async (args, ctx) => {
      const body: Record<string, unknown> = {
        accountIds: args.accountIds,
        assignedUserId: args.assignedUserId,
        reason: args.reason,
      };
      if (args.eventTypeId) body.eventTypeId = args.eventTypeId;
      const exec = { tool: "create_bulk_interventions", method: "POST", path: "/interventions/bulk", params: body };
      return requireConfirm(
        args.confirm,
        exec,
        client,
        () => client.post("/interventions/bulk", body),
        destructiveGuard("create_bulk_interventions", exec, ctx),
      ).then(okOrInput);
    },
  );

  registerTool(
    server, role, "lite", "close_intervention",
    {
      title: "Cerrar intervención",
      description: "Usar para dar por terminada una intervención (currentStatus=closed, con categoría/resolución opcionales). No usar para dejarla en observación (ver set_intervention_observation).",
      inputSchema: {
        interventionId: idSchema,
        categoryId: idSchema.optional().describe("Categoría de cierre"),
        resolution: z.string().optional().describe("Resolución / motivo del cierre"),
        confirm: confirmSchema,
      },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const body: Record<string, unknown> = { currentStatus: "closed" };
      if (args.categoryId) body.categoryId = args.categoryId;
      if (args.resolution) body.resolution = args.resolution;
      const exec = { tool: "close_intervention", method: "PATCH", path: `/interventions/${seg(args.interventionId)}`, params: body };
      return requireConfirm(
        args.confirm,
        exec,
        client,
        () => client.patch(`/interventions/${seg(args.interventionId)}`, body),
        destructiveGuard("close_intervention", exec, ctx),
      ).then(okOrInput);
    },
  );

  registerTool(
    server, role, "lite", "set_intervention_observation",
    {
      title: "Observación",
      description: "Usar para pasar una intervención a observación (currentStatus=observation) sin cerrarla, con comentario opcional. No usar para cerrarla (ver close_intervention).",
      inputSchema: {
        interventionId: idSchema,
        observationComment: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { currentStatus: "observation" };
      if (args.observationComment) body.observationComment = args.observationComment;
      return requireConfirm(
        args.confirm,
        { tool: "set_intervention_observation", method: "PATCH", path: `/interventions/${seg(args.interventionId)}`, params: body },
        client,
        () => client.patch(`/interventions/${seg(args.interventionId)}`, body),
      ).then(ok);
    },
  );
}
