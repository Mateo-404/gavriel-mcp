import { describe, expect, test } from 'bun:test';
import {
  createRoundStore,
  markCalled,
  newRound,
  pickNext,
  progress,
  progressLabel,
  resetRound,
  rowStatus,
  syncRows,
  toggleRow,
  type RoundState,
} from '../src/shared/call-round';

const contacts = (...names: string[]): { name: string; callable: boolean }[] => names.map((name) => ({ name, callable: true }));
const start = (...names: string[]): RoundState => syncRows(newRound(), contacts(...names));

/** Llama a todos los que toquen y devuelve el orden. */
function drain(initial: RoundState): { order: string[]; state: RoundState } {
  let state = initial;
  const order: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const next = pickNext(state);
    if (!next) break;
    order.push(`${state.rows[next.index]!.name}@${next.round}`);
    state = markCalled(state, next.index, next.round);
  }
  return { order, state };
}

describe('ronda de llamadas', () => {
  test('todos nacen tildados y la ronda va en orden, dos veces', () => {
    const { order } = drain(start('A', 'B', 'C'));
    expect(order).toEqual(['A@1', 'B@1', 'C@1', 'A@2', 'B@2', 'C@2']);
  });

  test('los destildados se saltan en las dos rondas', () => {
    let s = start('A', 'B', 'C');
    s = toggleRow(s, 1);
    expect(drain(s).order).toEqual(['A@1', 'C@1', 'A@2', 'C@2']);
    expect(rowStatus(s.rows[1]!)).toBe('off');
  });

  test('termina después de la ronda 2 y avisa', () => {
    const { state } = drain(start('A', 'B'));
    expect(pickNext(state)).toBeNull();
    const p = progress(state);
    expect(p.finished).toBe(true);
    expect(progressLabel(p)).toBe('Ronda 2 de 2 terminada');
  });

  test('estados de color: ninguno, una vez (amarillo), dos veces (rojo)', () => {
    let s = start('A');
    expect(rowStatus(s.rows[0]!)).toBe('none');
    s = markCalled(s, 0, 1);
    expect(rowStatus(s.rows[0]!)).toBe('once');
    s = markCalled(s, 0, 2);
    expect(rowStatus(s.rows[0]!)).toBe('twice');
  });

  test('el progreso cuenta la ronda actual y avisa cuando falta pasar a la siguiente', () => {
    let s = start('A', 'B', 'C');
    s = markCalled(s, 0, 1);
    expect(progressLabel(progress(s))).toBe('Ronda 1 de 2 · 1/3 llamados');
    s = markCalled(markCalled(s, 1, 1), 2, 1);
    expect(progressLabel(progress(s))).toBe('Ronda 1 de 2 completa · sigue la 2.ª');
    const next = pickNext(s)!;
    s = markCalled(s, next.index, next.round);
    expect(progress(s)).toMatchObject({ round: 2, done: 1, total: 3 });
  });

  test('un contacto que no se puede llamar nunca entra en la ronda', () => {
    const s = syncRows(newRound(), [
      { name: 'A', callable: true },
      { name: 'Sin teléfono', callable: false },
      { name: 'C', callable: true },
    ]);
    expect(drain(s).order).toEqual(['A@1', 'C@1', 'A@2', 'C@2']);
  });

  test('si destildás a todos no hay nada para llamar', () => {
    let s = start('A');
    s = toggleRow(s, 0);
    expect(pickNext(s)).toBeNull();
    expect(progressLabel(progress(s))).toBe('Sin contactos para la ronda');
  });

  test('reiniciar vuelve a tildar todos, borra las llamadas y vuelve a la ronda 1', () => {
    let s = start('A', 'B');
    s = toggleRow(markCalled(markCalled(s, 0, 1), 0, 2), 1);
    s = resetRound(s);
    expect(s.round).toBe(1);
    expect(s.rows.every((r) => r.included && r.calls === 0)).toBe(true);
  });

  test('syncRows conserva lo hecho si la lista no cambió y rearma las filas nuevas', () => {
    const s = markCalled(start('A', 'B'), 0, 1);
    expect(syncRows(s, contacts('A', 'B'))).toBe(s);
    const changed = syncRows(s, contacts('A', 'Z', 'Y'));
    expect(changed.rows.map((r) => [r.name, r.calls])).toEqual([['A', 1], ['Z', 0], ['Y', 0]]);
  });

  test('el estado es por cuenta y se descartan las más viejas', () => {
    const store = createRoundStore(2);
    store.set('a', markCalled(start('A'), 0, 1));
    store.set('b', start('B'));
    expect(store.get('a').rows[0]!.calls).toBe(1);
    store.set('c', start('C'));
    expect(store.get('a').rows).toEqual([]); // la más vieja se fue
    expect(store.get('c').rows).toHaveLength(1);
  });
});
