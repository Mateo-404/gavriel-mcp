import { describe, expect, test } from 'bun:test';
import { isArrowKey, moveInGrid, nthInGrid } from '../src/shared/grid';

// NUEVO tiene 5 eventos, EN INTERVENCIÓN 1, EN OBSERVACIÓN 4 (como en el panel real)
const LENGTHS = [5, 1, 4];

describe('moveInGrid: primera flecha', () => {
  test('cualquier flecha empieza en la primera tarjeta de la izquierda', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'] as const) {
      expect(moveInGrid(LENGTHS, null, key)).toEqual({ col: 0, row: 0 });
    }
  });

  test('si la columna de la izquierda está vacía empieza en la primera columna con eventos', () => {
    expect(moveInGrid([0, 0, 3], null, 'ArrowDown')).toEqual({ col: 2, row: 0 });
    expect(moveInGrid([0, 2, 3], null, 'ArrowDown')).toEqual({ col: 1, row: 0 });
  });

  test('sin eventos no hay a dónde ir', () => {
    expect(moveInGrid([], null, 'ArrowDown')).toBeNull();
    expect(moveInGrid([0, 0, 0], null, 'ArrowDown')).toBeNull();
  });

  test('una posición que ya no existe vuelve a empezar desde la primera tarjeta', () => {
    expect(moveInGrid(LENGTHS, { col: 7, row: 0 }, 'ArrowDown')).toEqual({ col: 0, row: 0 });
    expect(moveInGrid([0, 3], { col: 0, row: 2 }, 'ArrowDown')).toEqual({ col: 1, row: 0 });
  });
});

describe('moveInGrid: abajo y arriba', () => {
  test('recorren la columna', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowDown')).toEqual({ col: 0, row: 1 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 3 }, 'ArrowUp')).toEqual({ col: 0, row: 2 });
  });

  test('no dan la vuelta en los extremos', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 4 }, 'ArrowDown')).toEqual({ col: 0, row: 4 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowUp')).toEqual({ col: 0, row: 0 });
    expect(moveInGrid(LENGTHS, { col: 1, row: 0 }, 'ArrowDown')).toEqual({ col: 1, row: 0 });
  });
});

describe('moveInGrid: izquierda y derecha', () => {
  test('saltan a la columna vecina conservando la fila', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 0 }, 'ArrowRight')).toEqual({ col: 1, row: 0 });
    expect(moveInGrid(LENGTHS, { col: 2, row: 0 }, 'ArrowLeft')).toEqual({ col: 1, row: 0 });
  });

  test('ajustan la fila al largo de la columna de destino', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 3 }, 'ArrowRight')).toEqual({ col: 1, row: 0 });
    expect(moveInGrid(LENGTHS, { col: 0, row: 4 }, 'ArrowRight')).toEqual({ col: 1, row: 0 });
    expect(moveInGrid([5, 5], { col: 0, row: 4 }, 'ArrowRight')).toEqual({ col: 1, row: 4 });
  });

  test('saltan las columnas vacías', () => {
    expect(moveInGrid([3, 0, 2], { col: 0, row: 1 }, 'ArrowRight')).toEqual({ col: 2, row: 1 });
    expect(moveInGrid([3, 0, 2], { col: 2, row: 0 }, 'ArrowLeft')).toEqual({ col: 0, row: 0 });
  });

  test('en los bordes se quedan donde están', () => {
    expect(moveInGrid(LENGTHS, { col: 0, row: 2 }, 'ArrowLeft')).toEqual({ col: 0, row: 2 });
    expect(moveInGrid(LENGTHS, { col: 2, row: 2 }, 'ArrowRight')).toEqual({ col: 2, row: 2 });
    expect(moveInGrid([3, 0, 0], { col: 0, row: 1 }, 'ArrowRight')).toEqual({ col: 0, row: 1 });
  });
});

describe('nthInGrid (Alt+N)', () => {
  test('numera columna por columna, empezando en 1', () => {
    expect(nthInGrid(LENGTHS, 1)).toEqual({ col: 0, row: 0 });
    expect(nthInGrid(LENGTHS, 5)).toEqual({ col: 0, row: 4 });
    expect(nthInGrid(LENGTHS, 6)).toEqual({ col: 1, row: 0 });
    expect(nthInGrid(LENGTHS, 7)).toEqual({ col: 2, row: 0 });
    expect(nthInGrid(LENGTHS, 10)).toEqual({ col: 2, row: 3 });
  });

  test('saltea columnas vacías', () => {
    expect(nthInGrid([0, 2, 0, 1], 3)).toEqual({ col: 3, row: 0 });
  });

  test('fuera de rango o inválido da null', () => {
    expect(nthInGrid(LENGTHS, 11)).toBeNull();
    expect(nthInGrid(LENGTHS, 0)).toBeNull();
    expect(nthInGrid(LENGTHS, -1)).toBeNull();
    expect(nthInGrid(LENGTHS, 1.5)).toBeNull();
    expect(nthInGrid([], 1)).toBeNull();
  });
});

describe('isArrowKey', () => {
  test('solo las cuatro flechas', () => {
    expect(isArrowKey('ArrowDown')).toBe(true);
    expect(isArrowKey('Enter')).toBe(false);
    expect(isArrowKey('Home')).toBe(false);
  });
});
