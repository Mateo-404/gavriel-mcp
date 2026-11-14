import { describe, expect, test } from 'bun:test';
import { serveFromCache } from '../../src/content/xhr-dedupe';

const cached = {
  status: 200,
  statusText: 'OK',
  text: '{"id":"acc1","name":"MERLO FERNANDO"}',
  headers: 'content-type: application/json\r\netag: W/"x"\r\n',
  at: Date.now(),
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('serveFromCache (XHR respondido desde memoria)', () => {
  test('dispara los mismos estados y eventos que un pedido real y entrega el cuerpo', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/accounts/acc1');
    const log: string[] = [];
    xhr.addEventListener('readystatechange', () => log.push(`rs${xhr.readyState}`));
    xhr.addEventListener('load', () => log.push('load'));
    xhr.addEventListener('loadend', () => log.push('loadend'));
    let viaHandler = '';
    xhr.onloadend = () => (viaHandler = xhr.responseText);

    expect(serveFromCache(xhr, '/api/accounts/acc1', cached)).toBe(true);
    expect(log).toEqual([]); // es asíncrono, como un pedido de red
    await sleep(10);

    expect(log).toEqual(['rs2', 'rs3', 'rs4', 'load', 'loadend']);
    expect(xhr.readyState).toBe(4);
    expect(xhr.status).toBe(200);
    expect(xhr.statusText).toBe('OK');
    expect(xhr.responseText).toBe(cached.text);
    expect(viaHandler).toBe(cached.text);
    expect(xhr.getResponseHeader('ETag')).toBe('W/"x"');
    expect(xhr.getAllResponseHeaders()).toContain('content-type: application/json');
    expect(xhr.responseURL).toContain('/api/accounts/acc1');
  });

  test('con responseType json entrega el objeto ya procesado', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/accounts/acc1');
    xhr.responseType = 'json';
    let done = false;
    xhr.addEventListener('loadend', () => (done = true));
    serveFromCache(xhr, '/api/accounts/acc1', cached);
    await sleep(10);
    expect(done).toBe(true);
    expect((xhr.response as { name: string }).name).toBe('MERLO FERNANDO');
  });

  test('si el cuerpo no se puede procesar como json devuelve false y no toca el pedido', () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/accounts/acc1');
    xhr.responseType = 'json';
    expect(serveFromCache(xhr, '/api/accounts/acc1', { ...cached, text: 'no es json' })).toBe(false);
    expect(Object.getOwnPropertyDescriptor(xhr, 'getAllResponseHeaders')).toBeUndefined();
  });
});
