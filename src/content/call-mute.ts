/**
 * Botón de silencio del micrófono durante una llamada: un círculo flotante a la izquierda del botón
 * del teléfono. Solo existe mientras hay una llamada. Alt+M hace lo mismo desde el teclado.
 * Al terminar la llamada se reactiva el micrófono, para que la próxima empiece con sonido.
 */
import type { SipClient } from './sip';

const FAB = 'button[aria-label="Abrir softphone"], button[aria-label="Minimizar softphone"]';
const GAP_PX = 10;
const MIC = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>';
const MIC_OFF = '<path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.9-.8"/><path d="M19 10v2a7 7 0 0 1-.9 3.4"/><path d="M5 10v2a7 7 0 0 0 11.7 5.2"/><path d="M12 19v3"/>';

export interface CallMute {
  /** Muestra u oculta según haya llamada; reactiva el micrófono al terminar. */
  update: (calling: boolean) => void;
  /** Alterna el silencio (botón o atajo). Devuelve false si no había nada que silenciar. */
  toggle: () => Promise<boolean>;
  setEnabled: (on: boolean) => void;
}

export function createCallMute({ sip, toast }: { sip: SipClient; toast: (message: string) => void }): CallMute {
  let enabled = true;
  let wasCalling = false;
  let muted = false;
  let button: HTMLButtonElement | undefined;

  const paint = (): void => {
    if (!button) return;
    button.classList.toggle('gv-muted', muted);
    button.setAttribute('aria-pressed', String(muted));
    const label = muted ? 'Activar micrófono (Alt+M)' : 'Silenciar micrófono (Alt+M)';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${muted ? MIC_OFF : MIC}</svg>`;
  };

  const toggle = async (): Promise<boolean> => {
    const next = await sip.toggleMute();
    if (next === null) {
      toast('No se pudo silenciar: no hay llamada con micrófono');
      return false;
    }
    muted = next;
    toast(muted ? 'Micrófono silenciado' : 'Micrófono activado');
    paint();
    return true;
  };

  const ensure = (): HTMLButtonElement => {
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'gv-mutebtn';
    button.setAttribute('data-gv-hint', '');
    button.addEventListener('click', () => void toggle());
    paint();
    return button;
  };

  const place = (el: HTMLButtonElement): void => {
    const fab = document.querySelector<HTMLElement>(FAB);
    if (!fab) return;
    const rect = fab.getBoundingClientRect();
    if (rect.width === 0) return;
    const right = Math.round(window.innerWidth - rect.left + GAP_PX);
    const bottom = Math.round(window.innerHeight - rect.bottom);
    if (el.style.right !== `${right}px`) el.style.right = `${right}px`;
    if (el.style.bottom !== `${bottom}px`) el.style.bottom = `${bottom}px`;
  };

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) button?.remove();
    },
    toggle,
    update(calling) {
      if (calling && enabled) {
        const el = ensure();
        if (!el.isConnected) document.body.append(el);
        place(el);
      } else {
        button?.remove();
      }
      if (wasCalling && !calling && muted) {
        muted = false;
        void sip.unmute(); // la próxima llamada empieza con sonido
        paint();
      }
      wasCalling = calling;
    },
  };
}
