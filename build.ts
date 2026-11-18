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
import { verifyPackage } from './scripts/verify-package';

const ENTRYPOINTS = [
  'src/background.ts',
  'src/content/bridge.ts',
  'src/content/main.ts', // cuenta + atajos: un solo script, un solo observador
  'src/content/mute.ts',
  'src/content/music.ts', // pestañas de Spotify Web / YouTube Music
  'src/options/options.ts',
  'src/popup/popup.ts',
];

const watching = process.argv.includes('--watch');

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
    // Producción: minificado (menos que parsear en cada página). En `bun run dev` queda legible y con mapa.
    minify: !watching,
    sourcemap: watching ? 'linked' : 'none',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Falló la compilación');
  }

  await cp('static', 'dist', { recursive: true });
  // CSS propio minificado (el de producción es lo que se inyecta en cada pantalla de Gavriel); en `dev` queda legible
  if (!watching) {
    for (const css of ['content/shortcuts.css', 'options/options.css', 'popup/popup.css']) {
      const out = await Bun.build({ entrypoints: [`static/${css}`], outdir: `dist/${css.slice(0, css.lastIndexOf('/'))}`, minify: true });
      if (!out.success) throw new Error(`No se pudo minificar ${css}`);
    }
  }

  // La versión del manifest sale de package.json: una sola fuente de verdad
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  const base = JSON.parse(await readFile('static/manifest.json', 'utf8')) as Manifest;
  const problems = verifyPackage(base);
  if (problems.length > 0) throw new Error(`Paquete inválido:\n - ${problems.join('\n - ')}`);
  const write = (dir: string, manifest: Manifest): Promise<void> =>
    writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await write('dist', forChrome(base, pkg.version));
  await cp('dist', 'dist-firefox', { recursive: true });
  await write('dist-firefox', forFirefox(base, pkg.version));

  const ms = Math.round(performance.now() - started);
  console.log(`✔ dist/ y dist-firefox/ listos (v${pkg.version}, ${result.outputs.length} archivos JS, ${ms} ms)`);
}

await build();

if (watching) {
  console.log('Mirando src/ y static/ … (Ctrl+C para salir)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e: unknown) => console.error(e)), 150);
  };
  for (const dir of ['src', 'static']) watch(dir, { recursive: true }, rebuild);
}
