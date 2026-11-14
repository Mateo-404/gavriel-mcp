import { describe, expect, test } from 'bun:test';
import { createAlertSender } from '../src/content/alerts';
import type { Alert } from '../src/shared/event-alerts';
import { TEST_ALERT, accountUrl, buildNotification, buildSummary } from '../src/shared/notification';

const alert = (over: Partial<Alert> = {}): Alert => ({
  type: 'BUR',
  accountId: 'acc1',
  accountName: 'MERLO FERNANDO',
  accountNumber: '2904',
  code: 'E130',
  codeName: 'Burglary',
  zone: '3 - OFICINA',
  added: 1,
  ...over,
});

describe('buildNotification', () => {
  test('título con el tipo, cuenta y detalle', () => {
    const spec = buildNotification(alert(), 1);
    expect(spec.title).toBe('🚨 BUR · Robo / intrusión');
    expect(spec.message).toBe('MERLO FERNANDO · #2904');
    expect(spec.contextMessage).toBe('E130 · Burglary · Zona 3 - OFICINA');
    expect(spec.accountId).toBe('acc1');
  });

  test('si entraron varios, lo dice; sin número de cuenta ni zona no deja huecos', () => {
    const spec = buildNotification(alert({ added: 3, accountNumber: '', zone: '' }), 1);
    expect(spec.title).toBe('🚨 BUR · Robo / intrusión (+3)');
    expect(spec.message).toBe('MERLO FERNANDO');
    expect(spec.contextMessage).toBe('E130 · Burglary');
  });

  test('las emergencias quedan en pantalla; la energía no', () => {
    for (const type of ['BUR', 'PAN', 'MED', 'INC'] as const) expect(buildNotification(alert({ type }), 1).requireInteraction).toBe(true);
    expect(buildNotification(alert({ type: 'POW', code: 'E301' }), 1).requireInteraction).toBe(false);
  });

  test('el id es estable (varias pestañas no duplican) y distinto por cuenta, código y cantidad', () => {
    expect(buildNotification(alert(), 1).id).toBe(buildNotification(alert(), 1).id);
    expect(buildNotification(alert(), 1).id).not.toBe(buildNotification(alert({ accountId: 'otra' }), 1).id);
    expect(buildNotification(alert(), 1).id).not.toBe(buildNotification(alert({ code: 'E131' }), 1).id);
  });

  test('resumen y dirección de la cuenta', () => {
    expect(buildSummary(7).title).toBe('7 eventos más en Gavriel');
    expect(accountUrl('a b')).toBe('https://app.gavriel.com.ar/monitoring-panel/account-analysis?accountId=a%20b');
    expect(buildNotification(TEST_ALERT, 0).message).toContain('PRUEBA');
  });
});

describe('createAlertSender', () => {
  const run = async (settings: { notifyEnabled: boolean; notifyTypes: string[] }, alerts: Alert[]) => {
    const sent: Alert[][] = [];
    await createAlertSender({ settings: async () => settings, send: (m) => sent.push(m.alerts) })(alerts);
    return sent;
  };

  test('manda solo los tipos elegidos', async () => {
    const sent = await run({ notifyEnabled: true, notifyTypes: ['BUR', 'MED'] }, [alert(), alert({ type: 'PAN', code: 'E120' }), alert({ type: 'MED', code: 'E100' })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((a) => a.type)).toEqual(['BUR', 'MED']);
  });

  test('con el interruptor general apagado, o sin tipos, no manda nada', async () => {
    expect(await run({ notifyEnabled: false, notifyTypes: ['BUR'] }, [alert()])).toEqual([]);
    expect(await run({ notifyEnabled: true, notifyTypes: [] }, [alert()])).toEqual([]);
  });

  test('ignora avisos con un tipo desconocido', async () => {
    expect(await run({ notifyEnabled: true, notifyTypes: ['BUR'] }, [alert({ type: 'XXX' as never })])).toEqual([]);
  });
});
