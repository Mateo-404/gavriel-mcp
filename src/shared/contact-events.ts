/**
 * Eventos de contacto del historial de una cuenta.
 *
 * Al llamar a un contacto desde la cuenta, Gavriel registra un evento "Teléfono" cuya
 * descripción (la arma el servidor) dice, por ejemplo:
 *     Contacto vía Teléfono a Pablo Perren (3492638214)
 * Estas funciones sacan de ahí el nombre, sin el teléfono.
 */

const CALLED_CONTACT = /Contacto\s+v[ií]a\s+Tel[eé]fono\s+a\s+(.+?)(?:\s*\(\s*\+?[\d\s().-]{5,}\s*\))?\s*$/i;

/**
 * Nombre del contacto al que se llamó, o null si el texto no es de ese tipo.
 *
 * El nombre es todo lo que figura antes del teléfono final (si lo hay), así que conserva
 * apellidos y aclaraciones del propio nombre como "(hija)". Un paréntesis que no es un
 * número de teléfono forma parte del nombre.
 */
export function parseCalledContact(description: string): string | null {
  const text = description.replace(/\s+/g, ' ').trim();
  const name = CALLED_CONTACT.exec(text)?.[1]?.trim().replace(/[.,;:]+$/, '');
  return name ? name : null;
}

/** ¿La primera línea de una tarjeta del historial es la de un evento "Teléfono"? */
export function isPhoneEventTitle(firstLine: string): boolean {
  return /^\s*Tel[eé]fono\b/i.test(firstLine);
}

const EVENT_DATE = /(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/;

/** "13/11/2026, 02:02:49" -> milisegundos (hora local); null si no hay una fecha así en el texto. */
export function parseEventTimestamp(text: string): number | null {
  const m = EVENT_DATE.exec(text);
  if (!m) return null;
  const [day, month, year, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * Orden de lectura de las tarjetas: la más reciente primero. Las que no tienen fecha van al final
 * y, si empatan, se respeta el orden original (Gavriel ya lista lo más nuevo arriba).
 */
export function newestFirst<T>(items: readonly T[], timestampOf: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, time: timestampOf(item) }))
    .sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || a.index - b.index)
    .map((entry) => entry.item);
}
