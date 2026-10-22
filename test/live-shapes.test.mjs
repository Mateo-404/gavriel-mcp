import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerCompositeTools } from "../dist/tools/composites.js";

// Regresiones del barrido contra la API real (valores ficticios, formas reales):
//  - GET /tickets rechaza `status` como lista (400): una consulta por estado.
//  - GET /events-codes (lista) responde 500: los códigos salen de /events-formats/{id}.eventsCodes.
//  - connection-health-logs tarda ~16 s en el backend: el reporte offline usa lastHeartbeatAt y lo pide solo con includeHealth.
//  - disk-space de un bridge sin conexión responde 400: es un dato, no una advertencia.
function setup(gets) {
  const tools = {};
  const server = { registerTool: (n, c, cb) => { tools[n] = { c, cb }; } };
  const calls = [];
  const client = {
    get: async (path, params) => {
      calls.push([path, params]);
      const h = gets[path] ?? gets[path.replace(/\/[^/]+$/, "/*")];
      const d = typeof h === "function" ? h(params) : h;
      return d === undefined ? { status: 404, data: {} } : d.status ? d : { status: 200, data: d };
    },
  };
  registerCompositeTools(server, client, "full");
  const ctx = { mcpReq: { signal: undefined, _meta: {}, notify: async () => {} } };
  const run = async (name, args = {}) => {
    const t = tools[name];
    const shape = t.c.inputSchema;
    const parsed = shape.parse ? shape.parse(args) : z.object(shape).parse(args);
    return JSON.parse((await t.cb(parsed, ctx)).content[0].text);
  };
  return { run, calls };
}

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

test("sla_overdue_tickets: consulta cada estado por separado (nunca status como lista) y une los resultados", async () => {
  const byStatus = {
    open: [{ id: "1", title: "a", priority: "high", status: "open", createdAt: hoursAgo(200), closedAt: null }],
    in_progress: [{ id: "2", title: "b", priority: "low", status: "in_progress", createdAt: hoursAgo(100), closedAt: null }],
    pending_customer: [{ id: "3", title: "c", priority: "low", status: "pending_customer", createdAt: hoursAgo(1), closedAt: null }],
  };
  const s = setup({
    "/tickets": (p) => ({ data: byStatus[p.status] ?? [], meta: { pagination: { total: 1, hasNextPage: false } } }),
    "/activities/ticket/*": { data: [] },
  });
  const out = await s.run("sla_overdue_tickets", { olderThanHours: 48, limit: 10 });
  const ticketCalls = s.calls.filter(([p]) => p === "/tickets");
  assert.deepEqual(ticketCalls.map(([, p]) => p.status).sort(), ["in_progress", "open", "pending_customer"]);
  assert.ok(ticketCalls.every(([, p]) => typeof p.status === "string"), "status siempre escalar");
  assert.equal(out.error, undefined);
  assert.deepEqual((out.tickets ?? []).map((t) => String(t.id)), ["1", "2"], "el más viejo primero; el reciente queda fuera");
});

test("sla_overdue_tickets: falla claro solo si ningún estado se pudo listar", async () => {
  const s = setup({ "/tickets": { status: 400, data: {} } });
  const out = await s.run("sla_overdue_tickets", {});
  assert.match(out.error, /No se pudieron listar tickets/);
});

test("triage_events: los códigos vienen de /events-formats/{id} y nunca se pide /events-codes", async () => {
  const s = setup({
    "/events/accounts-with-pending-events": [{ id: "10", pendingEvents: 3 }],
    "/events-formats": { data: [{ id: "f1" }], meta: {} },
    "/events-formats/*": { id: "f1", eventsCodes: [{ id: "c1", code: "E130", name: "Robo" }] },
    "/events": { data: [], meta: {} },
    "/accounts/*": { id: "10", name: "Cuenta" },
  });
  const out = await s.run("triage_events", { limit: 3 });
  assert.ok(!s.calls.some(([p]) => p === "/events-codes"), "GET /events-codes responde 500 en el backend");
  assert.ok(s.calls.some(([p]) => p === "/events-formats/f1"));
  assert.deepEqual(out.warnings ?? [], []);
});

test("offline_devices_report: usa lastHeartbeatAt, no pide health logs por defecto y un bridge caído no es una advertencia", async () => {
  const s = setup({
    "/connections": { data: [
      { id: "c1", name: "ok", bridgeId: "b1", lastHeartbeatAt: hoursAgo(0.01) },
      { id: "c2", name: "viejo", bridgeId: "b1", lastHeartbeatAt: hoursAgo(5) },
    ], meta: { pagination: { total: 2, hasNextPage: false } } },
    "/monitoring/bridge-health-logs": { data: [], meta: {} },
    "/bridges/b1/disk-space": { status: 400, data: { message: "No se pudo conectar al bridge" } },
  });
  const out = await s.run("offline_devices_report", { staleMinutes: 60 });
  assert.ok(!s.calls.some(([p]) => p === "/monitoring/connection-health-logs"));
  assert.equal(out.staleCount, 1);
  assert.deepEqual(out.warnings ?? [], []);
  assert.match(String(out.bridges[0].diskSpace), /no disponible/);
  await s.run("offline_devices_report", { staleMinutes: 60, includeHealth: true });
  assert.ok(s.calls.some(([p]) => p === "/monitoring/connection-health-logs"), "con includeHealth sí se pide");
});
