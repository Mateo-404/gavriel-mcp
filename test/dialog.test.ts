import { describe, expect, test } from 'bun:test';
import { pickPrimary } from '../src/shared/dialog';

const ghost = 'inline-flex bg-transparent text-muted-foreground hover:bg-muted';
const outline = 'inline-flex border border-border bg-transparent text-foreground';
const primary = 'inline-flex bg-primary text-primary-foreground hover:brightness-105';
const destructive = 'inline-flex bg-destructive text-destructive-foreground';
const secondary = 'inline-flex bg-secondary text-secondary-foreground';

describe('pickPrimary', () => {
  test('Cancelar + Confirmar (default)', () => {
    expect(pickPrimary([{ className: ghost, label: 'Cancelar' }, { className: primary, label: 'Confirmar' }])).toBe(1);
  });

  test('Cerrar intervención es destructive', () => {
    expect(
      pickPrimary([{ className: ghost, label: 'Cancelar' }, { className: destructive, label: 'Cerrar Intervención' }]),
    ).toBe(1);
  });

  test('las opciones secondary no cuentan', () => {
    expect(
      pickPrimary([
        { className: ghost, label: 'Cancelar' },
        { className: primary, label: 'Confirmar' },
        { className: secondary, label: 'En intervención' },
        { className: secondary, label: 'En observación' },
      ]),
    ).toBe(1);
  });

  test('sin botón principal (solo Cerrar) no hay atajo', () => {
    expect(pickPrimary([{ className: ghost, label: 'Cerrar' }])).toBe(-1);
    expect(pickPrimary([{ className: outline, label: 'Listo' }])).toBe(-1);
  });

  test('un botón de descartar nunca es el principal aunque tenga la clase', () => {
    expect(pickPrimary([{ className: primary, label: 'Cancelar' }])).toBe(-1);
  });

  test('si hay dos candidatos no se adivina', () => {
    expect(pickPrimary([{ className: primary, label: 'Guardar' }, { className: destructive, label: 'Eliminar' }])).toBe(-1);
  });

  test('no confunde clases parecidas (bg-primary/10)', () => {
    expect(pickPrimary([{ className: 'bg-primary/10 text-primary', label: 'Algo' }])).toBe(-1);
  });
});

import { pickDismiss } from '../src/shared/dialog';

describe('pickDismiss', () => {
  test('Cancelar es el botón de salida', () => {
    expect(pickDismiss([{ className: ghost, label: 'Cancelar' }, { className: primary, label: 'Confirmar' }])).toBe(0);
  });

  test('Cerrar también, y con varios gana el primero', () => {
    expect(pickDismiss([{ className: primary, label: 'Guardar' }, { className: ghost, label: ' Cerrar ' }])).toBe(1);
    expect(pickDismiss([{ className: ghost, label: 'Cancelar' }, { className: ghost, label: 'Cancelar' }])).toBe(0);
  });

  test('sin botón de salida no hay atajo (Esc queda para el diálogo)', () => {
    expect(pickDismiss([{ className: primary, label: 'Listo' }])).toBe(-1);
    expect(pickDismiss([])).toBe(-1);
  });
});
