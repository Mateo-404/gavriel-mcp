import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig, logDir } from "./config.js";
import { GavrielClient } from "./gavrielClient.js";
import { buildServer } from "./server.js";
import { setLogDir, flushLogs } from "./auditLog.js";
import { startPoller } from "./notifications/poller.js";
import { setDestructiveApproval } from "./tools/writeHelpers.js";
import { readTotpSeed } from "./secrets.js";
import { totpFresh } from "./totp.js";

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
  // Con semilla TOTP guardada (gavriel totp set) el MCP renueva solo el dispositivo confiable.
  const client = new GavrielClient(config, {
    getTwoFactorCode: () => {
      const seed = readTotpSeed(config.GAVRIEL_EMAIL);
      return seed ? totpFresh(seed) : undefined;
    },
  });
  const server = buildServer(client, config.GAVRIEL_MCP_ROLE);
  server.server.registerCapabilities({ logging: {} });
  await server.connect(new StdioServerTransport());
  const stopPoller = startPoller(server, client);
  if (stopPoller) server.server.onclose = stopPoller;
  // Cierre ordenado: volcar la cola de logs de auditoría antes de salir.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      stopPoller?.();
      void flushLogs().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(`[gavriel-mcp] Error al iniciar:`, err);
  process.exit(1);
});
