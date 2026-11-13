/**
 * Tarjeta flotante "a quién estoy llamando".
 *
 * Mientras hay una llamada saliente muestra, sobre el botón flotante del teléfono, el nombre y la
 * descripción del contacto. Se entera de a quién se llama escuchando los clics (en fase de captura,
 * sin alterarlos) sobre los botones que inician llamadas:
 *   - "Llamar" de la tarjeta de un contacto (pestaña Contactos),
 *   - un ítem del menú "Llamar a…" del botón flotante,
 *   - el botón principal del teléfono ("Llamar a <cuenta>"),
 *   - "Llamar" del marcador (se busca el número entre los contactos vistos).
 * Cuando la llamada termina (el botón deja de estar rojo y no hay "Colgar") la tarjeta se va y queda
 * lista para el próximo contacto. Atajos, clics del mouse y el menú pasan por el mismo camino.
 */
import { type CalledContact, parseContactLines, samePhone } from '../shared/contact-card';

const HINT_ATTR = 'data-gv-hint';
const CALL_BUTTON = 'button[aria-label="Llamar"]';
const FAB = 'button[aria-label="Abrir softphone"], button[aria-label="Minimizar softphone"]';
/** Si la llamada no llega a empezar, se olvida a quién se iba a llamar. */
const PENDING_MS = 10_000;
const GAP_PX = 10;

interface Deps {
  isCalling: () => boolean;
  visible: (el: Element) => boolean;
}

/** Líneas de texto de un componente (una por elemento hoja), sin íconos ni nuestros indicadores. */
function leafLines(root: Element): string[] {
  const lines: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 0 || el.closest('svg') || el.closest(`[${HINT_ATTR}]`)) continue;
    const text = el.textContent?.trim();
    if (text) lines.push(text);
  }
  return lines;
}

export function createCallCard({ isCalling, visible }: Deps): {
  update: () => void;
  setEnabled: (on: boolean) => void;
} {
  let enabled = true;
  let pending: CalledContact | null = null;
  let pendingAt = 0;
  let current: CalledContact | null = null;
  let el: HTMLElement | undefined;
  const known: CalledContact[] = []; // contactos vistos, para reconocer el número del marcador

  const remember = (contact: CalledContact): void => {
    if (!contact.phone) return;
    const at = known.findIndex((c) => samePhone(c.phone, contact.phone));
    if (at >= 0) known[at] = contact;
    else known.push(contact);
  };

  const fromCardButton = (button: Element): CalledContact | null => {
    let card: HTMLElement = button as HTMLElement;
    while (
      card.parentElement &&
      card.parentElement !== document.body &&
      card.parentElement.querySelectorAll(CALL_BUTTON).length === 1 &&
      (card.parentElement.textContent?.length ?? 0) <= 400
    ) {
      card = card.parentElement;
    }
    return card === button ? null : parseContactLines(leafLines(card));
  };

  const fromMenuItem = (button: Element): CalledContact | null => {
    const menu = button.closest('[role="menu"]');
    if (!menu || !/Llamar a/.test(menu.textContent ?? '')) return null;
    return parseContactLines(leafLines(button));
  };

  const fromDialer = (button: Element): CalledContact | null => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Número…"]');
    const number = input?.value.trim();
    if (!input || !number) return null;
    scanKnown(); // los contactos se leen solo cuando hace falta
    // el botón "Llamar" del marcador comparte contenedor (cerca) con el campo del número
    let root: Element | null = button;
    for (let i = 0; i < 6 && root && !root.contains(input); i++) root = root.parentElement;
    if (!root) return null;
    const match = known.find((c) => samePhone(c.phone, number));
    return match ?? { name: number, description: '', phone: number };
  };

  const contactFromClick = (target: EventTarget | null): CalledContact | null => {
    if (!(target instanceof Element)) return null;
    const button = target.closest('button');
    if (!button || (button as HTMLButtonElement).disabled) return null;

    if (button.matches(CALL_BUTTON)) {
      const contact = fromCardButton(button);
      if (contact) remember(contact);
      return contact;
    }
    const menuContact = fromMenuItem(button);
    if (menuContact) {
      remember(menuContact);
      return menuContact;
    }
    const title = button.getAttribute('title') ?? '';
    const account = /^Llamar a (.+)/.exec(title)?.[1]?.trim();
    if (account && button.closest(FAB) === null && button.parentElement?.querySelector('[aria-label="Elegir otro contacto"]')) {
      return { name: account, description: 'Cuenta', phone: '' };
    }
    if (button.textContent?.trim() === 'Llamar') return fromDialer(button);
    return null;
  };

  /** Memoriza los contactos que se ven (lista o menú) para poder reconocer el número del marcador. */
  const scanKnown = (): void => {
    for (const button of document.querySelectorAll(CALL_BUTTON)) {
      const contact = visible(button) ? fromCardButton(button) : null;
      if (contact) remember(contact);
    }
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!/Llamar a/.test(menu.textContent ?? '')) continue;
      for (const item of menu.querySelectorAll('button')) {
        const contact = parseContactLines(leafLines(item));
        if (contact) remember(contact);
      }
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      if (!enabled || isCalling()) return;
      const contact = contactFromClick(event.target);
      if (!contact) return;
      pending = contact;
      pendingAt = Date.now();
    },
    true,
  );

  const build = (): HTMLElement => {
    const card = document.createElement('div');
    card.className = 'gv-callcard';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.hidden = true;
    const label = document.createElement('span');
    label.className = 'gv-callcard-label';
    label.textContent = 'Llamando a';
    const name = document.createElement('strong');
    name.className = 'gv-callcard-name';
    const desc = document.createElement('span');
    desc.className = 'gv-callcard-desc';
    card.append(label, name, desc);
    document.body.append(card);
    return card;
  };

  const render = (contact: CalledContact): void => {
    el ??= build();
    if (!el.isConnected) document.body.append(el); // React / la página pudieron limpiar el body
    const name = el.querySelector<HTMLElement>('.gv-callcard-name')!;
    const desc = el.querySelector<HTMLElement>('.gv-callcard-desc')!;
    name.textContent = contact.name;
    desc.textContent = contact.description;
    desc.hidden = !contact.description;
    el.title = [contact.name, contact.description, contact.phone].filter(Boolean).join(' · ');
  };

  /** Se apoya sobre el bloque flotante del softphone (panel + botón), a su misma altura de borde derecho. */
  const place = (): void => {
    if (!el) return;
    const fab = [...document.querySelectorAll<HTMLElement>(FAB)].find(visible);
    const box = fab?.closest<HTMLElement>('.fixed') ?? fab?.parentElement;
    if (!box) {
      el.hidden = true;
      return;
    }
    const rect = box.getBoundingClientRect();
    el.style.bottom = `${Math.round(document.documentElement.clientHeight - rect.top + GAP_PX)}px`;
    el.style.right = `${Math.max(8, Math.round(document.documentElement.clientWidth - rect.right))}px`;
  };

  const hide = (): void => {
    current = null;
    if (el) el.hidden = true;
  };

  const update = (): void => {
    if (!enabled) return hide();
    if (isCalling()) {
      if (pending) {
        current = pending;
        pending = null;
      }
      if (!current) return hide(); // llamada sin saber a quién (entrante o ya iniciada)
      render(current);
      el!.hidden = false;
      place();
      return;
    }
    // Sin llamada: se fue la tarjeta y queda lista para el próximo contacto
    hide();
    if (pending && Date.now() - pendingAt > PENDING_MS) pending = null;
  };

  return {
    update,
    setEnabled: (on) => {
      enabled = on;
      if (!on) pending = null;
      update();
    },
  };
}
