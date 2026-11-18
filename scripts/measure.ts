/**
 * Línea de base de rendimiento: tamaño de cada JS/CSS de dist/ (crudo y gzip), cantidad de tests y tiempo de `bun test`.
 *   bun run scripts/measure.ts            (después de `bun run build`)
 * Los números se anotan en docs/perf-baseline.md antes y después de cada fase.
 */
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const files = walk('dist').filter((f) => /\.(js|css)$/.test(f));
let raw = 0;
let zipped = 0;
console.log('archivo'.padEnd(34), 'crudo'.padStart(9), 'gzip'.padStart(9));
for (const file of files) {
  const data = readFileSync(file);
  const gz = gzipSync(data).length;
  raw += data.length;
  zipped += gz;
  console.log(file.replace(/\\/g, '/').padEnd(34), String(data.length).padStart(9), String(gz).padStart(9));
}
console.log('TOTAL'.padEnd(34), String(raw).padStart(9), String(zipped).padStart(9));

const started = performance.now();
const run = Bun.spawnSync(['bun', 'test'], { stdout: 'pipe', stderr: 'pipe' });
const ms = Math.round(performance.now() - started);
const output = run.stdout.toString() + run.stderr.toString();
const pass = /(\d+) pass/.exec(output)?.[1] ?? '?';
const fail = /(\d+) fail/.exec(output)?.[1] ?? '?';
const filesRan = /across (\d+) files/.exec(output)?.[1] ?? '?';
console.log(`\nTests: ${pass} pass, ${fail} fail en ${filesRan} archivos · ${ms} ms (incluye arranque)`);
