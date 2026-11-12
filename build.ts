/**
 * Compila la extensión con Bun: src/**.ts -> dist/**.js y copia static/ a dist/.
 * La carpeta a cargar en Chrome ("Cargar descomprimida") es dist/.
 *
 *   bun run build     compila una vez
 *   bun run dev       recompila al guardar
 */
import { watch } from 'node:fs';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';

const ENTRYPOINTS = [
  'src/content/bridge.ts',
  'src/content/mute.ts',
  'src/content/shortcuts.ts',
  'src/popup/popup.ts',
];

async function build(): Promise<void> {
  const started = performance.now();
  await rm('dist', { recursive: true, force: true });

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
  const manifest = JSON.parse(await readFile('static/manifest.json', 'utf8')) as { version: string };
  manifest.version = pkg.version;
  await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  const ms = Math.round(performance.now() - started);
  console.log(`✔ dist/ listo (v${pkg.version}, ${result.outputs.length} archivos JS, ${ms} ms)`);
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
