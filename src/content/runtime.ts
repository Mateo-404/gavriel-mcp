/**
 * Utilidades de robustez y rendimiento de los content scripts.
 *
 *  - alive():   ¿sigue válido el contexto de la extensión? Al recargarla desde chrome://extensions,
 *               los scripts ya inyectados quedan huérfanos y cualquier chrome.* tira
 *               "Extension context invalidated".
 *  - guard():   una falla en un manejador nunca rompe la página ni al resto de la extensión; se
 *               avisa una sola vez por consola y la próxima vez se reintenta.
 *  - watchDom(): observa cambios del DOM sin entrar en bucle con lo que la propia extensión dibuja,
 *               sin gastar nada con la pestaña oculta y apagándose solo si el contexto se invalida.
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
  return records.some(
    (r) =>
      !isOwnNode(r.target) &&
      ([...r.addedNodes, ...r.removedNodes] as Node[]).some((node) => !isOwnNode(node)),
  );
}

/**
 * Llama a `onChange` (ya agrupado por `delayMs`) cuando la página cambia, al volver a la pestaña y,
 * como red de seguridad, cada `fallbackMs` (la URL de la SPA cambia sin tocar el DOM).
 * Con la pestaña oculta no hace nada. Devuelve cómo detenerlo.
 */
export function watchDom(
  onChange: () => void,
  { delayMs, fallbackMs }: { delayMs: number; fallbackMs: number },
): () => void {
  let timer: number | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    observer.disconnect();
    clearInterval(fallback);
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', schedule);
  };

  function schedule(): void {
    if (stopped || timer !== undefined || document.hidden) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!alive()) return stop();
      onChange();
    }, delayMs);
  }

  const observer = new MutationObserver((records) => {
    if (hasForeignChange(records)) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const fallback = window.setInterval(schedule, fallbackMs);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return stop;
}
