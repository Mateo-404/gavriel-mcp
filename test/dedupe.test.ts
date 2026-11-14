import { describe, expect, test } from 'bun:test';
import { DEDUPE_TTL_MS, ResponseCache, headerValue, isApiPath, isMutation, sanitizeHeaders } from '../src/shared/dedupe';

const response = (over: Partial<{ status: number; headers: string }> = {}) => ({
  status: 200,
  statusText: 'OK',
  text: '{"id":"acc1"}',
  headers: 'content-type: application/json\r\nx-new-token: viejo\r\netag: W/"x"\r\n',
  ...over,
});

describe('ResponseCache', () => {
  const url = 'https://app.gavriel.com.ar/api/accounts/acc1';

  test('devuelve lo guardado dentro de los 10 segundos y lo olvida después', () => {
    const cache = new ResponseCache();
    const key = ResponseCache.key(url, 'Bearer a');
    cache.set(key, response(), 1000);
    expect(cache.get(key, 1000 + DEDUPE_TTL_MS - 1)?.text).toBe('{"id":"acc1"}');
    expect(cache.get(key, 1000 + DEDUPE_TTL_MS)).toBeUndefined();
  });

  test('la clave incluye la sesión: otra cuenta de usuario nunca recibe esta respuesta', () => {
    const cache = new ResponseCache();
    cache.set(ResponseCache.key(url, 'Bearer a'), response(), 0);
    expect(cache.get(ResponseCache.key(url, 'Bearer b'), 1)).toBeUndefined();
    expect(cache.get(ResponseCache.key(url, undefined), 1)).toBeUndefined();
  });

  test('solo guarda respuestas 2xx', () => {
    const cache = new ResponseCache();
    for (const status of [0, 304, 401, 404, 500]) cache.set(ResponseCache.key(url, 'x'), response({ status }), 0);
    expect(cache.get(ResponseCache.key(url, 'x'), 1)).toBeUndefined();
  });

  test('no devuelve un token de renovación viejo', () => {
    const cache = new ResponseCache();
    const key = ResponseCache.key(url, 'x');
    cache.set(key, response(), 0);
    const headers = cache.get(key, 1)!.headers;
    expect(headerValue(headers, 'x-new-token')).toBeNull();
    expect(headerValue(headers, 'content-type')).toBe('application/json');
    expect(headerValue(headers, 'ETag')).toBe('W/"x"');
  });

  test('clear() lo descarta todo y no guarda más de diez entradas', () => {
    const cache = new ResponseCache();
    for (let i = 0; i < 15; i++) cache.set(ResponseCache.key(`${url}${i}`, 'x'), response(), 0);
    expect(cache.get(ResponseCache.key(`${url}0`, 'x'), 1)).toBeUndefined(); // la más vieja salió
    expect(cache.get(ResponseCache.key(`${url}14`, 'x'), 1)).toBeDefined();
    cache.clear();
    expect(cache.get(ResponseCache.key(`${url}14`, 'x'), 1)).toBeUndefined();
  });
});

describe('ayudas', () => {
  test('isMutation: solo lectura no invalida', () => {
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) expect(isMutation(m)).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect(isMutation(m)).toBe(true);
  });

  test('isApiPath', () => {
    expect(isApiPath('/api/interventions/start')).toBe(true);
    expect(isApiPath('https://app.gavriel.com.ar/api/accounts/x')).toBe(true);
    expect(isApiPath('/assets/index.js')).toBe(false);
  });

  test('sanitizeHeaders conserva el resto y mantiene el formato', () => {
    const out = sanitizeHeaders('A: 1\r\nX-New-Token: t\r\nx-token-expires-at: z\r\nB: 2\r\n');
    expect(out).toBe('A: 1\r\nB: 2\r\n');
  });
});
