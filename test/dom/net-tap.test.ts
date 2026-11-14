import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDataStore } from '../../src/content/data-store';
import { installNetTap } from '../../src/content/net-tap';
import { parsePending } from '../../src/shared/event-alerts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const accountBody = {
  id: 'acc1',
  name: 'MERLO FERNANDO',
  accountNumber: '2904',
  address: 'J. M. NOLLI 1820',
  city: 'RAFAELA',
  state: 'Santa Fe',
  accountContacts: [{ order: 1, name: 'Ana Pérez', phone: '3416636288', description: 'Titular' }],
};
const callsBody = {
  data: [
    {
      accountId: 'acc1',
      direction: 'outbound',
      remoteNumber: '703416636288',
      startedAt: '2026-11-14T19:31:00.920Z',
      recordingUrl: 'https://bucket/x?X-Amz-Signature=secreto',
    },
  ],
};

// Se guardan los originales para devolverlos al terminar: otros archivos de prueba usan el XHR y el fetch del DOM
const realXhr = (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
const realFetch = (globalThis as unknown as { fetch: unknown }).fetch;

// Un fetch falso con la misma forma que usa Gavriel (respuesta con clone().json())
const fakeResponse = (body: unknown, ok = true) => ({ ok, clone: () => ({ json: async () => body }), marker: 'original' });
const fetched: string[] = [];
(globalThis as unknown as { fetch: unknown }).fetch = async (input: string) => {
  fetched.push(input);
  if (input.includes('/api/accounts/acc1')) return fakeResponse(accountBody);
  if (input.includes('/api/sip/calls')) return fakeResponse(callsBody);
  if (input.includes('/api/accounts/falla')) return fakeResponse({}, false);
  return fakeResponse({ otra: 'cosa' });
};

// Un XHR falso: lo único que hace falta es open/send/addEventListener y disparar «load»
class FakeXhr {
  status = 200;
  responseType = '';
  responseText = '';
  response: unknown = null;
  private listeners: (() => void)[] = [];
  open(): void {}
  send(): void {}
  addEventListener(_: string, fn: () => void): void {
    this.listeners.push(fn);
  }
  finish(body: unknown): void {
    this.responseText = JSON.stringify(body);
    this.listeners.forEach((fn) => fn());
  }
}
(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;

afterAll(() => {
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = realXhr;
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

let store: ReturnType<typeof createDataStore>;

beforeAll(() => {
  installNetTap();
  store = createDataStore();
});

describe('net-tap + data-store', () => {
  test('fetch: lee la cuenta y las llamadas sin cambiar lo que recibe la página', async () => {
    const response = await (globalThis.fetch as unknown as (u: string) => Promise<{ marker: string }>)('/api/accounts/acc1');
    expect(response.marker).toBe('original'); // la página recibe exactamente la respuesta original
    await (globalThis.fetch as unknown as (u: string) => Promise<unknown>)('/api/sip/calls?page=1&limit=30');
    await sleep(20);
    expect(store.account('acc1')?.name).toBe('MERLO FERNANDO');
    expect(store.lastCalledName('acc1')).toBe('Ana Pérez');
    expect(store.clientMessage('acc1')).toBe('Estimado/a cliente: *MERLO FERNANDO*\nAlarma de: *J. M. NOLLI 1820, RAFAELA · Santa Fe*');
  });

  test('no hace pedidos propios: solo pasan los de la página', () => {
    expect(fetched).toEqual(['/api/accounts/acc1', '/api/sip/calls?page=1&limit=30']);
  });

  test('XHR: también lo lee, y lo que se reenvía no lleva URLs firmadas ni datos de la grabación', async () => {
    const seen: string[] = [];
    document.addEventListener('gavriel:tap', (e) => seen.push((e as CustomEvent<string>).detail));
    const xhr = new (globalThis.XMLHttpRequest as unknown as new () => FakeXhr & { open: (m: string, u: string) => void })();
    xhr.open('GET', '/api/sip/calls?page=1&limit=30');
    xhr.send();
    xhr.finish(callsBody);
    await sleep(10);
    expect(seen.length).toBe(1);
    expect(seen[0]).not.toContain('Signature');
    expect(seen[0]).not.toContain('recordingUrl');
  });

  test('respuestas con error o de otras rutas no se procesan', async () => {
    const before = store.account('falla');
    await (globalThis.fetch as unknown as (u: string) => Promise<unknown>)('/api/accounts/falla');
    await (globalThis.fetch as unknown as (u: string) => Promise<unknown>)('/api/events?page=1');
    await sleep(10);
    expect(before).toBeUndefined();
    expect(store.account('falla')).toBeUndefined();
  });

  test('una llamada hecha desde esta pestaña pasa por delante del historial', () => {
    store.recordLocalCall('acc1', 'Beto Gómez');
    expect(store.lastCalledName('acc1')).toBe('Beto Gómez');
  });

  test('un store nuevo recibe lo que ya había llegado (repetición al arrancar)', async () => {
    const late = createDataStore();
    await sleep(10);
    expect(late.account('acc1')?.name).toBe('MERLO FERNANDO');
  });
});

describe('eventos pendientes: avisos por diferencia', () => {
  const pendingBody = (count: number, extra = false) => [
    {
      account: { id: 'acc1', name: 'MERLO FERNANDO', accountNumber: '2904' },
      events_by_code: { a: { code: { code: 'E130', name: 'Burglary', eventsType: { title: 'Robo' } }, count, last_event: { zone: { code: '3', name: 'OFICINA' } } } },
    },
    ...(extra ? [{ account: { id: 'acc2', name: 'OTRA', accountNumber: '1' }, events_by_code: { b: { code: { code: 'R130', name: 'Burglary Restoral' }, count: 1 } } }] : []),
  ];

  test('la primera respuesta es la base y las siguientes avisan solo lo nuevo', async () => {
    document.body.innerHTML = '';
    const got: { type: string; added: number }[][] = [];
    const local = createDataStore((alerts) => got.push(alerts.map((a) => ({ type: a.type, added: a.added }))));
    const send = (body: unknown): void => {
      document.dispatchEvent(new CustomEvent('gavriel:tap', { detail: JSON.stringify({ kind: 'pending', pending: parsePending(body) }) }));
    };
    send(pendingBody(1)); // base
    send(pendingBody(1, true)); // sin cambios (la restauración no avisa)
    expect(got).toEqual([]);
    send(pendingBody(3)); // dos nuevos
    expect(got).toEqual([[{ type: 'BUR', added: 2 }]]);
    void local;
  });
});
