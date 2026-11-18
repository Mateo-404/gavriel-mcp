import { describe, expect, test } from 'bun:test';
import { localFontCss } from '../src/content/fonts';
import { MAX_RULES, RULE_ID_BASE, buildRules, syncSoundRules, type BlockRule } from '../src/shared/sound-rules';

interface Rule {
  action: { type: string; responseHeaders?: { header: string; operation: string; value?: string }[] };
  condition: { urlFilter?: string; regexFilter?: string; initiatorDomains: string[]; resourceTypes?: string[] };
}
const load = (name: string): Promise<Rule[]> => Bun.file(`static/rules/${name}.json`).json() as Promise<Rule[]>;

describe('caché de archivos con hash', () => {
  test('un año sin revalidar, solo para /assets/ con hash pedidos por Gavriel', async () => {
    const [rule] = await load('cache');
    expect(rule!.action.responseHeaders!.find((h) => h.header === 'cache-control')!.value).toBe('public, max-age=31536000, immutable');
    expect(rule!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    const re = new RegExp(rule!.condition.regexFilter!);
    for (const ok of ['index-DUW2J6iO.js', 'index-DshRvVl_.css', 'primeicons-DsZ1W7-Z.woff2']) expect(re.test(`https://app.gavriel.com.ar/assets/${ok}`)).toBe(true);
    for (const no of [
      'https://app.gavriel.com.ar/',
      'https://app.gavriel.com.ar/sounds/alarm.mp3',
      'https://app.gavriel.com.ar/api/events/accounts-with-pending-events',
      'https://app.gavriel.com.ar/assets/logo.png',
      'https://app.gavriel.com.ar/assets/index-DUW2J6iO.js?x=1',
      'https://otro.com/assets/index-DUW2J6iO.js',
      'https://app.gavriel.com.ar.evil.com/assets/index-DUW2J6iO.js',
    ]) {
      expect(re.test(no)).toBe(false);
    }
  });
});

describe('tipografías y push', () => {
  test('el CSS de Geist de Google se bloquea solo desde Gavriel (incluidos los tipos de precarga)', async () => {
    const [rule] = await load('fonts');
    expect(rule!.action.type).toBe('block');
    expect(rule!.condition.urlFilter).toContain('fonts.googleapis.com/css2?family=Geist');
    expect(rule!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    expect(rule!.condition.resourceTypes).toEqual(['stylesheet', 'xmlhttprequest', 'other', 'font']);
  });

  test('localFontCss reescribe cada archivo a la URL de la extensión', async () => {
    const css = await Bun.file('static/fonts/gavriel-fonts.css').text();
    const out = localFontCss(css, (path) => `chrome-extension://abc/${path}`);
    expect(out).toContain('url("chrome-extension://abc/fonts/geist-latin.woff2")');
    expect(out.match(/@font-face/g)!.length).toBe(css.match(/@font-face/g)!.length);
  });

  test('push: bloquea Firebase solo cuando lo pide Gavriel', async () => {
    const rules = await load('push');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.action.type).toBe('block');
    expect(rules[0]!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
  });
});

describe('sonidos silenciados', () => {
  test('una regla por sonido, solo sobre Gavriel; sin lista o apagado ninguna', () => {
    const rules = buildRules(['alarm', 'beep'], true);
    expect(rules.map((r) => r.id)).toEqual([RULE_ID_BASE, RULE_ID_BASE + 1]);
    expect(rules[0]!.condition.urlFilter).toBe('||app.gavriel.com.ar/sounds/alarm.');
    expect(rules[0]!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    expect(buildRules(['alarm'], false)).toEqual([]);
    expect(buildRules([], true)).toEqual([]);
  });

  test('descarta nombres raros y repetidos, y nunca pasa del máximo', () => {
    expect(buildRules(['Alarm', 'alarm', '../etc', 'a/b', '', 'x'.repeat(41)], true)).toHaveLength(1);
    expect(buildRules(Array.from({ length: 80 }, (_, i) => `s${i}`), true)).toHaveLength(MAX_RULES);
  });

  test('syncSoundRules quita las propias y agrega las nuevas (o limpia si está apagado)', async () => {
    const calls: { removeRuleIds: number[]; addRules: BlockRule[] }[] = [];
    const api = { updateDynamicRules: async (o: { removeRuleIds: number[]; addRules: BlockRule[] }) => void calls.push(o) };
    expect(await syncSoundRules(api, ['siren'], true)).toBe(1);
    expect(calls[0]!.removeRuleIds).toHaveLength(MAX_RULES);
    await syncSoundRules(api, ['siren'], false);
    expect(calls[1]!.addRules).toEqual([]);
  });
});
