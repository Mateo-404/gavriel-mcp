const SOUND_URL = /\/sounds\/([\w.-]{1,40}?)\.(?:mp3|wav|ogg|m4a|aac)(?:[?#]|$)/i;

/**
 * Nombre del sonido si la URL es un archivo de /sounds/ (los que reproduce
 * Gavriel con `new Audio('/sounds/<nombre>.mp3')`), o null si es otra cosa
 * (grabaciones, llamadas, data: URIs…).
 */
export function soundNameFromUrl(url: string): string | null {
  const name = SOUND_URL.exec(url)?.[1];
  return name ? name.toLowerCase() : null;
}
