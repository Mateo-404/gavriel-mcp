import type { GavrielClient } from "../gavrielClient.js";
import { wrapReadOnly, truncateSchema, okTruncated } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Role } from "./roles.js";

export function registerHealthTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "health",
    {
      title: "Salud de monitoreo",
      description: "Salud de conexiones y bridges.",
      inputSchema: z.object({
              bridgeId: z.string().optional().describe("Filtra los logs de salud del bridge"),
              connectionId: z.string().optional(),
              limit: z.number().int().min(1).max(200).default(25),
              include: z.array(z.enum(["connections", "bridges"])).optional().describe("Secciones (default: ambas)"),
              truncate: truncateSchema,
            }),
      annotations: { readOnlyHint: true },
    },
    wrapReadOnly(async (args) => {
      const wantConn = !args.include || args.include.includes("connections");
      const wantBridge = !args.include || args.include.includes("bridges");

      const [connRes, bridgeRes] = await Promise.all([
        wantConn
          ? client.get("/monitoring/connection-health-logs", {
              ...(args.connectionId ? { connectionId: args.connectionId } : {}),
              limit: args.limit,
            })
          : Promise.resolve(null),
        wantBridge
          ? client.get("/monitoring/bridge-health-logs", {
              ...(args.bridgeId ? { bridgeId: args.bridgeId } : {}),
              limit: args.limit,
            })
          : Promise.resolve(null),
      ]);

      const result: Record<string, unknown> = {};
      if (connRes) result.connections = connRes.data;
      if (bridgeRes) result.bridges = bridgeRes.data;
      return okTruncated(result, args.truncate);
    }),
  );
}
