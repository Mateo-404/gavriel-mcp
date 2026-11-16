import { describe, expect, test } from 'bun:test';
import { installRtcFix, sanitizeSdp } from '../src/content/rtc-fix';

const offer = [
  'v=0',
  'o=- 1 1 IN IP6 fe80::1234:abcd',
  'c=IN IP6 fe80::1234:abcd',
  'm=audio 4000 RTP/SAVPF 0 2 8 101',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:2 G726-32/8000',
  'a=fmtp:2 something',
  'a=rtpmap:8 PCMA/8000',
  'm=video 4002 RTP/AVP 99',
  '',
].join('\r\n');

describe('sanitizeSdp', () => {
  test('saca IPv6 link-local, apaga el video y quita el payload 2', () => {
    const out = sanitizeSdp(offer);
    expect(out).not.toContain('fe80');
    expect(out).toContain('IN IP4 0.0.0.0');
    expect(out).toContain('m=video 0');
    expect(out).toContain('m=audio 4000 RTP/SAVPF 0 8 101');
    expect(out).not.toContain('G726-32');
    expect(out).not.toContain('a=fmtp:2');
  });
  test('una oferta sana queda idéntica', () => {
    const fine = 'v=0\r\nm=audio 4000 RTP/SAVPF 0 8\r\na=rtpmap:0 PCMU/8000\r\n';
    expect(sanitizeSdp(fine)).toBe(fine);
  });
});

describe('installRtcFix', () => {
  const make = () => {
    const seen: { type?: string; sdp?: string }[] = [];
    const listeners: (() => void)[] = [];
    const proto = {
      setRemoteDescription: (d: RTCSessionDescriptionInit) => (seen.push(d), Promise.resolve()),
      addEventListener: (_t: string, l: () => void) => void listeners.push(l),
    };
    return { proto, seen, listeners };
  };

  test('limpia las ofertas y deja pasar las respuestas tal cual', async () => {
    const { proto, seen } = make();
    installRtcFix({ proto: proto as never });
    await proto.setRemoteDescription({ type: 'offer', sdp: offer });
    await proto.setRemoteDescription({ type: 'answer', sdp: offer });
    expect(seen[0]!.sdp).not.toContain('fe80');
    expect(seen[1]!.sdp).toBe(offer);
  });

  test('al llegar la pista remota reanuda el audio pausado', async () => {
    const { proto, listeners } = make();
    let played = 0;
    const audio = { srcObject: {}, paused: true, play: () => (played++, Promise.resolve()) };
    installRtcFix({ proto: proto as never, audios: () => [audio as never] });
    await proto.setRemoteDescription({ type: 'offer', sdp: 'v=0\r\n' });
    await proto.setRemoteDescription({ type: 'offer', sdp: 'v=0\r\n' });
    expect(listeners).toHaveLength(1); // un solo oyente por conexión
    listeners[0]!();
    await new Promise((r) => setTimeout(r, 80));
    expect(played).toBe(1);
  });
});
