import { describe, expect, test } from 'bun:test';
import { digitsOf, parseContactLines, parseContactText, samePhone } from '../src/shared/contact-card';

describe('parseContactLines', () => {
  test('tarjeta de la lista: orden, nombre, SMS, teléfono y descripción', () => {
    expect(parseContactLines(['1. Pablo Perren', 'SMS', '3492638214', 'Dueño Alarma General'])).toEqual({
      name: 'Pablo Perren',
      description: 'Dueño Alarma General',
      phone: '3492638214',
    });
  });

  test('ítem del menú: nombre, descripción y teléfono', () => {
    expect(parseContactLines(['Constanza', 'Novia Alarma General', '3492526217'])).toEqual({
      name: 'Constanza',
      description: 'Novia Alarma General',
      phone: '3492526217',
    });
  });

  test('sin descripción ni teléfono', () => {
    expect(parseContactLines(['0. Diego Ilull'])).toEqual({ name: 'Diego Ilull', description: '', phone: '' });
  });

  test('teléfono con formato', () => {
    expect(parseContactLines(['Ana', '+54 9 (3492) 52-6217'])?.phone).toBe('+5493492526217');
  });

  test('varias líneas de descripción se unen', () => {
    expect(parseContactLines(['Ana', 'Madre', 'Alarma General', '3492526217'])?.description).toBe('Madre · Alarma General');
  });

  test('vacío o sin nombre da null', () => {
    expect(parseContactLines([])).toBeNull();
    expect(parseContactLines(['  ', ''])).toBeNull();
    expect(parseContactLines(['3. SMS'])).toBeNull();
  });

  test('desde texto con saltos de línea', () => {
    expect(parseContactText('Gladys\nMadre\n3492601969')?.name).toBe('Gladys');
  });
});

describe('samePhone', () => {
  test('ignora formato y prefijos', () => {
    expect(digitsOf('+54 9 3492-638214')).toBe('5493492638214');
    expect(samePhone('3492638214', '+54 9 3492 638214')).toBe(true);
    expect(samePhone('3492638214', '3492638215')).toBe(false);
  });

  test('números cortos o vacíos no coinciden', () => {
    expect(samePhone('', '')).toBe(false);
    expect(samePhone('911', '911')).toBe(false);
  });
});
