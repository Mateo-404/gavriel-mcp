import { parseContactName } from './labels';

/** A quién se está llamando (lo que muestra la tarjeta flotante). */
export interface CalledContact {
  name: string;
  /** Rol o descripción del contacto ("Dueño Alarma General"); vacío si no tiene. */
  description: string;
  /** Solo dígitos y +; vacío si no se conoce. */
  phone: string;
}

const NUMBERED = /^\d+\.\s+\S/;
const PHONE_LINE = /^\+?[\d\s().-]{6,}$/;

/** Solo los dígitos de un teléfono. */
export const digitsOf = (value: string): string => value.replace(/\D/g, '');

/** ¿Son el mismo teléfono? Compara los últimos 10 dígitos (ignora 0, 15, +54, espacios…). */
export function samePhone(a: string, b: string): boolean {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (x.length < 6 || y.length < 6) return false;
  const n = Math.min(10, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

/**
 * Contacto a partir de las líneas de texto de su tarjeta o de su ítem del menú. Gavriel muestra:
 * nombre (con "N. " delante en la lista), etiqueta "SMS", teléfono y descripción, en distinto orden
 * según la pantalla; por eso se reconocen por su forma y no por su posición.
 */
export function parseContactLines(lines: readonly string[]): CalledContact | null {
  let clean = lines.map((l) => l.trim()).filter(Boolean);
  // En la lista el nombre lleva «N. » delante. Si la tarjeta solo tiene un contacto, subir de nivel puede arrastrar
  // el encabezado («Contactos de emergencia») o el contacto siguiente: se recorta al bloque del contacto numerado.
  const numbered = clean.findIndex((l) => NUMBERED.test(l));
  if (numbered >= 0) {
    const next = clean.findIndex((l, i) => i > numbered && NUMBERED.test(l));
    clean = clean.slice(numbered, next < 0 ? undefined : next);
  }
  const first = clean[0];
  if (!first) return null;
  const name = parseContactName(first);
  if (!name) return null;
  const rest = clean.slice(1).filter((l) => !/^sms$/i.test(l));
  const phoneLine = rest.find((l) => PHONE_LINE.test(l));
  const description = rest.filter((l) => l !== phoneLine).join(' · ');
  return { name, description, phone: phoneLine ? phoneLine.replace(/[^\d+]/g, '') : '' };
}

/** Igual que parseContactLines, desde un texto con saltos de línea. */
export const parseContactText = (text: string): CalledContact | null => parseContactLines(text.split('\n'));
