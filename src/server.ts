import { McpServer } from "@modelcontextprotocol/server";
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
import { registerEventCatalogTools } from "./tools/eventCatalogs.js";
import { registerDeviceTools } from "./tools/devices.js";
import { registerSearchTools } from "./tools/search.js";
import { registerDashboardTools } from "./tools/dashboards.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerCatalogResources } from "./resources/catalogs.js";
import type { Role } from "./tools/roles.js";

declare const __GAVRIEL_VERSION__: string | undefined;
const VERSION = typeof __GAVRIEL_VERSION__ !== "undefined" ? __GAVRIEL_VERSION__ : "dev";

export function buildServer(client: GavrielClient, role: Role = "full"): McpServer {
  const server = new McpServer({ name: "gavriel-mcp", version: VERSION });

  registerTicketTools(server, client, role);
  registerEventTools(server, client, role);
  registerAccountTools(server, client, role);
  registerInterventionTools(server, client, role);
  registerAuditTools(server, client, role);
  registerHealthTools(server, client, role);
  registerConversationTools(server, client, role);
  registerMonitoringTools(server, client, role);
  registerServiceTools(server, client, role);
  registerOrgTools(server, client, role);
  registerActivityTools(server, client, role);
  registerRawGetTool(server, client, role);
  registerEventCatalogTools(server, client, role);
  registerDeviceTools(server, client, role);
  registerSearchTools(server, client);
  registerDashboardTools(server, client);
  registerBatchTools(server, client, role);
  registerCatalogResources(server, client, role);

  return server;
}
