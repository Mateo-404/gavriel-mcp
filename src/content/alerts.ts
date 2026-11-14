/**
 * Manda al fondo los avisos de eventos nuevos que el usuario eligió (BUR, POW, PAN, MED, INC).
 * El filtro por tipo se aplica acá para no despertar al service worker por eventos que no interesan.
 */
import type { Settings } from '../shared/constants';
import { type Alert, isAlertType } from '../shared/event-alerts';

export interface AlertSenderDeps {
  settings: () => Promise<Pick<Settings, 'notifyEnabled' | 'notifyTypes'>>;
  send: (message: { type: 'gv-alerts'; alerts: Alert[] }) => void;
}

export function createAlertSender({ settings, send }: AlertSenderDeps): (alerts: Alert[]) => Promise<void> {
  return async (alerts) => {
    const { notifyEnabled, notifyTypes } = await settings();
    if (!notifyEnabled) return;
    const wanted = alerts.filter((alert) => isAlertType(alert.type) && notifyTypes.includes(alert.type));
    if (wanted.length > 0) send({ type: 'gv-alerts', alerts: wanted });
  };
}
