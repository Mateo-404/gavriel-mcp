/**
 * Cache corto en memoria para el segundo pedido idéntico de la cuenta.
 *
 * Medido al abrir una cuenta: Gavriel pide `GET /api/accounts/<id>` (360 KB sin comprimir, ~1,1 s)
 * y, cuando termina, lo vuelve a pedir igual (~1,5 s más). La tarjeta «Localización y contacto» recién
 * aparece cuando llega el segundo, sin que haya ninguna escritura entre ambos. Se responde el segundo
 * desde memoria.
 *
 * Reglas de seguridad: solo `GET` de la cuenta, solo respuestas 2xx, 10 s de vida, la clave incluye la
 * sesión (cabecera Authorization), cualquier escritura (POST/PUT/PATCH/DELETE) a /api/ lo borra todo, y
 * al responder desde memoria se quitan las cabeceras de renovación de token (no se devuelve uno viejo).
 */
export const DEDUPE_TTL_MS = 10_000;
const TOKEN_HEADERS = new Set(['x-new-token', 'x-token-expires-in', 'x-token-expires-at']);

export interface CachedResponse {
  status: number;
  statusText: string;
  text: string;
  /** Cabeceras ya filtradas, en el formato de getAllResponseHeaders(). */
  headers: string;
  at: number;
}

export const isMutation = (method: string): boolean => !/^(GET|HEAD|OPTIONS)$/i.test(method);

export function isApiPath(url: string): boolean {
  try {
    return new URL(url, 'https://app.gavriel.com.ar').pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** Quita las cabeceras de renovación de token de un bloque «nombre: valor\r\n…». */
export function sanitizeHeaders(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => line && !TOKEN_HEADERS.has(line.split(':')[0]!.trim().toLowerCase()))
    .join('\r\n') + '\r\n';
}

export function headerValue(raw: string, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && line.slice(0, at).trim().toLowerCase() === wanted) return line.slice(at + 1).trim();
  }
  return null;
}

export class ResponseCache {
  private entries = new Map<string, CachedResponse>();

  /** La clave junta la URL absoluta y la sesión: otra sesión nunca ve esta respuesta. */
  static key(url: string, authorization: string | undefined): string {
    return `${new URL(url, 'https://app.gavriel.com.ar').href}\n${authorization ?? ''}`;
  }

  get(key: string, now = Date.now()): CachedResponse | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at >= DEDUPE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, response: Omit<CachedResponse, 'at'>, now = Date.now()): void {
    if (response.status < 200 || response.status >= 300) return;
    this.entries.set(key, { ...response, headers: sanitizeHeaders(response.headers), at: now });
    if (this.entries.size > 10) this.entries.delete(this.entries.keys().next().value as string);
  }

  clear(): void {
    this.entries.clear();
  }
}
