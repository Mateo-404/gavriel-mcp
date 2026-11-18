/**
 * Puente de pedido y respuesta entre el mundo aislado y el mundo de la página (MAIN), por `CustomEvent` en `document`.
 * Es el único lugar que arma ids, JSON, timeouts y limpieza de oyentes: sip, gavriel-api y el índice de cuentas lo usan.
 *
 * Formato (igual para todos los canales): pedido `{ id, ...datos }`, respuesta `{ id, ...resultado }`, ambos como texto JSON
 * en `detail`. Lo que cruza de un mundo al otro es solo eso: cada servidor decide qué devuelve (nunca cabeceras ni el token).
 */

export interface RpcChannel {
  request: string;
  result: string;
}

/** Cliente (mundo aislado): `call(datos)` devuelve la respuesta, o null si no llegó a tiempo. */
export function createRpcClient<R extends object>(
  channel: RpcChannel,
  timeoutMs: number,
  doc: Document = document,
): (payload: Record<string, unknown>) => Promise<(R & { id: number }) | null> {
  let nextId = 1;
  return (payload) =>
    new Promise((resolve) => {
      const id = nextId++;
      const done = (value: (R & { id: number }) | null): void => {
        clearTimeout(timer);
        doc.removeEventListener(channel.result, onResult);
        resolve(value);
      };
      const onResult = (event: Event): void => {
        try {
          const reply = JSON.parse(String((event as CustomEvent<unknown>).detail)) as R & { id?: number };
          if (reply.id === id) done(reply as R & { id: number });
        } catch {
          /* respuesta ajena o rota */
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      doc.addEventListener(channel.result, onResult);
      doc.dispatchEvent(new CustomEvent(channel.request, { detail: JSON.stringify({ id, ...payload }) }));
    });
}

/**
 * Servidor (mundo de la página): para cada pedido válido llama a `handle(datos)` y manda lo que devuelva con el mismo id.
 * Si `handle` devuelve `undefined` el pedido se ignora (no se contesta).
 */
export function serveRpc(
  channel: RpcChannel,
  handle: (payload: Record<string, unknown>) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>,
  doc: Document = document,
): void {
  doc.addEventListener(channel.request, (event) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String((event as CustomEvent<unknown>).detail)) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = payload.id;
    if (typeof id !== 'number') return;
    const reply = (result: Record<string, unknown> | undefined): void => {
      if (result) doc.dispatchEvent(new CustomEvent(channel.result, { detail: JSON.stringify({ id, ...result }) }));
    };
    void Promise.resolve(handle(payload)).then(reply, () => undefined);
  });
}
