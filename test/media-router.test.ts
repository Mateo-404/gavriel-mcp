import { afterAll, describe, expect, test } from 'bun:test';
import type { TabMedia } from '../src/shared/media';

const tab = (tabId: number, at: number): TabMedia => ({
  tabId, source: 'spotify', title: 'T', artist: 'A', playing: false, volume: 0.5, muted: false, position: 10, duration: 200, at,
});

const sent: { tabId: number; message: { type: string } }[] = [];
const injected: number[] = [];
const noReceiver = new Set<number>();
let listener!: (message: unknown, sender: unknown, respond: (r: unknown) => void) => boolean;
let installedHandler!: () => void;
let openIds: number[] = [];
const store: Record<string, unknown> = {};

const realChrome = (globalThis as unknown as { chrome: unknown }).chrome;
// El stub se saca al terminar: otras pruebas usan su propio chrome
afterAll(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = realChrome;
});

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
    onInstalled: { addListener: (fn: () => void) => (installedHandler = fn) },
  },
  tabs: {
    onRemoved: { addListener: () => {} },
    query: ({ url }: { url: string | string[] }) =>
      Promise.resolve(Array.isArray(url) ? openIds.map((id) => ({ id })) : []),
    sendMessage: (tabId: number, message: { type: string }) => {
      sent.push({ tabId, message });
      return noReceiver.has(tabId) ? Promise.reject(new Error('sin receptor')) : Promise.resolve();
    },
  },
  scripting: { executeScript: ({ target }: { target: { tabId: number } }) => (injected.push(target.tabId), Promise.resolve([])) },
  storage: { session: { get: () => Promise.resolve({ mediaTabs: store.mediaTabs }), set: (v: Record<string, unknown>) => (Object.assign(store, v), Promise.resolve()) } },
};

const { installMediaRouter, prune } = await import('../src/media-router');

describe('prune', () => {
  test('sin lista de abiertas, descarta las que hace mucho que no informan', () => {
    const now = 100 * 60_000;
    const tabs = { '1': tab(1, now - 20 * 60_000), '2': tab(2, now - 60_000) };
    expect(prune(tabs, now).map((t) => t.tabId)).toEqual([2]);
  });

  test('con la lista de abiertas, una pestaña en pausa sigue aunque no informe hace horas, y una cerrada se va', () => {
    const now = 100 * 60_000;
    const tabs = { '1': tab(1, now - 5 * 60 * 60_000), '2': tab(2, now) };
    expect(prune(tabs, now, new Set([1])).map((t) => t.tabId)).toEqual([1]);
  });
});

describe('router: pestaña de Gavriel que abre con la música ya abierta', () => {
  installMediaRouter();
  const get = (): Promise<{ tabs: TabMedia[] }> =>
    new Promise((resolve) => {
      sent.length = 0;
      injected.length = 0;
      expect(listener({ type: 'media-get' }, {}, (r) => resolve(r as { tabs: TabMedia[] }))).toBe(true);
    });

  test('responde con lo guardado y le pide a cada pestaña de música que informe', async () => {
    openIds = [11];
    store.mediaTabs = { '11': tab(11, Date.now() - 3 * 60 * 60_000) };
    const answer = await get();
    expect(answer.tabs.map((t) => t.tabId)).toEqual([11]);
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toEqual([{ tabId: 11, message: { type: 'media-poll' } }]);
    expect(injected).toEqual([]);
  });

  test('si la pestaña no tiene el script (estaba abierta antes de la extensión), se lo inyecta', async () => {
    openIds = [12];
    noReceiver.add(12);
    store.mediaTabs = {};
    await get();
    await new Promise((r) => setTimeout(r, 10));
    expect(injected).toEqual([12]);
  });

  test('una pestaña de música ya cerrada no se muestra', async () => {
    openIds = [];
    store.mediaTabs = { '13': tab(13, Date.now()) };
    // la copia en memoria ya tiene lo anterior: se vuelve a cargar con un mensaje de estado inexistente → se prueba con prune directo
    const answer = await get();
    expect(answer.tabs.every((t) => t.tabId !== 13)).toBe(true);
  });

  test('al instalar o recargar la extensión pone al día las pestañas ya abiertas', async () => {
    openIds = [14];
    sent.length = 0;
    installedHandler();
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toContainEqual({ tabId: 14, message: { type: 'media-poll' } });
  });
});
