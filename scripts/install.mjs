// Instalador desde el código fuente: compila, genera el ejecutable único (SEA, sin necesidad de Node ni pnpm en
// el equipo de destino) y lo instala con `gavriel install` (carpeta de usuario + PATH, sin admin).
//
// Uso:   pnpm run install:cli            # solo el comando `gavriel`
//        pnpm run install:mcp            # además registra el MCP en Claude Desktop
//        node scripts/install.mjs [--mcp] [--client desktop|code] [--dir <carpeta>] [--no-path] [--yes] [--dry-run]
//                                 [--skip-build] [--uninstall [--purge]]
// Por qué sin bun: el binario SEA ya trae su propio runtime; bun sumaría un segundo runtime y otro gestor de paquetes.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    mcp: { type: "boolean" }, client: { type: "string" }, dir: { type: "string" }, "no-path": { type: "boolean" },
    yes: { type: "boolean", short: "y" }, "dry-run": { type: "boolean" }, "skip-build": { type: "boolean" },
    uninstall: { type: "boolean" }, purge: { type: "boolean" }, force: { type: "boolean" }, profile: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log("Uso: node scripts/install.mjs [--mcp] [--client desktop|code] [--dir d] [--no-path] [-y] [--dry-run] [--skip-build] [--uninstall [--purge]]");
  process.exit(0);
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(`✘ ${[cmd, ...args].join(" ")} terminó con código ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

const exe = join(root, "bin", `gavriel-${platform()}-${arch()}${platform() === "win32" ? ".exe" : ""}`);
const newestSource = () => {
  let t = 0;
  for (const f of ["dist/cli.js", "dist/serve.js", "dist/cli/commands.js", "package.json"]) {
    const p = join(root, f);
    if (existsSync(p)) t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
};

if (!values["skip-build"] && !values.uninstall) {
  console.log("› Compilando…");
  run(process.execPath, [join(root, "node_modules", "typescript", "lib", "tsc.js"), "-p", "tsconfig.json"]);
  if (!existsSync(exe) || statSync(exe).mtimeMs < newestSource()) {
    console.log("› Generando el ejecutable único…");
    run(process.execPath, [join(root, "scripts", "build-bin.mjs")]);
  } else console.log("› Ejecutable al día, no se regenera.");
}
if (!existsSync(exe)) {
  console.error(`✘ No existe ${exe}. Ejecutá sin --skip-build (o: pnpm install && pnpm run build:bin).`);
  process.exit(1);
}

const args = [values.uninstall ? "uninstall" : "install"];
if (values.mcp && !values.uninstall) args.push("--register", values.client ?? "desktop");
for (const [flag, on] of [["--dir", values.dir], ["--profile", values.profile]]) if (on) args.push(flag, on);
for (const [flag, on] of [["--no-path", values["no-path"]], ["--yes", values.yes], ["--dry-run", values["dry-run"]], ["--purge", values.purge], ["--force", values.force]]) if (on) args.push(flag);
run(exe, args);
