/**
 * Bloqueo de las notificaciones push de Gavriel (Firebase Cloud Messaging). Corre en el mundo de la página.
 *
 * Gavriel se suscribe con `pushManager.subscribe` y registra el token en Firebase. Con el interruptor activo
 * (atributo `data-gv-nopush` de <html>, lo pone bridge.ts) la suscripción nueva se rechaza como si el usuario
 * hubiera negado el permiso, y la que ya existía se da de baja. Los pedidos a Firebase los bloquean además las
 * reglas de red (static/rules/push.json). Las notificaciones de la extensión no dependen de nada de esto.
 */
export const NOPUSH_ATTR = 'data-gv-nopush';

interface Sub {
  unsubscribe: () => Promise<boolean>;
}
interface Registration {
  pushManager: { getSubscription: () => Promise<Sub | null> };
}
export interface PushEnv {
  proto?: { subscribe?: (...args: never[]) => Promise<unknown> };
  workers?: { getRegistrations: () => Promise<readonly Registration[]> };
}

export function installPushGuard(
  root: Element,
  env: PushEnv = {
    proto: typeof PushManager === 'undefined' ? undefined : (PushManager.prototype as unknown as PushEnv['proto']),
    workers: typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
  },
): { sweep: () => Promise<number> } {
  const blocked = (): boolean => root.hasAttribute(NOPUSH_ATTR);
  const proto = env.proto;
  const original = proto?.subscribe;
  if (proto && original) {
    proto.subscribe = function (this: unknown, ...args: never[]) {
      if (blocked()) return Promise.reject(new DOMException('Notificaciones push bloqueadas por Gavriel Tools', 'NotAllowedError'));
      return original.apply(this, args);
    };
  }
  /** Da de baja las suscripciones push que ya existan. Devuelve cuántas. */
  const sweep = async (): Promise<number> => {
    if (!blocked() || !env.workers) return 0;
    let removed = 0;
    try {
      for (const registration of await env.workers.getRegistrations()) {
        const sub = await registration.pushManager.getSubscription();
        if (sub && (await sub.unsubscribe())) removed++;
      }
    } catch {
      /* sin service workers o sin permiso: nada que dar de baja */
    }
    return removed;
  };
  // Cuando la página terminó de arrancar ya se leyó el ajuste guardado
  if (typeof window !== 'undefined') window.addEventListener('load', () => setTimeout(() => void sweep(), 3000), { once: true });
  return { sweep };
}
