import { LOGO_COLS, LOGO_DOTS, LOGO_LINES, MARK_COLS } from "./logo.js";

// ── Capacidades de la terminal ───────────────────────────────────────────
// Orden de decisión (skill tui-design): preferencia explícita > NO_COLOR > TTY/TERM > detección de profundidad.
type Level = 0 | 1 | 2 | 3; // 0 sin color, 1 = 16, 2 = 256, 3 = truecolor
type Stream = NodeJS.WriteStream;

const overrides = { color: undefined as boolean | undefined, plain: false, anim: undefined as boolean | undefined };

/** Flags globales del CLI (--no-color, --plain, --no-anim). */
export function configure(o: { noColor?: boolean; plain?: boolean; noAnim?: boolean }): void {
  if (o.noColor) overrides.color = false;
  if (o.plain) overrides.plain = true;
  if (o.noAnim) overrides.anim = false;
}

const env = (k: string): string | undefined => process.env[k] || undefined;
const plainMode = (): boolean => overrides.plain || env("GAVRIEL_PLAIN") === "1";

export function colorLevel(stream: Stream): Level {
  if (plainMode() || overrides.color === false) return 0;
  const force = env("FORCE_COLOR");
  if (force !== undefined) return force === "0" || force === "false" ? 0 : force === "1" ? 1 : force === "2" ? 2 : 3;
  if (env("NO_COLOR")) return 0;
  if (!stream.isTTY || env("TERM") === "dumb") return 0;
  const ct = (env("COLORTERM") ?? "").toLowerCase();
  const prog = env("TERM_PROGRAM") ?? "";
  if (ct === "truecolor" || ct === "24bit" || env("WT_SESSION") || /iTerm|vscode|WezTerm|ghostty|Hyper|Tabby/i.test(prog)) return 3;
  if (process.platform === "win32" && !env("TERM")) return 3; // conhost/Windows Terminal modernos
  return (env("TERM") ?? "").includes("256") ? 2 : 1;
}

/** Sin animación en CI, pipes, TERM=dumb, --no-anim o GAVRIEL_NO_ANIM (movimiento reducido). */
export function animationsOn(stream: Stream): boolean {
  if (plainMode() || overrides.anim === false || env("GAVRIEL_NO_ANIM") || env("NO_MOTION") || env("CI")) return false;
  return Boolean(stream.isTTY) && env("TERM") !== "dumb";
}

// Consolas legacy de Windows (sin Windows Terminal/TERM) suelen romper Unicode: caer a ASCII.
export function unicodeOn(): boolean {
  if (plainMode() || env("GAVRIEL_ASCII") === "1") return false;
  if (process.platform === "win32") return Boolean(env("WT_SESSION") || env("TERM_PROGRAM") || env("TERM") || env("ConEmuANSI") || env("ANSICON"));
  return true;
}

// ── Paleta semántica (marca Gavriel: menta #a9e6bd sobre blanco roto) ────
type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const DARK = {
  brand: hex("#a9e6bd"), brand2: hex("#4fc8a4"), text: hex("#fafafa"), muted: hex("#93a39a"), faint: hex("#5f6e66"),
  ok: hex("#7ee0a1"), warn: hex("#f2c46d"), err: hex("#ff7b7b"), info: hex("#86c5ff"), violet: hex("#c3a6ff"),
};
const LIGHT = {
  brand: hex("#1f8a57"), brand2: hex("#127c6b"), text: hex("#1b1f1d"), muted: hex("#56665e"), faint: hex("#8d9a93"),
  ok: hex("#1f8a57"), warn: hex("#9a6700"), err: hex("#c62828"), info: hex("#0b5fb0"), violet: hex("#6f42c1"),
};
export type Slot = keyof typeof DARK;

function lightTheme(): boolean {
  const t = env("GAVRIEL_THEME");
  if (t) return t === "light";
  const bg = Number((env("COLORFGBG") ?? "").split(";").pop());
  return Number.isFinite(bg) && bg >= 7 && bg !== 8; // fondo claro declarado por la terminal
}
const palette = (): typeof DARK => (lightTheme() ? LIGHT : DARK);

const ESC = "\x1b[";
function to256([r, g, b]: RGB): number {
  if (r === g && g === b) return r < 8 ? 16 : r > 248 ? 231 : 232 + Math.round(((r - 8) / 247) * 23);
  const c = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}
function to16([r, g, b]: RGB): number {
  const code = (r > 127 ? 1 : 0) | (g > 127 ? 2 : 0) | (b > 127 ? 4 : 0);
  return (r + g + b) / 3 > 150 ? 90 + code : 30 + code;
}
function color(level: Level, rgb: RGB, bg = false): string {
  if (level === 3) return `${ESC}${bg ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  if (level === 2) return `${ESC}${bg ? 48 : 38};5;${to256(rgb)}m`;
  const c = to16(rgb);
  return `${ESC}${bg ? c + 10 : c}m`;
}

// ── Texto: ancho en celdas, truncado y saneado ───────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Datos remotos (nombres, títulos, notas) son no confiables: sin secuencias de control. */
export function stripControl(s: unknown): string {
  return String(s ?? "").replace(ANSI_RE, "").replace(/[\t\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function graphemeWidth(g: string): number {
  const cp = g.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (/^(?:\p{M}|[\u200b-\u200f]|\ufe0e|\ufe0f)+$/u.test(g)) return 0;
  if (/\p{Extended_Pictographic}/u.test(g) && cp > 0x2fff) return 2;
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd);
  return wide ? 2 : 1;
}

export function visibleWidth(s: string): number {
  let w = 0;
  for (const { segment } of segmenter.segment(s.replace(ANSI_RE, ""))) w += graphemeWidth(segment);
  return w;
}

/** Trunca a `max` celdas en límite de grafema (sin tocar secuencias ANSI: usar sobre texto plano). */
export function truncate(s: string, max: number): string {
  if (visibleWidth(s) <= max) return s;
  const ell = unicodeOn() ? "…" : "...";
  const budget = Math.max(1, max - visibleWidth(ell));
  let out = "";
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    const gw = graphemeWidth(segment);
    if (w + gw > budget) break;
    out += segment;
    w += gw;
  }
  return out + ell;
}

export const padLabel = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
const padRight = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
const padLeft = (s: string, w: number): string => " ".repeat(Math.max(0, w - visibleWidth(s))) + s;

// ── Glifos ───────────────────────────────────────────────────────────────
export function glyphs(): Record<string, string> {
  return unicodeOn()
    ? { ok: "✔", fail: "✘", warn: "▲", info: "ℹ", dot: "●", ring: "○", arrow: "›", ask: "?", bar: "━", cap: "╸", rail: "─",
        tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", tj: "┬", bj: "┴", lj: "├", rj: "┤", x: "┼", spin: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" }
    : { ok: "ok", fail: "x", warn: "!", info: "i", dot: "*", ring: "o", arrow: ">", ask: "?", bar: "=", cap: ">", rail: "-",
        tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", tj: "+", bj: "+", lj: "+", rj: "+", x: "+", spin: "|/-\\" };
}

// ── Pintor ────────────────────────────────────────────────────────────────
export interface Painter {
  readonly level: Level;
  paint(slot: Slot, text: string, opts?: { bold?: boolean; dim?: boolean }): string;
  bold(text: string): string;
  gradient(text: string, from?: Slot, to?: Slot): string;
}

export function painter(stream: Stream): Painter {
  const level = colorLevel(stream);
  const attrs = (stream.isTTY || level > 0) && !plainMode();
  const reset = `${ESC}0m`;
  return {
    level,
    paint(slot, text, opts = {}) {
      if (level === 0 && !(attrs && (opts.bold || opts.dim))) return text;
      const pre = (opts.bold && attrs ? `${ESC}1m` : "") + (opts.dim && attrs ? `${ESC}2m` : "") + (level > 0 ? color(level, palette()[slot]) : "");
      return pre ? `${pre}${text}${reset}` : text;
    },
    bold(text) {
      return attrs ? `${ESC}1m${text}${reset}` : text;
    },
    gradient(text, from = "brand", to = "brand2") {
      if (level < 2) return this.paint(from, text, { bold: true });
      const a = palette()[from], b = palette()[to];
      const chars = [...segmenter.segment(text)].map((s) => s.segment);
      return chars.map((ch, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0;
        const rgb: RGB = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as unknown as RGB;
        return `${color(level, rgb)}${ch}`;
      }).join("") + reset;
    },
  };
}

export const out = (): Painter => painter(process.stdout);
export const err = (): Painter => painter(process.stderr);

// ── Logo ──────────────────────────────────────────────────────────────────
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

// Bit braille de cada punto de la celda 2x4: [fila][columna].
const BRAILLE_BIT = [[0, 3], [1, 4], [2, 5], [6, 7]];

export type LogoMode = "braille" | "blocks" | "text" | "none";
let logoOverride: LogoMode | undefined;
export const setLogoMode = (m: LogoMode | undefined): void => { logoOverride = m; };
/** GAVRIEL_LOGO / --logo: blocks (medios bloques sólidos, por defecto), braille (puntos, más fino), text (solo texto) o none. */
export function logoMode(): LogoMode {
  const v = logoOverride ?? env("GAVRIEL_LOGO");
  return v === "braille" || v === "text" || v === "none" ? v : "blocks";
}

// Texto "Gavriel" en líneas de caja (se dibujan nativas en cualquier fuente).
const WORDMARK = [
  "╔═╗╔═╗╦  ╦╦═╗╦╔═╗╦  ",
  "║ ╦╠═╣╚╗╔╝╠╦╝║║╣ ║  ",
  "╚═╝╩ ╩ ╚╝ ╩╚═╩╚═╝╩═╝",
];

type Cls = "L" | "W" | ".";
const cell = (cx: number, dy0: number, dy1: number): { on: number; cls: Cls } => {
  let on = 0, wing = 0, word = 0;
  for (let dy = dy0; dy < dy1; dy++) for (let dx = 0; dx < 2; dx++) {
    const ch = LOGO_DOTS[dy][cx * 2 + dx];
    if (ch === ".") continue;
    on++;
    if (ch === "L") wing++; else word++;
  }
  return { on, cls: on === 0 ? "." : wing >= word ? "L" : "W" };
};

/**
 * Líneas del logo según el modo. braille: una celda = 2x4 puntos (ala con plumas y tipografía fina);
 * blocks: medios bloques sólidos; text: solo "Gavriel". `shine` ∈ [0,1] mueve un brillo diagonal sobre el ala.
 */
function logoLines(level: Level, compact: boolean, shine = -1): string[] {
  const mode = logoMode();
  const pal = palette();
  const reset = `${ESC}0m`;
  const unicode = unicodeOn();
  if (mode === "text") {
    return WORDMARK.map((l, i) => (level === 0 ? l : `${color(level, [lerp(pal.brand[0], pal.brand2[0], i / 2), lerp(pal.brand[1], pal.brand2[1], i / 2), lerp(pal.brand[2], pal.brand2[2], i / 2)])}${l}${reset}`));
  }
  const cols = compact ? MARK_COLS : LOGO_COLS;
  const wingRgb = (cx: number, y: number, h: number): RGB => {
    const t = Math.min(1, y / h); // degradado vertical menta → verde azulado
    let rgb: RGB = [lerp(pal.brand[0], pal.brand2[0], t), lerp(pal.brand[1], pal.brand2[1], t), lerp(pal.brand[2], pal.brand2[2], t)];
    if (shine >= 0) {
      const d = Math.abs((cx + y * (LOGO_COLS / LOGO_LINES) * 0.4) / (MARK_COLS + h * 0.4) - shine);
      const k = Math.max(0, 1 - d * 7) * 0.6;
      rgb = [lerp(rgb[0], 255, k), lerp(rgb[1], 255, k), lerp(rgb[2], 255, k)];
    }
    return rgb;
  };
  const lines: string[] = [];
  for (let cy = 0; cy < LOGO_LINES; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      if (mode === "blocks") { // 1 celda = 1 px de ancho × 2 px de alto (cada px = 2x2 puntos, ≥2 encendidos)
        const top = cell(cx, cy * 4, cy * 4 + 2), bot = cell(cx, cy * 4 + 2, cy * 4 + 4);
        const tOn = top.on >= 2, bOn = bot.on >= 2;
        if (!tOn && !bOn) { line += " "; continue; }
        if (level === 0) { line += unicode ? (tOn && bOn ? "█" : tOn ? "▀" : "▄") : "#"; continue; }
        const rgbOf = (c: Cls, y: number): RGB => (c === "W" ? pal.text : wingRgb(cx, y, LOGO_LINES));
        const tc = tOn ? rgbOf(top.cls, cy + 0.25) : null, bc = bOn ? rgbOf(bot.cls, cy + 0.75) : null;
        if (tc && bc) line += top.cls === bot.cls ? `${color(level, tc)}█${reset}` : level === 3 ? `${color(level, tc)}${color(level, bc, true)}▀${reset}` : `${color(level, tc)}▀${reset}`;
        else if (tc) line += `${color(level, tc)}▀${reset}`;
        else line += `${color(level, bc as RGB)}▄${reset}`;
        continue;
      }
      let bits = 0, wing = 0, word = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const ch = LOGO_DOTS[cy * 4 + dy][cx * 2 + dx];
          if (ch === ".") continue;
          bits |= 1 << BRAILLE_BIT[dy][dx];
          if (ch === "L") wing++; else word++;
        }
      }
      if (bits === 0) { line += " "; continue; }
      const glyph = unicode ? String.fromCodePoint(0x2800 + bits) : wing >= word ? "#" : "o";
      if (level === 0) { line += glyph; continue; }
      line += `${color(level, wing >= word ? wingRgb(cx, cy + 0.5, LOGO_LINES) : pal.text)}${glyph}${reset}`;
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let appVersion = "";
export const setVersion = (v: string): void => { appVersion = v; };

export interface BannerOpts { stream?: Stream; version?: string; tagline?: string; animate?: boolean }

/** Muestra el logo (animado si la terminal lo permite). Con terminales angostas usa solo la hoja. */
export async function banner(o: BannerOpts = {}): Promise<void> {
  const stream = o.stream ?? process.stderr;
  const level = colorLevel(stream);
  o = { ...o, version: o.version ?? (appVersion || undefined) };
  const cols = stream.columns ?? 80;
  const compact = logoMode() !== "text" && cols < LOGO_COLS + 2;
  if (plainMode() || !unicodeOn() || logoMode() === "none" || (!stream.isTTY && !env("FORCE_COLOR"))) { // pipes/CI: una línea, sin arte
    stream.write(`gavriel${o.version ? ` ${o.version}` : ""}${o.tagline ? ` — ${o.tagline}` : ""}\n`);
    return;
  }
  const p = painter(stream);
  const animate = (o.animate ?? true) && animationsOn(stream) && level > 0;
  const base = logoLines(level, compact);
  const caption = ` ${p.paint("muted", o.tagline ?? "Monitoreo de alarmas · CLI y MCP")}${o.version ? p.paint("faint", `  v${o.version}`) : ""}`;
  const height = base.length;
  if (!animate) {
    stream.write(`${base.join("\n")}\n${caption}\n\n`);
    return;
  }
  const hide = `${ESC}?25l`, show = `${ESC}?25h`;
  const restore = (): void => { stream.write(show); };
  process.once("exit", restore);
  stream.write(hide);
  try {
    for (let i = 0; i < height; i++) { stream.write(`${base[i]}\n`); await sleep(24); } // revelado por líneas
    for (let f = 1; f <= 8; f++) { // un barrido de brillo sobre la hoja
      const frame = logoLines(level, compact, f / 8);
      stream.write(`${ESC}${height}A${frame.map((l) => `${ESC}2K${l}`).join("\n")}\n`);
      await sleep(28);
    }
    stream.write(`${ESC}${height}A${base.map((l) => `${ESC}2K${l}`).join("\n")}\n`);
  } finally {
    stream.write(show);
    process.off("exit", restore);
  }
  stream.write(`${caption}\n\n`);
}

// ── Spinner ───────────────────────────────────────────────────────────────
export interface Spin {
  update(label: string): void;
  succeed(msg?: string): void;
  fail(msg?: string): void;
  warn(msg?: string): void;
  stop(): void;
}

export function spinner(label: string, stream: Stream = process.stderr): Spin {
  const p = painter(stream);
  const g = glyphs();
  const live = animationsOn(stream);
  const frames = [...g.spin];
  let text = label, i = 0, timer: NodeJS.Timeout | undefined, done = false;
  const hide = `${ESC}?25l`, show = `${ESC}?25h`;
  const onExit = (): void => { stream.write(show); };
  const draw = (): void => { stream.write(`\r${ESC}2K${p.paint("brand", frames[i++ % frames.length])} ${text}`); };
  if (live) {
    process.once("exit", onExit);
    stream.write(hide);
    draw();
    timer = setInterval(draw, 80);
    timer.unref();
  } else {
    stream.write(`${p.paint("brand", g.arrow)} ${text}…\n`);
  }
  const end = (slot: Slot, glyph: string, msg: string | undefined): void => {
    if (done) return;
    done = true;
    if (timer) clearInterval(timer);
    if (live) { stream.write(`\r${ESC}2K${show}`); process.off("exit", onExit); }
    if (msg !== undefined) stream.write(`${p.paint(slot, glyph, { bold: true })} ${msg}\n`);
  };
  return {
    update(l) { text = l; if (!live) stream.write(`${p.paint("brand", g.arrow)} ${l}…\n`); },
    succeed: (m) => end("ok", g.ok, m ?? text),
    fail: (m) => end("err", g.fail, m ?? text),
    warn: (m) => end("warn", g.warn, m ?? text),
    stop: () => end("ok", "", undefined),
  };
}

// ── Componentes ───────────────────────────────────────────────────────────
export interface Col<T> {
  title: string;
  value: (row: T) => unknown;
  slot?: (row: T) => Slot | undefined;
  align?: "left" | "right";
  max?: number;
}

/** Tabla con bordes redondeados. Celdas saneadas y truncadas por grafema al ancho disponible. */
export function table<T>(rows: readonly T[], cols: readonly Col<T>[], stream: Stream = process.stdout): string {
  const p = painter(stream);
  const g = glyphs();
  const cells = rows.map((r) => cols.map((c) => truncate(stripControl(c.value(r)), c.max ?? 48)));
  const widths = cols.map((c, i) => Math.max(visibleWidth(c.title), ...cells.map((row) => visibleWidth(row[i]))));
  const avail = (stream.columns ?? 100) - (cols.length * 3 + 1);
  let over = widths.reduce((a, b) => a + b, 0) - avail;
  while (over > 0) { // recortar la columna más ancha hasta que entre
    const k = widths.indexOf(Math.max(...widths));
    if (widths[k] <= 8) break;
    widths[k]--; over--;
  }
  const edge = (l: string, m: string, r: string): string => p.paint("faint", l + widths.map((w) => g.h.repeat(w + 2)).join(m) + r);
  const bar = p.paint("faint", g.v);
  const fit = (s: string, w: number, a: "left" | "right" | undefined): string => (a === "right" ? padLeft(truncate(s, w), w) : padRight(truncate(s, w), w));
  const lines = [edge(g.tl, g.tj, g.tr), `${bar} ${cols.map((c, i) => p.paint("brand", fit(c.title, widths[i], c.align), { bold: true })).join(` ${bar} `)} ${bar}`, edge(g.lj, g.x, g.rj)];
  rows.forEach((r, ri) => {
    const row = cols.map((c, i) => {
      const t = fit(cells[ri][i], widths[i], c.align);
      const slot = c.slot?.(r);
      return slot ? p.paint(slot, t) : t;
    });
    lines.push(`${bar} ${row.join(` ${bar} `)} ${bar}`);
  });
  lines.push(edge(g.bl, g.bj, g.br));
  return lines.join("\n");
}

/** Pares clave/valor alineados (tarjeta de estado). */
export function kv(pairs: readonly [string, unknown, Slot?][], stream: Stream = process.stdout): string {
  const p = painter(stream);
  const w = Math.max(...pairs.map(([k]) => visibleWidth(k)));
  return pairs.map(([k, v, slot]) => `  ${p.paint("muted", padRight(k, w))}  ${slot ? p.paint(slot, stripControl(v)) : stripControl(v)}`).join("\n");
}

/** Barra fina con extremo (━━━╸━━━) para cuentas regresivas y progreso. */
export function bar(ratio: number, width: number, stream: Stream = process.stdout, slot: Slot = "brand"): string {
  const p = painter(stream);
  const g = glyphs();
  const n = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const filled = n > 0 ? g.bar.repeat(Math.max(0, n - 1)) + (n < width ? g.cap : g.bar) : "";
  return p.paint(slot, filled) + p.paint("faint", g.rail.repeat(width - n));
}

export const status = {
  /** Píldora de estado con color + texto (nunca solo color). */
  dot(slot: Slot, text: string, stream: Stream = process.stdout): string {
    const p = painter(stream);
    return `${p.paint(slot, glyphs().dot)} ${text}`;
  },
};

export function line(kind: "ok" | "fail" | "warn" | "info", msg: string, stream: Stream = process.stderr): string {
  const p = painter(stream);
  const g = glyphs();
  const map = { ok: ["ok", g.ok], fail: ["err", g.fail], warn: ["warn", g.warn], info: ["info", g.info] } as const;
  const [slot, glyph] = map[kind];
  return `${p.paint(slot, glyph, { bold: true })} ${msg}`;
}

/** Prompt con estilo: `? Email › `. */
export function prompt(label: string, stream: Stream = process.stderr): string {
  const p = painter(stream);
  const g = glyphs();
  return `${p.paint("brand", g.ask, { bold: true })} ${p.bold(label)} ${p.paint("muted", g.arrow)} `;
}

// ── Más componentes ───────────────────────────────────────────────────────
const STATUS_SLOT: Record<string, Slot> = {
  open: "info", in_progress: "warn", pending_customer: "violet", closed: "faint", pending: "warn", attending: "info",
  processed: "ok", "self-processed": "ok", cancelled: "faint", hidden: "faint",
};
const PRIORITY_SLOT: Record<string, Slot> = { low: "muted", medium: "warn", high: "err", critical: "err" };
export const statusSlot = (v: unknown): Slot | undefined => STATUS_SLOT[String(v ?? "").toLowerCase()];
export const prioritySlot = (v: unknown): Slot | undefined => PRIORITY_SLOT[String(v ?? "").toLowerCase()];

/** ISO → "2026-10-21 14:05" en hora local; cualquier otra cosa se devuelve igual. */
export function shortDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT/.test(v)) return String(v ?? "");
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const z = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** JSON con colores (claves menta, números azules, booleanos violeta, null apagado). Sin color = JSON normal. */
export function json(value: unknown, stream: Stream = process.stdout): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const p = painter(stream);
  if (p.level === 0) return text;
  return text.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g, (m, str, colon, bool) => {
    if (str) return colon ? p.paint("brand", str) + colon : p.paint("text", str);
    if (bool) return p.paint("violet", m);
    if (m === "null") return p.paint("faint", m);
    return p.paint("info", m);
  });
}

/** Cuenta regresiva en vivo (código TOTP): redibuja una línea hasta que cierra la ventana. */
export async function countdown(render: (secsLeft: number, total: number) => string, secs: number, stream: Stream = process.stderr): Promise<void> {
  if (!animationsOn(stream)) {
    stream.write(`${render(secs, secs)}\n`);
    return;
  }
  const hide = `${ESC}?25l`, show = `${ESC}?25h`;
  const onExit = (): void => { stream.write(show); };
  const onSigint = (): void => { stream.write(`${show}\n`); process.exit(130); };
  process.once("exit", onExit);
  process.once("SIGINT", onSigint);
  stream.write(hide);
  const end = Date.now() + secs * 1000;
  try {
    for (;;) {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      stream.write(`\r${ESC}2K${render(left, secs)}`);
      if (left <= 0) break;
      await sleep(200);
    }
  } finally {
    stream.write(`${show}\n`);
    process.off("exit", onExit);
    process.off("SIGINT", onSigint);
  }
}

