/**
 * Con el softphone abierto, los números que escribís van al campo «Número…» del marcador aunque no
 * hayas hecho clic en él. Solo dígitos (0-9) y sin Ctrl/Alt/Meta/Shift: cualquier otra tecla se deja pasar.
 */

/** Dígito de una tecla "sola" (teclado superior o numérico), o null si no es uno. */
export function plainDigit(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing'>): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) return null;
  return /^[0-9]$/.test(event.key) ? event.key : null;
}

/** Agrega el dígito al final del campo (de React: setter nativo + evento) sin enfocarlo: así las letras y demás teclas nunca llegan al campo. */
export function typeDigit(input: HTMLInputElement, digit: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, input.value + digit);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
