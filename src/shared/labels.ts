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

/** Dígito 1–9 de `KeyboardEvent.code` (fila superior o teclado numérico); null si no aplica. */
export function digitFromKeyCode(code: string): number | null {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code)?.[1];
  return digit ? Number(digit) : null;
}
