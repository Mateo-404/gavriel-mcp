import { describe, expect, test } from 'bun:test';
import { isDebugNoise } from '../src/shared/console-filter';

describe('isDebugNoise', () => {
  test('descarta los mensajes de depuración con emoji de Gavriel', () => {
    expect(isDebugNoise(['🔄 [useMonitoring] Actualización de eventos pendientes...'])).toBe(true);
    expect(isDebugNoise(['🔊 [useAudioPermission] Finalizando solicitud', { a: 1 }])).toBe(true);
  });

  test('deja pasar el resto', () => {
    expect(isDebugNoise(['Error reproduciendo sonido:', new Error('x')])).toBe(false);
    expect(isDebugNoise(['[Gavriel Tools] aviso'])).toBe(false);
    expect(isDebugNoise([{ objeto: true }])).toBe(false);
    expect(isDebugNoise([])).toBe(false);
    expect(isDebugNoise([42])).toBe(false);
  });
});
