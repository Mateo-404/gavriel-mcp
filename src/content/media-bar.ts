/**
 * Reproductor de música dentro de la barra de arriba de Gavriel, junto a «Tiempo real».
 *
 * Cómo está armada la barra (verificado en la página): `#topbar-actions` contiene un
 * `div.gv-scope.monitoring-panel` con, en orden, el texto «Tiempo real», el botón del parlante y
 * `div.monitoring-panel-view-buttonset` (grilla/mapa). El reproductor va entre el parlante y ese
 * grupo, con el mismo borde redondeado y los colores de la página (variables CSS de Gavriel).
 *
 * En reposo es una píldora chica (ecualizador, tema y banda). Al pasar el mouse (o con el teclado) se
 * abre debajo un panel con los controles: nada de eso pesa mientras no se lo mira (solo CSS).
 *
 * En las demás pantallas `#topbar-actions` está vacío y el reproductor va ahí solo.
 *
 * Solo aparece si hay una pestaña de Spotify Web o YouTube Music abierta (ver music.ts y
 * media-router.ts). Las animaciones (ecualizador y título que se desplaza) se apagan con el
 * interruptor de Ajustes y con «reducir movimiento» del sistema.
 */
import { type MediaAction, type TabMedia, SOURCE_LABELS, formatTime, nextTab, pickActive } from '../shared/media';

const BAR = '#topbar-actions .monitoring-panel';
/** En el resto de las pantallas (Tickets, Cuentas…) la barra existe pero está vacía: se usa ese contenedor. */
const ANY_SCREEN = '#topbar-actions';
/** En una cuenta no hay #topbar-actions: el grupo de la derecha del encabezado (mapa, avisos, usuario) sí existe. */
const TOPBAR_RIGHT = '.layout-topbar > * > :last-child';
const BUTTONSET = '.monitoring-panel-view-buttonset';

const ICONS = {
  prev: '<path d="M19 20 9 12l10-8v16Z"/><path d="M5 19V5"/>',
  next: '<path d="m5 4 10 8-10 8V4Z"/><path d="M19 5v14"/>',
  play: '<path d="M6 3 20 12 6 21V3Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  back: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  fwd: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  swap: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
} as const;

type IconName = keyof typeof ICONS;

function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', name === 'play' || name === 'pause' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name]; // constantes de este archivo, no datos externos
  return svg;
}

function button(label: string, name: IconName, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `gv-media-btn ${cls}`.trim();
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(name));
  return b;
}

export interface MediaBarDeps {
  send: (message: { type: 'media-command'; tabId: number; action: MediaAction; value?: number }) => void;
}

export interface MediaBar {
  /** Nuevo estado de las pestañas de música. */
  update: (tabs: TabMedia[]) => void;
  /** Vuelve a ubicar el reproductor si la barra se redibujó. */
  ensureMounted: () => void;
  /** Pausa o reanuda la canción (Ctrl+Espacio). false si no hay ninguna pestaña de música conocida. */
  togglePlayback: () => boolean;
  setEnabled: (on: boolean) => void;
  /** Para pruebas. */
  root: HTMLElement;
}

export function createMediaBar({ send }: MediaBarDeps): MediaBar {
  let tabs: TabMedia[] = [];
  let preferred: number | undefined;
  let enabled = true;
  let current: TabMedia | null = null;
  let renderedKey = '';

  const root = document.createElement('div');
  root.className = 'gv-media';
  root.setAttribute('data-gv-hint', ''); // lo dibuja la extensión: los observadores lo ignoran
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Reproductor de música');

  const face = document.createElement('div');
  face.className = 'gv-media-face';

  const eq = document.createElement('span');
  eq.className = 'gv-eq';
  eq.setAttribute('aria-hidden', 'true');
  eq.innerHTML = '<i></i><i></i><i></i>';

  /** Carátula: la misma imagen se usa en la píldora, en el panel y (desenfocada) de fondo del panel. */
  const artImg = (cls: string): HTMLImageElement => {
    const img = document.createElement('img');
    img.className = cls;
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer'; // no se le cuenta a Spotify/YouTube desde qué página se ve
    img.hidden = true;
    img.addEventListener('error', () => setArt(''));
    return img;
  };
  const cover = artImg('gv-media-art');
  const popArt = artImg('gv-pop-art');
  const ambient = artImg('gv-pop-ambient');
  const lead = document.createElement('span');
  lead.className = 'gv-media-lead';
  const setArt = (src: string): void => {
    for (const img of [cover, popArt, ambient]) {
      if (src) {
        if (img.getAttribute('src') !== src) img.src = src;
      } else img.removeAttribute('src');
      img.hidden = !src;
    }
    root.classList.toggle('gv-has-art', !!src);
  };

  const text = document.createElement('div');
  text.className = 'gv-media-text';
  const title = document.createElement('span');
  title.className = 'gv-media-title';
  const sub = document.createElement('span');
  sub.className = 'gv-media-sub';
  text.append(title, sub);

  const line = document.createElement('i');
  line.className = 'gv-media-line';
  line.setAttribute('aria-hidden', 'true');
  lead.append(cover);
  face.append(lead, text, eq, line);

  const back = button('Retroceder 5 segundos', 'back');
  const fwd = button('Adelantar 5 segundos', 'fwd');
  const prev = button('Anterior', 'prev');
  const toggle = button('Reproducir', 'play', 'gv-media-play');
  const next = button('Siguiente', 'next');
  const mute = button('Silenciar', 'volume');
  const swap = button('Cambiar de reproductor', 'swap', 'gv-media-swap');

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '1';
  volume.className = 'gv-media-volume';
  volume.setAttribute('aria-label', 'Volumen');

  const status = document.createElement('div');
  status.className = 'gv-media-status';
  const controls = document.createElement('div');
  controls.className = 'gv-media-controls';
  controls.append(back, prev, toggle, next, fwd);

  const bar = document.createElement('div');
  bar.className = 'gv-media-progress';
  bar.setAttribute('role', 'slider');
  bar.setAttribute('aria-label', 'Posición');
  bar.setAttribute('aria-valuemin', '0');
  bar.append(document.createElement('i'));
  const tNow = document.createElement('span');
  const tEnd = document.createElement('span');
  const timeline = document.createElement('div');
  timeline.className = 'gv-media-timeline';
  timeline.append(tNow, bar, tEnd);

  const bottom = document.createElement('div');
  bottom.className = 'gv-media-bottom';
  bottom.append(mute, volume, swap);

  const pop = document.createElement('div');
  pop.className = 'gv-media-pop';
  const popTitle = document.createElement('div');
  popTitle.className = 'gv-pop-title';
  const popArtist = document.createElement('div');
  popArtist.className = 'gv-pop-artist';
  const meta = document.createElement('div');
  meta.className = 'gv-pop-meta';
  meta.append(popTitle, popArtist, status);
  const head = document.createElement('div');
  head.className = 'gv-pop-head';
  head.append(popArt, meta);
  const bg = document.createElement('div'); // recorta la carátula desenfocada sin recortar el puente invisible del panel
  bg.className = 'gv-pop-bg';
  bg.append(ambient);
  pop.append(bg, head, timeline, controls, bottom);

  root.append(face, pop);

  const act = (action: MediaAction, value?: number): void => {
    if (current) send({ type: 'media-command', tabId: current.tabId, action, ...(value === undefined ? {} : { value }) });
  };
  back.addEventListener('click', () => act('skip', -5));
  fwd.addEventListener('click', () => act('skip', 5));
  prev.addEventListener('click', () => act('prev'));
  next.addEventListener('click', () => act('next'));
  toggle.addEventListener('click', () => act('toggle'));
  mute.addEventListener('click', () => act('mute'));
  swap.addEventListener('click', () => {
    preferred = nextTab(tabs, current?.tabId);
    render();
  });
  let volumeTimer: ReturnType<typeof setTimeout> | undefined;
  volume.addEventListener('input', () => {
    volume.style.setProperty('--gv-v', `${volume.value}%`);
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => act('volume', Number(volume.value) / 100), 60);
  });
  bar.addEventListener('click', (event) => {
    if (!current || current.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    act('seek', Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * current.duration);
  });

  const setIcon = (b: HTMLButtonElement, name: IconName, label: string): void => {
    b.setAttribute('aria-label', label);
    b.title = label;
    b.replaceChildren(icon(name));
  };

  /** Posición con la que se dibuja la barra: avanza sola entre mensajes mientras suena. */
  const livePosition = (): number => {
    if (!current) return 0;
    const advanced = current.playing ? (Date.now() - current.at) / 1000 : 0;
    return Math.min(current.duration || Infinity, current.position + advanced);
  };

  /** El avance se dibuja con una sola variable CSS (transform, sin relayout); los textos solo si el panel está abierto. */
  const paintProgress = (): void => {
    if (!current || current.duration <= 0) {
      root.style.setProperty('--gv-p', '0');
      return;
    }
    const position = livePosition();
    root.style.setProperty('--gv-p', String(Math.min(1, position / current.duration)));
    if (root.matches(':hover, :focus-within')) {
      tNow.textContent = formatTime(position);
      tEnd.textContent = formatTime(current.duration);
      bar.setAttribute('aria-valuenow', String(Math.round(position)));
      bar.setAttribute('aria-valuemax', String(Math.round(current.duration)));
      bar.setAttribute('aria-valuetext', `${formatTime(position)} de ${formatTime(current.duration)}`);
    }
  };

  const render = (): void => {
    current = enabled ? pickActive(tabs, preferred) : null;
    if (!current) {
      root.hidden = true;
      renderedKey = '';
      return;
    }
    root.hidden = false;
    const key = `${current.tabId}|${current.title}|${current.artist}|${current.art ?? ''}|${current.playing}|${Math.round(current.volume * 100)}|${current.muted}|${tabs.length}`;
    if (key !== renderedKey) {
      renderedKey = key;
      setArt(current.art ?? '');
      title.textContent = current.title || 'Sin título';
      popTitle.textContent = current.title || 'Sin título';
      popArtist.textContent = current.artist;
      sub.textContent = [current.artist, SOURCE_LABELS[current.source]].filter(Boolean).join(' · ');
      root.title = `${current.title} — ${current.artist} (${SOURCE_LABELS[current.source]})`;
      status.textContent = `${current.playing ? 'Sonando' : 'En pausa'} · ${SOURCE_LABELS[current.source]}`;
      root.classList.toggle('gv-playing', current.playing);
      root.dataset.source = current.source;
      setIcon(toggle, current.playing ? 'pause' : 'play', current.playing ? 'Pausar' : 'Reproducir');
      setIcon(mute, current.muted || current.volume === 0 ? 'muted' : 'volume', current.muted ? 'Activar sonido' : 'Silenciar');
      volume.value = String(current.muted ? 0 : Math.round(current.volume * 100));
      volume.style.setProperty('--gv-v', `${volume.value}%`);
      swap.hidden = tabs.length < 2;
      // El título se desplaza solo si no entra
      root.classList.remove('gv-marquee');
      requestAnimationFrame(() => root.classList.toggle('gv-marquee', title.scrollWidth > text.clientWidth + 2));
    }
    paintProgress();
    syncClock();
  };

  root.addEventListener('pointerenter', paintProgress);
  root.addEventListener('focusin', paintProgress);
  // La barra de progreso avanza una vez por segundo; el reloj existe solo mientras suena (y se detiene con la pestaña oculta)
  let clock: ReturnType<typeof setInterval> | undefined;
  const syncClock = (): void => {
    const want = !!current?.playing && !root.hidden && !document.hidden;
    if (want && clock === undefined) clock = setInterval(paintProgress, 1000);
    else if (!want && clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
  };
  document.addEventListener('visibilitychange', () => {
    syncClock();
    if (!document.hidden) paintProgress();
  });

  /** Dónde va: 1) junto a «Tiempo real»; 2) la barra de acciones vacía; 3) el grupo derecho del encabezado, al comienzo. */
  const anchor = (): { container: HTMLElement; before: Element | null } | null => {
    const bar = document.querySelector<HTMLElement>(BAR);
    if (bar) return { container: bar, before: bar.querySelector(BUTTONSET) };
    const actions = document.querySelector<HTMLElement>(ANY_SCREEN);
    if (actions) return { container: actions, before: null };
    const right = document.querySelector<HTMLElement>(TOPBAR_RIGHT);
    return right ? { container: right, before: right.firstElementChild === root ? root.nextElementSibling : right.firstElementChild } : null;
  };

  const mount = (): void => {
    const target = enabled && current ? anchor() : null;
    if (!target) {
      if (root.isConnected) root.remove();
      return;
    }
    const { container, before } = target;
    const placed = root.parentElement === container && (before ? root.nextElementSibling === before : container.lastElementChild === root || container.firstElementChild === root);
    if (placed) return;
    if (before) container.insertBefore(root, before);
    else container.append(root);
  };

  return {
    root,
    update(next) {
      tabs = next;
      render();
      mount();
    },
    ensureMounted: mount,
    togglePlayback() {
      // Aunque el reproductor de la barra esté oculto, se maneja la pestaña de música que se conoce
      const target = current ?? tabs.find((t) => t.playing) ?? tabs[0];
      if (!target) return false;
      send({ type: 'media-command', tabId: target.tabId, action: 'toggle' });
      return true;
    },
    setEnabled(on) {
      enabled = on;
      render();
      mount();
    },
  };
}
