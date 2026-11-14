import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { localFontCss } from '../src/content/fonts';
import { join } from 'node:path';

interface Rule {
  action: { type: string };
  condition: { urlFilter: string; initiatorDomains: string[]; resourceTypes: string[] };
}
const rules = (await Bun.file('static/rules/fonts.json').json()) as Rule[];
const manifest = (await Bun.file('static/manifest.json').json()) as {
  declarative_net_request: { rule_resources: { id: string; path: string; enabled: boolean }[] };
  web_accessible_resources: { resources: string[]; matches: string[] }[];
};
const css = await Bun.file('static/fonts/gavriel-fonts.css').text();

describe('tipografías locales', () => {
  test('la regla bloquea el CSS de Geist de Google (las letras salen de la extensión) y solo desde Gavriel', () => {
    const rule = rules[0]!;
    expect(rules).toHaveLength(1);
    expect(rule.action.type).toBe('block');
    expect(rule.condition.urlFilter).toContain('fonts.googleapis.com/css2?family=Geist');
    expect(rule.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    expect(rule.condition.resourceTypes).toEqual(['stylesheet']);
  });

  test('el conjunto de reglas y los recursos accesibles están en el manifest', () => {
    expect(manifest.declarative_net_request.rule_resources).toContainEqual({ id: 'fonts', enabled: true, path: 'rules/fonts.json' });
    expect(manifest.web_accessible_resources[0]!.matches).toEqual(['https://app.gavriel.com.ar/*']);
    expect(manifest.web_accessible_resources[0]!.resources).toEqual(['fonts/*']);
  });

  test('el CSS local solo apunta a archivos que existen y no pide nada a internet', () => {
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('http')).toBe(false);
      expect(existsSync(join('static', 'fonts', url))).toBe(true);
    }
  });

  test('declara las dos familias de Gavriel con sus pesos y font-display swap', () => {
    for (const family of ["'Geist'", "'Geist Mono'"]) expect(css).toContain(`font-family: ${family}`);
    for (const weight of [400, 500, 600, 700, 800]) expect(css).toContain(`font-weight: ${weight}`);
    expect(css.match(/font-display: swap/g)!.length).toBe(css.match(/@font-face/g)!.length);
  });
});

describe('localFontCss', () => {
  test('reescribe cada archivo a la URL de la extensión y deja el resto igual', () => {
    const out = localFontCss(css, (path) => `chrome-extension://abc/${path}`);
    expect(out).toContain('url("chrome-extension://abc/fonts/geist-latin.woff2")');
    expect(out).not.toMatch(/url([w.-]+.woff2)/);
    expect(out.match(/@font-face/g)!.length).toBe(css.match(/@font-face/g)!.length);
    expect(out).toContain('unicode-range: U+0000-00FF');
  });
});
