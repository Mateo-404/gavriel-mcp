/**
 * Atajos de teclado (mundo aislado del content script). Orquesta: lee la pantalla (page.ts), dibuja los indicadores
 * (badges.ts), reparte las teclas y sostiene las acciones de llamada y cierre. La lista de atajos que se muestra al usuario
 * está en shared/shortcut-catalog.ts.
 *
 *   Mantener Alt  muestra los atajos Alt+N (solo mientras se mantiene) y, en una cuenta, abre el menú de contactos; al soltar
 *                  Alt todo se oculta. Un toque rápido de Alt no hace nada.
 *   ↑ ↓ ← →       recorren los eventos del panel; Enter abre el marcado.
 *   Alt + 1…9      en el panel abre el evento N; en una cuenta llama al contacto N (nunca a Jurisdicción ni al 911).
 *   Alt + Shift    en una cuenta: copia el nombre de la última persona a la que se llamó (last-contact.ts).
 *   Alt + Enter    en una cuenta: siguiente contacto de la ronda de llamadas (call-round.ts).
 *   Alt + M        durante una llamada: silencia o reactiva el micrófono (call-mute.ts).
 *   Ctrl + Espacio pausa o reanuda la canción (music-feature.ts), siempre.
 *   Ctrl + Enter   acción principal según contexto, en este orden: confirmar el diálogo abierto, cortar la llamada, atender
 *                  la entrante, marcar el número del marcador, procesar masivo, abrir «Cerrar intervención».
 *                  Sin ninguna no intercepta nada (ni escribiendo en un campo).
 *
 * Seguridad: ignora teclas repetidas, AltGr (Ctrl+Alt en Windows), combinaciones con Shift/Meta, bloquea llamadas dobles
 * durante 1,5 s, y no llama mientras hay un menú o diálogo modal abierto ni si ya hay una llamada en curso.
 */
import { DEFAULT_SETTINGS } from '../shared/constants';
import { isArrowKey } from '../shared/grid';
import { digitFromKeyCode, filterFromLetterCode, shiftedDigit } from '../shared/labels';
import { readSettings } from '../shared/storage';
import { accountIdFromLocation } from '../shared/routes';
import { createBadges, type BadgeSpec } from './badges';
import { createEventsNav, FOCUS_ATTR } from './events-nav';
import { createCallCard } from './call-card';
import { createCallMute } from './call-mute';
import { createCallRound } from './call-round';
import { plainDigit, typeDigit } from './dial-input';
import { createClientCopy } from './client-copy';
import { createAlertSender } from './alerts';
import { createDataStore } from './data-store';
import { createDialogConfirm, runAfterEnd, watchInterventionEnd } from './dialog-confirm';
import { createIndexFeature } from './index-feature';
import { createLastContact } from './last-contact';
import { createMusic } from './music-feature';
import {
  type Contact,
  FAB_OPEN,
  MENU_TOGGLE,
  createPage,
  dialogOpen,
  isEditable,
  modalOpen,
  ownText,
  ownsArrowKeys,
  visible,
} from './page';
import { createPanelActions } from './panel-actions';
import { guard, watchDom } from './runtime';
import { bindSettings } from './settings-sync';
import { createSipClient } from './sip';

declare global {
  interface Window {
    __gvShortcuts?: boolean;
  }
}

type Action = 'confirm' | 'hangup' | 'answer' | 'dial' | 'bulk' | 'close';

/** Letra de cada filtro (ver FILTER_LETTER_CODES): la etiqueta que se muestra. */
const FILTER_KEYS = ['Q', 'W', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
/** Atributo de <html> mientras se mantiene Alt: el CSS muestra solo entonces los indicadores Alt+N. */
const ALT_ATTR = 'data-gv-alt';
const LOCK_MS = 1500;
/** Pausa entre cortar una llamada y marcar al siguiente de la ronda. */
const ROUND_PAUSE_MS = 5000;
/** Cuánto hay que mantener Alt (sin otra tecla) para que se abra el menú de contactos. */
const PEEK_DELAY_MS = 350;
const MAX_SHORTCUT_DIGIT = 9;

function main(): void {
  let enabled: boolean = DEFAULT_SETTINGS.shortcutsEnabled;
  let roundOn: boolean = DEFAULT_SETTINGS.callRound;
  let lastCallAt = 0;
  let lastOpenAt = 0;
  let hangingUp = false;
  let closing = false;
  let callingFromMenu = false;
  let peekTimer: number | undefined;
  let peekOpened = false; // el menú lo abrimos nosotros al mantener Alt

  const root = document.documentElement;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const page = createPage();
  const {
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
  } = page;

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

  // ---------- Las partes ----------

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
  const copyClientMessage = createClientCopy({
    visible,
    toast,
    known: () => {
      const id = currentAccountId();
      return id ? dataStore.clientMessage(id) : null;
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
  const mediaBar = createMusic();
  const indexFeature = createIndexFeature({ sip, repaint: () => schedule() });
  const round = createCallRound({ isCalling, accountId: currentAccountId, repaint: () => schedule() });
  const badges = createBadges();

  // Al cerrar la intervención la ronda de esa cuenta vuelve a cero, y se vuelve a lo que sigue: cierre masivo → «Limpiar
  // filtros»; cierre de un evento o «Dejar en observación» → «Volver a panel». La ronda se conserva hasta que la
  // intervención de verdad se cierra (resolución y categoría); «Dejar en observación» no la toca
  watchInterventionEnd((_bulk, kind, dialog) => {
    const id = currentAccountId();
    runAfterEnd(kind, dialog, {
      clearFilters: () => panel.clearFilters(),
      goBack,
      forgetRound: (all) => round.forget(all, all ? undefined : id),
    });
  });

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

  /** Tildes, colores y barra de la ronda sobre «Contactos de emergencia» (no en el panel ni con un diálogo abierto). */
  const paintRound = (): void => {
    const listed = enabled && roundOn && !events.active() ? findContacts() : [];
    round.paint(
      listed.map((c) => ({ name: c.name, button: c.button, card: c.card })),
      listed[0]?.heading ?? null,
    );
  };

  /** El botón al que apunta el Ctrl+Enter de ahora, según la acción. */
  const primaryTarget = (action: Action | null): HTMLElement | null | undefined => {
    switch (action) {
      case 'confirm':
        return dialogConfirm.primary();
      case 'hangup':
        return findHangup();
      case 'answer':
        return findAnswer();
      case 'dial':
        return dialButtonFor(dialInput()!);
      case 'bulk':
        return panel.bulkButton();
      case 'close':
        return findCloseIntervention();
      default:
        return null;
    }
  };

  const paint = (): void => {
    mediaBar.ensureMounted(); // la barra de arriba se redibuja con la pantalla: se vuelve a ubicar el reproductor
    indexFeature.paint(findAnswer() !== undefined);
    // Con un diálogo abierto no hay nada que indicar y escribir ahí dispara muchos cambios: no se toca el DOM
    if (dialogOpen()) {
      const wantedNow = new Map<Element, string>();
      if (enabled) {
        const main = dialogConfirm.primary();
        const out = dialogConfirm.dismissButton();
        if (main) wantedNow.set(main, 'Ctrl+Enter');
        if (out) wantedNow.set(out, 'Esc');
      }
      badges.syncDialog(wantedNow);
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
        panel.filters().forEach((chip, index) => {
          wanted.set(chip, { text: `Alt+⇧${index + 1} · Alt+${FILTER_KEYS[index]}`, place: 'inside', altOnly: true });
        });
        const clear = panel.clearButton();
        if (clear && !modalOpen()) wanted.set(clear, { text: 'Esc', place: 'inside', altOnly: false });
      } else {
        for (const contact of visibleContacts()) {
          if (contact.position > MAX_SHORTCUT_DIGIT) continue;
          wanted.set(contact.badgeHost, { text: `Alt+${contact.position}`, place: 'before', altOnly: true });
        }
      }
      const back = currentAccountId() ? backButton() : null;
      if (back && !modalOpen()) wanted.set(back, { text: 'Esc', place: 'inside', altOnly: false });
      const target = primaryTarget(plan());
      if (target) wanted.set(target, { text: 'Ctrl+Enter', place: 'inside', altOnly: false });
    }
    badges.sync(wanted);
    events.refresh();
    callCard.update();
    callMute.update(isCalling());
    paintRound();
  };

  // Una sola lectura de los botones de la página por pasada (ver page.ts); con la pestaña oculta no se hace nada
  // (al volver a verla, el observador del DOM repinta)
  const decorate = guard('indicadores', (): void => {
    if (document.hidden) return;
    page.snapshot(paint);
  });

  let timer: number | undefined;
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      decorate();
    }, 80);
  };

  // ---------- Mantener Alt: ver los contactos ----------

  const cancelPeekTimer = (): void => {
    clearTimeout(peekTimer);
    peekTimer = undefined;
  };

  /**
   * Al mantener Alt, abre el menú "Llamar a…" para que se vean los contactos con su "Alt+N". Solo si la lista de contactos
   * no está ya a la vista, no hay llamada ni diálogo abierto, y el menú no lo abrió el usuario por su cuenta.
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

  // ---------- Acciones ----------

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

  const waitFor = async <T>(read: () => T | null | undefined, ms: number): Promise<T | null | undefined> => {
    for (let waited = 0; waited < ms; waited += 50) {
      const value = read();
      if (value) return value;
      await sleep(50);
    }
    return read();
  };

  /**
   * Llama al contacto N desde cualquier pestaña de la cuenta. Si la lista de contactos no está a la vista (Gavriel solo
   * dibuja la pestaña activa), usa el menú "Llamar a…" del botón flotante: lo abre, elige el contacto y, si hizo falta
   * abrirlo, lo deja cerrado.
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
   * Alt+Enter: siguiente contacto de la ronda. Con una llamada en curso, la corta primero. Solo cuenta una llamada si de
   * verdad arrancó (si Gavriel no dejó llamar, el contacto sigue pendiente).
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
   * Abre el formulario de "Cerrar intervención" y deja el cursor listo en "Resolución". El formulario es un diálogo de Radix:
   * al abrirse manda el foco al primer control (el selector de Categoría, id="category"), así que se espera a que aparezca
   * el textarea (id="resolution") y se lo enfoca. Confirmar sigue siendo manual: el botón queda deshabilitado hasta completar
   * Categoría y Resolución.
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

  // ---------- Teclado ----------

  const consume = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = guard('teclado', (event: KeyboardEvent): void => {
    // Cualquier otra tecla junto con Alt (Alt+Tab, Alt+←…) no es "mantener Alt"
    if (event.key !== 'Alt') cancelPeekTimer();
    if (!enabled || event.isComposing || event.repeat) return;
    if (event.metaKey) return;

    // Ctrl + Espacio: pausa o reanuda la canción de Spotify / YouTube Music, siempre (también escribiendo o con un diálogo abierto)
    if (event.ctrlKey && !event.altKey && !event.shiftKey && (event.code === 'Space' || event.key === ' ')) {
      consume(event);
      if (!mediaBar.togglePlayback()) toast('No hay Spotify ni YouTube Music abiertos');
      return;
    }

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

    // Alt + Shift apretados juntos (sin otra tecla), en una cuenta: copia el nombre de la última persona a la que se llamó.
    // No se consume la tecla: el sistema puede usar Alt+Shift para cambiar de idioma del teclado y eso no se puede impedir
    // desde una página.
    if (!event.ctrlKey && ((event.key === 'Shift' && event.altKey) || (event.key === 'Alt' && event.shiftKey))) {
      if (currentAccountId()) void copyLastContact();
      return;
    }

    // Flechas sobre los eventos del panel, con o sin Shift (por si otra cosa del navegador se queda con las flechas solas).
    // Escribiendo en un campo o dentro de un menú no son nuestras.
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

    // Mantener Alt solo (sin Ctrl/Shift/Meta): se muestran los indicadores Alt+N y, tras un instante, se abre el menú de contactos
    if (event.key === 'Alt') {
      if (!event.ctrlKey) {
        root.setAttribute(ALT_ATTR, '');
        peekTimer = window.setTimeout(openPeek, PEEK_DELAY_MS);
      }
      return;
    }

    // Alt + C en una cuenta: copia «Estimado/a cliente» + nombre y dirección de la cuenta
    if (event.altKey && !event.ctrlKey && !event.getModifierState('AltGraph') && event.code === 'KeyC') {
      if (currentAccountId()) {
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
      const onMarkedCard = event.target === document.body || (event.target instanceof Element && event.target.hasAttribute(FOCUS_ATTR));
      if (event.key === 'Enter' && events.active() && !modalOpen() && events.hasFocus() && onMarkedCard && events.openFocused()) {
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

  // ---------- Ajustes e inicio ----------

  // El orden importa: shortcutsEnabled antes que callRound (la ronda depende de los dos)
  bindSettings({
    shortcutsEnabled: (value) => {
      enabled = value;
      round.setEnabled(roundOn && enabled);
      if (!enabled) {
        root.removeAttribute(ALT_ATTR);
        events.clear();
        closePeek();
      }
      schedule();
    },
    callRound: (value) => {
      roundOn = value;
      round.setEnabled(roundOn && enabled);
      schedule();
    },
    showCallCard: (value) => callCard.setEnabled(value),
    mediaPlayer: (value) => mediaBar.setEnabled(value),
    accountIndex: (value) => indexFeature.setEnabled(value),
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
