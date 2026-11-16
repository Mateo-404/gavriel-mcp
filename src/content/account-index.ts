/**
 * Índice local de cuentas y contactos para buscar a fondo (por teléfono, contacto, abonado y nombre) y para
 * saber a qué cuenta pertenece una llamada entrante. Corre en el mundo aislado.
 *
 * Se arma con lecturas a Gavriel por el puente de gavriel-api.ts (la sesión de la página, solo en memoria de la página):
 * la lista de cuentas (de a 100) y, por cada una, sus contactos. Son unos 1.700 pedidos una sola vez; después se
 * refresca cada 24 horas. Va despacio a propósito (3 en paralelo, con pausa y espera ante un 429) para no cargar el
 * servidor de producción, y queda guardado en `chrome.storage.local`. Una sola pestaña lo arma a la vez (candado).
 */
import { GAPI_REQUEST_EVENT, GAPI_RESULT_EVENT } from '../shared/constants';
import {
  type IndexRow,
  type IndexedAccount,
  type SearchResult,
  accountsByPhone,
  buildIndex,
  parseAccountsPage,
  parseContacts,
  search,
} from '../shared/account-search';

export interface ApiReply {
  status: number;
  body?: unknown;
}
export interface IndexStore {
  load: () => Promise<{ updatedAt: number; complete: boolean; accounts: IndexedAccount[] } | null>;
  save: (data: { updatedAt: number; complete: boolean; accounts: IndexedAccount[] }) => Promise<void>;
  /** true si esta pestaña consiguió el candado de armado (o lo renovó). */
  lock: () => Promise<boolean>;
}
export interface IndexDeps {
  request: (path: string) => Promise<ApiReply | null>;
  store: IndexStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Estado en palabras (se deja en <html data-gv-index> para diagnosticar). */
  onStatus?: (status: string) => void;
}

export interface AccountIndex {
  /** Carga lo guardado y, si hace falta, arma o refresca el índice en segundo plano. */
  start: () => Promise<void>;
  search: (query: string) => SearchResult[];
  byPhone: (number: string) => SearchResult[];
  /** Vuelve a leer lo guardado (otra pestaña lo armó o lo avanzó); no hace nada si esta pestaña lo está armando. */
  reload: () => Promise<void>;
  /** Cuentas ya indexadas (0 si todavía no hay nada). */
  size: () => number;
  /** Avance del armado, o null si no está armando. */
  progress: () => { done: number; total: number } | null;
}

export const STALE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const WORKERS = 3;
const GAP_MS = 120;
const SAVE_EVERY = 300;
const MAX_ATTEMPTS = 4;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pedido al mundo de la página: se espera la respuesta con el mismo id o se da por perdido. */
export function createApiRequester(timeoutMs = 20000): (path: string) => Promise<ApiReply | null> {
  let nextId = 1;
  return (path) =>
    new Promise((resolve) => {
      const id = nextId++;
      const done = (value: ApiReply | null): void => {
        clearTimeout(timer);
        document.removeEventListener(GAPI_RESULT_EVENT, onResult);
        resolve(value);
      };
      const onResult = (event: Event): void => {
        try {
          const reply = JSON.parse(String((event as CustomEvent<unknown>).detail)) as { id?: number; status?: number; body?: unknown };
          if (reply.id === id) done({ status: Number(reply.status ?? 0), body: reply.body });
        } catch {
          /* respuesta ajena */
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      document.addEventListener(GAPI_RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(GAPI_REQUEST_EVENT, { detail: JSON.stringify({ id, path }) }));
    });
}

export function createAccountIndex({ request, store, sleep = defaultSleep, now = Date.now, onStatus = () => {} }: IndexDeps): AccountIndex {
  let rows: IndexRow[] = [];
  let accounts: IndexedAccount[] = [];
  let building = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Lo último que se leyó de lo guardado estaba completo y al día. */
  let savedComplete = false;
  let progress: { done: number; total: number } | null = null;

  const setAccounts = (list: IndexedAccount[]): void => {
    accounts = list;
    rows = buildIndex(list);
  };

  /** GET con reintentos: 429 y errores de red esperan más cada vez; sin sesión todavía, espera a que la página cargue. */
  const get = async (path: string): Promise<unknown | undefined> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const reply = await request(path);
      if (reply && reply.status >= 200 && reply.status < 300) return reply.body;
      if (reply && reply.status >= 400 && reply.status < 500 && reply.status !== 429) return undefined; // no se reintenta
      await sleep(attempt * 1500);
    }
    return undefined;
  };

  async function build(): Promise<void> {
    if (building) return;
    if (!(await store.lock())) {
      onStatus('otra pestaña lo está armando');
      // Si esa pestaña se cierra sin terminar, el candado vence y esta toma la posta
      if (retry === undefined) {
        retry = setTimeout(() => {
          retry = undefined;
          if (!savedComplete) void build();
        }, 130_000);
      }
      return;
    }
    building = true;
    try {
      onStatus('pidiendo la lista de cuentas');
      const first = await get(`/api/accounts?page=1&limit=${PAGE_SIZE}`);
      if (first === undefined) return onStatus('falló la lista de cuentas (sin sesión o error)');
      const firstPage = parseAccountsPage(first);
      const list = [...firstPage.accounts];
      for (let page = 2; page <= firstPage.pages; page++) {
        onStatus(`lista de cuentas ${page}/${firstPage.pages}`);
        await sleep(GAP_MS);
        const body = await get(`/api/accounts?page=${page}&limit=${PAGE_SIZE}`);
        if (body === undefined) return onStatus(`falló la página ${page} de la lista`); // incompleto: se reintenta la próxima vez
        list.push(...parseAccountsPage(body).accounts);
      }
      onStatus(`lista lista: ${list.length} cuentas`);
      // Cuentas ya conocidas conservan sus contactos mientras se refrescan
      const known = new Map(accounts.map((a) => [a.id, a]));
      for (const account of list) account.contacts = known.get(account.id)?.contacts ?? [];
      setAccounts(list);
      progress = { done: 0, total: list.length };

      let cursor = 0;
      let failed = false;
      let sinceSave = 0;
      const worker = async (): Promise<void> => {
        while (!failed && cursor < list.length) {
          const account = list[cursor++]!;
          const body = await get(`/api/account-contacts?accountId=${encodeURIComponent(account.id)}`);
          if (body === undefined) {
            failed = true;
            return;
          }
          account.contacts = parseContacts(body);
          progress = { done: Math.min(list.length, (progress?.done ?? 0) + 1), total: list.length };
          onStatus(`contactos ${progress.done}/${progress.total}`);
          if (++sinceSave >= SAVE_EVERY) {
            sinceSave = 0;
            setAccounts(list);
            await store.save({ updatedAt: now(), complete: false, accounts: list });
            await store.lock();
          }
          await sleep(GAP_MS);
        }
      };
      await Promise.all(Array.from({ length: WORKERS }, worker));
      setAccounts(list);
      await store.save({ updatedAt: failed ? 0 : now(), complete: !failed, accounts: list });
      onStatus(failed ? 'incompleto: falló un pedido de contactos' : `completo: ${list.length} cuentas`);
    } finally {
      building = false;
      progress = null;
    }
  }

  return {
    async start() {
      const saved = await store.load();
      if (saved) setAccounts(saved.accounts);
      savedComplete = !!saved && saved.complete && now() - saved.updatedAt <= STALE_MS;
      if (!saved || !saved.complete || now() - saved.updatedAt > STALE_MS) void build();
      else onStatus(`guardado: ${saved.accounts.length} cuentas`);
    },
    async reload() {
      if (building) return;
      const saved = await store.load();
      if (saved && saved.accounts.length >= accounts.length) {
        setAccounts(saved.accounts);
        savedComplete = saved.complete && now() - saved.updatedAt <= STALE_MS;
        onStatus(`${saved.complete ? 'completo' : 'parcial'} (armado por otra pestaña): ${saved.accounts.length} cuentas`);
      }
    },
    search: (query) => search(rows, query),
    byPhone: (number) => accountsByPhone(rows, number),
    size: () => accounts.length,
    progress: () => progress,
  };
}

/** Almacén real: `chrome.storage.local` con un candado de 2 minutos para que solo una pestaña arme el índice. */
export function chromeIndexStore(): IndexStore {
  const KEY = 'accountIndex';
  const LOCK = 'accountIndexLock';
  return {
    async load() {
      try {
        const data = (await chrome.storage.local.get(KEY)) as Record<string, unknown>;
        const value = data[KEY] as { updatedAt?: number; complete?: boolean; accounts?: IndexedAccount[] } | undefined;
        return value && Array.isArray(value.accounts)
          ? { updatedAt: Number(value.updatedAt ?? 0), complete: value.complete === true, accounts: value.accounts }
          : null;
      } catch {
        return null;
      }
    },
    async save(data) {
      try {
        await chrome.storage.local.set({ [KEY]: data });
      } catch {
        /* sin espacio o sin contexto: se rearma la próxima vez */
      }
    },
    async lock() {
      try {
        const current = ((await chrome.storage.local.get(LOCK)) as Record<string, { by?: string; at?: number } | undefined>)[LOCK];
        if (current && current.by !== TAB && Date.now() - Number(current.at ?? 0) < 120_000) return false; // otra pestaña lo está armando
        await chrome.storage.local.set({ [LOCK]: { by: TAB, at: Date.now() } });
        return true;
      } catch {
        return false;
      }
    },
  };
}
/** Identifica a esta pestaña en el candado. */
const TAB = Math.random().toString(36).slice(2);
