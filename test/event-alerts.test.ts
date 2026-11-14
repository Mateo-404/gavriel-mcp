import { describe, expect, test } from 'bun:test';
import {
  BURST_MAX,
  BURST_WINDOW_MS,
  alertTypeOfCode,
  diffPending,
  limitBurst,
  parsePending,
} from '../src/shared/event-alerts';

const group = (code: string, count: number, name = 'X', zone?: { code: string; name: string }) => ({
  code: { id: code, code, name, eventsType: { title: 'T' } },
  count,
  last_event: zone ? { zone } : {},
});
const account = (id: string, groups: Record<string, ReturnType<typeof group>>) => ({
  account: { id, name: `CUENTA ${id}`, accountNumber: `10${id}` },
  events_by_code: groups,
});

describe('alertTypeOfCode', () => {
  test('clasifica por rangos de Contact ID', () => {
    expect(alertTypeOfCode('E130')).toBe('BUR');
    expect(alertTypeOfCode('E131')).toBe('BUR');
    expect(alertTypeOfCode('E110')).toBe('INC');
    expect(alertTypeOfCode('E120')).toBe('PAN');
    expect(alertTypeOfCode('E100')).toBe('MED');
    expect(alertTypeOfCode('E301')).toBe('POW');
    expect(alertTypeOfCode('E302')).toBe('POW');
    expect(alertTypeOfCode(' e130 ')).toBe('BUR');
  });

  test('las restauraciones y los demás códigos no avisan', () => {
    for (const code of ['R130', 'R301', 'E354', 'E602', 'E140', 'E303', '130', '', 'E13', 'EXYZ']) expect(alertTypeOfCode(code)).toBeNull();
  });
});

describe('parsePending', () => {
  test('toma cuentas, códigos, cantidad y zona', () => {
    const [a] = parsePending([account('1', { x: group('E130', 2, 'Burglary', { code: '3', name: 'OFICINA' }) })]);
    expect(a).toEqual({
      accountId: '1',
      accountName: 'CUENTA 1',
      accountNumber: '101',
      groups: [{ code: 'E130', name: 'Burglary', count: 2, zone: '3 - OFICINA' }],
    });
  });

  test('acepta {data: [...]} y descarta entradas rotas', () => {
    expect(parsePending({ data: [account('1', {}), null, { account: {} }, 5] })).toHaveLength(1);
    expect(parsePending(undefined)).toEqual([]);
    expect(parsePending({ data: 'x' })).toEqual([]);
  });

  test('es idempotente en cuenta y códigos sin campos opcionales', () => {
    const [a] = parsePending([{ account: { id: 'a' }, events_by_code: { k: { code: { code: 'E301' } } } }]);
    expect(a!.groups).toEqual([{ code: 'E301', name: '', count: 1, zone: '' }]);
  });
});

describe('diffPending', () => {
  const base = parsePending([account('1', { a: group('E130', 1), b: group('E354', 3) })]);

  test('la primera respuesta es la base: no avisa', () => {
    expect(diffPending(null, base)).toEqual([]);
  });

  test('avisa por un código nuevo o por un contador que sube, con la cantidad agregada', () => {
    const next = parsePending([
      account('1', { a: group('E130', 3), b: group('E354', 3) }),
      account('2', { c: group('E120', 1, 'Panic', { code: '1', name: 'COCINA' }) }),
    ]);
    const alerts = diffPending(base, next);
    expect(alerts.map((a) => [a.accountId, a.type, a.added])).toEqual([
      ['1', 'BUR', 2],
      ['2', 'PAN', 1],
    ]);
    expect(alerts[1]).toMatchObject({ code: 'E120', codeName: 'Panic', zone: '1 - COCINA', accountName: 'CUENTA 2' });
  });

  test('no avisa si no cambió, si baja, ni por códigos de otro tipo', () => {
    expect(diffPending(base, base)).toEqual([]);
    expect(diffPending(base, parsePending([account('1', { a: group('E130', 0) })]))).toEqual([]);
    expect(diffPending(base, parsePending([account('1', { a: group('E130', 1), b: group('E354', 9), c: group('R130', 4) })]))).toEqual([]);
  });

  test('el mismo código en otra cuenta cuenta aparte', () => {
    const next = parsePending([account('1', { a: group('E130', 1) }), account('3', { a: group('E130', 1) })]);
    expect(diffPending(base, next).map((a) => a.accountId)).toEqual(['3']);
  });
});

describe('limitBurst', () => {
  const items = Array.from({ length: 9 }, (_, i) => i);

  test('muestra los primeros 5 y resume el resto', () => {
    const r = limitBurst(items, [], 1000);
    expect(r.show).toEqual([0, 1, 2, 3, 4]);
    expect(r.summarized).toBe(4);
    expect(r.sent).toHaveLength(BURST_MAX);
  });

  test('cuenta lo ya mostrado en la ventana de 30 s y se renueva después', () => {
    const first = limitBurst(items.slice(0, 3), [], 0);
    const second = limitBurst(items, first.sent, 10_000);
    expect(second.show).toHaveLength(2);
    expect(second.summarized).toBe(7);
    const later = limitBurst(items, second.sent, BURST_WINDOW_MS + 10_001);
    expect(later.show).toHaveLength(5);
  });

  test('sin lugar en la ventana todo se resume', () => {
    const full = limitBurst(items, [], 0).sent;
    const r = limitBurst([1, 2], full, 1);
    expect(r.show).toEqual([]);
    expect(r.summarized).toBe(2);
  });
});

import { ALERT_COLORS, ALERT_TYPES } from '../src/shared/event-alerts';
test('cada tipo tiene su propio color', () => {
  const colors = ALERT_TYPES.map((t) => ALERT_COLORS[t]);
  expect(new Set(colors).size).toBe(ALERT_TYPES.length);
  for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
});
