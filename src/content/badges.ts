/**
 * Indicadores de teclado («Alt+1», «Ctrl+Enter», «Esc») dentro de cada componente de Gavriel.
 * Dejan exactamente los que corresponden y no tocan el DOM si ya están bien. El texto va en un atributo y lo dibuja el CSS
 * (`::after`): así el botón que lo contiene conserva exactamente su texto y otras herramientas (macros con XPath, lectores) no
 * ven nada nuevo.
 */
import { HINT_ATTR } from './page';

const TEXT_ATTR = 'data-gv-text';

export interface BadgeSpec {
  text: string;
  /** 'before': hermano anterior del anfitrión; 'inside': hijo al final del anfitrión. */
  place: 'before' | 'inside';
  /** Solo se ve mientras se mantiene Alt. */
  altOnly: boolean;
  /** Se muestra en la esquina de abajo a la derecha del anfitrión (tarjetas de eventos). */
  corner?: boolean;
}

export function createBadges() {
  const shown = new Map<Element, HTMLElement>(); // anfitrión -> indicador
  const dialogHosts = new Map<Element, string>();

  const make = (spec: BadgeSpec): HTMLElement => {
    const badge = document.createElement('kbd');
    badge.className = spec.corner ? 'gv-kbd gv-kbd--corner' : 'gv-kbd';
    badge.setAttribute(HINT_ATTR, '');
    badge.setAttribute('aria-hidden', 'true');
    if (spec.altOnly) badge.setAttribute('data-gv-altonly', '');
    badge.setAttribute(TEXT_ATTR, spec.text);
    return badge;
  };

  const place = (host: Element, badge: HTMLElement, where: BadgeSpec['place']): void => {
    if (where === 'before') host.parentElement?.insertBefore(badge, host);
    else host.append(badge);
  };

  return {
    /** Con un diálogo abierto solo se mantienen los indicadores de sus botones: principal (Ctrl+Enter) y salir (Esc). */
    syncDialog(wantedNow: ReadonlyMap<Element, string>): void {
      for (const host of [...dialogHosts.keys()]) {
        if (wantedNow.get(host) === dialogHosts.get(host)) continue;
        shown.get(host)?.remove();
        shown.delete(host);
        dialogHosts.delete(host);
      }
      for (const [host, text] of wantedNow) {
        let badge = shown.get(host);
        if (!badge) {
          badge = make({ text, place: 'inside', altOnly: false });
          shown.set(host, badge);
        }
        if (!badge.isConnected) place(host, badge, 'inside');
        dialogHosts.set(host, text);
      }
    },

    /** Deja exactamente los indicadores pedidos. */
    sync(wanted: ReadonlyMap<Element, BadgeSpec>): void {
      for (const [host, badge] of shown) {
        if (!wanted.has(host)) {
          badge.remove();
          shown.delete(host);
        }
      }
      for (const [host, spec] of wanted) {
        let badge = shown.get(host);
        if (!badge) {
          badge = make(spec);
          shown.set(host, badge);
        } else if (badge.getAttribute(TEXT_ATTR) !== spec.text) {
          badge.setAttribute(TEXT_ATTR, spec.text);
        }
        if (!badge.isConnected) place(host, badge, spec.place); // React pudo haberlo descartado al re-renderizar
      }
    },
  };
}
