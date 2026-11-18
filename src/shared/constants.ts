/**
 * Interruptores de la extensión (todos activados por defecto). Un ajuste nuevo = una línea acá + su <label> en options.html
 * + su id en SWITCH_IDS (options.ts, el compilador avisa si falta). El tipo, la lectura segura (storage.ts), «Restablecer»
 * y la actualización en vivo de Opciones salen de esta tabla.
 */
export const SWITCH_DEFAULTS = {
  /** Interruptor general del silenciador. */
  muteEnabled: true,
  /** Interruptor general de los atajos de teclado. */
  shortcutsEnabled: true,
  /** Al abrir una cuenta, entrar directo a la pestaña Contactos. */
  openContactsTab: true,
  /** Al abrir una cuenta, mostrar la clave y la contraclave (toca el ojito). */
  revealSecrets: true,
  /** Durante una llamada, mostrar una tarjeta flotante con a quién se llama. */
  showCallCard: true,
  /** Oculta el aviso naranja "Alerta sonora · N pendientes" del panel de monitoreo. */
  hideSoundBanner: true,
  /** Quita el fondo de color de las tarjetas de eventos (queda la franja de color a la izquierda). */
  plainEvents: true,
  /** Oculta el botón de la vista Grilla del panel (quedan Kanban y Mapa). */
  hideGridView: true,
  /** Modo ahorro: sin desenfoque ni animaciones continuas y con dibujado perezoso de las tarjetas. */
  liteMode: true,
  /** Guarda en el navegador los archivos con hash de Gavriel (el servidor pide no guardarlos nunca). */
  cacheAssets: true,
  /** Usa las tipografías Geist de la extensión y bloquea el CSS de Google Fonts (cero pedidos externos). */
  localFonts: true,
  /** Bloquea las notificaciones push de Gavriel (Firebase): ni se suscribe ni se piden al servidor. */
  blockPush: true,
  /** Responde desde memoria el segundo pedido idéntico de la cuenta (abrir una cuenta es ~1 s más rápido). */
  dedupeAccount: true,
  /** Apaga todas las animaciones y transiciones CSS de Gavriel (quedan los indicadores de carga). */
  disableAnimations: true,
  /** Avisos del navegador por tipo de evento nuevo (hace falta una pestaña de Gavriel abierta). */
  notifyEnabled: true,
  /** Reproductor de Spotify Web / YouTube Music en la barra de arriba de Gavriel. */
  mediaPlayer: true,
  /** Ronda de llamadas a contactos con Alt+Enter (tildes, colores y contador de ronda). */
  callRound: true,
  /** Índice de cuentas y contactos: búsqueda a fondo y cuenta de la llamada entrante (ver account-index.ts). */
  accountIndex: true,
} as const;

export type SwitchKey = keyof typeof SWITCH_DEFAULTS;
export const SWITCH_KEYS = Object.keys(SWITCH_DEFAULTS) as SwitchKey[];

/** Configuración guardada en chrome.storage.local (la comparten popup y content scripts). */
export type Settings = { [K in SwitchKey]: boolean } & {
  /** Tipos que avisan: BUR, POW, PAN, MED, INC. */
  notifyTypes: string[];
  /** Nombres (sin extensión) de los sonidos de /sounds/ que se silencian. */
  mutedSounds: string[];
  /** Sonidos que Gavriel ya reprodujo (lista que muestra el popup). */
  knownSounds: string[];
};

/**
 * Sonidos que Gavriel reproduce en el panel (verificado en su código):
 *  - siren / alarm: sonido configurado por tipo de evento
 *  - beep: aviso cuando entran eventos nuevos
 */
export const DEFAULT_SOUNDS: readonly string[] = ['alarm', 'siren', 'beep'];

export const DEFAULT_SETTINGS: Settings = {
  ...SWITCH_DEFAULTS,
  notifyTypes: ['BUR', 'POW', 'PAN', 'MED', 'INC'],
  mutedSounds: [...DEFAULT_SOUNDS],
  knownSounds: [...DEFAULT_SOUNDS],
};

/** Atributos de <html> con los que bridge.ts le pasa la configuración a mute.ts. */
export const MUTE_ATTR = 'data-gavriel-mute';
export const MUTED_SOUNDS_ATTR = 'data-gavriel-muted-sounds';

/** Evento con el que mute.ts avisa que Gavriel reprodujo un sonido (detail = nombre). */
export const SOUND_SEEN_EVENT = 'gavriel:sound-seen';

/** Eventos con los que net-tap.ts (mundo de la página) le pasa al mundo aislado los datos de Gavriel. */
export const TAP_EVENT = 'gavriel:tap';
export const TAP_REPLAY_EVENT = 'gavriel:tap-replay';

/** Pedido (aislado -> página) y respuesta (página -> aislado) para colgar/atender/rechazar (sip-bridge.ts). */
export const GAPI_REQUEST_EVENT = 'gavriel:api-request';
export const GAPI_RESULT_EVENT = 'gavriel:api-result';
export const SIP_REQUEST_EVENT = 'gavriel:sip-request';
export const SIP_RESULT_EVENT = 'gavriel:sip-result';

/** Nombres de sonido aceptados al guardarlos (evita guardar basura de la página). */
export const SOUND_NAME_PATTERN = /^[\w.-]{1,40}$/;

export const FRIENDLY_SOUND_NAMES: Readonly<Record<string, string>> = {
  alarm: 'Alarma',
  siren: 'Sirena',
  beep: 'Beep de eventos nuevos',
};
