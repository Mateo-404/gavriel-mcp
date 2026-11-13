/**
 * Página de ajustes (se abre en una pestaña propia desde el botón "Ajustes" del popup o desde
 * chrome://extensions). Los sonidos se manejan en el popup; acá van los atajos y las opciones de
 * cuenta. Todo se guarda al instante en chrome.storage.local y las páginas de Gavriel reaccionan solas.
 */
import { DEFAULT_SETTINGS, FRIENDLY_SOUND_NAMES, type Settings } from '../shared/constants';
import { SCOPE_TITLES, shortcutsFor, type Shortcut, type ShortcutScope } from '../shared/shortcut-catalog';
import { readSettings, touches, writeSettings } from '../shared/storage';

type SwitchKey = 'shortcutsEnabled' | 'openContactsTab' | 'revealSecrets' | 'showCallCard';

const SWITCHES: readonly { key: SwitchKey; id: string }[] = [
  { key: 'shortcutsEnabled', id: 'keys' },
  { key: 'openContactsTab', id: 'opt-contacts' },
  { key: 'revealSecrets', id: 'opt-secrets' },
  { key: 'showCallCard', id: 'opt-callcard' },
];

const SCOPES: readonly ShortcutScope[] = ['panel', 'cuenta', 'llamadas'];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en options.html`);
  return el as T;
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

// ---------- Aviso "Guardado" ----------

let savedTimer: number | undefined;
function flashSaved(): void {
  const saved = $('saved');
  saved.textContent = 'Guardado';
  saved.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.remove('on'), 1600);
}

// ---------- Catálogo de atajos ----------

function renderKeys(shortcut: Shortcut): HTMLElement {
  const keys = element('span', 'keys');
  shortcut.keys.forEach((key, index) => {
    if (index > 0 && shortcut.chord) keys.append(element('span', 'plus', '+'));
    keys.append(element('kbd', undefined, key));
  });
  return keys;
}

function renderCatalog(): void {
  const catalog = $('catalog');
  catalog.replaceChildren();
  for (const scope of SCOPES) {
    const group = element('section', 'scope');
    const head = element('div', 'scope-head');
    head.append(element('h3', undefined, SCOPE_TITLES[scope].title), element('span', 'where', SCOPE_TITLES[scope].where));

    const list = element('ul');
    for (const shortcut of shortcutsFor(scope)) {
      const item = element('li');
      item.append(renderKeys(shortcut), element('span', 'desc', shortcut.description));
      list.append(item);
    }
    group.append(head, list);
    catalog.append(group);
  }
}

// ---------- Interruptores ----------

function render(settings: Settings): void {
  for (const { key, id } of SWITCHES) $<HTMLInputElement>(id).checked = settings[key];
  $('keys-state').textContent = settings.shortcutsEnabled ? 'Activados' : 'Desactivados';
  $('catalog').classList.toggle('off', !settings.shortcutsEnabled);
  renderSoundSummary(settings);
}

function renderSoundSummary(settings: Settings): void {
  const summary = $('sounds-summary');
  summary.replaceChildren();
  if (!settings.muteEnabled) {
    summary.append('El silenciador está ', element('strong', undefined, 'apagado'), ': todos los sonidos se escuchan.');
    return;
  }
  const label = (name: string): string => FRIENDLY_SOUND_NAMES[name] ?? name;
  const muted = settings.mutedSounds.map(label);
  if (muted.length === 0) {
    summary.append('No hay ningún sonido elegido para silenciar.');
    return;
  }
  summary.append('Se silencian en el panel: ', element('strong', undefined, muted.join(', ')), '.');
}

for (const { key, id } of SWITCHES) {
  $<HTMLInputElement>(id).addEventListener('change', (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    void writeSettings({ [key]: checked }).then(async () => {
      render(await readSettings());
      flashSaved();
    });
  });
}

// ---------- Restablecer (con confirmación dentro de la página) ----------

const resetAsk = $('reset-ask');
const resetConfirm = $('reset-confirm');
const showResetConfirm = (confirming: boolean): void => {
  resetAsk.hidden = confirming;
  resetConfirm.hidden = !confirming;
  if (confirming) $('reset-no').focus();
  else $('reset').focus();
};

$('reset').addEventListener('click', () => showResetConfirm(true));
$('reset-no').addEventListener('click', () => showResetConfirm(false));
$('reset-yes').addEventListener('click', () => {
  void writeSettings({
    shortcutsEnabled: DEFAULT_SETTINGS.shortcutsEnabled,
    openContactsTab: DEFAULT_SETTINGS.openContactsTab,
    revealSecrets: DEFAULT_SETTINGS.revealSecrets,
    showCallCard: DEFAULT_SETTINGS.showCallCard,
  }).then(async () => {
    render(await readSettings());
    showResetConfirm(false);
    flashSaved();
  });
});

// ---------- Inicio ----------

$('version').textContent = `Gavriel Tools v${chrome.runtime.getManifest().version}`;
renderCatalog();
void readSettings().then(render);

// Si algo cambia desde otro lado (el popup, otra pestaña), esta página se actualiza sola
chrome.storage.onChanged.addListener((changes, area) => {
  if (touches(changes, area, 'shortcutsEnabled', 'openContactsTab', 'revealSecrets', 'showCallCard', 'muteEnabled', 'mutedSounds')) {
    void readSettings().then(render);
  }
});
