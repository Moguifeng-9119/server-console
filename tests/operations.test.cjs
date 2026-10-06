import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Connection } from '../electron/ssh.cjs';
import lang from '../electron/lang.cjs';

afterEach(() => lang.setLanguage('en'));

describe('remote command outcomes', () => {
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
