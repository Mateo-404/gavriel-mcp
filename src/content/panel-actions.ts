/**
 * Acciones del panel de monitoreo sobre los filtros por tipo de evento.
 *
 * Cómo está armado Gavriel (verificado en la página):
 *  - Los filtros por tipo son botones `button.monitoring-panel-filter-btn` dentro de
 *    `.monitoring-panel-toolbar-filters` (hay una copia oculta con la clase `hidden`: se usan
 *    solo los visibles). Un clic activa o desactiva el filtro.
 *  - Con un filtro activo aparece una barra "Filtrado por tipo: …" con dos botones:
 *    «Procesar masivo» y «Limpiar filtros».
 *  - «Procesar masivo» abre el diálogo «Cerrar Intervenciones Masivamente»; su campo de motivo es
 *    `textarea#interventionReason`. El diálogo manda el foco a «Todas», así que se lo mueve al motivo.
 *    Confirmar sigue siendo manual (queda deshabilitado hasta escribir el motivo).
 */
const FILTER_BUTTON = 'button.monitoring-panel-filter-btn';
const REASON = '#interventionReason';
export const MAX_NUMBERED_FILTERS = 9;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Deps {
  visible: (el: Element) => boolean;
  ownText: (el: Element) => string;
}

export interface PanelActions {
  /** Botones de filtro por tipo visibles, en orden de izquierda a derecha (máx. 9). */
  filters: () => HTMLButtonElement[];
  /** Activa o desactiva el filtro N (1 = el primero). Devuelve su botón, o null si no existe. */
  toggleFilter: (n: number) => HTMLButtonElement | null;
  bulkButton: () => HTMLButtonElement | undefined;
  clearButton: () => HTMLButtonElement | undefined;
  /** Abre «Procesar masivo» y deja el cursor en el motivo. */
  openBulk: () => Promise<void>;
  /** Aprieta «Limpiar filtros». */
  clearFilters: () => boolean;
}

export function createPanelActions({ visible, ownText }: Deps): PanelActions {
  let opening = false;

  const filters = (): HTMLButtonElement[] =>
    [...document.querySelectorAll<HTMLButtonElement>(FILTER_BUTTON)]
      .filter((b) => !b.disabled && visible(b))
      .slice(0, MAX_NUMBERED_FILTERS);

  const byText = (text: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => !b.disabled && visible(b) && ownText(b) === text,
    );

  const bulkButton = (): HTMLButtonElement | undefined => byText('Procesar masivo');
  const clearButton = (): HTMLButtonElement | undefined => byText('Limpiar filtros');

  return {
    filters,
    bulkButton,
    clearButton,
    toggleFilter(n) {
      const button = filters()[n - 1];
      if (!button) return null;
      button.click();
      return button;
    },
    clearFilters() {
      const button = clearButton();
      button?.click();
      return !!button;
    },
    async openBulk() {
      const button = bulkButton();
      if (!button || opening) return;
      opening = true;
      try {
        button.click();
        let area: HTMLTextAreaElement | null = null;
        for (let waited = 0; waited < 2000 && !area; waited += 50) {
          const field = document.querySelector(REASON);
          if (field instanceof HTMLTextAreaElement && visible(field)) area = field;
          else await sleep(50);
        }
        if (!area) return;
        // El diálogo enfoca «Todas» al abrir; se enfoca el motivo después y se vuelve a comprobar
        for (const pause of [150, 300]) {
          await sleep(pause);
          if (document.activeElement !== area) area.focus();
        }
      } finally {
        opening = false;
      }
    },
  };
}
