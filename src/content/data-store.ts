/**
 * Datos de Gavriel que la página ya recibió, en el mundo aislado (ver net-tap.ts y
 * shared/gavriel-data.ts). Guarda las cuentas vistas, el historial de llamadas y las llamadas hechas
 * desde esta pestaña, y responde al instante lo que antes había que leer de la pantalla.
 */
import { TAP_EVENT, TAP_REPLAY_EVENT } from '../shared/constants';
import {
  type AccountData,
  type CallRecord,
  type LocalCall,
  formatAddress,
  lastCalledName,
  parseAccount,
  parseCalls,
} from '../shared/gavriel-data';
import { formatClientMessage } from '../shared/client-message';

const MAX_ACCOUNTS = 20;

export interface DataStore {
  account: (id: string) => AccountData | undefined;
  /** Registra una llamada que se acaba de iniciar desde esta pestaña. */
  recordLocalCall: (accountId: string, contactName: string) => void;
  /** Nombre del último contacto llamado en la cuenta, o null si no se sabe (hay que leer la pantalla). */
  lastCalledName: (accountId: string) => string | null;
  /** «Estimado/a cliente…» con la cuenta y la dirección, o null si la cuenta no llegó todavía. */
  clientMessage: (accountId: string) => string | null;
}

export function createDataStore(): DataStore {
  const accounts = new Map<string, AccountData>();
  const local = new Map<string, LocalCall>();
  let calls: CallRecord[] = [];

  const ingest = (raw: unknown): void => {
    if (typeof raw !== 'string' || raw.length > 2_000_000) return;
    try {
      const data = JSON.parse(raw) as { kind?: string; calls?: unknown; account?: unknown };
      if (data.kind === 'calls') {
        calls = parseCalls(data.calls);
      } else if (data.kind === 'account') {
        const account = parseAccount(data.account);
        if (!account) return;
        accounts.delete(account.id);
        accounts.set(account.id, account);
        if (accounts.size > MAX_ACCOUNTS) accounts.delete(accounts.keys().next().value as string);
      }
    } catch {
      /* dato inválido: se ignora */
    }
  };

  document.addEventListener(TAP_EVENT, (event) => ingest((event as CustomEvent<unknown>).detail));
  document.dispatchEvent(new CustomEvent(TAP_REPLAY_EVENT)); // lo que llegó antes de que arrancáramos

  return {
    account: (id) => accounts.get(id),
    recordLocalCall: (accountId, contactName) => local.set(accountId, { name: contactName, at: Date.now() }),
    lastCalledName: (accountId) => lastCalledName(accounts.get(accountId), calls, local.get(accountId)),
    clientMessage: (accountId) => {
      const account = accounts.get(accountId);
      return account ? formatClientMessage(account.name, formatAddress(account)) : null;
    },
  };
}
