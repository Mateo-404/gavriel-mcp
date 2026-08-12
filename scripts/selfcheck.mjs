// Self-check unitario (sin red): force el path `applied_response_unparseable`
// de requireConfirm, verifica la cola de escrituras, buildQueryString y los
// reintentos/backoff de gavrielClient (401, 429, 5xx, errores de red).
// Uso: npm run selfcheck   (requiere build previo)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLogDir } from "../dist/auditLog.js";
import { requireConfirm } from "../dist/tools/writeHelpers.js";
import { buildQueryString, GavrielClient } from "../dist/gavrielClient.js";

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

rmSync(logDir, { recursive: true, force: true });
console.log(`\n== selfcheck: ${passed} checks ==`);
