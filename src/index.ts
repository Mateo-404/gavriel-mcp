import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, logDir } from "./config.js";
import { GavrielClient } from "./gavrielClient.js";
import { buildServer } from "./server.js";
import { setLogDir } from "./auditLog.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogDir(logDir(config));
  const client = new GavrielClient(config);
  const server = buildServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`[gavriel-mcp] Error al iniciar:`, err);
  process.exit(1);
});
