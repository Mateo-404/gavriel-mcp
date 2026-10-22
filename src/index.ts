#!/usr/bin/env node
import { serve } from "./serve.js";

// Injected at bundle time by esbuild (see scripts/build-bin.mjs).
declare const __GAVRIEL_VERSION__: string | undefined;
const APP_VERSION = typeof __GAVRIEL_VERSION__ !== "undefined" ? __GAVRIEL_VERSION__ : "dev";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`gavriel-mcp ${APP_VERSION}`);
  process.exit(0);
}

serve().catch((err) => {
  console.error("[gavriel-mcp] Error al iniciar:", err);
  process.exit(1);
});
