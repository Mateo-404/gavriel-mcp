/**
 * Silenciador. Corre en el mundo de la página (world: MAIN) porque tiene que
 * interceptar `HTMLMediaElement`, que es el de la página y no el del content script.
 *
 * Silencia, dentro de /monitoring-panel, los sonidos de /sounds/<nombre>.mp3 que
 * el usuario eligió en el popup. No toca nada más: llamadas, grabaciones u otro
 * audio quedan intactos.
 *
 * Gavriel reproduce estos sonidos con `new Audio(url).play()`, un elemento que
 * nunca entra al DOM, por eso se intercepta play() y los setters de muted/volume
 * (solo actúan sobre archivos de /sounds/ elegidos por el usuario).
 *
 * Comunicación con bridge.ts (mundo aislado), por atributos de <html> y un evento.
 */
import { DEFAULT_SOUNDS, MUTE_ATTR, MUTED_SOUNDS_ATTR, SOUND_SEEN_EVENT } from '../shared/constants';
import { soundNameFromUrl } from '../shared/sounds';

declare global {
  interface Window {
    __gavrielMute?: boolean;
  }
  interface HTMLMediaElement {
    __gvTracked?: boolean;
  }
}

type MediaProp = 'muted' | 'volume';
interface Wanted {
  muted: boolean;
  volume: number;
}

function main(): void {
  const root = document.documentElement;

  const enabled = (): boolean => root.getAttribute(MUTE_ATTR) !== '0';
  const inPanel = (): boolean => location.pathname.includes('monitoring-panel');
  const mutedSounds = (): Set<string> => {
    try {
      const value: unknown = JSON.parse(root.getAttribute(MUTED_SOUNDS_ATTR) ?? 'null');
      if (Array.isArray(value)) return new Set(value.map((s) => String(s).toLowerCase()));
    } catch {
      // atributo ausente o inválido: valores por defecto
    }
    return new Set(DEFAULT_SOUNDS);
  };

  const soundName = (el: HTMLMediaElement): string | null => soundNameFromUrl(el.currentSrc || el.src || '');
  const shouldMute = (el: HTMLMediaElement): boolean => {
    if (!enabled() || !inPanel()) return false;
    const name = soundName(el);
    return name !== null && mutedSounds().has(name);
  };

  const proto = HTMLMediaElement.prototype;
  const descriptor = {
    muted: Object.getOwnPropertyDescriptor(proto, 'muted')!,
    volume: Object.getOwnPropertyDescriptor(proto, 'volume')!,
  } satisfies Record<MediaProp, PropertyDescriptor>;
  const rawSet = (el: HTMLMediaElement, prop: MediaProp, value: boolean | number): void => {
    descriptor[prop].set!.call(el, value);
  };

  /** Lo que la página pidió para cada elemento que silenciamos (se restaura al dejar de silenciar). */
  const wanted = new WeakMap<HTMLMediaElement, Wanted>();
  /** Elementos ya vistos, para reevaluarlos cuando cambia la configuración. */
  const seen = new Set<WeakRef<HTMLMediaElement>>();
  const reported = new Set<string>();

  const apply = (el: HTMLMediaElement): void => {
    try {
      if (shouldMute(el)) {
        if (!wanted.has(el)) wanted.set(el, { muted: el.muted, volume: el.volume });
        rawSet(el, 'muted', true);
        rawSet(el, 'volume', 0);
        return;
      }
      const original = wanted.get(el);
      if (original) {
        wanted.delete(el);
        rawSet(el, 'muted', original.muted);
        rawSet(el, 'volume', original.volume);
      }
    } catch {
      // un elemento en mal estado no debe romper la página
    }
  };

  const track = (el: HTMLMediaElement): void => {
    if (el.__gvTracked) return;
    el.__gvTracked = true;
    if (seen.size > 100) {
      // la alarma crea un Audio nuevo en cada repetición: se podan los ya liberados
      for (const ref of seen) if (!ref.deref()) seen.delete(ref);
    }
    seen.add(new WeakRef(el));
    el.addEventListener('loadstart', () => apply(el));
  };

  const report = (name: string): void => {
    if (reported.has(name)) return;
    reported.add(name);
    document.dispatchEvent(new CustomEvent<string>(SOUND_SEEN_EVENT, { detail: name }));
  };

  // Que la página no pueda volver a subir el volumen de un sonido silenciado
  for (const prop of ['muted', 'volume'] as const) {
    Object.defineProperty(proto, prop, {
      ...descriptor[prop],
      set(this: HTMLMediaElement, value: boolean | number) {
        let next = value;
        if (shouldMute(this)) {
          const current = wanted.get(this) ?? { muted: this.muted, volume: this.volume };
          if (prop === 'muted') current.muted = Boolean(value);
          else current.volume = Number(value);
          wanted.set(this, current);
          next = prop === 'muted' ? true : 0;
        }
        descriptor[prop].set!.call(this, next);
      },
    });
  }

  // new Audio(url).play() y <audio> dinámicos: solo sonidos de /sounds/
  const originalPlay = proto.play;
  proto.play = function (this: HTMLMediaElement) {
    const name = soundName(this);
    if (name) {
      report(name);
      track(this);
      apply(this);
    }
    return originalPlay.call(this);
  };

  const recheckAll = (): void => {
    for (const ref of seen) {
      const el = ref.deref();
      if (el) apply(el);
      else seen.delete(ref);
    }
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
      if (soundName(el) || wanted.has(el)) {
        track(el);
        apply(el);
      }
    });
  };

  // Cambios desde el popup (interruptor general o lista de sonidos)
  new MutationObserver(recheckAll).observe(root, {
    attributes: true,
    attributeFilter: [MUTE_ATTR, MUTED_SOUNDS_ATTR],
  });

  // Navegación dentro de la SPA (entrar/salir de /monitoring-panel)
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      setTimeout(recheckAll, 0);
      return result;
    };
  }
  window.addEventListener('popstate', recheckAll);
}

if (!window.__gavrielMute) {
  window.__gavrielMute = true;
  main();
}
