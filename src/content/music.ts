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

export function readState(source: MediaSource, now = Date.now()): MediaState | null {
  const meta = navigator.mediaSession?.metadata;
  const media = mediaElement();
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
  switch (action) {
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

  const push = (force = false): void => {
    try {
      const state = readState(source);
      if (!state) return;
      // Sin cambios de fondo (la posición avanza sola) se informa como mucho cada 2 s
      const key = `${state.title}|${state.artist}|${state.playing}|${state.volume.toFixed(2)}|${state.muted}|${Math.round(state.duration)}`;
      const now = Date.now();
      if (!force && key === last && now - lastSentAt < 2000) return;
      last = key;
      lastSentAt = now;
      void chrome.runtime.sendMessage({ type: 'media-state', state }).catch(() => {});
    } catch {
      /* contexto invalidado */
    }
  };

  // Los eventos multimedia no burbujean: se escuchan en captura sobre el documento (sirve para cualquier <audio>/<video>)
  for (const type of ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'emptied']) {
    document.addEventListener(type, () => push(true), true);
  }
  document.addEventListener('timeupdate', () => push(), true);
  // Red de seguridad: cambios de tema sin evento (metadatos que se actualizan solos)
  setInterval(() => push(), 3000);
  push(true);

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const m = message as { type?: string; action?: MediaAction; value?: number } | null;
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
