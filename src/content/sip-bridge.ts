/**
 * Colgar, atender y rechazar llamando directamente a las funciones del softphone de Gavriel
 * (mundo de la página, world: MAIN), sin abrir el panel ni cambiar de pestaña.
 *
 * Cómo está armado Gavriel (verificado en su código):
 *  - `SipProvider` guarda la sesión de JsSIP y publica por contexto de React un objeto con
 *    `calling`, `incoming`, `call`, `hangup`, `answer`, `reject`…
 *  - El botón «Colgar» es literalmente `onClick: e.hangup`; «Atender» y «Rechazar» usan `answer`
 *    y `reject`. Llamar al mismo método es exactamente lo que hace el clic, sin el recorrido por
 *    la pantalla.
 *  - «Llamar» a un contacto NO se hace por acá: el botón de contacto primero registra la llamada
 *    en la auditoría de la cuenta (`await Gm(accountId, "phone", …)`) y recién después llama, así que
 *    esa parte se sigue haciendo con el clic real.
 *
 * Se encuentra el objeto subiendo por los fibers de React desde el <audio> oculto que renderiza el
 * propio proveedor. Si algo cambia en Gavriel y no se encuentra, la respuesta es `no-sip` y el
 * llamador usa el camino de siempre (clics en la interfaz).
 */
import { SIP_REQUEST_EVENT, SIP_RESULT_EVENT } from '../shared/constants';

type SipAction = 'hangup' | 'answer' | 'reject' | 'state';

interface SipContext {
  calling: boolean;
  incoming: unknown;
  hangup: () => void;
  answer: () => void;
  reject: () => void;
  call: unknown;
}

interface Fiber {
  return: Fiber | null;
  memoizedProps?: { value?: unknown } | null;
}

const isSipContext = (value: unknown): value is SipContext => {
  const v = value as Partial<SipContext> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.hangup === 'function' &&
    typeof v.answer === 'function' &&
    typeof v.reject === 'function' &&
    typeof v.call === 'function' &&
    'calling' in v
  );
};

const fiberOf = (el: Element): Fiber | null => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
};

/** El objeto del contexto del softphone, o null si no está (pantalla de login, otra versión…). */
export function findSipContext(root: ParentNode = document): SipContext | null {
  for (const audio of root.querySelectorAll('audio')) {
    for (let fiber = fiberOf(audio); fiber; fiber = fiber.return) {
      const value = fiber.memoizedProps?.value;
      if (isSipContext(value)) return value;
    }
  }
  return null;
}

export interface SipResult {
  id: number;
  ok: boolean;
  reason?: 'no-sip' | 'nothing-to-do' | 'error';
  calling?: boolean;
  incoming?: boolean;
}

export function runSipAction(action: SipAction, root: ParentNode = document): Omit<SipResult, 'id'> {
  const sip = findSipContext(root);
  if (!sip) return { ok: false, reason: 'no-sip' };
  const state = { calling: !!sip.calling, incoming: !!sip.incoming };
  if (action === 'state') return { ok: true, ...state };
  // Solo se actúa si hay algo que cortar o contestar: nunca se cuelga «por las dudas»
  if (action === 'hangup' && !state.calling) return { ok: false, reason: 'nothing-to-do', ...state };
  if ((action === 'answer' || action === 'reject') && !state.incoming) return { ok: false, reason: 'nothing-to-do', ...state };
  try {
    sip[action]();
    return { ok: true, ...state };
  } catch {
    return { ok: false, reason: 'error', ...state };
  }
}

declare global {
  interface Window {
    __gvSipBridge?: boolean;
  }
}

export function installSipBridge(): void {
  // Una sola vez por página: si el script se inyectara dos veces, un pedido de colgar no debe ejecutarse dos veces
  if (window.__gvSipBridge) return;
  window.__gvSipBridge = true;
  document.addEventListener(SIP_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    let request: { id?: unknown; action?: unknown };
    try {
      request = JSON.parse(detail) as { id?: unknown; action?: unknown };
    } catch {
      return;
    }
    const actions: readonly string[] = ['hangup', 'answer', 'reject', 'state'];
    if (typeof request.id !== 'number' || typeof request.action !== 'string' || !actions.includes(request.action)) return;
    const result = runSipAction(request.action as SipAction);
    document.dispatchEvent(new CustomEvent(SIP_RESULT_EVENT, { detail: JSON.stringify({ id: request.id, ...result }) }));
  });
}
