// Self-check unitario (sin red): force el path `applied_response_unparseable`
// de requireConfirm, verifica la cola de escrituras, buildQueryString, la
// whitelist de `get`, el orden de resolución de secretos y los
// reintentos/backoff de gavrielClient (401, 429, 5xx, errores de red).
// Uso: npm run selfcheck   (requiere build previo)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setLogDir } from "../dist/auditLog.js";
import { requireConfirm } from "../dist/tools/writeHelpers.js";
import { buildQueryString, GavrielClient } from "../dist/gavrielClient.js";
import { isAllowed, READ_PREFIXES } from "../dist/tools/rawGet.js";
import { hasRole, registerTool } from "../dist/tools/roles.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const logDir = mkdtempSync(join(tmpdir(), "gavriel-selfcheck-"));
setLogDir(logDir);

const mockClient = {
  email: "test@example.com",
  async get(_path) {
    return { status: 200, data: { verified: true } };
  },
};

let passed = 0;
const t = (label, fn) => {
  try { fn(); passed++; console.log(`  PASS ${label}`); }
  catch (e) { console.log(`  FAIL ${label}: ${e.message}`); process.exitCode = 1; }
};
const tAsync = async (label, fn) => {
  try { await fn(); passed++; console.log(`  PASS ${label}`); }
  catch (e) { console.log(`  FAIL ${label}: ${e.message}`); process.exitCode = 1; }
};

const PREVIEW_EXEC = { tool: "x", method: "PATCH", path: "/tickets/1", params: { a: 1 } };

t("buildQueryString: salta undefined/null/''", () => {
  assert.equal(buildQueryString({ a: "1", b: undefined, c: null, d: "" }), "?a=1");
});
t("buildQueryString: serializa arrays", () => {
  assert.equal(buildQueryString({ s: ["x", "y"] }), "?s=x&s=y");
});
t("buildQueryString: vacío sin params", () => {
  assert.equal(buildQueryString({}), "");
});

t("whitelist de `get`: cada prefijo declarado se permite a sí mismo", () => {
  for (const p of READ_PREFIXES) {
    assert.ok(isAllowed(p), `${p} debería estar permitido`);
  }
});
t("whitelist de `get`: subpaths de un prefijo permitido pasan", () => {
  assert.ok(isAllowed("/tickets/clxyz"));
  assert.ok(isAllowed("/accounts/123/notes"));
});
t("whitelist de `get`: prefijo no declarado se rechaza", () => {
  assert.equal(isAllowed("/billing"), false);
  assert.equal(isAllowed("/admin/users"), false);
});
t("whitelist de `get`: match parcial de nombre no cuenta como prefijo", () => {
  // "/ticketsfoo" no es "/tickets" ni "/tickets/..." — el check exige
  // separador de path, no solo startsWith en crudo.
  assert.equal(isAllowed("/ticketsfoo"), false);
  assert.equal(isAllowed("/accountsxyz/1"), false);
});
t("whitelist de `get`: path sin barra inicial se rechaza", () => {
  assert.equal(isAllowed("tickets"), false);
});

// --- roles: GAVRIEL_MCP_ROLE (readonly/full) ---
function fakeServer() {
  const names = [];
  return { names, registerTool: (name) => { names.push(name); } };
}

t("roles: full registra las tools de escritura", () => {
  const s = fakeServer();
  registerTool(s, "full", "full", "create_ticket", {}, () => {});
  assert.deepEqual(s.names, ["create_ticket"]);
});

t("roles: readonly NO registra las tools de escritura", () => {
  const s = fakeServer();
  registerTool(s, "readonly", "full", "create_ticket", {}, () => {});
  assert.deepEqual(s.names, []);
});

t("roles: hasRole respeta el ranking (readonly < full)", () => {
  assert.equal(hasRole("full", "full"), true);
  assert.equal(hasRole("full", "readonly"), true);
  assert.equal(hasRole("readonly", "readonly"), true);
  assert.equal(hasRole("readonly", "full"), false);
});

// --- roles e2e: buildServer(listTools) via transport in-memory ---
const WRITE_TOOLS = [
  "create_intervention", "create_bulk_interventions", "close_intervention",
  "set_intervention_observation", "create_ticket", "update_ticket",
  "close_ticket", "add_ticket_activity", "mark_events_processed",
  "update_account", "add_account_note", "update_account_note",
  "delete_account_note", "send_conversation_message", "conversation_claim",
  "conversation_release", "conversation_set_status", "conversation_mark_read",
  "mark_activity_read", "mark_activity_unread", "update_activity",
  "add_account_contact", "update_account_contact", "schedule_service",
  "update_service", "add_technician_non_working_days",
  "add_company_non_working_day",
  "create_event_type", "update_event_type", "delete_event_type",
  "create_event_code", "update_event_code", "delete_event_code",
  "bulk_create_event_codes",
  "create_device_brand", "update_device_brand", "delete_device_brand",
  "create_device_model", "update_device_model", "delete_device_model",
  "create_device", "update_device", "delete_device",
];

const tListTools = async (server) => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const [c2s, s2c] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "selfcheck", version: "0.0.0" });
  await server.connect(c2s);
  await client.connect(s2c);
  const tools = await client.listTools();
  await client.close();
  return tools.tools.map((x) => x.name);
};

tAsync("roles e2e: full lista TODAS las tools (lectura + escritura)", async () => {
  const { buildServer } = await import("../dist/server.js");
  const names = await tListTools(buildServer(mockClient, "full"));
  for (const w of WRITE_TOOLS) assert.ok(names.includes(w), `full debería incluir ${w}`);
});

tAsync("roles e2e: readonly lista SOLO lectura (sin las 27 de escritura)", async () => {
  const { buildServer } = await import("../dist/server.js");
  const names = await tListTools(buildServer(mockClient, "readonly"));
  for (const w of WRITE_TOOLS) assert.ok(!names.includes(w), `readonly no debería incluir ${w}`);
  for (const r of ["list_tickets", "get_ticket", "list_events", "get_account", "list_accounts", "get", "audit_logs", "health"]) {
    assert.ok(names.includes(r), `readonly debería incluir ${r}`);
  }
});

// --- gavrielClient: reintentos, backoff y errores de red en request() ---
// Corre ANTES del test de la cola de escrituras (más abajo), que reemplaza
// GavrielClient.prototype.request por un stub permanente para el resto del
// proceso — estos checks necesitan la implementación real.
// login() se stubea (sin red) porque lo que se testea acá es la lógica de
// reintento de request(), no el flujo de login en sí.
let loginCallCount = 0;
GavrielClient.prototype.login = async function () {
  loginCallCount++;
  this.jwt.token = `stub-token-${loginCallCount}`;
  this.jwt.expiresAt = Date.now() + 3600_000;
};

function makeFetchStub(responses) {
  const calls = [];
  const queue = [...responses];
  const stub = async (_url, opts) => {
    calls.push({ headers: opts?.headers ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("makeFetchStub: se pidieron más fetch() de los encolados");
    if (next.networkError) throw next.networkError;
    return new Response(next.body ?? "", { status: next.status, headers: next.headers ?? {} });
  };
  stub.calls = calls;
  return stub;
}

function newClient() {
  return new GavrielClient({
    GAVRIEL_API_BASE: "http://localhost:1/api",
    GAVRIEL_EMAIL: "x@x",
    GAVRIEL_PASSWORD: "x",
  });
}

async function withFetchStub(responses, run) {
  const stub = makeFetchStub(responses);
  const original = global.fetch;
  global.fetch = stub;
  try {
    return await run(stub);
  } finally {
    global.fetch = original;
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

await tAsync("gavrielClient: 401 limpia el token, reloguea y reintenta una vez", async () => {
  const client = newClient();
  await withFetchStub(
    [
      { status: 401 },
      { status: 200, body: JSON.stringify({ ok: true }), headers: JSON_HEADERS },
    ],
    async (stub) => {
      const res = await client.get("/tickets");
      assert.equal(stub.calls.length, 2);
      assert.deepEqual(res.data, { ok: true });
      // Los dos intentos deben ir con tokens distintos: el 401 fuerza un re-login.
      assert.notEqual(stub.calls[0].headers.Authorization, stub.calls[1].headers.Authorization);
    },
  );
});

await tAsync("gavrielClient: 401 persistente no reintenta en bucle (máx 1 reintento)", async () => {
  const client = newClient();
  await withFetchStub([{ status: 401 }, { status: 401 }], async (stub) => {
    const res = await client.get("/tickets");
    assert.equal(stub.calls.length, 2, "debe frenar tras el segundo 401, no seguir reintentando");
    assert.equal(res.status, 401);
  });
});

await tAsync("gavrielClient: 429 respeta retry-after y reintenta hasta tener éxito", async () => {
  const client = newClient();
  await withFetchStub(
    [
      { status: 429, headers: { "retry-after": "0.001" } },
      { status: 200, body: JSON.stringify({ ok: true }), headers: JSON_HEADERS },
    ],
    async (stub) => {
      const res = await client.get("/tickets");
      assert.equal(stub.calls.length, 2);
      assert.deepEqual(res.data, { ok: true });
    },
  );
});

await tAsync("gavrielClient: 5xx agota los reintentos (2) y devuelve la última respuesta sin lanzar", async () => {
  const client = newClient();
  await withFetchStub(
    [
      { status: 500, headers: { "retry-after": "0.001" } },
      { status: 502, headers: { "retry-after": "0.001" } },
      { status: 503, headers: { "retry-after": "0.001", ...JSON_HEADERS }, body: JSON.stringify({ error: "still down" }) },
    ],
    async (stub) => {
      const res = await client.get("/tickets");
      assert.equal(stub.calls.length, 3, "3 intentos: el original + 2 reintentos, después se rinde");
      assert.equal(res.status, 503);
      assert.deepEqual(res.data, { error: "still down" });
    },
  );
});

await tAsync("gavrielClient: 404 no reintenta", async () => {
  const client = newClient();
  await withFetchStub(
    [{ status: 404, body: JSON.stringify({ message: "not found" }), headers: JSON_HEADERS }],
    async (stub) => {
      const res = await client.get("/tickets/no-existe");
      assert.equal(stub.calls.length, 1);
      assert.equal(res.status, 404);
    },
  );
});

await tAsync("gavrielClient: error de red se envuelve en un mensaje en español (no cuelga, no se re-tipa)", async () => {
  const client = newClient();
  await withFetchStub([{ networkError: new Error("ECONNREFUSED") }], async () => {
    await assert.rejects(() => client.get("/tickets"), /Error de red hacia GET \/tickets: ECONNREFUSED/);
  });
});

await tAsync("gavrielClient: x-new-token rota el token usado en el siguiente request", async () => {
  const client = newClient();
  await withFetchStub(
    [
      { status: 200, body: JSON.stringify({ a: 1 }), headers: { ...JSON_HEADERS, "x-new-token": "rotated-token" } },
      { status: 200, body: JSON.stringify({ b: 2 }), headers: JSON_HEADERS },
    ],
    async (stub) => {
      await client.get("/one");
      await client.get("/two");
      assert.equal(stub.calls[1].headers.Authorization, "Bearer rotated-token");
    },
  );
});

await tAsync("preview: sin confirm no ejecuta", async () => {
  const r = await requireConfirm(false, PREVIEW_EXEC, mockClient, async () => { throw new Error("no debería ejecutar"); });
  assert.equal(r.preview, true);
});

await tAsync("2xx con body no parseable => applied_response_unparseable + re-lectura", async () => {
  const r = await requireConfirm(
    true,
    { tool: "update_ticket", method: "PATCH", path: "/tickets/clxyz", params: { status: "open" } },
    mockClient,
    async () => ({ status: 200, data: '{"id":"clxyz","status":"ope' }), // truncado a propósito
  );
  assert.equal(r.writeStatus, "applied_response_unparseable");
  assert.equal(r.httpStatus, 200);
  assert.equal(r.verifiedState.reRead.path, "/tickets/clxyz");
  assert.deepEqual(r.verifiedState.reRead.data, { verified: true });
  const log = readFileSync(join(logDir, "writes.log"), "utf8");
  assert.ok(log.includes('"rawBody":"{\\"id\\":\\"clxyz\\",\\"status\\":\\"ope'),
    "el body crudo debe quedar en writes.log");
});

await tAsync("PATCH con path de acción => re-lectura al recurso padre", async () => {
  const r = await requireConfirm(
    true,
    { tool: "mark_activity_read", method: "PATCH", path: "/activities/clabc/mark-as-read", params: { readAt: "x" } },
    mockClient,
    async () => ({ status: 200, data: "corrupt{" }),
  );
  assert.equal(r.verifiedState.reRead.path, "/activities/clabc");
});

await tAsync("POST con respuesta corrupta => verifiedState null (no hay id para releer)", async () => {
  const r = await requireConfirm(
    true,
    { tool: "create_ticket", method: "POST", path: "/tickets", params: { title: "x" } },
    mockClient,
    async () => ({ status: 201, data: "corrupt{" }),
  );
  assert.equal(r.writeStatus, "applied_response_unparseable");
  assert.equal(r.verifiedState, null);
});

await tAsync("4xx real => error genuino, no se disfraza ni relee", async () => {
  const r = await requireConfirm(
    true,
    PREVIEW_EXEC,
    mockClient,
    async () => ({ status: 409, data: { message: "conflict" } }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

await tAsync("cola de escrituras: 5 PATCH en paralelo se serializan (máx 1 en vuelo)", async () => {
  let inFlight = 0, maxInFlight = 0;
  const client = new GavrielClient({
    GAVRIEL_API_BASE: "http://localhost:1/api",
    GAVRIEL_EMAIL: "x@x",
    GAVRIEL_PASSWORD: "x",
  });
  // stub del transporte: el request de la cola real (post/patch/delete)
  GavrielClient.prototype.request = async function () {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return { status: 200, data: {} };
  };
  await Promise.all([1, 2, 3, 4, 5].map(() => client.patch("/x")));
  assert.ok(maxInFlight <= 1, `maxInFlight=${maxInFlight}`);
});

// --- secrets.ts: orden de resolución keyring > env > archivo legacy ---
// Corre cada escenario en un proceso hijo (scripts/fixtures/secrets-probe.mjs
// + scripts/fixtures/fake-secret-tool/) porque hasSecretTool() cachea el
// resultado de detectar `secret-tool` a nivel de módulo: dentro de un mismo
// proceso no se puede alternar la disponibilidad del keyring entre checks.
const FAKE_BIN = join(SCRIPT_DIR, "fixtures", "fake-secret-tool");
const PROBE = join(SCRIPT_DIR, "fixtures", "secrets-probe.mjs");
const secretsTmp = mkdtempSync(join(tmpdir(), "gavriel-selfcheck-secrets-"));

function makeHome(files = {}) {
  const home = mkdtempSync(join(secretsTmp, "home-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(home, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return home;
}

function runProbe(mode, email, { home, keyringAvailable, keyringState, extraEnv = {} }) {
  const env = { ...process.env };
  env.PATH = `${FAKE_BIN}:${process.env.PATH}`;
  env.HOME = home;
  env.FAKE_SECRET_TOOL_AVAILABLE = keyringAvailable ? "1" : "0";
  env.FAKE_KEYRING_STATE = keyringState;
  delete env.GAVRIEL_PASSWORD;
  delete env.GAVRIEL_TRUSTED_DEVICE_TOKEN;
  delete env.PROBE_TOKEN_VALUE;
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [PROBE, mode, email ?? ""], { env, encoding: "utf8", timeout: 5000 });
  if (res.status !== 0) {
    throw new Error(`probe (${mode}) status=${res.status} stderr=${res.stderr || res.error}`);
  }
  return JSON.parse(res.stdout).result;
}

const SECRETS_EMAIL = "test@example.com";

t("secrets: password usa el keyring si está disponible, aunque haya env y archivo legacy", () => {
  const home = makeHome({ ".secrets/gavriel-password": "legacy-pass" });
  const state = join(secretsTmp, "state-1.json");
  writeFileSync(state, JSON.stringify({ "gavriel-mcp:password": "keyring-pass" }));
  const result = runProbe("password", null, {
    home, keyringAvailable: true, keyringState: state,
    extraEnv: { GAVRIEL_PASSWORD: "env-pass" },
  });
  assert.equal(result, "keyring-pass");
});

t("secrets: sin keyring, password usa la env var antes que el archivo legacy", () => {
  const home = makeHome({ ".secrets/gavriel-password": "legacy-pass" });
  const state = join(secretsTmp, "state-2.json");
  const result = runProbe("password", null, {
    home, keyringAvailable: false, keyringState: state,
    extraEnv: { GAVRIEL_PASSWORD: "env-pass" },
  });
  assert.equal(result, "env-pass");
});

t("secrets: sin keyring ni env, password cae al archivo legacy", () => {
  const home = makeHome({ ".secrets/gavriel-password": "legacy-pass" });
  const state = join(secretsTmp, "state-3.json");
  const result = runProbe("password", null, { home, keyringAvailable: false, keyringState: state });
  assert.equal(result, "legacy-pass");
});

t("secrets: sin ninguna fuente, password resuelve null", () => {
  const home = makeHome({});
  const state = join(secretsTmp, "state-4.json");
  const result = runProbe("password", null, { home, keyringAvailable: false, keyringState: state });
  assert.equal(result, null);
});

t("secrets: trusted_device_token respeta el mismo orden (keyring > env > legacy)", () => {
  const home = makeHome({
    ".local/share/gavriel-mcp/trusted-device.json": JSON.stringify({ [SECRETS_EMAIL]: "legacy-token" }),
  });
  const state = join(secretsTmp, "state-5.json");
  writeFileSync(state, JSON.stringify({ "gavriel-mcp:trusted_device_token": "keyring-token" }));
  const result = runProbe("token", SECRETS_EMAIL, {
    home, keyringAvailable: true, keyringState: state,
    extraEnv: { GAVRIEL_TRUSTED_DEVICE_TOKEN: "env-token" },
  });
  assert.equal(result, "keyring-token");
});

t("secrets: token legacy normaliza el email (case/espacios) al leer", () => {
  const home = makeHome({
    ".local/share/gavriel-mcp/trusted-device.json": JSON.stringify({ [SECRETS_EMAIL]: "legacy-token" }),
  });
  const state = join(secretsTmp, "state-6.json");
  const result = runProbe("token", "  Test@Example.com  ", { home, keyringAvailable: false, keyringState: state });
  assert.equal(result, "legacy-token");
});

t("secrets: saveTrustedToken escribe al keyring cuando está disponible (no al legacy)", () => {
  const home = makeHome({});
  const state = join(secretsTmp, "state-7.json");
  runProbe("save-token", SECRETS_EMAIL, {
    home, keyringAvailable: true, keyringState: state,
    extraEnv: { PROBE_TOKEN_VALUE: "nuevo-token" },
  });
  const stored = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(stored["gavriel-mcp:trusted_device_token"], "nuevo-token");
  const legacyPath = join(home, ".local/share/gavriel-mcp/trusted-device.json");
  assert.throws(() => readFileSync(legacyPath, "utf8"), "no debería haber tocado el archivo legacy");
});

t("secrets: saveTrustedToken cae al archivo legacy sin keyring, y clearTrustedToken lo borra", () => {
  const home = makeHome({});
  const state = join(secretsTmp, "state-8.json");
  runProbe("save-token", SECRETS_EMAIL, {
    home, keyringAvailable: false, keyringState: state,
    extraEnv: { PROBE_TOKEN_VALUE: "nuevo-token" },
  });
  const afterSave = runProbe("token", SECRETS_EMAIL, { home, keyringAvailable: false, keyringState: state });
  assert.equal(afterSave, "nuevo-token");
  runProbe("clear-token", SECRETS_EMAIL, { home, keyringAvailable: false, keyringState: state });
  const afterClear = runProbe("token", SECRETS_EMAIL, { home, keyringAvailable: false, keyringState: state });
  assert.equal(afterClear, null);
});

rmSync(secretsTmp, { recursive: true, force: true });
rmSync(logDir, { recursive: true, force: true });
console.log(`\n== selfcheck: ${passed} checks ==`);
