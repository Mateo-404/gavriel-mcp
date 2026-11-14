import { ALERT_EMOJI, ALERT_LABELS, type Alert, type AlertType } from './event-alerts';

export interface NotificationSpec {
  /** Estable por cuenta+código+cantidad: varias pestañas de Gavriel producen el mismo id y Chrome lo reemplaza. */
  id: string;
  title: string;
  message: string;
  contextMessage: string;
  /** Las emergencias quedan en pantalla hasta que se las atiende; la energía se va sola. */
  requireInteraction: boolean;
  accountId: string;
}

const EMERGENCY: readonly AlertType[] = ['BUR', 'PAN', 'MED', 'INC'];

export function buildNotification(alert: Alert, total: number): NotificationSpec {
  const more = alert.added > 1 ? ` (+${alert.added})` : '';
  const who = alert.accountNumber ? `${alert.accountName} · #${alert.accountNumber}` : alert.accountName;
  return {
    id: `gv-alert-${alert.accountId}-${alert.code}-${total}`,
    title: `${ALERT_EMOJI[alert.type]} ${alert.type} · ${ALERT_LABELS[alert.type]}${more}`,
    message: who || 'Cuenta sin nombre',
    contextMessage: [alert.code, alert.codeName, alert.zone && `Zona ${alert.zone}`].filter(Boolean).join(' · '),
    requireInteraction: EMERGENCY.includes(alert.type),
    accountId: alert.accountId,
  };
}

export function buildSummary(count: number): Pick<NotificationSpec, 'id' | 'title' | 'message' | 'contextMessage' | 'requireInteraction'> {
  return {
    id: 'gv-alert-resumen',
    title: `${count} eventos más en Gavriel`,
    message: 'Entraron muchos eventos juntos; se muestran los primeros y este resumen del resto.',
    contextMessage: 'Abrí el panel de monitoreo',
    requireInteraction: true,
  };
}

/** Dirección de la cuenta a la que se llega al tocar el aviso. */
export const accountUrl = (accountId: string): string =>
  `https://app.gavriel.com.ar/monitoring-panel/account-analysis?accountId=${encodeURIComponent(accountId)}`;

export const TEST_ALERT: Alert = {
  type: 'BUR',
  accountId: 'prueba',
  accountName: 'AVISO DE PRUEBA',
  accountNumber: '0000',
  code: 'E130',
  codeName: 'Burglary',
  zone: '1 - PRUEBA',
  added: 1,
};
