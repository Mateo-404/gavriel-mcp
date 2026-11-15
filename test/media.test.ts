import { describe, expect, test } from 'bun:test';
import { type TabMedia, formatTime, isMediaAction, nextTab, pickActive, sanitizeState, sourceOfHost } from '../src/shared/media';

const tab = (tabId: number, over: Partial<TabMedia> = {}): TabMedia => ({
  tabId,
  source: 'spotify',
  title: 'T',
  artist: 'A',
  playing: false,
  volume: 0.5,
  muted: false,
  position: 0,
  duration: 100,
  at: tabId,
  ...over,
});

describe('sourceOfHost', () => {
  test('reconoce Spotify Web y YouTube Music', () => {
    expect(sourceOfHost('open.spotify.com')).toBe('spotify');
    expect(sourceOfHost('music.youtube.com')).toBe('ytmusic');
    for (const host of ['www.youtube.com', 'spotify.com', 'open.spotify.com.evil.com', '']) expect(sourceOfHost(host)).toBeNull();
  });
});

describe('sanitizeState', () => {
  test('acota el volumen, recorta textos y descarta lo que no es un estado', () => {
    const s = sanitizeState({ source: 'ytmusic', title: 'x'.repeat(500), artist: 7, playing: true, volume: 3, muted: 'si', position: -4, duration: Infinity }, 5)!;
    expect(s.title).toHaveLength(200);
    expect(s).toMatchObject({ artist: '', playing: true, volume: 1, muted: false, position: 0, duration: 0, at: 5 });
    expect(sanitizeState(null)).toBeNull();
    expect(sanitizeState({ source: 'otra' })).toBeNull();
    expect(sanitizeState('x')).toBeNull();
  });
});

describe('pickActive', () => {
  test('sin pestañas no hay nada que mostrar', () => {
    expect(pickActive([])).toBeNull();
  });

  test('gana la que está sonando; entre varias que suenan, la más reciente', () => {
    expect(pickActive([tab(1), tab(2, { playing: true }), tab(3)])!.tabId).toBe(2);
    expect(pickActive([tab(1, { playing: true, at: 10 }), tab(2, { playing: true, at: 20 })])!.tabId).toBe(2);
  });

  test('si ninguna suena, la más reciente', () => {
    expect(pickActive([tab(1, { at: 5 }), tab(2, { at: 9 })])!.tabId).toBe(2);
  });

  test('la elegida a mano se respeta si suena o si ninguna suena, y se ignora si otra suena y ella no', () => {
    expect(pickActive([tab(1, { at: 5 }), tab(2, { at: 9 })], 1)!.tabId).toBe(1);
    expect(pickActive([tab(1, { playing: true }), tab(2, { playing: true, at: 99 })], 1)!.tabId).toBe(1);
    expect(pickActive([tab(1), tab(2, { playing: true })], 1)!.tabId).toBe(2);
    expect(pickActive([tab(1)], 42)!.tabId).toBe(1);
  });
});

describe('nextTab / formatTime / isMediaAction', () => {
  test('cambiar de reproductor da la vuelta', () => {
    const states = [tab(7), tab(3), tab(5)];
    expect(nextTab(states, 3)).toBe(5);
    expect(nextTab(states, 7)).toBe(3);
    expect(nextTab(states, undefined)).toBe(3);
    expect(nextTab([], 1)).toBeUndefined();
  });

  test('formatea el tiempo', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(187.9)).toBe('3:07');
    expect(formatTime(3729)).toBe('1:02:09');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  test('acciones válidas', () => {
    for (const a of ['toggle', 'next', 'prev', 'mute', 'volume', 'seek']) expect(isMediaAction(a)).toBe(true);
    expect(isMediaAction('delete')).toBe(false);
  });
});

import { sameMedia, type MediaState } from '../src/shared/media';

describe('sameMedia (qué no hace falta volver a avisar)', () => {
  const base: MediaState = { source: 'spotify', title: 'T', artist: 'A', playing: true, volume: 0.5, muted: false, position: 10, duration: 200, at: 1_000_000 };
  test('solo avanzó la posición como corresponde: igual', () => {
    expect(sameMedia(base, { ...base, position: 15, at: base.at + 5000 })).toBe(true);
  });
  test('un salto de posición (se movió la barra) sí se avisa', () => {
    expect(sameMedia(base, { ...base, position: 90, at: base.at + 5000 })).toBe(false);
  });
  test('en pausa la posición no debería avanzar', () => {
    const paused = { ...base, playing: false };
    expect(sameMedia(paused, { ...paused, position: 10, at: base.at + 9000 })).toBe(true);
    expect(sameMedia(paused, { ...paused, position: 30, at: base.at + 9000 })).toBe(false);
  });
  test('cambio de tema, pausa, volumen o silencio se avisan; sin estado previo también', () => {
    expect(sameMedia(base, { ...base, title: 'Otro' })).toBe(false);
    expect(sameMedia(base, { ...base, playing: false })).toBe(false);
    expect(sameMedia(base, { ...base, volume: 0.6 })).toBe(false);
    expect(sameMedia(base, { ...base, muted: true })).toBe(false);
    expect(sameMedia(undefined, base)).toBe(false);
  });
});
