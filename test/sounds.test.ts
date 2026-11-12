import { describe, expect, test } from 'bun:test';
import { soundNameFromUrl } from '../src/shared/sounds';

describe('soundNameFromUrl', () => {
  test('reconoce los sonidos que reproduce Gavriel', () => {
    expect(soundNameFromUrl('https://app.gavriel.com.ar/sounds/alarm.mp3')).toBe('alarm');
    expect(soundNameFromUrl('https://app.gavriel.com.ar/sounds/siren.mp3')).toBe('siren');
    expect(soundNameFromUrl('/sounds/beep.mp3')).toBe('beep');
  });

  test('ignora query, hash y mayúsculas', () => {
    expect(soundNameFromUrl('/sounds/Alarm.MP3?t=2')).toBe('alarm');
    expect(soundNameFromUrl('/sounds/beep.mp3#x')).toBe('beep');
  });

  test('acepta otros formatos de audio de /sounds/', () => {
    expect(soundNameFromUrl('/sounds/campana.wav')).toBe('campana');
    expect(soundNameFromUrl('/sounds/ding-2.ogg')).toBe('ding-2');
  });

  test('no toca nada que no sea de /sounds/', () => {
    expect(soundNameFromUrl('')).toBeNull();
    expect(soundNameFromUrl('blob:https://app.gavriel.com.ar/1234')).toBeNull();
    expect(soundNameFromUrl('data:audio/wav;base64,AAAA')).toBeNull();
    expect(soundNameFromUrl('https://app.gavriel.com.ar/recordings/audio_recording.wav')).toBeNull();
    expect(soundNameFromUrl('https://app.gavriel.com.ar/sounds/alarm.txt')).toBeNull();
    expect(soundNameFromUrl('https://otro.com/media/alarm.mp3')).toBeNull();
  });
});
