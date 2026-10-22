import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regresión del issue #23: el .env junto a la raíz del proyecto se lee aunque el server arranque desde otro cwd
// y la ruta tenga letra de unidad y espacios (Windows). Se copia dist/ a un proyecto temporal DENTRO del repo
// para que resuelva node_modules; el cwd del proceso es otro directorio.
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function project(dotenv) {
  const dir = mkdtempSync(join(ROOT, ".tmp-dotenv test-"));
  made.push(dir);
  cpSync(join(ROOT, "dist"), join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, ".env"), dotenv);
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  return dir;
}

function loadFrom(dir, env = {}) {
  const code = `const m = await import(${JSON.stringify(`file:///${join(dir, "dist", "config.js").replaceAll("\\", "/")}`)});
    const c = m.loadConfig();
    console.log(JSON.stringify({ email: c.GAVRIEL_EMAIL, base: c.GAVRIEL_API_BASE }));`;
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GAVRIEL_")));
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: tmpdir(), env: { ...clean, GAVRIEL_CONFIG_DIR: join(dir, "cfg"), GAVRIEL_ALLOW_PLAINTEXT: "1", ...env }, encoding: "utf8",
  });
}

test(".env de la raíz del proyecto se lee desde otro cwd (ruta con espacios y unidad)", () => {
  const dir = project("GAVRIEL_EMAIL=dotenv@test.invalid\nGAVRIEL_PASSWORD=pw-dotenv\n");
  try {
    const r = loadFrom(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { email: "dotenv@test.invalid", base: "https://app.gavriel.com.ar/api" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(".env no pisa el entorno real y no puede cambiar GAVRIEL_API_BASE sin opt-in", () => {
  const dir = project("GAVRIEL_EMAIL=dotenv@test.invalid\nGAVRIEL_PASSWORD=pw\nGAVRIEL_API_BASE=https://evil.example/api\n");
  try {
    const r = loadFrom(dir, { GAVRIEL_EMAIL: "real@test.invalid" });
    assert.notEqual(r.status, 0, "una API base personalizada que viene de un .env se rechaza");
    assert.match(r.stderr, /GAVRIEL_API_BASE/);
    const ok = loadFrom(project("GAVRIEL_EMAIL=dotenv@test.invalid\nGAVRIEL_PASSWORD=pw\n"), { GAVRIEL_EMAIL: "real@test.invalid" });
    assert.equal(JSON.parse(ok.stdout).email, "real@test.invalid", "la variable real gana al .env");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sin .env y sin variables falla con un mensaje claro", () => {
  const dir = project("# vacío\n");
  try {
    const r = loadFrom(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /GAVRIEL_EMAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
