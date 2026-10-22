import { test } from "node:test";
import assert from "node:assert/strict";
import { tomlHas, tomlRemove, tomlUpsert, parseClients, opencodeEntry, configPath } from "../dist/cli/clients.js";
import { pathAdd, pathHas, pathRemove } from "../dist/cli/paths.js";

const ENTRY = { command: "C:\\Users\\Ana Pérez\\Programs\\Gavriel\\gavriel.exe", args: ["mcp", "serve"], env: { GAVRIEL_PROFILE: "ana", GAVRIEL_MCP_ROLE: "lite" } };

test("toml: upsert agrega la tabla sin tocar lo existente y es idempotente", () => {
  const base = `# mi config\nmodel = "o3"\n\n[mcp_servers.otro]\ncommand = "npx"\nargs = ["-y", "x"]\n\n[mcp_servers.otro.env]\nK = "v"\n`;
  const once = tomlUpsert(base, "gavriel", ENTRY);
  assert.ok(once.startsWith(base.trimEnd()), "conserva el contenido previo intacto");
  assert.ok(once.includes("[mcp_servers.gavriel]\ncommand = 'C:\\Users\\Ana Pérez\\Programs\\Gavriel\\gavriel.exe'\nargs = ['mcp', 'serve']"));
  assert.ok(once.includes("[mcp_servers.gavriel.env]\nGAVRIEL_PROFILE = 'ana'\nGAVRIEL_MCP_ROLE = 'lite'"));
  assert.equal(tomlUpsert(once, "gavriel", ENTRY), once, "aplicar dos veces no cambia nada");
  assert.ok(tomlHas(once, "gavriel") && tomlHas(once, "otro") && !tomlHas(once, "nada"));
});

test("toml: remove quita solo la entrada (y sus subtablas) y respeta variantes de encabezado", () => {
  const text = `[a]\nx = 1\n\n[mcp_servers."gavriel"]\ncommand = "a"\n\n[ mcp_servers.gavriel.env ]\nK = "v"\n\n[mcp_servers.gavriel2]\ncommand = "b"\n\n[[arr]]\nz = 1\n`;
  const r = tomlRemove(text, "gavriel");
  assert.equal(r.removed, true);
  assert.ok(!r.text.includes('command = "a"') && !r.text.includes('K = "v"'));
  assert.ok(r.text.includes("[mcp_servers.gavriel2]") && r.text.includes("[a]") && r.text.includes("[[arr]]"), "no confunde gavriel2 ni toca arrays de tablas");
  assert.equal(tomlRemove("[x]\ny=1\n", "gavriel").removed, false);
  assert.equal(tomlRemove(tomlUpsert("", "gavriel", ENTRY), "gavriel").text, "");
});

test("toml: valores con comillas simples o caracteres de control usan cadenas escapadas", () => {
  const out = tomlUpsert("", "g", { command: "C:\\it's\\g.exe", args: ["a\nb"], env: { K: 'v"w' } });
  assert.ok(out.includes('command = "C:\\\\it\'s\\\\g.exe"'), out);
  assert.ok(out.includes('args = ["a\\nb"]'), out);
  assert.ok(out.includes("K = 'v\"w'"), out);
});

test("clients: parseClients acepta lista, all y rechaza desconocidos", () => {
  assert.deepEqual(parseClients(undefined), ["desktop"]);
  assert.deepEqual(parseClients("codex,opencode"), ["codex", "opencode"]);
  assert.deepEqual(parseClients("all"), ["desktop", "codex", "opencode"]);
  assert.deepEqual(parseClients("codex,codex"), ["codex"]);
  assert.throws(() => parseClients("vscode"), /Cliente inválido: vscode/);
});

test("clients: formato de OpenCode y rutas con override por entorno", () => {
  assert.deepEqual(opencodeEntry(ENTRY), { type: "local", command: [ENTRY.command, "mcp", "serve"], environment: ENTRY.env, enabled: true });
  const saved = process.env.GAVRIEL_CODEX_CONFIG;
  process.env.GAVRIEL_CODEX_CONFIG = "C:/tmp/x.toml";
  try {
    assert.match(configPath("codex"), /x\.toml$/);
  } finally {
    if (saved === undefined) delete process.env.GAVRIEL_CODEX_CONFIG;
    else process.env.GAVRIEL_CODEX_CONFIG = saved;
  }
  assert.throws(() => configPath("code"));
});

test("paths: PATH se agrega, quita y compara sin duplicar", () => {
  const win = process.platform === "win32";
  const sep = win ? ";" : ":";
  const dir = win ? "C:\\Users\\a\\Programs\\Gavriel" : "/home/a/.local/bin";
  const base = ["C:\\x", "%USERPROFILE%\\bin", "/usr/bin"].join(sep);
  const added = pathAdd(base, dir);
  assert.ok(pathHas(added, dir));
  assert.equal(pathAdd(added, dir), added, "idempotente");
  assert.equal(pathAdd(added, dir + (win ? "\\" : "/")), added, "ignora la barra final");
  assert.equal(pathRemove(added, dir), base, "quitar deja el PATH como estaba (incluye %VARS%)");
  assert.equal(pathRemove(base, dir), base);
  if (win) assert.ok(pathHas(added, dir.toUpperCase()), "Windows no distingue mayúsculas");
});
