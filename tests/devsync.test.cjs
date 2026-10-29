import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DevSyncManager } from '../electron/devsync.cjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-devsync-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function manager(store, { debounceMs = 30 } = {}) {
  const enqueued = [];
  const m = new DevSyncManager({
    storeFile: path.join(store, 'syncpairs.json'),
    enqueue: (jobs) => enqueued.push(...jobs),
    getServers: () => [{ id: 's1', name: 'alpha' }],
    debounceMs,
  });
  return { m, enqueued };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('glob excludes and path mapping', () => {
  it('maps glob patterns to rel-path matches', () => {
    expect(DevSyncManager.excluded('a.tmp', ['**/*.tmp'])).toBe(true);
    expect(DevSyncManager.excluded('node_modules/x/y.js', ['node_modules'])).toBe(true);
    expect(DevSyncManager.excluded('src/x/node_modules/y.js', ['node_modules'])).toBe(true);
    expect(DevSyncManager.excluded('src/main.py', ['**/*.tmp', 'node_modules'])).toBe(false);
    expect(DevSyncManager.excluded('data/input?.csv', ['data/input?.csv'])).toBe(true); // ? 匹配单字符本身也行
    expect(DevSyncManager.excluded('sub/a.tmp', ['*.tmp'])).toBe(true); // 任一路径段匹配
  });
  it('maps local files onto the remote tree', () => {
    const localDir = path.resolve('/work/train');
    expect(DevSyncManager.remotePathFor(localDir, '/root/runs', path.join(localDir, 'a.py'))).toBe('/root/runs/a.py');
    expect(DevSyncManager.remotePathFor(localDir, '/root/runs/', path.join(localDir, 'sub', 'b.py'))).toBe('/root/runs/sub/b.py');
    expect(DevSyncManager.remotePathFor(localDir, '/', path.join(localDir, 'c.py'))).toBe('/c.py');
  });
});

describe('pair lifecycle', () => {
  it('validates local dir, remote dir and server', () => {
    const store = tmp(), local = tmp();
    const { m } = manager(store);
    expect(() => m.save({ localDir: 'relative/path', remoteDir: '/x', serverId: 's1' })).toThrow(/absolute/);
    expect(() => m.save({ localDir: path.join(local, 'missing'), remoteDir: '/x', serverId: 's1' })).toThrow(/does not exist/);
    expect(() => m.save({ localDir: local, remoteDir: 'x', serverId: 's1' })).toThrow(/absolute POSIX/);
    expect(() => m.save({ localDir: local, remoteDir: '/x', serverId: 'nope' })).toThrow(/Unknown server/);
  });
  it('saves, persists, reloads and deletes pairs', () => {
    const store = tmp(), local = tmp();
    const { m } = manager(store);
    const pair = m.save({ localDir: local, remoteDir: '/root/runs', serverId: 's1', excludes: ['**/*.tmp'] });
    expect(pair.enabled).toBe(true);
    const reloaded = new DevSyncManager({ storeFile: path.join(store, 'syncpairs.json'), enqueue: () => {}, getServers: () => [{ id: 's1' }] }).init();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0].excludes).toEqual(['**/*.tmp']);
    m.delete(pair.id);
    expect(m.list()).toHaveLength(0);
  });
});

describe('watch and flush', () => {
  it('debounces changes into queued upload jobs with mapped remote paths', async () => {
    const store = tmp(), local = tmp();
    const { m, enqueued } = manager(store);
    m._start = () => {}; // 不启动真实 fs.watch，手工驱动
    const pair = m.save({ localDir: local, remoteDir: '/root/runs', serverId: 's1', excludes: ['**/*.tmp'] });
    fs.writeFileSync(path.join(local, 'train.py'), 'print(1)');
    fs.writeFileSync(path.join(local, 'junk.tmp'), 'x');
    m._handleChange(pair.id, path.join(local, 'train.py'));
    m._handleChange(pair.id, path.join(local, 'junk.tmp'));
    await sleep(250);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].kind).toBe('upload');
    expect(enqueued[0].dstRemote).toBe('/root/runs/train.py');
    expect(enqueued[0].serverName).toBe('alpha');
    expect(enqueued[0].size).toBe(8);
    const saved = m.list().find((p) => p.id === pair.id);
    expect(saved.lastFiles).toEqual(['train.py']);
    // 暂停后不再入队
    await m.toggle(pair.id, false);
    m._handleChange(pair.id, path.join(local, 'train2.py'));
    await sleep(150);
    expect(enqueued).toHaveLength(1);
  });
  it('skips directories, deletions and out-of-tree paths', async () => {
    const store = tmp(), local = tmp();
    const { m, enqueued } = manager(store);
    m._start = () => {};
    const pair = m.save({ localDir: local, remoteDir: '/r', serverId: 's1' });
    fs.mkdirSync(path.join(local, 'sub'));
    m._handleChange(pair.id, path.join(local, 'sub'));
    m._handleChange(pair.id, path.join(local, 'gone.py')); // 不存在 → 跳过
    m._handleChange(pair.id, path.join(local, '..', 'escape.txt')); // 越界 → 跳过
    await sleep(80);
    expect(enqueued).toHaveLength(0);
  });
  it('pickOnce queues the whole directory honouring excludes', () => {
    const store = tmp(), local = tmp();
    const { m, enqueued } = manager(store);
    m._start = () => {};
    fs.writeFileSync(path.join(local, 'a.py'), 'a');
    fs.mkdirSync(path.join(local, 'sub'));
    fs.writeFileSync(path.join(local, 'sub', 'b.py'), 'b');
    fs.writeFileSync(path.join(local, 'skip.log'), 's');
    const pair = m.save({ localDir: local, remoteDir: '/r', serverId: 's1', excludes: ['**/*.log'] });
    const count = m.pickOnce(pair.id);
    expect(count).toBe(2);
    expect(enqueued.map((j) => j.dstRemote).sort()).toEqual(['/r/a.py', '/r/sub/b.py']);
  });
});

describe('upload batch reconciliation', () => {
  function tracked() {
    const tasks = new Map(), store = tmp(), local = tmp();
    let now = 10000;
    const m = new DevSyncManager({storeFile: path.join(store, 'pairs.json'), enqueue: () => [], getTask: (id) => tasks.get(id), getServers: () => [{id: 's1'}], now: () => now});
    m._start = () => {}; const pair = m.save({localDir: local, remoteDir: '/r', serverId: 's1'});
    const add = (name, status) => {tasks.set(name, {id: name, status}); m.batches.set(name, {pairId: pair.id, taskIds: [name], expected: 1}); m.pairs[0].inflight = [...(m.pairs[0].inflight || []), {groupId: name, taskIds: [name], expected: 1}];};
    return {m,tasks,pair,add,setNow: (at) => {now=at;}};
  }
  it.each([true,false])('keeps active queued state when older completed batches settle (insertion order %s)', (olderFirst) => {
    const f = tracked();
    if (olderFirst) {f.add('old','done');f.add('new','queued');} else {f.add('new','queued');f.add('old','done');}
    f.m.refresh(); expect(f.m.pairs[0].status).toBe('queued'); expect(f.m.pairs[0].lastSyncAt).toBe(10000);
    expect(f.m.batches.size).toBe(1); f.m.stopAll();
  });
  it('releases missing task batches, reports error and never advances lastSyncAt', () => {
    const f = tracked(); f.add('missing','queued');f.tasks.delete('missing');f.m.refresh();
    expect(f.m.pairs[0].status).toBe('error');expect(f.m.pairs[0].lastError).toMatch(/missing/);expect(f.m.pairs[0].lastSyncAt).toBe(0);expect(f.m.batches.size).toBe(0);expect(f.m.pairs[0].inflight).toEqual([]);f.m.stopAll();
  });
  it('preserves paused state and credits only completed batches', () => {
    const f = tracked();f.add('one','running');f.m.pairs[0].enabled=false;f.m.refresh();expect(f.m.pairs[0].status).toBe('paused');expect(f.m.pairs[0].lastSyncAt).toBe(0);
    f.tasks.get('one').status='done';f.setNow(20000);f.m.refresh();expect(f.m.pairs[0].status).toBe('paused');expect(f.m.pairs[0].lastSyncAt).toBe(20000);f.m.stopAll();
  });
});
