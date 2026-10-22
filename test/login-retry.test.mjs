import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Login interactivo con un terminal simulado y una API falsa: un password incorrecto permite reintentar.
// Usa DPAPI (aislado en un APPDATA temporal), así que solo corre en Windows.
test("login: password incorrecto → reintenta sin salir, y no guarda nada hasta acertar", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gavriel-retry-"));
  const saved = { APPDATA: process.env.APPDATA, GAVRIEL_CONFIG_DIR: process.env.GAVRIEL_CONFIG_DIR, GAVRIEL_NO_ANIM: process.env.GAVRIEL_NO_ANIM };
  process.env.APPDATA = join(dir, "appdata");
  process.env.GAVRIEL_CONFIG_DIR = join(dir, "cfg");
  process.env.GAVRIEL_NO_ANIM = "1";
  const attempts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body || "{}");
      attempts.push(b.password);
      res.setHeader("content-type", "application/json");
      if (b.password === "Pw-ok") res.end(JSON.stringify({ access_token: "a.b.c", user: { email: b.email } }));
      else { res.statusCode = 401; res.end(JSON.stringify({ message: "Credenciales inválidas" })); }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const { login } = await import("../dist/cli/commands.js");
  const { loadStore } = await import("../dist/profiles.js");
  const { resolvePassword } = await import("../dist/secrets.js");

  // stdin simulado: TTY con modo raw; cada vez que aparece el prompt de password se tipean los caracteres.
  const stdin = process.stdin;
  const orig = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  const answers = ["Pw-uno", "Pw-dos", "Pw-ok"];
  const origWrite = process.stderr.write.bind(process.stderr);
  const stderrText = [];
  process.stderr.write = (chunk, ...rest) => {
    const s = String(chunk);
    stderrText.push(s);
    if (/Password/.test(s) && answers.length) {
      const a = answers.shift();
      setImmediate(() => stdin.emit("data", `${a}\r`));
    }
    return typeof rest.at(-1) === "function" ? rest.at(-1)() : true;
  };
  try {
    await login({ values: { email: "retry@x.com", "api-base": base, json: true, "no-anim": true }, args: [] });
  } finally {
    process.stderr.write = origWrite;
    stdin.isTTY = orig.isTTY;
    stdin.setRawMode = orig.setRawMode;
    await new Promise((r) => server.close(r));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  try {
    assert.deepEqual(attempts, ["Pw-uno", "Pw-dos", "Pw-ok"]);
    const err = stderrText.join("");
    assert.match(err, /Email o password incorrectos \(intento 1\/5\)/);
    assert.match(err, /\(intento 2\/5\)/);
    assert.ok(!err.includes("Pw-uno") && !err.includes("Pw-ok"), "el password nunca se muestra");
    assert.equal((err.match(/\*/g) ?? []).length, "Pw-uno".length + "Pw-dos".length + "Pw-ok".length);
    process.env.APPDATA = join(dir, "appdata");
    process.env.GAVRIEL_CONFIG_DIR = join(dir, "cfg");
    assert.equal(resolvePassword("retry@x.com", true), "Pw-ok");
    assert.equal(loadStore().active, "retry");
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});
