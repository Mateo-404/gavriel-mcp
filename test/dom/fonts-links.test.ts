import { afterEach, describe, expect, test } from 'bun:test';
import { setLocalFonts } from '../../src/content/fonts';

const GOOGLE = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const addLink = (href: string): HTMLLinkElement => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
  return link;
};

afterEach(() => {
  setLocalFonts(false);
  document.head.innerHTML = '';
});

describe('fonts: respaldo que quita el <link> de Google Fonts', () => {
  test('quita el de Geist que ya estaba y el que se agrega después, e inyecta las letras locales', async () => {
    const before = addLink(GOOGLE);
    setLocalFonts(true);
    expect(before.isConnected).toBe(false);
    const later = addLink(GOOGLE);
    await sleep(10);
    expect(later.isConnected).toBe(false);
    expect(document.getElementById('gv-fonts')?.textContent).toContain('chrome-extension://test-extension/fonts/geist-latin.woff2');
  });

  test('no toca otras hojas de estilo ni otras fuentes de Google', async () => {
    setLocalFonts(true);
    const own = addLink('https://app.gavriel.com.ar/assets/index-DshRvVl_.css');
    const other = addLink('https://fonts.googleapis.com/css2?family=Roboto');
    await sleep(10);
    expect(own.isConnected).toBe(true);
    expect(other.isConnected).toBe(true);
  });

  test('con el ajuste apagado no quita nada y saca las letras locales', async () => {
    setLocalFonts(true);
    setLocalFonts(false);
    const link = addLink(GOOGLE);
    await sleep(10);
    expect(link.isConnected).toBe(true);
    expect(document.getElementById('gv-fonts')).toBeNull();
  });
});
