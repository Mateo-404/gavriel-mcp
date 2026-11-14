import { beforeEach, describe, expect, test } from 'bun:test';
import { createDialogConfirm } from '../../src/content/dialog-confirm';

const toasts: string[] = [];
const dc = createDialogConfirm({
  visible: () => true,
  ownText: (el) => el.textContent?.trim() ?? '',
  toast: (m) => toasts.push(m),
});

const dialog = (footer: string): void => {
  document.body.innerHTML = `<div role="dialog" data-slot="dialog-content"><div data-slot="dialog-footer">${footer}</div></div>`;
};
const clicks: string[] = [];
const track = (): void => {
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicks.push(b.textContent ?? '')));
};

beforeEach(() => {
  document.body.innerHTML = '';
  clicks.length = 0;
  toasts.length = 0;
});

describe('dialog-confirm (DOM)', () => {
  test('sin diálogo no hace nada', () => {
    expect(dc.primary()).toBeNull();
    expect(dc.confirm()).toBe(false);
    expect(dc.dismiss()).toBe(false);
  });

  test('Ctrl+Enter aprieta el botón principal y no el de cancelar', () => {
    dialog('<button class="bg-transparent">Cancelar</button><button class="bg-primary">Confirmar</button>');
    track();
    expect(dc.confirm()).toBe(true);
    expect(clicks).toEqual(['Confirmar']);
  });

  test('botón deshabilitado: no se fuerza, se avisa', () => {
    dialog('<button>Cancelar</button><button class="bg-destructive" disabled>Cerrar Intervención</button>');
    track();
    expect(dc.confirm()).toBe(true);
    expect(clicks).toEqual([]);
    expect(toasts).toEqual(['Completá los campos para confirmar']);
  });

  test('Esc aprieta Cancelar; sin botón de salida lo deja a Radix', () => {
    dialog('<button class="bg-transparent">Cancelar</button><button class="bg-primary">Ok</button>');
    track();
    expect(dc.dismiss()).toBe(true);
    expect(clicks).toEqual(['Cancelar']);

    dialog('<button class="bg-primary">Listo</button>');
    expect(dc.dismiss()).toBe(false);
  });

  test('el panel role=dialog sin data-slot no es un diálogo modal', () => {
    document.body.innerHTML = '<div role="dialog"><button class="bg-primary">Ver cámara</button></div>';
    expect(dc.primary()).toBeNull();
  });

  test('con dos diálogos apilados manda el de arriba', () => {
    document.body.innerHTML =
      '<div data-slot="dialog-content"><div data-slot="dialog-footer"><button class="bg-primary">Abajo</button></div></div>' +
      '<div data-slot="dialog-content"><div data-slot="dialog-footer"><button class="bg-primary">Arriba</button></div></div>';
    expect(dc.primary()?.textContent).toBe('Arriba');
  });
});
