import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerAccountTools } from "../dist/tools/accounts.js";
import { registerSearchTools } from "../dist/tools/search.js";
import { registerDeviceBatchTools, planDevices } from "../dist/tools/devicesBatch.js";
import { setDestructiveApproval } from "../dist/tools/writeHelpers.js";

setDestructiveApproval("off");

function setup(gets = {}) {
  const tools = {};
  const server = { registerTool: (n, c, cb) => { tools[n] = { c, cb }; } };
  const calls = [];
  const client = {
    get: async (path, params) => { calls.push(["GET", path, params]); const d = gets[path]; return { status: d ? 200 : 404, data: d }; },
    post: async (path, body) => { calls.push(["POST", path, body]); return { status: 201, data: {} }; },
    patch: async (path, body) => { calls.push(["PATCH", path, body]); return { status: 200, data: {} }; },
    delete: async () => ({ status: 200, data: {} }),
  };
  registerSearchTools(server, client);
  registerAccountTools(server, client, "full");
  registerDeviceBatchTools(server, client, "full");
  const ctx = { mcpReq: { signal: undefined, _meta: {}, notify: async () => {} } };
  const run = async (name, args) => {
    const t = tools[name];
    const r = await t.cb(t.c.inputSchema.parse ? t.c.inputSchema.parse(args) : args, ctx);
    return JSON.parse(r.content[0].text);
  };
  return { run, calls, tools };
}

test("search_accounts exact: normaliza y filtra por número exacto", async () => {
  const s = setup({ "/accounts": { data: [
    { id: "a", accountNumber: "0000003150", name: "A" },
    { id: "b", accountNumber: "0000031501", name: "B" },
  ] } });
  const out = await s.run("search_accounts", { query: "3150", exact: true, limit: 10 });
  assert.deepEqual(out.map((x) => x.id), ["a"]);
  assert.equal(s.calls[0][2].search, "0000003150");
  const loose = await s.run("search_accounts", { query: "3150", limit: 10 });
  assert.equal(loose.length, 2);
});

test("list_account_devices: lean por defecto, full y fields", async () => {
  const dev = { id: "d1", serialNumber: "S1", zoneId: "z", deviceBrand: { id: "b", name: "Hik", logo: "x" }, junk: { big: 1 } };
  const s = setup({ "/accounts/1/devices": [dev] });
  const [lean] = await s.run("list_account_devices", { id: "1" });
  assert.deepEqual(lean, { id: "d1", serialNumber: "S1", zoneId: "z", deviceBrand: { id: "b", name: "Hik" } });
  const [full] = await s.run("list_account_devices", { id: "1", full: true });
  assert.ok(full.junk);
  const [sel] = await s.run("list_account_devices", { id: "1", fields: ["junk"] });
  assert.deepEqual(Object.keys(sel), ["junk"]);
});

test("list_account_zones: sin account por defecto, opt-in", async () => {
  const s = setup({ "/zones/account/1": [{ id: "z1", code: "01", account: { id: "1" } }] });
  assert.equal((await s.run("list_account_zones", { id: "1" }))[0].account, undefined);
  assert.ok((await s.run("list_account_zones", { id: "1", include: ["account"] }))[0].account);
  assert.ok((await s.run("list_account_zones", { id: "1", full: true }))[0].account);
});

const existing = [
  { id: "d1", serialNumber: "S1", deviceModelId: "m1", chip1: "111" },
  { id: "d2", serialNumber: "S2", deviceModelId: "m1" },
];

test("planDevices: diff altas vs cambios vs sin cambios", () => {
  const p = planDevices(existing, [
    { serialNumber: "S1", chip1: "222" },
    { serialNumber: "S2", deviceModelId: "m1" },
    { serialNumber: "S3", deviceBrandId: "b1" },
  ]);
  assert.equal(p.creates.length, 1);
  assert.deepEqual(p.updates, [{ id: "d1", serialNumber: "S1", body: { chip1: "222" } }]);
  assert.equal(p.noops, 1);
});

test("bulk_upsert: sin confirm = un preview y cero escrituras", async () => {
  const s = setup({ "/accounts/9/devices": existing });
  const out = await s.run("bulk_upsert_account_devices", {
    accountId: "9",
    devices: [{ serialNumber: "S1", chip1: "222" }, { serialNumber: "S3", deviceBrandId: "b1" }],
  });
  assert.equal(out.preview, true);
  assert.deepEqual(s.calls.map((c) => c[0]), ["GET"]);
});

test("bulk_upsert: confirm ejecuta POST y PATCH con summary", async () => {
  const s = setup({ "/accounts/9/devices": existing });
  const out = await s.run("bulk_upsert_account_devices", {
    accountId: "9", confirm: true,
    devices: [{ serialNumber: "S1", chip1: "222" }, { serialNumber: "S3", deviceBrandId: "b1" }],
  });
  assert.deepEqual(out.data?.summary ?? out.summary, { total: 2, ok: 2, failed: 0 });
  assert.deepEqual(s.calls.filter((c) => c[0] !== "GET").map((c) => c[0]).sort(), ["PATCH", "POST"]);
});

test("bulk_upsert: tope de 50 y alta sin brand rechazada", async () => {
  const s = setup({ "/accounts/9/devices": [] });
  const t = s.tools.bulk_upsert_account_devices;
  const many = Array.from({ length: 51 }, (_, i) => ({ serialNumber: `S${i}`, deviceBrandId: "b" }));
  assert.equal(z.object(t.c.inputSchema).safeParse({ accountId: "9", devices: many }).success, false);
  const r = await t.cb({ accountId: "9", devices: [{ serialNumber: "X" }], confirm: true }, { mcpReq: { _meta: {} } });
  assert.equal(r.isError, true);
  assert.ok(!s.calls.some((c) => c[0] === "POST"));
});
