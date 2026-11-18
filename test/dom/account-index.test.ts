import { describe, expect, test } from 'bun:test';
import { GAPI_REQUEST_EVENT, GAPI_RESULT_EVENT } from '../../src/shared/constants';
import { ALLOWED_PATH, installGavrielApi } from '../../src/content/gavriel-api';
import { type IndexStore, STALE_MS, createAccountIndex, packAccounts, unpackAccounts } from '../../src/content/account-index';
import { createIncomingBanner, createSearchUi } from '../../src/content/account-search-ui';
import { callerNumber } from '../../src/content/sip-bridge';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('puente de lectura (gavriel-api)', () => {
  test('solo acepta las dos rutas de lectura', () => {
    expect(ALLOWED_PATH.test('/api/accounts?page=1&limit=100')).toBe(true);
    expect(ALLOWED_PATH.test('/api/account-contacts?accountId=abc-123')).toBe(true);
    expect(ALLOWED_PATH.test('/api/accounts/5')).toBe(false);
    expect(ALLOWED_PATH.test('/api/interventions')).toBe(false);
    expect(ALLOWED_PATH.test('https://otro.com/api/accounts?page=1')).toBe(false);
    expect(ALLOWED_PATH.test('/api/accounts?page=1&x=<script>')).toBe(false);
  });

  test('usa la cabecera de la página, hace GET y no devuelve cabeceras', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let auth: string | undefined;
    const fake = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }) as unknown as typeof fetch;
    installGavrielApi(() => auth, fake);
    const replies: string[] = [];
    document.addEventListener(GAPI_RESULT_EVENT, (e) => replies.push(String((e as CustomEvent).detail)));
    const ask = (id: number, path: string): void => void document.dispatchEvent(new CustomEvent(GAPI_REQUEST_EVENT, { detail: JSON.stringify({ id, path }) }));

    ask(1, '/api/accounts?page=1&limit=100'); // todavía sin sesión
    await wait(5);
    expect(JSON.parse(replies[0]!)).toEqual({ id: 1, status: 0, error: 'sin-sesion' });
    expect(calls).toHaveLength(0);

    auth = 'Bearer secreto';
    ask(2, '/api/accounts?page=1&limit=100');
    ask(3, '/api/interventions'); // ruta no permitida: ni se pide ni se contesta
    await wait(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secreto');
    expect(replies).toHaveLength(2);
    expect(replies[1]).not.toContain('secreto');
    expect(JSON.parse(replies[1]!)).toMatchObject({ id: 2, status: 200 });
  });
});

const page = (n: number, pages: number, count: number): unknown => ({
  data: { data: Array.from({ length: count }, (_, i) => ({ id: `${n}-${i}`, accountNumber: `${n}${i}`, name: `Cuenta ${n}-${i}`, currentStatus: 'Activa', phone: '' })), meta: { pagination: { pages } } },
});

/** Almacén y exclusión en memoria: la exclusión encadena los turnos igual que un Web Lock. */
function memoryStore(initial: Parameters<IndexStore['save']>[0] | null = null, blocked = false) {
  let saved = initial;
  let tail: Promise<void> = Promise.resolve();
  const saves: { complete: boolean; n: number }[] = [];
  const store: IndexStore = {
    load: async () => saved,
    save: async (d) => {
      saved = d;
      saves.push({ complete: d.complete, n: d.accounts.length });
    },
    exclusive: (fn) => {
      if (blocked) return new Promise(() => {}); // otra pestaña lo tiene y no lo suelta
      const turn = tail.then(fn);
      tail = turn.catch(() => {});
      return turn;
    },
  };
  return { store, saves };
}

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !ok(); i++) await wait(10);
};

function fixture(opts: { saved?: Parameters<IndexStore['save']>[0] | null; lock?: boolean } = {}) {
  const requests: string[] = [];
  const { store, saves } = memoryStore(opts.saved ?? null, opts.lock === false);
  let rateLimited = 1;
  const request = async (path: string) => {
    requests.push(path);
    if (path.startsWith('/api/accounts?page=')) {
      const n = Number(/page=(\d+)/.exec(path)![1]);
      return { status: 200, body: page(n, 2, 2) };
    }
    if (rateLimited-- > 0) return { status: 429 }; // el primer contacto recibe un 429 y se reintenta
    return { status: 200, body: { data: [{ name: 'Ana', phone: '3425551111', phone2: '' }] } };
  };
  const index = createAccountIndex({ request, store, sleep: () => Promise.resolve(), now: () => 1_000_000 });
  return { index, requests, saves };
}

describe('índice de cuentas', () => {
  test('arma lista + contactos, reintenta el 429 y guarda completo', async () => {
    const { index, requests, saves } = fixture();
    await index.start();
    await until(() => saves.at(-1)?.complete === true);
    expect(requests.filter((r) => r.startsWith('/api/accounts?page=')).length).toBe(2);
    expect(requests.filter((r) => r.startsWith('/api/account-contacts')).length).toBe(4 + 1); // 4 cuentas + 1 reintento
    expect(saves.at(-1)).toEqual({ complete: true, n: 4 });
    expect(index.size()).toBe(4);
    expect(index.byPhone('+54 342 555 1111').length).toBe(4);
    expect(index.search('cuenta 1-0')[0]!.name).toBe('Cuenta 1-0');
    expect(index.progress()).toBeNull();
  });

  test('un índice guardado y reciente no vuelve a pedir nada', async () => {
    const saved = { updatedAt: 1_000_000 - 1000, complete: true, accounts: [{ id: 'x', number: '1', name: 'X', status: '', phone: '', contacts: [] }] };
    const { index, requests } = fixture({ saved });
    await index.start();
    await wait(10);
    expect(requests).toHaveLength(0);
    expect(index.size()).toBe(1);
  });

  test('si venció (24 h) se refresca, y si otra pestaña tiene el candado no se arma', async () => {
    const old = { updatedAt: 1_000_000 - STALE_MS - 1, complete: true, accounts: [] };
    const a = fixture({ saved: old });
    await a.index.start();
    await until(() => a.requests.length > 0);
    expect(a.requests.length).toBeGreaterThan(0);
    const b = fixture({ saved: old, lock: false });
    await b.index.start();
    await wait(20);
    expect(b.requests).toHaveLength(0);
  });

  test('dos pestañas con el mismo almacén: la segunda espera su turno, ve el índice al día y no pide nada', async () => {
    const shared = memoryStore();
    const requests: string[] = [];
    const request = async (path: string) => {
      requests.push(path);
      return path.startsWith('/api/accounts?page=') ? { status: 200, body: page(1, 1, 3) } : { status: 200, body: { data: [] } };
    };
    const make = () => createAccountIndex({ request, store: shared.store, sleep: () => Promise.resolve(), now: () => 1_000_000 });
    const first = make();
    const second = make();
    await Promise.all([first.start(), second.start()]);
    await until(() => shared.saves.at(-1)?.complete === true);
    await until(() => second.size() === 3);
    expect(requests.filter((r) => r.startsWith('/api/accounts?page=')).length).toBe(1); // una sola lista pedida
    expect(requests.filter((r) => r.startsWith('/api/account-contacts')).length).toBe(3);
    expect(second.size()).toBe(3);
  });

  test('el formato compacto de guardado va y vuelve sin perder nada', () => {
    const accounts = [{ id: 'a', number: '0100', name: 'ESCUELA', status: 'Activa', phone: '342', contacts: [{ name: 'Ana', phone: '1', phone2: '2' }] }];
    expect(unpackAccounts(packAccounts(accounts))).toEqual(accounts);
    expect(JSON.stringify(packAccounts(accounts)).length).toBeLessThan(JSON.stringify(accounts).length);
  });
});

describe('desplegable y llamada entrante', () => {
  const results = [{ id: '9', number: '0100', name: 'ESCUELA', status: 'Activa', reason: 'abonado' }];

  test('el desplegable aparece al escribir, se elige con el mouse y se cierra al salir', async () => {
    document.body.innerHTML = '<input placeholder="Nombre, número, email o domicilio…">';
    const opened: string[] = [];
    const ui = createSearchUi({ search: () => results, size: () => 1, progress: () => null, open: (id) => opened.push(id) });
    ui.attach();
    const input = document.querySelector('input')!;
    input.value = 'esc';
    input.dispatchEvent(new Event('input'));
    const rows = document.querySelectorAll('.gv-asearch-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('ESCUELA');
    (rows[0] as HTMLButtonElement).click();
    expect(opened).toEqual(['9']);
    input.value = 'e';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.gv-asearch')).toBeNull();
  });

  test('sin índice todavía avisa en vez de quedar vacío', () => {
    document.body.innerHTML = '<input placeholder="Nombre, número, email o domicilio…">';
    const ui = createSearchUi({ search: () => [], size: () => 0, progress: () => ({ done: 5, total: 20 }) });
    ui.attach();
    const input = document.querySelector('input')!;
    input.value = 'perez';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.gv-asearch-note')!.textContent).toContain('5/20');
  });

  test('llamada entrante: muestra la cuenta, y desaparece al terminar', async () => {
    document.body.innerHTML = '';
    const banner = createIncomingBanner({ caller: async () => '3425551111', byPhone: () => results, open: () => {} });
    banner.update(true);
    banner.update(true); // el mismo timbre no vuelve a preguntar
    await wait(5);
    expect(document.querySelector('.gv-incoming')!.textContent).toContain('ESCUELA');
    expect(document.querySelector('.gv-incoming-head')!.textContent).toContain('3425551111');
    banner.update(false);
    expect(document.querySelector('.gv-incoming')).toBeNull();
  });

  test('si el número no está en ninguna cuenta lo dice', async () => {
    document.body.innerHTML = '';
    const banner = createIncomingBanner({ caller: async () => '3420000000', byPhone: () => [] });
    banner.update(true);
    await wait(5);
    expect(document.querySelector('.gv-incoming-head')!.textContent).toContain('no está en ninguna cuenta');
  });
});

describe('número de quien llama', () => {
  test('lo saca de los lugares habituales de la sesión', () => {
    expect(callerNumber('3425551111')).toBe('3425551111');
    expect(callerNumber({ remote_identity: { uri: { user: '3425551111' } } })).toBe('3425551111');
    expect(callerNumber({ remoteNumber: '+5493425551111' })).toBe('+5493425551111');
    expect(callerNumber('"Ana" <sip:3425551111@pbx.local>;tag=1')).toBe('3425551111');
    expect(callerNumber({ foo: 'bar' })).toBeNull();
    expect(callerNumber('12')).toBeNull();
    expect(callerNumber(null)).toBeNull();
  });
});
