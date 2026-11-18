/**
 * Corre dentro de las pestañas de Spotify Web y YouTube Music: informa qué suena y ejecuta los pedidos
 * de control que llegan desde la barra de Gavriel (por el fondo). No pide nada a la red ni usa cuentas.
 *
 * Qué se lee (estándar en ambos sitios):
 *  - Título, artista y estado: `navigator.mediaSession` (lo publican las dos webs para los controles del sistema).
 *  - Volumen, silencio, posición y duración: el elemento <audio>/<video> que reproduce.
 *
 * Cómo se controla:
 *  - Reproducir/pausar y anterior/siguiente: se aprieta el botón real del reproductor del sitio (así la
 *    interfaz del sitio no se desincroniza); si no se lo encuentra, play()/pause() sobre el elemento.
 *  - Volumen, silencio y posición: directo sobre el elemento multimedia.
 * Los selectores de los botones son del sitio y pueden cambiar cuando lo actualicen; sin ellos solo
 * funciona reproducir/pausar, volumen, silencio y posición.
 */
import { type MediaAction, type MediaSource, type MediaState, sourceOfHost } from '../shared/media';

interface Adapter {
  toggle: string[];
  next: string[];
  prev: string[];
}

const ADAPTERS: Readonly<Record<MediaSource, Adapter>> = {
  spotify: {
    toggle: ['[data-testid="control-button-playpause"]'],
    next: ['[data-testid="control-button-skip-forward"]'],
    prev: ['[data-testid="control-button-skip-back"]'],
  },
  ytmusic: {
    toggle: ['ytmusic-player-bar #play-pause-button', '#play-pause-button'],
    next: ['ytmusic-player-bar .next-button', '.next-button'],
    prev: ['ytmusic-player-bar .previous-button', '.previous-button'],
  },
};

const mediaElement = (): HTMLMediaElement | null => {
  const all = [...document.querySelectorAll<HTMLMediaElement>('audio, video')];
  // el que está sonando; si ninguno, el que tiene algo cargado
  return all.find((m) => !m.paused) ?? all.find((m) => m.readyState > 0 && m.duration > 0) ?? all[0] ?? null;
};

const clickFirst = (selectors: readonly string[]): boolean => {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.click();
      return true;
    }
  }
  return false;
};

/**
 * Spotify Web suele ser solo el control remoto de la app de escritorio (Spotify Connect): entonces la
 * pestaña no tiene <audio> propio y todo se lee y se maneja desde la interfaz del reproductor.
 */
const SPOTIFY_UI = {
  play: '[data-testid="control-button-playpause"]',
  volume: '[data-testid="volume-bar"] input[type="range"]',
  progress: '[data-testid="playback-progressbar"] input[type="range"]',
  title: '[data-testid="context-item-info-title"]',
  artist: '[data-testid="context-item-info-subtitles"], [data-testid="context-item-info-artist"]',
};

const spotifyRange = (selector: string): HTMLInputElement | null => document.querySelector<HTMLInputElement>(selector);

/** Cambia un <input type=range> de React: hay que usar el setter nativo y avisar. */
function setRange(input: HTMLInputElement, value: number): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Volumen que había antes de silenciar (el silencio de Spotify se simula con volumen 0). */
let volumeBeforeMute = 0.5;

function readSpotifyUi(): Pick<MediaState, 'playing' | 'volume' | 'muted' | 'position' | 'duration'> | null {
  const play = document.querySelector<HTMLElement>(SPOTIFY_UI.play);
  if (!play) return null;
  const volume = spotifyRange(SPOTIFY_UI.volume);
  const progress = spotifyRange(SPOTIFY_UI.progress);
  const vol = volume ? Number(volume.value) : 1;
  return {
    playing: /paus/i.test(play.getAttribute('aria-label') ?? ''),
    volume: Number.isFinite(vol) ? vol : 1,
    muted: vol === 0,
    position: progress ? Number(progress.value) / 1000 : 0,
    duration: progress ? Number(progress.max) / 1000 : 0,
  };
}

function runSpotifyUi(action: MediaAction, value?: number): boolean | null {
  const volume = spotifyRange(SPOTIFY_UI.volume);
  const progress = spotifyRange(SPOTIFY_UI.progress);
  const ok = typeof value === 'number' && Number.isFinite(value);
  switch (action) {
    case 'volume':
      if (!volume || !ok) return false;
      setRange(volume, Math.min(1, Math.max(0, value)));
      return true;
    case 'mute': {
      if (!volume) return false;
      const now = Number(volume.value);
      if (now > 0) {
        volumeBeforeMute = now;
        setRange(volume, 0);
      } else setRange(volume, volumeBeforeMute || 0.5);
      return true;
    }
    case 'seek':
      if (!progress || !ok) return false;
      setRange(progress, Math.min(Number(progress.max), Math.max(0, value * 1000)));
      return true;
    case 'skip':
      if (!progress || !ok) return false;
      setRange(progress, Math.min(Number(progress.max), Math.max(0, Number(progress.value) + value * 1000)));
      return true;
    default:
      return null; // reproducir, anterior y siguiente siguen por los botones de siempre
  }
}

export function readState(source: MediaSource, now = Date.now()): MediaState | null {
  const meta = navigator.mediaSession?.metadata;
  const media = mediaElement();
  if (source === 'spotify' && !media?.currentSrc) {
    const ui = readSpotifyUi();
    if (ui) {
      const text = (sel: string): string => document.querySelector(sel)?.textContent?.trim() ?? '';
      return { source, title: meta?.title || text(SPOTIFY_UI.title), artist: meta?.artist || text(SPOTIFY_UI.artist), ...ui, at: now };
    }
  }
  if (!meta && !media) return null;
  const playing = navigator.mediaSession?.playbackState === 'playing' || (!!media && !media.paused && !media.ended);
  return {
    source,
    title: meta?.title ?? '',
    artist: meta?.artist ?? '',
    playing,
    volume: media?.volume ?? 1,
    muted: media?.muted ?? false,
    position: media?.currentTime ?? 0,
    duration: Number.isFinite(media?.duration) ? (media?.duration ?? 0) : 0,
    at: now,
  };
}

export function runCommand(source: MediaSource, action: MediaAction, value?: number): boolean {
  const media = mediaElement();
  if (source === 'spotify' && !media?.currentSrc && document.querySelector(SPOTIFY_UI.play)) {
    const handled = runSpotifyUi(action, value);
    if (handled !== null) return handled;
  }
  switch (action) {
    case 'skip':
      if (!media || typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(media.duration)) return false;
      media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + value));
      return true;
    case 'toggle':
      if (clickFirst(ADAPTERS[source].toggle)) return true;
      if (!media) return false;
      void (media.paused ? media.play() : Promise.resolve(media.pause()));
      return true;
    case 'next':
      return clickFirst(ADAPTERS[source].next);
    case 'prev':
      return clickFirst(ADAPTERS[source].prev);
    case 'mute':
      if (!media) return false;
      media.muted = !media.muted;
      return true;
    case 'volume':
      if (!media || typeof value !== 'number' || !Number.isFinite(value)) return false;
      media.volume = Math.min(1, Math.max(0, value));
      if (media.volume > 0) media.muted = false;
      return true;
    case 'seek':
      if (!media || typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(media.duration)) return false;
      media.currentTime = Math.min(media.duration, Math.max(0, value));
      return true;
  }
}

declare global {
  interface Window {
    __gvMusic?: boolean;
  }
}

function main(): void {
  const source = sourceOfHost(location.hostname);
  if (!source) return;
  let last = '';
  let lastSentAt = 0;
  let playing = false; // lo último que se vio: decide con qué frecuencia mirar
  /** Mientras suena se repite el estado cada tanto (la barra de Gavriel interpola la posición entre avisos). */
  const HEARTBEAT_MS = 15_000;

  const push = (force = false): void => {
    try {
      const state = readState(source);
      if (!state) return;
      playing = state.playing;
      // Sin cambios de fondo (la posición avanza sola) solo se repite cada HEARTBEAT_MS, y nunca en pausa
      const key = `${state.title}|${state.artist}|${state.playing}|${state.volume.toFixed(2)}|${state.muted}|${Math.round(state.duration)}`;
      const now = Date.now();
      if (!force && key === last && (!state.playing || now - lastSentAt < HEARTBEAT_MS)) return;
      last = key;
      lastSentAt = now;
      void chrome.runtime.sendMessage({ type: 'media-state', state }).catch(() => {});
    } catch {
      /* contexto invalidado */
    }
  };

  // Los eventos multimedia no burbujean: se escuchan en captura sobre el documento (sirve para cualquier <audio>/<video>)
  // (sin 'timeupdate': dispara varias veces por segundo y la posición no hace falta con tanta frecuencia)
  for (const type of ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'emptied', 'seeked']) {
    document.addEventListener(type, () => push(true), true);
  }
  // Cambios sin evento (Spotify como control remoto, cambio de tema): una lectura barata cada 3 s. Con la pestaña oculta y la
  // música en pausa solo se mira una de cada 5 (cada 15 s): al reanudar llegan los eventos play/pause, que avisan al instante.
  let skipped = 0;
  setInterval(() => {
    if (document.hidden && !playing && ++skipped % 5 !== 0) return;
    push();
  }, 3000);
  push(true);

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const m = message as { type?: string; action?: MediaAction; value?: number } | null;
    if (m?.type === 'media-poll') {
      push(true); // una pestaña de Gavriel recién abierta quiere saber qué hay
      return false;
    }
    if (m?.type === 'media-command' && m.action) {
      runCommand(source, m.action, m.value);
      setTimeout(() => push(true), 150);
    }
    return false;
  });
}

if (!window.__gvMusic) {
  window.__gvMusic = true;
  main();
}
