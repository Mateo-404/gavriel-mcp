/**
 * Pantallas del índice de cuentas (mundo aislado):
 *  1. Desplegable de resultados bajo «Búsqueda general» de la lista de cuentas, con el motivo de cada coincidencia.
 *     No toca el filtro de Gavriel: el buscador de la página sigue haciendo lo suyo.
 *  2. Aviso en una llamada entrante con la cuenta (o cuentas) a la que pertenece el número.
 * Los resultados se dibujan en un contenedor propio fuera del árbol de React (nunca dentro de sus nodos).
 */
import { accountUrl } from '../shared/notification';
import type { SearchResult } from '../shared/account-search';

const SEARCH_INPUT = 'input[placeholder^="Nombre, número, email"]';
const MAX_SHOWN = 8;

export interface SearchUiDeps {
  search: (query: string) => SearchResult[];
  size: () => number;
  progress: () => { done: number; total: number } | null;
  open?: (id: string) => void;
}

const defaultOpen = (id: string): void => location.assign(accountUrl(id));

const rowFor = (result: SearchResult, open: (id: string) => void): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gv-asearch-row';
  const title = document.createElement('span');
  title.className = 'gv-asearch-title';
  title.textContent = `#${result.number || '—'}  ${result.name}`;
  const why = document.createElement('span');
  why.className = 'gv-asearch-why';
  why.textContent = result.reason;
  button.append(title, why);
  button.addEventListener('mousedown', (event) => event.preventDefault()); // que no le saque el foco al buscador
  button.addEventListener('click', () => open(result.id));
  return button;
};

export interface SearchUi {
  /** Engancha el buscador si está en pantalla (se llama en cada repintado; es barato). */
  attach: () => void;
  /** Para pruebas y para cuando se desactiva. */
  hide: () => void;
}

export function createSearchUi({ search, size, progress, open = defaultOpen }: SearchUiDeps): SearchUi {
  let box: HTMLDivElement | undefined;
  let bound: HTMLInputElement | undefined;
  let selected = -1;

  const hide = (): void => {
    box?.remove();
    box = undefined;
    selected = -1;
  };

  const place = (input: HTMLInputElement): void => {
    if (!box) return;
    const rect = input.getBoundingClientRect();
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.bottom + 4)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
  };

  const render = (input: HTMLInputElement): void => {
    const query = input.value.trim();
    if (query.length < 2) return hide();
    const results = search(query).slice(0, MAX_SHOWN);
    if (!box) {
      box = document.createElement('div');
      box.className = 'gv-asearch';
      box.setAttribute('role', 'listbox');
      document.body.appendChild(box);
    }
    box.replaceChildren();
    selected = -1;
    if (results.length === 0) {
      const note = document.createElement('div');
      note.className = 'gv-asearch-note';
      const p = progress();
      note.textContent =
        size() === 0
          ? p
            ? `Armando el índice de cuentas… ${p.done}/${p.total}`
            : 'Todavía no hay índice de cuentas (se arma al cargar Gavriel)'
          : 'Sin coincidencias en el índice';
      box.append(note);
    } else {
      for (const result of results) box.append(rowFor(result, open));
      const p = progress();
      if (p) {
        const note = document.createElement('div');
        note.className = 'gv-asearch-note';
        note.textContent = `Índice en armado: ${p.done}/${p.total} cuentas con contactos`;
        box.append(note);
      }
    }
    place(input);
  };

  const move = (step: number): void => {
    const rows = [...(box?.querySelectorAll<HTMLButtonElement>('.gv-asearch-row') ?? [])];
    if (rows.length === 0) return;
    selected = (selected + step + rows.length) % rows.length;
    rows.forEach((row, i) => row.classList.toggle('gv-selected', i === selected));
  };

  const bind = (input: HTMLInputElement): void => {
    bound = input;
    input.addEventListener('input', () => render(input));
    input.addEventListener('focus', () => render(input));
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('keydown', (event) => {
      if (!box) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter' && selected >= 0) {
        event.preventDefault();
        box.querySelectorAll<HTMLButtonElement>('.gv-asearch-row')[selected]?.click();
      } else if (event.key === 'Escape') {
        hide();
      }
    });
    window.addEventListener('resize', () => place(input));
  };

  return {
    attach() {
      const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
      if (!input) {
        if (bound && !bound.isConnected) {
          bound = undefined;
          hide();
        }
        return;
      }
      if (input !== bound) bind(input);
    },
    hide,
  };
}

// ---------- Llamada entrante ----------

export interface IncomingDeps {
  caller: () => Promise<string | null>;
  byPhone: (number: string) => SearchResult[];
  open?: (id: string) => void;
}

export interface IncomingBanner {
  /** `ringing` = hay una llamada entrante en pantalla. Se llama en cada repintado. */
  update: (ringing: boolean) => void;
}

export function createIncomingBanner({ caller, byPhone, open = defaultOpen }: IncomingDeps): IncomingBanner {
  let el: HTMLDivElement | undefined;
  let asked = false;
  let tries = 0;

  const remove = (): void => {
    el?.remove();
    el = undefined;
    asked = false;
    tries = 0;
  };

  const show = (number: string, matches: SearchResult[]): void => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'gv-incoming';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'gv-incoming-head';
    head.textContent = matches.length ? `Llamada de ${number}` : `Llamada de ${number} · no está en ninguna cuenta`;
    el.append(head);
    for (const match of matches.slice(0, 3)) el.append(rowFor(match, open));
  };

  return {
    update(ringing) {
      if (!ringing) return remove();
      if (asked || tries >= 5) return;
      asked = true;
      tries++;
      void caller().then((number) => {
        if (!number) {
          asked = false; // todavía sin número: se vuelve a intentar en el próximo repintado (máx. 5)
          return;
        }
        show(number, byPhone(number));
      });
    },
  };
}
