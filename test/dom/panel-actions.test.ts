import { beforeEach, describe, expect, test } from 'bun:test';
import { createPanelActions } from '../../src/content/panel-actions';

const panel = createPanelActions({ visible: () => true, ownText: (el) => el.textContent?.trim() ?? '' });
const clicks: string[] = [];

const mount = (html: string): void => {
  document.body.innerHTML = html;
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicks.push(b.textContent?.trim() ?? '')));
};

beforeEach(() => {
  clicks.length = 0;
  document.body.innerHTML = '';
});

describe('panel-actions (DOM)', () => {
  test('lista los filtros en orden y alterna el N', () => {
    mount(
      '<div class="monitoring-panel-toolbar-filters">' +
        '<button class="monitoring-panel-filter-btn">Robo(92)</button>' +
        '<button class="monitoring-panel-filter-btn">Fallo(12)</button></div>',
    );
    expect(panel.filters().map((b) => b.textContent)).toEqual(['Robo(92)', 'Fallo(12)']);
    expect(panel.toggleFilter(2)?.textContent).toBe('Fallo(12)');
    expect(clicks).toEqual(['Fallo(12)']);
    expect(panel.toggleFilter(5)).toBeNull();
    expect(panel.toggleFilter(0)).toBeNull();
  });

  test('no cuenta más de nueve filtros', () => {
    mount(Array.from({ length: 12 }, (_, i) => `<button class="monitoring-panel-filter-btn">F${i}</button>`).join(''));
    expect(panel.filters()).toHaveLength(9);
  });

  test('Limpiar filtros y Procesar masivo se encuentran por su texto', () => {
    mount('<button>Procesar masivo</button><button>Limpiar filtros</button>');
    expect(panel.bulkButton()?.textContent).toBe('Procesar masivo');
    expect(panel.clearFilters()).toBe(true);
    expect(clicks).toEqual(['Limpiar filtros']);
  });

  test('sin barra de filtro no hay nada que apretar', () => {
    mount('<button>Otra cosa</button>');
    expect(panel.bulkButton()).toBeUndefined();
    expect(panel.clearFilters()).toBe(false);
  });

  test('openBulk abre el diálogo y deja el cursor en el motivo', async () => {
    mount('<button id="bulk">Procesar masivo</button>');
    document.getElementById('bulk')!.addEventListener('click', () => {
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<div role="dialog"><button>Todas</button><textarea id="interventionReason"></textarea></div>',
        );
        (document.querySelector('[role=dialog] button') as HTMLElement).focus(); // Radix enfoca «Todas»
      }, 40);
    });
    await panel.openBulk();
    expect(document.activeElement?.id).toBe('interventionReason');
  });
});
