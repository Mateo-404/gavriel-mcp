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
import { type TabMedia, isMediaAction, sanitizeState } from './shared/media';

const KEY = 'mediaTabs';
const STALE_MS = 15 * 60_000;

async function load(): Promise<Record<string, TabMedia>> {
  try {
    const stored = (await chrome.storage.session.get(KEY)) as Record<string, Record<string, TabMedia> | undefined>;
    return stored[KEY] ?? {};
  } catch {
    return {};
  }
}

const save = (tabs: Record<string, TabMedia>): Promise<void> => chrome.storage.session.set({ [KEY]: tabs }).catch(() => {});

function prune(tabs: Record<string, TabMedia>, now = Date.now()): TabMedia[] {
  for (const [id, tab] of Object.entries(tabs)) if (now - tab.at > STALE_MS) delete tabs[id];
  return Object.values(tabs);
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
          tabs[String(tabId)] = { ...state, tabId };
          const list = prune(tabs);
          await save(tabs);
          await broadcast(list);
        })();
      }
      return false;
    }

    if (m?.type === 'media-get') {
      void load().then((tabs) => sendResponse({ tabs: prune(tabs) }));
      return true; // respuesta asíncrona
    }

    if (m?.type === 'media-command' && typeof m.tabId === 'number' && isMediaAction(m.action)) {
      const value = typeof m.value === 'number' ? m.value : undefined;
      void chrome.tabs.sendMessage(m.tabId, { type: 'media-command', action: m.action, value }).catch(() => {});
      return false;
    }
    return false;
  });

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
