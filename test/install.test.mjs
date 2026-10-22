import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// End-to-end con el ejecutable único real (SEA): instalación, registro en 3 clientes MCP, servidor y desinstalación.
// Todo aislado en un directorio temporal; nunca toca el PATH real (--no-path) ni los archivos de config del usuario.
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXT = platform() === "win32" ? ".exe" : "";
const BIN = join(ROOT, "bin", `gavriel-${platform()}-${arch()}${EXT}`);
const HAVE_BIN = existsSync(BIN);
const opts = { skip: HAVE_BIN ? false : "falta bin/ (pnpm run build:bin)" };

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-inst-"));
  const files = { desktop: join(dir, "claude", "claude_desktop_config.json"), codex: join(dir, "codex", "config.toml"), opencode: join(dir, "oc", "opencode.json") };
  const env = {
    ...process.env,
    HOME: join(dir, "home"), USERPROFILE: join(dir, "home"), APPDATA: join(dir, "appdata"), LOCALAPPDATA: join(dir, "local"),
    GAVRIEL_CONFIG_DIR: join(dir, "cfg"), GAVRIEL_CLAUDE_DESKTOP_CONFIG: files.desktop, GAVRIEL_CODEX_CONFIG: files.codex,
    GAVRIEL_OPENCODE_CONFIG: files.opencode, GAVRIEL_PLAIN: "1", GAVRIEL_NO_ANIM: "1", GAVRIEL_ALLOW_PLAINTEXT: "1",
    GAVRIEL_INSTALL_DIR: "", GAVRIEL_PROFILE: "", GAVRIEL_EMAIL: "",
  };
  const run = (exe, args, extra = {}) => spawnSync(exe, args, { env: { ...env, ...extra }, encoding: "utf8", timeout: 60000, windowsHide: true });
  return { dir, files, env, run, inst: join(dir, "Gavriel"), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const exeIn = (d) => join(d, `gavriel${EXT}`);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

test("install: copia el ejecutable, lo verifica y es idempotente (--no-path)", opts, () => {
  const s = sandbox();
  try {
    const r = s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /instalado en/);
    assert.match(r.stdout, /verificado: gavriel \d+\.\d+\.\d+/);
    assert.ok(existsSync(exeIn(s.inst)));
    assert.match(s.run(exeIn(s.inst), ["--version"]).stdout, /^gavriel \d/);
    const again = s.run(exeIn(s.inst), ["install", "--yes", "--no-path", "--dir", s.inst]); // desde el instalado, sobre sí mismo
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /ya estaba instalado/);
    const reinstall = s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst]); // otra copia encima
    assert.equal(reinstall.status, 0, reinstall.stderr);
    assert.ok(readdirSync(s.inst).every((f) => !f.includes(".new-")), "sin temporales");
  } finally {
    s.done();
  }
});

test("install --dry-run no crea nada; sin --yes y sin terminal falla claro; fuera del binario se niega", opts, () => {
  const s = sandbox();
  try {
    const dry = s.run(BIN, ["install", "--dry-run", "--no-path", "--dir", s.inst]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!existsSync(s.inst), "dry-run no crea la carpeta");
    const noYes = spawnSync(BIN, ["install", "--no-path", "--dir", s.inst], { env: s.env, encoding: "utf8", input: "", timeout: 30000 });
    assert.equal(noYes.status, 1);
    assert.match(noYes.stderr, /--yes/);
    const viaNode = spawnSync(process.execPath, [join(ROOT, "dist", "cli.js"), "install", "--yes", "--dir", s.inst], { env: s.env, encoding: "utf8" });
    assert.equal(viaNode.status, 1);
    assert.match(viaNode.stderr, /desde el binario/);
  } finally {
    s.done();
  }
});

function seedConfigs(s) {
  mkdirSync(join(s.dir, "claude"), { recursive: true });
  mkdirSync(join(s.dir, "codex"), { recursive: true });
  mkdirSync(join(s.dir, "oc"), { recursive: true });
  writeFileSync(s.files.desktop, JSON.stringify({ theme: "dark", mcpServers: { otro: { command: "npx", args: ["x"] } } }, null, 2));
  writeFileSync(s.files.codex, '# preferencias\nmodel = "o3"\n\n[mcp_servers.otro]\ncommand = "npx"\nargs = ["-y", "x"]\n\n[mcp_servers.otro.env]\nK = "v"\n');
  writeFileSync(s.files.opencode, JSON.stringify({ $schema: "https://opencode.ai/config.json", theme: "x", mcp: { otro: { type: "local", command: ["npx", "x"] } } }, null, 2));
}

function pythonToml(file) { // valida el TOML con un parser real si hay Python 3.11+
  const r = spawnSync("python", ["-c", "import sys,json,tomllib;print(json.dumps(tomllib.load(open(sys.argv[1],'rb'))))", file], { encoding: "utf8" });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

test("install --register all: escribe Claude Desktop, Codex y OpenCode sin pisar lo existente; uninstall lo deja como estaba", opts, () => {
  const s = sandbox();
  try {
    seedConfigs(s);
    const before = { desktop: readFileSync(s.files.desktop, "utf8"), codex: readFileSync(s.files.codex, "utf8"), opencode: readFileSync(s.files.opencode, "utf8") };
    assert.equal(s.run(BIN, ["profile", "add", "demo", "--email", "demo@x.test", "--role", "lite"]).status, 0);

    const r = s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst, "--register", "all"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const installed = exeIn(s.inst);

    const desk = readJson(s.files.desktop);
    assert.equal(desk.theme, "dark");
    assert.deepEqual(desk.mcpServers.otro, { command: "npx", args: ["x"] });
    assert.deepEqual(desk.mcpServers.gavriel, { command: installed, args: ["mcp", "serve"], env: { GAVRIEL_PROFILE: "demo", GAVRIEL_MCP_ROLE: "lite" } });

    const oc = readJson(s.files.opencode);
    assert.equal(oc.theme, "x");
    assert.deepEqual(oc.mcp.otro, { type: "local", command: ["npx", "x"] });
    assert.deepEqual(oc.mcp.gavriel, { type: "local", command: [installed, "mcp", "serve"], environment: { GAVRIEL_PROFILE: "demo", GAVRIEL_MCP_ROLE: "lite" }, enabled: true });

    const toml = readFileSync(s.files.codex, "utf8");
    assert.ok(toml.startsWith(before.codex.trimEnd()), "Codex conserva comentarios y tablas previas");
    const parsed = pythonToml(s.files.codex);
    if (parsed) {
      assert.equal(parsed.model, "o3");
      assert.equal(parsed.mcp_servers.otro.env.K, "v");
      assert.equal(parsed.mcp_servers.gavriel.command, installed);
      assert.deepEqual(parsed.mcp_servers.gavriel.args, ["mcp", "serve"]);
      assert.deepEqual(parsed.mcp_servers.gavriel.env, { GAVRIEL_PROFILE: "demo", GAVRIEL_MCP_ROLE: "lite" });
    }
    for (const dir of ["claude", "codex", "oc"]) assert.ok(readdirSync(join(s.dir, dir)).some((f) => f.includes(".bak-")), `backup en ${dir}`);

    // Reinstalar sin --force no pisa la entrada existente (avisa) y no rompe nada
    const again = s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst, "--register", "all"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout + again.stderr, /--force/);

    // Desinstalar: quita binario y entradas de los 3 clientes; el resto queda igual
    const un = s.run(BIN, ["uninstall", "--yes", "--dir", s.inst]);
    assert.equal(un.status, 0, un.stderr + un.stdout);
    assert.ok(!existsSync(installed), "binario borrado");
    assert.ok(!existsSync(s.inst), "carpeta vacía borrada");
    assert.deepEqual(readJson(s.files.desktop), JSON.parse(before.desktop));
    assert.deepEqual(readJson(s.files.opencode), JSON.parse(before.opencode));
    assert.equal(readFileSync(s.files.codex, "utf8").trimEnd(), before.codex.trimEnd());
    assert.ok(existsSync(join(s.dir, "cfg", "profiles.json")), "sin --purge se conservan las cuentas");
  } finally {
    s.done();
  }
});

test("install --register sin cuenta avisa y no escribe; mcp install/uninstall por cliente", opts, () => {
  const s = sandbox();
  try {
    const r = s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst, "--register", "codex"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gavriel login/);
    assert.ok(!existsSync(s.files.codex));

    assert.equal(s.run(BIN, ["profile", "add", "demo", "--email", "demo@x.test"]).status, 0);
    const dry = s.run(BIN, ["mcp", "install", "--client", "codex,opencode", "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Codex/);
    assert.match(dry.stdout, /OpenCode/);
    assert.ok(!existsSync(s.files.codex) && !existsSync(s.files.opencode));
    assert.equal(s.run(BIN, ["mcp", "install", "--client", "opencode", "--yes"]).status, 0);
    assert.ok(readJson(s.files.opencode).mcp.gavriel);
    assert.equal(s.run(BIN, ["mcp", "uninstall", "--client", "opencode", "--yes"]).status, 0);
    assert.deepEqual(readJson(s.files.opencode).mcp, {});
    assert.equal(s.run(BIN, ["mcp", "install", "--client", "vscode"]).status, 1);
  } finally {
    s.done();
  }
});

test("el ejecutable instalado sirve el MCP por stdio (mcp serve) sin ruido en stdout", opts, async () => {
  const s = sandbox();
  try {
    assert.equal(s.run(BIN, ["install", "--yes", "--no-path", "--dir", s.inst]).status, 0);
    const transport = new StdioClientTransport({
      command: exeIn(s.inst), args: ["mcp", "serve"], stderr: "pipe",
      env: { ...s.env, GAVRIEL_EMAIL: "x@test.invalid", GAVRIEL_PASSWORD: "x", GAVRIEL_API_BASE: "https://localhost:9" },
    });
    const client = new Client({ name: "install-test", version: "0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      assert.ok(tools.tools.length > 200, `tools: ${tools.tools.length}`);
      assert.ok(tools.tools.some((t) => t.name === "create_ticket"));
      assert.ok((await client.listPrompts()).prompts.length >= 5);
    } finally {
      await client.close();
    }
  } finally {
    s.done();
  }
});

test("install.ps1: descarga, verifica SHA-256 y instala; un hash alterado aborta sin instalar", { skip: !HAVE_BIN || platform() !== "win32" ? "solo Windows con bin/" : false }, async () => {
  const s = sandbox();
  const name = `gavriel-win32-${arch() === "arm64" ? "arm64" : "x64"}.exe`;
  const data = readFileSync(BIN);
  const good = createHash("sha256").update(data).digest("hex");
  let hash = good;
  const server = http.createServer((req, res) => {
    if (req.url === `/${name}`) return res.end(data);
    if (req.url === `/${name}.sha256`) return res.end(`${hash}  ${name}\n`);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Asíncrono: el servidor HTTP vive en este proceso y un spawnSync lo dejaría sin atender el pedido (deadlock).
  const ps = (...a) => new Promise((done) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "install.ps1"), ...a], { env: s.env, encoding: "utf8", timeout: 120000 },
    (err, stdout, stderr) => done({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));
  try {
    hash = "0".repeat(64);
    const bad = await ps("-BaseUrl", base, "-Dir", s.inst, "-NoPath");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr + bad.stdout, /SHA-256 no coincide/);
    assert.ok(!existsSync(s.inst), "no se instala con hash incorrecto");

    hash = good;
    const ok = await ps("-BaseUrl", base, "-Dir", s.inst, "-NoPath");
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /OK SHA-256 verificado/);
    assert.match(s.run(exeIn(s.inst), ["--version"]).stdout, /^gavriel \d/);

    const un = await ps("-BaseUrl", base, "-Dir", s.inst, "-Uninstall");
    assert.equal(un.status, 0, un.stderr + un.stdout);
    assert.ok(!existsSync(exeIn(s.inst)));
  } finally {
    await new Promise((r) => server.close(r));
    s.done();
  }
});
