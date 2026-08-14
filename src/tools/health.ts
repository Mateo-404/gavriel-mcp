import type { GavrielClient } from "../gavrielClient.js";
import { ok, err } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "./roles.js";

export function registerHealthTools(server: McpServer, client: GavrielClient, _role: Role): void {
  server.registerTool(
    "health",
    {
      title: "Salud de monitoreo (conexiones y bridges)",
      description:
        "Devuelve los logs de salud de conexiones y bridges (GET /monitoring/connection-health-logs y /bridge-health-logs).",
      inputSchema: {
        bridgeId: z.string().optional().describe("Filtra los logs de salud del bridge"),
        connectionId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(25),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const connParams: Record<string, unknown> = { limit: args.limit };
        const bridgeParams: Record<string, unknown> = { limit: args.limit };
        if (args.connectionId) connParams.connectionId = args.connectionId;
        if (args.bridgeId) bridgeParams.bridgeId = args.bridgeId;
        const [connections, bridges] = await Promise.all([
          client.get("/monitoring/connection-health-logs", connParams),
          client.get("/monitoring/bridge-health-logs", bridgeParams),
        ]);
        return ok({ connections: connections.data, bridges: bridges.data });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
