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

export function setLocalFonts(enabled: boolean): void {
  const existing = document.getElementById(STYLE_ID);
  if (!enabled) return existing?.remove();
  if (existing) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.setAttribute('data-gv-hint', ''); // lo dibuja la extensión: los observadores lo ignoran
  style.textContent = localFontCss(fontFaces, (path) => chrome.runtime.getURL(path));
  document.documentElement.append(style);
}
