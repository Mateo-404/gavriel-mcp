/**
 * Datos que Gavriel ya trae por su cuenta al abrir una cuenta (verificado en sus pedidos):
 *
 *  - `GET /api/sip/calls?page=1&limit=30`: historial de llamadas del softphone. Cada una trae
 *    `accountId`, `direction` ("outbound"), `remoteNumber` (el teléfono marcado, con prefijos) y
 *    `startedAt`. No trae el nombre del contacto.
 *  - `GET /api/accounts/<id>`: la cuenta completa (objeto plano), con `name`, `address`, `city`,
 *    `state` y `accountContacts[]` (`order`, `name`, `phone`, `description`).
 *
 * La extensión los lee de las respuestas que la propia página recibe (sin pedir nada, sin tocar el
 * token) y de ahí saca el último contacto llamado y el mensaje al cliente al instante.
 */
import { samePhone } from './contact-card';

export interface CallRecord {
  accountId: string;
  direction: string;
  remoteNumber: string;
  /** Milisegundos desde 1970. */
  startedAt: number;
}

export interface AccountContact {
  order: number;
  name: string;
  phone: string;
  description: string;
}

export interface AccountData {
  id: string;
  name: string;
  accountNumber: string;
  address: string;
  city: string;
  state: string;
  contacts: AccountContact[];
}

const MAX_CALLS = 100;
const MAX_CONTACTS = 200;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Qué es una URL de la API de Gavriel que nos interesa: 'calls', 'account' o null. */
export function classifyUrl(url: string): 'calls' | 'account' | null {
  let path: string;
  try {
    path = new URL(url, 'https://app.gavriel.com.ar').pathname;
  } catch {
    return null;
  }
  if (path === '/api/sip/calls') return 'calls';
  return /^\/api\/accounts\/[A-Za-z0-9_-]+$/.test(path) ? 'account' : null;
}

/** Llamadas de la respuesta de `/api/sip/calls` (acepta `{data: [...]}` o la lista sola). */
export function parseCalls(json: unknown): CallRecord[] {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const calls: CallRecord[] = [];
  for (const item of list.slice(0, MAX_CALLS)) {
    if (!isRecord(item)) continue;
    const accountId = text(item.accountId);
    // La respuesta de Gavriel trae texto ISO; el dato ya procesado por net-tap trae milisegundos
    const startedAt = typeof item.startedAt === 'number' ? item.startedAt : Date.parse(text(item.startedAt));
    if (!accountId || Number.isNaN(startedAt)) continue;
    calls.push({ accountId, direction: text(item.direction), remoteNumber: text(item.remoteNumber), startedAt });
  }
  return calls;
}

/** Cuenta de la respuesta de `/api/accounts/<id>`. */
export function parseAccount(json: unknown): AccountData | null {
  const root = isRecord(json) && isRecord(json.data) && typeof json.data.id === 'string' ? json.data : json;
  if (!isRecord(root)) return null;
  const id = text(root.id);
  const name = text(root.name);
  if (!id || !name) return null;
  const contacts: AccountContact[] = [];
  // `accountContacts` en la respuesta de Gavriel; `contacts` si ya la procesó net-tap (idempotente)
  const rawContacts = Array.isArray(root.accountContacts) ? root.accountContacts : root.contacts;
  if (Array.isArray(rawContacts)) {
    for (const item of rawContacts.slice(0, MAX_CONTACTS)) {
      if (!isRecord(item)) continue;
      const contactName = text(item.name);
      if (!contactName) continue;
      contacts.push({
        order: typeof item.order === 'number' ? item.order : contacts.length,
        name: contactName,
        phone: text(item.phone),
        description: text(item.description),
      });
    }
  }
  return {
    id,
    name,
    accountNumber: text(root.accountNumber),
    address: text(root.address),
    city: text(root.city),
    state: text(root.state),
    contacts,
  };
}

/** «calle, ciudad · provincia», igual que lo muestra la tarjeta «Localización y contacto». */
export function formatAddress(account: Pick<AccountData, 'address' | 'city' | 'state'>): string {
  const street = [account.address, account.city].filter(Boolean).join(', ');
  return [street, account.state].filter(Boolean).join(' · ');
}

export interface LocalCall {
  name: string;
  /** Milisegundos desde 1970. */
  at: number;
}

/**
 * Nombre del último contacto de la cuenta al que se llamó: la llamada saliente más nueva cuyo teléfono
 * coincide con un contacto (se ignoran las que van a otros números, como la jurisdicción o el 911).
 * Una llamada hecha desde esta misma pestaña y más nueva que las del historial gana, porque el
 * historial se pidió al abrir la cuenta y todavía no la incluye.
 */
export function lastCalledName(
  account: AccountData | undefined,
  calls: readonly CallRecord[],
  local?: LocalCall,
): string | null {
  let fromHistory: { name: string; at: number } | null = null;
  if (account) {
    const outbound = calls
      .filter((c) => c.accountId === account.id && /^outbound$/i.test(c.direction))
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const call of outbound) {
      const contact = account.contacts.find((c) => c.phone && samePhone(c.phone, call.remoteNumber));
      if (contact) {
        fromHistory = { name: contact.name, at: call.startedAt };
        break;
      }
    }
  }
  if (local && (!fromHistory || local.at >= fromHistory.at)) return local.name;
  return fromHistory?.name ?? null;
}
