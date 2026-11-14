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
    showCallCard: typeof raw.showCallCard === 'boolean' ? raw.showCallCard : DEFAULT_SETTINGS.showCallCard,
    hideSoundBanner:
      typeof raw.hideSoundBanner === 'boolean' ? raw.hideSoundBanner : DEFAULT_SETTINGS.hideSoundBanner,
    plainEvents: typeof raw.plainEvents === 'boolean' ? raw.plainEvents : DEFAULT_SETTINGS.plainEvents,
    hideGridView: typeof raw.hideGridView === 'boolean' ? raw.hideGridView : DEFAULT_SETTINGS.hideGridView,
    liteMode: typeof raw.liteMode === 'boolean' ? raw.liteMode : DEFAULT_SETTINGS.liteMode,
    mutedSounds: isNames(raw.mutedSounds) ? raw.mutedSounds : [...DEFAULT_SETTINGS.mutedSounds],
    knownSounds: isNames(raw.knownSounds) ? raw.knownSounds : [...DEFAULT_SETTINGS.knownSounds],
  };
}

let cached: Promise<Settings> | null = null;
let watching = false;

/**
 * Lee los ajustes. Dentro de una misma página se comparte una sola lectura: los content scripts
 * piden los ajustes varias veces al arrancar y cada cambio en chrome.storage invalida el cache.
 */
export function readSettings(): Promise<Settings> {
  if (!watching) {
    watching = true;
    try {
      // se registra antes que cualquier otro oyente, así los demás ya ven el cache invalidado
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === 'local') cached = null;
      });
    } catch {
      watching = false; // sin chrome.storage (contexto invalidado): se vuelve a intentar la próxima vez
    }
  }
  cached ??= (async () => {
    try {
      return sanitizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
    } catch {
      return sanitizeSettings({}); // contexto invalidado o almacenamiento caído: valores por defecto
    }
  })();
  return cached;
}

export async function readSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  return (await readSettings())[key];
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  try {
    await chrome.storage.local.set(patch);
  } catch {
    /* contexto invalidado: no hay nada que guardar */
  }
}

/** ¿Este cambio de chrome.storage toca alguna de estas claves? */
export function touches(changes: Record<string, unknown>, area: string, ...keys: (keyof Settings)[]): boolean {
  return area === 'local' && keys.some((key) => key in changes);
}
