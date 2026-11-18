/**
 * Cliente (mundo aislado) del puente con el softphone de Gavriel (ver sip-bridge.ts).
 * Pide colgar, atender, rechazar o silenciar y espera la respuesta; si no llega a tiempo o el softphone no
 * se encuentra, devuelve false/null y el llamador usa el camino por la interfaz.
 */
import { SIP_REQUEST_EVENT, SIP_RESULT_EVENT } from '../shared/constants';
import { createRpcClient } from '../shared/page-rpc';

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
  ok?: boolean;
  muted?: boolean;
  caller?: string;
}

const TIMEOUT_MS = 400;

export function createSipClient(): SipClient {
  const call = createRpcClient<Result>({ request: SIP_REQUEST_EVENT, result: SIP_RESULT_EVENT }, TIMEOUT_MS);
  const request = (action: string): Promise<Result | null> => call({ action });
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
