import { DEFAULT_SETTINGS, SOUND_NAME_PATTERN, type Settings } from './constants';

const isNames = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string' && SOUND_NAME_PATTERN.test(v));

/**
 * Convierte lo que haya en chrome.storage en un Settings válido: cualquier campo
 * ausente o corrupto cae al valor por defecto (nunca rompe la extensión).
 */
export function sanitizeSettings(raw: Record<string, unknown>): Settings {
  return {
    muteEnabled: typeof raw.muteEnabled === 'boolean' ? raw.muteEnabled : DEFAULT_SETTINGS.muteEnabled,
    shortcutsEnabled:
      typeof raw.shortcutsEnabled === 'boolean' ? raw.shortcutsEnabled : DEFAULT_SETTINGS.shortcutsEnabled,
    openContactsTab:
      typeof raw.openContactsTab === 'boolean' ? raw.openContactsTab : DEFAULT_SETTINGS.openContactsTab,
    revealSecrets: typeof raw.revealSecrets === 'boolean' ? raw.revealSecrets : DEFAULT_SETTINGS.revealSecrets,
    mutedSounds: isNames(raw.mutedSounds) ? raw.mutedSounds : [...DEFAULT_SETTINGS.mutedSounds],
    knownSounds: isNames(raw.knownSounds) ? raw.knownSounds : [...DEFAULT_SETTINGS.knownSounds],
  };
}

export async function readSettings(): Promise<Settings> {
  return sanitizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

export async function readSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  return (await readSettings())[key];
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/** ¿Este cambio de chrome.storage toca alguna de estas claves? */
export function touches(changes: Record<string, unknown>, area: string, ...keys: (keyof Settings)[]): boolean {
  return area === 'local' && keys.some((key) => key in changes);
}
