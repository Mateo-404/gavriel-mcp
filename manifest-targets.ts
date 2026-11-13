/** Manifest de cada navegador a partir de static/manifest.json (una sola fuente de verdad). */

export type Manifest = Record<string, unknown> & { version: string };

export const FIREFOX_ID = 'gavriel-tools@gavriel-extension.local';
/** Firefox soporta `world: "MAIN"` en content scripts desde la 128. */
export const FIREFOX_MIN_VERSION = '128.0';
const SITE = 'https://app.gavriel.com.ar/*';

export function forChrome(base: Manifest, version: string): Manifest {
  return { ...base, version };
}

export function forFirefox(base: Manifest, version: string): Manifest {
  return {
    ...base,
    version,
    // Firefox exige un id para guardar datos de forma estable y, desde la 140, declarar si recolecta datos
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: { required: ['none'] },
      },
    },
    // En Firefox los permisos de sitio de un MV3 se piden aparte de los content scripts
    host_permissions: [SITE],
  };
}
