/**
 * Tipografías de Gavriel (Geist y Geist Mono) servidas desde la extensión.
 *
 * Gavriel las pide a Google Fonts con un <link> que bloquea el primer dibujado. La regla de red
 * `rules/fonts.json` bloquea ese CSS (falla al instante, sin esperar a Google) y acá se inyecta el
 * mismo @font-face apuntando a los archivos de la extensión. Corre en `document_start`, antes de que
 * la página dibuje, y se apaga desde Ajustes junto con la regla.
 */
import fontFaces from '../../static/fonts/gavriel-fonts.css' with { type: 'text' };

const STYLE_ID = 'gv-fonts';

/** `url(archivo.woff2)` -> `url("<URL de la extensión>/fonts/archivo.woff2")` (sirve en Chrome y Firefox). */
export function localFontCss(css: string, resolve: (path: string) => string): string {
  return css.replace(/url\(([\w.-]+\.woff2)\)/g, (_, file: string) => `url("${resolve(`fonts/${file}`)}")`);
}

/** El <link> del CSS de Geist que Gavriel pone en su <head> (bloquea el primer dibujado). */
export const GOOGLE_FONTS_CSS = /^https:\/\/fonts\.googleapis\.com\/css2\?family=Geist/;

let observer: MutationObserver | undefined;

function dropGoogleLinks(root: ParentNode): void {
  for (const link of root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (GOOGLE_FONTS_CSS.test(link.href)) link.remove(); // sin él, el dibujado no espera a Google
  }
}

/**
 * Respaldo del bloqueo de red: si otra extensión o el navegador deja pasar el pedido (la regla de
 * `rules/fonts.json` no siempre gana), se quita el <link> apenas aparece en el documento. Así el
 * primer dibujado no espera a Google y las letras salen de la copia local inyectada.
 */
function watchGoogleLinks(on: boolean): void {
  observer?.disconnect();
  observer = undefined;
  if (!on) return;
  dropGoogleLinks(document);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLLinkElement) {
          if (GOOGLE_FONTS_CSS.test(node.href)) node.remove();
        } else if (node instanceof Element) dropGoogleLinks(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // El <head> de Gavriel es estático: pasado el análisis del documento ya no hay nada que vigilar
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      if (!observer) return; // se apagó el ajuste entre tanto
      dropGoogleLinks(document);
      observer.disconnect();
      observer = undefined;
    },
    { once: true },
  );
}

export function setLocalFonts(enabled: boolean): void {
  watchGoogleLinks(enabled);
  const existing = document.getElementById(STYLE_ID);
  if (!enabled) return existing?.remove();
  if (existing) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute('data-gv-hint', ''); // lo dibuja la extensión: los observadores lo ignoran
  style.textContent = localFontCss(fontFaces, (path) => chrome.runtime.getURL(path));
  document.documentElement.append(style);
}
