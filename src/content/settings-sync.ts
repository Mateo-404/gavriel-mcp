/**
 * Ajustes en vivo, en un solo lugar: cada ajuste tiene un manejador que se llama con su valor al arrancar y cada vez que
 * cambia (en Opciones o en otra pestaña). Un solo `storage.onChanged` para todos.
 */
import type { Settings } from '../shared/constants';
import { readSetting, touches } from '../shared/storage';

type Handlers = { [K in keyof Settings]?: (value: Settings[K]) => void };

export function bindSettings(handlers: Handlers): void {
  const keys = Object.keys(handlers) as (keyof Settings)[];
  const apply = <K extends keyof Settings>(key: K): void => {
    void readSetting(key).then((value) => (handlers[key] as ((v: Settings[K]) => void) | undefined)?.(value));
  };
  for (const key of keys) apply(key);
  chrome.storage.onChanged.addListener((changes, area) => {
    for (const key of keys) if (touches(changes, area, key)) apply(key);
  });
}
