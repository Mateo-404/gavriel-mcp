// Rasteriza el SVG del logo de Gavriel a un bitmap ('.', 'L' hoja, 'W' texto) para src/cli/logo.ts.
// Uso: node scripts/gen-logo.mjs gavriel-logo.svg [anchoPx=64] [umbralTexto=0.35]
// Fuente: https://gavriel.app/wp-content/uploads/2026/01/gavriel-logo.svg (solo comandos M m L l H h V v C c S s Z z).
import { readFileSync } from "node:fs";

const [, , file, widthArg = "64", wordThrArg = "0.35"] = process.argv;
if (!file) {
  console.error("Uso: node scripts/gen-logo.mjs <logo.svg> [anchoPx] [umbralTexto]");
  process.exit(2);
}
const svg = readFileSync(file, "utf8");
const [, , vbW, vbH] = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function flatten(d) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const polys = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, i = 0, cmd = "";
  const n = () => Number(toks[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x, y0 = y;
    for (let t = 1; t <= 16; t++) {
      const u = t / 16, v = 1 - u;
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
    if (up === "Z") {
      if (cur) polys.push(cur);
      cur = null; x = sx; y = sy; lastC = null;
      continue;
    }
    if (up === "M") {
      if (cur) polys.push(cur);
      const a = n(), b = n();
      x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y;
      cur = [[x, y]]; lastC = null;
      cmd = rel ? "l" : "L"; // pares extra tras M son lineTo
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

// Even-odd: cuenta cruces de un rayo horizontal con todos los polígonos del path.
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

const leafD = [...svg.matchAll(/<path class="cls-1" d="([^"]+)"/g)].map((m) => m[1]);
const wordD = [...svg.matchAll(/<path class="cls-2" d="([^"]+)"/g)].map((m) => m[1]);
const leaf = leafD.flatMap(flatten);
const words = wordD.map(flatten);

const wordThr = Number(wordThrArg);
const width = Math.round(Number(widthArg));
const scale = width / vbW;
let height = Math.round(vbH * scale);
if (height % 2) height++; // half-blocks: filas pares
const SS = 4;
const rows = [];
for (let r = 0; r < height; r++) {
  let line = "";
  for (let c = 0; c < width; c++) {
    let lc = 0, wc = 0;
    for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) {
      const sx = ((c + (b + 0.5) / SS) / scale), sy = ((r + (a + 0.5) / SS) / scale);
      if (inside(leaf, sx, sy)) lc++;
      else if (words.some((p) => inside(p, sx, sy))) wc++;
    }
    const tot = SS * SS;
    line += lc / tot >= 0.5 ? "L" : wc / tot >= wordThr ? "W" : ".";
  }
  rows.push(line);
}
console.log(JSON.stringify(rows, null, 2));
console.error(`${width}x${height}px → ${height / 2} líneas`);
for (let r = 0; r < height; r += 2) {
  console.error(rows[r].split("").map((ch, c) => {
    const t = ch !== ".", b = rows[r + 1][c] !== ".";
    return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
  }).join(""));
}
