import { describe, expect, test } from 'bun:test';
import { NOPUSH_ATTR, installPushGuard, type PushEnv } from '../src/content/push-guard';

const manifest = (await Bun.file('static/manifest.json').json()) as { declarative_net_request: { rule_resources: { id: string; enabled: boolean; path: string }[] } };
const rules = (await Bun.file('static/rules/push.json').json()) as { action: { type: string }; condition: { requestDomains: string[]; initiatorDomains: string[] } }[];

const root = (on: boolean): Element => {
  const el = document.createElement('div');
  if (on) el.setAttribute(NOPUSH_ATTR, '');
  return el;
};

describe('bloqueo de push (reglas de red)', () => {
  test('el conjunto de reglas está en el manifest, activo, y solo bloquea Firebase pedido por Gavriel', () => {
    expect(manifest.declarative_net_request.rule_resources).toContainEqual({ id: 'push', enabled: true, path: 'rules/push.json' });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.action.type).toBe('block');
    expect(rules[0]!.condition.initiatorDomains).toEqual(['app.gavriel.com.ar']);
    expect(rules[0]!.condition.requestDomains).toContain('fcm.googleapis.com');
  });
});

describe('bloqueo de push (página)', () => {
  test('con el interruptor activo rechaza la suscripción como un permiso negado', async () => {
    let real = 0;
    const env: PushEnv = { proto: { subscribe: () => (real++, Promise.resolve('sub')) } };
    installPushGuard(root(true), env);
    await expect((env.proto!.subscribe as () => Promise<unknown>)()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(real).toBe(0);
  });

  test('con el interruptor apagado deja pasar la suscripción de siempre', async () => {
    const env: PushEnv = { proto: { subscribe: () => Promise.resolve('sub') } };
    installPushGuard(root(false), env);
    expect(await (env.proto!.subscribe as () => Promise<unknown>)()).toBe('sub');
  });

  test('da de baja las suscripciones existentes, y solo si está activo', async () => {
    let removed = 0;
    const sub = { unsubscribe: () => (removed++, Promise.resolve(true)) };
    const workers = { getRegistrations: () => Promise.resolve([{ pushManager: { getSubscription: () => Promise.resolve(sub) } }, { pushManager: { getSubscription: () => Promise.resolve(null) } }]) };
    expect(await installPushGuard(root(false), { workers }).sweep()).toBe(0);
    expect(removed).toBe(0);
    expect(await installPushGuard(root(true), { workers }).sweep()).toBe(1);
    expect(removed).toBe(1);
  });

  test('si los service workers fallan, no se propaga el error', async () => {
    const workers = { getRegistrations: () => Promise.reject(new Error('boom')) };
    expect(await installPushGuard(root(true), { workers }).sweep()).toBe(0);
  });
});
