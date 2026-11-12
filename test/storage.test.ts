import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import { sanitizeSettings, touches } from '../src/shared/storage';

describe('sanitizeSettings', () => {
  test('sin nada guardado usa los valores por defecto', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  test('conserva lo válido', () => {
    const settings = sanitizeSettings({
      muteEnabled: false,
      shortcutsEnabled: false,
      mutedSounds: ['alarm'],
      knownSounds: ['alarm', 'siren', 'beep', 'ding'],
    });
    expect(settings.muteEnabled).toBe(false);
    expect(settings.shortcutsEnabled).toBe(false);
    expect(settings.mutedSounds).toEqual(['alarm']);
    expect(settings.knownSounds).toHaveLength(4);
  });

  test('una lista vacía es válida: el usuario no silencia nada', () => {
    expect(sanitizeSettings({ mutedSounds: [] }).mutedSounds).toEqual([]);
  });

  test('datos corruptos caen al valor por defecto', () => {
    const settings = sanitizeSettings({
      muteEnabled: 'si',
      shortcutsEnabled: 1,
      mutedSounds: ['alarm', 42],
      knownSounds: 'alarm',
    });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  test('rechaza nombres de sonido raros', () => {
    expect(sanitizeSettings({ mutedSounds: ['../etc/passwd'] }).mutedSounds).toEqual([...DEFAULT_SETTINGS.mutedSounds]);
  });

  test('no comparte referencias con los valores por defecto', () => {
    const settings = sanitizeSettings({});
    settings.mutedSounds.push('x');
    expect(DEFAULT_SETTINGS.mutedSounds).not.toContain('x');
  });
});

describe('touches', () => {
  test('solo cuenta cambios locales de las claves pedidas', () => {
    expect(touches({ muteEnabled: {} }, 'local', 'muteEnabled')).toBe(true);
    expect(touches({ muteEnabled: {} }, 'sync', 'muteEnabled')).toBe(false);
    expect(touches({ otra: {} }, 'local', 'muteEnabled', 'mutedSounds')).toBe(false);
  });
});
