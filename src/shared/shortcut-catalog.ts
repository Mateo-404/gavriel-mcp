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
  {
    scope: 'panel',
    keys: ['Esc'],
    chord: false,
    description: 'Quita la marca de la tarjeta; si no hay ninguna y hay un filtro activo, aprieta «Limpiar filtros».',
  },
  {
    scope: 'panel',
    keys: ['Alt', 'Shift', '1…9'],
    chord: true,
    description: 'Activa o desactiva el filtro N por tipo de evento (los botones de colores bajo el buscador), de izquierda a derecha. Alternativa sin Shift: Alt+Q, W, R, T, Y, U, I, O, P.',
  },
  {
    scope: 'panel',
    keys: ['Ctrl', 'Enter'],
    chord: true,
    description: 'Con un filtro activo, aprieta «Procesar masivo» y deja el cursor en el motivo del cierre. Confirmar sigue siendo manual.',
  },
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
    keys: ['Alt', 'Enter'],
    chord: true,
    description: 'Ronda de llamadas: llama al siguiente contacto tildado (si hay una llamada en curso, la corta y llama al siguiente). Dos rondas como máximo; Alt+N reintenta a mano sin mover la ronda.',
  },
  {
    scope: 'cuenta',
    keys: ['Mantener Alt'],
    chord: false,
    description: 'Muestra los atajos y abre el menú de contactos. Al soltar, se cierra.',
  },
  {
    scope: 'cuenta',
    keys: ['Esc'],
    chord: false,
    description: 'Vuelve al panel («Volver a panel»). No actúa mientras escribís, con un menú o diálogo abierto ni en pantalla completa.',
  },
  {
    scope: 'cuenta',
    keys: ['Alt', 'C'],
    chord: true,
    description: 'Copia «Estimado/a cliente: *cuenta*» y «Alarma de: *dirección*» (dos líneas) para pegarlo en el mensaje.',
  },
  {
    scope: 'cuenta',
    keys: ['Alt', 'Shift'],
    chord: true,
    description: 'Copia el nombre de la última persona a la que llamaste, al instante (del historial de llamadas que Gavriel ya trajo).',
  },
  {
    scope: 'llamadas',
    keys: ['Esc'],
    chord: false,
    description: 'Con un diálogo abierto, aprieta su botón de salida («Cancelar» o «Cerrar»), también mientras escribís.',
  },
  {
    scope: 'llamadas',
    keys: ['Ctrl', 'Enter'],
    chord: true,
    description:
      'Con un diálogo abierto (Cerrar intervención, Dejar en observación, Procesar masivo…) aprieta su botón principal, incluso escribiendo en un campo; si falta completar algo, avisa. Sin diálogo: corta la llamada en curso al instante (llama a la función de colgar del softphone, sin abrir el panel), atiende una entrante o llama desde el marcador. Sin llamada, en una cuenta intervenida, abre «Cerrar intervención» con el cursor en Resolución.',
  },
];

/** Los atajos de un ámbito, en el orden del catálogo. */
export function shortcutsFor(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}
