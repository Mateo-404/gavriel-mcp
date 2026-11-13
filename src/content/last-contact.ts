/**
 * Alt+Shift en una cuenta: copia al portapapeles el nombre de la última persona a la que se llamó.
 *
 * De dónde sale el dato (verificado en el código de Gavriel):
 *  - Al llamar a un contacto desde la cuenta, Gavriel registra un evento "Teléfono" en el historial
 *    cuya descripción dice "Contacto vía Teléfono a <nombre> (<teléfono>)".
 *  - Por defecto el historial oculta esos eventos: el filtro "Ocultar operación (intervención,
 *    llamadas…)" (casilla #hideOperationalFilter, dentro de "Búsqueda avanzada") viene marcado.
 *  - La descripción solo se ve con la tarjeta expandida (clic en su encabezado).
 *
 * Qué hace, sin que haya que tocar nada: si hace falta abre "Búsqueda avanzada", desmarca "Ocultar
 * operación", lee la última llamada (expandiendo su tarjeta), copia el nombre y deja todo como estaba.
 * No consulta la API ni toca el token: usa solo lo que la propia pantalla muestra.
 */
import { isPhoneEventTitle, newestFirst, parseCalledContact, parseEventTimestamp } from '../shared/contact-events';

const CARD = '.account-analysis-event-item';
const ADVANCED_TOGGLE = 'button[aria-label="Búsqueda avanzada"]';
const HIDE_OPERATION = '#hideOperationalFilter';
/** Cuántas llamadas, como máximo, se revisan hasta encontrar una con nombre. */
const MAX_CARDS_TO_READ = 5;

export interface LastContactDeps {
  visible: (el: Element) => boolean;
  toast: (message: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | null | undefined, ms: number): Promise<T | null> {
  for (let waited = 0; waited < ms; waited += 50) {
    const value = read();
    if (value) return value;
    await sleep(50);
  }
  return read() ?? null;
}

/** Radix Tabs activa la pestaña con mousedown/foco, no con click. */
function activateTab(tab: HTMLElement): void {
  tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  tab.focus({ preventScroll: true });
}

/** Copia al portapapeles: la API moderna y, si el navegador la rechaza, el método clásico. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    previous?.focus({ preventScroll: true });
    return ok;
  }
}

export function createLastContact({ visible, toast }: LastContactDeps): () => Promise<void> {
  let running = false;

  const firstLine = (el: HTMLElement): string => el.innerText.split('\n').find((line) => line.trim() !== '') ?? '';

  const phoneCards = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>(CARD)].filter((card) => visible(card) && isPhoneEventTitle(firstLine(card)));

  /** Texto de "Descripción:" de una tarjeta expandida (null si está colapsada). */
  const descriptionOf = (card: HTMLElement): string | null => {
    const label = [...card.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'Descripción:');
    const holder = label?.parentElement;
    return holder ? (holder.textContent ?? '').replace(/^\s*Descripción:\s*/, '').trim() : null;
  };

  /** Nombre del contacto de una tarjeta; la expande si hace falta y la deja como estaba. */
  const calledNameOf = async (card: HTMLElement): Promise<string | null> => {
    let description = descriptionOf(card);
    const header = card.querySelector<HTMLElement>('[role="button"]');
    const expandedHere = description === null && !!header;
    if (expandedHere) {
      header.click();
      description = await waitFor(() => descriptionOf(card), 1200);
    }
    const name = description ? parseCalledContact(description) : null;
    if (expandedHere && header && descriptionOf(card) !== null) header.click(); // se vuelve a colapsar
    return name;
  };

  const advancedToggle = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(ADVANCED_TOGGLE);
  const hideOperationBox = (): HTMLElement | null => document.querySelector<HTMLElement>(HIDE_OPERATION);
  const isChecked = (box: HTMLElement): boolean => box.getAttribute('aria-checked') === 'true';

  /** Se asegura de estar viendo el historial de eventos de la cuenta. */
  const showHistory = async (): Promise<void> => {
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (t) => (t.textContent ?? '').trim() === 'Historial de eventos',
    );
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
      activateTab(tab);
      await waitFor(() => document.querySelector(CARD), 2000);
    }
  };

  /** Busca el nombre de la última persona llamada, mostrando temporalmente las llamadas si están ocultas. */
  const findLastName = async (): Promise<string | null> => {
    let openedPanel = false;
    let uncheckedBox = false;
    try {
      if (phoneCards().length === 0) {
        // Las llamadas están ocultas: se abre "Búsqueda avanzada" y se desmarca "Ocultar operación"
        if (!hideOperationBox()) {
          advancedToggle()?.click();
          openedPanel = true;
          await waitFor(hideOperationBox, 1500);
        }
        const box = hideOperationBox();
        if (box && isChecked(box)) {
          box.click();
          uncheckedBox = true;
        }
        await waitFor(() => (phoneCards().length > 0 ? true : null), 4000);
      }
      const ordered = newestFirst(phoneCards(), (card) => parseEventTimestamp(card.innerText)).slice(0, MAX_CARDS_TO_READ);
      for (const card of ordered) {
        const name = await calledNameOf(card);
        if (name) return name;
      }
      return null;
    } finally {
      // Todo vuelve a como estaba: filtro marcado y panel cerrado
      const box = hideOperationBox();
      if (uncheckedBox && box && !isChecked(box)) box.click();
      if (openedPanel && hideOperationBox()) advancedToggle()?.click();
    }
  };

  return async () => {
    if (running) return;
    running = true;
    try {
      toast('Buscando la última llamada…');
      await showHistory();
      const name = await findLastName();
      if (!name) return toast('No encontré llamadas con nombre en esta cuenta');
      const copied = await copyText(name);
      toast(copied ? `Copiado: ${name}` : `No pude copiar (${name})`);
    } finally {
      running = false;
    }
  };
}
