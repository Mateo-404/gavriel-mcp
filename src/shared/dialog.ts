/** Un botón del pie de un diálogo, reducido a lo que hace falta para decidir cuál es el principal. */
export interface FooterButton {
  /** Valor del atributo class. */
  className: string;
  /** Texto visible. */
  label: string;
}

/** Botones de acción (no «Cancelar», «Cerrar» ni la X). */
const DISMISS = /^(cancelar|cerrar|volver|no|salir|descartar)$/i;
const PRIMARY_TOKENS = ['bg-primary', 'bg-destructive'];

/**
 * Índice del botón principal del pie de un diálogo, o -1 si no hay uno inequívoco.
 *
 * En Gavriel el botón principal de un diálogo (el que confirma) es la variante `default`
 * (clase `bg-primary`) o `destructive` (`bg-destructive`) de su componente Button; «Cancelar» es
 * `ghost`/`outline` y las opciones alternativas son `secondary`. Si hay más de un candidato no se
 * adivina: ningún atajo es mejor que confirmar la acción equivocada.
 */
/** Índice del botón de salida («Cancelar», «Cerrar»…) del pie de un diálogo, o -1. Si hay varios, el primero. */
export function pickDismiss(buttons: readonly FooterButton[]): number {
  return buttons.findIndex((b) => DISMISS.test(b.label.trim()));
}

export function pickPrimary(buttons: readonly FooterButton[]): number {
  const found: number[] = [];
  buttons.forEach((button, index) => {
    const tokens = button.className.split(/\s+/);
    if (PRIMARY_TOKENS.some((t) => tokens.includes(t)) && !DISMISS.test(button.label.trim())) found.push(index);
  });
  return found.length === 1 ? found[0]! : -1;
}
