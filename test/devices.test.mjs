import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { registerDeviceTools, withTaxonomyWarning } from "../dist/tools/devices.js";
import { setLogDir, flushLogs } from "../dist/auditLog.js";

const logDir = mkdtempSync(join(tmpdir(), "gavriel-devices-"));
setLogDir(logDir);
after(async () => { await flushLogs(); rmSync(logDir, { recursive: true, force: true }); });

const calls = [];
let nextData = { id: "d1" };
const client = {
  email: "t@t",
  async post(path, body) { calls.push({ method: "POST", path, body }); return { status: 200, data: nextData }; },
  async patch(path, body) { calls.push({ method: "PATCH", path, body }); return { status: 200, data: nextData }; },
  async delete() { return { status: 200, data: {} }; },
  async get() { return { status: 200, data: {} }; },
};
const tools = {};
registerDeviceTools({ registerTool: (name, cfg, cb) => { tools[name] = { cfg, cb }; } }, client, "full");

// Parsea con el schema de la tool (aplica defaults, rechaza enums inválidos) y ejecuta el handler.
async function call(name, input) {
  const args = z.object(tools[name].cfg.inputSchema).parse(input);
  const r = await tools[name].cb(args, {});
  return { r, json: r.isError ? JSON.parse(r.content[0].text) : JSON.parse(r.content[0].text) };
}
const FULL = {
  serialNumber: "SN1", zoneId: "z1", deviceModelId: "m1", deviceConnectionTypeId: "c1", deviceKindId: "k1",
  alertType: "Sonora", ownershipType: "comodato", chip1: "111", chip2: "222", imei: "999", moduleBrand: "QL", moduleModel: "GL320",
  cloudDeviceId: "cd1", hctCameraResourceId: "cam1", cloudChannelNo: 2, deviceTaxonomyId: "t1",
  hppDeviceCategory: "Cat", hppDeviceSubCategory: "Sub", cloudLiveViewVerification: "ABC123", clearCloudLiveViewSecret: false,
};

test("create_device: body con el set completo de campos", async () => {
  calls.length = 0;
  await call("create_device", { accountId: "a1", deviceBrandId: "b1", ...FULL, confirm: true });
  assert.deepEqual(calls[0], { method: "POST", path: "/accounts/a1/devices", body: { deviceBrandId: "b1", ...FULL } });
});

test("create_device: serialNumber y deviceModelId opcionales", async () => {
  calls.length = 0;
  await call("create_device", { accountId: "a1", deviceBrandId: "b1", confirm: true });
  assert.deepEqual(calls[0].body, { deviceBrandId: "b1" });
});

test("create_device: alertType fuera del enum se rechaza", async () => {
  await assert.rejects(call("create_device", { accountId: "a1", deviceBrandId: "b1", alertType: "Otra" }));
});

test("update_device: body parcial con zoneId/modelo/serie", async () => {
  calls.length = 0;
  await call("update_device", { accountId: "a1", deviceId: "d1", zoneId: "z9", serialNumber: "S", deviceModelId: "m2", confirm: true });
  assert.deepEqual(calls[0], { method: "PATCH", path: "/accounts/a1/devices/d1", body: { serialNumber: "S", deviceModelId: "m2", zoneId: "z9" } });
});

test("update_device: clear[] envía null explícito; clearChip2 legacy sigue andando", async () => {
  calls.length = 0;
  await call("update_device", { accountId: "a1", deviceId: "d1", clear: ["chip2", "imei"], clearChip1: true, chip2: "ignorado", confirm: true });
  assert.deepEqual(calls[0].body, { chip1: null, chip2: null, imei: null });
});

test("update_device: clear[] rechaza campos fuera de la whitelist (y el secreto)", async () => {
  calls.length = 0;
  for (const bad of ["foo", "cloudLiveViewVerification", "accountId"]) {
    const { r, json } = await call("update_device", { accountId: "a1", deviceId: "d1", clear: [bad], confirm: true });
    assert.equal(r.isError, true);
    assert.match(json.error, new RegExp(bad));
  }
  assert.equal(calls.length, 0);
});

test("update_zone: vincula equipo y clear[] con whitelist", async () => {
  calls.length = 0;
  await call("update_zone", { zoneId: "z1", serialNumber: "S", deviceModelId: "m", deviceBrandId: "b", clear: ["sensorType"], confirm: true });
  assert.deepEqual(calls[0], { method: "PATCH", path: "/zones/z1", body: { sensorType: null, serialNumber: "S", deviceBrandId: "b", deviceModelId: "m" } });
  const { r } = await call("update_zone", { zoneId: "z1", clear: ["code"], confirm: true });
  assert.equal(r.isError, true);
});

test("create_zone: body con serie/modelo/marca", async () => {
  calls.length = 0;
  await call("create_zone", { accountId: "a1", code: "1", name: "Z", serialNumber: "S", deviceBrandId: "b", deviceModelId: "m", confirm: true });
  assert.deepEqual(calls[0], { method: "POST", path: "/zones", body: { accountId: "a1", code: "1", name: "Z", serialNumber: "S", deviceBrandId: "b", deviceModelId: "m" } });
});

test("preview oculta cloudLiveViewVerification y no ejecuta", async () => {
  calls.length = 0;
  const { json } = await call("create_device", { accountId: "a1", deviceBrandId: "b1", cloudLiveViewVerification: "TOPSECRET" });
  assert.equal(json.preview, true);
  assert.equal(json.body.cloudLiveViewVerification, "[REDACTED]");
  assert.ok(!JSON.stringify(json).includes("TOPSECRET"));
  assert.equal(calls.length, 0);
});

test("writes.log y salida no filtran cloudLiveViewVerification", async () => {
  const { r } = await call("update_device", { accountId: "a1", deviceId: "d1", cloudLiveViewVerification: "TOPSECRET2", clearCloudLiveViewSecret: true, confirm: true });
  await flushLogs();
  const log = readFileSync(join(logDir, "writes.log"), "utf8");
  assert.ok(log.includes("update_device"));
  assert.ok(!log.includes("TOPSECRET2"));
  assert.ok(log.includes('"clearCloudLiveViewSecret":true'));
  assert.ok(!r.content[0].text.includes("TOPSECRET2"));
});

test("hik_cloud_lookup: warning si falta deviceTaxonomyId", async () => {
  nextData = { found: true, deviceName: "X", cloudDeviceId: "c", deviceCategory: "hik_2", deviceSubCategory: "hik_2_20" };
  const { json } = await call("hik_cloud_lookup", { accountId: "a1", deviceBrandId: "b", serialNumber: "S", confirm: true });
  assert.match(json.warnings[0], /no existe en el cat/);
  assert.match(json.warnings[0], /hik_2_20/);
  assert.match(json.warnings[0], /device-taxonomies/);
  nextData = { id: "d1" };
});

test("withTaxonomyWarning: sin warning si hay taxonomía o no se encontró", () => {
  const withTax = { data: { found: true, deviceTaxonomyId: "t" } };
  assert.equal(withTaxonomyWarning(withTax), withTax);
  const notFound = { data: { found: false } };
  assert.equal(withTaxonomyWarning(notFound), notFound);
});
