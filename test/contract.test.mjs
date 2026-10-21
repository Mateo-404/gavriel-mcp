import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP = join(ROOT, "test", "tools.snapshot.json");

test("contrato: tools/list por stdio coincide con el snapshot", async () => {
  const env = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    GAVRIEL_EMAIL: "fake@example.com",
    GAVRIEL_PASSWORD: "fake",
    GAVRIEL_API_BASE: "https://localhost:9",
    GAVRIEL_MCP_ROLE: "full",
    GAVRIEL_MCP_LOG_DIR: mkdtempSync(join(tmpdir(), "gavriel-contract-")),
  };
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist", "index.js")], env, cwd: ROOT });
  const client = new Client({ name: "contract", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "nombres duplicados");
    for (const t of tools) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/);
      assert.equal(typeof t.annotations?.readOnlyHint, "boolean", `${t.name}: falta annotations.readOnlyHint`);
    }
    const current = tools
      .map((t) => ({ name: t.name, inputSchema: t.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (process.env.UPDATE_SNAPSHOT === "1") {
      writeFileSync(SNAP, JSON.stringify(current, null, 2) + "\n");
      return;
    }
    assert.deepEqual(current, JSON.parse(readFileSync(SNAP, "utf8")), "snapshot desactualizado: UPDATE_SNAPSHOT=1 pnpm test");
  } finally {
    await client.close();
  }
});
