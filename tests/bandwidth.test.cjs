import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { TransferManager, pump, makeGate } from '../electron/transfer.cjs';

afterEach(() => vi.useRealTimers());
describe('transfer bandwidth scheduling', () => {
  it.each([0, 1024 * 1024])('responds immediately to a changed live bandwidth limit of %i', async (limitBytes) => {
    const manager = new TransferManager({ getConn: async () => null });
    manager.setOptions({ limitBytes: 16 });
    let writes = 0;
    const source = Readable.from([Buffer.alloc(16), Buffer.alloc(16)]);
    const destination = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {
      writes++; setImmediate(callback);
    } });
    const transfer = pump(source, destination, () => {}, makeGate(), manager._limiter());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes).toBe(1);
    manager.setOptions({ limitBytes });
    await transfer;
    expect(writes).toBe(2);
    expect(manager._rateListeners.size).toBe(0);
  });
  it('waits for bandwidth even when the destination drains immediately', async () => {
    const writes = [];
    const source = Readable.from([Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)]);
    const destination = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {
      writes.push(Date.now()); setImmediate(callback);
    } });
    const started = Date.now();
    const count = await pump(source, destination, () => {}, makeGate(), () => 120);
    expect(count).toBe(96);
    expect(writes[1] - writes[0]).toBeGreaterThanOrEqual(100);
    expect(writes[2] - writes[1]).toBeGreaterThanOrEqual(100);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });
  it('reserves bandwidth for concurrent streams and preserves the entire delay', () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const manager = new TransferManager({ getConn: async () => null });
    manager.setOptions({ limitBytes: 100 });
    expect(manager._limitTake(100)).toBe(1000);
    expect(manager._limitTake(100)).toBe(2000);
    vi.setSystemTime(1000);
    expect(manager._limitTake(100)).toBe(2000);
    vi.setSystemTime(4000);
    expect(manager._limitTake(100)).toBe(0);
  });
  it('aborts while waiting for bandwidth without writing another chunk', async () => {
    const gate = makeGate(); let writes = 0;
    const source = Readable.from([Buffer.alloc(16), Buffer.alloc(16)]);
    const destination = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {
      writes++; setImmediate(callback);
    } });
    const transfer = pump(source, destination, () => setImmediate(() => gate.abort()), gate, () => 5000);
    await expect(transfer).rejects.toMatchObject({ aborted: true });
    expect(writes).toBe(1);
    expect(gate._streams.size).toBe(0);
  });
});
