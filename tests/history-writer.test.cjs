import { describe, expect, it } from 'vitest';
import { HistoryWriter } from '../electron/history-writer.cjs';

const bucket = (revision = 1) => ({ server: 'a', device: 'gpu:x', metric: 'util', bucket_at: 1000, revision });
describe('history write queue', () => {
  it('retains failed transactions and retries without dropping samples', async () => {
    const calls = []; let fail = true; const errors = [];
    const writer = new HistoryWriter({ store: { request: async (_method, values) => { calls.push(values); if (fail) throw new Error('disk busy'); } }, onError: (e) => errors.push(e.message) });
    await writer.enqueue([bucket()]); expect(writer.pending.size).toBe(1);
    fail = false; await writer.pump(); expect(writer.pending.size).toBe(0);
    expect(calls).toHaveLength(2); expect(errors).toEqual(['disk busy']);
  });
  it('keeps a newer bucket revision while the earlier transaction is in flight', async () => {
    let release; const calls = [];
    const writer = new HistoryWriter({ store: { request: (_method, values) => { calls.push(values); return calls.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); } } });
    const first = writer.enqueue([bucket(1)]); void writer.enqueue([bucket(2)]);
    release(); await first; expect(writer.pending.size).toBe(1);
    await writer.pump(); expect(writer.pending.size).toBe(0); expect(calls[1][0].revision).toBe(2);
  });
});
