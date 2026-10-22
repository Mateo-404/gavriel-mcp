import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { select } from "../dist/cli/menu.js";
import { askHidden, InputError } from "../dist/cli/io.js";

// Terminal simulada: stdin TTY con modo raw y teclas emitidas a mano, salida capturada.
function fakeTerm() {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    raw: false,
    setRawMode(v) { this.raw = v; },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  const chunks = [];
  const out = { isTTY: true, columns: 80, write: (s) => { chunks.push(s); return true; } };
  const press = (...keys) => { for (const k of keys) stdin.emit("data", k); };
  const text = () => chunks.join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  return { stdin, out, press, text, chunks };
}
const ITEMS = [{ label: "Uno", value: 1 }, { label: "Dos", value: 2 }, { label: "Tres", value: 3, hint: "ayuda" }];
const DOWN = "\x1b[B", UP = "\x1b[A";

test("select: flechas y Enter eligen, y se restaura la terminal", async () => {
  const t = fakeTerm();
  const p = select("Elegí", ITEMS, { stdin: t.stdin, out: t.out });
  assert.equal(t.stdin.raw, true);
  t.press(DOWN, DOWN, UP, "\r");
  assert.equal(await p, 2);
  assert.equal(t.stdin.raw, false);
  const all = t.chunks.join("");
  assert.ok(all.includes("\x1b[?25l") && all.includes("\x1b[?25h"), "oculta y restaura el cursor");
  assert.match(t.text(), /Elegí.*Dos/);
});

test("select: j/k, números, home/end y envuelve en los extremos", async () => {
  let t = fakeTerm();
  let p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press(UP, "\r"); // desde el primero, ↑ va al último
  assert.equal(await p, 3);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("j", "j", "j", "\r"); // 3 pasos con 3 ítems vuelve al primero
  assert.equal(await p, 1);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("2");
  assert.equal(await p, 2);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("\x1b[F", "\r");
  assert.equal(await p, 3);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("9"); // fuera de rango: se ignora
  t.press("\r");
  assert.equal(await p, 1);
});

test("select: Esc y q cancelan sin valor; Ctrl-C rechaza con código 130", async () => {
  let t = fakeTerm();
  let p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("\x1b");
  assert.equal(await p, undefined);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("q");
  assert.equal(await p, undefined);
  t = fakeTerm();
  p = select("T", ITEMS, { stdin: t.stdin, out: t.out });
  t.press("\u0003");
  await assert.rejects(p, (e) => e instanceof InputError && e.exitCode === 130);
  assert.equal(t.stdin.raw, false);
});

test("select: la selección inicial y el redibujado conservan el foco", async () => {
  const t = fakeTerm();
  const p = select("T", ITEMS, { stdin: t.stdin, out: t.out, initial: 2 });
  t.press("\r");
  assert.equal(await p, 3);
});

test("select: sin terminal interactiva falla con un mensaje claro", async () => {
  const t = fakeTerm();
  t.stdin.isTTY = false;
  await assert.rejects(select("T", ITEMS, { stdin: t.stdin, out: t.out }), /terminal interactiva/);
});

test("askHidden: muestra * por carácter, nunca el texto, y borra con Backspace", async () => {
  const t = fakeTerm();
  const p = askHidden("Password > ", t.stdin, t.out);
  t.press("a", "b", "c", "\u007f", "d", "\r");
  assert.equal(await p, "abd");
  const shown = t.text();
  assert.ok(!/[abcd]/.test(shown.replace("Password", "").replace(/ > /, "")), `no filtra el texto: ${JSON.stringify(shown)}`);
  assert.equal((shown.match(/\*/g) ?? []).length, 4); // a b c d
  assert.ok(t.chunks.join("").includes("\b \b"), "Backspace borra el último *");
  assert.equal(t.stdin.raw, false);
});

test("askHidden: un paste entra completo, ignora flechas y Ctrl-C cancela", async () => {
  let t = fakeTerm();
  let p = askHidden("P ", t.stdin, t.out);
  t.press("secreto123", UP, "\r");
  assert.equal(await p, "secreto123");
  assert.equal((t.text().match(/\*/g) ?? []).length, 10);
  t = fakeTerm();
  p = askHidden("P ", t.stdin, t.out);
  t.press("abc", "\u0003");
  await assert.rejects(p, (e) => e instanceof InputError && e.exitCode === 130);
  assert.equal(t.stdin.raw, false);
});
