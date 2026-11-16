/**
 * Buscador de cuentas (lógica pura). Copia de la que usa la App operador (buscar-cuentas.mjs), adaptada a los
 * datos que Gavriel entrega: resuelve CUALQUIER criterio a una cuenta.
 *
 * Cubre abonado (con o sin ceros a la izquierda), teléfono de la cuenta o de un contacto (en cualquier formato),
 * nombre de la cuenta y nombre/apellido de un contacto. La serie de equipos no se indexa (costaría 2 pedidos más
 * por cuenta).
 */
export interface IndexedContact {
  name: string;
  phone: string;
  phone2: string;
}

export interface IndexedAccount {
  id: string;
  number: string;
  name: string;
  status: string;
  phone: string;
  contacts: IndexedContact[];
}

export interface IndexRow {
  account: IndexedAccount;
  num: string | null;
  n: string;
  phones: { digits: string; label: string }[];
  contactNames: { name: string; n: string; phone: string }[];
}

export interface SearchResult {
  id: string;
  number: string;
  name: string;
  status: string;
  /** Por qué coincidió («abonado», «contacto: Ana · 342…»). */
  reason: string;
}

const MAX_QUERY = 60;
export const MAX_RESULTS = 30;

export const norm = (text: unknown): string =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const digitsOf = (text: unknown): string => String(text ?? '').replace(/\D/g, '');

export function buildIndex(accounts: readonly IndexedAccount[]): IndexRow[] {
  return accounts.map((account) => {
    const phones: IndexRow['phones'] = [];
    const add = (phone: string, label: string): void => {
      const digits = digitsOf(phone);
      if (digits.length >= 6) phones.push({ digits, label: `${label} · ${phone.trim()}` });
    };
    add(account.phone, 'teléfono de la cuenta');
    const contactNames = account.contacts.map((contact) => {
      add(contact.phone, `contacto: ${contact.name}`);
      add(contact.phone2, `contacto: ${contact.name}`);
      return { name: contact.name, n: norm(contact.name), phone: contact.phone || contact.phone2 };
    });
    return {
      account,
      num: /^\d+$/.test(account.number) ? account.number.replace(/^0+/, '') : null,
      n: norm(account.name),
      phones,
      contactNames,
    };
  });
}

/** Un número de teléfono: solo dígitos y los separadores que se escriben a mano. */
const looksLikePhone = (query: string): boolean => /^[\d\s()+.\-]+$/.test(query);

interface Hit {
  score: number;
  row: IndexRow;
  reason: string;
}

function matchPhone(row: IndexRow, digits: string): { score: number; reason: string } | null {
  let best: { score: number; reason: string } | null = null;
  for (const phone of row.phones) {
    const tail = (n: number): boolean => phone.digits.slice(-n) === digits.slice(-n);
    // por los últimos dígitos, así no importa el 0, el 15, el 9 ni el código de país
    if (phone.digits.length >= 10 && digits.length >= 10 && tail(10)) {
      if (!best || best.score < 90) best = { score: 90, reason: phone.label };
    } else if (tail(Math.min(8, digits.length, phone.digits.length))) {
      if (!best || best.score < 70) best = { score: 70, reason: phone.label };
    }
  }
  return best;
}

export function search(index: readonly IndexRow[], query: string): SearchResult[] {
  const q = String(query ?? '').trim().slice(0, MAX_QUERY);
  if (q.length < 2 || index.length === 0) return [];
  const digits = digitsOf(q);
  const phone = looksLikePhone(q);
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const hasLetters = /[a-z]/.test(norm(q));
  const hits: Hit[] = [];

  for (const row of index) {
    let score = 0;
    let reason = '';
    const raise = (points: number, why: string): void => {
      if (points > score) {
        score = points;
        reason = why;
      }
    };
    if (phone) {
      // Abonado: se compara como número, así '0100' y '100' son la misma cuenta
      const num = digits.replace(/^0+/, '');
      if (row.num && num) {
        if (row.num === num) raise(100, 'abonado');
        else if (digits.length >= 2 && row.num.startsWith(num)) raise(50, 'abonado');
      }
      if (digits.length >= 6) {
        const found = matchPhone(row, digits);
        if (found) raise(found.score, found.reason);
      }
    }
    if (hasLetters && terms.length) {
      if (terms.every((term) => row.n.includes(term))) raise(row.n.startsWith(terms[0]!) ? 60 : 45, 'nombre de la cuenta');
      for (const contact of row.contactNames) {
        if (terms.every((term) => contact.n.includes(term))) raise(30, `contacto: ${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}`);
      }
    }
    if (score) hits.push({ score, row, reason });
  }

  return hits
    .sort((a, b) => b.score - a.score || Number(a.row.num ?? Infinity) - Number(b.row.num ?? Infinity))
    .slice(0, MAX_RESULTS)
    .map(({ row, reason }) => ({
      id: row.account.id,
      number: row.account.number,
      name: row.account.name,
      status: row.account.status,
      reason,
    }));
}

/** Cuentas de un teléfono que llama (últimos 10 dígitos; si no hay, los últimos 8). */
export function accountsByPhone(index: readonly IndexRow[], number: string): SearchResult[] {
  const digits = digitsOf(number);
  if (digits.length < 6) return [];
  const found: Hit[] = [];
  for (const row of index) {
    const hit = matchPhone(row, digits);
    if (hit) found.push({ score: hit.score, row, reason: hit.reason });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ row, reason }) => ({ id: row.account.id, number: row.account.number, name: row.account.name, status: row.account.status, reason }));
}

/** Datos de la lista `/api/accounts` y de `/api/account-contacts` ya limpios (nunca más de lo necesario). */
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null);
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

export function parseAccountsPage(body: unknown): { accounts: IndexedAccount[]; pages: number } {
  const root = record(body);
  const inner = record(root?.data);
  const list = Array.isArray(root?.data) ? (root!.data as unknown[]) : Array.isArray(inner?.data) ? (inner!.data as unknown[]) : [];
  const meta = record(root?.meta) ?? record(inner?.meta);
  const pages = Number(record(meta?.pagination)?.pages ?? 1) || 1;
  const accounts: IndexedAccount[] = [];
  for (const item of list) {
    const a = record(item);
    const id = str(a?.id);
    if (!a || !id) continue;
    accounts.push({ id, number: str(a.accountNumber), name: str(a.name), status: str(a.currentStatus), phone: str(a.phone), contacts: [] });
  }
  return { accounts, pages };
}

export function parseContacts(body: unknown): IndexedContact[] {
  const root = record(body);
  const inner = record(root?.data);
  const list = Array.isArray(body) ? body : Array.isArray(root?.data) ? (root!.data as unknown[]) : Array.isArray(inner?.data) ? (inner!.data as unknown[]) : [];
  const out: IndexedContact[] = [];
  for (const item of list.slice(0, 200)) {
    const c = record(item);
    const name = str(c?.name);
    if (!c || !name) continue;
    out.push({ name, phone: str(c.phone), phone2: str(c.phone2) });
  }
  return out;
}
