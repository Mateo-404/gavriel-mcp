/**
 * Ctrl+Enter confirma el diálogo abierto apretando su botón principal.
 *
 * Cómo está armado Gavriel (verificado en su código): todos los diálogos son Radix Dialog con
 * `data-slot="dialog-content"` (role="dialog") y un pie `data-slot="dialog-footer"` con «Cancelar»
 * (ghost/outline) y un único botón principal (default o destructive) que Gavriel deja deshabilitado
 * hasta completar los campos obligatorios. Se hace exactamente lo que haría un clic: si el botón
 * está deshabilitado no se fuerza nada, solo se avisa.
 */
import { type FooterButton, pickDismiss, pickPrimary } from '../shared/dialog';

/** Solo los diálogos modales de Gavriel: el panel «Detalle de …» del mapa también es role="dialog" pero no es modal. */
const DIALOG = '[data-slot="dialog-content"], [role="alertdialog"]';
const FOOTER = '[data-slot="dialog-footer"]';
const LOCK_MS = 1500;
/** Diálogos con motivo obligatorio que no importa (cierre masivo, dejar en observación): sin texto escrito, Ctrl+Enter pone «.» y confirma. */
const BULK_CLOSE = /cerrar intervenciones masivamente|dejar en observaci[oó]n/i;
const DEFAULT_REASON = '.';
const ENABLE_WAIT_MS = 400;

interface Deps {
  visible: (el: Element) => boolean;
  ownText: (el: Element) => string;
  toast: (message: string) => void;
}

/** Diálogos que terminan una intervención (cerrarla, dejarla en observación, cierre masivo). */
const ENDS_INTERVENTION = /cerrar intervenci|dejar en observaci[oó]n/i;

/**
 * Avisa cuando se aprieta el botón principal de un diálogo que termina una intervención, sea con Ctrl+Enter o
 * con el mouse. Se escucha en captura (antes que Gavriel). `bulk` indica el cierre de varias cuentas a la vez.
 */
export type EndKind = 'bulk' | 'close' | 'observation';

/** Prueba `step` hasta que devuelva true o pasen `maxMs` (sin quedarse corriendo si no hay nada que hacer). */
export function retryFor(step: () => boolean, maxMs = 1500, every = 50): void {
  const started = Date.now();
  const tick = (): void => {
    if (step() || Date.now() - started >= maxMs) return;
    setTimeout(tick, every);
  };
  tick();
}

/**
 * Ejecuta `run` cuando el diálogo ya se cerró (terminó de procesar). Se mira solo cuando el DOM cambia y se
 * abandona a los `maxMs`: si el diálogo sigue abierto (error, motivo faltante) no se hace nada.
 */
export function whenDialogGone(dialog: Element, run: () => void, maxMs = 30000, doc: Document = document): void {
  const gone = (): boolean => !dialog.isConnected;
  if (gone()) return run();
  const observer = new MutationObserver(() => {
    if (!gone()) return;
    observer.disconnect();
    clearTimeout(timer);
    run();
  });
  const timer = setTimeout(() => observer.disconnect(), maxMs);
  observer.observe(doc.body, { childList: true, subtree: true });
}

export function watchInterventionEnd(
  onEnd: (bulk: boolean, kind: EndKind, dialog: Element) => void,
  doc: Document = document,
): () => void {
  const listener = (event: Event): void => {
    const button = (event.target as Element | null)?.closest?.('button');
    const dialog = button?.closest('[data-slot="dialog-content"], [role="alertdialog"]');
    if (!button || !dialog || button.disabled) return;
    const title = dialog.querySelector('h1, h2, h3, [data-slot="dialog-title"]')?.textContent ?? '';
    if (!ENDS_INTERVENTION.test(title)) return;
    const footer = dialog.querySelector(FOOTER) ?? dialog;
    const buttons = [...footer.querySelectorAll<HTMLButtonElement>('button')];
    const main = buttons[pickPrimary(buttons.map((b) => ({ className: b.className, label: b.textContent?.trim() ?? '' })))];
    if (main !== button) return;
    const kind: EndKind = /masivamente/i.test(title) ? 'bulk' : /observaci[oó]n/i.test(title) ? 'observation' : 'close';
    onEnd(kind === 'bulk', kind, dialog);
  };
  doc.addEventListener('click', listener, true);
  return () => doc.removeEventListener('click', listener, true);
}

export interface DialogConfirm {
  /** Botón principal del diálogo que está arriba de todo, o null. */
  primary: () => HTMLButtonElement | null;
  /** Botón de salida («Cancelar», «Cerrar»…) del diálogo de arriba, o null. */
  dismissButton: () => HTMLButtonElement | null;
  /** Aprieta el botón de salida. Devuelve true si lo hizo (la tecla se consume). */
  dismiss: () => boolean;
  /** Aprieta el botón principal. Devuelve true si había uno (la tecla se consume). */
  confirm: () => boolean;
}

export function createDialogConfirm({ visible, ownText, toast }: Deps): DialogConfirm {
  let lockedUntil = 0;

  const topDialog = (): Element | undefined => [...document.querySelectorAll(DIALOG)].filter(visible).pop();

  const footerButtons = (): HTMLButtonElement[] => {
    const dialog = topDialog();
    if (!dialog) return [];
    const scope = dialog.querySelector(FOOTER) ?? dialog;
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
  };
  const info = (buttons: HTMLButtonElement[]): FooterButton[] =>
    buttons.map((b) => ({ className: b.className, label: ownText(b) }));

  const primary = (): HTMLButtonElement | null => {
    const buttons = footerButtons();
    return buttons[pickPrimary(info(buttons))] ?? null;
  };
  const dismissButton = (): HTMLButtonElement | null => {
    const buttons = footerButtons();
    return buttons[pickDismiss(info(buttons))] ?? null;
  };

  /** Escribe «.» en el motivo como si se tipeara (React lee el valor por el setter nativo y el evento input). */
  const fillDefaultReason = (): boolean => {
    const dialog = topDialog();
    if (!dialog || !BULK_CLOSE.test(dialog.textContent ?? '')) return false;
    const area = dialog.querySelector<HTMLTextAreaElement>('textarea');
    if (!area || area.value.trim() !== '' || area.disabled || area.readOnly) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, DEFAULT_REASON);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  /** Espera (sin polling largo) a que React habilite el botón tras rellenar el motivo, y lo aprieta. */
  const clickWhenEnabled = (button: HTMLButtonElement): void => {
    const started = Date.now();
    const tick = (): void => {
      if (!button.isConnected) return;
      if (!button.disabled) {
        lockedUntil = Date.now() + LOCK_MS;
        button.click();
      } else if (Date.now() - started < ENABLE_WAIT_MS) setTimeout(tick, 20);
      else toast('Completá los campos para confirmar');
    };
    setTimeout(tick, 0);
  };

  return {
    primary,
    dismissButton,
    dismiss() {
      const button = dismissButton();
      if (!button || button.disabled) return false; // sin botón de salida (o ocupado) Esc queda para Radix
      button.click();
      return true;
    },
    confirm() {
      const button = primary();
      if (!button) return false;
      if (button.disabled) {
        if (Date.now() >= lockedUntil && fillDefaultReason()) {
          lockedUntil = Date.now() + LOCK_MS; // un solo intento mientras se espera
          clickWhenEnabled(button);
          return true;
        }
        toast('Completá los campos para confirmar');
      } else if (Date.now() >= lockedUntil) {
        lockedUntil = Date.now() + LOCK_MS; // evita confirmar dos veces
        button.click();
      }
      return true;
    },
  };
}
