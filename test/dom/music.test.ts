import { afterEach, describe, expect, test } from 'bun:test';
import { readState, runCommand } from '../../src/content/music';

interface FakeMedia {
  paused: boolean;
  ended: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  readyState: number;
  play: () => Promise<void>;
  pause: () => void;
}

const calls: string[] = [];

function mountMedia(over: Partial<FakeMedia> = {}): FakeMedia {
  const media: FakeMedia = {
    paused: false,
    ended: false,
    volume: 0.6,
    muted: false,
    currentTime: 42,
    duration: 180,
    readyState: 4,
    play: async () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    ...over,
  };
  // happy-dom no reproduce audio: se usa un <audio> real del DOM con las propiedades pisadas
  const el = document.createElement('audio');
  for (const [k, v] of Object.entries(media)) Object.defineProperty(el, k, { value: v, writable: true, configurable: true });
  document.body.append(el);
  return el as unknown as FakeMedia;
}

function setSession(metadata: { title: string; artist: string } | null, playbackState = 'playing'): void {
  Object.defineProperty(navigator, 'mediaSession', { value: { metadata, playbackState }, configurable: true });
}

const button = (selector: string, label: string): void => {
  const b = document.createElement('button');
  b.setAttribute('data-test', label);
  b.addEventListener('click', () => calls.push(label));
  const host = document.createElement('div');
  host.innerHTML = selector;
  host.firstElementChild!.append(b);
  document.body.append(host.firstElementChild!);
};

afterEach(() => {
  document.body.innerHTML = '';
  calls.length = 0;
  setSession(null);
});

describe('readState', () => {
  test('toma título y artista de mediaSession, y volumen y posición del elemento', () => {
    setSession({ title: 'Tema', artist: 'Banda' });
    mountMedia();
    expect(readState('spotify', 9)).toEqual({
      source: 'spotify',
      title: 'Tema',
      artist: 'Banda',
      playing: true,
      volume: 0.6,
      muted: false,
      position: 42,
      duration: 180,
      at: 9,
    });
  });

  test('sin metadatos ni elemento no hay nada que informar', () => {
    expect(readState('ytmusic')).toBeNull();
  });

  test('en pausa, y con duración desconocida (transmisión en vivo) informa 0', () => {
    setSession({ title: 'Vivo', artist: '' }, 'paused');
    mountMedia({ paused: true, duration: Infinity });
    const state = readState('ytmusic')!;
    expect(state.playing).toBe(false);
    expect(state.duration).toBe(0);
  });
});

describe('runCommand', () => {
  test('reproducir/pausar aprieta el botón del sitio; sin botón usa el elemento', () => {
    mountMedia({ paused: true });
    button('<div data-testid="control-button-playpause"></div>', 'inner');
    // el selector de Spotify apunta al propio elemento con data-testid: se hace clic ahí
    const target = document.querySelector<HTMLElement>('[data-testid="control-button-playpause"]')!;
    target.addEventListener('click', () => calls.push('toggle-sitio'));
    expect(runCommand('spotify', 'toggle')).toBe(true);
    expect(calls).toContain('toggle-sitio');

    document.body.innerHTML = '';
    calls.length = 0;
    mountMedia({ paused: true });
    expect(runCommand('spotify', 'toggle')).toBe(true);
    expect(calls).toEqual(['play']);
  });

  test('anterior y siguiente solo existen si el sitio tiene sus botones', () => {
    expect(runCommand('ytmusic', 'next')).toBe(false);
    const next = document.createElement('div');
    next.className = 'next-button';
    next.addEventListener('click', () => calls.push('siguiente'));
    document.body.append(next);
    expect(runCommand('ytmusic', 'next')).toBe(true);
    expect(calls).toEqual(['siguiente']);
    expect(runCommand('ytmusic', 'prev')).toBe(false);
  });

  test('volumen acotado entre 0 y 1, que además quita el silencio', () => {
    const media = mountMedia({ volume: 0.2, muted: true });
    expect(runCommand('spotify', 'volume', 0.9)).toBe(true);
    expect(media.volume).toBe(0.9);
    expect(media.muted).toBe(false);
    runCommand('spotify', 'volume', 7);
    expect(media.volume).toBe(1);
    runCommand('spotify', 'volume', -3);
    expect(media.volume).toBe(0);
    expect(runCommand('spotify', 'volume', NaN)).toBe(false);
    expect(runCommand('spotify', 'volume')).toBe(false);
  });

  test('silenciar alterna y la posición se acota a la duración', () => {
    const media = mountMedia({ muted: false });
    expect(runCommand('spotify', 'mute')).toBe(true);
    expect(media.muted).toBe(true);
    runCommand('spotify', 'mute');
    expect(media.muted).toBe(false);
    runCommand('spotify', 'seek', 100);
    expect(media.currentTime).toBe(100);
    runCommand('spotify', 'seek', 9999);
    expect(media.currentTime).toBe(180);
    runCommand('spotify', 'seek', -5);
    expect(media.currentTime).toBe(0);
  });

  test('sin reproductor en la página, los comandos de volumen y posición no hacen nada', () => {
    expect(runCommand('spotify', 'mute')).toBe(false);
    expect(runCommand('spotify', 'seek', 10)).toBe(false);
  });
});
