import { afterEach, describe, expect, test } from 'bun:test';
import { findSipContext, installSipBridge, runSipAction } from '../../src/content/sip-bridge';
import { createSipClient } from '../../src/content/sip';

interface FakeSip {
  calling: boolean;
  incoming: unknown;
  calls: string[];
  hangup: () => void;
  answer: () => void;
  reject: () => void;
  call: () => void;
}

const fakeSip = (over: Partial<FakeSip> = {}): FakeSip => {
  const sip: FakeSip = {
    calling: false,
    incoming: null,
    calls: [],
    hangup: () => sip.calls.push('hangup'),
    answer: () => sip.calls.push('answer'),
    reject: () => sip.calls.push('reject'),
    call: () => sip.calls.push('call'),
    ...over,
  };
  return sip;
};

/** Monta un <audio> cuyo fiber de React tiene, un par de niveles más arriba, el proveedor con `value`. */
function mountProvider(value: unknown): void {
  document.body.innerHTML = '<audio id="a" playsinline></audio>';
  const audio = document.getElementById('a')!;
  const provider = { memoizedProps: { value }, return: { memoizedProps: { children: 'x' }, return: null } };
  (audio as unknown as Record<string, unknown>)['__reactFiber$abc123'] = { memoizedProps: { autoPlay: true }, return: provider };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findSipContext', () => {
  test('sube por los fibers desde el <audio> hasta el proveedor del softphone', () => {
    const sip = fakeSip();
    mountProvider(sip);
    expect(findSipContext()).toBe(sip);
  });

  test('si no hay <audio>, o el valor no tiene la forma del softphone, devuelve null', () => {
    expect(findSipContext()).toBeNull();
    mountProvider({ hangup: () => {}, otraCosa: true });
    expect(findSipContext()).toBeNull();
    mountProvider(null);
    expect(findSipContext()).toBeNull();
  });
});

describe('runSipAction', () => {
  test('cuelga solo si hay una llamada en curso', () => {
    const idle = fakeSip({ calling: false });
    mountProvider(idle);
    expect(runSipAction('hangup')).toMatchObject({ ok: false, reason: 'nothing-to-do' });
    expect(idle.calls).toEqual([]);

    const active = fakeSip({ calling: true });
    mountProvider(active);
    expect(runSipAction('hangup')).toMatchObject({ ok: true, calling: true });
    expect(active.calls).toEqual(['hangup']);
  });

  test('atiende y rechaza solo si hay una llamada entrante', () => {
    const none = fakeSip();
    mountProvider(none);
    expect(runSipAction('answer').ok).toBe(false);
    expect(runSipAction('reject').ok).toBe(false);
    expect(none.calls).toEqual([]);

    const incoming = fakeSip({ incoming: 'Ana' });
    mountProvider(incoming);
    expect(runSipAction('answer').ok).toBe(true);
    expect(runSipAction('reject').ok).toBe(true);
    expect(incoming.calls).toEqual(['answer', 'reject']);
  });

  test('«state» informa sin ejecutar nada', () => {
    const sip = fakeSip({ calling: true, incoming: 'x' });
    mountProvider(sip);
    expect(runSipAction('state')).toEqual({ ok: true, calling: true, incoming: true });
    expect(sip.calls).toEqual([]);
  });

  test('sin softphone responde no-sip, y un error al colgar no se propaga', () => {
    expect(runSipAction('hangup')).toEqual({ ok: false, reason: 'no-sip' });
    mountProvider(fakeSip({ calling: true, hangup: () => { throw new Error('boom'); } }));
    expect(runSipAction('hangup')).toMatchObject({ ok: false, reason: 'error' });
  });
});

describe('puente por eventos (aislado -> página)', () => {
  installSipBridge();
  const client = createSipClient();

  test('un pedido de colgar llega, se ejecuta una vez y se responde', async () => {
    const sip = fakeSip({ calling: true });
    mountProvider(sip);
    expect(await client.run('hangup')).toBe(true);
    expect(sip.calls).toEqual(['hangup']);
  });

  test('si no hay nada que cortar responde false (la interfaz decide qué hacer)', async () => {
    const sip = fakeSip({ calling: false });
    mountProvider(sip);
    expect(await client.run('hangup')).toBe(false);
    expect(sip.calls).toEqual([]);
  });

  test('sin softphone en la página responde false sin quedarse esperando', async () => {
    const started = Date.now();
    expect(await client.run('hangup')).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('ignora pedidos con forma rara o acciones desconocidas', async () => {
    const sip = fakeSip({ calling: true });
    mountProvider(sip);
    for (const detail of ['no es json', JSON.stringify({ id: 'x', action: 'hangup' }), JSON.stringify({ id: 1, action: 'call' })]) {
      document.dispatchEvent(new CustomEvent('gavriel:sip-request', { detail }));
    }
    expect(sip.calls).toEqual([]);
  });
});
