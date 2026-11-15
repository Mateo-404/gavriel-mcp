/**
 * Ronda de llamadas a los contactos de emergencia de una cuenta. Lógica pura (sin DOM):
 *  - cada contacto tiene un tilde (entra o no en la ronda) y un contador de llamadas de la ronda;
 *  - «siguiente» es el primer contacto tildado, que se pueda llamar y al que aún no se llamó en la ronda actual;
 *  - cuando no queda ninguno en la ronda 1 se pasa a la 2; después de la 2 se termina.
 * Las llamadas manuales (Alt+N) no pasan por acá: no mueven nada.
 */

export const MAX_ROUNDS = 2;
export type RoundNumber = 1 | 2;

export interface RoundRow {
  name: string;
  /** Tildado: entra en la ronda. */
  included: boolean;
  /** En qué ronda se lo llamó por última vez: 0 nunca, 1 o 2. */
  calls: 0 | 1 | 2;
  /** Falso si Gavriel tiene el botón de llamar deshabilitado (sin teléfono). */
  callable: boolean;
}

export interface RoundState {
  rows: RoundRow[];
  round: RoundNumber;
}

export type RowStatus = 'off' | 'none' | 'once' | 'twice';

export const newRound = (): RoundState => ({ rows: [], round: 1 });

/**
 * Ajusta las filas a los contactos que se ven ahora. Conserva tilde y contador de los que siguen en la
 * misma posición con el mismo nombre; los demás empiezan tildados. Devuelve el mismo objeto si no cambió nada.
 */
export function syncRows(state: RoundState, contacts: readonly { name: string; callable: boolean }[]): RoundState {
  const same =
    state.rows.length === contacts.length &&
    state.rows.every((row, i) => row.name === contacts[i]!.name && row.callable === contacts[i]!.callable);
  if (same) return state;
  const rows = contacts.map((contact, i): RoundRow => {
    const old = state.rows[i];
    return old && old.name === contact.name
      ? { ...old, callable: contact.callable }
      : { name: contact.name, included: true, calls: 0, callable: contact.callable };
  });
  return { rows, round: state.round };
}

/** Próximo contacto a llamar y en qué ronda cae; null si la ronda 2 ya terminó. */
export function pickNext(state: RoundState): { index: number; round: RoundNumber } | null {
  for (let round: number = state.round; round <= MAX_ROUNDS; round++) {
    const index = state.rows.findIndex((row) => row.included && row.callable && row.calls < round);
    if (index >= 0) return { index, round: round as RoundNumber };
  }
  return null;
}

export function markCalled(state: RoundState, index: number, round: RoundNumber): RoundState {
  const row = state.rows[index];
  if (!row) return state;
  const rows = state.rows.slice();
  rows[index] = { ...row, calls: round };
  return { rows, round };
}

export function toggleRow(state: RoundState, index: number): RoundState {
  const row = state.rows[index];
  if (!row) return state;
  const rows = state.rows.slice();
  rows[index] = { ...row, included: !row.included };
  return { ...state, rows };
}

/** Todos tildados, sin llamadas y en la ronda 1. */
export const resetRound = (state: RoundState): RoundState => ({
  rows: state.rows.map((row) => ({ ...row, included: true, calls: 0 })),
  round: 1,
});

export function rowStatus(row: RoundRow): RowStatus {
  if (!row.included) return 'off';
  return row.calls === 2 ? 'twice' : row.calls === 1 ? 'once' : 'none';
}

export interface RoundProgress {
  round: RoundNumber;
  /** Contactos tildados que ya recibieron su llamada de esta ronda. */
  done: number;
  total: number;
  /** No queda nada por llamar (ni en esta ronda ni en la siguiente). */
  finished: boolean;
  /** Esta ronda se completó y falta pasar a la siguiente. */
  roundComplete: boolean;
}

export function progress(state: RoundState): RoundProgress {
  const active = state.rows.filter((row) => row.included && row.callable);
  const done = active.filter((row) => row.calls >= state.round).length;
  const roundComplete = active.length > 0 && done === active.length;
  return {
    round: state.round,
    done,
    total: active.length,
    finished: pickNext(state) === null && active.length > 0,
    roundComplete,
  };
}

/** Texto de la barra de la ronda. */
export function progressLabel(p: RoundProgress): string {
  if (p.total === 0) return 'Sin contactos para la ronda';
  if (p.finished) return `Ronda ${p.round} de ${MAX_ROUNDS} terminada`;
  if (p.roundComplete) return `Ronda ${p.round} de ${MAX_ROUNDS} completa · sigue la ${p.round + 1}.ª`;
  return `Ronda ${p.round} de ${MAX_ROUNDS} · ${p.done}/${p.total} llamados`;
}

/** Estados por cuenta, en memoria; se descartan los más viejos. */
export function createRoundStore(limit = 8): {
  get: (accountId: string) => RoundState;
  set: (accountId: string, state: RoundState) => void;
} {
  const map = new Map<string, RoundState>();
  return {
    get: (accountId) => map.get(accountId) ?? newRound(),
    set(accountId, state) {
      map.delete(accountId);
      map.set(accountId, state);
      if (map.size > limit) map.delete(map.keys().next().value as string);
    },
  };
}
