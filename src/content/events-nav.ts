/**
 * Recorrer con el teclado los eventos del panel de monitoreo (la lista en columnas).
 *
 * Cómo está armado Gavriel (verificado en su código):
 *  - Cada columna es `div#mp-col-<id>.monitoring-panel-column-card` y cada evento un
 *    `div.monitoring-panel-event-card` dentro de ella, de izquierda a derecha.
 *  - Un clic simple en la tarjeta abre la cuenta; con Ctrl/Meta en cambio la selecciona,
 *    por eso se abre con `element.click()` (que no lleva modificadores).
 *  - React vuelve a escribir `className`, así que la marca de "seleccionado" va en un
 *    atributo propio (`data-gv-focus`) y no en una clase.
 *
 * La lógica de movimiento es pura y está en shared/grid.ts (con tests); acá solo se lee
 * el DOM, se marca la tarjeta y se la abre.
 */
import { moveInGrid, nthInGrid, type ArrowKey, type GridPos } from '../shared/grid';
import { isPanelList } from '../shared/routes';

const COLUMN = '.monitoring-panel-column-card';
const CARD = '.monitoring-panel-event-card';
const TITLE = '.monitoring-panel-card-title';

export const FOCUS_ATTR = 'data-gv-focus';
/** Cantidad de eventos que tienen atajo Alt+N. */
export const MAX_NUMBERED_EVENTS = 9;

export interface EventCard {
  el: HTMLElement;
  pos: GridPos;
  /** Identifica la tarjeta aunque React la vuelva a dibujar: columna + título. */
  key: string;
}

interface Deps {
  visible: (el: Element) => boolean;
  toast: (message: string) => void;
}

export interface EventsNav {
  /** ¿Estamos en la lista de eventos del panel? */
  active: () => boolean;
  /** ¿Hay una tarjeta marcada con las flechas? */
  hasFocus: () => boolean;
  /** Mueve la marca con una flecha. Devuelve true si había eventos (la tecla se consume). */
  move: (key: ArrowKey) => boolean;
  /** Abre el evento marcado. Devuelve true si lo abrió. */
  openFocused: () => boolean;
  /** Abre el evento N (Alt+N). */
  openNth: (n: number) => void;
  /** Los primeros eventos, en el orden de Alt+N, para mostrar su indicador. */
  numbered: () => EventCard[];
  /** Quita la marca. */
  clear: () => void;
  /** Mantiene la marca al día cuando la página se vuelve a dibujar. */
  refresh: () => void;
}

export function createEventsNav({ visible, toast }: Deps): EventsNav {
  let focusKey: string | null = null;

  const active = (): boolean => isPanelList(location.pathname);

  /** Columnas de izquierda a derecha, cada una con sus tarjetas de arriba hacia abajo. */
  const columns = (): EventCard[][] =>
    [...document.querySelectorAll<HTMLElement>(COLUMN)]
      .filter(visible)
      .map((column, col) =>
        [...column.querySelectorAll<HTMLElement>(CARD)]
          .filter(visible)
          .map((el, row) => ({
            el,
            pos: { col, row },
            key: `${column.id}|${(el.querySelector(TITLE)?.textContent ?? '').trim()}`,
          })),
      );

  const findFocused = (cols: EventCard[][]): EventCard | undefined =>
    focusKey === null ? undefined : cols.flat().find((card) => card.key === focusKey);

  const unmark = (): void => {
    for (const marked of document.querySelectorAll<HTMLElement>(`[${FOCUS_ATTR}]`)) {
      marked.removeAttribute(FOCUS_ATTR);
      if (document.activeElement === marked) marked.blur();
    }
  };

  const mark = (card: EventCard, scroll: boolean): void => {
    const already = card.el.hasAttribute(FOCUS_ATTR);
    if (!already) {
      unmark();
      card.el.setAttribute(FOCUS_ATTR, '');
    }
    if (scroll) {
      // El foco real acompaña a la marca (accesibilidad y Tab); sin tabindex no puede recibirlo
      if (!card.el.hasAttribute('tabindex')) card.el.setAttribute('tabindex', '-1');
      card.el.focus({ preventScroll: true });
      card.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  const clear = (): void => {
    focusKey = null;
    unmark();
  };

  return {
    active,
    hasFocus: () => focusKey !== null,

    move(key) {
      const cols = columns();
      const next = moveInGrid(
        cols.map((c) => c.length),
        findFocused(cols)?.pos ?? null,
        key,
      );
      const target = next && cols[next.col]?.[next.row];
      if (!target) return false;
      focusKey = target.key;
      mark(target, true);
      return true;
    },

    openFocused() {
      const card = findFocused(columns());
      if (!card) return false;
      clear();
      card.el.click();
      return true;
    },

    openNth(n) {
      const cols = columns();
      const pos = nthInGrid(
        cols.map((c) => c.length),
        n,
      );
      const card = pos && cols[pos.col]?.[pos.row];
      if (!card) return toast(`No hay evento ${n} en el panel`);
      clear();
      card.el.click();
    },

    numbered: () => columns().flat().slice(0, MAX_NUMBERED_EVENTS),

    clear,

    refresh() {
      if (focusKey === null) return;
      const card = active() ? findFocused(columns()) : undefined;
      if (card) mark(card, false);
      else clear(); // la tarjeta cambió de columna, se cerró o salimos del panel
    },
  };
}
