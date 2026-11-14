import { describe, expect, test } from 'bun:test';
import { readSetting, readSettings } from '../../src/shared/storage';

const stub = (
  globalThis as unknown as { __chromeStub: { gets: number; emit: (c: Record<string, unknown>) => void; data: Record<string, unknown> } }
).__chromeStub;

describe('storage: una sola lectura compartida', () => {
  test('varias lecturas seguidas hacen un solo chrome.storage.get', async () => {
    const before = stub.gets;
    await Promise.all([readSettings(), readSetting('showCallCard'), readSetting('plainEvents')]);
    expect(stub.gets - before).toBeLessThanOrEqual(1);
    const mid = stub.gets;
    await readSettings();
    expect(stub.gets).toBe(mid);
  });

  test('un cambio en chrome.storage invalida el cache', async () => {
    await readSettings();
    stub.data.showCallCard = false;
    stub.emit({ showCallCard: { newValue: false } });
    expect(await readSetting('showCallCard')).toBe(false);
  });
});
