import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ResearchDatabase } from '../electron/research-db.cjs';
import { WorkbenchManager } from '../electron/workbench.cjs';
import { HistoryDatabase } from '../electron/history-db.cjs';
const fixtures = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-research-flow-'));
  const sqlite = new DatabaseSync(':memory:'), db = new ResearchDatabase(sqlite);
  const state = { content: 'step=1 loss=0.5 lr=0.001\nstep=2 loss=0.3\n', exit: '7', failDb: false, failBatch: 0, batches: 0 };
  const exec = vi.fn(async (command) => {
    if (command.startsWith('exec 3<')) return { code: 0, stdout: `__SC_LOG__ 1:2 ${Buffer.byteLength(state.content)} 0 ${Buffer.byteLength(state.content)}\n${Buffer.from(state.content).toString('base64')}` };
    return { code: 0, stdout: command.startsWith('if test -f') ? state.exit : 'nohup' };
  });
  const manager = new WorkbenchManager({ directory, getServers: () => [{ id: 'host' }], getConnection: () => ({ exec, homePath: async () => '/home/fixture' }), researchRequest: async (method, payload) => {
    if (state.failDb) throw new Error('disk full');
    if (method === 'runAppend' && ++state.batches === state.failBatch) throw new Error('batch disk full');
    const mapping = { runCreate: 'create', runUpdate: 'update', runGet: 'get', runAppend: 'append', runDelete: 'remove', runDiagnose: 'diagnose' };
    return db[mapping[method]](['runGet', 'runDelete'].includes(method) ? payload.id : payload);
  } }).init();
  fixtures.push({ directory, manager, sqlite }); return { directory, manager, db, state, exec };
}
afterEach(() => { for (const f of fixtures.splice(0)) { f.manager.close(); f.sqlite.close(); fs.rmSync(f.directory, { recursive: true, force: true }); } });
describe('task to persisted training run', () => {
  it('automatically tracks only the unique owned log instead of an ambiguous reused custom path', async () => {
    const { manager } = fixture();
    const task = await manager.request({ operation: 'taskSave', serverId: 'host', name: 'Append log', cwd: '/work', command: 'train >>train.log', logPath: '/work/train.log' });
    await manager.startTask(task.id);
    expect(manager.data.logs[0].path).toContain('/.local/state/serverconsole/tasks/');
    expect(manager.data.logs[0].path).not.toBe('/work/train.log');
  });
  it('retries a partially committed large log batch without losing or duplicating metrics', async () => {
    const { manager, db, state } = fixture(), run = db.create({ serverId: 'host', name: 'Large batch' });
    state.content = Array.from({ length: 4500 }, (_, step) => `step=${step} loss=0.5`).join('\n') + '\n'; state.failBatch = 2;
    const log = await manager.request({ operation: 'logSave', serverId: 'host', runId: run.id, path: '/work/large.log', patterns: [], trackLoss: true });
    await expect(manager.pollLog(log.id)).rejects.toThrow('batch disk full'); expect(manager.data.logs[0].cursor).toBeUndefined();
    expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(4000);
    state.failBatch = 0; await manager.pollLog(log.id);
    expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(4500); expect(manager.data.logs[0].cursor.offset).toBe(Buffer.byteLength(state.content));
  });
  it('cannot resurrect a deleted Run from stale task settings', async () => {
    const { manager, db } = fixture(); const task = await manager.request({ operation: 'taskSave', serverId: 'host', name: 'Deleted', command: 'train', cwd: '/work' });
    const started = await manager.startTask(task.id); await expect(manager.deleteRun(started.remoteId)).rejects.toThrow('live run');
    await manager.taskStatus(task.id); expect((await manager.deleteRun(started.remoteId)).deleted).toBe(true);
    manager.task(task.id).runDeleted = false;
    await manager.taskStatus(task.id); expect(manager.task(task.id).runDeleted).toBe(true); expect(db.list()).toEqual([]);
  });
  it('commits fractional timestamp logs to SQLite and advances the cursor', async () => {
    const { manager, db, state } = fixture(), run = db.create({ serverId: 'host', name: 'Time precision' });
    state.content = JSON.stringify({ timestamp: Date.now() / 1000 - 0.0001, step: 1, loss: 0.3 }) + '\n';
    const log = await manager.request({ operation: 'logSave', serverId: 'host', runId: run.id, path: '/work/fractional.log', patterns: [], trackLoss: true });
    const observed = await manager.pollLog(log.id); expect(observed.cursor.offset).toBe(Buffer.byteLength(state.content)); expect(Number.isSafeInteger(db.metrics({ runId: run.id, name: 'loss' }).points[0].at)).toBe(true);
  });
  it('creates an independent run before launch and binds the owned log automatically', async () => {
    const { manager, db } = fixture();
    const saved = await manager.request({ operation: 'taskSave', serverId: 'host', name: 'Train', cwd: '/work', command: 'python train.py', parameters: { lr: 0.001 }, totalSteps: 10 });
    const task = await manager.startTask(saved.id), run = db.get(task.remoteId);
    expect(run).toMatchObject({ taskId: saved.id, parameters: { lr: 0.001 }, totalSteps: 10, status: 'starting' });
    const log = manager.data.logs[0]; expect(log.runId).toBe(run.id); expect(log.path).toContain('/home/fixture/.local/state/serverconsole/tasks/');
    await manager.pollLog(log.id); expect(db.metrics({ runId: run.id, name: 'loss' }).points.map((p) => p.value)).toEqual([0.5, 0.3]);
    const result = await manager.taskStatus(saved.id); expect(result).toMatchObject({ status: 'failed', exitCode: 7 }); expect(db.get(run.id)).toMatchObject({ status: 'failed', exitCode: 7 });
  });
  it('deduplicates training observations when the log cursor commit fails and is retried', async () => {
    const { manager, db, state } = fixture(), run = db.create({ serverId: 'host', name: 'Imported' });
    const log = await manager.request({ operation: 'logSave', serverId: 'host', runId: run.id, path: '/work/train.log', patterns: [], trackLoss: true });
    const persist = manager.persist.bind(manager); manager.persist = () => { throw new Error('commit failed'); };
    await expect(manager.pollLog(log.id)).rejects.toThrow('commit failed'); expect(manager.data.logs[0].cursor).toBeUndefined();
    expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(2);
    manager.persist = persist; state.content += 'step=3 loss=NaN\nCUDA out of memory\n';
    await manager.pollLog(log.id); expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(3); expect(db.get(run.id).events.map((e) => e.kind).sort()).toEqual(['nan', 'oom']);
  });
  it('retains an observed task outcome when run persistence fails and retries it later', async () => {
    const { manager, db, state, exec } = fixture(); const task = manager.upsert('tasks', { id: 'legacy', serverId: 'host', name: 'Legacy', command: 'train', cwd: '/work', remoteId: 'remote', status: 'running', startedAt: Date.now() });
    state.failDb = true; expect(await manager.taskStatus(task.id)).toMatchObject({ status: 'failed', exitCode: 7, runError: 'disk full' });
    state.failDb = false; const before = exec.mock.calls.length;
    expect(await manager.taskStatus(task.id)).toMatchObject({ status: 'failed', exitCode: 7 }); expect(exec.mock.calls.length).toBe(before); expect(db.get('remote').exitCode).toBe(7);
  });
  it('backs up the pre-upgrade SQLite database before creating research tables', () => {
    const { directory } = fixture(), file = path.join(directory, 'old.sqlite'), old = new DatabaseSync(file);
    old.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES(\'preserved\',\'old\');'); old.close();
    const upgraded = new HistoryDatabase(file); upgraded.close(); const backup = new DatabaseSync(file + '.pre-research-v1.sqlite');
    try { expect(backup.prepare('SELECT value FROM metadata WHERE key=\'preserved\'').get().value).toBe('old'); expect(backup.prepare('SELECT name FROM sqlite_master WHERE name=\'research_runs\'').get()).toBeUndefined(); } finally { backup.close(); }
  });
  it.each(['corrupt backup', ''])('does not migrate through an invalid existing backup (%s)', (content) => {
    const { directory } = fixture(), file = path.join(directory, 'blocked.sqlite'), old = new DatabaseSync(file);
    old.exec('CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES(\'original\');'); old.close();
    fs.writeFileSync(file + '.pre-research-v1.sqlite', content);
    expect(() => new HistoryDatabase(file)).toThrow('upgrade stopped');
    const retained = new DatabaseSync(file);
    try { expect(retained.prepare('SELECT value FROM preserved').get().value).toBe('original'); expect(retained.prepare('SELECT name FROM sqlite_master WHERE name=\'research_runs\'').get()).toBeUndefined(); } finally { retained.close(); }
  });
  it('synchronizes a completed Run even when the completion event cannot be persisted', async () => {
    const { manager, db } = fixture();
    const task = manager.upsert('tasks', { id: 'exiting', serverId: 'host', name: 'Exiting', command: 'train', cwd: '/work', remoteId: 'exit-run', status: 'running', startedAt: Date.now() });
    const persist = manager.persist.bind(manager); manager.persist = () => { throw new Error('disk full'); };
    await expect(manager.taskStatus(task.id)).rejects.toThrow('disk full'); expect(db.get('exit-run').status).toBe('failed'); expect(manager.task(task.id).completionPending).toBe(true);
    manager.persist = persist; await manager.taskStatus(task.id);
    expect(manager.data.events.filter((e) => e.type === 'task-finished')).toHaveLength(1); expect(manager.task(task.id).completionPending).toBe(false);
    await manager.taskStatus(task.id); expect(manager.data.events.filter((e) => e.type === 'task-finished')).toHaveLength(1);
  });
  it('retries a transient automatic log-binding failure and clears the Run warning', async () => {
    const { manager, db } = fixture(), original = manager.getConnection;
    let unavailable = true; manager.getConnection = () => ({ ...original(), homePath: async () => { if (unavailable) throw new Error('temporary home failure'); return '/home/fixture'; } });
    const saved = await manager.request({ operation: 'taskSave', serverId: 'host', name: 'Log retry', cwd: '/work', command: 'train' });
    const started = await manager.startTask(saved.id); expect(started.logError).toContain('temporary'); expect(db.get(started.remoteId).lastError).toContain('temporary');
    unavailable = false; const completed = await manager.taskStatus(saved.id); expect(completed.logWatcherId).toBeTruthy(); expect(completed.logError).toBeUndefined(); expect(db.get(started.remoteId).lastError).toBeNull();
  });
});
