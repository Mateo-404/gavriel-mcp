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
 *   Alt + Shift    en una cuenta: copia el nombre de la última persona a la que se llamó
 *                  (ver last-contact.ts); sin tocar nada, deja los filtros como estaban.
 *   Alt + Enter    en una cuenta: siguiente contacto de la ronda de llamadas (corta la llamada en curso);
 *                  ver call-round.ts. Alt+N sigue llamando a mano sin mover la ronda.
 *   Alt + M        durante una llamada: silencia o reactiva el micrófono (botón en call-mute.ts)
 *   Ctrl + Enter   acción principal según contexto, en este orden:
 *                    1. llamada en curso      -> cortar
 *                    2. llamada entrante      -> atender
 *                    3. número en el marcador -> llamar
 *                    4. cuenta intervenida    -> "Cerrar intervención": abre el formulario con
 *                       el cursor en "Resolución" (confirmar sigue siendo manual)
 *                  Sin ninguna de las cuatro no intercepta nada (ni escribiendo en un campo).
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
import { sanitizeTabs } from '../shared/media';
import { digitFromKeyCode, filterFromLetterCode, isHangupLabel, parseContactName, shiftedDigit } from '../shared/labels';
import { readSetting, readSettings, touches } from '../shared/storage';
import { accountIdFromLocation } from '../shared/routes';
import { createEventsNav, FOCUS_ATTR } from './events-nav';
import { createCallCard } from './call-card';
import { createCallMute } from './call-mute';
import { createCallRound } from './call-round';
import { plainDigit, typeDigit } from './dial-input';
import { createClientCopy } from './client-copy';
import { createAlertSender } from './alerts';
import { createDataStore } from './data-store';
import { createDialogConfirm, retryFor, watchInterventionEnd, whenDialogGone } from './dialog-confirm';
import { createMediaBar } from './media-bar';
import { createLastContact } from './last-contact';
import { createPanelActions } from './panel-actions';
import { createSipClient } from './sip';
import { guard, watchDom } from './runtime';

declare global {
  interface Window {
    __gvShortcuts?: boolean;
  }
}

type Action = 'confirm' | 'hangup' | 'answer' | 'dial' | 'bulk' | 'close';

interface Contact {
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
const TEXT_ATTR = 'data-gv-text';
/** Letra de cada filtro (ver FILTER_LETTER_CODES): la etiqueta que se muestra. */
const FILTER_KEYS = ['Q', 'W', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
/** Atributo de <html> mientras se mantiene Alt: el CSS muestra solo entonces los indicadores Alt+N. */
const ALT_ATTR = 'data-gv-alt';
const LOCK_MS = 1500;
/** Pausa entre cortar una llamada y marcar al siguiente de la ronda. */
const ROUND_PAUSE_MS = 5000;
/** Cuánto hay que mantener Alt (sin otra tecla) para que se abra el menú de contactos. */
const PEEK_DELAY_MS = 350;
/** Contactos que se leen de la lista (la ronda los usa todos; solo los primeros 9 tienen un Alt+N). */
const MAX_CONTACTS = 20;
const MAX_SHORTCUT_DIGIT = 9;
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
  let closing = false;
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
        card,
        heading,
      });
    }
    return contacts.slice(0, MAX_CONTACTS);
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
    buttons().find(
      (b) =>
        !b.disabled &&
        [b.getAttribute('aria-label'), b.title, ownText(b)].some((label) => isHangupLabel(label)) &&
        visible(b),
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
      if (b.disabled || ownText(b) !== 'Atender' || !visible(b)) return false;
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

  /** Radix abre el menú o diálogo modal bloqueando los clics del resto de la página. */
  const modalOpen = (): boolean => document.body.style.pointerEvents === 'none';
  const dialogOpen = (): boolean => modalOpen() || document.querySelector('[data-slot="dialog-content"], [role="alertdialog"]') !== null;

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
  // Eventos nuevos (de los tipos elegidos en Ajustes) -> notificación del navegador, desde el fondo
  const sendAlerts = createAlertSender({
    settings: readSettings,
    send: (message) => {
      try {
        void chrome.runtime.sendMessage(message).catch(() => {});
      } catch {
        /* contexto invalidado: ya no hay a quién avisar */
      }
    },
  });
  const dataStore = createDataStore((alerts) => void sendAlerts(alerts));
  const currentAccountId = (): string | null => accountIdFromLocation(location.pathname, location.search);
  const copyLastContact = createLastContact({
    visible,
    toast,
    known: () => {
      const id = currentAccountId();
      return id ? dataStore.lastCalledName(id) : null;
    },
  });
  const callCard = createCallCard({
    isCalling,
    visible,
    onCallStart: (contact) => {
      const id = currentAccountId();
      if (id) dataStore.recordLocalCall(id, contact.name);
    },
  });
  const panel = createPanelActions({ visible, ownText });
  const dialogConfirm = createDialogConfirm({ visible, ownText, toast });
  const sip = createSipClient();
  const callMute = createCallMute({ sip, toast });
  let roundOn: boolean = DEFAULT_SETTINGS.callRound;
  const round = createCallRound({ isCalling, accountId: currentAccountId, repaint: () => schedule() });
  // Al cerrar la intervención (o dejarla en observación) la ronda de esa cuenta vuelve a cero
  // Y se vuelve a lo que sigue: cierre masivo → «Limpiar filtros»; cierre de un evento → «Volver a panel»
  watchInterventionEnd((_bulk, kind, dialog) => {
    // La ronda se conserva hasta que la intervención de verdad se cierra (el diálogo se cierra al aplicar
    // resolución y categoría); «Dejar en observación» no la toca
    const id = currentAccountId();
    if (kind === 'bulk') {
      whenDialogGone(dialog, () => {
        round.forget(true);
        retryFor(() => panel.clearFilters());
      });
    } else if (kind === 'close') {
      whenDialogGone(dialog, () => {
        round.forget(false, id);
        retryFor(goBack);
      });
    }
  });

  // Reproductor de Spotify Web / YouTube Music en la barra de arriba (ver media-bar.ts)
  const mediaBar = createMediaBar({
    send: (message) => {
      try {
        void chrome.runtime.sendMessage(message).catch(() => {});
      } catch {
        /* contexto invalidado */
      }
    },
  });
  // Deja a la vista en <html> cuántas pestañas de música se conocen (o el error), para diagnosticar
  const showMedia = (raw: unknown): void => {
    try {
      const tabs = sanitizeTabs(raw);
      mediaBar.update(tabs);
      root.setAttribute('data-gv-media', String(tabs.length));
    } catch (error) {
      root.setAttribute('data-gv-media', `error: ${String(error)}`);
    }
  };
  try {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const m = message as { type?: string; tabs?: unknown } | null;
      if (m?.type === 'media-update') showMedia(m.tabs);
      return false;
    });
    void chrome.runtime
      .sendMessage({ type: 'media-get' })
      .then((answer: { tabs?: unknown } | undefined) => showMedia(answer?.tabs))
      .catch(() => {});
  } catch {
    /* contexto invalidado */
  }
  void readSetting('mediaPlayer').then((on) => mediaBar.setEnabled(on));
  const copyClientMessage = createClientCopy({
    visible,
    toast,
    known: () => {
      const id = currentAccountId();
      return id ? dataStore.clientMessage(id) : null;
    },
  });

  const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  /** ¿El foco está escribiendo en un campo? */
  const isEditable = (el: EventTarget | null): boolean => el instanceof Element && !!el.closest(EDITABLE);

  /**
   * Las flechas no son nuestras si estás escribiendo en un campo, dentro de un menú o lista
   * desplegada, o sobre un control que las usa (pestaña, deslizador, opción…). Los diálogos
   * modales se detectan aparte (modalOpen), no por el rol de un ancestro.
   */
  const ownsArrowKeys = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (isEditable(target)) return true;
    if (target.closest('[role="menu"], [role="listbox"]')) return true;
    return !!target.closest('[role="tab"], [role="slider"], [role="option"], [role="menuitem"], [role="combobox"], [role="radio"]');
  };

  // ---------- Indicadores dentro de cada componente ----------

  /** Qué haría Ctrl+Enter ahora mismo (null = no interceptar). */
  const plan = (): Action | null => {
    // Con un diálogo abierto, Ctrl+Enter es de ese diálogo (confirmar), antes que cualquier otra cosa
    if (dialogConfirm.primary()) return 'confirm';
    if (isCalling()) return 'hangup';
    if (findAnswer()) return 'answer';
    const input = dialInput();
    if (input && document.activeElement === input && input.value.trim() && dialButtonFor(input)) return 'dial';
    // En el panel con un filtro activo: «Procesar masivo»
    if (events.active() && !isEditable(document.activeElement) && !modalOpen() && panel.bulkButton()) return 'bulk';
    // Sin llamada que atender, cortar ni marcar: en una cuenta intervenida, abre "Cerrar intervención".
    // Nunca mientras escribís en un campo ni con un diálogo abierto (podría ser el Ctrl+Enter de otro formulario).
    if (!isEditable(document.activeElement) && !modalOpen() && findCloseIntervention()) return 'close';
    return null;
  };

  const shown = new Map<Element, HTMLElement>(); // anfitrión -> indicador

  const makeBadge = (spec: BadgeSpec): HTMLElement => {
    const badge = document.createElement('kbd');
    badge.className = spec.corner ? 'gv-kbd gv-kbd--corner' : 'gv-kbd';
    badge.setAttribute(HINT_ATTR, '');
    badge.setAttribute('aria-hidden', 'true');
    if (spec.altOnly) badge.setAttribute('data-gv-altonly', '');
    // El texto va en un atributo y lo dibuja el CSS (::after): así el botón que lo contiene conserva
    // exactamente su texto y otras herramientas (macros con XPath, lectores) no ven nada nuevo
    badge.setAttribute(TEXT_ATTR, spec.text);
    return badge;
  };

  const place = (host: Element, badge: HTMLElement, where: BadgeSpec['place']): void => {
    if (where === 'before') host.parentElement?.insertBefore(badge, host);
    else host.append(badge);
  };

  /** Deja exactamente los indicadores que corresponden; no toca el DOM si ya están bien. */
  /** Con un diálogo abierto solo se mantienen los indicadores de sus botones: principal (Ctrl+Enter) y salir (Esc). */
  const dialogBadgeHosts = new Map<Element, string>();
  const syncDialogBadge = (): void => {
    const wantedNow = new Map<Element, string>();
    if (enabled) {
      const main = dialogConfirm.primary();
      const out = dialogConfirm.dismissButton();
      if (main) wantedNow.set(main, 'Ctrl+Enter');
      if (out) wantedNow.set(out, 'Esc');
    }
    for (const host of [...dialogBadgeHosts.keys()]) {
      if (wantedNow.get(host) === dialogBadgeHosts.get(host)) continue;
      shown.get(host)?.remove();
      shown.delete(host);
      dialogBadgeHosts.delete(host);
    }
    for (const [host, text] of wantedNow) {
      let badge = shown.get(host);
      if (!badge) {
        badge = makeBadge({ text, place: 'inside', altOnly: false });
        shown.set(host, badge);
      }
      if (!badge.isConnected) place(host, badge, 'inside');
      dialogBadgeHosts.set(host, text);
    }
  };

  /** Tildes, colores y barra de la ronda sobre «Contactos de emergencia» (no en el panel ni con un diálogo abierto). */
  const paintRound = (): void => {
    const listed = enabled && roundOn && !events.active() ? findContacts() : [];
    round.paint(
      listed.map((c) => ({ name: c.name, button: c.button, card: c.card })),
      listed[0]?.heading ?? null,
    );
  };

  const decorate = guard('indicadores', (): void => {
    mediaBar.ensureMounted(); // la barra de arriba se redibuja con la pantalla: se vuelve a ubicar el reproductor
    // Con un diálogo abierto no hay nada que indicar y escribir ahí dispara muchos cambios: no se toca el DOM
    if (dialogOpen()) {
      syncDialogBadge();
      callCard.update();
      return;
    }
    const wanted = new Map<Element, BadgeSpec>();
    if (enabled) {
      if (events.active()) {
        // Lista de eventos del panel: Alt+N abre el evento N (columna por columna)
        events.numbered().forEach((card, index) => {
          wanted.set(card.el, { text: `Alt+${index + 1}`, place: 'inside', altOnly: true, corner: true });
        });
      } else {
        for (const contact of visibleContacts()) {
          if (contact.position > MAX_SHORTCUT_DIGIT) continue;
          wanted.set(contact.badgeHost, { text: `Alt+${contact.position}`, place: 'before', altOnly: true });
        }
      }
      if (events.active()) {
        panel.filters().forEach((chip, index) => {
          wanted.set(chip, { text: `Alt+⇧${index + 1} · Alt+${FILTER_KEYS[index]}`, place: 'inside', altOnly: true });
        });
        const clear = panel.clearButton();
        if (clear && !modalOpen()) wanted.set(clear, { text: 'Esc', place: 'inside', altOnly: false });
      }
      const back = accountIdFromLocation(location.pathname, location.search) ? backButton() : null;
      if (back && !modalOpen()) wanted.set(back, { text: 'Esc', place: 'inside', altOnly: false });
      const action = plan();
      const target =
        action === 'confirm'
          ? dialogConfirm.primary()
          : action === 'hangup'
          ? findHangup()
          : action === 'answer'
            ? findAnswer()
            : action === 'dial'
              ? dialButtonFor(dialInput()!)
              : action === 'bulk'
                ? panel.bulkButton()
                : action === 'close'
                  ? findCloseIntervention()
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
      } else if (badge.getAttribute(TEXT_ATTR) !== spec.text) {
        badge.setAttribute(TEXT_ATTR, spec.text);
      }
      if (!badge.isConnected) place(host, badge, spec.place); // React pudo haberlo descartado al re-renderizar
    }
    events.refresh();
    callCard.update();
    callMute.update(isCalling());
    paintRound();
  });

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
  const callContact = async (position: number): Promise<boolean> => {
    const refuse = (message: string): boolean => {
      toast(message);
      return false;
    };
    if (isCalling()) return refuse('Ya hay una llamada en curso (Ctrl+Enter para cortar)');
    if (modalOpen()) return refuse('Cerrá el menú o diálogo abierto para llamar');
    if (callingFromMenu || Date.now() - lastCallAt < LOCK_MS) return false; // evita llamadas dobles

    const listed = findContacts().find((c) => c.position === position);
    if (listed) {
      if (listed.button.disabled) return refuse(`No se puede llamar a ${listed.name}`);
      lastCallAt = Date.now();
      startCall(listed);
      return true;
    }
    if (findContacts().length > 0) return refuse(`No hay contacto ${position} en esta cuenta`);

    const toggle = document.querySelector<HTMLButtonElement>(MENU_TOGGLE);
    if (!toggle || !visible(toggle)) return refuse('Abrí una cuenta para llamar a sus contactos');

    let started = false;
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
        started = true;
      }
      await sleep(250);
      if (!wasOpen && toggle.getAttribute('aria-expanded') === 'true') toggle.click(); // no lo dejamos abierto
    } finally {
      callingFromMenu = false;
      schedule();
    }
    return started;
  };

  /**
   * Alt+Enter: siguiente contacto de la ronda. Con una llamada en curso, la corta primero. Solo cuenta
   * una llamada si de verdad arrancó (si Gavriel no dejó llamar, el contacto sigue pendiente).
   */
  let roundBusy = false;
  const roundNext = async (): Promise<void> => {
    if (roundBusy) return;
    if (!currentAccountId()) return toast('Abrí una cuenta para llamar a sus contactos');
    if (modalOpen()) return toast('Cerrá el menú o diálogo abierto para llamar');
    roundBusy = true;
    try {
      if (isCalling()) {
        toast('Cortando la llamada…');
        if (!(await sip.run('hangup'))) await hangUp();
        if (!(await waitFor(() => (isCalling() ? null : true), 3000))) return toast('No se pudo cortar la llamada');
        for (let left = Math.ceil(ROUND_PAUSE_MS / 1000); left > 0; left--) {
          toast(`Llamo al siguiente en ${left} s…`);
          await sleep(1000);
        }
      }
      const pick = round.peek(findContacts().map((c) => ({ name: c.name, button: c.button, card: c.card })));
      if ('message' in pick) return toast(pick.message);
      lastCallAt = 0; // el bloqueo de llamadas dobles no aplica: la ronda ya cortó la anterior
      if (await callContact(pick.position)) round.commit(pick.position, pick.round);
    } finally {
      roundBusy = false;
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

  /**
   * Abre el formulario de "Cerrar intervención" y deja el cursor listo en "Resolución".
   * El formulario es un diálogo de Radix: al abrirse manda el foco al primer control (el
   * selector de Categoría, id="category"), así que se espera a que aparezca el textarea
   * (id="resolution") y se lo enfoca. Confirmar sigue siendo manual: el botón queda
   * deshabilitado hasta completar Categoría y Resolución.
   */
  const openCloseIntervention = async (): Promise<void> => {
    const button = findCloseIntervention();
    if (!button) return;
    closing = true;
    try {
      toast('Cerrar intervención: escribí la resolución');
      button.click();
      const area = await waitFor(() => {
        const field = document.getElementById('resolution');
        return field instanceof HTMLTextAreaElement && visible(field) ? field : null;
      }, 2000);
      if (!area) return;
      // Radix enfoca Categoría al abrir; se enfoca Resolución después y se vuelve a comprobar
      for (const pause of [150, 300]) {
        await sleep(pause);
        if (document.activeElement !== area) area.focus();
      }
    } finally {
      closing = false;
      schedule();
    }
  };

  const runPrimary = (action: Action): void => {
    if (action === 'confirm') {
      dialogConfirm.confirm();
    } else if (action === 'hangup') {
      if (hangingUp) return;
      // Primero se llama a hangup() del softphone (lo mismo que hace «Colgar», sin abrir panel ni pestañas);
      // si no se lo encuentra, se hace el recorrido por la interfaz de siempre
      hangingUp = true;
      void sip.run('hangup').then((direct) => {
        hangingUp = false;
        if (direct) {
          toast('Llamada cortada');
          schedule();
        } else {
          void hangUp();
        }
      });
    } else if (action === 'bulk') {
      toast('Procesar masivo: escribí el motivo');
      void panel.openBulk();
    } else if (action === 'close') {
      if (!closing) void openCloseIntervention();
    } else if (action === 'answer') {
      void sip.run('answer').then((direct) => {
        toast('Atendiendo llamada…');
        if (!direct) findAnswer()?.click();
        schedule();
      });
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

  const onKeyDown = guard('teclado', (event: KeyboardEvent): void => {
    // Cualquier otra tecla junto con Alt (Alt+Tab, Alt+←…) no es "mantener Alt"
    if (event.key !== 'Alt') cancelPeekTimer();
    if (!enabled || event.isComposing || event.repeat) return;
    if (event.metaKey) return;

    // Softphone abierto: los números van al campo «Número…» aunque no esté enfocado (solo dígitos)
    const digit = plainDigit(event);
    if (digit) {
      const input = dialInput();
      if (input && visible(input) && !isEditable(event.target) && !modalOpen() && document.activeElement !== input) {
        consume(event);
        typeDigit(input, digit);
      }
      return;
    }

    // Alt + Shift apretados juntos (sin otra tecla), en una cuenta: copia el nombre de la última
    // persona a la que se llamó. No se consume la tecla: el sistema puede usar Alt+Shift para
    // cambiar de idioma del teclado y eso no se puede impedir desde una página.
    if (!event.ctrlKey && ((event.key === 'Shift' && event.altKey) || (event.key === 'Alt' && event.shiftKey))) {
      if (accountIdFromLocation(location.pathname, location.search)) void copyLastContact();
      return;
    }

    // Flechas sobre los eventos del panel, con o sin Shift (por si otra cosa del navegador se queda
    // con las flechas solas). Escribiendo en un campo o dentro de un menú no son nuestras.
    if (!event.altKey && !event.ctrlKey && isArrowKey(event.key)) {
      if (events.active() && !modalOpen() && !ownsArrowKeys(event.target) && events.move(event.key)) consume(event);
      return;
    }
    // Alt + Shift + N: activa o desactiva el filtro N por tipo de evento (en el panel)
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.getModifierState('AltGraph')) {
      const position = shiftedDigit(event.code, event.key);
      if (position && events.active()) {
        consume(event);
        if (modalOpen()) toast('Cerrá el menú o diálogo abierto para filtrar');
        else if (!panel.toggleFilter(position)) toast(`No hay filtro ${position}`);
      }
      return;
    }
    if (event.shiftKey) return;

    // Alt + Q/W/R/T/Y/U/I/O/P: lo mismo que Alt+Shift+1…9 (para teclados donde Alt+Shift cambia el idioma)
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph')) {
      const letter = filterFromLetterCode(event.code);
      if (letter && events.active() && !isEditable(event.target)) {
        consume(event);
        if (modalOpen()) toast('Cerrá el menú o diálogo abierto para filtrar');
        else if (!panel.toggleFilter(letter)) toast(`No hay filtro ${letter}`);
        return;
      }
    }

    // Mantener Alt solo (sin Ctrl/Shift/Meta): se muestran los indicadores Alt+N y, tras un
    // instante, se abre el menú de contactos
    if (event.key === 'Alt') {
      if (!event.ctrlKey) {
        root.setAttribute(ALT_ATTR, '');
        peekTimer = window.setTimeout(openPeek, PEEK_DELAY_MS);
      }
      return;
    }

    // Alt + C en una cuenta: copia «Estimado/a cliente» + nombre y dirección de la cuenta
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph') && event.code === 'KeyC') {
      if (accountIdFromLocation(location.pathname, location.search)) {
        consume(event);
        void copyClientMessage();
      }
      return;
    }

    // Alt + M durante una llamada: silenciar o reactivar el micrófono (fuera de una llamada no se intercepta)
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph') && event.code === 'KeyM' && isCalling()) {
      consume(event);
      void callMute.toggle();
      return;
    }

    // Alt + Enter en una cuenta: siguiente contacto de la ronda de llamadas
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph') && event.key === 'Enter') {
      if (roundOn && currentAccountId()) {
        consume(event);
        void roundNext();
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

    // Enter y Escape sobre los eventos del panel (sin ningún modificador)
    if (!event.altKey && !event.ctrlKey) {
      // Enter solo abre si el foco está en la tarjeta marcada (no si estás en un botón o campo)
      const onMarkedCard =
        event.target === document.body || (event.target instanceof Element && event.target.hasAttribute(FOCUS_ATTR));
      if (
        event.key === 'Enter' &&
        events.active() &&
        !modalOpen() &&
        events.hasFocus() &&
        onMarkedCard &&
        events.openFocused()
      ) {
        consume(event);
        return;
      }
      if (event.key === 'Escape' && dialogOpen()) {
        // Esc en un diálogo = su botón de salida («Cancelar»); si no tiene, Radix lo cierra solo
        if (dialogConfirm.dismiss()) consume(event);
      } else if (event.key === 'Escape') {
        if (events.hasFocus()) events.clear(); // sin consumir: Gavriel también la usa
        else if (events.active() && !modalOpen() && !isEditable(event.target) && panel.clearFilters()) consume(event);
        else if (canGoBack(event.target)) {
          consume(event);
          backButton()?.click();
        }
      }
    }

    // Ctrl + Enter
    if (event.ctrlKey && !event.altKey && event.key === 'Enter') {
      const action = plan();
      if (action) {
        consume(event);
        runPrimary(action);
      }
    }
  });

  const onKeyUp = guard('teclado', (event: KeyboardEvent): void => {
    if (event.key !== 'Alt') return;
    root.removeAttribute(ALT_ATTR); // se ocultan los indicadores Alt+N
    // preventDefault evita que Windows/Chrome le den foco a su menú al soltar Alt
    if (closePeek()) event.preventDefault();
  });

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
  void readSetting('showCallCard').then((value) => callCard.setEnabled(value));
  void readSetting('callRound').then((value) => {
    roundOn = value;
    round.setEnabled(roundOn && enabled);
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (touches(changes, area, 'showCallCard')) void readSetting('showCallCard').then((v) => callCard.setEnabled(v));
    if (touches(changes, area, 'mediaPlayer')) void readSetting('mediaPlayer').then((v) => mediaBar.setEnabled(v));
    if (touches(changes, area, 'callRound')) {
      void readSetting('callRound').then((v) => {
        roundOn = v;
        round.setEnabled(roundOn && enabled);
        schedule();
      });
    }
    if (touches(changes, area, SETTING)) {
      void readSetting(SETTING).then((value) => {
        enabled = value;
        round.setEnabled(roundOn && enabled);
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
    watchDom(decorate, { delayMs: 150, fallbackMs: 1500 });
    document.addEventListener('focusin', (event) => {
      if (!isEditable(event.target)) schedule(); // enfocar un campo de texto no cambia ningún indicador
    });
    document.addEventListener('input', (event) => {
      if (event.target === dialInput()) schedule(); // solo el campo del marcador cambia qué hace Ctrl+Enter
    });
    window.addEventListener('resize', schedule);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}

if (!window.__gvShortcuts) {
  window.__gvShortcuts = true;
  main();
}
