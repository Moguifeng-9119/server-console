import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
function receiver(options) {
  const context = { process: { platform: 'win32' }, console, require: (name) => { if (name !== 'electron') throw new Error('Sandboxed preload cannot require ' + name); return { contextBridge: { exposeInMainWorld() {} }, ipcRenderer: {}, webUtils: {} }; } };
  vm.runInNewContext(fs.readFileSync('electron/preload.cjs', 'utf8') + '\nglobalThis.Receiver = FrameReceiver;', context);
  return new context.Receiver(options);
}
const frame = (epoch, seq, kind = 'keyframe', baseSeq = 0, value = seq) => ({ version: 1, serverId: 'a', epoch, seq, kind, baseSeq, payload: { value } });
describe('production sandboxed preload frame receiver', () => {
  it('does not roll back to a previous epoch when an earlier resync completes', async () => {
    let resolve; const values = [];
    const r = receiver({ fetchCurrent: () => new Promise((done) => { resolve = done; }), emit: (state) => values.push(state.value) });
    r.receive(frame('old', 1)); r.receive(frame('old', 3, 'delta', 2)); r.receive(frame('new', 1, 'keyframe', 0, 100));
    resolve({ snapshot: { value: 2 }, seq: 2, epoch: 'old' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(values).toEqual([1, 100]); expect(r.states.get('a').epoch).toBe('new');
    r.receive(frame('old', 4)); expect(values).toEqual([1, 100]);
  });
  it('does not retry a failed or empty resync without a new external frame', async () => {
    let calls = 0;
    const r = receiver({ fetchCurrent: async () => { calls++; return { snapshot: null }; }, emit: () => {} });
    r.receive(frame('old', 1)); r.receive(frame('old', 3, 'delta', 2));
    for (let i = 0; i < 10; i++) await Promise.resolve(); expect(calls).toBe(1);
    r.receive(frame('old', 4, 'delta', 3)); for (let i = 0; i < 10; i++) await Promise.resolve(); expect(calls).toBe(2);
  });
  it('replays a contiguous queued suffix after a successful resync', async () => {
    let resolve; const values = [];
    const r = receiver({ fetchCurrent: () => new Promise((done) => { resolve = done; }), emit: (s) => values.push(s.value) });
    r.receive(frame('one', 3, 'delta', 2)); r.receive(frame('one', 4, 'delta', 3));
    resolve({ snapshot: { value: 2 }, epoch: 'one', seq: 2 });
    for (let i = 0; i < 8; i++) await Promise.resolve(); expect(values).toEqual([2, 3, 4]);
  });
});
