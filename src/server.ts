import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GavrielClient } from "./gavrielClient.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerEventTools } from "./tools/events.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerInterventionTools } from "./tools/interventions.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerHealthTools } from "./tools/health.js";
import { registerConversationTools } from "./tools/conversations.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerServiceTools } from "./tools/services.js";
import { registerOrgTools } from "./tools/org.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerRawGetTool } from "./tools/rawGet.js";
import { registerCatalogResources } from "./resources/catalogs.js";

export function buildServer(client: GavrielClient): McpServer {
  const server = new McpServer({ name: "gavriel-mcp", version: "1.0.0" });

  registerTicketTools(server, client);
  registerEventTools(server, client);
  registerAccountTools(server, client);
  registerInterventionTools(server, client);
  registerAuditTools(server, client);
  registerHealthTools(server, client);
  registerConversationTools(server, client);
  registerMonitoringTools(server, client);
  registerServiceTools(server, client);
  registerOrgTools(server, client);
  registerActivityTools(server, client);
  registerRawGetTool(server, client);
  registerCatalogResources(server, client);

  return server;
}
