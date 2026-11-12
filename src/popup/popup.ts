/**
 * Popup. Todo se guarda en chrome.storage.local; las páginas de Gavriel
 * (bridge.ts / shortcuts.ts) reaccionan al cambio al instante.
 */
import { FRIENDLY_SOUND_NAMES, type Settings } from '../shared/constants';
import { readSetting, readSettings, touches, writeSettings } from '../shared/storage';

interface Toggle {
  key: 'muteEnabled' | 'shortcutsEnabled';
  box: string;
  state: string;
  on: string;
  off: string;
}

const TOGGLES: readonly Toggle[] = [
  {
    key: 'muteEnabled',
    box: 'mute',
    state: 'state-mute',
    on: 'Se silencian los sonidos elegidos',
    off: 'Todos los sonidos habilitados',
  },
  {
    key: 'shortcutsEnabled',
    box: 'keys',
    state: 'state-keys',
    on: 'Atajos activos',
    off: 'Atajos desactivados',
  },
];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en popup.html`);
  return el as T;
};

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

for (const toggle of TOGGLES) {
  const box = $<HTMLInputElement>(toggle.box);
  const state = $<HTMLElement>(toggle.state);

  const render = (on: boolean): void => {
    box.checked = on;
    state.textContent = on ? toggle.on : toggle.off;
    if (toggle.key === 'muteEnabled') $('sounds').classList.toggle('off', !on);
  };

  void readSetting(toggle.key).then(render);
  box.addEventListener('change', () => {
    void writeSettings({ [toggle.key]: box.checked });
    render(box.checked);
  });
}

// ---- Lista de sonidos: uno por archivo de /sounds/ que Gavriel reproduce ----
const list = $<HTMLUListElement>('sound-list');

const label = (name: string): string =>
  FRIENDLY_SOUND_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);

function renderSounds({ knownSounds, mutedSounds }: Pick<Settings, 'knownSounds' | 'mutedSounds'>): void {
  const muted = new Set(mutedSounds);
  list.replaceChildren();

  for (const name of [...knownSounds].sort()) {
    const row = document.createElement('label');
    row.className = 'sound';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = muted.has(name);
    box.addEventListener('change', () => {
      void readSetting('mutedSounds').then((current) => {
        const chosen = new Set(current);
        if (box.checked) chosen.add(name);
        else chosen.delete(name);
        return writeSettings({ mutedSounds: [...chosen] });
      });
    });

    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'sname';
    const file = document.createElement('small');
    file.textContent = `${name}.mp3`;
    text.append(label(name), file);

    row.append(box, tick, text);
    const item = document.createElement('li');
    item.append(row);
    list.append(item);
  }
}

function loadSounds(): void {
  void readSettings().then(renderSounds);
}

loadSounds();
chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'knownSounds')) loadSounds(); // apareció un sonido nuevo
});
