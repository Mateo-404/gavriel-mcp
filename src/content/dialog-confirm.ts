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
/** Título del cierre masivo: ahí, sin motivo escrito, Ctrl+Enter pone «.» y cierra (el motivo es obligatorio pero no importa). */
const BULK_CLOSE = /cerrar intervenciones masivamente/i;
const DEFAULT_REASON = '.';
const ENABLE_WAIT_MS = 400;

interface Deps {
  visible: (el: Element) => boolean;
  ownText: (el: Element) => string;
  toast: (message: string) => void;
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
