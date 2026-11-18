import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createBadges } from '../../src/content/badges';
import { createPage } from '../../src/content/page';

// happy-dom no calcula layout: se simula que todo es visible
const realRects = Element.prototype.getClientRects;
beforeAll(() => {
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});
afterAll(() => {
  Element.prototype.getClientRects = realRects; // otros archivos de prueba comparten el proceso
});
afterEach(() => {
  document.body.innerHTML = '';
});

const mount = (html: string): void => {
  document.body.innerHTML = html;
};

describe('page: lectura de la pantalla de Gavriel', () => {
  test('encuentra colgar, cerrar intervención y los contactos de emergencia en orden', () => {
    mount(
      '<button>Colgar</button><button>Cerrar intervención</button>' +
        '<section><p>Contactos de emergencia</p>' +
        '<div><button aria-label="Llamar">x</button></div><div><button aria-label="Llamar">y</button></div></section>',
    );
    const page = createPage();
    expect(page.findHangup()?.textContent).toBe('Colgar');
    expect(page.isCalling()).toBe(true);
    expect(page.findCloseIntervention()?.textContent).toBe('Cerrar intervención');
    expect(page.findContacts().map((c) => c.position)).toEqual([1, 2]);
  });

  test('«Atender» de un evento no es una llamada entrante; el de «Llamada de:» sí', () => {
    mount('<div>Evento <button>Atender</button></div>');
    const page = createPage();
    expect(page.findAnswer()).toBeUndefined();
    mount('<div>Llamada de: 342 <button>Rechazar</button><button>Atender</button></div>');
    expect(page.findAnswer()?.textContent).toBe('Atender');
  });

  test('snapshot: todas las búsquedas de una pasada comparten una sola lectura de los botones', () => {
    mount('<button>Colgar</button><button>Atender</button><button>Cerrar intervención</button>');
    const page = createPage();
    let reads = 0;
    const original = document.querySelectorAll.bind(document);
    document.querySelectorAll = ((selector: string) => {
      if (selector === 'button') reads++;
      return original(selector);
    }) as typeof document.querySelectorAll;
    try {
      page.snapshot(() => {
        page.findHangup();
        page.findAnswer();
        page.findCloseIntervention();
        page.isCalling();
      });
      expect(reads).toBe(1);
      page.findHangup(); // fuera de la foto cada búsqueda lee la página de nuevo (un clic puede cambiarla al instante)
      expect(reads).toBe(2);
    } finally {
      document.querySelectorAll = original as typeof document.querySelectorAll;
    }
  });
});

describe('badges: dejan exactamente los indicadores pedidos', () => {
  test('crea, actualiza el texto, repone si React lo descartó y quita los que sobran', () => {
    mount('<div><button id="a">A</button><button id="b">B</button></div>');
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const badges = createBadges();
    badges.sync(new Map([[a, { text: 'Alt+1', place: 'inside', altOnly: true }], [b, { text: 'Esc', place: 'inside', altOnly: false }]]));
    expect(a.querySelector('kbd')!.getAttribute('data-gv-text')).toBe('Alt+1');
    badges.sync(new Map([[a, { text: 'Alt+2', place: 'inside', altOnly: true }]]));
    expect(a.querySelector('kbd')!.getAttribute('data-gv-text')).toBe('Alt+2');
    expect(b.querySelector('kbd')).toBeNull();
    a.querySelector('kbd')!.remove(); // React lo descartó
    badges.sync(new Map([[a, { text: 'Alt+2', place: 'inside', altOnly: true }]]));
    expect(a.querySelectorAll('kbd')).toHaveLength(1);
  });
});
