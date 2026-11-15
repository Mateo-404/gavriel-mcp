/**
 * Silenciar el micrófono durante una llamada (mundo de la página, world: MAIN).
 *
 * Gavriel pide el micrófono con navigator.mediaDevices.getUserMedia al llamar (JsSIP). Se envuelve esa
 * función para recordar las pistas de audio que devuelve; silenciar es poner `enabled = false` en esas
 * pistas (el otro lado recibe silencio; la llamada y el permiso del micrófono no se tocan).
 * Una pista nueva (otra llamada) siempre arranca con sonido, para no empezar una llamada en silencio.
 */
const tracks = new Set<MediaStreamTrack>();
let muted = false;

const liveTracks = (): MediaStreamTrack[] => {
  for (const track of tracks) if (track.readyState === 'ended') tracks.delete(track);
  return [...tracks];
};

export const micTrackCount = (): number => liveTracks().length;
export const isMicMuted = (): boolean => muted && liveTracks().some((t) => !t.enabled);

/** Silencia o reactiva. Devuelve el estado final, o null si no hay micrófono en uso. */
export function setMicMuted(value: boolean): boolean | null {
  const live = liveTracks();
  if (live.length === 0) return null;
  for (const track of live) track.enabled = !value;
  muted = value;
  return value;
}

export const toggleMic = (): boolean | null => setMicMuted(!isMicMuted());

export function trackStream(stream: MediaStream): void {
  const audio = stream.getAudioTracks();
  if (audio.length === 0) return;
  for (const track of audio) tracks.add(track);
  muted = false; // llamada nueva: con sonido
}

declare global {
  interface Window {
    __gvMic?: boolean;
  }
}

export function installMicTracker(): void {
  if (window.__gvMic) return;
  window.__gvMic = true;
  const devices = navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== 'function') return;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
    const stream = await original(constraints);
    try {
      trackStream(stream);
    } catch {
      /* nunca debe romper la llamada */
    }
    return stream;
  };
}
