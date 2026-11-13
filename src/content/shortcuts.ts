/**
 * Atajos de teclado (mundo aislado del content script).
 *
 *   Mantener Alt  muestra los atajos Alt+N (solo mientras se mantiene) y, en una cuenta,
 *                  abre el menú de contactos; al soltar Alt todo se oculta. Un toque
 *                  rápido de Alt no hace nada.
 *   ↑ ↓ ← →       recorren los eventos del panel (la primera flecha marca el primer
 *                  evento de la columna de la izquierda); Enter abre el marcado.
 *   Alt + 1…9      en el panel abre el evento N (columna por columna); en una cuenta:
 *                  llama al contacto de la cuenta en esa posición de la lista
 *                  (1 = el primero), desde cualquier pestaña de la cuenta: usa la
 *                  lista "Contactos de emergencia" si está a la vista y, si no, el
 *                  menú "Llamar a…" del botón flotante. Nunca llama a Jurisdicción / 911.
 *   Ctrl + Enter   acción principal según contexto, en este orden:
 *                    1. llamada en curso      -> cortar
 *                    2. llamada entrante      -> atender
 *                    3. número en el marcador -> llamar
 *                  Sin ninguna de las tres no intercepta nada.
 *
 * Los atajos se muestran dentro de cada componente (junto al botón de llamar de
 * cada contacto, y dentro de "Colgar" / "Atender" / "Llamar"), no flotando encima.
 *
 * Cómo está armado Gavriel (verificado en su código):
 *   - Los contactos están bajo "Contactos de emergencia", ordenados por su campo
 *     `order`; cada uno tiene un botón con aria-label="Llamar".
 *   - Con una llamada en curso el botón "Colgar" solo existe dentro de la pestaña
 *     "Marcador" del softphone; con el panel cerrado hay que abrirlo. El botón
 *     flotante del softphone se pone rojo (bg-destructive) durante la llamada.
 *   - "Atender" también existe en los eventos: la llamada entrante se reconoce
 *     porque su tarjeta dice "Llamada de: <número>" e incluye "Rechazar".
 *
 * Seguridad: ignora teclas repetidas, AltGr (Ctrl+Alt en Windows), combinaciones
 * con Shift/Meta, bloquea llamadas dobles durante 1,5 s, y no llama mientras hay
 * un menú o diálogo modal abierto ni si ya hay una llamada en curso.
 */
import { DEFAULT_SETTINGS } from '../shared/constants';
import { isArrowKey } from '../shared/grid';
import { digitFromKeyCode, isHangupLabel, parseContactName } from '../shared/labels';
import { readSetting, touches } from '../shared/storage';
import { createEventsNav, FOCUS_ATTR } from './events-nav';

declare global {
  interface Window {
    __gvShortcuts?: boolean;
  }
}

type Action = 'hangup' | 'answer' | 'dial';

interface Contact {
  /** Posición en la lista, empezando en 1: es el número del atajo. */
  position: number;
  name: string;
  /** Botón que inicia la llamada a este contacto. */
  button: HTMLButtonElement;
  /** Elemento junto al cual se muestra el indicador "Alt+N". */
  badgeHost: Element;
}

interface BadgeSpec {
  text: string;
  /** 'before': hermano anterior del anfitrión; 'inside': hijo al final del anfitrión. */
  place: 'before' | 'inside';
  /** Solo se ve mientras se mantiene Alt. */
  altOnly: boolean;
  /** Se muestra en la esquina de abajo a la derecha del anfitrión (tarjetas de eventos). */
  corner?: boolean;
}

const SETTING = 'shortcutsEnabled' as const;
const HINT_ATTR = 'data-gv-hint';
/** Atributo de <html> mientras se mantiene Alt: el CSS muestra solo entonces los indicadores Alt+N. */
const ALT_ATTR = 'data-gv-alt';
const LOCK_MS = 1500;
/** Cuánto hay que mantener Alt (sin otra tecla) para que se abra el menú de contactos. */
const PEEK_DELAY_MS = 350;
const MAX_SHORTCUT_CONTACTS = 9;
const CONTACTS_HEADING = /^contactos de emergencia$/i;
const ACCOUNT_CONTACTS_HEADING = /^contactos de la cuenta$/i;
const MENU_TOGGLE = 'button[aria-label="Elegir otro contacto"]';
const DIAL_INPUT = 'input[placeholder="Número…"]';
const FAB_OPEN = 'button[aria-label="Abrir softphone"]';
const FAB_ANY = `${FAB_OPEN}, button[aria-label="Minimizar softphone"]`;
const CALL_BUTTON = 'button[aria-label="Llamar"]';

function main(): void {
  let enabled: boolean = DEFAULT_SETTINGS.shortcutsEnabled;
  let lastCallAt = 0;
  let lastOpenAt = 0;
  let hangingUp = false;
  let callingFromMenu = false;
  let peekTimer: number | undefined;
  let peekOpened = false; // el menú lo abrimos nosotros al mantener Alt

  const root = document.documentElement;

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const visible = (el: Element): boolean =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  /** Texto propio de un elemento, sin contar los indicadores que agregamos nosotros. */
  const ownText = (el: Element): string => {
    let text = '';
    el.childNodes.forEach((node) => {
      if (node instanceof Element && node.hasAttribute(HINT_ATTR)) return;
      text += node.textContent ?? '';
    });
    return text.trim();
  };

  const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button')];

  // ---------- Detección de elementos de la página ----------

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
      // La tarjeta es el ancestro más grande (sin salir de la sección) que sigue
      // conteniendo un único botón de llamar
      let card: HTMLElement = callButton;
      while (
        card.parentElement &&
        card.parentElement !== section &&
        card.parentElement.querySelectorAll(CALL_BUTTON).length === 1
      ) {
        card = card.parentElement;
      }
      contacts.push({
        position: contacts.length + 1,
        name: parseContactName(card.innerText) || 'contacto',
        button: callButton,
        badgeHost: callButton,
      });
    }
    return contacts.slice(0, MAX_SHORTCUT_CONTACTS);
  };

  /**
   * Contactos del menú "Llamar a…" del botón flotante, que existe en todas las
   * pestañas de la cuenta. Es la misma lista y el mismo orden que "Contactos de
   * emergencia" (Gavriel solo descarta los que no tienen teléfono). Un clic en un
   * ítem inicia la llamada y Gavriel cierra el menú solo.
   */
  const findMenuContacts = (): Contact[] => {
    const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find((m) => /Llamar a/.test(m.innerText));
    const heading = menu && [...menu.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.children.length === 0 && ACCOUNT_CONTACTS_HEADING.test(el.textContent?.trim() ?? ''),
    );
    const section = heading?.parentElement;
    if (!section) return [];
    return [...section.querySelectorAll<HTMLButtonElement>('button')]
      .filter(visible)
      .slice(0, MAX_SHORTCUT_CONTACTS)
      .map((button, index) => ({
        position: index + 1,
        name: parseContactName(button.innerText) || 'contacto',
        button,
        badgeHost: button.lastElementChild ?? button, // el teléfono: el indicador va antes
      }));
  };

  /** Contactos que se ven ahora: la lista de la pestaña Contactos o, si no está, el menú abierto. */
  const visibleContacts = (): Contact[] => {
    const listed = findContacts();
    return listed.length > 0 ? listed : findMenuContacts();
  };

  const findHangup = (): HTMLButtonElement | undefined =>
    buttons().find(
      (b) =>
        !b.disabled &&
        visible(b) &&
        [b.getAttribute('aria-label'), b.title, ownText(b)].some((label) => isHangupLabel(label)),
    );

  /** El botón flotante del softphone se pone rojo (bg-destructive) durante una llamada. */
  const callingFab = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>(FAB_ANY)].find((f) => f.classList.contains('bg-destructive'));

  const isCalling = (): boolean => !!findHangup() || !!callingFab();

  /**
   * "Atender" de una llamada entrante. Los eventos también tienen un "Atender":
   * la tarjeta de la llamada es la que tiene "Llamada de: <número>", "Rechazar"
   * y un único "Atender".
   */
  const findAnswer = (): HTMLButtonElement | undefined =>
    buttons().find((b) => {
      if (b.disabled || !visible(b) || ownText(b) !== 'Atender') return false;
      let el: HTMLElement | null = b.parentElement;
      for (let depth = 0; depth < 3 && el && el !== document.body; depth++, el = el.parentElement) {
        const labels = [...el.querySelectorAll('button')].map(ownText);
        if (
          /Llamada de:/.test(el.innerText) &&
          labels.includes('Rechazar') &&
          labels.filter((t) => t === 'Atender').length === 1
        ) {
          return true;
        }
      }
      return false;
    });

  const dialInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>(DIAL_INPUT);

  const dialButtonFor = (input: HTMLElement): HTMLButtonElement | null => {
    let root: HTMLElement | null = input;
    for (let depth = 0; depth < 6 && root; depth++, root = root.parentElement) {
      const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => ownText(b) === 'Llamar');
      if (button) return button;
    }
    return null;
  };

  /** Radix abre el menú o diálogo modal bloqueando los clics del resto de la página. */
  const modalOpen = (): boolean => document.body.style.pointerEvents === 'none';

  // ---------- Aviso breve ----------

  let toastEl: HTMLDivElement | undefined;
  let toastTimer: number | undefined;
  const toast = (message: string): void => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'gv-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('gv-show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl?.classList.remove('gv-show'), 1800);
  };

  // ---------- Eventos del panel (flechas, Enter, Alt+N) ----------

  const events = createEventsNav({ visible, toast });

  /** Teclear en un campo o moverse dentro de un menú/lista/pestañas: las flechas no son nuestras. */
  const ownsArrowKeys = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
    return !!target.closest('[role="menu"], [role="listbox"], [role="tablist"], [role="slider"], [role="dialog"]');
  };

  // ---------- Indicadores dentro de cada componente ----------

  /** Qué haría Ctrl+Enter ahora mismo (null = no interceptar). */
  const plan = (): Action | null => {
    if (isCalling()) return 'hangup';
    if (findAnswer()) return 'answer';
    const input = dialInput();
    if (input && document.activeElement === input && input.value.trim() && dialButtonFor(input)) return 'dial';
    return null;
  };

  const shown = new Map<Element, HTMLElement>(); // anfitrión -> indicador

  const makeBadge = (spec: BadgeSpec): HTMLElement => {
    const badge = document.createElement('kbd');
    badge.className = spec.corner ? 'gv-kbd gv-kbd--corner' : 'gv-kbd';
    badge.setAttribute(HINT_ATTR, '');
    badge.setAttribute('aria-hidden', 'true');
    if (spec.altOnly) badge.setAttribute('data-gv-altonly', '');
    badge.textContent = spec.text;
    return badge;
  };

  const place = (host: Element, badge: HTMLElement, where: BadgeSpec['place']): void => {
    if (where === 'before') host.parentElement?.insertBefore(badge, host);
    else host.append(badge);
  };

  /** Deja exactamente los indicadores que corresponden; no toca el DOM si ya están bien. */
  const decorate = (): void => {
    const wanted = new Map<Element, BadgeSpec>();
    if (enabled) {
      if (events.active()) {
        // Lista de eventos del panel: Alt+N abre el evento N (columna por columna)
        events.numbered().forEach((card, index) => {
          wanted.set(card.el, { text: `Alt+${index + 1}`, place: 'inside', altOnly: true, corner: true });
        });
      } else {
        for (const contact of visibleContacts()) {
          wanted.set(contact.badgeHost, { text: `Alt+${contact.position}`, place: 'before', altOnly: true });
        }
      }
      const action = plan();
      const target =
        action === 'hangup'
          ? findHangup()
          : action === 'answer'
            ? findAnswer()
            : action === 'dial'
              ? dialButtonFor(dialInput()!)
              : null;
      if (target) wanted.set(target, { text: 'Ctrl+Enter', place: 'inside', altOnly: false });
    }

    for (const [host, badge] of shown) {
      if (!wanted.has(host)) {
        badge.remove();
        shown.delete(host);
      }
    }
    for (const [host, spec] of wanted) {
      let badge = shown.get(host);
      if (!badge) {
        badge = makeBadge(spec);
        shown.set(host, badge);
      } else if (badge.textContent !== spec.text) {
        badge.textContent = spec.text;
      }
      if (!badge.isConnected) place(host, badge, spec.place); // React pudo haberlo descartado al re-renderizar
    }
    events.refresh();
  };

  let timer: number | undefined;
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      decorate();
    }, 80);
  };

  // ---------- Acciones ----------

  // ---------- Mantener Alt: ver los contactos ----------

  const menuToggle = (): HTMLButtonElement | null => {
    const toggle = document.querySelector<HTMLButtonElement>(MENU_TOGGLE);
    return toggle && visible(toggle) ? toggle : null;
  };

  const cancelPeekTimer = (): void => {
    clearTimeout(peekTimer);
    peekTimer = undefined;
  };

  /**
   * Al mantener Alt, abre el menú "Llamar a…" para que se vean los contactos con su
   * "Alt+N". Solo si la lista de contactos no está ya a la vista, no hay llamada ni
   * diálogo abierto, y el menú no lo abrió el usuario por su cuenta.
   */
  const openPeek = (): void => {
    peekTimer = undefined;
    const toggle = menuToggle();
    if (!enabled || !toggle || isCalling() || modalOpen() || findContacts().length > 0) return;
    if (toggle.getAttribute('aria-expanded') === 'true') return;
    toggle.click();
    peekOpened = true;
    schedule();
  };

  /** Al soltar Alt: cierra el menú si lo abrimos nosotros. Devuelve true si hizo algo. */
  const closePeek = (): boolean => {
    cancelPeekTimer();
    if (!peekOpened) return false;
    peekOpened = false;
    const toggle = menuToggle();
    if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click(); // si ya se cerró (elegiste un contacto), no
    schedule();
    return true;
  };

  /** Alt+N en la lista de eventos del panel: abre el evento N (con una pausa para no abrir dos). */
  const openEvent = (position: number): void => {
    if (modalOpen()) return toast('Cerrá el menú o diálogo abierto para abrir un evento');
    if (Date.now() - lastOpenAt < LOCK_MS) return;
    lastOpenAt = Date.now();
    events.openNth(position);
  };

  const startCall = (contact: Contact): void => {
    toast(`Llamando a ${contact.name}…`);
    contact.button.click();
  };

  /**
   * Llama al contacto N desde cualquier pestaña de la cuenta. Si la lista de
   * contactos no está a la vista (Gavriel solo dibuja la pestaña activa), usa el
   * menú "Llamar a…" del botón flotante: lo abre, elige el contacto y, si hizo
   * falta abrirlo, lo deja cerrado.
   */
  const callContact = async (position: number): Promise<void> => {
    if (isCalling()) return toast('Ya hay una llamada en curso (Ctrl+Enter para cortar)');
    if (modalOpen()) return toast('Cerrá el menú o diálogo abierto para llamar');
    if (callingFromMenu || Date.now() - lastCallAt < LOCK_MS) return; // evita llamadas dobles

    const listed = findContacts().find((c) => c.position === position);
    if (listed) {
      if (listed.button.disabled) return toast(`No se puede llamar a ${listed.name}`);
      lastCallAt = Date.now();
      return startCall(listed);
    }
    if (findContacts().length > 0) return toast(`No hay contacto ${position} en esta cuenta`);

    const toggle = document.querySelector<HTMLButtonElement>(MENU_TOGGLE);
    if (!toggle || !visible(toggle)) return toast('Abrí una cuenta para llamar a sus contactos');

    callingFromMenu = true;
    try {
      const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
      if (!wasOpen) toggle.click();
      const menuContacts = await waitFor(() => {
        const found = findMenuContacts();
        return found.length > 0 ? found : null;
      }, 700);
      const target = menuContacts?.find((c) => c.position === position);
      if (!target) {
        toast(`No hay contacto ${position} en esta cuenta`);
      } else {
        lastCallAt = Date.now();
        startCall(target); // Gavriel inicia la llamada y cierra el menú
      }
      await sleep(250);
      if (!wasOpen && toggle.getAttribute('aria-expanded') === 'true') toggle.click(); // no lo dejamos abierto
    } finally {
      callingFromMenu = false;
      schedule();
    }
  };

  /** Radix Tabs activa la pestaña con mousedown/foco, no con click. */
  const activateTab = (tab: HTMLElement): void => {
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    tab.focus();
  };

  const waitFor = async <T>(read: () => T | null | undefined, ms: number): Promise<T | null | undefined> => {
    for (let waited = 0; waited < ms; waited += 50) {
      const value = read();
      if (value) return value;
      await sleep(50);
    }
    return read();
  };

  const hangUp = async (): Promise<void> => {
    hangingUp = true;
    try {
      let button = findHangup();
      let openedPanel = false;
      if (!button) {
        // Solo se abre si está cerrado: el botón rojo dice "Abrir softphone".
        // Si ya está abierto (dice "Minimizar"), basta con volver a "Marcador".
        const red = callingFab();
        const fab = red ? (red.matches(FAB_OPEN) ? red : null) : document.querySelector<HTMLButtonElement>(FAB_OPEN);
        if (fab) {
          fab.click();
          openedPanel = true;
        }
        button = (await waitFor(() => {
          const found = findHangup();
          if (found) return found;
          const marcador = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
            (t) => ownText(t) === 'Marcador' && t.getAttribute('aria-selected') === 'false',
          );
          if (marcador) activateTab(marcador);
          return null;
        }, 900)) as HTMLButtonElement | undefined;
      }
      if (!button) return toast('No encontré el botón de colgar');
      toast('Cortando llamada…');
      button.click();
      if (openedPanel) {
        // lo dejamos como estaba: panel minimizado
        await sleep(250);
        document.querySelector<HTMLButtonElement>('button[aria-label="Minimizar softphone"]')?.click();
      }
    } finally {
      hangingUp = false;
      schedule();
    }
  };

  const runPrimary = (action: Action): void => {
    if (action === 'hangup') {
      if (!hangingUp) void hangUp();
    } else if (action === 'answer') {
      toast('Atendiendo llamada…');
      findAnswer()?.click();
    } else {
      const input = dialInput();
      const dial = input && dialButtonFor(input);
      const now = Date.now();
      if (input && dial && !dial.disabled && now - lastCallAt >= LOCK_MS) {
        lastCallAt = now;
        toast(`Llamando a ${input.value.trim()}…`);
        dial.click();
      }
    }
  };

  const consume = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Cualquier otra tecla junto con Alt (Alt+Tab, Alt+←…) no es "mantener Alt"
    if (event.key !== 'Alt') cancelPeekTimer();
    if (!enabled || event.isComposing || event.repeat) return;
    if (event.metaKey || event.shiftKey) return;

    // Mantener Alt solo (sin Ctrl/Shift/Meta): se muestran los indicadores Alt+N y, tras un
    // instante, se abre el menú de contactos
    if (event.key === 'Alt') {
      if (!event.ctrlKey) {
        root.setAttribute(ALT_ATTR, '');
        peekTimer = window.setTimeout(openPeek, PEEK_DELAY_MS);
      }
      return;
    }

    // Alt + dígito (sin Ctrl: en Windows AltGr se reporta como Ctrl+Alt)
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph')) {
      const position = digitFromKeyCode(event.code);
      if (position) {
        consume(event);
        if (events.active()) openEvent(position);
        else void callContact(position);
      }
      return;
    }

    // Flechas, Enter y Escape sobre los eventos del panel (sin ningún modificador)
    if (!event.altKey && !event.ctrlKey) {
      if (events.active() && !modalOpen() && !ownsArrowKeys(event.target)) {
        if (isArrowKey(event.key) && events.move(event.key)) {
          consume(event);
          return;
        }
        // Enter solo abre si el foco está en la tarjeta marcada (no si estás en un botón o campo)
        const onMarkedCard =
          event.target === document.body || (event.target instanceof Element && event.target.hasAttribute(FOCUS_ATTR));
        if (event.key === 'Enter' && events.hasFocus() && onMarkedCard && events.openFocused()) {
          consume(event);
          return;
        }
      }
      if (event.key === 'Escape' && events.hasFocus()) events.clear(); // sin consumir: Gavriel también la usa
    }

    // Ctrl + Enter
    if (event.ctrlKey && !event.altKey && event.key === 'Enter') {
      const action = plan();
      if (action) {
        consume(event);
        runPrimary(action);
      }
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt') return;
    root.removeAttribute(ALT_ATTR); // se ocultan los indicadores Alt+N
    // preventDefault evita que Windows/Chrome le den foco a su menú al soltar Alt
    if (closePeek()) event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => {
    // Alt+Tab: se pierde el keyup
    root.removeAttribute(ALT_ATTR);
    void closePeek();
  });
  // Si usás el mouse, la marca del teclado ya no tiene sentido
  document.addEventListener('pointerdown', () => events.clear(), true);

  // ---------- Estado e inicio ----------

  void readSetting(SETTING).then((value) => {
    enabled = value;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (touches(changes, area, SETTING)) {
      void readSetting(SETTING).then((value) => {
        enabled = value;
        if (!enabled) {
          root.removeAttribute(ALT_ATTR);
          events.clear();
          closePeek();
        }
        schedule();
      });
    }
  });

  const start = (): void => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', schedule);
    document.addEventListener('input', schedule);
    window.addEventListener('resize', schedule);
    setInterval(schedule, 1000);
    schedule();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}

if (!window.__gvShortcuts) {
  window.__gvShortcuts = true;
  main();
}
