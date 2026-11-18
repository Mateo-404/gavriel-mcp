/**
 * Avisos por tipo de evento (BUR, POW, PAN, MED, INC) a partir de los eventos pendientes.
 *
 * Gavriel no manda el contenido en el Socket.IO (`new-event` solo hace que la página vuelva a pedir
 * `GET /api/events/accounts-with-pending-events`), así que se compara lo que devuelve ese pedido, que la
 * extensión ya lee de la propia página (net-tap.ts): una lista de cuentas, cada una con
 * `events_by_code`: `{ code: { code: "E130", name: "Burglary", eventsType: { title, … } }, count, last_event }`.
 *
 * Los tipos salen del código Contact ID (SIA/CID) del evento; las restauraciones (R…) nunca avisan.
 */

export const ALERT_TYPES = ['BUR', 'POW', 'PAN', 'MED', 'INC'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_LABELS: Readonly<Record<AlertType, string>> = {
  BUR: 'Robo / intrusión',
  POW: 'Falla de energía',
  PAN: 'Pánico',
  MED: 'Emergencia médica',
  INC: 'Incendio',
};

/** Emoji que encabeza el título del aviso, para reconocer el tipo de un vistazo. */
export const ALERT_EMOJI: Readonly<Record<AlertType, string>> = { BUR: '🚨', PAN: '🆘', MED: '🩺', INC: '🔥', POW: '⚡' };

/** Color de cada tipo en el aviso (el ícono de la notificación se tiñe con él). */
export const ALERT_COLORS: Readonly<Record<AlertType, string>> = {
  BUR: '#e5383b', // rojo
  PAN: '#c026d3', // magenta
  MED: '#2563eb', // azul
  INC: '#f97316', // naranja
  POW: '#eab308', // ámbar
};

/** Rango de códigos Contact ID (los tres dígitos tras la «E») de cada tipo. */
const CODE_RANGES: readonly { type: AlertType; test: (n: number) => boolean }[] = [
  { type: 'MED', test: (n) => n >= 100 && n <= 109 },
  { type: 'INC', test: (n) => n >= 110 && n <= 119 },
  { type: 'PAN', test: (n) => n >= 120 && n <= 129 },
  { type: 'BUR', test: (n) => n >= 130 && n <= 139 },
  // 301 falla de corriente alterna y 311 batería ausente/agotada. La 302 (batería baja, «LOW» en Gavriel) NO avisa a propósito.
  { type: 'POW', test: (n) => n === 301 || n === 311 },
];

/** Tipo de aviso de un código como «E130»; null si no corresponde (otro tipo o restauración «R130»). */
export function alertTypeOfCode(code: string): AlertType | null {
  const match = /^E(\d{3})$/i.exec(code.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return CODE_RANGES.find((range) => range.test(n))?.type ?? null;
}

export interface PendingGroup {
  /** «E130». */
  code: string;
  /** «Burglary». */
  name: string;
  count: number;
  /** Texto de la zona del último evento, si lo hay («3 - OFICINA»). */
  zone: string;
}

export interface PendingAccount {
  accountId: string;
  accountName: string;
  accountNumber: string;
  groups: PendingGroup[];
}

const MAX_ACCOUNTS = 500;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Lo mínimo de cada cuenta de la respuesta de eventos pendientes (acepta `{data: [...]}` o la lista sola). */
export function parsePending(json: unknown): PendingAccount[] {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const out: PendingAccount[] = [];
  for (const item of list.slice(0, MAX_ACCOUNTS)) {
    if (!isRecord(item) || !isRecord(item.account)) continue;
    const accountId = text(item.account.id);
    if (!accountId) continue;
    const groups: PendingGroup[] = [];
    if (isRecord(item.events_by_code)) {
      for (const group of Object.values(item.events_by_code)) {
        if (!isRecord(group) || !isRecord(group.code)) continue;
        const code = text(group.code.code);
        if (!code) continue;
        const last = isRecord(group.last_event) ? group.last_event : {};
        const zone = isRecord(last.zone) ? [text(last.zone.code), text(last.zone.name)].filter(Boolean).join(' - ') : text(last.zoneCode);
        groups.push({ code, name: text(group.code.name), count: typeof group.count === 'number' ? group.count : 1, zone });
      }
    }
    out.push({ accountId, accountName: text(item.account.name), accountNumber: text(item.account.accountNumber), groups });
  }
  return out;
}

/** Valida una lista ya procesada por parsePending (llega del mundo de la página: se trata como dato). */
export function sanitizePending(value: unknown): PendingAccount[] {
  if (!Array.isArray(value)) return [];
  const out: PendingAccount[] = [];
  for (const item of value.slice(0, MAX_ACCOUNTS)) {
    if (!isRecord(item) || !text(item.accountId) || !Array.isArray(item.groups)) continue;
    const groups: PendingGroup[] = [];
    for (const g of item.groups) {
      if (!isRecord(g) || !text(g.code)) continue;
      groups.push({ code: text(g.code), name: text(g.name), count: typeof g.count === 'number' ? g.count : 1, zone: text(g.zone) });
    }
    out.push({ accountId: text(item.accountId), accountName: text(item.accountName), accountNumber: text(item.accountNumber), groups });
  }
  return out;
}

export interface Alert {
  type: AlertType;
  accountId: string;
  accountName: string;
  accountNumber: string;
  code: string;
  codeName: string;
  zone: string;
  /** Cuántos eventos nuevos de ese código entraron. */
  added: number;
}

/**
 * Eventos nuevos entre dos respuestas: códigos que no estaban en la cuenta o cuyo contador subió.
 * Sin respuesta anterior (primera carga) no hay nada «nuevo»: se toma como base y no avisa.
 */
export function diffPending(previous: readonly PendingAccount[] | null, next: readonly PendingAccount[]): Alert[] {
  if (!previous) return [];
  const before = new Map<string, number>();
  for (const account of previous) for (const group of account.groups) before.set(`${account.accountId}|${group.code}`, group.count);
  const alerts: Alert[] = [];
  for (const account of next) {
    for (const group of account.groups) {
      const type = alertTypeOfCode(group.code);
      if (!type) continue;
      const added = group.count - (before.get(`${account.accountId}|${group.code}`) ?? 0);
      if (added <= 0) continue;
      alerts.push({
        type,
        accountId: account.accountId,
        accountName: account.accountName,
        accountNumber: account.accountNumber,
        code: group.code,
        codeName: group.name,
        zone: group.zone,
        added,
      });
    }
  }
  return alerts;
}

export const BURST_WINDOW_MS = 30_000;
export const BURST_MAX = 5;

/**
 * Corta una avalancha (por ejemplo, una caída de energía masiva): se muestran los primeros BURST_MAX avisos
 * de la ventana de 30 s y el resto se resume en uno solo. `sent` son los instantes de los avisos ya mostrados.
 */
export function limitBurst<T>(alerts: readonly T[], sent: number[], now: number): { show: T[]; summarized: number; sent: number[] } {
  const recent = sent.filter((at) => now - at < BURST_WINDOW_MS);
  const room = Math.max(0, BURST_MAX - recent.length);
  const show = alerts.slice(0, room);
  return { show, summarized: alerts.length - show.length, sent: [...recent, ...show.map(() => now)] };
}

export const isAlertType = (value: unknown): value is AlertType => (ALERT_TYPES as readonly unknown[]).includes(value);
