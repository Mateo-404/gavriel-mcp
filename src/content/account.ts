/**
 * Valores por defecto al abrir una cuenta (/monitoring-panel/account-analysis).
 *
 *  - openContactsTab: entra directo a la pestaña "Contactos", así lo primero que se ve son los contactos.
 *  - revealSecrets:   toca el ojito de "Clave" y "Contraclave" (botones "Ver clave" / "Ver contraclave").
 *
 * Cómo está armado Gavriel (verificado en su código):
 *  - El ojito solo existe si el usuario tiene permiso para ver la clave (y la cuenta tiene clave);
 *    sin permiso o sin clave el botón no se dibuja y acá no se hace nada. Se imita exactamente el
 *    clic del usuario: nunca se oculta de nuevo ni se llama a nada por fuera de la interfaz.
 *  - Su aria-label cambia a "Ocultar clave" al mostrarse, por eso solo se busca "Ver …".
 *  - Las pestañas son Radix Tabs: se activan con mousedown/foco, no con click.
 *
 * Se aplica una sola vez por cuenta abierta y por un tiempo limitado, para no pelearse
 * con el usuario si cambia de pestaña o vuelve a ocultar la clave.
 */
import { DEFAULT_SETTINGS, type Settings } from '../shared/constants';
import { accountIdFromLocation } from '../shared/routes';
import { readSettings, touches } from '../shared/storage';

declare global {
  interface Window {
    __gvAccount?: boolean;
  }
}

const GIVE_UP_MS = 15_000;
const SECRET_BUTTONS = ['Ver clave', 'Ver contraclave'] as const;

interface Visit {
  accountId: string;
  startedAt: number;
  tabDone: boolean;
  secretsDone: Set<string>;
}

function main(): void {
  let settings: Settings = DEFAULT_SETTINGS;
  let visit: Visit | null = null;

  const ownText = (el: Element): string => (el.textContent ?? '').trim();

  const contactsTab = (): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => ownText(tab) === 'Contactos');

  /** Radix Tabs activa la pestaña con mousedown/foco. */
  const activateTab = (tab: HTMLElement): void => {
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    tab.focus({ preventScroll: true });
  };

  const apply = (): void => {
    const accountId = accountIdFromLocation(location.pathname, location.search);
    if (!accountId) {
      visit = null; // al salir de la cuenta, la próxima vez vuelve a aplicarse
      return;
    }
    if (visit?.accountId !== accountId) {
      visit = { accountId, startedAt: Date.now(), tabDone: false, secretsDone: new Set() };
    }
    if (Date.now() - visit.startedAt > GIVE_UP_MS) return;

    if (settings.openContactsTab && !visit.tabDone) {
      const tab = contactsTab();
      if (tab) {
        if (tab.getAttribute('aria-selected') !== 'true') activateTab(tab);
        visit.tabDone = true;
      }
    }

    if (settings.revealSecrets) {
      for (const label of SECRET_BUTTONS) {
        if (visit.secretsDone.has(label)) continue;
        const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        if (button && !button.disabled) {
          button.click();
          visit.secretsDone.add(label);
        }
      }
    }
  };

  let timer: number | undefined;
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      apply();
    }, 100);
  };

  void readSettings().then((loaded) => {
    settings = loaded;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (touches(changes, area, 'openContactsTab', 'revealSecrets')) {
      void readSettings().then((loaded) => {
        settings = loaded;
        schedule();
      });
    }
  });

  const start = (): void => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(schedule, 500); // también detecta el cambio de cuenta (cambia la URL, no el DOM)
    schedule();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}

if (!window.__gvAccount) {
  window.__gvAccount = true;
  main();
}
