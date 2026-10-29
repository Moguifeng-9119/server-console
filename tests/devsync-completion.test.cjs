import { afterEach, describe, expect, it } from 'vitest';
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
  it('updates lastSyncAt only after actual successful transfer completion', () => {
    const { manager, pair, directory, tasks, setNow } = setup(); manager._queue(pair, [path.join(directory, 'run.py')]);
    expect(manager.list()[0]).toMatchObject({ lastSyncAt: 0, status: 'queued' });
    const task = [...tasks.values()][0]; task.status = 'running'; expect(manager.list()[0].status).toBe('uploading');
    setNow(9000); task.status = 'done'; expect(manager.list()[0]).toMatchObject({ lastSyncAt: 9000, status: 'done' });
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
