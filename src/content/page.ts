/**
 * Lectura de la pantalla de Gavriel (mundo aislado): dónde están los contactos, el botón de colgar, «Atender», «Cerrar
 * intervención», el marcador, y si hay un diálogo o menú abierto. Solo lee el DOM, no cambia nada.
 *
 * Cómo está armado Gavriel (verificado en su código):
 *   - Los contactos están bajo "Contactos de emergencia", ordenados por su campo `order`; cada uno tiene un botón con
 *     aria-label="Llamar".
 *   - Con una llamada en curso el botón "Colgar" solo existe dentro de la pestaña "Marcador" del softphone; con el panel
 *     cerrado hay que abrirlo. El botón flotante del softphone se pone rojo (bg-destructive) durante la llamada.
 *   - "Atender" también existe en los eventos: la llamada entrante se reconoce porque su tarjeta dice
 *     "Llamada de: <número>" e incluye "Rechazar".
 *
 * Foto por pasada: `snapshot(fn)` consulta los botones de la página UNA vez y todas las búsquedas de `fn` la comparten
 * (antes cada búsqueda recorría todos los botones). Solo se usa en el repintado, que no cambia la página mientras corre;
 * en los atajos de teclado, donde un clic puede cambiar el DOM al instante, cada búsqueda lee la página de nuevo.
 */
import { isHangupLabel, parseContactName } from '../shared/labels';
import { accountIdFromLocation } from '../shared/routes';

export interface Contact {
  /** Posición en la lista, empezando en 1: es el número del atajo. */
  position: number;
  name: string;
  /** Botón que inicia la llamada a este contacto. */
  button: HTMLButtonElement;
  /** Elemento junto al cual se muestra el indicador "Alt+N". */
  badgeHost: Element;
  /** Tarjeta del contacto (en el menú, el propio botón). */
  card: HTMLElement;
  /** Título «Contactos de emergencia» (solo en la lista de la pestaña). */
  heading?: HTMLElement;
}

export const HINT_ATTR = 'data-gv-hint';
/** Contactos que se leen de la lista (la ronda los usa todos; solo los primeros 9 tienen un Alt+N). */
export const MAX_CONTACTS = 20;
const CONTACTS_HEADING = /^contactos de emergencia$/i;
const ACCOUNT_CONTACTS_HEADING = /^contactos de la cuenta$/i;
export const MENU_TOGGLE = 'button[aria-label="Elegir otro contacto"]';
const DIAL_INPUT = 'input[placeholder="Número…"]';
export const FAB_OPEN = 'button[aria-label="Abrir softphone"]';
const FAB_ANY = `${FAB_OPEN}, button[aria-label="Minimizar softphone"]`;
const CALL_BUTTON = 'button[aria-label="Llamar"]';
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export const visible = (el: Element): boolean => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** Texto propio de un elemento, sin contar los indicadores que agregamos nosotros. */
export const ownText = (el: Element): string => {
  let text = '';
  el.childNodes.forEach((node) => {
    if (node instanceof Element && node.hasAttribute(HINT_ATTR)) return;
    text += node.textContent ?? '';
  });
  return text.trim();
};

/** ¿El foco está escribiendo en un campo? */
export const isEditable = (el: EventTarget | null): boolean => el instanceof Element && !!el.closest(EDITABLE);

/**
 * Las flechas no son nuestras si estás escribiendo en un campo, dentro de un menú o lista desplegada, o sobre un control
 * que las usa (pestaña, deslizador, opción…). Los diálogos modales se detectan aparte (modalOpen).
 */
export const ownsArrowKeys = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (isEditable(target)) return true;
  if (target.closest('[role="menu"], [role="listbox"]')) return true;
  return !!target.closest('[role="tab"], [role="slider"], [role="option"], [role="menuitem"], [role="combobox"], [role="radio"]');
};

/** Radix abre el menú o diálogo modal bloqueando los clics del resto de la página. */
export const modalOpen = (): boolean => document.body.style.pointerEvents === 'none';
export const dialogOpen = (): boolean => modalOpen() || document.querySelector('[data-slot="dialog-content"], [role="alertdialog"]') !== null;

export function createPage() {
  let snap: HTMLButtonElement[] | undefined;

  const buttons = (): HTMLButtonElement[] => snap ?? [...document.querySelectorAll<HTMLButtonElement>('button')];

  /** Ejecuta `fn` con una única lectura de los botones de la página (ver el encabezado). */
  const snapshot = <T>(fn: () => T): T => {
    snap = [...document.querySelectorAll<HTMLButtonElement>('button')];
    try {
      return fn();
    } finally {
      snap = undefined;
    }
  };

  /** Contactos de la cuenta, en el orden en que se ven (sin Jurisdicción ni 911). */
  const findContacts = (): Contact[] => {
    const heading = [...document.querySelectorAll<HTMLElement>('p, h2, h3, h4')].find(
      (el) => el.children.length === 0 && CONTACTS_HEADING.test(el.textContent?.trim() ?? '') && visible(el),
    );
    const section = heading?.parentElement;
    if (!section) return [];

    const contacts: Contact[] = [];
    for (const callButton of section.querySelectorAll<HTMLButtonElement>(CALL_BUTTON)) {
      if (!visible(callButton)) continue;
      // La tarjeta es el ancestro más grande (sin salir de la sección) que sigue conteniendo un único botón de llamar
      let card: HTMLElement = callButton;
      while (card.parentElement && card.parentElement !== section && card.parentElement.querySelectorAll(CALL_BUTTON).length === 1) {
        card = card.parentElement;
      }
      contacts.push({
        position: contacts.length + 1,
        name: parseContactName(card.innerText) || 'contacto',
        button: callButton,
        badgeHost: callButton,
        card,
        heading,
      });
    }
    return contacts.slice(0, MAX_CONTACTS);
  };

  /**
   * Contactos del menú "Llamar a…" del botón flotante, que existe en todas las pestañas de la cuenta. Es la misma lista y el
   * mismo orden que "Contactos de emergencia" (Gavriel solo descarta los que no tienen teléfono). Un clic en un ítem inicia
   * la llamada y Gavriel cierra el menú solo.
   */
  const findMenuContacts = (): Contact[] => {
    const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find((m) => /Llamar a/.test(m.innerText));
    const heading =
      menu &&
      [...menu.querySelectorAll<HTMLElement>('div')].find((el) => el.children.length === 0 && ACCOUNT_CONTACTS_HEADING.test(el.textContent?.trim() ?? ''));
    const section = heading?.parentElement;
    if (!section) return [];
    return [...section.querySelectorAll<HTMLButtonElement>('button')]
      .filter(visible)
      .slice(0, MAX_CONTACTS)
      .map((button, index) => ({
        position: index + 1,
        name: parseContactName(button.innerText) || 'contacto',
        button,
        badgeHost: button.lastElementChild ?? button, // el teléfono: el indicador va antes
        card: button,
      }));
  };

  /** Contactos que se ven ahora: la lista de la pestaña Contactos o, si no está, el menú abierto. */
  const visibleContacts = (): Contact[] => {
    const listed = findContacts();
    return listed.length > 0 ? listed : findMenuContacts();
  };

  const findHangup = (): HTMLButtonElement | undefined =>
    buttons().find((b) => !b.disabled && [b.getAttribute('aria-label'), b.title, ownText(b)].some((label) => isHangupLabel(label)) && visible(b));

  /** El botón flotante del softphone se pone rojo (bg-destructive) durante una llamada. */
  const callingFab = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>(FAB_ANY)].find((f) => f.classList.contains('bg-destructive'));

  const isCalling = (): boolean => !!findHangup() || !!callingFab();

  /**
   * "Atender" de una llamada entrante. Los eventos también tienen un "Atender": la tarjeta de la llamada es la que tiene
   * "Llamada de: <número>", "Rechazar" y un único "Atender".
   */
  const findAnswer = (): HTMLButtonElement | undefined =>
    buttons().find((b) => {
      if (b.disabled || ownText(b) !== 'Atender' || !visible(b)) return false;
      let el: HTMLElement | null = b.parentElement;
      for (let depth = 0; depth < 3 && el && el !== document.body; depth++, el = el.parentElement) {
        const labels = [...el.querySelectorAll('button')].map(ownText);
        if (/Llamada de:/.test(el.innerText) && labels.includes('Rechazar') && labels.filter((t) => t === 'Atender').length === 1) return true;
      }
      return false;
    });

  /** Botón "Cerrar intervención" de la cuenta (abre un formulario: no cierra nada por sí solo). */
  const findCloseIntervention = (): HTMLButtonElement | undefined =>
    buttons().find((b) => !b.disabled && ownText(b) === 'Cerrar intervención' && visible(b));

  /** «Volver a panel» de la cuenta (a veces solo con el ícono: se reconoce por su aria-label). */
  const backButton = (): HTMLButtonElement | null => {
    const b = document.querySelector<HTMLButtonElement>('button[aria-label="Volver a panel"]');
    return b && !b.disabled && visible(b) ? b : null;
  };

  const goBack = (): boolean => {
    const button = backButton();
    button?.click();
    return button !== null;
  };

  /** Esc vuelve al panel desde una cuenta, salvo que esté escribiendo, haya un menú o diálogo, o pantalla completa. */
  const canGoBack = (target: EventTarget | null): boolean =>
    !!accountIdFromLocation(location.pathname, location.search) &&
    !modalOpen() &&
    !dialogOpen() &&
    !document.fullscreenElement &&
    !isEditable(target) &&
    !(target instanceof Element && target.closest('[role="menu"], [role="listbox"], [role="combobox"]')) &&
    backButton() !== null;

  const dialInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>(DIAL_INPUT);

  const dialButtonFor = (input: HTMLElement): HTMLButtonElement | null => {
    let root: HTMLElement | null = input;
    for (let depth = 0; depth < 6 && root; depth++, root = root.parentElement) {
      const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => ownText(b) === 'Llamar');
      if (button) return button;
    }
    return null;
  };

  const menuToggle = (): HTMLButtonElement | null => {
    const toggle = document.querySelector<HTMLButtonElement>(MENU_TOGGLE);
    return toggle && visible(toggle) ? toggle : null;
  };

  return {
    snapshot,
    buttons,
    findContacts,
    findMenuContacts,
    visibleContacts,
    findHangup,
    callingFab,
    isCalling,
    findAnswer,
    findCloseIntervention,
    backButton,
    goBack,
    canGoBack,
    dialInput,
    dialButtonFor,
    menuToggle,
  };
}

export type Page = ReturnType<typeof createPage>;
