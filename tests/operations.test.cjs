import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Connection } from '../electron/ssh.cjs';
import lang from '../electron/lang.cjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

afterEach(() => lang.setLanguage('en'));

describe('remote command outcomes', () => {
  it('does not resurrect a closed connection after delayed jump-host resolution', async () => {
    let release; const resolved = new Promise((resolve) => { release = resolve; });
    const clients = [];
    class FakeClient extends EventEmitter { constructor() { super(); clients.push(this); } connect() { queueMicrotask(() => this.emit('ready')); } end() {} }
    const file = path.resolve('electron/ssh.cjs'), realRequire = createRequire(file), context = { module: { exports: {} }, require: (name) => name === 'ssh2' ? { Client: FakeClient } : realRequire(name), console, process, Buffer, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    context.module.exports.setJumpResolver(() => resolved);
    const conn = new context.module.exports.Connection({ username: 'fixture', password: 'x', proxyJump: 'jump' });
    const connected = conn.connect(); conn.close(); release({ username: 'jump', password: 'x' });
    await expect(connected).rejects.toMatchObject({ staleConnection: true }); expect(clients).toHaveLength(0); expect(conn.status).toBe('offline'); expect(conn.client).toBe(null);
  });
  it('rejects an old channel result after the same Connection has reconnected', async () => {
    const stream = new EventEmitter(); stream.stderr = new EventEmitter(); stream.close = () => {};
    const conn = new Connection({}); conn.connect = async () => {};
    conn.client = { exec: (_command, callback) => { callback(null, stream); queueMicrotask(() => { conn.generation += 2; stream.emit('close', 0); }); } };
    await expect(conn.exec('fixture')).rejects.toMatchObject({ staleConnection: true });
  });
  it('does not let an old SSH client close or error take down its replacement', async () => {
    const clients = [];
    class FakeClient extends EventEmitter {
      constructor() { super(); clients.push(this); }
      connect() { queueMicrotask(() => this.emit('ready')); }
      end() { this.ended = true; }
    }
    const file = path.resolve('electron/ssh.cjs'), realRequire = createRequire(file), context = { module: { exports: {} }, require: (name) => name === 'ssh2' ? { Client: FakeClient } : realRequire(name), console, process, Buffer, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    const conn = new context.module.exports.Connection({ username: 'fixture', password: 'x' });
    await conn.connect(); clients[0].emit('error', new Error('network gone'));
    await conn.connect(); const replacement = clients[1], generation = conn.generation;
    clients[0].emit('close'); clients[0].emit('error', new Error('late error'));
    expect(conn.status).toBe('online'); expect(conn.client).toBe(replacement); expect(replacement.ended).not.toBe(true); expect(conn.generation).toBe(generation);
    conn.close();
  });
  it('preserves exit status and terminating signal from the SSH channel', async () => {
    const stream = new EventEmitter(); stream.stderr = new EventEmitter(); stream.close = () => {};
    const conn = new Connection({});
    conn.connect = async () => {};
    conn.client = { exec: (_command, callback) => {
      callback(null, stream);
      queueMicrotask(() => { stream.stderr.emit('data', Buffer.from('remote diagnostic')); stream.emit('close', 5, 'TERM'); });
    } };
    const result = await conn.exec('fixture');
    expect(result).toMatchObject({ code: 5, signal: 'TERM', stderr: 'remote diagnostic' });
  });

  it.each([
    ['missing service', 5, 'Failed to restart missing.service: Unit missing.service not found.'],
    ['permission failure', 1, 'Permission denied'],
    ['unknown failure', 17, 'unexpected remote failure'],
    ['silent failure', 1, ''],
    ['missing status', undefined, ''],
  ])('does not record %s as successful', async (_label, code, stderr) => {
    const conn = { exec: async () => ({ stdout: '', stderr, code }) };
    expect((await Connection.prototype.restartService.call(conn, 'fixture.service')).ok).toBe(false);
    expect((await Connection.prototype.kill.call(conn, 123, 'TERM')).ok).toBe(false);
  });

  it('accepts a successful command even with warning output', async () => {
    const conn = { exec: async () => ({ stdout: '', stderr: 'warning only', code: 0 }) };
    expect((await Connection.prototype.restartService.call(conn, 'fixture.service')).ok).toBe(true);
    expect((await Connection.prototype.kill.call(conn, 123, 'TERM')).ok).toBe(true);
  });

  it('treats signal termination as failure even if the reported code is zero', async () => {
    const conn = { exec: async () => ({ stdout: '', stderr: '', code: 0, signal: 'TERM' }) };
    expect((await Connection.prototype.restartService.call(conn, 'fixture.service')).ok).toBe(false);
  });
});
