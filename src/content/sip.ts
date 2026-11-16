/**
 * Cliente (mundo aislado) del puente con el softphone de Gavriel (ver sip-bridge.ts).
 * Pide colgar, atender, rechazar o silenciar y espera la respuesta; si no llega a tiempo o el softphone no
 * se encuentra, devuelve false/null y el llamador usa el camino por la interfaz.
 */
import { SIP_REQUEST_EVENT, SIP_RESULT_EVENT } from '../shared/constants';

export type SipAction = 'hangup' | 'answer' | 'reject';

export interface SipClient {
  /** true si el softphone ejecutó la acción; false si hay que usar la interfaz. */
  run: (action: SipAction) => Promise<boolean>;
  /** Alterna el silencio del micrófono: el estado nuevo, o null si no se pudo (sin llamada o sin micrófono). */
  toggleMute: () => Promise<boolean | null>;
  /** Reactiva el micrófono (al terminar una llamada). */
  unmute: () => Promise<boolean | null>;
  /** Número de quien llama mientras suena una llamada entrante, o null si no se pudo leer. */
  caller: () => Promise<string | null>;
}

interface Result {
  id?: number;
  ok?: boolean;
  muted?: boolean;
  caller?: string;
}

const TIMEOUT_MS = 400;

export function createSipClient(): SipClient {
  let nextId = 1;
  const request = (action: string): Promise<Result | null> =>
    new Promise<Result | null>((resolve) => {
      const id = nextId++;
      const done = (value: Result | null): void => {
        clearTimeout(timer);
        document.removeEventListener(SIP_RESULT_EVENT, onResult);
        resolve(value);
      };
      const onResult = (event: Event): void => {
        try {
          const result = JSON.parse(String((event as CustomEvent<unknown>).detail)) as Result;
          if (result.id === id) done(result);
        } catch {
          /* respuesta ajena o rota */
        }
      };
      const timer = setTimeout(() => done(null), TIMEOUT_MS);
      document.addEventListener(SIP_RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(SIP_REQUEST_EVENT, { detail: JSON.stringify({ id, action }) }));
    });
  const muted = async (action: string): Promise<boolean | null> => {
    const result = await request(action);
    return result?.ok === true ? result.muted === true : null;
  };
  return {
    run: async (action) => (await request(action))?.ok === true,
    toggleMute: () => muted('mute'),
    unmute: () => muted('unmute'),
    caller: async () => {
      const result = await request('caller');
      return result?.ok === true && typeof result.caller === 'string' ? result.caller : null;
    },
  };
}
