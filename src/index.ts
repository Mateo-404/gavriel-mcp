import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig, logDir } from "./config.js";
import { GavrielClient } from "./gavrielClient.js";
import { buildServer } from "./server.js";
import { setLogDir } from "./auditLog.js";
import { setDestructiveApproval } from "./tools/writeHelpers.js";

// Injected at bundle time by esbuild (see scripts/build-bin.mjs).
declare const __GAVRIEL_VERSION__: string | undefined;
const APP_VERSION = typeof __GAVRIEL_VERSION__ !== "undefined" ? __GAVRIEL_VERSION__ : "dev";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`gavriel-mcp ${APP_VERSION}`);
  process.exit(0);
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogDir(logDir(config));
  setDestructiveApproval(config.GAVRIEL_MCP_DESTRUCTIVE_APPROVAL);
  const client = new GavrielClient(config);
  const server = buildServer(client, config.GAVRIEL_MCP_ROLE);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`[gavriel-mcp] Error al iniciar:`, err);
  process.exit(1);
});
