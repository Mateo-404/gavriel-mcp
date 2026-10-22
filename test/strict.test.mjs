import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildServer } from "../dist/server.js";

// Cliente falso: las tools de preview (sin confirm) no tocan la red.
const fakeClient = new Proxy({}, { get: () => async () => ({}) });

async function connect() {
  const server = buildServer(fakeClient, "full");
  server.registerTool("t_raw", { inputSchema: { name: z.string() } }, async (a) => ({ content: [{ type: "text", text: `raw:${a.name}` }] }));
  server.registerTool("t_obj", { inputSchema: z.object({ name: z.string() }) }, async (a) => ({ content: [{ type: "text", text: `obj:${a.name}` }] }));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "strict", version: "0.0.0" });
  await client.connect(ct);
  return { client, server };
}

// Error de validación: isError o JSON-RPC invalid-params; en ambos casos devolvemos el texto.
async function callText(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, text: r.content?.[0]?.text ?? "" };
  } catch (e) {
    return { isError: true, text: String(e.message) };
  }
}

test("strict: clave desconocida rechazada con 'did you mean'", async () => {
  const { client } = await connect();
  try {
    const r = await callText(client, "create_ticket", { title: "x", confrim: true });
    assert.ok(r.isError);
    assert.match(r.text, /confrim/);
    assert.match(r.text, /quisiste decir "confirm"/);
  } finally { await client.close(); }
});

test("strict: llamada válida sigue dando preview", async () => {
  const { client } = await connect();
  try {
    const r = await callText(client, "create_ticket", { title: "x" });
    assert.ok(!r.isError, r.text);
  } finally { await client.close(); }
});

test("strict: raw shape y z.object son estrictos; JSON Schema con additionalProperties:false", async () => {
  const { client } = await connect();
  try {
    for (const n of ["t_raw", "t_obj"]) {
      assert.match((await callText(client, n, { name: "a" })).text, /^(raw|obj):a$/);
      const bad = await callText(client, n, { name: "a", extra: 1 });
      assert.ok(bad.isError);
      assert.match(bad.text, /extra/);
    }
    const { tools } = await client.listTools();
    for (const n of ["t_raw", "t_obj", "create_ticket"]) {
      assert.equal(tools.find((t) => t.name === n).inputSchema.additionalProperties, false, n);
    }
  } finally { await client.close(); }
});
