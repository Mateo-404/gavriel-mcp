/**
 * Fondo de la extensión: mantiene al día el bloqueo de red de los sonidos elegidos.
 * Corre como service worker en Chrome y como script de fondo en Firefox; se despierta al instalar,
 * al abrir el navegador y cada vez que cambian los ajustes de sonido.
 */
import { readSettings, touches } from './shared/storage';
import { installNotifications } from './notifications';
import { CACHE_RULESET, FONTS_RULESET, syncSoundRules } from './shared/sound-rules';

const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;700&display=swap';

/**
 * Diagnóstico: le pregunta a Chrome qué haría con el pedido del CSS de Google Fonts (¿nuestra regla
 * coincide?). Lo que se dispara de verdad lo cuenta onRuleMatchedDebug (getMatchedRules tiene un cupo muy bajo).
 */
async function diagnoseFonts(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const test = await chrome.declarativeNetRequest.testMatchOutcome({
      url: FONTS_URL,
      initiator: 'https://app.gavriel.com.ar',
      type: 'stylesheet',
      method: 'get',
    });
    out.testMatches = test.matchedRules.map((m) => `${m.rulesetId}#${m.ruleId}`);
  } catch (error) {
    out.testError = String(error);
  }
  return out;
}

/** Deja a la vista (Ajustes y atributo de <html>) qué reglas quedaron activas, o por qué fallaron. */
async function publishStatus(error?: unknown): Promise<void> {
  try {
    const [rulesets, dynamic] = await Promise.all([
      chrome.declarativeNetRequest.getEnabledRulesets(),
      chrome.declarativeNetRequest.getDynamicRules(),
    ]);
    await chrome.storage.local.set({
      netStatus: {
        version: chrome.runtime.getManifest().version,
        rulesets,
        dynamic: dynamic.length,
        error: error ? String(error) : null,
        diag: { ...(await diagnoseFonts()), live: fired },
      },
    });
  } catch {
    /* sin estado que publicar */
  }
}

async function sync(): Promise<void> {
  try {
    const { mutedSounds, muteEnabled, cacheAssets, localFonts } = await readSettings();
    await syncSoundRules(chrome.declarativeNetRequest, mutedSounds, muteEnabled);
    // Caché de los archivos con hash: un conjunto de reglas estáticas que se enciende o apaga
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [cacheAssets && CACHE_RULESET, localFonts && FONTS_RULESET].filter((id): id is string => !!id),
      disableRulesetIds: [!cacheAssets && CACHE_RULESET, !localFonts && FONTS_RULESET].filter((id): id is string => !!id),
    });
    await publishStatus();
  } catch (error) {
    console.warn('[Gavriel Tools] no se pudo actualizar el bloqueo de sonidos:', error);
    await publishStatus(error);
  }
}

// Diagnóstico en vivo: cuántas veces se dispara cada conjunto de reglas en pedidos reales (solo extensiones
// sin empaquetar). Se publica junto con el resto del estado.
const fired: Record<string, number> = {};
let publishTimer: ReturnType<typeof setTimeout> | undefined;
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const key = `${info.rule.rulesetId}:${info.request.type}:${new URL(info.request.url).host}`;
  fired[key] = (fired[key] ?? 0) + 1;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => void publishStatus(), 800);
});

installNotifications();

chrome.runtime.onInstalled.addListener(() => void sync());
chrome.runtime.onStartup.addListener(() => void sync());
chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'mutedSounds', 'muteEnabled', 'cacheAssets', 'localFonts')) void sync();
});
void sync(); // también al despertar el service worker
