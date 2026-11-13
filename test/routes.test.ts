import { describe, expect, test } from 'bun:test';
import { accountIdFromLocation, isPanelList } from '../src/shared/routes';

describe('isPanelList', () => {
  test('solo la lista de eventos del panel', () => {
    expect(isPanelList('/monitoring-panel')).toBe(true);
    expect(isPanelList('/monitoring-panel/')).toBe(true);
    expect(isPanelList('/monitoring-panel/account-analysis')).toBe(false);
    expect(isPanelList('/monitoring')).toBe(false);
    expect(isPanelList('/otra-pantalla')).toBe(false);
  });
});

describe('accountIdFromLocation', () => {
  test('devuelve el id de la cuenta en su pantalla', () => {
    expect(accountIdFromLocation('/monitoring-panel/account-analysis', '?accountId=abc123')).toBe('abc123');
    expect(accountIdFromLocation('/monitoring-panel/account-analysis/', '?x=1&accountId=zz')).toBe('zz');
  });

  test('null fuera de la cuenta o sin id', () => {
    expect(accountIdFromLocation('/monitoring-panel', '?accountId=abc')).toBeNull();
    expect(accountIdFromLocation('/monitoring-panel/account-analysis', '')).toBeNull();
    expect(accountIdFromLocation('/monitoring-panel/account-analysis', '?accountId=')).toBeNull();
    expect(accountIdFromLocation('/accounts', '?accountId=abc')).toBeNull();
  });
});
