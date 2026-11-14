import { describe, expect, test } from 'bun:test';
import { buildRules, MAX_RULES, RULE_ID_BASE, syncSoundRules, type BlockRule } from '../src/shared/sound-rules';

describe('buildRules', () => {
  test('una regla de bloqueo por sonido, solo sobre el sitio de Gavriel', () => {
    const rules = buildRules(['alarm', 'beep'], true);
    expect(rules.map((r) => r.id)).toEqual([RULE_ID_BASE, RULE_ID_BASE + 1]);
    expect(rules[0]!.action).toEqual({ type: 'block' });
    expect(rules[0]!.condition.urlFilter).toBe('||app.gavriel.com.ar/sounds/alarm.');
    expect(rules[0]!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    expect(rules[1]!.condition.urlFilter).toBe('||app.gavriel.com.ar/sounds/beep.');
  });

  test('silenciador apagado o lista vacía: ninguna regla', () => {
    expect(buildRules(['alarm'], false)).toEqual([]);
    expect(buildRules([], true)).toEqual([]);
  });

  test('descarta nombres raros, repetidos y pasa a minúsculas', () => {
    const rules = buildRules(['Alarm', 'alarm', '../etc', 'a/b', '', 'x'.repeat(41)], true);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.condition.urlFilter).toBe('||app.gavriel.com.ar/sounds/alarm.');
  });

  test('nunca pasa del máximo de reglas reservadas', () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
    expect(buildRules(many, true)).toHaveLength(MAX_RULES);
  });
});

describe('syncSoundRules', () => {
  test('quita todas las reglas propias y agrega las nuevas', async () => {
    const calls: { removeRuleIds: number[]; addRules: BlockRule[] }[] = [];
    const count = await syncSoundRules({ updateDynamicRules: async (o) => void calls.push(o) }, ['siren'], true);
    expect(count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.removeRuleIds).toHaveLength(MAX_RULES);
    expect(calls[0]!.removeRuleIds[0]).toBe(RULE_ID_BASE);
    expect(calls[0]!.addRules[0]!.condition.urlFilter).toContain('/sounds/siren.');
  });

  test('con el silenciador apagado limpia las reglas', async () => {
    const calls: { addRules: BlockRule[] }[] = [];
    await syncSoundRules({ updateDynamicRules: async (o) => void calls.push(o) }, ['siren'], false);
    expect(calls[0]!.addRules).toEqual([]);
  });
});
