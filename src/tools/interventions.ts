import type { GavrielClient } from "../gavrielClient.js";
import { ok, err } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
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
      title: "Listar intervenciones de una cuenta",
      description:
        "Lista intervenciones de una cuenta (GET /interventions/account/{id}); openOnly=true usa el endpoint de abiertas.",
      inputSchema: {
        id: z.string().describe("ID de la cuenta"),
        openOnly: z.boolean().default(false).describe("Solo intervenciones abiertas"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const path = args.openOnly
          ? `/interventions/account/${args.id}/open`
          : `/interventions/account/${args.id}`;
        const res = await client.get(path);
        return ok(res.data);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  registerTool(
    server, role, "full", "create_intervention",
    {
      title: "Crear intervención (ESCRITURA)",
      description:
        "Crea una intervención en progreso (POST /interventions). Requiere confirm: true. NOTA: el create simple no lleva motivo — el motivo es solo del cierre (resolution) o del masivo (reason).",
      inputSchema: {
        accountId: z.string().describe("ID de la cuenta a intervenir"),
        assignedUserId: z.string().optional().describe(
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
      title: "Procesar eventos pendientes en masa (ESCRITURA)",
      description:
        "POST /interventions/bulk: intervenciones masivas para varias cuentas con motivo y opcionalmente un tipo de evento. Flujo para procesar eventos pendientes en masa. Requiere confirm: true.",
      inputSchema: {
        accountIds: z.array(z.string()).min(1).describe("IDs de cuentas"),
        assignedUserId: z.string().describe("Usuario asignado"),
        reason: z.string().min(1).describe("Motivo de la intervención"),
        eventTypeId: z.string().optional().describe("ID del tipo de evento a procesar"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = {
        accountIds: args.accountIds,
        assignedUserId: args.assignedUserId,
        reason: args.reason,
      };
      if (args.eventTypeId) body.eventTypeId = args.eventTypeId;
      return requireConfirm(
        args.confirm,
        { tool: "create_bulk_interventions", method: "POST", path: "/interventions/bulk", params: body },
        client,
        () => client.post("/interventions/bulk", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "close_intervention",
    {
      title: "Cerrar intervención (ESCRITURA)",
      description:
        "Cierra intervención con categoría y resolución (PATCH /interventions/{id}); el backend crea/cierra el ticket asociado y marca eventos pendientes como procesados. Requiere confirm: true.",
      inputSchema: {
        interventionId: z.string(),
        categoryId: z.string().optional().describe("Categoría de cierre"),
        resolution: z.string().optional().describe("Resolución / motivo del cierre"),
        confirm: confirmSchema,
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const body: Record<string, unknown> = { currentStatus: "closed" };
      if (args.categoryId) body.categoryId = args.categoryId;
      if (args.resolution) body.resolution = args.resolution;
      return requireConfirm(
        args.confirm,
        { tool: "close_intervention", method: "PATCH", path: `/interventions/${args.interventionId}`, params: body },
        client,
        () => client.patch(`/interventions/${args.interventionId}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "set_intervention_observation",
    {
      title: "Poner intervención en observación (ESCRITURA)",
      description:
        "Pone una intervención en estado observation con comentario (PATCH /interventions/{id}). Requiere confirm: true.",
      inputSchema: {
        interventionId: z.string(),
        observationComment: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body: Record<string, unknown> = { currentStatus: "observation" };
      if (args.observationComment) body.observationComment = args.observationComment;
      return requireConfirm(
        args.confirm,
        { tool: "set_intervention_observation", method: "PATCH", path: `/interventions/${args.interventionId}`, params: body },
        client,
        () => client.patch(`/interventions/${args.interventionId}`, body),
      ).then(ok);
    },
  );
}
