import { SOUND_NAME_PATTERN } from './constants';

/**
 * Bloqueo de red de los sonidos elegidos (declarativeNetRequest).
 *
 * Gavriel pide `/sounds/<nombre>.mp3` con `new Audio(...)`. Si el archivo se bloquea en la red, el
 * navegador ni lo descarga y Gavriel solo registra un error en consola (su código atrapa la falla:
 * `play().catch(...)` y `onerror`). Esto reemplaza al silenciado de `mute.ts` como primera defensa;
 * `mute.ts` queda como respaldo (por ejemplo para audio ya reproducido).
 */
export const SITE_HOST = 'app.gavriel.com.ar';
/** Identificadores reservados para nuestras reglas dinámicas. */
export const RULE_ID_BASE = 1;
export const MAX_RULES = 50;

export interface BlockRule {
  id: number;
  priority: number;
  action: { type: 'block' };
  condition: { urlFilter: string; initiatorDomains: string[]; resourceTypes: ('media' | 'xmlhttprequest' | 'other')[] };
}

/** Una regla por sonido silenciado; ninguna si el silenciador está apagado. Ignora nombres raros. */
export function buildRules(mutedSounds: readonly string[], enabled: boolean): BlockRule[] {
  if (!enabled) return [];
  const names = [...new Set(mutedSounds.map((s) => s.toLowerCase()))].filter((s) => SOUND_NAME_PATTERN.test(s));
  return names.slice(0, MAX_RULES).map((name, index) => ({
    id: RULE_ID_BASE + index,
    priority: 1,
    action: { type: 'block' },
    // `||dominio/ruta` ancla al dominio; el punto final deja pasar cualquier extensión (mp3, wav…)
    condition: {
      urlFilter: `||${SITE_HOST}/sounds/${name}.`,
      initiatorDomains: [SITE_HOST],
      resourceTypes: ['media', 'xmlhttprequest', 'other'],
    },
  }));
}

/** Identificador del conjunto de reglas estáticas de caché (static/rules/cache.json). */
export const CACHE_RULESET = 'cache';

/** Lo mínimo de chrome.declarativeNetRequest que se usa (permite probarlo sin navegador). */
export interface RulesApi {
  updateDynamicRules(options: { removeRuleIds: number[]; addRules: BlockRule[] }): Promise<void>;
}

/** Deja instaladas exactamente las reglas que corresponden a los ajustes. */
export async function syncSoundRules(api: RulesApi, mutedSounds: readonly string[], enabled: boolean): Promise<number> {
  const rules = buildRules(mutedSounds, enabled);
  await api.updateDynamicRules({
    removeRuleIds: Array.from({ length: MAX_RULES }, (_, i) => RULE_ID_BASE + i),
    addRules: rules,
  });
  return rules.length;
}
