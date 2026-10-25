import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncPlanner, safeRelative } from '../electron/sync-planner.cjs';

const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sync-test-'));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const localDir = path.join(directory, 'local'); fs.mkdirSync(localDir);
  const old = Math.floor(Date.now() / 1000) * 1000 - 3600000;
  const remote = new Map([['/sync', { type: 'dir', size: 0, mtime: old }]]);
  const tasks = [], jobs = [];
  const sftp = {
    realpath: (value, cb) => cb(null, value),
    lstat: (value, cb) => { const item = remote.get(value); if (item) cb(null, { size: item.size, mtime: item.mtime / 1000, atime: item.mtime / 1000, mode: item.type === 'dir' ? 0o40755 : item.type === 'link' ? 0o120777 : 0o100644 }); else cb({ code: 2 }); },
    utimes: (value, _atime, mtime, cb) => { remote.get(value).mtime = Math.floor(mtime) * 1000; cb(null); },
    unlink: (value, cb) => { remote.delete(value); cb(null); },
  };
  const connection = {
    sftp: async () => sftp,
    listDir: async (base) => ({ entries: [...remote].filter(([p]) => p !== base && path.posix.dirname(p) === base).map(([p, item]) => ({ name: path.posix.basename(p), ...item })) }),
    mkdirpRemote: async (name) => { remote.set(name, { type: 'dir', size: 0, mtime: Date.now() }); },
  };
  const transfers = { list: () => tasks, addMany: (items) => items.map((job) => { const task = { id: 't' + tasks.length, status: 'queued', startedAt: Date.now(), finishedAt: 0 }; jobs.push(job); tasks.push(task); return task; }) };
  const planner = new SyncPlanner({ directory: path.join(directory, 'state'), getConnection: async () => connection,
    getServers: () => [{ id: 's', host: 'first' }, { id: 'other', host: 'other' }], transfers, ...options });
  cleanups.push(() => planner.close());
  const request = (extra = {}) => ({ serverId: 's', direction: 'upload', localDir, remoteDir: '/sync', ...extra });
  const writeLocal = (name, contents = 'abc') => { const file = path.join(localDir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); fs.utimesSync(file, new Date(old), new Date(old)); return file; };
  const writeRemote = (name, contents = 'abc') => remote.set('/sync/' + name, { type: 'file', size: Buffer.byteLength(contents), mtime: old, contents });
  const complete = () => jobs.forEach((job, index) => { if (job.kind === 'upload') remote.set(job.dstRemote, { type: 'file', size: fs.statSync(job.srcLocal).size, mtime: Math.floor(Date.now() / 1000) * 1000 });
    else { fs.mkdirSync(path.dirname(job.dstLocal), { recursive: true }); fs.writeFileSync(job.dstLocal, remote.get(job.srcRemote).contents); }
    tasks[index].status = 'done'; tasks[index].finishedAt = Date.now();
    if (job.kind === 'upload') { const stat = remote.get(job.dstRemote); tasks[index].completedDestination = { size: stat.size, mtime: stat.mtime }; }
    else { const stat = fs.statSync(job.dstLocal); tasks[index].completedDestination = { size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev }; }
  });
  return { planner, remote, tasks, jobs, request, writeLocal, writeRemote, complete, connection, localDir };
}

describe('previewed synchronization', () => {
  it('excludes ignored subtrees from copies and deletions and rejects unsafe names', async () => {
    const f = fixture(); f.writeLocal('code.py'); f.writeLocal('cache/skip.bin'); f.writeRemote('cache/old.bin');
    f.remote.set('/sync/cache', { type: 'dir', size: 0, mtime: Date.now() });
    const preview = await f.planner.preview(f.request({ exclude: ['cache/**', 'cache'], deleteExtraneous: true }));
    expect(preview.changes.map((item) => item.path)).toEqual(['code.py']);
    for (const invalid of ['../outside', '/root', 'dir/../outside', 'a\\b']) expect(() => safeRelative(invalid)).toThrow();
  });
  it('revalidates source metadata before starting any copy', async () => {
    const f = fixture(); const file = f.writeLocal('code.py'); const plan = await f.planner.preview(f.request());
    fs.appendFileSync(file, 'changed');
    await expect(f.planner.apply(plan.id)).rejects.toThrow('changed since preview'); expect(f.jobs).toHaveLength(0);
  });
  it('keeps deletions blocked until every transfer succeeds', async () => {
    const f = fixture(); f.writeLocal('new.txt'); f.writeRemote('extra.txt');
    const plan = await f.planner.preview(f.request({ deleteExtraneous: true }));
    await f.planner.apply(plan.id); await f.planner.tick(); expect(f.remote.has('/sync/extra.txt')).toBe(true);
    f.complete(); await f.planner.tick(); expect(f.remote.has('/sync/extra.txt')).toBe(false); expect(f.planner.list()[0].status).toBe('done');
    expect((await f.planner.preview(f.request())).changes).toEqual([]);
  });
  it('stops deletions after transfer errors or source changes after copying', async () => {
    const f = fixture(); const file = f.writeLocal('new.txt'); f.writeRemote('extra.txt');
    const plan = await f.planner.preview(f.request({ deleteExtraneous: true })); await f.planner.apply(plan.id);
    f.complete(); fs.appendFileSync(file, 'changed'); await f.planner.tick();
    expect(f.planner.list()[0].status).toBe('error'); expect(f.remote.has('/sync/extra.txt')).toBe(true);
  });
  it('preserves remote source times after a download so the next preview is unchanged', async () => {
    const f = fixture(); f.writeRemote('old.txt'); const plan = await f.planner.preview(f.request({ direction: 'download' }));
    await f.planner.apply(plan.id); f.complete(); await f.planner.tick();
    expect(f.planner.list()[0].status).toBe('done'); expect((await f.planner.preview(f.request({ direction: 'download' }))).changes).toEqual([]);
  });
  it('rejects edits after a copy and legacy completions without commit metadata', async () => {
    const f = fixture(); f.writeLocal('new.txt'); f.writeRemote('extra.txt');
    const plan = await f.planner.preview(f.request({ deleteExtraneous: true })); await f.planner.apply(plan.id); f.complete();
    f.remote.get('/sync/new.txt').mtime += 1000;
    await f.planner.tick(); expect(f.planner.list()[0].error).toContain('destination changed'); expect(f.remote.has('/sync/extra.txt')).toBe(true);
    const next = await f.planner.preview(f.request({ deleteExtraneous: true })); await f.planner.apply(next.id); f.complete();
    delete f.tasks.at(-1).completedDestination;
    await f.planner.tick(); expect(f.planner.list().at(-1).error).toContain('metadata is unavailable'); expect(f.remote.has('/sync/extra.txt')).toBe(true);
  });
  it('does not complete or delete while directory preparation is pending', async () => {
    const f = fixture(); f.writeLocal('folder/file.txt'); f.writeRemote('extra.txt');
    const plan = await f.planner.preview(f.request({ deleteExtraneous: true }));
    let release, entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    f.connection.mkdirpRemote = async () => { entered(); await new Promise((resolve) => { release = resolve; }); };
    const pending = f.planner.apply(plan.id); await waiting; await f.planner.tick();
    expect(f.planner.list()[0].status).toBe('copying'); expect(f.remote.has('/sync/extra.txt')).toBe(true);
    release(); await pending; expect(f.jobs).toHaveLength(1);
  });
  it('locks overlapping local destination trees even across different servers', async () => {
    const f = fixture(); fs.mkdirSync(path.join(f.localDir, 'child')); f.writeRemote('file.txt');
    const first = await f.planner.preview(f.request({ direction: 'download' }));
    const second = await f.planner.preview(f.request({ serverId: 'other', direction: 'download', localDir: path.join(f.localDir, 'child') }));
    await f.planner.apply(first.id); await expect(f.planner.apply(second.id)).rejects.toThrow('overlapping');
  });
  it('retains directory locks while an errored preparation still has live copy jobs', async () => {
    const f = fixture(); f.writeLocal('a.txt'); f.writeLocal('z/file.txt');
    const plan = await f.planner.preview(f.request());
    f.connection.mkdirpRemote = async () => { throw new Error('mkdir failed'); };
    await expect(f.planner.apply(plan.id)).rejects.toThrow('mkdir failed');
    expect(f.tasks).toHaveLength(1); expect(f.planner.list()[0].status).toBe('error');
    const next = await f.planner.preview(f.request());
    await expect(f.planner.apply(next.id)).rejects.toThrow('overlapping');
  });
  it('rejects case collisions and reserved names for Windows downloads', async () => {
    const f = fixture({ platform: 'win32' }); f.writeRemote('A.txt'); f.writeRemote('a.txt');
    await expect(f.planner.preview(f.request({ direction: 'download' }))).rejects.toThrow('collision');
    f.remote.delete('/sync/A.txt'); f.remote.delete('/sync/a.txt'); f.writeRemote('CON.txt');
    await expect(f.planner.preview(f.request({ direction: 'download' }))).rejects.toThrow('Windows');
  });
  it('enforces a finite directory preview limit before scheduling transfers', async () => {
    const f = fixture({ maxEntries: 2 }); f.writeLocal('one'); f.writeLocal('two'); f.writeLocal('three');
    await expect(f.planner.preview(f.request())).rejects.toThrow('entry limit'); expect(f.jobs).toHaveLength(0);
  });
});
