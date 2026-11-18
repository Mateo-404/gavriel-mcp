/**
 * Fondo de la extensión: mantiene al día el bloqueo de red de los sonidos elegidos.
 * Corre como service worker en Chrome y como script de fondo en Firefox; se despierta al instalar,
 * al abrir el navegador y cada vez que cambian los ajustes de sonido.
 */
import { readSettings, touches } from './shared/storage';
import { installMediaRouter } from './media-router';
import { installNotifications } from './notifications';
import { installActionGate } from './action-gate';
import { CACHE_RULESET, FONTS_RULESET, PUSH_RULESET, syncSoundRules } from './shared/sound-rules';

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
      },
    });
  } catch {
    /* sin estado que publicar */
  }
}

async function sync(): Promise<void> {
  try {
    const { mutedSounds, muteEnabled, cacheAssets, localFonts, blockPush } = await readSettings();
    await syncSoundRules(chrome.declarativeNetRequest, mutedSounds, muteEnabled);
    // Caché de los archivos con hash: un conjunto de reglas estáticas que se enciende o apaga
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [cacheAssets && CACHE_RULESET, localFonts && FONTS_RULESET, blockPush && PUSH_RULESET].filter((id): id is string => !!id),
      disableRulesetIds: [!cacheAssets && CACHE_RULESET, !localFonts && FONTS_RULESET, !blockPush && PUSH_RULESET].filter((id): id is string => !!id),
    });
    await publishStatus();
  } catch (error) {
    console.warn('[Gavriel Tools] no se pudo actualizar el bloqueo de sonidos:', error);
    await publishStatus(error);
  }
}

installNotifications();
installActionGate();
installMediaRouter();

chrome.runtime.onInstalled.addListener(() => void sync());
chrome.runtime.onStartup.addListener(() => void sync());
chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'mutedSounds', 'muteEnabled', 'cacheAssets', 'localFonts', 'blockPush')) void sync();
});
void sync(); // también al despertar el service worker
