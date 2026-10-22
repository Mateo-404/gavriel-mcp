import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { base32Decode, totp, parseSeedInput } from "../dist/totp.js";
import { loadConfig } from "../dist/config.js";
import { GavrielClient } from "../dist/gavrielClient.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const SERVER = join(ROOT, "dist", "index.js");
// Los secretos van a DPAPI (APPDATA) o libsecret; los tests de login solo corren donde se puede aislar el almacén.
const SECRETS_ISOLATED = process.platform === "win32";

// RFC 6238 apéndice B (SHA-1): secreto ASCII "12345678901234567890", 8 dígitos 94287082 en t=59 → 6 dígitos 287082.
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "gavriel-cli-"));
  dirs.push(d);
  return d;
}

// Los tests in-process del cliente guardan el trusted token: que no toquen el almacén real del usuario.
const ISO_KEYS = ["APPDATA", "HOME", "USERPROFILE", "GAVRIEL_ALLOW_PLAINTEXT"];
const isoPrev = Object.fromEntries(ISO_KEYS.map((k) => [k, process.env[k]]));
const isoDir = tmp();
Object.assign(process.env, { APPDATA: isoDir, HOME: isoDir, USERPROFILE: isoDir, GAVRIEL_ALLOW_PLAINTEXT: "1" });
after(() => {
  for (const k of ISO_KEYS) {
    if (isoPrev[k] === undefined) delete process.env[k];
    else process.env[k] = isoPrev[k];
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Entorno aislado: config, APPDATA/HOME temporales y sin credenciales heredadas.
function envFor(dir, extra = {}) {
  return {
    ...process.env,
    GAVRIEL_CONFIG_DIR: dir, GAVRIEL_PROFILE: "", GAVRIEL_EMAIL: "", GAVRIEL_PASSWORD: "", GAVRIEL_ALLOW_PLAINTEXT: "1",
    APPDATA: dir, HOME: dir, USERPROFILE: dir, ...extra,
  };
}

function cli(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { env: envFor(dir), encoding: "utf8" });
}

function cliIn(dir, input, args, extra) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: envFor(dir, extra), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
    p.stdin.end(input);
  });
}

// API falsa de Gavriel: password "good" entra, cualquier otro es 401.
async function mockApi() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method !== "POST") return res.end("{}");
      const { email, password } = JSON.parse(body || "{}");
      if (password === "good") return res.end(JSON.stringify({ access_token: "a.b.c", trusted_device_token: "t", user: { email } }));
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "Credenciales inválidas" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}/api`, close: () => new Promise((r) => server.close(r)) };
}

const readStore = (dir) => JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8"));

test("totp: vectores RFC 6238", () => {
  assert.equal(totp(RFC_SEED, 59_000), "287082");
  assert.equal(totp(RFC_SEED, 1111111109_000), "081804");
  assert.equal(totp(RFC_SEED, 1234567890_000), "005924");
});

test("totp: base32 y URI otpauth", () => {
  assert.equal(base32Decode(RFC_SEED).toString("ascii"), "12345678901234567890");
  assert.equal(parseSeedInput("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq"), RFC_SEED);
  assert.equal(parseSeedInput(`otpauth://totp/Gavriel:x@y?secret=${RFC_SEED}&issuer=Gavriel`), RFC_SEED);
  assert.throws(() => parseSeedInput("no es base32 !!"));
  assert.throws(() => parseSeedInput("otpauth://totp/x?issuer=y"));
});

test("cli: --version (de package.json), --help y comando desconocido", () => {
  const dir = tmp();
  const v = cli(dir, "--version");
  assert.equal(v.stdout.trim(), `gavriel ${JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version}`);
  assert.equal(cli(dir, "--help").status, 0);
  const bad = cli(dir, "nope");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Comando desconocido/);
  assert.equal(cli(dir, "constructor").status, 2); // no es un comando heredado del prototipo
  assert.equal(cli(dir, "--flag-inexistente").status, 2);
});

test("cli: CRUD de perfiles sin secretos en el JSON", () => {
  const dir = tmp();
  assert.equal(cli(dir, "profile", "add", "a", "--email", "a@x.com", "--role", "readonly").status, 0);
  assert.equal(cli(dir, "profile", "add", "b", "--email", "b@x.com").status, 0);
  assert.equal(cli(dir, "profile", "use", "b").status, 0);
  assert.equal(cli(dir, "profile", "rename", "b", "c").status, 0);
  const store = readStore(dir);
  assert.equal(store.active, "c");
  assert.deepEqual(Object.keys(store.profiles).sort(), ["a", "c"]);
  assert.equal(store.profiles.a.role, "readonly");
  assert.doesNotMatch(JSON.stringify(store), /password|seed|token/i);
  assert.equal(cli(dir, "profile", "remove", "c").status, 0);
  assert.equal(readStore(dir).active, "a");
  assert.equal(cli(dir, "profile", "add", "../mal", "--email", "x@x.com").status, 1); // nombre inválido
  assert.equal(cli(dir, "profile", "use", "inexistente").status, 1);
});

test("cli: nombres reservados y lookups heredados del prototipo", () => {
  const dir = tmp();
  for (const name of ["__proto__", "constructor", "prototype"]) {
    assert.equal(cli(dir, "profile", "add", name, "--email", "x@x.com").status, 1, name);
  }
  assert.equal(cli(dir, "profile", "use", "constructor").status, 1);
  assert.equal(cli(dir, "profile", "remove", "toString").status, 1);
  assert.equal(cli(dir, "whoami", "-p", "constructor").status, 1);
});

test("cli: validación de flags (exit codes)", () => {
  const dir = tmp();
  for (const bad of ["0", "-1", "500", "abc", "1.5"]) assert.equal(cli(dir, "tickets", `--limit=${bad}`).status, 1, `limit ${bad}`);
  const add = (...a) => cli(dir, "profile", "add", "z", "--email", "z@x.com", ...a);
  assert.equal(add("--role", "root").status, 1);
  assert.equal(add("--toolsets", "core,bogus").status, 1);
  assert.equal(add("--api-base", "http://evil.example.com/api").status, 1);
  assert.equal(add("--api-base", "ftp://x").status, 1);
  assert.equal(add("--api-base", "no-url").status, 1);
  assert.equal(add("--role", "lite", "--toolsets", "core,video").status, 0);
  assert.equal(cli(dir, "-p", "a", "-p", "b", "whoami").status, 2);
  assert.equal(cli(dir, "--profile=a", "-p", "b", "whoami").status, 2);
  const noVal = cli(dir, "whoami", "-p");
  assert.equal(noVal.status, 2);
  assert.doesNotMatch(noVal.stderr, /Uso: gavriel <comando>/); // error corto, no la ayuda completa
});

test("cli: stdin cerrado no sale con 0 en silencio", () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, [CLI, "login", "--email", "a@x.com"], { env: envFor(dir), input: "", encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Entrada cerrada/);
  assert.equal(existsSync(join(dir, "profiles.json")), false);
});

test("cli: login por pipe, sin eco, y no pisa nada si falla", { skip: !SECRETS_ISOLATED }, async () => {
  const dir = tmp();
  const api = await mockApi();
  try {
    const ok = await cliIn(dir, "pipe@x.com\ngood\n", ["login", "--api-base", api.base]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Sesión iniciada como pipe@x\.com/);
    assert.doesNotMatch(ok.stdout, /good/); // ni el password ni su eco van a stdout
    assert.equal(readStore(dir).profiles.pipe.email, "pipe@x.com");

    // password malo sobre un perfil existente: falla y conserva el anterior
    const bad = await cliIn(dir, "wrong\n", ["login", "--email", "pipe@x.com", "--api-base", api.base]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Login falló/);
    const doc = await cliIn(dir, "", ["doctor"]);
    assert.match(doc.stdout, /OK\s+Password guardado/);

    // login fallido de un perfil nuevo no deja nada
    const dir2 = tmp();
    const bad2 = await cliIn(dir2, "wrong\n", ["login", "--email", "nuevo@x.com", "--api-base", api.base]);
    assert.equal(bad2.status, 1);
    assert.equal(existsSync(join(dir2, "profiles.json")), false);
  } finally {
    await api.close();
  }
});

test("cli: login rechaza pisar un perfil de otro email salvo --profile explícito", () => {
  const dir = tmp();
  cli(dir, "profile", "add", "juan", "--email", "juan@uno.com");
  const r = spawnSync(process.execPath, [CLI, "login", "--email", "juan@dos.com"], { env: envFor(dir), input: "good\n", encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /otro email/);
  assert.equal(readStore(dir).profiles.juan.email, "juan@uno.com");
});

test("cli: doctor omite el login sin --online y lo ejecuta con --online", { skip: !SECRETS_ISOLATED }, async () => {
  const dir = tmp();
  const api = await mockApi();
  try {
    assert.equal((await cliIn(dir, "doc@x.com\ngood\n", ["login", "--api-base", api.base])).status, 0);
    const off = await cliIn(dir, "", ["doctor"]);
    assert.match(off.stdout, /Sesión: omitida \(use --online\)/);
    assert.equal(off.status, 0, off.stdout);
    const on = await cliIn(dir, "", ["doctor", "--online"]);
    assert.match(on.stdout, /OK\s+Sesión/);
  } finally {
    await api.close();
  }
});

test("cli: doctor sin perfil informa FALLA y sale 1 (sin stack)", () => {
  const dir = tmp();
  const r = cli(dir, "doctor");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FALLA/);
  assert.doesNotMatch(r.stderr, /at .*\.js/);
});

function mcpInstall(dir, cfgFile, ...extra) {
  return spawnSync(process.execPath, [CLI, "mcp", "install", "--profile", "a", "--server-path", SERVER, "-y", ...extra], {
    env: envFor(dir, { GAVRIEL_CLAUDE_DESKTOP_CONFIG: cfgFile }),
    encoding: "utf8",
  });
}

test("cli: mcp install --dry-run no escribe y no incluye secretos", () => {
  const dir = tmp();
  cli(dir, "profile", "add", "a", "--email", "a@x.com");
  const cfg = join(dir, "desktop.json");
  const r = spawnSync(process.execPath, [CLI, "mcp", "install", "--profile", "a", "--role", "lite", "--dry-run", "--server-path", SERVER], {
    env: envFor(dir, { GAVRIEL_CLAUDE_DESKTOP_CONFIG: cfg }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GAVRIEL_PROFILE/);
  assert.match(r.stdout, /dry-run/);
  assert.doesNotMatch(r.stdout, /password/i);
  assert.equal(existsSync(cfg), false);
});

test("cli: mcp install exige --force para reemplazar, escribe atómico y deja .bak", () => {
  const dir = tmp();
  cli(dir, "profile", "add", "a", "--email", "a@x.com");
  const cfg = join(dir, "desktop.json");
  writeFileSync(cfg, JSON.stringify({ theme: "dark", mcpServers: { otro: { command: "x" } } }));
  assert.equal(mcpInstall(dir, cfg).status, 0);
  const first = JSON.parse(readFileSync(cfg, "utf8"));
  assert.equal(first.theme, "dark");
  assert.deepEqual(Object.keys(first.mcpServers).sort(), ["gavriel", "otro"]);
  assert.equal(first.mcpServers.gavriel.env.GAVRIEL_PROFILE, "a");

  const again = mcpInstall(dir, cfg, "--role", "readonly");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /--force/);
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")), first); // intacto

  assert.equal(mcpInstall(dir, cfg, "--role", "readonly", "--force").status, 0);
  assert.equal(JSON.parse(readFileSync(cfg, "utf8")).mcpServers.gavriel.env.GAVRIEL_MCP_ROLE, "readonly");
  const files = readdirSync(dir);
  assert.ok(files.some((f) => f.startsWith("desktop.json.bak-")));
  assert.ok(!files.some((f) => f.includes(".tmp-"))); // sin temporales colgados
});

test("cli: mcp install no toca un JSON inválido o de forma inesperada", () => {
  const dir = tmp();
  cli(dir, "profile", "add", "a", "--email", "a@x.com");
  const cfg = join(dir, "desktop.json");
  for (const content of ["{ roto", "[]", "null", '{"mcpServers":[]}']) {
    writeFileSync(cfg, content);
    assert.equal(mcpInstall(dir, cfg).status, 1, content);
    assert.equal(readFileSync(cfg, "utf8"), content);
  }
});

test("cli: mcp install --client code imprime argumentos JSON y respeta --server-path", () => {
  const dir = tmp();
  cli(dir, "profile", "add", "a", "--email", "a@x.com");
  const r = spawnSync(process.execPath, [CLI, "mcp", "install", "--client", "code", "--profile", "a", "--server-path", SERVER], {
    env: envFor(dir),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const argv = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(argv.slice(0, 4), ["claude", "mcp", "add", "gavriel"]);
  assert.ok(argv.includes("GAVRIEL_PROFILE=a"));
  assert.equal(argv.at(-1), SERVER);
  assert.equal(cli(dir, "mcp", "install", "--client", "code", "--profile", "a", "--server-path", join(dir, "no-existe.js")).status, 1);
});

test("config: perfil sin password guardado falla claro y no cae a la env de otra cuenta", () => {
  const dir = tmp();
  const keys = ["GAVRIEL_CONFIG_DIR", "GAVRIEL_PASSWORD", "APPDATA", "HOME", "USERPROFILE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { GAVRIEL_CONFIG_DIR: dir, GAVRIEL_PASSWORD: "de-otra-cuenta", APPDATA: dir, HOME: dir, USERPROFILE: dir });
  try {
    cli(dir, "profile", "add", "p", "--email", "perfil-sin-secreto@test.invalid");
    assert.throws(() => loadConfig({ profile: "p" }), /No hay password guardado para perfil-sin-secreto@test\.invalid/);
    assert.throws(() => loadConfig({ profile: "no-existe" }), /no existe/);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("client: getTwoFactorCode alimenta el reintento de login con 2FA", async () => {
  const bodies = [];
  const orig = global.fetch;
  global.fetch = async (_url, o) => {
    bodies.push(JSON.parse(o.body));
    const first = bodies.length === 1;
    const body = first
      ? { message: "Se requiere el código de autenticación de dos factores" }
      : { access_token: "a.b.c", user: { email: "hook@test.invalid" } };
    return new Response(JSON.stringify(body), { status: first ? 401 : 200, headers: { "content-type": "application/json" } });
  };
  try {
    const c = new GavrielClient(
      { GAVRIEL_API_BASE: "http://localhost:1/api", GAVRIEL_EMAIL: "hook@test.invalid", GAVRIEL_PASSWORD: "x" },
      { getTwoFactorCode: async () => "123456" },
    );
    await c.login();
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].twoFactorCode, "123456");
  } finally {
    global.fetch = orig;
  }
});

test("client: trusted token vencido + semilla -> re-autentica solo con código nuevo", async () => {
  const bodies = [];
  const orig = global.fetch;
  global.fetch = async (_url, o) => {
    bodies.push(JSON.parse(o.body));
    const first = bodies.length === 1;
    const body = first
      ? { message: "El token de dispositivo expiró" }
      : { access_token: "a.b.c", trusted_device_token: "nuevo", user: { email: "exp@test.invalid" } };
    return new Response(JSON.stringify(body), { status: first ? 401 : 200, headers: { "content-type": "application/json" } });
  };
  try {
    const c = new GavrielClient(
      { GAVRIEL_API_BASE: "http://localhost:1/api", GAVRIEL_EMAIL: "exp@test.invalid", GAVRIEL_PASSWORD: "x" },
      { getTwoFactorCode: async () => totp(RFC_SEED, 59_000) },
    );
    await c.login();
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].twoFactorCode, "287082");
    assert.equal(bodies[1].trustedDeviceToken, undefined);
  } finally {
    global.fetch = orig;
  }
});
