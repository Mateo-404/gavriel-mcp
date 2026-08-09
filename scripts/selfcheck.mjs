// Self-check unitario (sin red): force el path `applied_response_unparseable`
// de requireConfirm, verifica la cola de escrituras y buildQueryString.
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

tAsync("preview: sin confirm no ejecuta", async () => {
  const r = await requireConfirm(false, PREVIEW_EXEC, mockClient, async () => { throw new Error("no debería ejecutar"); });
  assert.equal(r.preview, true);
});

tAsync("2xx con body no parseable => applied_response_unparseable + re-lectura", async () => {
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

tAsync("PATCH con path de acción => re-lectura al recurso padre", async () => {
  const r = await requireConfirm(
    true,
    { tool: "mark_activity_read", method: "PATCH", path: "/activities/clabc/mark-as-read", params: { readAt: "x" } },
    mockClient,
    async () => ({ status: 200, data: "corrupt{" }),
  );
  assert.equal(r.verifiedState.reRead.path, "/activities/clabc");
});

tAsync("POST con respuesta corrupta => verifiedState null (no hay id para releer)", async () => {
  const r = await requireConfirm(
    true,
    { tool: "create_ticket", method: "POST", path: "/tickets", params: { title: "x" } },
    mockClient,
    async () => ({ status: 201, data: "corrupt{" }),
  );
  assert.equal(r.writeStatus, "applied_response_unparseable");
  assert.equal(r.verifiedState, null);
});

tAsync("4xx real => error genuino, no se disfraza ni relee", async () => {
  const r = await requireConfirm(
    true,
    PREVIEW_EXEC,
    mockClient,
    async () => ({ status: 409, data: { message: "conflict" } }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

tAsync("cola de escrituras: 5 PATCH en paralelo se serializan (máx 1 en vuelo)", async () => {
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
