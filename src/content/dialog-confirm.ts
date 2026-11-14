/**
 * Ctrl+Enter confirma el diálogo abierto apretando su botón principal.
 *
 * Cómo está armado Gavriel (verificado en su código): todos los diálogos son Radix Dialog con
 * `data-slot="dialog-content"` (role="dialog") y un pie `data-slot="dialog-footer"` con «Cancelar»
 * (ghost/outline) y un único botón principal (default o destructive) que Gavriel deja deshabilitado
 * hasta completar los campos obligatorios. Se hace exactamente lo que haría un clic: si el botón
 * está deshabilitado no se fuerza nada, solo se avisa.
 */
import { type FooterButton, pickPrimary } from '../shared/dialog';

/** Solo los diálogos modales de Gavriel: el panel «Detalle de …» del mapa también es role="dialog" pero no es modal. */
const DIALOG = '[data-slot="dialog-content"], [role="alertdialog"]';
const FOOTER = '[data-slot="dialog-footer"]';
const LOCK_MS = 1500;

interface Deps {
  visible: (el: Element) => boolean;
  ownText: (el: Element) => string;
  toast: (message: string) => void;
}

export interface DialogConfirm {
  /** Botón principal del diálogo que está arriba de todo, o null. */
  primary: () => HTMLButtonElement | null;
  /** Aprieta el botón principal. Devuelve true si había uno (la tecla se consume). */
  confirm: () => boolean;
}

export function createDialogConfirm({ visible, ownText, toast }: Deps): DialogConfirm {
  let lockedUntil = 0;

  const topDialog = (): Element | undefined => [...document.querySelectorAll(DIALOG)].filter(visible).pop();

  const primary = (): HTMLButtonElement | null => {
    const dialog = topDialog();
    if (!dialog) return null;
    const scope = dialog.querySelector(FOOTER) ?? dialog;
    const buttons = [...scope.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
    const info: FooterButton[] = buttons.map((b) => ({ className: b.className, label: ownText(b) }));
    return buttons[pickPrimary(info)] ?? null;
  };

  return {
    primary,
    confirm() {
      const button = primary();
      if (!button) return false;
      if (button.disabled) {
        toast('Completá los campos para confirmar');
      } else if (Date.now() >= lockedUntil) {
        lockedUntil = Date.now() + LOCK_MS; // evita confirmar dos veces
        button.click();
      }
      return true;
    },
  };
}
