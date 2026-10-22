// Rasteriza el SVG del logo de Gavriel a una grilla de puntos braille (2x4 por celda, píxeles cuadrados):
// '.' vacío, 'L' ala, 'W' texto. Salida: JSON de filas de puntos (para src/cli/logo.ts) + vista previa en stderr.
// Uso: node scripts/gen-logo.mjs logo.svg [--wingcols 24] [--wordscale 0.6] [--wing 0.5] [--word 0.4] [--gap 6]
// Fuente: https://gavriel.app/wp-content/uploads/2026/01/gavriel-logo.svg (solo comandos M m L l H h V v C c S s Z z).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
if (!file) {
  console.error("Uso: node scripts/gen-logo.mjs <logo.svg> [--cols 74] [--wing 0.5] [--word 0.4]");
  process.exit(2);
}
const wingThr = opt("wing", 0.5);
const wordThr = opt("word", 0.4);

const svg = readFileSync(file, "utf8");
const [, , vbW, vbH] = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);

function flatten(d) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const polys = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, i = 0, cmd = "";
  const n = () => Number(toks[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x, y0 = y;
    for (let t = 1; t <= 24; t++) {
      const u = t / 24, v = 1 - u;
      cur.push([
        v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
        v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3,
      ]);
    }
    lastC = [x2, y2];
    x = x3; y = y3;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    if (up === "Z") { if (cur) polys.push(cur); cur = null; x = sx; y = sy; lastC = null; continue; }
    if (up === "M") {
      if (cur) polys.push(cur);
      const a = n(), b = n();
      x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y;
      cur = [[x, y]]; lastC = null;
      cmd = rel ? "l" : "L";
      continue;
    }
    if (up === "L") { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; cur.push([x, y]); lastC = null; }
    else if (up === "H") { const a = n(); x = rel ? x + a : a; cur.push([x, y]); lastC = null; }
    else if (up === "V") { const a = n(); y = rel ? y + a : a; cur.push([x, y]); lastC = null; }
    else if (up === "C") {
      const v = [n(), n(), n(), n(), n(), n()];
      const o = rel ? [x, y, x, y, x, y] : [0, 0, 0, 0, 0, 0];
      cubic(v[0] + o[0], v[1] + o[1], v[2] + o[2], v[3] + o[3], v[4] + o[4], v[5] + o[5]);
    } else if (up === "S") {
      const v = [n(), n(), n(), n()];
      const o = rel ? [x, y, x, y] : [0, 0, 0, 0];
      const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      cubic(c1[0], c1[1], v[0] + o[0], v[1] + o[1], v[2] + o[2], v[3] + o[3]);
    } else throw new Error(`comando no soportado: ${cmd}`);
  }
  if (cur) polys.push(cur);
  return polys;
}

// Even-odd: cruces de un rayo horizontal con todos los polígonos del path (los agujeros de a/e/r quedan vacíos).
function inside(polys, px, py) {
  let c = 0;
  for (const p of polys) {
    for (let k = 0, m = p.length - 1; k < p.length; m = k++) {
      const [x1, y1] = p[k], [x2, y2] = p[m];
      if ((y1 > py) !== (y2 > py) && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) c++;
    }
  }
  return c % 2 === 1;
}

const wing = [...svg.matchAll(/<path class="cls-1" d="([^"]+)"/g)].flatMap((m) => flatten(m[1]));
const words = [...svg.matchAll(/<path class="cls-2" d="([^"]+)"/g)].map((m) => flatten(m[1]));

// Ala y texto se rasterizan por separado: el ala necesita más resolución para que se vean las plumas.
function raster(polysList, x0, y0, w, h, scale, thr) {
  const W = Math.ceil(w * scale), H = Math.ceil(h * scale), SS = 4, g = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      let n = 0;
      for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) {
        const sx = x0 + (c + (b + 0.5) / SS) / scale, sy = y0 + (r + (a + 0.5) / SS) / scale;
        if (polysList.some((p) => inside(p, sx, sy))) n++;
      }
      row.push(n / (SS * SS) >= thr);
    }
    g.push(row);
  }
  return g;
}
const bbox = (list) => {
  const pts = list.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const wingScale = (opt("wingcols", 24) * 2) / (bbox([wing])[2] - bbox([wing])[0]);
const wordScale = opt("wordscale", 0.6);
const [wx0, wy0, wx1, wy1] = bbox([wing]);
const [tx0, ty0, tx1, ty1] = bbox(words);
const wingG = raster([wing], wx0, wy0, wx1 - wx0, wy1 - wy0, wingScale, wingThr);
const wordG = raster(words, tx0, ty0, tx1 - tx0, ty1 - ty0, wordScale, wordThr);
const gap = opt("gap", 6);
const H = Math.ceil(Math.max(wingG.length, wordG.length) / 4) * 4;
const W = wingG[0].length + gap + wordG[0].length;
const wingTop = Math.round((H - wingG.length) / 2);
// El texto se centra con el centro del ala (como en el logo original).
const wordTop = Math.round((H - wordG.length) / 2);
const rows = Array.from({ length: H }, () => Array(W).fill("."));
for (const [r, row] of wingG.entries()) for (const [c, on] of row.entries()) if (on) rows[wingTop + r][c] = "L";
for (const [r, row] of wordG.entries()) for (const [c, on] of row.entries()) if (on) rows[wordTop + r][wingG[0].length + gap + c] = "W";
const dotsW = Math.ceil(W / 2) * 2, dotsH = H;
const out = rows.map((r) => r.join("").padEnd(dotsW, "."));
console.log(JSON.stringify(out));

// Vista previa braille
const BITS = [[0, 3], [1, 4], [2, 5]];
console.error(`${dotsW / 2} cols × ${dotsH / 4} líneas (${dotsW}×${dotsH} puntos)`);
for (let r = 0; r < dotsH; r += 4) {
  let line = "";
  for (let c = 0; c < dotsW; c += 2) {
    let bits = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
      if (out[r + dy][c + dx] === ".") continue;
      bits |= dy < 3 ? 1 << BITS[dy][dx] : 1 << (6 + dx);
    }
    line += String.fromCodePoint(0x2800 + bits);
  }
  console.error(line);
}
