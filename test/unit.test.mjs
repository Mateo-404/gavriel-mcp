import { test } from "node:test";
import assert from "node:assert/strict";
import { GavrielClient, retryDelayMs, parseRetryAfter } from "../dist/gavrielClient.js";
import { requireConfirm, isDestructive } from "../dist/tools/writeHelpers.js";
import { normalizePath, isAllowed, sanitizeQuery } from "../dist/tools/rawGet.js";
import { redact, redactText } from "../dist/auditLog.js";
import { loadStore, saveStore, getProfile, validateProfileName } from "../dist/profiles.js";
import { loadConfig } from "../dist/config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffNewEvents, parsePollSec } from "../dist/notifications/poller.js";

function mkClient(extra = {}) {
  const c = new GavrielClient({ GAVRIEL_API_BASE: "http://localhost:1/api", GAVRIEL_EMAIL: "x@x", GAVRIEL_PASSWORD: "x", ...extra });
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

// ── Auditoría: login, cache, invalidación, redacción, perfiles, config ──
function realClient() {
  return new GavrielClient({ GAVRIEL_API_BASE: "http://localhost:1/api", GAVRIEL_EMAIL: "x@x", GAVRIEL_PASSWORD: "x" });
}

test("login: el POST /auth/login lleva AbortSignal (timeout)", async () => {
  const origFetch = global.fetch;
  let sig;
  global.fetch = async (url, o) => {
    sig = o.signal;
    return new Response(JSON.stringify({ access_token: "a.b.c" }), { status: 200, headers: J });
  };
  try {
    await realClient().login();
    assert.ok(sig instanceof AbortSignal);
    assert.equal(sig.aborted, false);
  } finally { global.fetch = origFetch; }
});

test("login: un fallo se recuerda y no se re-postea en cada llamada", async () => {
  await withFetch([{ status: 401, body: JSON.stringify({ message: "credenciales" }), headers: J }], async (calls) => {
    const c = realClient();
    await assert.rejects(c.login(), /Login falló/);
    await assert.rejects(c.login(), /Login falló/);
    await assert.rejects(c.get("/tickets"), /Login falló/);
    assert.equal(calls.length, 1);
  });
});

test("client: no cachea bodies string (no-JSON/truncados)", async () => {
  await withFetch([{ status: 200, body: "{trunca" }, { status: 200, body: "{trunca" }], async (calls) => {
    const c = mkClient();
    const r = await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(typeof r.data, "string");
    await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(calls.length, 2);
  });
});

test("client: cache y dedupe devuelven copias independientes", async () => {
  await withFetch([ok({ a: { b: 1 } })], async () => {
    const c = mkClient();
    const r1 = await c.get("/tickets", {}, { ttl: 5000 });
    r1.data.a.b = 99;
    const r2 = await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(r2.data.a.b, 1);
  });
});

test("client: una escritura invalida GETs en vuelo (ni cache ni dedupe del GET viejo)", async () => {
  const c = mkClient();
  const origFetch = global.fetch;
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  global.fetch = async () => {
    const i = ++n;
    if (i === 1) { await gate; return new Response(JSON.stringify({ v: "old" }), { status: 200, headers: J }); }
    return new Response(JSON.stringify({ v: "new" }), { status: 200, headers: J });
  };
  try {
    const g1 = c.get("/tickets", {}, { ttl: 5000 });
    await new Promise((r) => setTimeout(r, 10));
    await c.patch("/tickets/1", { a: 1 });
    const g2 = await c.get("/tickets", {}, { ttl: 5000 }); // no se cuelga del GET viejo
    release();
    assert.equal((await g1).data.v, "old");
    const g3 = await c.get("/tickets", {}, { ttl: 5000 }); // el GET viejo no pisó el cache
    assert.equal(g2.data.v, "new");
    assert.equal(g3.data.v, "new");
    assert.equal(n, 3);
  } finally { global.fetch = origFetch; }
});

test("client: escritura con 5xx también invalida el cache; 4xx no", async () => {
  await withFetch([ok({ v: 1 }), { status: 400, body: "{}", headers: J }, { status: 502, body: "{}", headers: J }, ok({ v: 2 })], async (calls) => {
    const c = mkClient();
    await c.get("/tickets", {}, { ttl: 5000 });
    await c.patch("/tickets/1", {}); // 400: cache intacto
    await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(calls.length, 2);
    await c.patch("/tickets/1", {}); // 502: pudo aplicarse, se invalida
    const r = await c.get("/tickets", {}, { ttl: 5000 });
    assert.equal(r.data.v, 2);
  });
});

test("client: semáforo de escrituras entrega el slot a los waiters", async () => {
  const c = mkClient({ GAVRIEL_MCP_WRITE_CONCURRENCY: 1 });
  const origFetch = global.fetch;
  let active = 0, max = 0;
  global.fetch = async () => {
    max = Math.max(max, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response("{}", { status: 200, headers: J });
  };
  try {
    await Promise.all([1, 2, 3, 4].map((i) => c.post(`/x/${i}`, {})));
    assert.equal(max, 1);
  } finally { global.fetch = origFetch; }
});

test("client: nunca manda el bearer a un host absoluto", async () => {
  await withFetch([ok({})], async (calls) => {
    await mkClient().get("http://evil.example/steal");
    assert.ok(calls[0].url.startsWith("http://localhost:1/api"), calls[0].url);
  });
});

test("auditLog.redact: conserva code de evento y redacta credenciales", () => {
  const r = redact({
    code: "E301", statusCode: 200, zipCode: "1900", authorName: "ana",
    password: "p", jwt: "j", otp: "1", twoFactorCode: "2", verificationCode: "3", api_key: "k", Authorization: "Bearer x", pin: "1234",
  });
  for (const k of ["code", "statusCode", "zipCode", "authorName"]) assert.notEqual(r[k], "[REDACTED]", k);
  for (const k of ["password", "jwt", "otp", "twoFactorCode", "verificationCode", "api_key", "Authorization", "pin"]) assert.equal(r[k], "[REDACTED]", k);
});

test("auditLog.redactText: password=, token y Bearer en texto no-JSON", () => {
  const t = redactText("email=a@b&password=s3cr3t&x=1 {\"accessToken\":\"abc\"} Authorization: Bearer aa.bb.cc");
  assert.ok(!/s3cr3t|abc|aa\.bb/.test(t), t);
  assert.ok(t.includes("email=a@b") && t.includes("x=1"));
});

test("profiles.loadStore: ENOENT = vacío; JSON corrupto lanza (no se pisa)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gav-prof-"));
  const prev = process.env.GAVRIEL_CONFIG_DIR;
  process.env.GAVRIEL_CONFIG_DIR = dir;
  try {
    assert.deepEqual({ ...loadStore().profiles }, {});
    saveStore({ active: "a", profiles: { a: { email: "a@b.c" } } });
    assert.equal(loadStore().profiles.a.email, "a@b.c");
    assert.equal(getProfile(loadStore(), "constructor"), undefined);
    assert.throws(() => validateProfileName("__proto__"));
    writeFileSync(join(dir, "profiles.json"), "{corrupto");
    assert.throws(() => loadStore(), /JSON válido/);
  } finally {
    if (prev === undefined) delete process.env.GAVRIEL_CONFIG_DIR; else process.env.GAVRIEL_CONFIG_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: variables vacías se normalizan a undefined (defaults aplican)", () => {
  const keys = ["GAVRIEL_EMAIL", "GAVRIEL_PASSWORD", "GAVRIEL_API_BASE", "GAVRIEL_MCP_ROLE", "GAVRIEL_MCP_WRITE_CONCURRENCY", "GAVRIEL_MCP_DESTRUCTIVE_APPROVAL", "GAVRIEL_PROFILE", "GAVRIEL_2FA_CODE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GAVRIEL_EMAIL: "t@example.com", GAVRIEL_PASSWORD: "pw", GAVRIEL_API_BASE: "", GAVRIEL_MCP_ROLE: "",
    GAVRIEL_MCP_WRITE_CONCURRENCY: "", GAVRIEL_MCP_DESTRUCTIVE_APPROVAL: "", GAVRIEL_PROFILE: "", GAVRIEL_2FA_CODE: "",
  });
  try {
    const cfg = loadConfig();
    assert.equal(cfg.GAVRIEL_API_BASE, "https://app.gavriel.com.ar/api");
    assert.equal(cfg.GAVRIEL_MCP_ROLE, "full");
    assert.equal(cfg.GAVRIEL_MCP_WRITE_CONCURRENCY, 5);
    assert.equal(cfg.GAVRIEL_2FA_CODE, undefined);
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});
