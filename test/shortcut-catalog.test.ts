import { describe, expect, test } from 'bun:test';
import { SCOPE_TITLES, SHORTCUTS, shortcutsFor, type ShortcutScope } from '../src/shared/shortcut-catalog';

const SCOPES = Object.keys(SCOPE_TITLES) as ShortcutScope[];

describe('catálogo de atajos', () => {
  test('cada atajo tiene teclas, descripción y un ámbito conocido', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.keys.every((key) => key.trim() !== '')).toBe(true);
      expect(shortcut.description.trim().length).toBeGreaterThan(10);
      expect(SCOPES).toContain(shortcut.scope);
    }
  });

  test('no repite el mismo atajo dentro de un ámbito', () => {
    for (const scope of SCOPES) {
      const combos = shortcutsFor(scope).map((s) => `${s.chord ? '+' : '|'}${s.keys.join(' ')}`);
      expect(new Set(combos).size).toBe(combos.length);
    }
  });

  test('todos los ámbitos tienen al menos un atajo y un título', () => {
    for (const scope of SCOPES) {
      expect(shortcutsFor(scope).length).toBeGreaterThan(0);
      expect(SCOPE_TITLES[scope].title).not.toBe('');
      expect(SCOPE_TITLES[scope].where).not.toBe('');
    }
  });

  test('los atajos de dos teclas simultáneas se marcan como combinación', () => {
    const altShift = SHORTCUTS.find((s) => s.keys.join('+') === 'Alt+Shift');
    expect(altShift?.chord).toBe(true);
    const arrows = SHORTCUTS.find((s) => s.keys.includes('↑'));
    expect(arrows?.chord).toBe(false);
  });

  test('avisa que el 911 nunca tiene atajo', () => {
    expect(SHORTCUTS.some((s) => /911/.test(s.description))).toBe(true);
  });
});
