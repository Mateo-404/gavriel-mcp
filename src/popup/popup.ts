/**
 * Popup: solo el sonido (interruptor general y qué sonidos silenciar). Atajos y opciones de
 * cuenta están en la página de ajustes, a la que lleva el botón "Ajustes".
 * Todo se guarda en chrome.storage.local; las páginas de Gavriel reaccionan al instante.
 */
import { FRIENDLY_SOUND_NAMES, type Settings } from '../shared/constants';
import { readSetting, readSettings, touches, writeSettings } from '../shared/storage';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en popup.html`);
  return el as T;
};

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

// ---- Ajustes: abre la página de configuración en una pestaña propia ----
$('open-settings').addEventListener('click', () => {
  // Si Chrome aún no leyó options_ui (extensión sin recargar), se abre la página directamente
  chrome.runtime.openOptionsPage().catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') })).finally(() => window.close());
});

// ---- Interruptor general ----
const muteBox = $<HTMLInputElement>('mute');
const muteState = $('state-mute');

function renderMaster(on: boolean): void {
  muteBox.checked = on;
  muteState.textContent = on ? 'Se silencian los sonidos elegidos' : 'Todos los sonidos habilitados';
  $('sounds').classList.toggle('off', !on);
}

void readSetting('muteEnabled').then(renderMaster);
muteBox.addEventListener('change', () => {
  void writeSettings({ muteEnabled: muteBox.checked });
  renderMaster(muteBox.checked);
});

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
