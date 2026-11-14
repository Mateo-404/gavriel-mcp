/**
 * Utilidades de robustez y rendimiento de los content scripts.
 *
 *  - alive():    ¿sigue válido el contexto de la extensión? Al recargarla desde chrome://extensions,
 *                los scripts ya inyectados quedan huérfanos y cualquier chrome.* tira
 *                "Extension context invalidated".
 *  - guard():    una falla en un manejador nunca rompe la página ni al resto de la extensión; se
 *                avisa una sola vez por consola y la próxima vez se reintenta.
 *  - watchDom(): observa cambios del DOM. TODOS los suscriptores comparten un único MutationObserver
 *                (y un único respaldo): cada uno solo agrega su propio agrupado (debounce). Ignora lo
 *                que dibuja la propia extensión, no gasta nada con la pestaña oculta y se apaga solo
 *                si el contexto se invalida.
 *  - Cambios de URL: la SPA de Gavriel cambia de pantalla sin tocar el DOM. Donde existe la Navigation
 *                API (Chrome 102+) se escucha `currententrychange`, sin sondeo; si no (Firefox), un
 *                intervalo de respaldo.
 */

const OWN = '[data-gv-hint], .gv-toast, .gv-callcard';
const reported = new Set<string>();

export function alive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function guard<A extends unknown[]>(label: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    if (!alive()) return;
    try {
      fn(...args);
    } catch (error) {
      if (!reported.has(label)) {
        reported.add(label);
        console.warn(`[Gavriel Tools] ${label}:`, error);
      }
    }
  };
}

/** ¿Este nodo lo dibujó la extensión? */
export function isOwnNode(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el && el.closest(OWN) !== null;
}

/** ¿Algún cambio del DOM es de la página (y no solo de lo que dibuja la extensión)? */
export function hasForeignChange(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    if (isOwnNode(record.target)) continue;
    for (const node of record.addedNodes) if (!isOwnNode(node)) return true;
    for (const node of record.removedNodes) if (!isOwnNode(node)) return true;
  }
  return false;
}

interface NavigationLike extends EventTarget {
  readonly currentEntry?: unknown;
}

interface Subscriber {
  run: () => void;
  delayMs: number;
  timer: number | undefined;
}

const subscribers = new Set<Subscriber>();
let observer: MutationObserver | undefined;
let fallback: number | undefined;
let wired = false;

function schedule(subscriber: Subscriber): void {
  if (subscriber.timer !== undefined || document.hidden) return;
  subscriber.timer = window.setTimeout(() => {
    subscriber.timer = undefined;
    if (!alive()) return stopAll();
    subscriber.run();
  }, subscriber.delayMs);
}

const scheduleAll = (): void => subscribers.forEach(schedule);

function stopAll(): void {
  observer?.disconnect();
  observer = undefined;
  clearInterval(fallback);
  fallback = undefined;
  for (const subscriber of subscribers) clearTimeout(subscriber.timer);
  subscribers.clear();
  document.removeEventListener('visibilitychange', scheduleAll);
  (window as { navigation?: NavigationLike }).navigation?.removeEventListener('currententrychange', scheduleAll);
  wired = false;
}

function wire(fallbackMs: number): void {
  if (wired) return;
  wired = true;
  observer = new MutationObserver((records) => {
    if (hasForeignChange(records)) scheduleAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', scheduleAll);
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  if (navigation) {
    // Sin sondeo: la API avisa de cada cambio de URL; el intervalo largo es solo una red de seguridad
    navigation.addEventListener('currententrychange', scheduleAll);
    fallback = window.setInterval(scheduleAll, 15_000);
  } else {
    fallback = window.setInterval(scheduleAll, fallbackMs);
  }
}

/**
 * Llama a `onChange` (agrupado por `delayMs`) cuando la página cambia, al volver a la pestaña y al
 * cambiar la URL. Devuelve cómo dejar de suscribirse.
 */
export function watchDom(
  onChange: () => void,
  { delayMs, fallbackMs }: { delayMs: number; fallbackMs: number },
): () => void {
  const subscriber: Subscriber = { run: onChange, delayMs, timer: undefined };
  subscribers.add(subscriber);
  wire(fallbackMs);
  schedule(subscriber);
  return () => {
    clearTimeout(subscriber.timer);
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopAll();
  };
}
