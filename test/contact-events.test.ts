import { describe, expect, test } from 'bun:test';
import { isPhoneEventTitle, newestFirst, parseCalledContact, parseEventTimestamp } from '../src/shared/contact-events';

describe('parseCalledContact', () => {
  test('saca el nombre sin el teléfono', () => {
    expect(parseCalledContact('Contacto vía Teléfono a Pablo Perren (3492638214)')).toBe('Pablo Perren');
    expect(parseCalledContact('Contacto vía Teléfono a Juan Pablo Perren (3492300466)')).toBe('Juan Pablo Perren');
  });

  test('un paréntesis que no es teléfono forma parte del nombre', () => {
    expect(parseCalledContact('Contacto vía Teléfono a Liprandi Maria Laura (hija) (3564679435)')).toBe(
      'Liprandi Maria Laura (hija)',
    );
  });

  test('con o sin acentos, mayúsculas y espacios de más', () => {
    expect(parseCalledContact('contacto via telefono a   Gladys   (3492601969)  ')).toBe('Gladys');
    expect(parseCalledContact('Contacto vía  Teléfono a Ana María (+54 342 537-0985)')).toBe('Ana María');
  });

  test('sin teléfono entre paréntesis queda todo el nombre', () => {
    expect(parseCalledContact('Contacto vía Teléfono a Alejandra')).toBe('Alejandra');
    expect(parseCalledContact('Contacto vía Teléfono a Alejandra.')).toBe('Alejandra');
  });

  test('un nombre con números (no entre paréntesis) se respeta', () => {
    expect(parseCalledContact('Contacto vía Teléfono a Guardia 2 (3493442045)')).toBe('Guardia 2');
  });

  test('otros textos devuelven null', () => {
    expect(parseCalledContact('Contacto vía WhatsApp a Pablo Perren (3492638214)')).toBeNull();
    expect(parseCalledContact('Contacto teléfono')).toBeNull();
    expect(parseCalledContact('')).toBeNull();
    expect(parseCalledContact('Contacto vía Teléfono a ')).toBeNull();
  });
});

describe('isPhoneEventTitle', () => {
  test('reconoce el título de los eventos Teléfono', () => {
    expect(isPhoneEventTitle('Teléfono · GAVRIEL-INTERVENTION-PHONE')).toBe(true);
    expect(isPhoneEventTitle('  telefono')).toBe(true);
  });

  test('no confunde otros eventos', () => {
    expect(isPhoneEventTitle('Robo · BUR')).toBe(false);
    expect(isPhoneEventTitle('Cancelacion · CAN')).toBe(false);
    expect(isPhoneEventTitle('Fallo de Comunicacion · COF')).toBe(false);
  });
});

describe('parseEventTimestamp', () => {
  test('lee día/mes/año y hora', () => {
    expect(parseEventTimestamp('13/11/2026, 02:02:49')).toBe(new Date(2026, 10, 13, 2, 2, 49).getTime());
    expect(parseEventTimestamp('Teléfono\n13/11/2026, 01:57:05 · equipo')).toBe(new Date(2026, 10, 13, 1, 57, 5).getTime());
  });

  test('null si no hay fecha', () => {
    expect(parseEventTimestamp('sin fecha')).toBeNull();
    expect(parseEventTimestamp('')).toBeNull();
  });
});

describe('newestFirst', () => {
  test('ordena de más nuevo a más viejo y manda al final lo que no tiene fecha', () => {
    const items = [
      { id: 'a', t: 10 },
      { id: 'b', t: 30 },
      { id: 'c', t: null },
      { id: 'd', t: 20 },
    ];
    expect(newestFirst(items, (i) => i.t).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  test('si empatan respeta el orden original', () => {
    const items = [
      { id: 'a', t: 5 },
      { id: 'b', t: 5 },
    ];
    expect(newestFirst(items, (i) => i.t).map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('no modifica el arreglo original', () => {
    const items = [{ t: 1 }, { t: 2 }];
    newestFirst(items, (i) => i.t);
    expect(items).toEqual([{ t: 1 }, { t: 2 }]);
  });
});
