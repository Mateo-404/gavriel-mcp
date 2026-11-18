import { describe, expect, test } from 'bun:test';
import { isArrowKey, moveInGrid, nthInGrid } from '../src/shared/grid';

// NUEVO tiene 5 eventos, EN INTERVENCIÓN 1, EN OBSERVACIÓN 4 (como en el panel real)
const LENGTHS = [5, 1, 4];

describe('recorrido de la grilla del panel', () => {
  test('la primera flecha empieza en la primera tarjeta con eventos (o no hay a dónde ir)', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'] as const) expect(moveInGrid(LENGTHS, null, key)).toEqual({ col: 0, row: 0 });
    expect(moveInGrid([0, 2, 3], null, 'ArrowDown')).toEqual({ col: 1, row: 0 });
    expect(moveInGrid([], null, 'ArrowDown')).toBeNull();
    expect(moveInGrid([0, 0, 0], null, 'ArrowDown')).toBeNull();
    expect(moveInGrid(LENGTHS, { col: 7, row: 0 }, 'ArrowDown')).toEqual({ col: 0, row: 0 }); // posición que ya no existe
  });

  test('abajo y arriba recorren la columna sin dar la vuelta en los extremos', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowDown')).toEqual({ col: 0, row: 1 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 3 }, 'ArrowUp')).toEqual({ col: 0, row: 2 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 4 }, 'ArrowDown')).toEqual({ col: 0, row: 4 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowUp')).toEqual({ col: 0, row: 0 });
  });

  test('izquierda y derecha saltan a la columna vecina (con vacías en el medio), ajustan la fila y se quedan en los bordes', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowRight')).toEqual({ col: 1, row: 0 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 4 }, 'ArrowRight')).toEqual({ col: 1, row: 0 }); // la columna 1 tiene un solo evento
    expect(moveInGrid([5, 5], { col: 0, row: 4 }, 'ArrowRight')).toEqual({ col: 1, row: 4 });
    expect(moveInGrid([3, 0, 2], { col: 0, row: 1 }, 'ArrowRight')).toEqual({ col: 2, row: 1 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 2 }, 'ArrowLeft')).toEqual({ col: 0, row: 2 });
    expect(moveInGrid([3, 0, 0], { col: 0, row: 1 }, 'ArrowRight')).toEqual({ col: 0, row: 1 });
  });

  test('Alt+N numera columna por columna desde 1, saltea vacías y da null fuera de rango; isArrowKey solo las 4 flechas', () => {
    expect(nthInGrid(LENGTHS, 1)).toEqual({ col: 0, row: 0 });
    expect(nthInGrid(LENGTHS, 6)).toEqual({ col: 1, row: 0 });
    expect(nthInGrid(LENGTHS, 10)).toEqual({ col: 2, row: 3 });
    expect(nthInGrid([0, 2, 0, 1], 3)).toEqual({ col: 3, row: 0 });
    for (const bad of [11, 0, -1, 1.5]) expect(nthInGrid(LENGTHS, bad)).toBeNull();
    expect(nthInGrid([], 1)).toBeNull();
    expect(isArrowKey('ArrowDown')).toBe(true);
    expect(isArrowKey('Enter')).toBe(false);
  });
});
