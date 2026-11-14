import { describe, expect, test } from 'bun:test';
import {
  type AccountData,
  classifyUrl,
  formatAddress,
  lastCalledName,
  parseAccount,
  parseCalls,
} from '../src/shared/gavriel-data';

const account: AccountData = {
  id: 'acc1',
  name: 'CLAUDIA RICOMI',
  accountNumber: '5457',
  address: 'Calle Falsa 123',
  city: 'RAFAELA',
  state: 'Santa Fe',
  contacts: [
    { order: 1, name: 'Ana Pérez', phone: '3416636288', description: 'Titular' },
    { order: 2, name: 'Beto Gómez', phone: '3415016202', description: 'Hijo' },
    { order: 3, name: 'Sin teléfono', phone: '', description: '' },
  ],
};

const call = (over: Record<string, unknown>) => ({
  accountId: 'acc1',
  direction: 'outbound',
  remoteNumber: '703416636288',
  startedAt: '2026-11-14T19:31:00.920Z',
  recordingUrl: 'https://bucket/firmada?X-Amz-Signature=secreto',
  ...over,
});

describe('classifyUrl', () => {
  test('reconoce solo las dos respuestas que interesan', () => {
    expect(classifyUrl('/api/sip/calls?page=1&limit=30')).toBe('calls');
    expect(classifyUrl('https://app.gavriel.com.ar/api/accounts/clqvzxoh7lrmduexna7')).toBe('account');
    for (const url of [
      '/api/accounts/clqvzxoh7lrmduexna7/devices',
      '/api/accounts/clqvzxoh7lrmduexna7/partitions',
      '/api/accounts',
      '/api/sip/me',
      '/api/events?page=1',
      '/assets/index-ABCD1234.js',
      'no es una url ::',
    ]) {
      expect(classifyUrl(url)).toBeNull();
    }
  });
});

describe('parseCalls', () => {
  test('toma lo mínimo y descarta URLs firmadas y datos de grabación', () => {
    const [parsed] = parseCalls({ data: [call({})] });
    expect(parsed).toEqual({ accountId: 'acc1', direction: 'outbound', remoteNumber: '703416636288', startedAt: Date.parse('2026-11-14T19:31:00.920Z') });
    expect(JSON.stringify(parsed)).not.toContain('Signature');
  });

  test('es idempotente: volver a procesar lo ya procesado no pierde nada', () => {
    const once = parseCalls({ data: [call({})] });
    expect(parseCalls(once)).toEqual(once);
  });

  test('ignora entradas rotas y acepta una lista sola', () => {
    expect(parseCalls({ data: [null, 5, call({ accountId: '' }), call({ startedAt: 'nunca' }), call({})] })).toHaveLength(1);
    expect(parseCalls([call({})])).toHaveLength(1);
    expect(parseCalls(undefined)).toEqual([]);
    expect(parseCalls({ data: 'x' })).toEqual([]);
  });
});

describe('parseAccount / formatAddress', () => {
  const raw = {
    id: 'acc1',
    name: ' MERLO FERNANDO ',
    accountNumber: '2904',
    address: 'J. M. NOLLI 1820',
    city: 'RAFAELA',
    state: 'Santa Fe',
    accountContacts: [
      { order: 1, name: 'Ana', phone: '3416636288', description: 'Titular' },
      { name: '', phone: '1' },
      null,
    ],
    password: 'no debe pasar',
  };

  test('arma la cuenta con sus contactos y nada más', () => {
    const parsed = parseAccount(raw)!;
    expect(parsed.name).toBe('MERLO FERNANDO');
    expect(parsed.contacts).toEqual([{ order: 1, name: 'Ana', phone: '3416636288', description: 'Titular' }]);
    expect(JSON.stringify(parsed)).not.toContain('password');
  });

  test('es idempotente: volver a procesar la cuenta ya procesada conserva los contactos', () => {
    const once = parseAccount(raw)!;
    expect(parseAccount(once)).toEqual(once);
    expect(parseAccount(once)!.contacts).toHaveLength(1);
  });

  test('la dirección sale como la muestra la tarjeta de Gavriel', () => {
    expect(formatAddress(parseAccount(raw)!)).toBe('J. M. NOLLI 1820, RAFAELA · Santa Fe');
    expect(formatAddress({ address: 'Calle 1', city: '', state: '' })).toBe('Calle 1');
    expect(formatAddress({ address: '', city: 'RAFAELA', state: 'Santa Fe' })).toBe('RAFAELA · Santa Fe');
    expect(formatAddress({ address: '', city: '', state: '' })).toBe('');
  });

  test('acepta la cuenta envuelta en data y rechaza lo que no es una cuenta', () => {
    expect(parseAccount({ data: raw })?.id).toBe('acc1');
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount({ id: 'x' })).toBeNull();
  });
});

describe('lastCalledName', () => {
  test('toma la llamada saliente más nueva que coincide con un contacto (prefijos incluidos)', () => {
    const calls = parseCalls({
      data: [
        call({ remoteNumber: '703415016202', startedAt: '2026-11-14T17:57:36.926Z' }),
        call({ remoteNumber: '703416636288', startedAt: '2026-11-14T19:31:00.920Z' }),
      ],
    });
    expect(lastCalledName(account, calls)).toBe('Ana Pérez');
  });

  test('salta llamadas a números que no son contactos (911, jurisdicción) y las entrantes', () => {
    const calls = parseCalls({
      data: [
        call({ remoteNumber: '911', startedAt: '2026-11-14T20:00:00Z' }),
        call({ direction: 'inbound', remoteNumber: '3415016202', startedAt: '2026-11-14T19:59:00Z' }),
        call({ remoteNumber: '3415016202', startedAt: '2026-11-14T19:00:00Z' }),
      ],
    });
    expect(lastCalledName(account, calls)).toBe('Beto Gómez');
  });

  test('ignora llamadas de otras cuentas', () => {
    expect(lastCalledName(account, parseCalls({ data: [call({ accountId: 'otra' })] }))).toBeNull();
  });

  test('una llamada hecha desde esta pestaña y más nueva gana; una más vieja no', () => {
    const calls = parseCalls({ data: [call({ startedAt: '2026-11-14T19:31:00.920Z' })] });
    const at = Date.parse('2026-11-14T19:40:00Z');
    expect(lastCalledName(account, calls, { name: 'Beto Gómez', at })).toBe('Beto Gómez');
    expect(lastCalledName(account, calls, { name: 'Beto Gómez', at: at - 3_600_000 })).toBe('Ana Pérez');
  });

  test('sin datos devuelve null (se cae a leer la pantalla) y con solo la llamada local la usa', () => {
    expect(lastCalledName(undefined, [])).toBeNull();
    expect(lastCalledName(account, [])).toBeNull();
    expect(lastCalledName(undefined, [], { name: 'Ana Pérez', at: 1 })).toBe('Ana Pérez');
  });

  test('un contacto sin teléfono nunca coincide', () => {
    expect(lastCalledName(account, parseCalls({ data: [call({ remoteNumber: '' })] }))).toBeNull();
  });
});
