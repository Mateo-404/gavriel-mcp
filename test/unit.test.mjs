import { test } from "node:test";
import assert from "node:assert/strict";
import { GavrielClient, retryDelayMs, parseRetryAfter } from "../dist/gavrielClient.js";
import { requireConfirm, isDestructive } from "../dist/tools/writeHelpers.js";
import { normalizePath, isAllowed, sanitizeQuery } from "../dist/tools/rawGet.js";
import { redact } from "../dist/auditLog.js";
import { diffNewEvents, parsePollSec } from "../dist/notifications/poller.js";

function mkClient() {
  const c = new GavrielClient({ GAVRIEL_API_BASE: "http://localhost:1/api", GAVRIEL_EMAIL: "x@x", GAVRIEL_PASSWORD: "x" });
  let n = 0;
  c.login = async () => { // login stub: sin red
    c.jwt.token = `t${++n}`;
    c.jwt.expiresAt = Date.now() + 3600_000;
  };
  return c;
}
async function withFetch(responses, run) {
  const calls = [];
  const q = [...responses];
  const orig = global.fetch;
  global.fetch = async (url, o) => {
    calls.push({ url: String(url), headers: o?.headers ?? {} });
    const r = q.shift();
    if (!r) throw new Error("fetch inesperado");
    return new Response(r.body ?? "", { status: r.status, headers: r.headers ?? {} });
  };
  try { return await run(calls); } finally { global.fetch = orig; }
}
const J = { "content-type": "application/json" };
const ok = (o) => ({ status: 200, body: JSON.stringify(o), headers: J });

test("client: cache con ttl evita segundo fetch", async () => {
  await withFetch([ok({ a: 1 })], async (calls) => {
    const c = mkClient();
    await c.get("/tickets", {}, { ttl: 5000 });
    const r = await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(calls.length, 1);
    assert.deepEqual(r.data, { a: 1 });
  });
});

test("client: GETs concurrentes iguales se deduplican", async () => {
  await withFetch([ok({ a: 1 })], async (calls) => {
    const c = mkClient();
    await Promise.all([c.get("/tickets"), c.get("/tickets")]);
    assert.equal(calls.length, 1);
  });
});

test("client: 401 reloguea y reintenta con otro token", async () => {
  await withFetch([{ status: 401 }, ok({ ok: true })], async (calls) => {
    const c = mkClient();
    const r = await c.get("/tickets");
    assert.equal(calls.length, 2);
    assert.deepEqual(r.data, { ok: true });
    assert.notEqual(calls[0].headers.Authorization, calls[1].headers.Authorization);
  });
});

test("retryDelayMs: Retry-After manda; backoff crece y tiene tope", () => {
  assert.equal(retryDelayMs(0, "2"), 2000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(retryDelayMs(0, null, 0.5), 500);
  assert.equal(retryDelayMs(1, null, 0.5), 1000);
  assert.ok(retryDelayMs(30, null, 0.5) <= 60_000 * 10);
});

test("requireConfirm: sin confirm devuelve preview y no ejecuta", async () => {
  let ran = false;
  const r = await requireConfirm(false, { tool: "x", method: "PATCH", path: "/t/1", params: { a: 1 } }, { email: "a@b" }, async () => { ran = true; return { status: 200, data: {} }; });
  assert.equal(ran, false);
  assert.equal(r.preview, true);
  assert.equal(r.metodo, "PATCH");
});

test("isDestructive", () => {
  for (const t of ["delete_device", "bulk_close_tickets", "send_conversation_message"]) assert.ok(isDestructive(t), t);
  for (const t of ["list_tickets", "update_ticket", "create_ticket"]) assert.ok(!isDestructive(t), t);
});

test("rawGet: normalizePath / isAllowed / sanitizeQuery", () => {
  assert.equal(normalizePath("/tickets//1/"), "/tickets/1");
  for (const bad of ["tickets", "/a/../b", "/a?x=1", "/a%2e", "/a\b", "/"]) assert.equal(normalizePath(bad), null, bad);
  assert.ok(isAllowed("/tickets/abc"));
  assert.equal(isAllowed("/ticketsfoo"), false);
  assert.equal(isAllowed("/admin"), false);
  assert.deepEqual(sanitizeQuery({ a: 1, token: "x", "bad key": 1, o: {}, arr: ["x", 2] }), { a: 1, arr: ["x", 2] });
  assert.equal(sanitizeQuery({ password: "x" }), undefined);
});

test("auditLog.redact oculta claves sensibles, recursivo", () => {
  const r = redact({ email: "a", password: "p", n: { accessToken: "t", list: [{ twoFactorCode: "1" }] } });
  assert.equal(r.email, "a");
  assert.equal(r.password, "[REDACTED]");
  assert.equal(r.n.accessToken, "[REDACTED]");
  assert.equal(r.n.list[0].twoFactorCode, "[REDACTED]");
});

test("poller: diffNewEvents y parsePollSec", () => {
  const prev = new Set(["1", "2"]);
  assert.deepEqual(diffNewEvents(prev, [{ id: 1 }, { id: "3" }, { id: 4 }, {}]).map((e) => String(e.id)), ["3", "4"]);
  assert.equal(parsePollSec(undefined), null);
  assert.equal(parsePollSec("0"), null);
  assert.equal(parsePollSec("5"), 30);
  assert.equal(parsePollSec("90"), 90);
});
