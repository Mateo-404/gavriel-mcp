import { describe, expect, test } from 'bun:test';
import { FIREFOX_ID, FIREFOX_MIN_VERSION, forChrome, forFirefox, type Manifest } from '../manifest-targets';

const base = (await Bun.file('static/manifest.json').json()) as Manifest;

describe('manifest por navegador', () => {
  test('Chrome: solo cambia la versión, sin claves de Firefox', () => {
    const chrome = forChrome(base, '1.2.3');
    expect(chrome.version).toBe('1.2.3');
    expect(chrome.browser_specific_settings).toBeUndefined();
    expect(chrome.host_permissions).toBeUndefined();
  });

  test('Firefox: id, versión mínima, sin recolección de datos y permiso del sitio', () => {
    const ff = forFirefox(base, '1.2.3') as Manifest & {
      browser_specific_settings: { gecko: { id: string; strict_min_version: string; data_collection_permissions: { required: string[] } } };
      host_permissions: string[];
    };
    expect(ff.browser_specific_settings.gecko.id).toBe(FIREFOX_ID);
    expect(FIREFOX_ID).toMatch(/^[\w.-]+@[\w.-]+$/);
    expect(ff.browser_specific_settings.gecko.strict_min_version).toBe(FIREFOX_MIN_VERSION);
    expect(ff.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(['none']);
    expect(ff.host_permissions).toEqual(['https://app.gavriel.com.ar/*']);
  });

  test('Firefox conserva todo lo demás del manifest base', () => {
    const ff = forFirefox(base, '1.2.3');
    expect(ff.content_scripts).toEqual(base.content_scripts);
    expect(ff.permissions).toEqual(base.permissions);
    expect(ff.manifest_version).toBe(3);
  });

  test('no modifica el manifest base', () => {
    const copy = JSON.stringify(base);
    forFirefox(base, '9.9.9');
    expect(JSON.stringify(base)).toBe(copy);
  });
});
