import { type CachedResponse, headerValue } from '../shared/dedupe';

/**
 * Responde un XMLHttpRequest desde memoria, con los mismos estados y eventos que uno real
 * (readyState 2, 3 y 4, `readystatechange`, `load`, `loadend`) para que axios lo trate igual.
 * Devuelve false (sin tocar nada) si algo falla antes de empezar; el llamador manda el pedido de verdad.
 */
export function serveFromCache(xhr: XMLHttpRequest, url: string, cached: CachedResponse): boolean {
  try {
    const define = (name: string, value: unknown): void => {
      Object.defineProperty(xhr, name, { value, configurable: true, writable: true });
    };
    const fire = (type: string): void => {
      const size = cached.text.length;
      xhr.dispatchEvent(new ProgressEvent(type, { lengthComputable: true, loaded: size, total: size }));
    };
    const parsed: unknown = xhr.responseType === 'json' ? JSON.parse(cached.text) : undefined;

    define('getAllResponseHeaders', () => cached.headers);
    define('getResponseHeader', (name: string) => headerValue(cached.headers, name));
    setTimeout(() => {
      define('status', cached.status);
      define('statusText', cached.statusText);
      define('responseURL', new URL(url, location.href).href);
      define('readyState', 2);
      xhr.dispatchEvent(new Event('readystatechange'));
      define('readyState', 3);
      xhr.dispatchEvent(new Event('readystatechange'));
      define('responseText', xhr.responseType === '' || xhr.responseType === 'text' ? cached.text : '');
      define('response', xhr.responseType === 'json' ? parsed : cached.text);
      define('readyState', 4);
      xhr.dispatchEvent(new Event('readystatechange'));
      fire('load');
      fire('loadend');
    }, 0);
    return true;
  } catch {
    return false;
  }
}
