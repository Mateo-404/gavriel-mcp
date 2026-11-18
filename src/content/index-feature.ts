/**
 * Índice de cuentas y contactos (buscador a fondo en «Cuentas» y cuenta de la llamada entrante): junta el índice
 * (account-index.ts), el desplegable y el cartel (account-search-ui.ts) detrás de un interruptor.
 */
import { INDEX_META_KEY, chromeIndexStore, createAccountIndex, createApiRequester } from './account-index';
import { createIncomingBanner, createSearchUi } from './account-search-ui';
import type { SipClient } from './sip';

export function createIndexFeature({ sip, repaint }: { sip: SipClient; repaint: () => void }) {
  const root = document.documentElement;
  const setStatus = (status: string): void => {
    if (root.getAttribute('data-gv-index') !== status) root.setAttribute('data-gv-index', status); // para diagnosticar
  };
  const index = createAccountIndex({ request: createApiRequester(), store: chromeIndexStore(), onStatus: setStatus });
  const searchUi = createSearchUi({ search: index.search, size: index.size, progress: index.progress });
  const banner = createIncomingBanner({ caller: () => sip.caller(), byPhone: index.byPhone });
  let on = false;
  let started = false;
  // Otra pestaña armó o avanzó el índice guardado: se lee de nuevo
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && INDEX_META_KEY in changes && on) void index.reload();
  });

  return {
    setEnabled(next: boolean): void {
      on = next;
      if (on && !started) {
        started = true;
        // Se espera a que la página cargue y haga sus primeros pedidos (de ahí sale la sesión)
        setStatus('esperando 4 s para arrancar');
        setTimeout(() => void index.start(), 4000);
      }
      if (!on) {
        searchUi.hide();
        banner.update(false);
      }
      repaint();
    },
    /** En cada repintado: engancha el buscador y muestra u oculta el cartel de llamada entrante. */
    paint(ringing: boolean): void {
      if (!on) return;
      searchUi.attach();
      banner.update(ringing);
    },
  };
}
