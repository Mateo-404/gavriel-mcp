import { describe, expect, test } from 'bun:test';

/** Compila cada content script tal como sale a producción (minificado, IIFE) y lo ejecuta sobre un DOM. */
async function run(entry: string): Promise<void> {
  const result = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: true });
  expect(result.success).toBe(true);
  const code = await result.outputs[0]!.text();
  (0, eval)(code);
}

describe('humo: los content scripts minificados arrancan sin errores', () => {
  test('bridge.js escribe los ajustes en <html>', async () => {
    document.documentElement.removeAttribute('data-gv-nobanner');
    await run('src/content/bridge.ts');
    await new Promise((r) => setTimeout(r, 30));
    expect(document.documentElement.getAttribute('data-gavriel-mute')).toBe('1');
    expect(document.documentElement.hasAttribute('data-gv-nobanner')).toBe(true);
    expect(document.documentElement.hasAttribute('data-gv-plain')).toBe(true);
    // las tipografías locales se inyectan al instante, con URLs de la extensión y sin pedir nada afuera
    const fonts = document.getElementById('gv-fonts')?.textContent ?? '';
    expect(fonts).toContain('url("chrome-extension://test-extension/fonts/geist-latin.woff2")');
    expect(fonts).not.toContain('https://');
    expect(JSON.parse(document.documentElement.getAttribute('data-gavriel-muted-sounds') ?? '[]')).toContain('alarm');
  });

  test('main.js (cuenta + atajos) arranca, se protege de doble carga y no deja texto en los botones', async () => {
    document.body.innerHTML = '<button id="b">Cerrar Intervención</button>';
    await run('src/content/main.ts');
    const flags = globalThis as unknown as { __gvShortcuts?: boolean; __gvAccount?: boolean };
    expect(flags.__gvShortcuts).toBe(true);
    expect(flags.__gvAccount).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(document.getElementById('b')!.textContent).toBe('Cerrar Intervención');
    await run('src/content/main.ts'); // una segunda carga no duplica nada ni falla
  });

  test('mute.js arranca', async () => {
    await run('src/content/mute.ts');
    expect((globalThis as unknown as { __gavrielMute?: boolean }).__gavrielMute).toBe(true);
  });
});
