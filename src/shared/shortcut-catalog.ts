/**
 * Catálogo de atajos: la lista que se muestra en la página de ajustes (y la que resume el README).
 * Los atajos en sí se implementan en content/shortcuts.ts; si cambia uno, se cambia acá también.
 */

export type ShortcutScope = 'panel' | 'cuenta' | 'llamadas';

export interface Shortcut {
  scope: ShortcutScope;
  /** Teclas, tal como se muestran. */
  keys: readonly string[];
  /** true: se aprietan juntas (Alt + Shift); false: son alternativas (↑ ↓ ← →). */
  chord: boolean;
  description: string;
}

export const SCOPE_TITLES: Readonly<Record<ShortcutScope, { title: string; where: string }>> = {
  panel: { title: 'Panel de monitoreo', where: 'En la lista de eventos (vista Kanban)' },
  cuenta: { title: 'Dentro de una cuenta', where: 'Con una cuenta abierta' },
  llamadas: { title: 'Llamadas', where: 'En cualquier pantalla de Gavriel' },
};

export const SHORTCUTS: readonly Shortcut[] = [
  {
    scope: 'panel',
    keys: ['↑', '↓', '←', '→'],
    chord: false,
    description: 'Recorren los eventos. La primera flecha marca el primer evento de la columna de la izquierda. También funcionan con Shift.',
  },
  { scope: 'panel', keys: ['Enter'], chord: false, description: 'Abre el evento marcado.' },
  { scope: 'panel', keys: ['Esc'], chord: false, description: 'Quita la marca.' },
  {
    scope: 'panel',
    keys: ['Alt', '1…9'],
    chord: true,
    description: 'Abre el evento N, contando columna por columna.',
  },
  {
    scope: 'cuenta',
    keys: ['Alt', '1…9'],
    chord: true,
    description: 'Llama al contacto N de la lista, desde cualquier pestaña de la cuenta. Nunca llama a Jurisdicción ni al 911.',
  },
  {
    scope: 'cuenta',
    keys: ['Mantener Alt'],
    chord: false,
    description: 'Muestra los atajos y abre el menú de contactos. Al soltar, se cierra.',
  },
  {
    scope: 'cuenta',
    keys: ['Alt', 'Shift'],
    chord: true,
    description: 'Copia el nombre de la última persona a la que llamaste.',
  },
  {
    scope: 'llamadas',
    keys: ['Ctrl', 'Enter'],
    chord: true,
    description:
      'Corta la llamada en curso, atiende una entrante o llama desde el marcador. Sin llamada, en una cuenta intervenida, abre «Cerrar intervención» con el cursor en Resolución.',
  },
];

/** Los atajos de un ámbito, en el orden del catálogo. */
export function shortcutsFor(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}
