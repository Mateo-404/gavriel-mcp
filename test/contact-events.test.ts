import { describe, expect, test } from 'bun:test';
import { isPhoneEventTitle, newestFirst, parseCalledContact, parseEventTimestamp } from '../src/shared/contact-events';

describe('eventos «Contacto vía Teléfono»', () => {
  test('parseCalledContact: saca el nombre sin el teléfono, tolera acentos, espacios y paréntesis que no son teléfono', () => {
    expect(parseCalledContact('Contacto vía Teléfono a Pablo Perren (3492638214)')).toBe('Pablo Perren');
    expect(parseCalledContact('Contacto vía Teléfono a Liprandi Maria Laura (hija) (3564679435)')).toBe('Liprandi Maria Laura (hija)');
    expect(parseCalledContact('contacto via telefono a   Gladys   (3492601969)  ')).toBe('Gladys');
    expect(parseCalledContact('Contacto vía  Teléfono a Ana María (+54 342 537-0985)')).toBe('Ana María');
    expect(parseCalledContact('Contacto vía Teléfono a Alejandra.')).toBe('Alejandra');
    expect(parseCalledContact('Contacto vía Teléfono a Guardia 2 (3493442045)')).toBe('Guardia 2');
  });

  test('parseCalledContact: otros textos devuelven null', () => {
    for (const text of ['Contacto vía WhatsApp a Pablo Perren (3492638214)', 'Contacto teléfono', '', 'Contacto vía Teléfono a ']) {
      expect(parseCalledContact(text)).toBeNull();
    }
  });

  test('isPhoneEventTitle: reconoce los eventos Teléfono y no confunde otros', () => {
    expect(isPhoneEventTitle('Teléfono · GAVRIEL-INTERVENTION-PHONE')).toBe(true);
    expect(isPhoneEventTitle('  telefono')).toBe(true);
    for (const title of ['Robo · BUR', 'Cancelacion · CAN', 'Fallo de Comunicacion · COF']) expect(isPhoneEventTitle(title)).toBe(false);
  });

  test('parseEventTimestamp lee día/mes/año y hora; newestFirst ordena del más nuevo, manda al final lo sin fecha y no muta', () => {
    expect(parseEventTimestamp('13/11/2026, 02:02:49')).toBe(new Date(2026, 10, 13, 2, 2, 49).getTime());
    expect(parseEventTimestamp('Teléfono\n13/11/2026, 01:57:05 · equipo')).toBe(new Date(2026, 10, 13, 1, 57, 5).getTime());
    expect(parseEventTimestamp('sin fecha')).toBeNull();
    const items = [{ id: 'a', t: 10 }, { id: 'b', t: 30 }, { id: 'c', t: null }, { id: 'd', t: 20 }, { id: 'e', t: 10 }];
    expect(newestFirst(items, (i) => i.t).map((i) => i.id)).toEqual(['b', 'd', 'a', 'e', 'c']); // empate a/e: orden original
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
