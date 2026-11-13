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

const root = document.documentElement;

/** Interruptores visuales: el CSS (shortcuts.css) actúa según estos atributos de <html>. */
function applyLook(settings: Pick<Settings, 'hideSoundBanner' | 'plainEvents' | 'hideGridView'>): void {
  root.toggleAttribute('data-gv-nobanner', settings.hideSoundBanner);
  root.toggleAttribute('data-gv-plain', settings.plainEvents);
  root.toggleAttribute('data-gv-nogrid', settings.hideGridView);
}

function apply(settings: Pick<Settings, 'muteEnabled' | 'mutedSounds'>): void {
  root.setAttribute(MUTE_ATTR, settings.muteEnabled ? '1' : '0');
  root.setAttribute(MUTED_SOUNDS_ATTR, JSON.stringify(settings.mutedSounds));
}

async function load(): Promise<void> {
  const settings = await readSettings();
  apply(settings);
  applyLook(settings);
}

applyLook(DEFAULT_SETTINGS);
apply(DEFAULT_SETTINGS); // valores por defecto hasta leer lo guardado
void load();

chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'muteEnabled', 'mutedSounds', 'hideSoundBanner', 'plainEvents', 'hideGridView')) void load();
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
