import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TransferManager } from '../electron/transfer.cjs';

// 不触网的状态机单测：getConn 永不 resolve（排队中的任务不会真正启动）
const neverConn = () => new Promise(() => {});

function makeTm(storeFile) {
  const updates = [];
  const tm = new TransferManager({ getConn: neverConn, storeFile: storeFile || null });
  tm.maxConcurrent = 0; // 白盒：不让 _schedule 真正启动任务，保证任务停在 queued
  tm.onUpdate((t) => updates.push(t));
  return { tm, updates };
}

const job = (name, extra = {}) => ({ kind: 'upload', serverId: 's1', name, srcLocal: `/x/${name}`, dstRemote: `/y/${name}`, size: 1, ...extra });

describe('TransferManager queue state machine', () => {
  let tm;
  beforeEach(() => {
    tm = makeTm().tm;
  });

  it('addMany enqueues in order and publishes fields', () => {
    const [a, b] = tm.addMany([job('a'), job('b')]);
    expect(a.status).toBe('queued');
    expect(b.status).toBe('queued');
    expect(tm.list().length).toBe(2);
    expect(a.srcPath).toBe('/x/a');
    expect(a.dstPath).toBe(':/y/a'); // serverName 为空 → '': + 远程路径
  });

  it('pause/resume/cancel a queued task', () => {
    const [a] = tm.addMany([job('a')]);
    expect(tm.pause(a.id)).toBe(true);
    expect(tm.tasks.get(a.id).status).toBe('paused');
    expect(tm.queue.includes(a.id)).toBe(false);
    expect(tm.resume(a.id)).toBe(true);
    expect(tm.tasks.get(a.id).status).toBe('queued');
    expect(tm.cancel(a.id)).toBe(true);
    expect(tm.tasks.get(a.id).status).toBe('canceled');
  });

  it('move reorders the queue (仅排队任务)', () => {
    const [a, b, c] = tm.addMany([job('a'), job('b'), job('c')]);
    expect(tm.move(c.id, 'up')).toBe(true);
    expect(tm.queue.slice(0, 3)).toEqual([a.id, c.id, b.id]);
    expect(tm.move(a.id, 'up')).toBe(false); // 已在队首
    expect(tm.move(a.id, 'down')).toBe(true);
    expect(tm.queue.slice(0, 3)).toEqual([c.id, a.id, b.id]);
  });

  it('remove drops the task, but not a running one', () => {
    const [a] = tm.addMany([job('a')]);
    expect(tm.remove(a.id)).toBe(true);
    expect(tm.tasks.has(a.id)).toBe(false);
    const [b] = tm.addMany([job('b')]);
    tm.tasks.get(b.id).status = 'running'; // 白盒模拟运行态
    expect(tm.remove(b.id)).toBe(false);
    expect(tm.tasks.has(b.id)).toBe(true);
  });

  it('retryFailed requeues only error tasks', () => {
    const [a, b] = tm.addMany([job('a'), job('b')]);
    tm.tasks.get(a.id).status = 'error';
    tm.tasks.get(a.id).error = 'boom';
    tm.tasks.get(b.id).status = 'paused';
    tm.retryFailed();
    expect(tm.tasks.get(a.id).status).toBe('queued');
    expect(tm.tasks.get(a.id).error).toBe('');
    expect(tm.tasks.get(b.id).status).toBe('paused');
  });

  it('setConcurrency clamps to 1..15 (0/NaN 视为未设置回退默认)', () => {
    expect(tm.setConcurrency(99)).toBe(15);
    expect(tm.setConcurrency(0)).toBe(15);
    expect(tm.setConcurrency(-1)).toBe(1);
    expect(tm.setConcurrency(7)).toBe(7);
  });

  it('pauseAll/resumeAll sweep all tasks', () => {
    const [a, b] = tm.addMany([job('a'), job('b')]);
    tm.pauseAll();
    expect(tm.tasks.get(a.id).status).toBe('paused');
    expect(tm.tasks.get(b.id).status).toBe('paused');
    tm.resumeAll();
    expect(tm.tasks.get(a.id).status).toBe('queued');
    expect(tm.tasks.get(b.id).status).toBe('queued');
  });

  it('prune keeps at most KEEP_FINISHED finished tasks and always keeps active ones', () => {
    const tm2 = makeTm().tm;
    const keepActive = tm2.addMany([job('active')]);
    for (let i = 0; i < 230; i++) {
      const [t] = tm2.addMany([job(`done-${i}`)]);
      tm2.tasks.get(t.id).status = 'done';
      tm2.tasks.get(t.id).finishedAt = i; // 越小越旧
    }
    tm2.list(); // 触发 _prune
    const done = [...tm2.tasks.values()].filter((t) => t.status === 'done');
    expect(done.length).toBe(200);
    // 最旧的 30 个被淘汰，最新的保留
    expect(done.some((t) => t.name === 'done-0')).toBe(false);
    expect(done.some((t) => t.name === 'done-29')).toBe(false);
    expect(done.some((t) => t.name === 'done-30')).toBe(true);
    expect(tm2.tasks.get(keepActive[0].id).status).toBe('queued');
  });
});

describe('TransferManager persistence', () => {
  it('round-trips through the store file; running/queued degrade to paused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-tm-'));
    const storeFile = path.join(dir, 'transfers.json');
    const t1 = makeTm(storeFile).tm;
    const [a] = t1.addMany([job('keep', { serverName: 'srv-a', kind: 'download', srcRemote: '/r/a', dstLocal: 'C:\\tmp\\a' })]);
    t1.tasks.get(a.id).status = 'running';
    const [b] = t1.addMany([job('done-keep')]);
    t1.tasks.get(b.id).status = 'done';
    t1.tasks.get(b.id).transferred = t1.tasks.get(b.id).size;
    await t1._persistNow();

    const t2 = makeTm(storeFile).tm;
    expect(t2.tasks.size).toBe(2);
    expect(t2.tasks.get(a.id).status).toBe('paused'); // 跨重启 running → paused
    expect(t2.tasks.get(a.id).kind).toBe('download');
    expect(t2.tasks.get(a.id).serverName).toBe('srv-a');
    expect(t2.tasks.get(b.id).status).toBe('done');
    expect(t2.tasks.get(b.id).transferred).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prunes oversized store files on load', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-tm-'));
    const storeFile = path.join(dir, 'transfers.json');
    const t1 = makeTm(storeFile).tm;
    for (let i = 0; i < 240; i++) {
      const [t] = t1.addMany([job(`d-${i}`)]);
      t1.tasks.get(t.id).status = 'done';
      t1.tasks.get(t.id).finishedAt = i;
    }
    await t1._persistNow();

    const t2 = makeTm(storeFile).tm; // _load 内部触发 _prune + 回写
    expect(t2.tasks.size).toBe(200);
    // 等待异步回写完成
    await t2._persistNow();
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    expect(raw.length).toBe(200);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
