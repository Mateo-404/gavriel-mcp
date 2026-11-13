/**
 * Compila la extensión con Bun: src/**.ts -> dist/**.js y copia static/ a dist/.
 * Carpetas a cargar: dist/ en Chrome/Chromium ("Cargar descomprimida") y dist-firefox/ en Firefox
 * (about:debugging -> Cargar complemento temporal -> manifest.json).
 *
 *   bun run build     compila una vez
 *   bun run dev       recompila al guardar
 */
import { watch } from 'node:fs';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { forChrome, forFirefox, type Manifest } from './manifest-targets';

const ENTRYPOINTS = [
  'src/content/account.ts',
  'src/content/bridge.ts',
  'src/content/mute.ts',
  'src/content/shortcuts.ts',
  'src/options/options.ts',
  'src/popup/popup.ts',
];

async function build(): Promise<void> {
  const started = performance.now();
  await rm('dist', { recursive: true, force: true });
  await rm('dist-firefox', { recursive: true, force: true });

  // Los content scripts no pueden ser módulos ES: cada entrada sale como IIFE autocontenido.
  const result = await Bun.build({
    entrypoints: ENTRYPOINTS,
    outdir: 'dist',
    root: 'src',
    target: 'browser',
    format: 'iife',
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Falló la compilación');
  }

  await cp('static', 'dist', { recursive: true });

  // La versión del manifest sale de package.json: una sola fuente de verdad
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  const base = JSON.parse(await readFile('static/manifest.json', 'utf8')) as Manifest;
  const write = (dir: string, manifest: Manifest): Promise<void> =>
    writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await write('dist', forChrome(base, pkg.version));
  await cp('dist', 'dist-firefox', { recursive: true });
  await write('dist-firefox', forFirefox(base, pkg.version));

  const ms = Math.round(performance.now() - started);
  console.log(`✔ dist/ y dist-firefox/ listos (v${pkg.version}, ${result.outputs.length} archivos JS, ${ms} ms)`);
}

await build();

if (process.argv.includes('--watch')) {
  console.log('Mirando src/ y static/ … (Ctrl+C para salir)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e: unknown) => console.error(e)), 150);
  };
  for (const dir of ['src', 'static']) watch(dir, { recursive: true }, rebuild);
}
