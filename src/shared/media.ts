/**
 * Reproductor de música en la barra de Gavriel (Spotify Web y YouTube Music abiertos en otra pestaña).
 * Lógica pura: qué es cada pestaña, cuál se muestra y cómo se formatea.
 */

export type MediaSource = 'spotify' | 'ytmusic';
export type MediaAction = 'toggle' | 'next' | 'prev' | 'mute' | 'volume' | 'seek' | 'skip';

export interface MediaState {
  source: MediaSource;
  title: string;
  artist: string;
  playing: boolean;
  /** 0 a 1 */
  volume: number;
  muted: boolean;
  /** segundos */
  position: number;
  duration: number;
  /** Cuándo lo informó la pestaña (ms desde 1970). */
  at: number;
  /** Carátula (URL https de los servidores de imágenes de Spotify / YouTube); ausente si no hay. */
  art?: string;
}

/** Servidores de imágenes de las carátulas: solo estos se dibujan (el dato llega de otra pestaña). */
const ART_HOSTS = /^(i\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com|[a-z0-9-]+\.googleusercontent\.com|i\.ytimg\.com|[a-z0-9-]+\.ggpht\.com)$/i;

/** URL de carátula válida (https y de un servidor conocido) o ''. */
export function safeArtUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ART_HOSTS.test(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}

/** De la lista `artwork` de mediaSession elige la imagen más cercana a ~96 px (suficiente para 28 px con pantallas densas). */
export function pickArtwork(list: readonly { src?: string; sizes?: string }[] | undefined): string {
  let best = '';
  let bestGap = Infinity;
  for (const item of list ?? []) {
    const src = safeArtUrl(item?.src);
    if (!src) continue;
    const side = Number(/^(\d+)x\d+/.exec(item.sizes ?? '')?.[1]) || 96;
    const gap = Math.abs(side - 96);
    if (gap < bestGap) {
      best = src;
      bestGap = gap;
    }
  }
  return best;
}

export interface TabMedia extends MediaState {
  tabId: number;
}

export const SOURCE_LABELS: Readonly<Record<MediaSource, string>> = { spotify: 'Spotify', ytmusic: 'YouTube Music' };

export function sourceOfHost(host: string): MediaSource | null {
  if (host === 'open.spotify.com') return 'spotify';
  if (host === 'music.youtube.com') return 'ytmusic';
  return null;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

/** Valida lo que manda una pestaña de música (llega por mensajes: se trata como dato). */
export function sanitizeState(value: unknown, now = Date.now()): MediaState | null {
  const v = value as Partial<MediaState> | null;
  if (!v || typeof v !== 'object') return null;
  if (v.source !== 'spotify' && v.source !== 'ytmusic') return null;
  const str = (s: unknown, max: number): string => (typeof s === 'string' ? s.slice(0, max) : '');
  const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const art = safeArtUrl(v.art);
  return {
    source: v.source,
    ...(art ? { art } : {}),
    title: str(v.title, 200),
    artist: str(v.artist, 200),
    playing: v.playing === true,
    volume: clamp(num(v.volume), 0, 1),
    muted: v.muted === true,
    position: Math.max(0, num(v.position)),
    duration: Math.max(0, num(v.duration)),
    at: now,
  };
}

/**
 * Qué pestaña se muestra: la que está sonando; si suenan varias o ninguna, la que se eligió a mano (si
 * sigue abierta) y, si no, la que informó más recientemente.
 */
export function pickActive(states: readonly TabMedia[], preferredTabId?: number): TabMedia | null {
  if (states.length === 0) return null;
  const preferred = states.find((s) => s.tabId === preferredTabId);
  const playing = states.filter((s) => s.playing);
  if (preferred && (playing.length === 0 || preferred.playing)) return preferred;
  const pool = playing.length > 0 ? playing : states;
  return [...pool].sort((a, b) => b.at - a.at)[0] ?? null;
}

/** Siguiente pestaña al cambiar de reproductor a mano (circular). */
export function nextTab(states: readonly TabMedia[], currentTabId: number | undefined): number | undefined {
  if (states.length === 0) return undefined;
  const ordered = [...states].sort((a, b) => a.tabId - b.tabId);
  const at = ordered.findIndex((s) => s.tabId === currentTabId);
  return ordered[(at + 1) % ordered.length]!.tabId;
}

/** 3:07 · 1:02:09 */
export function formatTime(seconds: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * ¿Es lo mismo que ya se informó (salvo el avance natural de la posición)? Si sí, no hace falta guardar
 * ni avisar a las pestañas de Gavriel: la barra ya interpola la posición sola.
 */
export function sameMedia(a: MediaState | undefined, b: MediaState, driftSeconds = 4): boolean {
  if (!a) return false;
  if (a.source !== b.source || a.title !== b.title || a.artist !== b.artist || a.art !== b.art) return false;
  if (a.playing !== b.playing || a.muted !== b.muted || a.duration !== b.duration) return false;
  if (Math.abs(a.volume - b.volume) > 0.005) return false;
  const expected = a.playing ? a.position + (b.at - a.at) / 1000 : a.position;
  return Math.abs(b.position - expected) <= driftSeconds;
}

/** Lista de pestañas que llega del fondo, ya validada (cada una con su tabId). */
export function sanitizeTabs(value: unknown, now = Date.now()): TabMedia[] {
  if (!Array.isArray(value)) return [];
  const out: TabMedia[] = [];
  for (const item of value.slice(0, 20)) {
    const state = sanitizeState(item, now);
    const tabId = (item as { tabId?: unknown } | null)?.tabId;
    const at = (item as { at?: unknown } | null)?.at;
    if (state && typeof tabId === 'number') out.push({ ...state, tabId, at: typeof at === 'number' ? at : now });
  }
  return out;
}

export const isMediaAction = (value: unknown): value is MediaAction =>
  value === 'toggle' || value === 'next' || value === 'prev' || value === 'mute' || value === 'volume' || value === 'seek' || value === 'skip';
