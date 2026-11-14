/**
 * Puente entre chrome.storage (mundo aislado) y mute.ts (mundo de la página):
 *   muteEnabled -> <html data-gavriel-mute="1|0">
 *   mutedSounds -> <html data-gavriel-muted-sounds='["alarm","siren","beep"]'>
 *   knownSounds <- evento 'gavriel:sound-seen' (los sonidos que Gavriel reproduce)
 */
import {
  DEFAULT_SETTINGS,
  MUTE_ATTR,
  MUTED_SOUNDS_ATTR,
  SOUND_NAME_PATTERN,
  SOUND_SEEN_EVENT,
  type Settings,
} from '../shared/constants';
import { readSettings, readSetting, touches, writeSettings } from '../shared/storage';
import { setLocalFonts } from './fonts';

const root = document.documentElement;

/** Interruptores visuales: el CSS (shortcuts.css) actúa según estos atributos de <html>. */
function applyLook(
  settings: Pick<Settings, 'hideSoundBanner' | 'plainEvents' | 'hideGridView' | 'liteMode' | 'localFonts' | 'dedupeAccount' | 'disableAnimations'>,
): void {
  setLocalFonts(settings.localFonts);
  root.toggleAttribute('data-gv-dedupe', settings.dedupeAccount);
  root.toggleAttribute('data-gv-noanim', settings.disableAnimations);
  root.toggleAttribute('data-gv-nobanner', settings.hideSoundBanner);
  root.toggleAttribute('data-gv-plain', settings.plainEvents);
  root.toggleAttribute('data-gv-nogrid', settings.hideGridView);
  root.toggleAttribute('data-gv-lite', settings.liteMode);
}

function apply(settings: Pick<Settings, 'muteEnabled' | 'mutedSounds'>): void {
  root.setAttribute(MUTE_ATTR, settings.muteEnabled ? '1' : '0');
  root.setAttribute(MUTED_SOUNDS_ATTR, JSON.stringify(settings.mutedSounds));
}

/** Estado de las reglas de red que publica el fondo: visible en <html data-gv-net> para diagnosticar. */
async function showNetStatus(): Promise<void> {
  try {
    const { netStatus } = await chrome.storage.local.get('netStatus');
    if (netStatus) root.setAttribute('data-gv-net', JSON.stringify(netStatus));
  } catch {
    /* contexto invalidado */
  }
}

async function load(): Promise<void> {
  void showNetStatus();
  const settings = await readSettings();
  apply(settings);
  applyLook(settings);
}

applyLook(DEFAULT_SETTINGS);
apply(DEFAULT_SETTINGS); // valores por defecto hasta leer lo guardado
void load();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'netStatus' in changes) void showNetStatus();
  if (touches(changes, area, 'muteEnabled', 'mutedSounds', 'hideSoundBanner', 'plainEvents', 'hideGridView', 'liteMode', 'localFonts', 'dedupeAccount', 'disableAnimations')) void load();
});

// Sonido nuevo detectado: se agrega a la lista del popup (sin silenciarlo)
document.addEventListener(SOUND_SEEN_EVENT, (event) => {
  const detail = (event as CustomEvent<unknown>).detail;
  const name = typeof detail === 'string' ? detail.toLowerCase() : '';
  if (!SOUND_NAME_PATTERN.test(name)) return;

  void readSetting('knownSounds').then((known) => {
    if (!known.includes(name)) void writeSettings({ knownSounds: [...known, name].slice(0, 50) });
  });
});
