/** Configuración guardada en chrome.storage.local (la comparten popup y content scripts). */
export type Settings = {
  /** Interruptor general del silenciador. */
  muteEnabled: boolean;
  /** Interruptor general de los atajos de teclado. */
  shortcutsEnabled: boolean;
  /** Al abrir una cuenta, entrar directo a la pestaña Contactos. */
  openContactsTab: boolean;
  /** Al abrir una cuenta, mostrar la clave y la contraclave (toca el ojito). */
  revealSecrets: boolean;
  /** Nombres (sin extensión) de los sonidos de /sounds/ que se silencian. */
  mutedSounds: string[];
  /** Sonidos que Gavriel ya reprodujo (lista que muestra el popup). */
  knownSounds: string[];
}

/**
 * Sonidos que Gavriel reproduce en el panel (verificado en su código):
 *  - siren / alarm: sonido configurado por tipo de evento
 *  - beep: aviso cuando entran eventos nuevos
 */
export const DEFAULT_SOUNDS: readonly string[] = ['alarm', 'siren', 'beep'];

export const DEFAULT_SETTINGS: Settings = {
  muteEnabled: true,
  shortcutsEnabled: true,
  openContactsTab: true,
  revealSecrets: true,
  mutedSounds: [...DEFAULT_SOUNDS],
  knownSounds: [...DEFAULT_SOUNDS],
};

/** Atributos de <html> con los que bridge.ts le pasa la configuración a mute.ts. */
export const MUTE_ATTR = 'data-gavriel-mute';
export const MUTED_SOUNDS_ATTR = 'data-gavriel-muted-sounds';

/** Evento con el que mute.ts avisa que Gavriel reprodujo un sonido (detail = nombre). */
export const SOUND_SEEN_EVENT = 'gavriel:sound-seen';

/** Nombres de sonido aceptados al guardarlos (evita guardar basura de la página). */
export const SOUND_NAME_PATTERN = /^[\w.-]{1,40}$/;

export const FRIENDLY_SOUND_NAMES: Readonly<Record<string, string>> = {
  alarm: 'Alarma',
  siren: 'Sirena',
  beep: 'Beep de eventos nuevos',
};
