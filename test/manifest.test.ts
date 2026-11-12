import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const manifest = (await Bun.file('static/manifest.json').json()) as {
  icons: Record<string, string>;
  action: { default_popup: string };
  content_scripts: { js: string[]; css?: string[]; world?: string; matches: string[] }[];
};

/** "content/mute.js" sale de src/content/mute.ts */
const sourceOf = (js: string): string => join('src', js.replace(/\.js$/, '.ts'));

describe('manifest', () => {
  test('cada content script tiene su fuente en src/', () => {
    for (const script of manifest.content_scripts) {
      for (const js of script.js) expect(existsSync(sourceOf(js))).toBe(true);
    }
  });

  test('los estilos, iconos y el popup existen en static/', () => {
    for (const script of manifest.content_scripts) {
      for (const css of script.css ?? []) expect(existsSync(join('static', css))).toBe(true);
    }
    for (const icon of Object.values(manifest.icons)) expect(existsSync(join('static', icon))).toBe(true);
    expect(existsSync(join('static', manifest.action.default_popup))).toBe(true);
  });

  test('solo actúa sobre app.gavriel.com.ar', () => {
    for (const script of manifest.content_scripts) {
      expect(script.matches).toEqual(['https://app.gavriel.com.ar/*']);
    }
  });

  test('solo mute.ts corre en el mundo de la página', () => {
    const inMain = manifest.content_scripts.filter((s) => s.world === 'MAIN').flatMap((s) => s.js);
    expect(inMain).toEqual(['content/mute.js']);
  });
});
