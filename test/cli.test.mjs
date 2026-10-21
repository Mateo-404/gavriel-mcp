import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base32Decode, totp, parseSeedInput } from "../dist/totp.js";
import { loadConfig } from "../dist/config.js";
import { GavrielClient } from "../dist/gavrielClient.js";
import { redact } from "../dist/auditLog.js";

// RFC 6238 apéndice B (SHA-1): secreto ASCII "12345678901234567890", 8 dígitos 94287082 en t=59 → 6 dígitos 287082.
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

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

function cli(dir, ...args) {
  return spawnSync(process.execPath, [join(import.meta.dirname, "..", "dist", "cli.js"), ...args], {
    env: { ...process.env, GAVRIEL_CONFIG_DIR: dir, GAVRIEL_PROFILE: "", GAVRIEL_EMAIL: "" },
    encoding: "utf8",
  });
}

test("cli: --version, --help y comando desconocido", () => {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-cli-"));
  assert.match(cli(dir, "--version").stdout, /^gavriel /);
  assert.equal(cli(dir, "--help").status, 0);
  const bad = cli(dir, "nope");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Comando desconocido/);
  assert.equal(cli(dir, "--flag-inexistente").status, 2);
});

test("cli: CRUD de perfiles sin secretos en el JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-cli-"));
  assert.equal(cli(dir, "profile", "add", "a", "--email", "a@x.com", "--role", "readonly").status, 0);
  assert.equal(cli(dir, "profile", "add", "b", "--email", "b@x.com").status, 0);
  assert.equal(cli(dir, "profile", "use", "b").status, 0);
  assert.equal(cli(dir, "profile", "rename", "b", "c").status, 0);
  const store = JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8"));
  assert.equal(store.active, "c");
  assert.deepEqual(Object.keys(store.profiles).sort(), ["a", "c"]);
  assert.equal(store.profiles.a.role, "readonly");
  assert.doesNotMatch(JSON.stringify(store), /password|seed|token/i);
  assert.equal(cli(dir, "profile", "remove", "c").status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8")).active, "a");
  assert.equal(cli(dir, "profile", "add", "../mal", "--email", "x@x.com").status, 1); // nombre inválido
  assert.equal(cli(dir, "profile", "use", "inexistente").status, 1);
});

test("cli: mcp install --dry-run no escribe y no incluye secretos", () => {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-cli-"));
  cli(dir, "profile", "add", "a", "--email", "a@x.com");
  const r = cli(dir, "mcp", "install", "--profile", "a", "--role", "lite", "--dry-run");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GAVRIEL_PROFILE/);
  assert.match(r.stdout, /dry-run/);
  assert.doesNotMatch(r.stdout, /password/i);
});

test("config: perfil sin password guardado falla claro y no cae a la env de otra cuenta", () => {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-cli-"));
  const prev = { ...process.env };
  process.env.GAVRIEL_CONFIG_DIR = dir;
  process.env.GAVRIEL_PASSWORD = "de-otra-cuenta";
  try {
    cli(dir, "profile", "add", "p", "--email", "perfil-sin-secreto@test.invalid");
    assert.throws(() => loadConfig({ profile: "p" }), /No hay password guardado para perfil-sin-secreto@test\.invalid/);
    assert.throws(() => loadConfig({ profile: "no-existe" }), /no existe/);
  } finally {
    process.env = prev;
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

test("redact: la semilla TOTP nunca se loguea", () => {
  assert.equal(redact({ totpSeed: "ABC", nested: { totp_seed: "X" } }).totpSeed, "[REDACTED]");
});
