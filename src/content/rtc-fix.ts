/**
 * Arreglo del audio de las llamadas entrantes. Corre en el mundo de la página (world: MAIN).
 *
 * Con la central (Grandstream UCM) Chrome rechaza algunas ofertas SDP y la llamada entrante se atiende pero
 * queda sin audio. El softphone standalone de Marinozzi (~/Softphone/src/Softphone.jsx) lo resolvía limpiando
 * la oferta antes de `setRemoteDescription`; se hace lo mismo acá para el softphone de Gavriel:
 *  1. direcciones IPv6 link-local (fe80::) en `o=`/`c=` → Chrome las rechaza: pasan a 0.0.0.0;
 *  2. sección de video (`m=video`) → puerto 0 (el softphone es solo de audio);
 *  3. payload type 2 (G726-32) → choca con el reservado de Chrome: se saca de la oferta.
 * Además, cuando llega el audio remoto de una llamada se reintenta `play()` en el <audio> que lo recibe, por si
 * el navegador lo dejó en pausa (política de reproducción automática).
 * Solo se toca el SDP remoto cuando algo de lo anterior aparece; si la oferta está bien no se modifica.
 */
export function sanitizeSdp(sdp: string): string {
  let out = sdp.replace(/IN IP6 fe80:[^\s\r\n]*/g, 'IN IP4 0.0.0.0');
  out = out.replace(/^m=video \d+/gm, 'm=video 0');
  out = out.replace(/^a=rtpmap:2 [^\r\n]*\r?\n/gm, '').replace(/^a=fmtp:2 [^\r\n]*\r?\n/gm, '');
  out = out.replace(/^(m=audio\s+\d+\s+\S+)((?:\s+\d+)+)/gm, (_all, header: string, types: string) => {
    const kept = types.trim().split(/\s+/).filter((type) => type !== '2');
    return `${header} ${kept.join(' ')}`;
  });
  return out;
}

interface PeerLike {
  setRemoteDescription: (description: RTCSessionDescriptionInit, ...rest: never[]) => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
}
export interface RtcEnv {
  proto?: PeerLike;
  /** Los <audio> de la página (para reanudar el de la llamada). */
  audios?: () => Iterable<HTMLMediaElement>;
}

declare global {
  interface Window {
    __gvRtcFix?: boolean;
  }
}

export function installRtcFix(
  env: RtcEnv = {
    proto: typeof RTCPeerConnection === 'undefined' ? undefined : (RTCPeerConnection.prototype as unknown as PeerLike),
    audios: () => document.querySelectorAll('audio'),
  },
): void {
  const proto = env.proto;
  const original = proto?.setRemoteDescription;
  if (!proto || !original) return;
  proto.setRemoteDescription = function (this: PeerLike, description: RTCSessionDescriptionInit, ...rest: never[]) {
    let next = description;
    if (description?.type === 'offer' && typeof description.sdp === 'string') {
      const fixed = sanitizeSdp(description.sdp);
      if (fixed !== description.sdp) next = { type: description.type, sdp: fixed };
    }
    // Cuando llega la pista de audio remota se asegura de que se esté reproduciendo
    if (!(this as { __gvTrack?: boolean }).__gvTrack) {
      (this as { __gvTrack?: boolean }).__gvTrack = true;
      this.addEventListener('track', () =>
        setTimeout(() => {
          for (const audio of env.audios?.() ?? []) {
            if (audio.srcObject && audio.paused) void audio.play().catch(() => {});
          }
        }, 50),
      );
    }
    return original.call(this, next, ...rest);
  };
}
