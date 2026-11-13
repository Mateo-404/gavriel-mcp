import { describe, expect, test } from 'bun:test';
import { formatClientMessage } from '../src/shared/client-message';

describe('formatClientMessage', () => {
  test('el ejemplo del pedido', () => {
    expect(formatClientMessage('MERLO FERNANDO', 'J. M. NOLLI 1820, RAFAELA · Santa Fe')).toBe(
      'Estimado/a cliente: *MERLO FERNANDO*\nAlarma de: *J. M. NOLLI 1820, RAFAELA · Santa Fe*',
    );
  });

  test('limpia espacios y saltos de línea', () => {
    expect(formatClientMessage('  PERREN \n PABLO ', ' Reconquista  444 ')).toBe(
      'Estimado/a cliente: *PERREN PABLO*\nAlarma de: *Reconquista 444*',
    );
  });

  test('sin nombre o sin dirección no arma nada', () => {
    expect(formatClientMessage('', 'calle 1')).toBeNull();
    expect(formatClientMessage('X', '   ')).toBeNull();
  });
});
