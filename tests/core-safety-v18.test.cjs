import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager } from '../electron/workbench.cjs';
import { Connection, parseSnapshot } from '../electron/ssh.cjs';
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function manager(exec) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-safe-stop-')); dirs.push(directory);
  return new WorkbenchManager({ directory, getConnection: () => ({ exec }), getServers: () => [{ id: 'a' }] }).init();
}
const packet = (identity, size, start, data) => ({ code: 0, stdout: `__SC_LOG__ ${identity} ${size} ${start} ${Buffer.byteLength(data)}\n${Buffer.from(data).toString('base64')}` });
describe('safe task termination', () => {
  it.each(['transport failure', 'Process identity changed'])('retains unknown status after %s', async (message) => {
    const m = manager(async () => { throw new Error(message); });
    const task = m.upsert('tasks', { serverId: 'a', command: 'true', status: 'running', remoteId: 'owned' });
    await expect(m.killTask(task.id)).rejects.toThrow(message);
    expect(m.data.tasks[0].status).toBe('unknown'); expect(m.data.events).toHaveLength(0);
  });
  it('requires acknowledgement and guarded descendant signals without killing tmux by name', async () => {
    let command; const m = manager(async (cmd) => { command = cmd; return { code: 0, stdout: '__STOPPED__' }; });
    const task = m.upsert('tasks', { serverId: 'a', command: 'true', status: 'running', remoteId: 'owned', mode: 'tmux', sessionName: 'possibly-reused' });
    expect((await m.killTask(task.id)).status).toBe('stopped');
    expect(command).toContain('runner.start'); expect(command).toContain('ps -eo pid=,ppid='); expect(command).toContain('sc_start "$child"'); expect(command).not.toContain('tmux kill-session');
  });
  it('propagates process identity rejection from guarded kill and refuses invalid identities', async () => {
    let command = ''; const conn = { exec: async (cmd) => { command = cmd; return { code: 125, stderr: 'Process identity changed' }; } };
    expect((await Connection.prototype.kill.call(conn, 123, 'TERM', '777')).ok).toBe(false);
    expect(command).toContain("sed 's/^.*) //'"); expect(command).toContain("awk '{print $20}'");
    command = ''; expect((await Connection.prototype.kill.call(conn, 123, 'TERM', '$(bad)')).ok).toBe(false); expect(command).toBe('');
  });
});
describe('incremental logs', () => {
  it('disables a timed-out pattern while keeping other rules and loss tracking active', async () => {
    let reads = 0; const content = 'a'.repeat(30) + '!\nstep=2 loss=0.5 ready\n';
    const m = manager(async () => ++reads === 1 ? packet('1:2', 0, 0, '') : reads === 2 ? packet('1:2', content.length, 0, content) : packet('1:2', content.length, content.length, ''));
    const log = await m.request({ operation: 'logSave', serverId: 'a', path: '/log', patterns: ['(a+)+$', 'ready'], patternMode: 'regex', trackLoss: true });
    await m.pollLog(log.id); const result = await m.pollLog(log.id);
    expect(result.enabled).toBe(true); expect(result.lastError).toContain('Timed-out');
    expect(result.disabledPatterns).toEqual(['(a+)+$']); expect(result.cursor.offset).toBe(content.length);
    expect(result.pendingPreview).toContain('a'.repeat(30) + '!'); expect(result.lastHits).toHaveLength(1); expect(result.lossPoints).toEqual([0.5]);
    const retried = await m.pollLog(log.id);
    expect(retried.cursor.offset).toBe(content.length); expect(retried.lastLines).toHaveLength(2); expect(retried.lastHits).toHaveLength(1);
  }, 6000);
  it('reads more than 60 appended lines, preserves partial lines, and resumes after rotation', async () => {
    const baseline = 'existing\n', next = Array.from({length: 200}, (_, i) => `step=${i} loss=0.25`).join('\n') + '\npartial';
    const messages = [packet('1:2', baseline.length, 0, baseline), packet('1:2', baseline.length + Buffer.byteLength(next), baseline.length, next), packet('1:3', 10, 0, 'error new\n')];
    const m = manager(async () => messages.shift());
    const log = await m.request({ operation: 'logSave', serverId: 'a', path: '/log', patterns: ['error'], trackLoss: true });
    await m.pollLog(log.id); const updated = await m.pollLog(log.id);
    expect(updated.lossPoints).toHaveLength(120); expect(updated.progressPoints.at(-1).step).toBe(199); expect(updated.cursor.partial).toBe('partial');
    const rotated = await m.pollLog(log.id); expect(rotated.lastHits.at(-1).line).toBe('error new'); expect(rotated.cursor.identity).toBe('1:3');
  });
  it('persists the cursor and exposes failures without consuming bytes', async () => {
    let fails = false; const m = manager(async () => { if (fails) throw new Error('permission denied'); return packet('1:2', 0, 0, ''); });
    const log = await m.request({ operation: 'logSave', serverId: 'a', path: '/log', patterns: [] });
    await m.pollLog(log.id); fails = true; await expect(m.pollLog(log.id)).rejects.toThrow('permission denied');
    expect(m.data.logs[0].cursor.offset).toBe(0); expect(m.data.logs[0].lastError).toContain('permission denied');
  });
  it('retries the same bytes and emits one hit after a failed local commit', async () => {
    let reads = 0; const emitted = [], notified = [];
    const appended = 'error step=2 loss=0.4\n';
    const m = manager(async () => ++reads === 1 ? packet('1:2', 0, 0, '') : packet('1:2', appended.length, 0, appended));
    m.onEvent = (event) => emitted.push(event); m.notify = (title) => { notified.push(title); };
    const log = await m.request({ operation: 'logSave', serverId: 'a', path: '/log', patterns: ['error'], trackLoss: true });
    await m.pollLog(log.id); const diskBefore = fs.readFileSync(m.file, 'utf8');
    fs.mkdirSync(m.file + '.tmp');
    await expect(m.pollLog(log.id)).rejects.toThrow();
    expect(m.data.logs[0].cursor.offset).toBe(0); expect(m.data.logs[0].lastLines).toEqual([]);
    expect(m.data.logs[0].lastHits).toEqual([]); expect(m.data.logs[0].lossPoints).toEqual([]);
    expect(m.data.events).toHaveLength(0); expect(emitted).toHaveLength(0); expect(notified).toHaveLength(0);
    expect(fs.readFileSync(m.file, 'utf8')).toBe(diskBefore);
    fs.rmdirSync(m.file + '.tmp');
    const retried = await m.pollLog(log.id);
    expect(retried.cursor.offset).toBe(appended.length); expect(retried.lastHits).toHaveLength(1); expect(retried.lossPoints).toEqual([0.4]);
    expect(m.data.events).toHaveLength(1); expect(emitted).toHaveLength(1); expect(notified).toHaveLength(1);
    const saved = JSON.parse(fs.readFileSync(m.file, 'utf8'));
    expect(saved.logs[0].cursor.offset).toBe(appended.length); expect(saved.events).toHaveLength(1);
  });
});
describe('unknown GPU metrics', () => {
  it('marks unavailable numeric compatibility fields while retaining real zeroes', () => {
    const snap = parseSnapshot('0, u0, A100, [N/A], [N/A], 81920, 0, [N/A], 0\n__APPS__\n__SYS__\n__PS__\n');
    expect(snap.gpus[0].unavailableMetrics).toEqual(['util', 'memUsed', 'power']); expect(snap.gpus[0].temp).toBe(0); expect(snap.gpus[0].fan).toBe(0);
  });
});

describe('capability-aware GPU diagnostics', () => {
  it('retains available values while exposing unsupported fields as unknown', async () => {
    const m = manager(async () => ({code: 0, stdout: '__SC_DIAG_0__\n0, GPU-a, P2\n__SC_DIAG_1__\n__UNSUPPORTED__\n__SC_DIAG_3__\n0, GPU-a, 4\n__SC_DIAG_LAYOUT__\nGPU 0: A100 (UUID: GPU-a)\n'}));
    const report = await m.request({operation: 'gpuDiagnostics',serverId: 'a'});
    expect(report.available).toBe(true); expect(report.devices[0].metrics.pstate).toEqual({value: 'P2', supported: true});
    expect(report.devices[0].metrics['ecc.mode.current']).toEqual({value: null, supported: false}); expect(report.layout).toContain('GPU 0');
  });
});
