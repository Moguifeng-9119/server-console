import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DevSyncManager } from '../electron/devsync.cjs';

const directories = [], managers = [];
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-devsync-status-')); directories.push(directory);
  const tasks = new Map(); let now = 1000;
  const manager = new DevSyncManager({ storeFile: path.join(directory, 'pairs.json'), getServers: () => [{ id: 's1' }], now: () => now, getTask: (id) => tasks.get(id), enqueue: (jobs) => jobs.map((job, index) => { const task = { ...job, id: 'task-' + tasks.size + '-' + index, status: 'queued' }; tasks.set(task.id, task); return task; }) });
  managers.push(manager); manager._start = () => {};
  fs.writeFileSync(path.join(directory, 'run.py'), 'print(1)');
  manager.save({ serverId: 's1', localDir: directory, remoteDir: '/work', excludes: ['pairs.json'] }); const pair = manager.pairs[0];
  return { directory, manager, pair, tasks, setNow: (value) => { now = value; } };
}
afterEach(() => { for (const manager of managers.splice(0)) manager.stopAll(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe('save-and-upload completion state', () => {
  it('keeps the rescan error when scanning any directory fails', () => {
    const { manager, pair, directory, tasks } = setup(); fs.mkdirSync(path.join(directory, 'blocked'));
    pair.needsRescan = true; pair.lastError = 'Pending sync limit reached';
    const read = fs.readdirSync; const spy = vi.spyOn(fs, 'readdirSync').mockImplementation((target, ...args) => { if (String(target).endsWith('blocked')) throw new Error('EACCES'); return read(target, ...args); });
    try { expect(() => manager.pickOnce(pair.id)).toThrow('EACCES'); expect(pair.needsRescan).toBe(true); expect(tasks.size).toBe(0); } finally { spy.mockRestore(); }
  });
  it('updates lastSyncAt only after actual successful transfer completion', () => {
    const { manager, pair, directory, tasks, setNow } = setup(); manager._queue(pair, [path.join(directory, 'run.py')]);
    expect(manager.list()[0]).toMatchObject({ lastSyncAt: 0, status: 'queued' });
    const task = [...tasks.values()][0]; task.status = 'running'; expect(manager.list()[0].status).toBe('uploading');
    setNow(9000); task.status = 'done'; expect(manager.list()[0]).toMatchObject({ lastSyncAt: 9000, status: 'done' });
  });
  it('retains and retries a change when the upload batch limit is reached', async () => {
    const { manager, pair, directory, tasks } = setup();
    const file = path.join(directory, 'run.py');
    for (let i = 0; i < 200; i++) manager.batches.set('busy-' + i, {});
    manager.pending.set(pair.id, new Set([file]));
    await expect(manager._flush(pair.id)).rejects.toThrow('Pending upload batch limit reached');
    expect(manager.pending.get(pair.id).has(file)).toBe(true);
    expect(pair).toMatchObject({ status: 'error', lastError: 'Pending upload batch limit reached' });
    manager.batches.clear();
    await manager._flush(pair.id);
    expect(tasks.size).toBe(1);
    expect(manager.pending.get(pair.id).size).toBe(0);
  });
  it('keeps a change beyond the old 2000-file pending limit', () => {
    const { manager, pair, directory } = setup(); const file = path.join(directory, 'run.py');
    manager.pending.set(pair.id, new Set(Array.from({ length: 2000 }, (_, i) => path.join(directory, `pending-${i}`))));
    manager._handleChange(pair.id, file);
    expect(manager.pending.get(pair.id).has(file)).toBe(true);
  });
  it('does not enqueue the same files again when persistence fails after enqueue', async () => {
    const { manager, pair, directory, tasks } = setup(), file = path.join(directory, 'run.py');
    manager.pending.set(pair.id, new Set([file]));
    const persist = vi.spyOn(manager, 'persist').mockImplementation(() => { throw new Error('disk full'); });
    await expect(manager._flush(pair.id)).rejects.toThrow('disk full');
    expect(tasks.size).toBe(1); expect(manager.pending.get(pair.id).size).toBe(0); expect(pair.lastError).toContain('disk full');
    persist.mockRestore(); await manager._flush(pair.id); expect(tasks.size).toBe(1);
  });
  it('retains last successful time and exposes transfer errors', () => {
    const { manager, pair, directory, tasks } = setup(); manager._queue(pair, [path.join(directory, 'run.py')]);
    const task = [...tasks.values()][0]; task.status = 'error'; task.error = 'connection lost';
    expect(manager.list()[0]).toMatchObject({ lastSyncAt: 0, status: 'error', lastError: 'connection lost' });
  });
  it('clears pending changes when paused and never flushes them after resume', async () => {
    const { manager, pair, directory, tasks } = setup(); manager._handleChange(pair.id, path.join(directory, 'run.py'));
    manager.toggle(pair.id, false); manager.toggle(pair.id, true); await manager._flush(pair.id);
    expect(tasks.size).toBe(0); expect(manager.pending.has(pair.id)).toBe(false);
  });
  it('skips files reached through symbolic links', () => {
    const { manager, directory } = setup(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-devsync-outside-')); directories.push(outside);
    fs.writeFileSync(path.join(outside, 'private.py'), 'secret');
    try { fs.symlinkSync(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { return; }
    expect(manager._contained(directory, path.join(directory, 'linked', 'private.py'))).toBe(false);
    expect(manager._walk(directory).some((file) => file.includes('private.py'))).toBe(false);
  });
});
