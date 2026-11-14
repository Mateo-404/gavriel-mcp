/** DOM de happy-dom y un chrome.* mínimo para probar los módulos que tocan la página. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'https://app.gavriel.com.ar/monitoring-panel' });

type Listener = (changes: Record<string, unknown>, area: string) => void;
const listeners: Listener[] = [];
const data: Record<string, unknown> = {};

export const chromeStub = {
  gets: 0,
  data,
  emit(changes: Record<string, unknown>): void {
    for (const fn of listeners) fn(changes, 'local');
  },
};

Object.assign(globalThis, {
  chrome: {
    runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}` },
    storage: {
      local: {
        get: async (defaults: Record<string, unknown>) => {
          chromeStub.gets++;
          return { ...defaults, ...data };
        },
        set: async (patch: Record<string, unknown>) => {
          Object.assign(data, patch);
        },
      },
      onChanged: { addListener: (fn: Listener) => listeners.push(fn) },
    },
  },
  __chromeStub: chromeStub,
});
