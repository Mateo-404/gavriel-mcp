import type { GavrielClient } from "../gavrielClient.js";
import { ok } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerBatchTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "full", "bulk_close_tickets",
    {
      title: "Cerrar múltiples tickets (ESCRITURA)",
      description: "Cierra varios tickets en lote con la misma resolución. Requiere confirm: true.",
      inputSchema: {
        ticketIds: z.array(z.string()).min(1).describe("IDs de los tickets a cerrar"),
        resolution: z.string().min(1).describe("Resolución / comentario de cierre"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const exec = {
        tool: "bulk_close_tickets",
        method: "PATCH",
        path: args.ticketIds.map((id) => `/tickets/${id}/close`).join(", "),
        params: { count: args.ticketIds.length, resolution: args.resolution },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const results = [];
        for (const id of args.ticketIds) {
          try {
            const r = await client.patch(`/tickets/${id}/close`, { resolution: args.resolution });
            results.push({ id, status: r.status, ok: true });
          } catch (e) {
            results.push({ id, error: (e as Error).message, ok: false });
          }
        }
        return { status: 200, data: { results, summary: { total: args.ticketIds.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } } };
      }).then(ok);
    },
  );

  registerTool(
    server, role, "full", "bulk_process_events",
    {
      title: "Procesar múltiples eventos (ESCRITURA)",
      description: "Marca varios eventos como procesados en lote. Requiere confirm: true.",
      inputSchema: {
        eventIds: z.array(z.string()).min(1).describe("IDs de los eventos a procesar"),
        status: z.enum(["processed", "self-processed"]).default("processed").describe("Estado a asignar"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const exec = {
        tool: "bulk_process_events",
        method: "PATCH",
        path: args.eventIds.map((id) => `/events/${id}`).join(", "),
        params: { count: args.eventIds.length, status: args.status },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const results = [];
        for (const id of args.eventIds) {
          try {
            const r = await client.patch(`/events/${id}`, { status: args.status });
            results.push({ id, status: r.status, ok: true });
          } catch (e) {
            results.push({ id, error: (e as Error).message, ok: false });
          }
        }
        return { status: 200, data: { results, summary: { total: args.eventIds.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } } };
      }).then(ok);
    },
  );
}
