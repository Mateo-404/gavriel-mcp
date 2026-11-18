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
import { createRpcClient } from '../shared/page-rpc';
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
export interface SavedIndex {
  updatedAt: number;
  complete: boolean;
  accounts: IndexedAccount[];
}
export interface IndexStore {
  load: () => Promise<SavedIndex | null>;
  save: (data: SavedIndex) => Promise<void>;
  /**
   * Corre `fn` con exclusión entre pestañas: una sola arma el índice y las demás esperan su turno (y después, al ver el
   * índice al día, no arman nada). El candado lo suelta el navegador al terminar `fn` o al cerrarse la pestaña: no hay
   * vencimientos ni renovaciones. Sin soporte (`navigator.locks`) corre `fn` directamente.
   */
  exclusive: (fn: () => Promise<void>) => Promise<void>;
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
const SAVE_EVERY = 150;
const MAX_ATTEMPTS = 4;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pedido al mundo de la página: se espera la respuesta con el mismo id o se da por perdido. */
export function createApiRequester(timeoutMs = 20000): (path: string) => Promise<ApiReply | null> {
  const call = createRpcClient<{ status?: number; body?: unknown }>({ request: GAPI_REQUEST_EVENT, result: GAPI_RESULT_EVENT }, timeoutMs);
  return async (path) => {
    const reply = await call({ path });
    return reply ? { status: Number(reply.status ?? 0), body: reply.body } : null;
  };
}

export function createAccountIndex({ request, store, sleep = defaultSleep, now = Date.now, onStatus = () => {} }: IndexDeps): AccountIndex {
  let rows: IndexRow[] = [];
  let accounts: IndexedAccount[] = [];
  /** Esta pestaña está armando el índice ahora (no solo esperando su turno). */
  let building = false;
  let queued = false;
  /** Versión de lo que hay en memoria (`updatedAt:cantidad:completo`): si lo guardado es igual, no se reconstruye el índice. */
  let loadedKey = '';
  let progress: { done: number; total: number } | null = null;

  const keyOf = (saved: SavedIndex): string => `${saved.updatedAt}:${saved.accounts.length}:${saved.complete}`;
  const fresh = (saved: SavedIndex | null): saved is SavedIndex => !!saved && saved.complete && now() - saved.updatedAt <= STALE_MS;

  const setAccounts = (list: IndexedAccount[]): void => {
    accounts = list;
    rows = buildIndex(list);
  };
  /** Adopta lo guardado si es distinto (o más completo) que lo que hay en memoria. */
  const adopt = (saved: SavedIndex): boolean => {
    const key = keyOf(saved);
    if (key === loadedKey || saved.accounts.length < accounts.length) return false;
    loadedKey = key;
    setAccounts(saved.accounts);
    return true;
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

  /** Pone en la cola de armado a esta pestaña; cuando le toca, si otra ya dejó el índice al día, no hace nada. */
  async function build(): Promise<void> {
    if (queued) return;
    queued = true;
    onStatus('esperando su turno para armar el índice');
    try {
      await store.exclusive(async () => {
        const saved = await store.load();
        if (saved) adopt(saved);
        if (fresh(saved)) return onStatus(`guardado por otra pestaña: ${saved.accounts.length} cuentas`);
        await crawl();
      });
    } finally {
      queued = false;
    }
  }

  async function crawl(): Promise<void> {
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
      // Con solo la lista ya se puede buscar por abonado y nombre: se guarda enseguida para las otras pestañas
      await store.save({ updatedAt: now(), complete: false, accounts: list });
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
      if (saved) adopt(saved);
      if (fresh(saved)) onStatus(`guardado: ${saved.accounts.length} cuentas`);
      else void build();
    },
    async reload() {
      if (building) return;
      const saved = await store.load();
      if (saved && adopt(saved)) onStatus(`${saved.complete ? 'completo' : 'parcial'} (armado por otra pestaña): ${saved.accounts.length} cuentas`);
    },
    search: (query) => search(rows, query),
    byPhone: (number) => accountsByPhone(rows, number),
    size: () => accounts.length,
    progress: () => progress,
  };
}

/** Formato compacto para guardar: una cuenta es `[id, número, nombre, estado, teléfono, [[nombre, tel, tel2], …]]`. */
export type PackedAccount = [string, string, string, string, string, [string, string, string][]];

export const packAccounts = (accounts: readonly IndexedAccount[]): PackedAccount[] =>
  accounts.map((a) => [a.id, a.number, a.name, a.status, a.phone, a.contacts.map((c) => [c.name, c.phone, c.phone2] as [string, string, string])]);

export const unpackAccounts = (packed: readonly PackedAccount[]): IndexedAccount[] =>
  packed.map(([id, number, name, status, phone, contacts]) => ({
    id,
    number,
    name,
    status,
    phone,
    contacts: contacts.map(([cname, cphone, cphone2]) => ({ name: cname, phone: cphone, phone2: cphone2 })),
  }));

export const INDEX_META_KEY = 'accountIndexMeta';
const INDEX_DATA_KEY = 'accountIndexData';
const LOCK_NAME = 'gv-account-index';

/**
 * Almacén real. Los datos van compactos en `accountIndexData` y la versión en `accountIndexMeta`; se guardan en la misma
 * operación, y las otras pestañas escuchan solo la meta (chica) para saber cuándo volver a leer. La exclusión entre pestañas
 * es un Web Lock del origen de Gavriel: la suelta el navegador solo, incluso si la pestaña se cierra a mitad del armado.
 */
export function chromeIndexStore(): IndexStore {
  return {
    async load() {
      try {
        const data = (await chrome.storage.local.get([INDEX_META_KEY, INDEX_DATA_KEY, 'accountIndex'])) as Record<string, unknown>;
        const meta = data[INDEX_META_KEY] as { updatedAt?: number; complete?: boolean } | undefined;
        const packed = data[INDEX_DATA_KEY];
        if (!meta || !Array.isArray(packed)) {
          // Versión anterior: el objeto completo en una sola clave. Se aprovecha para no volver a pedir todo (se migra al guardar)
          const old = data.accountIndex as { updatedAt?: number; complete?: boolean; accounts?: IndexedAccount[] } | undefined;
          return old && Array.isArray(old.accounts) ? { updatedAt: Number(old.updatedAt ?? 0), complete: old.complete === true, accounts: old.accounts } : null;
        }
        return { updatedAt: Number(meta.updatedAt ?? 0), complete: meta.complete === true, accounts: unpackAccounts(packed as PackedAccount[]) };
      } catch {
        return null;
      }
    },
    async save(data) {
      try {
        await chrome.storage.local.set({
          [INDEX_META_KEY]: { updatedAt: data.updatedAt, complete: data.complete, count: data.accounts.length },
          [INDEX_DATA_KEY]: packAccounts(data.accounts),
        });
        // Claves de versiones anteriores (objeto completo y candado con vencimiento): ya no se usan
        await chrome.storage.local.remove(['accountIndex', 'accountIndexLock']);
      } catch {
        /* sin espacio o sin contexto: se rearma la próxima vez */
      }
    },
    async exclusive(fn) {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (!locks) return fn();
      await locks.request(LOCK_NAME, fn);
    },
  };
}
