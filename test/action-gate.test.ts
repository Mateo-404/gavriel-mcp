import { describe, expect, test } from 'bun:test';
import { ACTIVE_HOSTS, buildGateRules, installActionGate } from '../src/action-gate';
import { forChrome, forFirefox, type Manifest } from '../manifest-targets';

const base = (await Bun.file('static/manifest.json').json()) as Manifest;

class Matcher {
  constructor(public readonly opts: unknown) {}
}
class Show {}
const dc = { PageStateMatcher: Matcher, ShowAction: Show } as never;

describe('botón activo solo donde la extensión trabaja', () => {
  test('una regla por host (https), y la acción es «mostrar»', () => {
    const [rule] = buildGateRules(dc);
    expect(rule!.conditions.map((c) => (c as unknown as Matcher).opts)).toEqual(
      ACTIVE_HOSTS.map((host) => ({ pageUrl: { hostEquals: host, schemes: ['https'] } })),
    );
    expect(rule!.actions[0]).toBeInstanceOf(Show);
  });

  test('los hosts coinciden con los sitios del manifest', () => {
    const sites = (forChrome(base, '1.0.0').host_permissions as string[]).map((s) => new URL(s.replace('/*', '/')).host);
    expect([...ACTIVE_HOSTS].map(String).sort()).toEqual(sites.sort());
  });

  test('se desactiva por defecto y registra las reglas; sin declarativeContent no hace nada', () => {
    const calls: string[] = [];
    const api = {
      action: { disable: () => (calls.push('disable'), Promise.resolve()) },
      declarativeContent: {
        ...(dc as object),
        onPageChanged: {
          removeRules: (_ids: unknown, cb: () => void) => (calls.push('remove'), cb()),
          addRules: () => calls.push('add'),
        },
      },
    } as never;
    installActionGate(api);
    expect(calls).toEqual(['disable', 'remove', 'add']);
    const none: string[] = [];
    installActionGate({ action: { disable: () => none.push('x') } } as never);
    expect(none).toEqual([]);
  });

  test('el permiso solo se agrega en Chrome', () => {
    expect(forChrome(base, '1.0.0').permissions).toContain('declarativeContent');
    expect(forFirefox(base, '1.0.0').permissions).not.toContain('declarativeContent');
  });
});
