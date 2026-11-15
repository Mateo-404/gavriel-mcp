/**
 * Ruteo del reproductor dentro del fondo: junta lo que informan las pestañas de música, se lo pasa a las
 * pestañas de Gavriel y reenvía a la pestaña de música los pedidos de control.
 *
 *   pestaña de música --media-state--> fondo --media-update--> pestañas de Gavriel
 *   pestaña de Gavriel --media-command--> fondo --media-command--> pestaña de música
 *   pestaña de Gavriel --media-get--> fondo (responde con lo que hay)
 *
 * El estado se guarda en chrome.storage.session para sobrevivir a que el service worker se duerma.
 */
import { type TabMedia, isMediaAction, sameMedia, sanitizeState } from './shared/media';

const KEY = 'mediaTabs';
const STALE_MS = 15 * 60_000;
const RENEW_MS = 5 * 60_000;

/** Copia en memoria: el almacenamiento solo se lee al despertar el service worker y se escribe si algo cambió. */
let memory: Promise<Record<string, TabMedia>> | undefined;

function load(): Promise<Record<string, TabMedia>> {
  memory ??= (async () => {
    try {
      const stored = (await chrome.storage.session.get(KEY)) as Record<string, Record<string, TabMedia> | undefined>;
      return stored[KEY] ?? {};
    } catch {
      return {};
    }
  })();
  return memory;
}

const save = (tabs: Record<string, TabMedia>): Promise<void> => chrome.storage.session.set({ [KEY]: tabs }).catch(() => {});

/**
 * Lista vigente. Sin `alive`, se descartan las pestañas que hace mucho que no informan. Con `alive` (ids de las
 * pestañas de música que de verdad siguen abiertas) manda eso: una pestaña abierta se conserva aunque esté en
 * pausa y no informe nada hace rato, y una que ya no existe se descarta.
 */
export function prune(tabs: Record<string, TabMedia>, now = Date.now(), alive?: ReadonlySet<number>): TabMedia[] {
  for (const [id, tab] of Object.entries(tabs)) {
    const gone = alive ? !alive.has(Number(id)) : now - tab.at > STALE_MS;
    if (gone) delete tabs[id];
  }
  return Object.values(tabs);
}

const MUSIC_URLS = ['https://open.spotify.com/*', 'https://music.youtube.com/*'];

/** Ids de las pestañas de música abiertas ahora (se las reconoce por la dirección, sin leer su contenido). */
async function openMusicTabs(): Promise<Set<number>> {
  try {
    const tabs = await chrome.tabs.query({ url: MUSIC_URLS });
    return new Set(tabs.flatMap((t) => (t.id === undefined ? [] : [t.id])));
  } catch {
    return new Set();
  }
}

/**
 * Le pide a cada pestaña de música que informe su estado ya. Si no responde (estaba abierta antes de instalar o
 * recargar la extensión y no tiene el script) se lo inyecta; el script informa apenas arranca.
 */
async function pollMusicTabs(ids: ReadonlySet<number>): Promise<void> {
  for (const tabId of ids) {
    chrome.tabs.sendMessage(tabId, { type: 'media-poll' }).catch(() => {
      chrome.scripting?.executeScript({ target: { tabId }, files: ['content/music.js'] }).catch(() => {});
    });
  }
}

/** Avisa a todas las pestañas de Gavriel qué hay sonando. */
async function broadcast(list: TabMedia[]): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://app.gavriel.com.ar/*' });
  for (const tab of tabs) {
    if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'media-update', tabs: list }).catch(() => {});
  }
}

export function installMediaRouter(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const m = message as { type?: string; state?: unknown; tabId?: unknown; action?: unknown; value?: unknown } | null;

    if (m?.type === 'media-state' && sender.tab?.id !== undefined) {
      const state = sanitizeState(m.state);
      const tabId = sender.tab.id;
      if (state) {
        void (async () => {
          const tabs = await load();
          const before = tabs[String(tabId)];
          if (before && sameMedia(before, state)) {
            // Solo avanzó la posición: no se avisa a las pestañas. De vez en cuando se renueva lo guardado
            // para que una pestaña que sigue sonando no se descarte como vieja.
            if (state.at - before.at > RENEW_MS) {
              tabs[String(tabId)] = { ...state, tabId };
              await save(tabs);
            }
            return;
          }
          tabs[String(tabId)] = { ...state, tabId };
          const list = prune(tabs);
          await save(tabs);
          await broadcast(list);
        })();
      }
      return false;
    }

    if (m?.type === 'media-get') {
      // Una pestaña de Gavriel recién abierta: se responde con lo que hay (solo pestañas que siguen abiertas)
      // y se le pide a las de música que informen, por si estaban abiertas desde antes
      void (async () => {
        const [tabs, alive] = await Promise.all([load(), openMusicTabs()]);
        sendResponse({ tabs: prune(tabs, Date.now(), alive) });
        void pollMusicTabs(alive);
      })();
      return true; // respuesta asíncrona
    }

    if (m?.type === 'media-command' && typeof m.tabId === 'number' && isMediaAction(m.action)) {
      const value = typeof m.value === 'number' ? m.value : undefined;
      void chrome.tabs.sendMessage(m.tabId, { type: 'media-command', action: m.action, value }).catch(() => {});
      return false;
    }
    return false;
  });

  // Al instalar o recargar la extensión, las pestañas de música que ya estaban abiertas se ponen al día
  chrome.runtime.onInstalled.addListener(() => void openMusicTabs().then(pollMusicTabs));

  // Una pestaña de música cerrada deja de mostrarse
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const tabs = await load();
      if (!(String(tabId) in tabs)) return;
      delete tabs[String(tabId)];
      await save(tabs);
      await broadcast(prune(tabs));
    })();
  });
}
