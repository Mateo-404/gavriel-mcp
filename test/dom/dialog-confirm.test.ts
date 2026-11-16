import { beforeEach, describe, expect, test } from 'bun:test';
import { createDialogConfirm, retryFor, watchInterventionEnd, whenDialogGone } from '../../src/content/dialog-confirm';

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

  describe('cierre masivo sin motivo', () => {
    // simula a React: el botón se habilita cuando el motivo deja de estar vacío
    const bulk = (reason = ''): HTMLTextAreaElement => {
      document.body.innerHTML = `<div role="dialog" data-slot="dialog-content"><h2>Cerrar Intervenciones Masivamente</h2>
        <textarea>${reason}</textarea>
        <div data-slot="dialog-footer"><button class="bg-transparent">Cancelar</button><button class="bg-primary" ${reason ? '' : 'disabled'}>Confirmar</button></div></div>`;
      const area = document.querySelector('textarea')!;
      const ok = document.querySelectorAll('button')[1]!;
      area.addEventListener('input', () => { ok.disabled = area.value.trim() === ''; });
      track();
      return area;
    };
    const fresh = () => createDialogConfirm({ visible: () => true, ownText: (el) => el.textContent?.trim() ?? '', toast: (m) => toasts.push(m) });
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

    test('motivo vacío: escribe «.» y confirma una sola vez', async () => {
      const area = bulk();
      expect(fresh().confirm()).toBe(true);
      await settle();
      expect(area.value).toBe('.');
      expect(clicks).toEqual(['Confirmar']);
      expect(toasts).toEqual([]);
    });

    test('«Dejar en observación» sin comentario: también pone «.» y confirma', async () => {
      const area = bulk();
      document.querySelector('h2')!.textContent = 'Dejar en observación';
      fresh().confirm();
      await settle();
      expect(area.value).toBe('.');
      expect(clicks).toEqual(['Confirmar']);
    });

    test('con motivo escrito se respeta y confirma normal', () => {
      const area = bulk('Falla de línea');
      fresh().confirm();
      expect(area.value).toBe('Falla de línea');
      expect(clicks).toEqual(['Confirmar']);
    });

    test('doble Ctrl+Enter no confirma dos veces', async () => {
      bulk();
      const d = fresh();
      d.confirm();
      d.confirm();
      await settle();
      expect(clicks).toEqual(['Confirmar']);
    });

    test('otros diálogos con motivo vacío no se tocan (solo se avisa)', () => {
      document.body.innerHTML = '<div role="dialog" data-slot="dialog-content"><h2>Cerrar intervención</h2><textarea></textarea><div data-slot="dialog-footer"><button>Cancelar</button><button class="bg-destructive" disabled>Cerrar Intervención</button></div></div>';
      track();
      fresh().confirm();
      expect(document.querySelector('textarea')!.value).toBe('');
      expect(clicks).toEqual([]);
      expect(toasts).toEqual(['Completá los campos para confirmar']);
    });
  });
});

describe('watchInterventionEnd', () => {
  const ends: boolean[] = [];
  const stop = watchInterventionEnd((bulk) => ends.push(bulk));
  const mount = (title: string, disabled = false): void => {
    document.body.innerHTML = `<div role="dialog" data-slot="dialog-content"><h2>${title}</h2><div data-slot="dialog-footer"><button class="bg-transparent">Cancelar</button><button class="bg-destructive" ${disabled ? 'disabled' : ''}>Confirmar</button></div></div>`;
  };
  const click = (i: number): void => document.querySelectorAll('button')[i]!.click();

  test('al confirmar «Cerrar intervención» o «Dejar en observación» avisa (con mouse o con Ctrl+Enter)', () => {
    ends.length = 0;
    mount('Cerrar intervención');
    click(1);
    mount('Dejar en observación');
    click(1);
    expect(ends).toEqual([false, false]);
  });

  test('el cierre masivo avisa como masivo', () => {
    ends.length = 0;
    mount('Cerrar Intervenciones Masivamente');
    click(1);
    expect(ends).toEqual([true]);
  });

  test('Cancelar, un botón deshabilitado u otros diálogos no avisan', () => {
    ends.length = 0;
    mount('Cerrar intervención');
    click(0);
    mount('Cerrar intervención', true);
    click(1);
    mount('Eliminar contacto');
    click(1);
    expect(ends).toEqual([]);
  });

  test('al detenerlo no avisa más', () => {
    stop();
    ends.length = 0;
    mount('Cerrar intervención');
    click(1);
    expect(ends).toEqual([]);
  });

  test('informa qué diálogo fue: masivo, cierre de un evento u observación', () => {
    const kinds: string[] = [];
    const off = watchInterventionEnd((_b, kind) => kinds.push(kind));
    for (const title of ['Cerrar Intervenciones Masivamente', 'Cerrar Intervención', 'Dejar en observación']) {
      mount(title);
      click(1);
    }
    off();
    expect(kinds).toEqual(['bulk', 'close', 'observation']);
  });
});

describe('qué se hace después de cerrar', () => {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  test('whenDialogGone espera a que el diálogo salga del DOM y recién ahí actúa', async () => {
    document.body.innerHTML = '<div id="d" data-slot="dialog-content"></div>';
    const el = document.getElementById('d')!;
    let ran = 0;
    whenDialogGone(el, () => ran++);
    await wait(10);
    expect(ran).toBe(0); // sigue abierto (procesando o con error)
    el.remove();
    await wait(10);
    expect(ran).toBe(1);
    document.body.append(document.createElement('p')); // más cambios: no vuelve a actuar
    await wait(10);
    expect(ran).toBe(1);
  });

  test('whenDialogGone abandona a los maxMs si el diálogo nunca se cierra', async () => {
    document.body.innerHTML = '<div id="d"></div>';
    const el = document.getElementById('d')!;
    let ran = 0;
    whenDialogGone(el, () => ran++, 20);
    await wait(40);
    el.remove();
    await wait(10);
    expect(ran).toBe(0);
  });

  test('retryFor reintenta hasta que el botón aparece, y no sigue para siempre', async () => {
    let tries = 0;
    retryFor(() => ++tries >= 3, 1000, 5);
    await wait(150);
    expect(tries).toBe(3); // paró al encontrarlo
    let never = 0;
    retryFor(() => (never++, false), 30, 5);
    await wait(250);
    const stopped = never;
    await wait(100);
    expect(never).toBe(stopped); // y paró al vencer el plazo
  });
});
