/**
 * Lecturas propias a la API de Gavriel (mundo de la página, world: MAIN). Sirven para armar el índice de cuentas y contactos
 * (ver account-index.ts).
 *
 * Usa la misma sesión que la página al cargar: la cabecera de autorización que la propia Gavriel manda en sus pedidos. Esa
 * cabecera se queda en la memoria de este mundo (ver net-tap.ts): nunca se guarda, nunca sale al mundo aislado ni a otro sitio,
 * y los pedidos van solo a `app.gavriel.com.ar`. Además:
 *  - solo `GET`, y solo a dos rutas de lectura (lista de cuentas y contactos de una cuenta);
 *  - el mundo aislado recibe el cuerpo de la respuesta y el código, nunca cabeceras.
 */
import { GAPI_REQUEST_EVENT, GAPI_RESULT_EVENT } from '../shared/constants';
import { serveRpc } from '../shared/page-rpc';

export const ALLOWED_PATH = /^\/api\/(accounts\?[A-Za-z0-9=&._-]{1,120}|account-contacts\?accountId=[A-Za-z0-9_-]{1,64})$/;

declare global {
  interface Window {
    __gvGavrielApi?: boolean;
  }
}

export function installGavrielApi(
  getAuth: () => string | undefined,
  fetchFn: typeof fetch = window.fetch.bind(window),
  doc: Document = document,
): void {
  if (window.__gvGavrielApi) return;
  window.__gvGavrielApi = true;
  serveRpc(
    { request: GAPI_REQUEST_EVENT, result: GAPI_RESULT_EVENT },
    async ({ path }) => {
      if (typeof path !== 'string' || !ALLOWED_PATH.test(path)) return undefined; // ruta no permitida: ni se pide ni se contesta
      const auth = getAuth();
      if (!auth) return { status: 0, error: 'sin-sesion' };
      try {
        const response = await fetchFn(path, { method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, credentials: 'same-origin' });
        return response.ok ? { status: response.status, body: await response.json() } : { status: response.status };
      } catch {
        return { status: 0, error: 'red' };
      }
    },
    doc,
  );
}
