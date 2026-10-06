import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { StageJournal } from '../electron/stage-journal.cjs';
import { TransferManager } from '../electron/transfer.cjs';
import { uploadPart } from '../electron/safe-files.cjs';
import { comparePrefixes } from '../electron/resume-verifier.cjs';
import { migrateTask, canResume } from '../electron/task-store.cjs';

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-recovery-'));
const job = (dir) => ({ id: 'owned-task', kind: 'download', serverId: 'fixture', srcRemote: '/source', dstLocal: path.join(dir, 'target'), status: 'paused', transferred: 3, size: 9 });
const manager = (dir, extra = {}) => new TransferManager({ storeFile: path.join(dir, 'tasks.json'), getConn: () => { throw new Error('offline'); }, ...extra });
const stopSave = (tm) => clearTimeout(tm._saveTimer);

describe('durable staging ownership and collection', () => {
  it('can explicitly forget an old record after cancellation cleanup settles, without removing files', async () => {
    const dir = directory(), tm = manager(dir), task = { ...job(dir), kind: 'upload', dstRemote: '/old-target', srcLocal: '/source', stagedUploads: [uploadPart('/old-target', 'owned-task')] };
    tm.tasks.set(task.id, task);
    const unlink = vi.spyOn(fs.promises, 'unlink');
    try {
      tm.cancel(task.id); const cleanup = task._cleanupPromise;
      expect(tm.forgetLegacy(task.id)).toBe(false); await cleanup;
      expect(task._cleanupPromise).toBeNull(); expect(tm.forgetLegacy(task.id)).toBe(true);
      expect(unlink).not.toHaveBeenCalled(); expect(tm.tasks.has(task.id)).toBe(false);
    } finally { unlink.mockRestore(); stopSave(tm); }
  });
  it('does not expose an uncommitted cleanup intent to concurrent garbage collection', async () => {
    const dir = directory(), tm = manager(dir), task = job(dir), staged = uploadPart(task.dstLocal, task.id);
    tm.tasks.set(task.id, task); await tm._stage(task, 'stagedDownloads', staged, task.dstLocal);
    fs.writeFileSync(staged, 'keep');
    let release; const wait = new Promise((resolve) => { release = resolve; });
    let entered; const started = new Promise((resolve) => { entered = resolve; });
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async () => { entered(); await wait; throw new Error('disk failure'); });
    try {
      const cleanup = tm._cleanup(task); await started;
      expect(tm.staging.journal.list()[0].disposition).toBe('retain');
      await tm.collectStaging({ localOnly: true });
      expect(fs.readFileSync(staged, 'utf8')).toBe('keep');
      release(); expect(await cleanup).toBe(false);
      expect(fs.existsSync(staged)).toBe(true);
    } finally { release(); rename.mockRestore(); stopSave(tm); }
  });
  it('recovers a stage registered before the debounced task store was saved', async () => {
    const dir = directory(), tm = manager(dir), task = job(dir), staged = uploadPart(task.dstLocal, task.id);
    tm.tasks.set(task.id, task);
    await tm._stage(task, 'stagedDownloads', staged, task.dstLocal);
    fs.writeFileSync(staged, 'abc'); stopSave(tm);
    expect(fs.existsSync(tm.storeFile)).toBe(false);
    const restored = manager(dir);
    expect(restored.tasks.get(task.id).status).toBe('paused');
    expect(restored.pub(restored.tasks.get(task.id)).resumable).toBe(true);
    await restored.collectStaging({ localOnly: true });
    expect(fs.readFileSync(staged, 'utf8')).toBe('abc');
    stopSave(restored);
  });

  it('cleans a canceled stage after a simulated crash and leaves another task untouched', async () => {
    const dir = directory(), tm = manager(dir), task = job(dir), staged = uploadPart(task.dstLocal, task.id);
    tm.tasks.set(task.id, task);
    await tm._stage(task, 'stagedDownloads', staged, task.dstLocal);
    fs.writeFileSync(staged, 'abc');
    const foreign = uploadPart(task.dstLocal, 'another-task'); fs.writeFileSync(foreign, 'keep');
    await tm.staging.journal.markCleanup(task.id); stopSave(tm);
    const restored = manager(dir);
    await restored.collectStaging({ localOnly: true });
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.readFileSync(foreign, 'utf8')).toBe('keep');
    expect(restored.staging.journal.list()).toEqual([]);
    expect(restored.tasks.get(task.id).status).toBe('canceled'); stopSave(restored);
  });

  it('retains failed remote cleanup for retry and refuses deletion on a changed endpoint', async () => {
    const dir = directory(); let endpoint = 'old-host', fail = true; const removed = [];
    const tm = manager(dir, { endpointIdentity: () => endpoint, getConn: () => ({ sftp: async () => ({ unlink: (p, cb) => { removed.push(p); cb(fail ? new Error('offline') : null); } }) }) });
    const task = { ...job(dir), kind: 'upload', srcLocal: '/local', dstRemote: '/target' };
    tm.tasks.set(task.id, task);
    const staged = uploadPart('/target', task.id);
    await tm._stage(task, 'stagedUploads', staged, '/target');
    expect(await tm._cleanup(task)).toBe(false);
    expect(tm.staging.journal.list()[0].disposition).toBe('cleanup');
    endpoint = 'replacement-host'; fail = false;
    await expect(tm._stage(task, 'stagedUploads', staged, '/target')).rejects.toThrow('Server identity changed');
    expect(await tm._cleanup(task)).toBe(false);
    expect(removed).toEqual([staged]);
    endpoint = 'old-host'; expect(await tm._cleanup(task)).toBe(true);
    expect(tm.staging.journal.list()).toEqual([]); stopSave(tm);
  });

  it('refuses invalid ownership and preserves an unreadable manifest', async () => {
    const dir = directory(), file = path.join(dir, 'journal.json'); fs.writeFileSync(file, '{broken');
    const journal = new StageJournal(file);
    await expect(journal.register({ taskId: 'x', side: 'local', target: '/target', path: '/target' })).rejects.toThrow('Invalid');
    await expect(journal.markCleanup('x')).rejects.toThrow('Cannot read');
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('cannot resume a canceled task while cleanup is pending', async () => {
    const dir = directory(), tm = manager(dir), task = job(dir); tm.tasks.set(task.id, task);
    const staged = uploadPart(task.dstLocal, task.id);
    await tm._stage(task, 'stagedDownloads', staged, task.dstLocal);
    await tm.staging.journal.markCleanup(task.id);
    expect(tm.resume(task.id)).toBe(false); stopSave(tm);
  });
});

describe('prefix verification progress and failure', () => {
  it('reports progress of the slower stream and still hashes the full prefix', async () => {
    const a = new PassThrough(), b = new PassThrough(), progress = [];
    const compared = comparePrefixes(a, b, 6, null, (v) => progress.push(v));
    a.end('abcdef'); b.write('abc');
    await new Promise((resolve) => setImmediate(resolve));
    expect(progress.at(-1)).toEqual({ bytes: 3, total: 6 });
    b.end('def'); expect(await compared).toBe(true);
    expect(progress.at(-1)).toEqual({ bytes: 6, total: 6 });
    expect(await comparePrefixes(Readable.from(['abcdef']), Readable.from(['abcxyz']), 6)).toBe(false);
  });

  it('rejects on premature close and destroys its peer', async () => {
    const a = new PassThrough(), b = new PassThrough();
    const compared = comparePrefixes(a, b, 6); const rejection = expect(compared).rejects.toThrow('closed');
    a.destroy(); await rejection; expect(b.destroyed).toBe(true);
  });

  it('can cancel both readers without waiting for a large prefix', async () => {
    const a = new PassThrough(), b = new PassThrough(), callbacks = new Set();
    const gate = { canceled: false, track() {}, untrack() {}, onAbort(fn) { callbacks.add(fn); return () => callbacks.delete(fn); } };
    const compared = comparePrefixes(a, b, 100_000_000_000, gate);
    const rejection = expect(compared).rejects.toMatchObject({ aborted: true });
    gate.canceled = true; for (const cb of callbacks) cb();
    await rejection; expect(a.destroyed && b.destroyed).toBe(true);
  });

  it('keeps verification reads separate from transferred bytes and clears state on failure', async () => {
    const tm = new TransferManager({ getConn: () => null }); const task = job(directory());
    tm.tasks.set(task.id, task);
    await expect(tm._verified(task, 'file', async (progress) => { progress({ bytes: 10, total: 30 }); expect(task.resumeCheck.bytes).toBe(10); expect(task.transferred).toBe(3); throw new Error('fixture'); })).rejects.toThrow('fixture');
    expect(task.resumeCheck).toBeUndefined();
  });
});

describe('legacy task migration', () => {
  it('explains missing execution inputs without manufacturing a new transfer error', () => {
    const task = migrateTask({ id: 'old', kind: 'upload', status: 'running' });
    expect(task.status).toBe('paused'); expect(task.recoveryReason).toBe('legacy-missing-inputs'); expect(canResume(task)).toBe(false);
    expect(migrateTask({ ...task, status: 'error', error: 'original failure' }).error).toBe('original failure');
    const synthetic = migrateTask({ ...task, status: 'error', error: 'This older task has no recovery inputs. Start a new transfer from the file manager.' });
    expect(synthetic.status).toBe('paused'); expect(synthetic.error).toBe('');
    expect(migrateTask({ ...job('/tmp'), status: 'running' }).recoveryReason).toBeUndefined();
    expect(migrateTask({ id: 'done', status: 'done' }).recoveryReason).toBeUndefined();
  });
});
