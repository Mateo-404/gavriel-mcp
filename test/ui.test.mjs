import { test } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../dist/cli/ui.js";
import { LOGO_DOTS, LOGO_COLS, LOGO_LINES } from "../dist/cli/logo.js";

const KEYS = ["NO_COLOR", "FORCE_COLOR", "COLORTERM", "TERM", "TERM_PROGRAM", "WT_SESSION", "CI", "GAVRIEL_PLAIN", "GAVRIEL_ASCII", "GAVRIEL_NO_ANIM", "GAVRIEL_THEME", "COLORFGBG", "GAVRIEL_LOGO"];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const tty = (cols = 80) => ({ isTTY: true, columns: cols, write: () => true });
const pipe = () => ({ isTTY: false, write: () => true });
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

test("ui: política de color (NO_COLOR, FORCE_COLOR, TTY, plain)", () => {
  withEnv({ COLORTERM: "truecolor" }, () => assert.equal(ui.colorLevel(tty()), 3));
  withEnv({ COLORTERM: "truecolor", NO_COLOR: "1" }, () => assert.equal(ui.colorLevel(tty()), 0));
  withEnv({ NO_COLOR: "1", FORCE_COLOR: "3" }, () => assert.equal(ui.colorLevel(pipe()), 3)); // opt-in explícito
  withEnv({ COLORTERM: "truecolor" }, () => assert.equal(ui.colorLevel(pipe()), 0)); // sin TTY no hay color
  withEnv({ TERM: "xterm-256color" }, () => assert.equal(ui.colorLevel(tty()), 2));
  withEnv({ COLORTERM: "truecolor", GAVRIEL_PLAIN: "1" }, () => assert.equal(ui.colorLevel(tty()), 0));
  withEnv({ TERM: "dumb" }, () => assert.equal(ui.colorLevel(tty()), 0));
});

test("ui: animaciones solo en TTY y sin CI / movimiento reducido", () => {
  withEnv({ TERM: "xterm" }, () => assert.equal(ui.animationsOn(tty()), true));
  withEnv({ TERM: "xterm" }, () => assert.equal(ui.animationsOn(pipe()), false));
  withEnv({ TERM: "xterm", CI: "true" }, () => assert.equal(ui.animationsOn(tty()), false));
  withEnv({ TERM: "xterm", GAVRIEL_NO_ANIM: "1" }, () => assert.equal(ui.animationsOn(tty()), false));
});

test("ui: glifos ASCII de respaldo", () => {
  withEnv({ GAVRIEL_ASCII: "1" }, () => {
    const g = ui.glyphs();
    assert.equal(g.ok, "ok");
    assert.equal(g.tl, "+");
    assert.equal(strip(ui.line("fail", "msg", tty())), "x msg");
  });
  withEnv({ TERM: "xterm", WT_SESSION: "1" }, () => assert.equal(ui.glyphs().ok, "✔"));
});

test("ui: ancho en celdas y truncado por grafema", () => {
  assert.equal(ui.visibleWidth("abc"), 3);
  assert.equal(ui.visibleWidth("日本語"), 6);
  assert.equal(ui.visibleWidth("e\u0301"), 1); // combinante
  assert.equal(ui.visibleWidth("\x1b[31mrojo\x1b[0m"), 4);
  withEnv({ GAVRIEL_ASCII: "1" }, () => assert.equal(ui.truncate("abcdefghij", 6), "abc..."));
  withEnv({ TERM: "xterm", WT_SESSION: "1" }, () => {
    const t = ui.truncate("a日本語b", 5);
    assert.ok(ui.visibleWidth(t) <= 5, t);
    assert.ok(t.endsWith("…"));
    const emoji = ui.truncate("hola 👨‍👩‍👧 mundo", 7);
    assert.ok(!emoji.includes("\u200d") || emoji.includes("👨‍👩‍👧"), "no parte secuencias ZWJ");
  });
});

test("ui: stripControl elimina secuencias de escape de datos remotos", () => {
  assert.equal(ui.stripControl("ok\x1b[31m rojo\x1b[0m"), "ok rojo");
  assert.equal(ui.stripControl("a\x1b]0;título\x07b"), "ab");
  assert.equal(ui.stripControl("lin1\nlin2\tx\x00y"), "lin1 lin2 xy");
});

test("ui: tabla alineada, saneada y con ancho acotado", () => {
  withEnv({ TERM: "xterm", WT_SESSION: "1" }, () => {
    const rows = [{ n: "uno\x1b[2J", d: "日本語 largo largo largo largo largo" }, { n: "dos", d: "x" }];
    const cols = [{ title: "n", value: (r) => r.n }, { title: "d", value: (r) => r.d }];
    const out = ui.table(rows, cols, { isTTY: false, columns: 40, write: () => true });
    assert.ok(!out.includes("\x1b"), "sin secuencias de control");
    const widths = out.split("\n").map((l) => ui.visibleWidth(l));
    assert.ok(new Set(widths).size === 1, `todas las líneas miden lo mismo: ${widths}`);
    assert.ok(widths[0] <= 40, `cabe en 40 columnas: ${widths[0]}`);
    assert.match(out, /^╭/);
  });
});

test("ui: logo bien formado y banner sin arte fuera de TTY", async () => {
  assert.equal(LOGO_DOTS.length % 4, 0);
  assert.equal(LOGO_LINES, LOGO_DOTS.length / 4);
  assert.ok(LOGO_DOTS.every((r) => r.length === LOGO_COLS * 2 && /^[.LW]+$/.test(r)));
  assert.ok(LOGO_DOTS.some((r) => r.includes("L")) && LOGO_DOTS.some((r) => r.includes("W")));
  const chunks = [];
  const stream = { isTTY: false, columns: 80, write: (s) => { chunks.push(s); return true; } };
  await withEnv({}, () => ui.banner({ stream, version: "9.9.9" }));
  const text = chunks.join("");
  assert.equal(text.trim().split("\n").length, 1);
  assert.match(text, /gavriel 9\.9\.9/);
});

test("ui: modos del logo (blocks, braille, text, none)", async () => {
  const draw = async (mode) => {
    const chunks = [];
    const stream = { isTTY: true, columns: 100, write: (s) => { chunks.push(s); return true; } };
    await withEnv({ FORCE_COLOR: "3", TERM: "xterm", WT_SESSION: "1", GAVRIEL_LOGO: mode }, () => ui.banner({ stream, animate: false }));
    return strip(chunks.join(""));
  };
  const blocks = await draw("blocks");
  assert.match(blocks, /[▀▄█]/);
  assert.ok(!/[⠁-⣿]/.test(blocks));
  assert.match(await draw("braille"), /[⠁-⣿]/);
  const text = await draw("text");
  assert.match(text, /╔═╗/);
  assert.ok(text.split("\n").filter((l) => l.trim()).length <= 5);
  const none = await draw("none");
  assert.equal(none.trim().split("\n").length, 1);
  assert.equal(withEnv({}, () => ui.logoMode()), "blocks");
});

test("ui: banner con arte en TTY ocupa una línea por dos filas y no desborda", async () => {
  const chunks = [];
  const stream = { isTTY: true, columns: 100, write: (s) => { chunks.push(s); return true; } };
  await withEnv({ FORCE_COLOR: "3", TERM: "xterm", WT_SESSION: "1", CI: "1" }, () => ui.banner({ stream, animate: false }));
  const lines = strip(chunks.join("")).split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= LOGO_LINES);
  assert.ok(lines.every((l) => ui.visibleWidth(l) <= LOGO_COLS + 2 || /Monitoreo/.test(l)));
});

test("ui: json sin color es JSON válido y con color conserva el contenido", () => {
  const v = { a: 1, b: "x", c: [true, null], d: { e: 2.5 } };
  withEnv({}, () => assert.equal(ui.json(v, pipe()), JSON.stringify(v, null, 2)));
  withEnv({ FORCE_COLOR: "3" }, () => {
    const colored = ui.json(v, pipe());
    assert.ok(colored.includes("\x1b["));
    assert.deepEqual(JSON.parse(strip(colored)), v);
  });
});

test("ui: fechas, estados y barra", () => {
  assert.match(ui.shortDate("2026-10-21T14:05:00Z"), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(ui.shortDate("texto"), "texto");
  assert.equal(ui.statusSlot("in_progress"), "warn");
  assert.equal(ui.prioritySlot("critical"), "err");
  assert.equal(ui.statusSlot("desconocido"), undefined);
  withEnv({ GAVRIEL_ASCII: "1" }, () => {
    for (const r of [0, 0.3, 1]) assert.equal(ui.visibleWidth(strip(ui.bar(r, 20, pipe()))), 20);
  });
});

test("ui: tema claro con COLORFGBG o GAVRIEL_THEME", () => {
  const dark = withEnv({ FORCE_COLOR: "3" }, () => ui.painter(pipe()).paint("brand", "x"));
  const light = withEnv({ FORCE_COLOR: "3", GAVRIEL_THEME: "light" }, () => ui.painter(pipe()).paint("brand", "x"));
  assert.notEqual(dark, light);
  const auto = withEnv({ FORCE_COLOR: "3", COLORFGBG: "0;15" }, () => ui.painter(pipe()).paint("brand", "x"));
  assert.equal(auto, light);
});
