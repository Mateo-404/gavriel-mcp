import { describe, expect, test } from 'bun:test';
import { formatClientMessage } from '../src/shared/client-message';
import { isDebugNoise } from '../src/shared/console-filter';
import { accountIdFromLocation, isPanelList } from '../src/shared/routes';
import { soundNameFromUrl } from '../src/shared/sounds';

describe('utilidades chicas', () => {
  test('isDebugNoise: descarta el ruido con emoji de Gavriel y deja pasar el resto', () => {
    expect(isDebugNoise(['🔄 [useMonitoring] Actualización de eventos pendientes...'])).toBe(true);
    expect(isDebugNoise(['Error reproduciendo sonido:', new Error('x')])).toBe(false);
    expect(isDebugNoise([{ objeto: true }])).toBe(false);
    expect(isDebugNoise([])).toBe(false);
  });

  test('formatClientMessage: limpia espacios y no arma nada sin nombre o dirección', () => {
    expect(formatClientMessage('  PERREN \n PABLO ', ' Reconquista  444 ')).toBe('Estimado/a cliente: *PERREN PABLO*\nAlarma de: *Reconquista 444*');
    expect(formatClientMessage('', 'calle 1')).toBeNull();
    expect(formatClientMessage('X', '   ')).toBeNull();
  });

  test('rutas: lista del panel y id de la cuenta', () => {
    expect(isPanelList('/monitoring-panel/')).toBe(true);
    expect(isPanelList('/monitoring-panel/account-analysis')).toBe(false);
    expect(accountIdFromLocation('/monitoring-panel/account-analysis', '?x=1&accountId=zz')).toBe('zz');
    expect(accountIdFromLocation('/monitoring-panel', '?accountId=abc')).toBeNull();
    expect(accountIdFromLocation('/monitoring-panel/account-analysis', '?accountId=')).toBeNull();
  });

  test('soundNameFromUrl: solo los archivos de /sounds/, sin query, hash ni mayúsculas', () => {
    expect(soundNameFromUrl('/sounds/Alarm.MP3?t=2')).toBe('alarm');
    expect(soundNameFromUrl('/sounds/ding-2.ogg')).toBe('ding-2');
    for (const no of ['', 'blob:https://app.gavriel.com.ar/1234', 'data:audio/wav;base64,AAAA', 'https://app.gavriel.com.ar/recordings/audio_recording.wav', 'https://otro.com/media/alarm.mp3']) {
      expect(soundNameFromUrl(no)).toBeNull();
    }
  });
});
