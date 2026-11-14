const HANGUP_LABEL = /^(colgar|cortar|cortar llamada|finalizar|finalizar llamada|terminar|terminar llamada|hang ?up|end call)$/i;

/** ¿El texto de un botón es el de cortar llamada? (en Gavriel dice exactamente "Colgar") */
export function isHangupLabel(text: string | null | undefined): boolean {
  return !!text && HANGUP_LABEL.test(text.trim());
}

/**
 * Nombre de un contacto a partir del texto de su tarjeta. Gavriel lo muestra
 * como "<orden>. <nombre>" seguido de una etiqueta "SMS" en otra línea.
 */
export function parseContactName(cardText: string): string {
  const firstLine = cardText.split('\n')[0] ?? '';
  return firstLine.replace(/^\s*\d+\.\s*/, '').replace(/\s*SMS\s*$/i, '').trim();
}

/**
 * Teclas de la fila de arriba que equivalen a Alt+Shift+1…9 para elegir un filtro por tipo
 * (Alt+Q = filtro 1, Alt+W = 2, Alt+R = 3…). Se saltea la E, la D y la F: Chrome las usa con Alt.
 * Sirven donde Alt+Shift choca con el cambio de idioma del teclado de Windows.
 */
export const FILTER_LETTER_CODES: readonly string[] = ['KeyQ', 'KeyW', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];

/** Número de filtro (1–9) de una tecla de letra Alt+Q…; null si no corresponde. */
export function filterFromLetterCode(code: string): number | null {
  const index = FILTER_LETTER_CODES.indexOf(code);
  return index === -1 ? null : index + 1;
}

/** Símbolos que da Shift+1…9 (teclado español y US): sirven si el navegador no informa `code`. */
const SHIFTED_DIGITS: Readonly<Record<string, number>> = { '!': 1, '"': 2, '@': 2, '#': 3, '·': 3, $: 4, '%': 5, '&': 6, '/': 7, '(': 8, ')': 9 };

/** Dígito 1–9 con Shift apretado, por `code` o, si falta, por el símbolo de `key`. */
export function shiftedDigit(code: string, key: string): number | null {
  return digitFromKeyCode(code) ?? SHIFTED_DIGITS[key] ?? null;
}

/** Dígito 1–9 de `KeyboardEvent.code` (fila superior o teclado numérico); null si no aplica. */
export function digitFromKeyCode(code: string): number | null {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code)?.[1];
  return digit ? Number(digit) : null;
}
