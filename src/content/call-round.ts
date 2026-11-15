/**
 * Ronda de llamadas a los contactos de emergencia (DOM). La lógica está en shared/call-round.ts.
 *
 *  - Cada tarjeta de contacto muestra un tilde («entra en la ronda») y su color: verde llamando ahora,
 *    amarillo una llamada, rojo dos, atenuada si está destildada.
 *  - Sobre la lista hay una barra con la ronda actual («Ronda 1 de 2 · 3/8 llamados») y «Reiniciar ronda».
 *  - Alt+Enter (ver shortcuts.ts) pide `peek` (a quién toca) y, si la llamada arrancó, `commit`.
 * Se dibuja desde el observador compartido del DOM: solo toca lo que cambió y marca todo con
 * `data-gv-hint` para que ese observador ignore lo propio.
 */
import {
  type RoundNumber,
  type RoundState,
  createRoundStore,
  markCalled,
  pickNext,
  progress,
  progressLabel,
  resetRound,
  rowStatus,
  syncRows,
  toggleRow,
} from '../shared/call-round';

export interface RoundContact {
  name: string;
  button: HTMLButtonElement;
  card: HTMLElement;
}

export interface CallRoundDeps {
  isCalling: () => boolean;
  accountId: () => string | null;
  /** Para volver a dibujar enseguida (tilde, reinicio). */
  repaint: () => void;
}

const ATTR = 'data-gv-round';
/** Cuánto se espera a que el softphone confirme la llamada antes de dejar de pintarla «llamando». */
const CALLING_GRACE_MS = 6000;

export interface CallRound {
  setEnabled: (on: boolean) => void;
  /** Dibuja tildes, colores y barra. `heading` es el título «Contactos de emergencia». */
  paint: (contacts: RoundContact[], heading: HTMLElement | null) => void;
  /** A quién toca llamar ahora (posición 1…N) o por qué no hay nadie. No cambia nada. */
  peek: (contacts: RoundContact[]) => { position: number; round: RoundNumber } | { message: string };
  /** La llamada a `position` arrancó: cuenta una llamada y la pinta «llamando». */
  commit: (position: number, round: RoundNumber) => void;
  /** La intervención terminó: la ronda de la cuenta vuelve a cero (sin cuenta abierta, todas). */
  forget: (all?: boolean) => void;
}

export function createCallRound({ isCalling, accountId, repaint }: CallRoundDeps): CallRound {
  const store = createRoundStore();
  let enabled = true;
  let bar: HTMLDivElement | undefined;
  let barText: HTMLSpanElement | undefined;
  let calling: { index: number; at: number; seen: boolean } | null = null;
  const checks = new WeakMap<HTMLElement, HTMLInputElement>();
  const positions = new WeakMap<HTMLInputElement, number>(); // fila a la que pertenece cada tilde
  const decorated = new Set<HTMLElement>();

  const stateFor = (contacts: readonly RoundContact[]): { id: string; state: RoundState } | null => {
    const id = accountId();
    if (!id) return null;
    const synced = syncRows(
      store.get(id),
      contacts.map((c) => ({ name: c.name, callable: !c.button.disabled })),
    );
    store.set(id, synced);
    return { id, state: synced };
  };

  const update = (id: string, fn: (s: RoundState) => RoundState): void => {
    store.set(id, fn(store.get(id)));
    repaint();
  };

  const ensureBar = (): HTMLDivElement => {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'gv-round-bar';
    bar.setAttribute('data-gv-hint', '');
    barText = document.createElement('span');
    barText.className = 'gv-round-text';
    const keys = document.createElement('span');
    keys.className = 'gv-round-keys';
    keys.textContent = 'Alt+Enter: siguiente';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'gv-round-reset';
    reset.textContent = 'Reiniciar ronda';
    reset.addEventListener('click', () => {
      const id = accountId();
      if (!id) return;
      calling = null;
      update(id, resetRound);
    });
    bar.append(barText, keys, reset);
    return bar;
  };

  const clearAll = (): void => {
    bar?.remove();
    for (const card of decorated) {
      card.removeAttribute(ATTR);
      checks.get(card)?.remove();
    }
    decorated.clear();
  };

  const checkboxFor = (card: HTMLElement, index: number): HTMLInputElement => {
    let input = checks.get(card);
    if (!input) {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'gv-round-check';
      input.setAttribute('data-gv-hint', '');
      input.title = 'Incluir en la ronda de llamadas';
      input.setAttribute('aria-label', 'Incluir en la ronda de llamadas');
      input.addEventListener('click', (event) => event.stopPropagation());
      const tick = input;
      input.addEventListener('change', () => {
        const id = accountId();
        const at = positions.get(tick);
        if (id && at !== undefined) update(id, (s) => toggleRow(s, at));
      });
      checks.set(card, input);
    }
    positions.set(input, index); // la lista puede reordenarse: siempre vale la fila actual
    return input;
  };

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) clearAll();
    },

    paint(contacts, heading) {
      if (!enabled || contacts.length === 0 || !heading) return clearAll();
      const current = stateFor(contacts);
      if (!current) return clearAll();
      const { state } = current;

      // «llamando ahora»: desde que se pidió la llamada hasta que el softphone la termina
      if (calling) {
        const active = isCalling();
        if (active) calling.seen = true;
        if (calling.seen ? !active : Date.now() - calling.at > CALLING_GRACE_MS) calling = null;
      }

      const seen = new Set<HTMLElement>();
      contacts.forEach((contact, index) => {
        const row = state.rows[index]!;
        const status = calling?.index === index ? 'calling' : rowStatus(row);
        seen.add(contact.card);
        decorated.add(contact.card);
        const value = status === 'none' ? '' : status;
        if (contact.card.getAttribute(ATTR) !== value) contact.card.setAttribute(ATTR, value);
        const input = checkboxFor(contact.card, index);
        if (input.checked !== row.included) input.checked = row.included;
        input.disabled = !row.callable;
        if (!input.isConnected || input.parentElement !== contact.card) contact.card.append(input);
      });
      for (const card of [...decorated]) {
        if (seen.has(card)) continue;
        card.removeAttribute(ATTR);
        checks.get(card)?.remove();
        decorated.delete(card);
      }

      const el = ensureBar();
      const label = progressLabel(progress(state));
      if (barText && barText.textContent !== label) barText.textContent = label;
      if (!el.isConnected || el.previousElementSibling !== heading) heading.after(el);
    },

    peek(contacts) {
      const current = stateFor(contacts);
      if (!current) return { message: 'Abrí una cuenta para usar la ronda' };
      if (current.state.rows.length === 0) return { message: 'Abrí la pestaña Contactos para iniciar la ronda' };
      const next = pickNext(current.state);
      if (!next) {
        return { message: progress(current.state).total === 0 ? 'No hay contactos tildados en la ronda' : 'Ronda terminada · «Reiniciar ronda» para empezar de nuevo' };
      }
      return { position: next.index + 1, round: next.round };
    },

    commit(position, round) {
      const id = accountId();
      if (!id) return;
      calling = { index: position - 1, at: Date.now(), seen: false };
      update(id, (s) => markCalled(s, position - 1, round));
    },

    forget(all = false) {
      const id = accountId();
      if (all || !id) store.clear();
      else store.clear(id);
      calling = null;
      repaint();
    },
  };
}
