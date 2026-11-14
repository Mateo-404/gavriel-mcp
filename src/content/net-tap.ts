/**
 * Escucha pasiva de dos respuestas que Gavriel ya recibe (mundo de la página, world: MAIN):
 * el historial de llamadas (`/api/sip/calls`) y la cuenta (`/api/accounts/<id>`).
 *
 * No hace pedidos propios, no lee ni envía el token de sesión y no cambia lo que recibe la página:
 * `fetch` devuelve la misma respuesta (se lee una copia) y en XHR solo se agrega un oyente de fin.
 * Lo que sale hacia el mundo aislado es mínimo y ya filtrado (ver shared/gavriel-data.ts): nombre,
 * dirección, contactos y llamadas; nunca cabeceras, tokens ni las URLs firmadas de las grabaciones.
 *
 * Como el script aislado puede arrancar después de que llegaron los datos, se guarda la última
 * versión de cada respuesta y se reenvía cuando el aislado lo pide (evento de repetición).
 */
import { TAP_EVENT, TAP_REPLAY_EVENT } from '../shared/constants';
import { ResponseCache, isApiPath, isMutation } from '../shared/dedupe';
import { classifyUrl, parseAccount, parseCalls } from '../shared/gavriel-data';
import { serveFromCache } from './xhr-dedupe';

declare global {
  interface XMLHttpRequest {
    __gvUrl?: string;
    __gvMethod?: string;
    __gvAuth?: string;
  }
}

/** Interruptor de Ajustes (bridge.ts lo refleja en <html>). */
const dedupeOn = (): boolean => document.documentElement.hasAttribute('data-gv-dedupe');

export function installNetTap(): void {
  const responses = new ResponseCache();
  const latest = new Map<string, string>(); // 'calls' | 'account:<id>' -> detalle ya serializado

  const emit = (key: string, detail: string): void => {
    latest.set(key, detail);
    if (latest.size > 20) latest.delete(latest.keys().next().value as string); // las cuentas viejas se olvidan
    document.dispatchEvent(new CustomEvent(TAP_EVENT, { detail }));
  };

  const handle = (url: string, body: unknown): void => {
    try {
      const kind = classifyUrl(url);
      if (kind === 'calls') {
        emit('calls', JSON.stringify({ kind, calls: parseCalls(body) }));
      } else if (kind === 'account') {
        const account = parseAccount(body);
        if (account) emit(`account:${account.id}`, JSON.stringify({ kind, account }));
      }
    } catch {
      // una respuesta inesperada nunca debe afectar a la página
    }
  };

  const originalFetch = window.fetch;
  const patchedFetch = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    const result = originalFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (classifyUrl(url)) {
        void result.then((response) => (response.ok ? response.clone().json().then((b) => handle(url, b)) : undefined)).catch(() => {});
      }
    } catch {
      /* ignorado */
    }
    return result;
  };
  window.fetch = Object.assign(patchedFetch, originalFetch);

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    this.__gvUrl = String(url);
    this.__gvMethod = String(method);
    this.__gvAuth = undefined;
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    if (name.toLowerCase() === 'authorization') this.__gvAuth = value;
    return setHeader.call(this, name, value);
  };

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
    const url = this.__gvUrl;
    const method = this.__gvMethod ?? 'GET';
    // Cualquier escritura a la API puede cambiar lo guardado: se descarta todo
    if (url && isMutation(method) && isApiPath(url)) responses.clear();
    if (url && method.toUpperCase() === 'GET' && classifyUrl(url) === 'account' && dedupeOn()) {
      const key = ResponseCache.key(url, this.__gvAuth);
      const hit = responses.get(key);
      if (hit && serveFromCache(this, url, hit)) return; // el segundo pedido idéntico se responde desde memoria
      this.addEventListener('load', () => {
        try {
          responses.set(key, {
            status: this.status,
            statusText: this.statusText,
            text: this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response),
            headers: this.getAllResponseHeaders(),
          });
        } catch {
          /* sin cache */
        }
      });
    }
    if (url && classifyUrl(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const body = this.responseType === '' || this.responseType === 'text' ? JSON.parse(this.responseText) : this.response;
          handle(url, body);
        } catch {
          /* ignorado */
        }
      });
    }
    return send.apply(this, args);
  };

  // El script aislado pide la repetición al arrancar (puede haber llegado tarde)
  document.addEventListener(TAP_REPLAY_EVENT, () => {
    for (const detail of latest.values()) document.dispatchEvent(new CustomEvent(TAP_EVENT, { detail }));
  });
}
