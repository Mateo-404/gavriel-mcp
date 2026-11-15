import { afterEach, describe, expect, test } from 'bun:test';
import { createCallRound, type RoundContact } from '../../src/content/call-round';

let calling = false;
let n = 0;
let account: string | null = 'acc0';
let repaints = 0;
const round = createCallRound({ isCalling: () => calling, accountId: () => account, repaint: () => void repaints++ });

function mount(names: string[]): { contacts: RoundContact[]; heading: HTMLElement } {
  document.body.innerHTML = '<section><p id="h">Contactos de emergencia</p></section>';
  const section = document.querySelector('section')!;
  const contacts = names.map((name) => {
    const card = document.createElement('div');
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Llamar');
    card.append(button);
    section.append(card);
    return { name, button, card };
  });
  return { contacts, heading: document.getElementById('h')! };
}

const states = (contacts: RoundContact[]): string[] => contacts.map((c) => c.card.getAttribute('data-gv-round') ?? 'sin');
const label = (): string => document.querySelector('.gv-round-text')?.textContent ?? '';

afterEach(() => {
  round.setEnabled(false);
  round.setEnabled(true);
  calling = false;
  account = `acc${++n}`;
  repaints = 0;
  document.body.innerHTML = '';
});

describe('ronda de llamadas (DOM)', () => {
  test('al entrar: todos tildados, sin color y la barra marca la ronda 1', () => {
    const { contacts, heading } = mount(['Paula', 'Guillermo', 'Maria']);
    round.paint(contacts, heading);
    expect(states(contacts)).toEqual(['', '', '']);
    expect(contacts.every((c) => c.card.querySelector<HTMLInputElement>('.gv-round-check')!.checked)).toBe(true);
    expect(label()).toBe('Ronda 1 de 2 · 0/3 llamados');
    expect(heading.nextElementSibling!.className).toBe('gv-round-bar');
  });

  test('la ronda avanza en orden, pinta verde al que llama y amarillo al ya llamado', () => {
    const { contacts, heading } = mount(['Paula', 'Guillermo', 'Maria']);
    round.paint(contacts, heading);
    const first = round.peek(contacts);
    expect(first).toEqual({ position: 1, round: 1 });
    round.commit(1, 1);
    calling = true;
    round.paint(contacts, heading);
    expect(states(contacts)).toEqual(['calling', '', '']);
    calling = false; // cortó
    round.paint(contacts, heading);
    expect(states(contacts)).toEqual(['once', '', '']);
    expect(label()).toBe('Ronda 1 de 2 · 1/3 llamados');
    expect(round.peek(contacts)).toEqual({ position: 2, round: 1 });
  });

  test('segunda ronda: rojo a los que ya se llamaron dos veces, y al terminar avisa', () => {
    const { contacts, heading } = mount(['A', 'B']);
    round.paint(contacts, heading);
    for (let i = 0; i < 4; i++) {
      const pick = round.peek(contacts);
      if ('message' in pick) throw new Error(pick.message);
      round.commit(pick.position, pick.round);
      calling = true;
      round.paint(contacts, heading);
      calling = false;
      round.paint(contacts, heading);
    }
    expect(states(contacts)).toEqual(['twice', 'twice']);
    const done = round.peek(contacts);
    expect('message' in done && done.message).toContain('Ronda terminada');
    expect(label()).toBe('Ronda 2 de 2 terminada');
  });

  test('destildar saca al contacto de la ronda y lo atenúa', () => {
    const { contacts, heading } = mount(['A', 'B', 'C']);
    round.paint(contacts, heading);
    const check = contacts[1]!.card.querySelector<HTMLInputElement>('.gv-round-check')!;
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    expect(repaints).toBeGreaterThan(0);
    round.paint(contacts, heading);
    expect(states(contacts)).toEqual(['', 'off', '']);
    round.commit(1, 1);
    expect(round.peek(contacts)).toEqual({ position: 3, round: 1 }); // salta al destildado
  });

  test('«Reiniciar ronda» vuelve a tildar todo y a la ronda 1', () => {
    const { contacts, heading } = mount(['A', 'B']);
    round.paint(contacts, heading);
    round.commit(1, 1);
    round.paint(contacts, heading);
    document.querySelector<HTMLButtonElement>('.gv-round-reset')!.click();
    round.paint(contacts, heading);
    expect(states(contacts)).toEqual(['', '']);
    expect(label()).toBe('Ronda 1 de 2 · 0/2 llamados');
  });

  test('el estado es por cuenta: otra cuenta empieza de cero y al volver se conserva', () => {
    const { contacts, heading } = mount(['A', 'B']);
    round.paint(contacts, heading);
    round.commit(1, 1);
    const mine = account;
    account = 'otra';
    round.paint(contacts, heading);
    expect(label()).toBe('Ronda 1 de 2 · 0/2 llamados');
    account = mine;
    round.paint(contacts, heading);
    expect(label()).toBe('Ronda 1 de 2 · 1/2 llamados');
  });

  test('un contacto sin teléfono (botón deshabilitado) se salta', () => {
    const { contacts, heading } = mount(['A', 'Sin tel', 'C']);
    contacts[1]!.button.disabled = true;
    round.paint(contacts, heading);
    round.commit(1, 1);
    expect(round.peek(contacts)).toEqual({ position: 3, round: 1 });
  });

  test('si el softphone nunca confirma la llamada, el verde se va solo (no queda pegado)', async () => {
    const { contacts, heading } = mount(['A']);
    round.paint(contacts, heading);
    round.commit(1, 1);
    const realNow = Date.now;
    Date.now = () => realNow() + 7000;
    try {
      round.paint(contacts, heading);
    } finally {
      Date.now = realNow;
    }
    expect(states(contacts)).toEqual(['once']);
  });

  test('desactivada no dibuja nada y deja la página como estaba', () => {
    const { contacts, heading } = mount(['A']);
    round.paint(contacts, heading);
    round.setEnabled(false);
    expect(document.querySelector('.gv-round-bar')).toBeNull();
    expect(document.querySelector('.gv-round-check')).toBeNull();
    expect(contacts[0]!.card.hasAttribute('data-gv-round')).toBe(false);
    round.paint(contacts, heading);
    expect(document.querySelector('.gv-round-bar')).toBeNull();
  });

  test('sin cuenta abierta o sin lista de contactos pide abrir la pestaña', () => {
    const { contacts } = mount(['A']);
    account = null;
    const none = round.peek(contacts);
    expect('message' in none && none.message).toContain('cuenta');
    account = 'acc9';
    const empty = round.peek([]);
    expect('message' in empty && empty.message).toContain('Contactos');
  });

  test('no toca el DOM si nada cambió (sin re-escrituras en cada observación)', () => {
    const { contacts, heading } = mount(['A', 'B']);
    round.paint(contacts, heading);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    round.paint(contacts, heading);
    round.paint(contacts, heading);
    return Promise.resolve().then(() => {
      observer.disconnect();
      expect(records.length).toBe(0);
    });
  });
});
