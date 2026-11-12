import { describe, expect, test } from 'bun:test';
import { digitFromKeyCode, isHangupLabel, parseContactName } from '../src/shared/labels';

describe('isHangupLabel', () => {
  test('reconoce el botón de cortar', () => {
    expect(isHangupLabel('Colgar')).toBe(true);
    expect(isHangupLabel('  colgar ')).toBe(true);
    expect(isHangupLabel('Cortar llamada')).toBe(true);
    expect(isHangupLabel('Hang up')).toBe(true);
  });

  test('no confunde otros botones', () => {
    expect(isHangupLabel('Cerrar')).toBe(false); // botón flotante del softphone
    expect(isHangupLabel('Cerrar intervención')).toBe(false);
    expect(isHangupLabel('Fallo de Comunicacion(1)')).toBe(false); // filtro con ícono de teléfono tachado
    expect(isHangupLabel('Llamar')).toBe(false);
    expect(isHangupLabel('')).toBe(false);
    expect(isHangupLabel(null)).toBe(false);
  });
});

describe('parseContactName', () => {
  test('saca el número de orden y la etiqueta SMS', () => {
    expect(parseContactName('0. Liprandi Maria Laura (hija)\nSMS\n3564679435')).toBe('Liprandi Maria Laura (hija)');
    expect(parseContactName('3. Lucas\nSMS\n3564615816')).toBe('Lucas');
    expect(parseContactName('Sin orden\n3564615816')).toBe('Sin orden');
    expect(parseContactName('')).toBe('');
  });
});

describe('digitFromKeyCode', () => {
  test('acepta 1 a 9 en la fila superior y en el teclado numérico', () => {
    expect(digitFromKeyCode('Digit1')).toBe(1);
    expect(digitFromKeyCode('Digit9')).toBe(9);
    expect(digitFromKeyCode('Numpad4')).toBe(4);
  });

  test('el 0 y el resto no tienen atajo', () => {
    expect(digitFromKeyCode('Digit0')).toBeNull();
    expect(digitFromKeyCode('Numpad0')).toBeNull();
    expect(digitFromKeyCode('KeyA')).toBeNull();
    expect(digitFromKeyCode('Digit10')).toBeNull();
  });
});
