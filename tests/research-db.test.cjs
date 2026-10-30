import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ResearchDatabase } from '../electron/research-db.cjs';
const databases = [];
function fixture() { const db = new DatabaseSync(':memory:'); databases.push(db); return new ResearchDatabase(db); }
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const create = (db) => db.create({ id: 'run-a', serverId: 'host-a', taskId: 'task-a', name: 'Training', command: 'TOKEN=private python train.py', parameters: { lr: 0.001, api_key: 'private' } });
const point = (at, sourceId, value = 0.2) => ({ name: 'loss', value, at, step: 1, source: '/work/log', sourceId });
describe('durable experiment runs', () => {
  it('retains evidence for repeated-step stalls and the matching filesystem only', () => {
    const db = fixture(), now = Date.now(), run = db.create({ serverId: 'host', name: 'Stalled', cwd: '/work/train', startedAt: now - 20 * 60000 });
    db.update({ id: run.id, status: 'running' });
    db.append({ runId: run.id, observedAt: now - 11 * 60000, points: [{ ...point(now - 11 * 60000, 'step-1', 10), name: 'step' }] });
    db.append({ runId: run.id, observedAt: now - 1000, points: [{ ...point(now - 1000, 'step-repeat', 10), name: 'step' }] });
    const input = { runId: run.id, at: now, physicalCwd: '/work/train', filesystems: [{ mount: '/', percent: 99, available: 100 }, { mount: '/work', percent: 80, available: 10000 }, { mount: '/worker', percent: 99, available: 10 }] };
    db.diagnose(input); db.diagnose(input); expect(db.get(run.id).events.map((e) => e.kind)).toEqual(['no-progress']);
    input.filesystems[1].percent = 97; db.diagnose(input); expect(db.get(run.id).events.map((e) => e.kind).sort()).toEqual(['disk-full', 'no-progress']);
    db.append({ runId: run.id, observedAt: now + 1, points: [{ ...point(now + 1, 'step-2', 11), name: 'step' }] });
    db.diagnose({ ...input, at: now + 2 }); expect(db.get(run.id).events).toHaveLength(2);
  });
  it('uses client observation time for progress even when a remote log clock is an hour behind', () => {
    const db = fixture(), now = Date.now(), run = db.create({ serverId: 'host', name: 'Clock skew', startedAt: now - 20 * 60000 });
    db.update({ id: run.id, status: 'running' });
    db.append({ runId: run.id, observedAt: now - 11 * 60000, points: [{ ...point(now - 3600000, 'step-a', 1), name: 'step' }] });
    db.append({ runId: run.id, observedAt: now, points: [{ ...point(now - 3599000, 'step-b', 2), name: 'step' }] });
    db.diagnose({ runId: run.id, at: now }); expect(db.get(run.id).events).toEqual([]);
  });
  it('uses a resolved physical directory and keeps unknown symlink targets unavailable', () => {
    const db = fixture(), run = db.create({ serverId: 'host', name: 'Resolved mount', cwd: '/mnt/full/../fast/train' });
    db.update({ id: run.id, status: 'running' });
    const input = { runId: run.id, at: Date.now(), filesystems: [{ mount: '/', percent: 20, available: 100 }, { mount: '/mnt/full', percent: 98, available: 10 }, { mount: '/mnt/fast', percent: 20, available: 100 }] };
    db.diagnose(input); db.diagnose({ ...input, physicalCwd: '/mnt/full/../fast/train' }); expect(db.get(run.id).events).toEqual([]);
  });
  it('creates one idempotent independent run and omits credential values', () => {
    const db = fixture(), run = create(db); expect(create(db).id).toBe(run.id); expect(db.list()).toHaveLength(1);
    expect(JSON.stringify(run)).not.toContain('private'); expect(run.parameters).toEqual({ lr: 0.001 });
    expect(() => db.create({ id: run.id, serverId: 'different', name: 'Other' })).toThrow('conflicts');
  });
  it('requires observed exit codes and keeps completed runs terminal', () => {
    const db = fixture(), run = create(db);
    expect(() => db.update({ id: run.id, status: 'succeeded' })).toThrow('exit code');
    expect(() => db.update({ id: run.id, status: 'failed', exitCode: 0 })).toThrow('match');
    expect(db.update({ id: run.id, status: 'failed', exitCode: 7 }).exitCode).toBe(7);
    expect(() => db.update({ id: run.id, status: 'running' })).toThrow('completed');
  });
  it('deduplicates retries by source position while retaining repeated steps', () => {
    const db = fixture(), run = create(db), now = Date.now();
    expect(db.append({ runId: run.id, points: [point(now, 'inode:10'), point(now + 1, 'inode:30', 0.1)] }).added).toBe(2);
    expect(db.append({ runId: run.id, points: [point(now, 'inode:10')] }).added).toBe(0);
    const result = db.metrics({ runId: run.id, name: 'loss' }); expect(result.points.map((p) => p.value)).toEqual([0.2, 0.1]); expect(db.get(run.id).summary[0].value).toBe(0.1);
  });
  it('rejects non-finite observations without committing a partial batch', () => {
    const db = fixture(), run = create(db); expect(() => db.append({ runId: run.id, points: [point(Date.now(), 'a'), point(Date.now(), 'b', NaN)] })).toThrow();
    expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(0);
  });
  it('retains summaries and run metadata after the 30-day metric retention limit', () => {
    const db = fixture(), run = create(db), now = Date.now();
    db.append({ runId: run.id, points: [point(now - 31 * 86400000, 'expired'), point(now, 'current', 0.1)] }); db.cleanup(now);
    expect(db.metrics({ runId: run.id, name: 'loss' }).total).toBe(1); expect(db.get(run.id).summary[0].value).toBe(0.1); expect(db.list()).toHaveLength(1);
  });
  it('deduplicates diagnostic evidence and removes points only on explicit run deletion', () => {
    const db = fixture(), run = create(db), event = { kind: 'oom', at: Date.now(), sourceId: 'inode:42', evidence: 'CUDA out of memory token=private' };
    db.append({ runId: run.id, events: [event, event], points: [point(Date.now(), 'line')] }); expect(db.get(run.id).events).toHaveLength(1);
    expect(db.get(run.id).events[0].evidence).not.toContain('private'); db.remove(run.id); expect(db.list()).toEqual([]);
  });
  it('downsamples long curves while preserving bucket extremes', () => {
    const db = fixture(), run = create(db), now = Date.now(), points = Array.from({ length: 100 }, (_, i) => point(now + i, String(i), i === 50 ? 1000 : 1));
    db.append({ runId: run.id, points }); const result = db.metrics({ runId: run.id, name: 'loss', limit: 10 }); expect(result.downsampled).toBe(true); expect(result.points.length).toBeLessThanOrEqual(10); expect(result.points.some((p) => p.max === 1000)).toBe(true);
  });
  it('retains missing observations inside downsampled buckets', () => {
    const db = fixture(), run = create(db), now = Date.now();
    db.append({ runId: run.id, points: Array.from({ length: 20 }, (_, i) => ({ ...point(now + i, String(i), i === 4 ? null : i === 5 ? 100 : 1), step: i })) });
    const result = db.metrics({ runId: run.id, name: 'loss', axis: 'step', limit: 2 });
    expect(result.points.some((p) => p.missing === 1 && p.max === 100)).toBe(true);
  });
  it('can seek a requested step using a covering index without sorting', () => {
    const db = fixture(); create(db);
    const plan = db.db.prepare('EXPLAIN QUERY PLAN SELECT seq FROM research_metrics WHERE run_id=? AND name=? AND step=? ORDER BY at DESC,seq DESC LIMIT 1').all('run-a', 'loss', 100);
    expect(plan.some((p) => String(p.detail).includes('step=?'))).toBe(true);
    expect(plan.some((p) => /SCAN|TEMP B-TREE/.test(String(p.detail)))).toBe(false);
  });
});
