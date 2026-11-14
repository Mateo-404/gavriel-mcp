/**
 * Fondo de la extensión: mantiene al día el bloqueo de red de los sonidos elegidos.
 * Corre como service worker en Chrome y como script de fondo en Firefox; se despierta al instalar,
 * al abrir el navegador y cada vez que cambian los ajustes de sonido.
 */
import { readSettings, touches } from './shared/storage';
import { CACHE_RULESET, syncSoundRules } from './shared/sound-rules';

async function sync(): Promise<void> {
  try {
    const { mutedSounds, muteEnabled, cacheAssets } = await readSettings();
    await syncSoundRules(chrome.declarativeNetRequest, mutedSounds, muteEnabled);
    // Caché de los archivos con hash: un conjunto de reglas estáticas que se enciende o apaga
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      cacheAssets ? { enableRulesetIds: [CACHE_RULESET] } : { disableRulesetIds: [CACHE_RULESET] },
    );
  } catch (error) {
    console.warn('[Gavriel Tools] no se pudo actualizar el bloqueo de sonidos:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => void sync());
chrome.runtime.onStartup.addListener(() => void sync());
chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'mutedSounds', 'muteEnabled', 'cacheAssets')) void sync();
});
void sync(); // también al despertar el service worker
