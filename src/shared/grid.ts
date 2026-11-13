/** Posición de una tarjeta: columna (de izquierda a derecha) y fila (de arriba hacia abajo), ambas desde 0. */
export interface GridPos {
  col: number;
  row: number;
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const ARROW_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export const isArrowKey = (key: string): key is ArrowKey => ARROW_KEYS.includes(key);

const countOf = (lengths: readonly number[], col: number): number => lengths[col] ?? 0;

/**
 * Siguiente posición al recorrer las columnas de eventos con las flechas.
 * `lengths[i]` es la cantidad de tarjetas de la columna i, de izquierda a derecha.
 *
 *  - Sin posición actual (o si ya no existe), cualquier flecha empieza en la primera
 *    tarjeta de la columna más a la izquierda que tenga tarjetas.
 *  - Abajo/arriba recorren la columna sin dar la vuelta (se quedan en los extremos).
 *  - Izquierda/derecha saltan a la columna vecina que tenga tarjetas, conservando la
 *    fila (ajustada al largo de esa columna); si no hay otra, se queda donde está.
 *
 * Devuelve null si no hay ninguna tarjeta.
 */
export function moveInGrid(lengths: readonly number[], current: GridPos | null, key: ArrowKey): GridPos | null {
  const firstCol = lengths.findIndex((n) => n > 0);
  if (firstCol === -1) return null;

  if (!current || countOf(lengths, current.col) === 0) return { col: firstCol, row: 0 };

  const last = countOf(lengths, current.col) - 1;
  const row = Math.min(Math.max(current.row, 0), last);

  switch (key) {
    case 'ArrowDown':
      return { col: current.col, row: Math.min(row + 1, last) };
    case 'ArrowUp':
      return { col: current.col, row: Math.max(row - 1, 0) };
    case 'ArrowLeft':
    case 'ArrowRight': {
      const step = key === 'ArrowRight' ? 1 : -1;
      for (let col = current.col + step; col >= 0 && col < lengths.length; col += step) {
        const n = countOf(lengths, col);
        if (n > 0) return { col, row: Math.min(row, n - 1) };
      }
      return { col: current.col, row };
    }
  }
}

/**
 * La N-ésima tarjeta (N desde 1) leyendo columna por columna: primero todas las de
 * la columna de la izquierda, después las de la siguiente, etc. Es el número del atajo Alt+N.
 */
export function nthInGrid(lengths: readonly number[], n: number): GridPos | null {
  if (!Number.isInteger(n) || n < 1) return null;
  let remaining = n;
  for (let col = 0; col < lengths.length; col++) {
    const count = countOf(lengths, col);
    if (remaining <= count) return { col, row: remaining - 1 };
    remaining -= count;
  }
  return null;
}
