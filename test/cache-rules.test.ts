import { describe, expect, test } from 'bun:test';

interface Rule {
  id: number;
  action: { type: string; responseHeaders: { header: string; operation: string; value?: string }[] };
  condition: { regexFilter: string; initiatorDomains: string[]; resourceTypes: string[] };
}

const rules = (await Bun.file('static/rules/cache.json').json()) as Rule[];
const manifest = (await Bun.file('static/manifest.json').json()) as {
  declarative_net_request: { rule_resources: { id: string; path: string; enabled: boolean }[] };
};
const rule = rules[0]!;
const re = new RegExp(rule.condition.regexFilter);

describe('regla de caché de los archivos con hash', () => {
  test('el conjunto de reglas está declarado en el manifest y existe', () => {
    const resource = manifest.declarative_net_request.rule_resources[0]!;
    expect(resource).toEqual({ id: 'cache', enabled: true, path: 'rules/cache.json' });
    expect(rules).toHaveLength(1);
  });

  test('guarda un año y sin revalidar, y quita las cabeceras viejas', () => {
    const headers = rule.action.responseHeaders;
    expect(rule.action.type).toBe('modifyHeaders');
    expect(headers.find((h) => h.header === 'cache-control')).toEqual({
      header: 'cache-control',
      operation: 'set',
      value: 'public, max-age=31536000, immutable',
    });
    expect(headers.filter((h) => h.operation === 'remove').map((h) => h.header)).toEqual(['pragma', 'expires']);
  });

  test('alcanza a los archivos con hash de /assets/', () => {
    for (const path of [
      'index-DUW2J6iO.js',
      'index-DshRvVl_.css',
      'primeicons-DsZ1W7-Z.woff2',
      'fa-solid-900-CTAAxXor.woff2',
      'logo-a1B2c3D4.svg',
    ]) {
      expect(re.test(`https://app.gavriel.com.ar/assets/${path}`)).toBe(true);
    }
  });

  test('no toca la página principal, los sonidos, la API ni archivos sin hash', () => {
    for (const url of [
      'https://app.gavriel.com.ar/',
      'https://app.gavriel.com.ar/index.html',
      'https://app.gavriel.com.ar/sounds/alarm.mp3',
      'https://app.gavriel.com.ar/api/events/accounts-with-pending-events',
      'https://app.gavriel.com.ar/assets/logo.png',
      'https://app.gavriel.com.ar/assets/index-DUW2J6iO.js?x=1',
      'https://app.gavriel.com.ar/assets/sub/index-DUW2J6iO.js',
      'https://otro.com/assets/index-DUW2J6iO.js',
      'https://app.gavriel.com.ar.evil.com/assets/index-DUW2J6iO.js',
    ]) {
      expect(re.test(url)).toBe(false);
    }
  });

  test('solo actúa sobre pedidos que salen de Gavriel', () => {
    expect(rule.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
  });
});
