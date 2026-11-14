/**
 * Notificaciones del navegador por eventos nuevos (corre dentro del fondo; ver background.ts).
 *
 *  - `gv-alerts`: avisos de una pestaña de Gavriel. Se aplica el corte de avalanchas (los primeros 5 de cada
 *    ventana de 30 s y un resumen del resto).
 *  - `gv-test-alert`: el botón «Probar aviso» de Ajustes.
 *  - Al tocar un aviso se abre la cuenta (en la pestaña de Gavriel que ya existe, o en una nueva).
 */
import { ALERT_COLORS, type Alert, type AlertType, isAlertType, limitBurst } from './shared/event-alerts';
import { TEST_ALERT, accountUrl, buildNotification, buildSummary } from './shared/notification';

let sentAt: number[] = [];
const accountOf = new Map<string, string>(); // id de aviso -> cuenta, para abrirla al tocarlo

const isAlert = (value: unknown): value is Alert => {
  const a = value as Partial<Alert> | null;
  return !!a && isAlertType(a.type) && typeof a.accountId === 'string' && typeof a.code === 'string' && typeof a.added === 'number';
};

const iconCache = new Map<string, string>();

/** Ícono de la extensión teñido con el color del tipo (Chrome no permite colorear la notificación en sí). */
async function tintedIcon(type: AlertType | undefined): Promise<string> {
  const plain = chrome.runtime.getURL('icons/icon128.png');
  if (!type) return plain;
  const cached = iconCache.get(type);
  if (cached) return cached;
  try {
    const bitmap = await createImageBitmap(await (await fetch(plain)).blob());
    const canvas = new OffscreenCanvas(128, 128);
    const g = canvas.getContext('2d')!;
    g.drawImage(bitmap, 0, 0, 128, 128);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.75;
    g.fillStyle = ALERT_COLORS[type];
    g.fillRect(0, 0, 128, 128);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    iconCache.set(type, url);
    return url;
  } catch {
    return plain;
  }
}

function show(spec: { id: string; title: string; message: string; contextMessage: string; requireInteraction: boolean }, accountId?: string, type?: AlertType): void {
  if (accountId) {
    accountOf.set(spec.id, accountId);
    if (accountOf.size > 50) accountOf.delete(accountOf.keys().next().value as string);
  }
  void tintedIcon(type).then((iconUrl) => {
    chrome.notifications.create(spec.id, {
      type: 'basic',
      iconUrl,
      title: spec.title,
      message: spec.message,
      contextMessage: spec.contextMessage,
      priority: 2,
      requireInteraction: spec.requireInteraction,
    });
  });
}

export function notifyAlerts(alerts: readonly Alert[], now = Date.now()): void {
  const { show: shown, summarized, sent } = limitBurst(alerts, sentAt, now);
  sentAt = sent;
  const total = alerts.length;
  for (const alert of shown) show(buildNotification(alert, total), alert.accountId, alert.type);
  if (summarized > 0) show(buildSummary(summarized));
}

export function installNotifications(): void {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const m = message as { type?: string; alerts?: unknown } | null;
    if (m?.type === 'gv-alerts' && Array.isArray(m.alerts)) {
      notifyAlerts(m.alerts.filter(isAlert).slice(0, 200));
    } else if (m?.type === 'gv-test-alert') {
      show(buildNotification(TEST_ALERT, 0), undefined, TEST_ALERT.type);
    }
    return false;
  });

  chrome.notifications.onClicked.addListener((id) => {
    const accountId = accountOf.get(id);
    chrome.notifications.clear(id);
    const url = accountId ? accountUrl(accountId) : 'https://app.gavriel.com.ar/monitoring-panel';
    void chrome.tabs.query({ url: 'https://app.gavriel.com.ar/*' }).then((tabs) => {
      const tab = tabs[0];
      if (tab?.id !== undefined) {
        void chrome.tabs.update(tab.id, { url, active: true });
        if (tab.windowId !== undefined) void chrome.windows.update(tab.windowId, { focused: true });
      } else {
        void chrome.tabs.create({ url });
      }
    });
  });
}
