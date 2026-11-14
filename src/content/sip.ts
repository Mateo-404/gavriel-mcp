/**
 * Cliente (mundo aislado) del puente con el softphone de Gavriel (ver sip-bridge.ts).
 * Pide colgar, atender o rechazar y espera la respuesta; si no llega a tiempo o el softphone no se
 * encuentra, devuelve false y el llamador usa el camino por la interfaz.
 */
import { SIP_REQUEST_EVENT, SIP_RESULT_EVENT } from '../shared/constants';

export type SipAction = 'hangup' | 'answer' | 'reject';

export interface SipClient {
  /** true si el softphone ejecutó la acción; false si hay que usar la interfaz. */
  run: (action: SipAction) => Promise<boolean>;
}

const TIMEOUT_MS = 400;

export function createSipClient(): SipClient {
  let nextId = 1;
  return {
    run(action) {
      return new Promise<boolean>((resolve) => {
        const id = nextId++;
        const done = (value: boolean): void => {
          clearTimeout(timer);
          document.removeEventListener(SIP_RESULT_EVENT, onResult);
          resolve(value);
        };
        const onResult = (event: Event): void => {
          try {
            const result = JSON.parse(String((event as CustomEvent<unknown>).detail)) as { id?: number; ok?: boolean };
            if (result.id === id) done(result.ok === true);
          } catch {
            /* respuesta ajena o rota */
          }
        };
        const timer = setTimeout(() => done(false), TIMEOUT_MS);
        document.addEventListener(SIP_RESULT_EVENT, onResult);
        document.dispatchEvent(new CustomEvent(SIP_REQUEST_EVENT, { detail: JSON.stringify({ id, action }) }));
      });
    },
  };
}
