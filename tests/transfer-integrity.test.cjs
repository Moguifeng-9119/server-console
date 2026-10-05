import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeSshd } from '../scripts/fake-sshd.cjs';
import { Pool } from '../electron/ssh.cjs';
import { TransferManager } from '../electron/transfer.cjs';
import { uploadPart } from '../electron/safe-files.cjs';

async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-integrity-'));
  const root = path.join(dir, 'remote');
  const server = await createFakeSshd({ port: 0, root });
  const pool = new Pool();
  const config = { id: 'fixture', host: '127.0.0.1', port: server.address().port, username: 'fixture', password: 'x' };
  const getConn = (id) => { if (id !== 'fixture') throw new Error('Unknown server'); return pool.get(config); };
  const storeFile = path.join(dir, 'tasks.json');
  try { await run({ dir, root, getConn, storeFile }); }
  finally { pool.remove('fixture'); await new Promise((resolve) => server.close(resolve)); }
}

async function finished(tm, id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const task = tm.tasks.get(id);
    if (['done', 'error', 'canceled'].includes(task.status) && !task._gate) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Transfer did not finish');
}

describe('actual SFTP integrity and recovery', () => {
  it('serializes aliased download targets so concurrent payloads cannot interleave', async () => fixture(async ({ dir, root, getConn }) => {
    const first = Buffer.alloc(4 * 1024 * 1024, 'A'), second = Buffer.alloc(4 * 1024 * 1024, 'B');
    fs.writeFileSync(path.join(root, 'a'), first); fs.writeFileSync(path.join(root, 'b'), second);
    const target = path.join(dir, 'destination');
    const tm = new TransferManager({getConn}); tm.maxConcurrent = 2;
    const tasks = tm.addMany([
      {kind: 'download', serverId: 'fixture', name: 'a', srcRemote: '/a', dstLocal: target},
      {kind: 'download', serverId: 'fixture', name: 'b', srcRemote: '/b', dstLocal: dir + path.sep + 'unused' + path.sep + '..' + path.sep + 'destination'},
    ]);
    const results = await Promise.all(tasks.map((task) => finished(tm, task.id)));
    expect(results.map((task) => task.status)).toEqual(['done', 'done']);
    expect(fs.readFileSync(target).equals(second)).toBe(true);
    expect(fs.readdirSync(dir).filter((name) => name.includes('.scpart-'))).toEqual([]);
  }), 45000);

  it('replaces a shorter unrelated destination without appending its old prefix', async () => fixture(async ({ dir, root, getConn }) => {
    const source = path.join(dir, 'source');
    fs.writeFileSync(source, 'BBBBBCCCCCTTTTT');
    fs.writeFileSync(path.join(root, 'target'), 'AAAAA');
    const tm = new TransferManager({ getConn });
    const [task] = tm.addMany([{ kind: 'upload', serverId: 'fixture', name: 'target', srcLocal: source, dstRemote: '/target' }]);
    const result = await finished(tm, task.id);
    expect(result.status, result.error).toBe('done');
    expect(fs.readFileSync(path.join(root, 'target'), 'utf8')).toBe('BBBBBCCCCCTTTTT');
  }), 15000);

  it('resumes a real partial upload after constructing a new manager', async () => fixture(async ({ dir, root, getConn, storeFile }) => {
    const source = path.join(dir, 'source');
    fs.writeFileSync(source, 'correct prefix and remaining payload');
    const first = new TransferManager({ getConn, storeFile });
    first.maxConcurrent = 0;
    const [task] = first.addMany([{ kind: 'upload', serverId: 'fixture', name: 'target', srcLocal: source, dstRemote: '/target' }]);
    first.pause(task.id);
    fs.writeFileSync(path.join(root, uploadPart('/target', task.id).slice(1)), 'correct prefix');
    await first._persistNow(); clearTimeout(first._saveTimer);
    const second = new TransferManager({ getConn, storeFile });
    expect(second.resume(task.id)).toBe(true);
    expect((await finished(second, task.id)).status).toBe('done');
    expect(fs.readFileSync(path.join(root, 'target'))).toEqual(fs.readFileSync(source));
    await second._persistNow(); clearTimeout(second._saveTimer);
  }), 15000);

  it('rejects changed sources and leaves the completed destination intact', async () => fixture(async ({ dir, root, getConn }) => {
    const source = path.join(dir, 'source');
    fs.writeFileSync(source, 'new source'); fs.writeFileSync(path.join(root, 'target'), 'keep this destination');
    const tm = new TransferManager({ getConn }); tm.maxConcurrent = 0;
    const [task] = tm.addMany([{ kind: 'upload', serverId: 'fixture', name: 'target', srcLocal: source, dstRemote: '/target' }]);
    tm.tasks.get(task.id).sourceVersion = 'old-source'; tm.setConcurrency(1);
    expect((await finished(tm, task.id)).status).toBe('error');
    expect(fs.readFileSync(path.join(root, 'target'), 'utf8')).toBe('keep this destination');
  }), 15000);

  it('cancels a fully staged resume before replacing the destination and cleans its staging', async () => fixture(async ({ dir, root, getConn }) => {
    const source = path.join(dir, 'source');
    fs.writeFileSync(source, 'new payload'); fs.writeFileSync(path.join(root, 'target'), 'original target');
    const tm = new TransferManager({ getConn }); tm.maxConcurrent = 0;
    const [task] = tm.addMany([{ kind: 'upload', serverId: 'fixture', name: 'target', srcLocal: source, dstRemote: '/target' }]);
    const staged = path.join(root, uploadPart('/target', task.id).slice(1));
    fs.copyFileSync(source, staged);
    tm.onUpdate((value) => { if (value.status === 'running' && value.transferred === 11) tm.cancel(value.id); });
    tm.setConcurrency(1);
    expect((await finished(tm, task.id)).status).toBe('canceled');
    expect(fs.readFileSync(path.join(root, 'target'), 'utf8')).toBe('original target');
    expect(fs.existsSync(staged), tm.tasks.get(task.id).error).toBe(false);
  }), 15000);

  it('rejects a download source that changes after the first stat and preserves the target', async () => fixture(async ({ dir, root, getConn }) => {
    fs.writeFileSync(path.join(root, 'source'), 'the initial source');
    const target = path.join(dir, 'target'); fs.writeFileSync(target, 'keep original');
    const conn = getConn('fixture'); const original = conn.statRemote.bind(conn);
    conn.statRemote = async (name) => { const value = await original(name); fs.writeFileSync(path.join(root, 'source'), 'new'); return value; };
    const tm = new TransferManager({ getConn });
    const [task] = tm.addMany([{ kind: 'download', serverId: 'fixture', name: 'target', srcRemote: '/source', dstLocal: target }]);
    expect((await finished(tm, task.id)).status).toBe('error');
    expect(fs.readFileSync(target, 'utf8')).toBe('keep original');
  }), 15000);

  it('rejects a directory file that grows after listing instead of uploading an empty file', async () => fixture(async ({ dir, root, getConn }) => {
    const source = path.join(dir, 'tree'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'entry'), '');
    fs.mkdirSync(path.join(root, 'target')); fs.writeFileSync(path.join(root, 'target', 'entry'), 'original');
    const tm = new TransferManager({ getConn }); const tree = tm._runTree.bind(tm);
    tm._runTree = (t, gate, jobs, expand, transfer, name) => tree(t, gate, jobs, async (j) => {
      const children = await expand(j); fs.writeFileSync(path.join(source, 'entry'), 'content written after listing'); return children;
    }, transfer, name);
    const [task] = tm.addMany([{ kind: 'upload', serverId: 'fixture', name: 'tree', srcLocal: source, dstRemote: '/target' }]);
    expect((await finished(tm, task.id)).status).toBe('error');
    expect(fs.readFileSync(path.join(root, 'target', 'entry'), 'utf8')).toBe('original');
    expect(tm.tasks.get(task.id).filesDone).toBe(0);
  }), 15000);

  it('relays to a shorter unrelated destination through verified staging', async () => fixture(async ({ root, getConn }) => {
    fs.writeFileSync(path.join(root, 'source'), 'BBBBBCCCCCTTTTT'); fs.writeFileSync(path.join(root, 'target'), 'AAAAA');
    const tm = new TransferManager({ getConn }); tm._runRelayDirect = async () => false;
    const [task] = tm.addMany([{ kind: 'relay', serverId: 'fixture', peerId: 'fixture', name: 'target', srcRemote: '/source', dstRemote: '/target' }]);
    const result = await finished(tm, task.id); expect(result.status, result.error).toBe('done');
    expect(fs.readFileSync(path.join(root, 'target'), 'utf8')).toBe('BBBBBCCCCCTTTTT');
  }), 15000);

  it('preserves the completed destination on an explicit checksum mismatch', async () => fixture(async ({ dir, root, getConn }) => {
    const source = path.join(dir, 'source'); fs.writeFileSync(source, 'new payload'); fs.writeFileSync(path.join(root, 'target'), 'original');
    const tm = new TransferManager({ getConn }); tm.setOptions({ verify: true }); tm._verifyChecksum = async () => false;
    const [task] = tm.addMany([{ kind: 'upload', serverId: 'fixture', name: 'target', srcLocal: source, dstRemote: '/target' }]);
    const result = await finished(tm, task.id);
    expect(result.status).toBe('error'); expect(result.verification).toBe('failed');
    expect(fs.readFileSync(path.join(root, 'target'), 'utf8')).toBe('original');
  }), 15000);
});
