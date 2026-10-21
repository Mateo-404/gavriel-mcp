import type { GavrielClient } from "../gavrielClient.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, runBatch, destructiveGuard, okOrInput, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const idList = (what: string) =>
  z.array(z.string().regex(/^[\w-]+$/, "id inválido")).min(1).max(50).describe(what);

export function registerBatchTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "full", "bulk_close_tickets",
    {
      title: "Cerrar múltiples tickets (ESCRITURA)",
      description: "Cierra varios tickets en lote (máx 50) con la misma resolución. Requiere confirm: true.",
      inputSchema: {
        ticketIds: idList("IDs de los tickets a cerrar"),
        resolution: z.string().min(1).describe("Resolución / comentario de cierre"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args, ctx) => {
      const exec = {
        tool: "bulk_close_tickets",
        method: "PATCH",
        path: args.ticketIds.map((id) => `/tickets/${seg(id)}/close`).join(", "),
        params: { count: args.ticketIds.length, resolution: args.resolution },
      };
      // runBatch = Promise.all con orden estable; la concurrencia real la limita el semáforo de escrituras del cliente.
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          args.ticketIds.map((id) => ({ id, run: (signal) => client.patch(`/tickets/${seg(id)}/close`, { resolution: args.resolution }, signal) })),
          ctx,
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_close_tickets", exec, ctx)).then(okOrInput);
    },
  );

  registerTool(
    server, role, "full", "bulk_process_events",
    {
      title: "Procesar múltiples eventos (ESCRITURA)",
      description: "Marca varios eventos (máx 50) como procesados en lote. Requiere confirm: true.",
      inputSchema: {
        eventIds: idList("IDs de los eventos a procesar"),
        status: z.enum(["processed", "self-processed"]).default("processed").describe("Estado a asignar"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args, ctx) => {
      const exec = {
        tool: "bulk_process_events",
        method: "PATCH",
        path: args.eventIds.map((id) => `/events/${seg(id)}`).join(", "),
        params: { count: args.eventIds.length, status: args.status },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          args.eventIds.map((id) => ({ id, run: (signal) => client.patch(`/events/${seg(id)}`, { status: args.status }, signal) })),
          ctx,
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_process_events", exec, ctx)).then(okOrInput);
    },
  );
}
