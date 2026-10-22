// Build self-contained single-executable binaries via Node.js SEA.
//
// Produces two binaries from the same pipeline:
//   gavriel-mcp-<plat>-<arch>[.exe]  (entry dist/index.js, the MCP server)
//   gavriel-<plat>-<arch>[.exe]      (entry dist/cli.js, the `gavriel` CLI)
//
// Steps per binary:
//   1. esbuild bundles the dist entry + all deps into one CJS file (no
//      node_modules needed at runtime).
//   2. `node --experimental-sea-config` turns that bundle into a SEA blob.
//   3. We copy the Node binary and inject the blob with the LOCAL `postject`
//      (node_modules, version pinned by the lockfile; no npx download).
//
// The sources use import.meta.url (config.ts .env lookup, cli.ts version
// fallback). In CJS output esbuild would replace it with an empty object, so
// we `define` it to a banner-provided constant derived from __filename.
//
// esbuild and postject are BUILD-TIME ONLY. The final binary embeds Node
// (native, no third-party runtime dependency).
//
// Run with: pnpm build:bin   (after pnpm build)

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
mkdirSync("bin", { recursive: true });

const VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;
const plat = platform();
const arc = arch();
const ext = plat === "win32" ? ".exe" : "";
// Se ejecuta el JS de postject con node (sin shims .cmd ni shell: rutas con espacios en Windows).
const postject = resolve("node_modules", "postject", "dist", "cli.js");
if (!existsSync(postject)) throw new Error("postject no está instalado (pnpm install); no se usa npx.");

// 1.-3. for one entry/out pair.
async function buildBinary({ entry, bundle, outName }) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundle,
    define: { __GAVRIEL_VERSION__: JSON.stringify(VERSION), "import.meta.url": "__importMetaUrl" },
    banner: {
      js: 'const __importMetaUrl = require("node:url").pathToFileURL(typeof __filename === "string" ? __filename : process.execPath).href;',
    },
    logLevel: "info",
  });

  const blob = `bin/${outName}.sea-prep.blob`;
  const seaConfig = `bin/${outName}.sea-config.json`;
  writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

  const out = `bin/${outName}-${plat}-${arc}${ext}`;
  copyFileSync(process.execPath, out);
  if (plat === "darwin") {
    // macOS ships a signed node; remove the ad-hoc signature so postject can write.
    execFileSync("codesign", ["--remove-signature", out], { stdio: "inherit" });
  }
  execFileSync(
    process.execPath,
    [postject, out, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      ...(plat === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])],
    { stdio: "inherit" },
  );
  chmodSync(out, 0o755);
  console.log(`Built ${out} (${outName} v${VERSION})`);
}

await buildBinary({ entry: "dist/index.js", bundle: "bin/gavriel-mcp.cjs", outName: "gavriel-mcp" });
await buildBinary({ entry: "dist/cli.js", bundle: "bin/gavriel.cjs", outName: "gavriel" });
