import { afterEach, describe, expect, test } from 'bun:test';
import { createMediaBar } from '../../src/content/media-bar';
import { type TabMedia } from '../../src/shared/media';

const tab = (tabId: number, over: Partial<TabMedia> = {}): TabMedia => ({
  tabId,
  source: 'spotify',
  title: 'Canción de prueba',
  artist: 'Artista',
  playing: true,
  volume: 0.4,
  muted: false,
  position: 30,
  duration: 200,
  at: Date.now(),
  ...over,
});

const mountTopbar = (): HTMLElement => {
  document.body.innerHTML =
    '<div id="topbar-actions"><div class="gv-scope monitoring-panel flex"><span>Tiempo real</span><button id="spk">sonido</button>' +
    '<div class="monitoring-panel-view-buttonset">vistas</div></div></div>';
  return document.querySelector<HTMLElement>('#topbar-actions .monitoring-panel')!;
};

const sent: Record<string, unknown>[] = [];
const bar = createMediaBar({ send: (m) => void sent.push(m) });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  bar.update([]);
  sent.length = 0;
  document.body.innerHTML = '';
});

describe('media-bar (DOM)', () => {
  test('sin pestañas de música no se ve y no queda en la barra', () => {
    const container = mountTopbar();
    bar.update([]);
    expect(bar.root.hidden).toBe(true);
    expect(container.contains(bar.root)).toBe(false);
  });

  test('con música aparece entre el parlante y el selector de vistas, con título y artista', () => {
    const container = mountTopbar();
    bar.update([tab(1)]);
    expect(bar.root.hidden).toBe(false);
    expect([...container.children].map((c) => c.id || c.className.split(' ')[0] || c.tagName)).toEqual([
      'SPAN',
      'spk',
      'gv-media',
      'monitoring-panel-view-buttonset',
    ]);
    expect(bar.root.querySelector('.gv-media-title')!.textContent).toBe('Canción de prueba');
    expect(bar.root.querySelector('.gv-media-sub')!.textContent).toBe('Artista · Spotify');
    expect(bar.root.classList.contains('gv-playing')).toBe(true);
  });

  test('los botones mandan el pedido a la pestaña que suena', () => {
    mountTopbar();
    bar.update([tab(7)]);
    const click = (label: string): void => (bar.root.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();
    click('Anterior');
    click('Pausar');
    click('Siguiente');
    click('Silenciar');
    expect(sent).toEqual([
      { type: 'media-command', tabId: 7, action: 'prev' },
      { type: 'media-command', tabId: 7, action: 'toggle' },
      { type: 'media-command', tabId: 7, action: 'next' },
      { type: 'media-command', tabId: 7, action: 'mute' },
    ]);
  });

  test('el botón principal cambia entre reproducir y pausar según el estado', () => {
    mountTopbar();
    bar.update([tab(1, { playing: false })]);
    expect(bar.root.querySelector('.gv-media-play')!.getAttribute('aria-label')).toBe('Reproducir');
    bar.update([tab(1, { playing: true })]);
    expect(bar.root.querySelector('.gv-media-play')!.getAttribute('aria-label')).toBe('Pausar');
    expect(bar.root.classList.contains('gv-playing')).toBe(true);
  });

  test('el volumen manda un valor entre 0 y 1 (con una espera corta para no saturar)', async () => {
    mountTopbar();
    bar.update([tab(3)]);
    const slider = bar.root.querySelector<HTMLInputElement>('.gv-media-volume')!;
    expect(slider.value).toBe('40');
    slider.value = '75';
    slider.dispatchEvent(new Event('input'));
    slider.value = '80';
    slider.dispatchEvent(new Event('input'));
    await sleep(120);
    expect(sent).toEqual([{ type: 'media-command', tabId: 3, action: 'volume', value: 0.8 }]);
  });

  test('con dos reproductores elige el que suena y permite cambiar a mano', () => {
    mountTopbar();
    bar.update([tab(1, { playing: false, title: 'Pausada' }), tab(2, { source: 'ytmusic', title: 'Sonando' })]);
    expect(bar.root.querySelector('.gv-media-title')!.textContent).toBe('Sonando');
    expect(bar.root.querySelector('.gv-media-sub')!.textContent).toContain('YouTube Music');
    const swap = bar.root.querySelector<HTMLButtonElement>('.gv-media-swap')!;
    expect(swap.hidden).toBe(false);
    // la elegida a mano solo manda si suena o si ninguna suena: con otra sonando, sigue la que suena
    swap.click();
    expect(bar.root.querySelector('.gv-media-title')!.textContent).toBe('Sonando');
    bar.update([tab(1, { playing: false, title: 'Pausada' }), tab(2, { playing: false, title: 'Pausada 2' })]);
    swap.click();
    expect(['Pausada', 'Pausada 2']).toContain(bar.root.querySelector('.gv-media-title')!.textContent!);
  });

  test('apagado desde Ajustes desaparece, y vuelve al encenderlo', () => {
    const container = mountTopbar();
    bar.update([tab(1)]);
    bar.setEnabled(false);
    expect(container.contains(bar.root)).toBe(false);
    bar.setEnabled(true);
    expect(container.contains(bar.root)).toBe(true);
  });

  test('si Gavriel redibuja la barra, el reproductor se vuelve a ubicar', () => {
    mountTopbar();
    bar.update([tab(1)]);
    const fresh = mountTopbar(); // la pantalla creó una barra nueva
    expect(fresh.contains(bar.root)).toBe(false);
    bar.ensureMounted();
    expect(fresh.contains(bar.root)).toBe(true);
  });

  test('la barra de progreso reparte la posición y un clic busca ese punto', () => {
    mountTopbar();
    bar.update([tab(5, { position: 50, duration: 200, playing: false })]);
    const fill = bar.root.querySelector<HTMLElement>('.gv-media-progress i')!;
    expect(fill.style.width).toBe('25%');
    const progress = bar.root.querySelector<HTMLElement>('.gv-media-progress')!;
    progress.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 3, height: 3, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    progress.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    expect(sent).toEqual([{ type: 'media-command', tabId: 5, action: 'seek', value: 100 }]);
  });
});

test('adelantar y retroceder 5 segundos mandan skip', () => {
  mountTopbar();
  bar.update([tab(9)]);
  (bar.root.querySelector('[aria-label="Adelantar 5 segundos"]') as HTMLElement).click();
  (bar.root.querySelector('[aria-label="Retroceder 5 segundos"]') as HTMLElement).click();
  expect(sent).toEqual([
    { type: 'media-command', tabId: 9, action: 'skip', value: 5 },
    { type: 'media-command', tabId: 9, action: 'skip', value: -5 },
  ]);
});
