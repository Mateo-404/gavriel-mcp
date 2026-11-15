import { describe, expect, test } from 'bun:test';
import { plainDigit, typeDigit } from '../../src/content/dial-input';

const key = (over: Partial<Parameters<typeof plainDigit>[0]>): Parameters<typeof plainDigit>[0] => ({
  key: '5', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, ...over,
});

describe('plainDigit', () => {
  test('solo dígitos sueltos', () => {
    for (const d of '0123456789') expect(plainDigit(key({ key: d }))).toBe(d);
  });
  test('letras, símbolos y teclas especiales no', () => {
    for (const k of ['a', '*', '#', '+', '-', ' ', 'Enter', 'Backspace', 'Escape', '10', 'F5', 'Dead']) expect(plainDigit(key({ key: k }))).toBeNull();
  });
  test('con modificadores (atajos Alt+N, Ctrl+1…) no', () => {
    expect(plainDigit(key({ altKey: true }))).toBeNull();
    expect(plainDigit(key({ ctrlKey: true }))).toBeNull();
    expect(plainDigit(key({ metaKey: true }))).toBeNull();
    expect(plainDigit(key({ shiftKey: true }))).toBeNull();
    expect(plainDigit(key({ isComposing: true }))).toBeNull();
  });
});

describe('typeDigit', () => {
  test('agrega al final y avisa como un input de React, sin enfocarlo', () => {
    document.body.innerHTML = '<input placeholder="Número…" value="34">';
    const input = document.querySelector('input')!;
    let seen = '';
    input.addEventListener('input', () => (seen = input.value));
    typeDigit(input, '2');
    typeDigit(input, '5');
    expect(input.value).toBe('3425');
    expect(seen).toBe('3425');
    expect(document.activeElement).not.toBe(input);
  });
});
