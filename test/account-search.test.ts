import { describe, expect, test } from 'bun:test';
import { accountsByPhone, buildIndex, parseAccountsPage, parseContacts, search, type IndexedAccount } from '../src/shared/account-search';

const acc = (id: string, number: string, name: string, phone: string, contacts: [string, string, string?][] = []): IndexedAccount => ({
  id,
  number,
  name,
  status: 'Activa',
  phone,
  contacts: contacts.map(([n, p, p2]) => ({ name: n, phone: p, phone2: p2 ?? '' })),
});

const index = buildIndex([
  acc('a', '0100', 'ESCUELA VILLA ROSAS', '0342 4551234', [['Juan Pérez', '0342 15 5370985']]),
  acc('b', '1002', 'Gómez Ana', '', [['María López', '+54 9 342 4112233', '3425550000']]),
  acc('c', '100', 'OTRA CUENTA', '', []),
]);

describe('buscador de cuentas', () => {
  test('abonado con o sin ceros, exacto antes que prefijo', () => {
    expect(search(index, '100').map((r) => r.id)).toEqual(['a', 'c', 'b']); // exactos primero, el prefijo (1002) al final
    expect(search(index, '0100')[0]!.reason).toBe('abonado');
  });
  test('teléfono en cualquier formato (últimos dígitos)', () => {
    const r = search(index, '3425155370985');
    expect(r[0]!.id).toBe('a');
    expect(r[0]!.reason).toContain('contacto: Juan Pérez');
    expect(search(index, '(0342) 15-5370985')[0]!.id).toBe('a');
  });
  test('nombre sin tildes ni mayúsculas, de la cuenta o de un contacto', () => {
    expect(search(index, 'gomez')[0]!.id).toBe('b');
    expect(search(index, 'maria lopez')[0]).toMatchObject({ id: 'b' });
    expect(search(index, 'perez')[0]!.reason).toContain('contacto');
  });
  test('segundo teléfono del contacto y consultas muy cortas', () => {
    expect(search(index, '3425550000')[0]!.id).toBe('b');
    expect(search(index, 'a')).toEqual([]);
    expect(search([], 'gomez')).toEqual([]);
  });
});

describe('llamada entrante → cuenta', () => {
  test('con prefijos de país o sin ellos', () => {
    expect(accountsByPhone(index, '+5493424112233').map((r) => r.id)).toEqual(['b']);
    expect(accountsByPhone(index, '5370985').map((r) => r.id)).toEqual(['a']);
    expect(accountsByPhone(index, '123')).toEqual([]);
  });
});

describe('lectura de las respuestas de Gavriel', () => {
  test('lista de cuentas con paginado', () => {
    const body = { data: { data: [{ id: 7, accountNumber: '0031', name: 'X', currentStatus: 'Activa', phone: '1' }], meta: { pagination: { pages: 17 } } } };
    expect(parseAccountsPage(body)).toEqual({ accounts: [{ id: '7', number: '0031', name: 'X', status: 'Activa', phone: '1', contacts: [] }], pages: 17 });
    expect(parseAccountsPage(null)).toEqual({ accounts: [], pages: 1 });
  });
  test('contactos con dos teléfonos', () => {
    expect(parseContacts({ data: [{ name: 'Ana', phone: '1', phone2: '2' }, { name: '' }] })).toEqual([{ name: 'Ana', phone: '1', phone2: '2' }]);
    expect(parseContacts('x')).toEqual([]);
  });
});
