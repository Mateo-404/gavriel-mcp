import { beforeEach, describe, expect, test } from 'bun:test';
import { createCallCard } from '../../src/content/call-card';

let calling = false;
const card = createCallCard({ isCalling: () => calling, visible: () => true });

const contactCard = (order: string, name: string, phone: string, desc: string): string =>
  `<div class="card"><div class="min-w-0"><div><p>${order}. ${name}</p><span>SMS</span></div><div><span>${phone}</span></div><p>${desc}</p></div>` +
  `<button aria-label="Llamar">x</button></div>`;

const shown = (): { name: string; desc: string } | null => {
  const el = document.querySelector<HTMLElement>('.gv-callcard');
  if (!el || el.hidden) return null;
  return { name: el.querySelector('.gv-callcard-name')!.textContent!, desc: el.querySelector('.gv-callcard-desc')!.textContent! };
};

beforeEach(() => {
  calling = false;
  document.body.innerHTML =
    '<section>' +
    contactCard('1', 'Pablo Perren', '3492638214', 'Dueño Alarma General') +
    contactCard('2', 'Constanza', '3492526217', 'Novia Alarma General') +
    '</section><div class="fixed"><button aria-label="Abrir softphone">tel</button></div>';
  card.update();
});

describe('call-card (DOM)', () => {
  test('al llamar a un contacto muestra su nombre y descripción, y se va al cortar', () => {
    document.querySelectorAll<HTMLElement>('button[aria-label="Llamar"]')[0]!.click();
    expect(shown()).toBeNull(); // todavía no hay llamada
    calling = true;
    card.update();
    expect(shown()).toEqual({ name: 'Pablo Perren', desc: 'Dueño Alarma General' });
    calling = false;
    card.update();
    expect(shown()).toBeNull();
  });

  test('vuelve a funcionar con el contacto siguiente', () => {
    const buttons = document.querySelectorAll<HTMLElement>('button[aria-label="Llamar"]');
    buttons[0]!.click();
    calling = true;
    card.update();
    calling = false;
    card.update();
    buttons[1]!.click();
    calling = true;
    card.update();
    expect(shown()).toEqual({ name: 'Constanza', desc: 'Novia Alarma General' });
  });

  test('una llamada sin clic previo (entrante) no muestra tarjeta', () => {
    calling = true;
    card.update();
    expect(shown()).toBeNull();
  });

  test('apagada desde Ajustes no muestra nada', () => {
    card.setEnabled(false);
    document.querySelector<HTMLElement>('button[aria-label="Llamar"]')!.click();
    calling = true;
    card.update();
    expect(shown()).toBeNull();
    card.setEnabled(true);
  });
});
