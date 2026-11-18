/**
 * Reproductor de Spotify Web / YouTube Music en la barra de arriba (ver media-bar.ts) y su conexión con el fondo:
 * recibe el estado de las pestañas de música (`media-update`), lo pide al abrir (`media-get`) y manda las órdenes
 * (`media-command`). Deja en <html data-gv-media> cuántas pestañas se conocen (o el error), para diagnosticar.
 */
import { sanitizeTabs } from '../shared/media';
import { createMediaBar } from './media-bar';

export function createMusic() {
  const root = document.documentElement;
  const bar = createMediaBar({
    send: (message) => {
      try {
        void chrome.runtime.sendMessage(message).catch(() => {});
      } catch {
        /* contexto invalidado */
      }
    },
  });

  const show = (raw: unknown): void => {
    try {
      const tabs = sanitizeTabs(raw);
      bar.update(tabs);
      const count = String(tabs.length);
      if (root.getAttribute('data-gv-media') !== count) root.setAttribute('data-gv-media', count);
    } catch (error) {
      root.setAttribute('data-gv-media', `error: ${String(error)}`);
    }
  };

  try {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const m = message as { type?: string; tabs?: unknown } | null;
      if (m?.type === 'media-update') show(m.tabs);
      return false;
    });
    void chrome.runtime
      .sendMessage({ type: 'media-get' })
      .then((answer: { tabs?: unknown } | undefined) => show(answer?.tabs))
      .catch(() => {});
  } catch {
    /* contexto invalidado */
  }
  return bar;
}
