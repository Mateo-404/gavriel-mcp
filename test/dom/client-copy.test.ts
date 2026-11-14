import { beforeEach, describe, expect, test } from 'bun:test';
import { createClientCopy } from '../../src/content/client-copy';

const toasts: string[] = [];
let copied = '';
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async (t: string) => void (copied = t) },
  configurable: true,
});
const copy = createClientCopy({ visible: () => true, toast: (m) => toasts.push(m) });

const account = (name: string, address: string): string =>
  `<h1>${name}</h1><div class="account-analysis-detail-card">` +
  '<div><svg class="lucide lucide-map-pin"></svg><span>Localización y contacto</span></div>' +
  `<div><svg class="lucide lucide-map-pin"></svg><span class="account-analysis-text-wrap">${address}</span></div></div>`;

beforeEach(() => {
  toasts.length = 0;
  copied = '';
});

describe('client-copy (DOM)', () => {
  test('copia el mensaje con la cuenta y la dirección (no el título de la tarjeta)', async () => {
    document.body.innerHTML = account('MERLO FERNANDO', 'J. M. NOLLI 1820, RAFAELA · Santa Fe');
    await copy();
    expect(copied).toBe('Estimado/a cliente: *MERLO FERNANDO*\nAlarma de: *J. M. NOLLI 1820, RAFAELA · Santa Fe*');
    expect(toasts).toEqual(['Copiado: MERLO FERNANDO']);
  });

  test('sin dirección avisa y no copia', async () => {
    document.body.innerHTML = '<h1>X</h1>';
    await copy();
    expect(copied).toBe('');
    expect(toasts).toEqual(['No encontré la dirección de la cuenta']);
  });
});
