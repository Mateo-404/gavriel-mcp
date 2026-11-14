import { describe, expect, test } from 'bun:test';
import { alive, guard, hasForeignChange, isOwnNode, watchDom } from '../../src/content/runtime';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('runtime (DOM)', () => {
  test('reconoce lo que dibuja la extensión', () => {
    document.body.innerHTML = '<kbd data-gv-hint="">x</kbd><div class="gv-callcard"><b>a</b></div><p id="p">hola</p>';
    expect(isOwnNode(document.querySelector('kbd')!)).toBe(true);
    expect(isOwnNode(document.querySelector('.gv-callcard b')!)).toBe(true);
    expect(isOwnNode(document.getElementById('p')!)).toBe(false);
  });

  test('hasForeignChange ignora cambios propios y detecta los de la página', () => {
    document.body.innerHTML = '<kbd id="k" data-gv-hint=""></kbd><p id="p"></p>';
    const own = document.getElementById('k')!;
    const page = document.getElementById('p')!;
    const rec = (target: Node, added: Node[]): MutationRecord =>
      ({ type: 'childList', target, addedNodes: added, removedNodes: [] }) as unknown as MutationRecord;
    expect(hasForeignChange([rec(own, [document.createTextNode('x')])])).toBe(false);
    expect(hasForeignChange([rec(document.body, [own])])).toBe(false);
    expect(hasForeignChange([rec(page, [document.createElement('i')])])).toBe(true);
  });

  test('guard aísla los errores y alive() sigue en pie', () => {
    expect(alive()).toBe(true);
    const run = guard('prueba', () => {
      throw new Error('boom');
    });
    expect(() => run()).not.toThrow();
  });

  test('watchDom: cambios de la página disparan una sola pasada agrupada', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    let runs = 0;
    const stop = watchDom(() => runs++, { delayMs: 20, fallbackMs: 60_000 });
    await sleep(60);
    const base = runs;
    const root = document.getElementById('root')!;
    for (let i = 0; i < 50; i++) root.append(document.createElement('i'));
    await sleep(80);
    expect(runs - base).toBe(1);
    stop();
  });

  test('watchDom: varios suscriptores comparten el observador y cada uno recibe sus avisos', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    let a = 0;
    let b = 0;
    const stopA = watchDom(() => a++, { delayMs: 10, fallbackMs: 60_000 });
    const stopB = watchDom(() => b++, { delayMs: 30, fallbackMs: 60_000 });
    await sleep(80);
    const [a0, b0] = [a, b];
    document.getElementById('root')!.append(document.createElement('i'));
    await sleep(100);
    expect([a - a0, b - b0]).toEqual([1, 1]);
    stopA();
    stopB();
  });
});
