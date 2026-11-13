/**
 * Alt+C en una cuenta: copia «Estimado/a cliente: *<cuenta>*» y «Alarma de: *<dirección>*».
 *
 * Cómo está armado Gavriel (verificado en la página):
 *  - El nombre de la cuenta es el único <h1> del encabezado.
 *  - La dirección está en la tarjeta «Localización y contacto» (`.account-analysis-detail-card`),
 *    en el <span class="account-analysis-text-wrap"> que sigue al ícono `svg.lucide-map-pin` (el título de la tarjeta también lleva ese ícono, pero con otro span), con el formato «calle, ciudad · provincia».
 */
import { formatClientMessage } from '../shared/client-message';
import { copyText } from './last-contact';

interface Deps {
  visible: (el: Element) => boolean;
  toast: (message: string) => void;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function createClientCopy({ visible, toast }: Deps): () => Promise<void> {
  const accountName = (): string => text([...document.querySelectorAll('h1')].find(visible));

  const address = (): string => {
    const card = [...document.querySelectorAll('.account-analysis-detail-card')].find((c) =>
      /Localización y contacto/.test(c.textContent ?? ''),
    );
    return text(card?.querySelector('svg.lucide-map-pin + span.account-analysis-text-wrap'));
  };

  return async () => {
    const name = accountName();
    const where = address();
    const message = formatClientMessage(name, where);
    if (!message) return toast(name ? 'No encontré la dirección de la cuenta' : 'No encontré el nombre de la cuenta');
    toast((await copyText(message)) ? `Copiado: ${name}` : 'No pude copiar al portapapeles');
  };
}
