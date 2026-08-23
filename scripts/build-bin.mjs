// Build a self-contained single-executable binary via Node.js SEA.
//
// Steps:
//   1. esbuild bundles dist/index.js + all deps into one ESM file (no
//      node_modules needed at runtime).
//   2. `node --experimental-sea-config` turns that bundle into a SEA blob.
//   3. We copy the Node binary and inject the blob with `postject`.
//
// esbuild and postject are BUILD-TIME ONLY. The final binary embeds Node
// (native, no third-party runtime dependency) — consistent with the
// project's "no risky runtime deps" stance (see pkg deprecation/CVE note).
//
// Run with: pnpm build:bin   (after pnpm build)

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from "node:fs";
import { platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
mkdirSync("bin", { recursive: true });

const VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;

// 1. Bundle everything into one CJS file.
//    CJS is the most battle-tested SEA target. The app uses no import.meta,
//    so transpiling ESM -> CJS is safe (esbuild handles interop).
await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "bin/gavriel-mcp.cjs",
  define: { __GAVRIEL_VERSION__: JSON.stringify(VERSION) },
  logLevel: "info",
});

// 2. SEA config + blob.
writeFileSync(
  "sea-config.json",
  JSON.stringify({
    main: "bin/gavriel-mcp.cjs",
    output: "bin/sea-prep.blob",
    disableExperimentalSEAWarning: true,
  }),
);
execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { stdio: "inherit" });

// 3. Copy Node and inject the blob.
const plat = platform();
const arc = arch();
const ext = plat === "win32" ? ".exe" : "";
const out = `bin/gavriel-mcp-${plat}-${arc}${ext}`;
copyFileSync(process.execPath, out);

if (plat === "darwin") {
  // macOS ships a signed node; remove the ad-hoc signature so postject can write.
  execFileSync("codesign", ["--remove-signature", out], { stdio: "inherit" });
}

execFileSync(
  "npx",
  [
    "--yes",
    "postject",
    out,
    "NODE_SEA_BLOB",
    "bin/sea-prep.blob",
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit" },
);

chmodSync(out, 0o755);
console.log(`Built ${out} (gavriel-mcp v${VERSION})`);