import { beforeEach, describe, expect, test } from 'bun:test';
import { isMicMuted, micTrackCount, setMicMuted, toggleMic, trackStream } from '../../src/content/mic';
import { createCallMute } from '../../src/content/call-mute';
import type { SipClient } from '../../src/content/sip';

interface FakeTrack {
  enabled: boolean;
  readyState: 'live' | 'ended';
}
const stream = (...tracks: FakeTrack[]): MediaStream => ({ getAudioTracks: () => tracks }) as unknown as MediaStream;
const track = (): FakeTrack => ({ enabled: true, readyState: 'live' });

beforeEach(() => {
  // deja el registro vacío: pistas terminadas se descartan solas
  const t = track();
  trackStream(stream(t));
  t.readyState = 'ended';
  setMicMuted(false);
  micTrackCount();
});

describe('micrófono de la llamada', () => {
  test('silenciar desactiva las pistas de audio y reactivar las vuelve a activar', () => {
    const a = track();
    const b = track();
    trackStream(stream(a, b));
    expect(setMicMuted(true)).toBe(true);
    expect([a.enabled, b.enabled]).toEqual([false, false]);
    expect(isMicMuted()).toBe(true);
    expect(toggleMic()).toBe(false);
    expect([a.enabled, b.enabled]).toEqual([true, true]);
    a.readyState = 'ended';
    b.readyState = 'ended';
  });

  test('sin micrófono en uso no hay nada que silenciar', () => {
    expect(setMicMuted(true)).toBeNull();
    expect(toggleMic()).toBeNull();
  });

  test('las pistas terminadas se descartan y una llamada nueva empieza con sonido', () => {
    const old = track();
    trackStream(stream(old));
    setMicMuted(true);
    old.readyState = 'ended';
    const fresh = track();
    trackStream(stream(fresh));
    expect(fresh.enabled).toBe(true);
    expect(isMicMuted()).toBe(false);
    fresh.readyState = 'ended';
  });

  test('un flujo sin audio no cambia nada', () => {
    trackStream(stream());
    expect(micTrackCount()).toBe(0);
  });
});

describe('botón de silencio (DOM)', () => {
  const make = (): { mute: ReturnType<typeof createCallMute>; calls: string[]; toasts: string[]; state: { muted: boolean | null } } => {
    const calls: string[] = [];
    const toasts: string[] = [];
    const state: { muted: boolean | null } = { muted: false };
    const sip: SipClient = {
      run: async () => true,
      caller: async () => null,
      toggleMute: async () => {
        calls.push('mute');
        if (state.muted === null) return null;
        state.muted = !state.muted;
        return state.muted;
      },
      unmute: async () => {
        calls.push('unmute');
        state.muted = false;
        return false;
      },
    };
    document.body.innerHTML = '<button aria-label="Abrir softphone">tel</button>';
    return { mute: createCallMute({ sip, toast: (m) => void toasts.push(m) }), calls, toasts, state };
  };

  test('solo existe durante una llamada', () => {
    const { mute } = make();
    mute.update(false);
    expect(document.querySelector('.gv-mutebtn')).toBeNull();
    mute.update(true);
    expect(document.querySelector('.gv-mutebtn')).not.toBeNull();
    mute.update(false);
    expect(document.querySelector('.gv-mutebtn')).toBeNull();
  });

  test('un clic alterna el silencio, lo muestra y avisa', async () => {
    const { mute, toasts } = make();
    mute.update(true);
    const button = document.querySelector<HTMLButtonElement>('.gv-mutebtn')!;
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(button.classList.contains('gv-muted')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(toasts.at(-1)).toBe('Micrófono silenciado');
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(toasts.at(-1)).toBe('Micrófono activado');
  });

  test('al cortar la llamada con el micrófono silenciado se reactiva solo', async () => {
    const { mute, calls } = make();
    mute.update(true);
    await mute.toggle();
    mute.update(false);
    expect(calls).toEqual(['mute', 'unmute']);
  });

  test('si no se puede silenciar, avisa y no cambia el botón', async () => {
    const { mute, toasts, state } = make();
    state.muted = null;
    mute.update(true);
    expect(await mute.toggle()).toBe(false);
    expect(toasts.at(-1)).toContain('No se pudo silenciar');
    expect(document.querySelector('.gv-mutebtn')!.classList.contains('gv-muted')).toBe(false);
  });
});
