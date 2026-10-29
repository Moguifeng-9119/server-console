import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HistoryDatabase, DAY, RETENTION } from '../electron/history-db.cjs';
import { HistoryStore } from '../electron/history-store.cjs';

const directories = [], databases = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-test-'));
  directories.push(directory);
  const db = new HistoryDatabase(path.join(directory, 'monitoring.sqlite')); databases.push(db);
  return { directory, db };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const d of directories.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const record = (at, value) => ({ server: 'host', device: 'gpu:uuid', metric: 'util', label: 'GPU 0', at, value });
describe('persistent monitoring history', () => {
  it('keeps steady readings once, and splits weighted intervals at minute boundaries', () => {
    const { db } = fixture(), at = Math.floor(Date.now() / 60000) * 60000;
    db.append([record(at - 10000, 0), record(at + 10000, 100)], at + 10000);
    db.append([record(at + 10000, 100)], at + 10000);
    expect(db.stats().rawRows).toBe(2);
    const rows = db.db.prepare('SELECT * FROM minutes ORDER BY at').all();
    expect(rows).toHaveLength(2); expect(rows[0].coverage).toBe(10000); expect(rows[1].coverage).toBe(10000);
    expect(rows[0].weighted / rows[0].coverage).toBe(25); expect(rows[1].weighted / rows[1].coverage).toBe(75);
  });
  it('leaves missing time empty and returns fixed windows bounded below 1000 points', () => {
    const { db } = fixture(), end = Date.now();
    db.append([record(end - 300000, 25), record(end - 298000, 25), record(end - 296000, null), record(end - 10000, 80)], end);
    for (const rangeMs of [1800000, 3600000, 43200000, DAY, 7 * DAY]) {
      const result = db.query({ serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs, end });
      expect(result.end - result.start).toBe(rangeMs); expect(result.points.length).toBeLessThanOrEqual(1000);
      expect(result.points.some((p) => p.value === null && p.gap)).toBe(true);
      expect(result.points.reduce((n, p) => n + p.coveredMs, 0)).toBeLessThanOrEqual(2000);
      expect(result.points.flatMap((p) => p.value == null ? [] : [p.value])).not.toContain(0);
    }
    expect(() => db.query({ serverId: 'host', rangeMs: 10000000000 })).toThrow();
  });
  it('expires raw data after 24 hours and summaries after 30 days and reclaims file pages', () => {
    const { db } = fixture(), end = Date.now();
    const records = Array.from({ length: 2000 }, (_, i) => record(end - 2 * DAY + i * 2000, i % 100));
    db.append(records, end - 2 * DAY + 4000000); // Synthetic last acquisition date.
    expect(db.stats().rawRows).toBe(2000);
    const before = db.stats().pages;
    db.cleanup(end); expect(db.stats().rawRows).toBe(0); expect(db.stats().minuteRows).toBeGreaterThan(0);
    db.cleanup(end + RETENTION); expect(db.stats().minuteRows).toBe(0);
    expect(db.stats().pages).toBeLessThan(before);
    // Expired old input cannot repopulate the archive.
    db.append([record(end - RETENTION - 1, 90)], end); expect(db.stats().rawRows).toBe(0);
  });
  it('imports timestamped legacy histories once, preserving null gaps across reopen', () => {
    const { db, directory } = fixture(), at = Date.now();
    const map = { saved: [{ at: at - 10000, value: 42 }, { at: at - 5000, value: 42 }, { at, value: null }] };
    const file = path.join(directory, 'history.json'); fs.writeFileSync(file, JSON.stringify(map));
    db.migrate(file); db.migrate(file); expect(db.legacyLoad()).toEqual(map);
    expect(db.stats().rawRows).toBe(3);
    db.close(); databases.splice(databases.indexOf(db), 1);
    const next = new HistoryDatabase(path.join(directory, 'monitoring.sqlite')); databases.push(next);
    expect(next.legacyLoad()).toEqual(map);
  });
  it('isolates GPU UUIDs and records per-card/system metrics', () => {
    const { db } = fixture();
    db.snapshot({ id: 'host', collectedAt: Date.now(), cpuUsage: 25, memUsed: 2, memTotal: 8,
      gpus: [{ index: 0, uuid: 'a', name: 'Test', util: 40, memUsed: 1024, memTotal: 4096, temp: 60, power: 100 }] });
    const result = db.query({ serverId: 'host', device: 'gpu:a', metric: 'memory', rangeMs: 1800000 });
    expect(result.devices.some((d) => d.device === 'gpu:a')).toBe(true);
    expect(result.points.some((p) => p.value === 25)).toBe(true);
    expect(db.stats().rawRows).toBe(9);
  });
  it('worker drains accepted writes before shutdown and restores them after restart', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-test-')); directories.push(directory);
    const service = new HistoryStore(directory);
    const at = Date.now(), map = { fixture: [{ at: at - 2000, value: 50 }, { at, value: null }] };
    try { await service.request('save', map); expect(await service.request('load')).toEqual(map); }
    finally { await service.close(); }
    const next = new HistoryStore(directory);
    try { expect(await next.request('load')).toEqual(map); }
    finally { await next.close(); }
  });
  it('clips partial minutes using known raw successors without future coverage', () => {
    const { db } = fixture(), end = Math.floor(Date.now() / 60000) * 60000;
    const start = end - DAY + 15000;
    vi.spyOn(Date, 'now').mockReturnValue(end + 15000);
    db.append([record(start, 50), record(start + 45000, 50)], end + 15000);
    const result = db.query({ serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs: DAY, end: end + 15000 });
    expect(result.points.reduce((n, p) => n + p.coveredMs, 0)).toBe(45000);
    const t = end - 300000;
    db.append([record(t, 0), record(t + 30000, 0), record(t + 60000, 100)], end + 15000);
    const past = db.query({serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs: DAY, end: t + 30000});
    const tail = past.points.at(-1); expect(tail.value).toBe(0); expect(tail.coveredMs).toBe(30000);
  });
  it('uses minute resolution for old short windows and never exceeds bucket time', () => {
    const { db } = fixture(), now = Math.floor(Date.now() / 60000) * 60000, at = now - 2 * DAY;
    db.append(Array.from({length: 31}, (_, i) => record(at + i * 2000, 50)), at + 60000);
    const result = db.query({ serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs: 1800000, end: at + 60000 });
    expect(result.stepMs).toBe(60000); expect(result.points.every((p) => p.coveredMs <= result.stepMs)).toBe(true);
    expect(result.points.at(-1).value).toBe(50);
  });
  it('retains known raw head coverage when IPC processing is later than the requested end', () => {
    const { db } = fixture(), end = Math.floor(Date.now() / 60000) * 60000 + 15000, start = end - DAY;
    vi.spyOn(Date, 'now').mockReturnValue(end + 1);
    db.append([record(start + 5000, 50), record(start + 45000, 50)], end + 1);
    const result = db.query({ serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs: DAY, end });
    expect(result.points.reduce((n, p) => n + p.coveredMs, 0)).toBe(40000);
  });
  it('preserves failure event time when the worker receives recovery samples later', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-test-')); directories.push(directory);
    const service = new HistoryStore(directory), now = Date.now();
    const snapshot = (at, util) => ({ id: 'host', collectedAt: at, cpuUsage: 20, memUsed: 2, memTotal: 8,
      gpus: [{ index: 0, uuid: 'stable', name: 'Test', util, memUsed: 1, memTotal: 8, temp: 60, power: 100 }] });
    try {
      await service.request('snapshot', snapshot(now - 10000, 20));
      await service.request('gap', { server: 'host', at: now - 5000 });
      await service.request('snapshot', snapshot(now - 1000, 90));
      const saved = await service.request('load');
      expect(saved.host.map((p) => p.value)).toEqual([20, null, 90]);
    } finally { await service.close(); }
  });
  it('marks a disappearing GPU as missing and does not bridge its return', () => {
    const { db } = fixture(), at = Date.now();
    const snapshot = (collectedAt, gpus) => ({ id: 'host', collectedAt, cpuUsage: 25, memUsed: 2, memTotal: 8, gpus });
    const gpu = { index: 0, uuid: 'stable', name: 'Test', util: 100, memUsed: 1, memTotal: 8, temp: 60, power: 100 };
    db.snapshot(snapshot(at - 10000, [gpu])); db.snapshot(snapshot(at - 5000, [])); db.snapshot(snapshot(at, [gpu]));
    const result = db.query({ serverId: 'host', device: 'gpu:stable', metric: 'util', rangeMs: 1800000, end: at });
    expect(result.points.reduce((n, p) => n + p.coveredMs, 0)).toBe(0);
  });
  it('keeps minute extrema around the interpolated average', () => {
    const { db } = fixture(), at = Math.floor(Date.now() / 900000) * 900000;
    db.append([record(at - 10000, 0), record(at + 10000, 100)], at + 10000);
    // end 受 query 的 now+1min 校验约束，15 分钟对齐点附近运行时需夹紧（此前为时间相关 flaky）
    const result = db.query({ serverId: 'host', device: 'gpu:uuid', metric: 'util', rangeMs: 7 * DAY, end: Math.min(at + 120000, Date.now() + 30000) });
    for (const p of result.points.filter((p) => p.value != null)) { expect(p.value).toBeGreaterThanOrEqual(p.min); expect(p.value).toBeLessThanOrEqual(p.max); }
  });
  it('reports a corrupt legacy file but continues recording new data', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-test-')); directories.push(directory);
    fs.writeFileSync(path.join(directory, 'history.json'), '{');
    const errors = [], service = new HistoryStore(directory, (error) => errors.push(String(error)));
    try { const map = { fresh: [{ at: Date.now(), value: 10 }] }; await service.request('save', map); expect(await service.request('load')).toEqual(map); expect(errors.length).toBe(1); }
    finally { await service.close(); }
    expect(fs.readFileSync(path.join(directory, 'history.json'), 'utf8')).toBe('{');
  });
});

describe('usage_minutes accounting', () => {
  const gpu = (over = {}) => ({ uuid: 'u1', index: 0, name: 'A100', util: 10, memUsed: 1 * 1024 ** 3, memTotal: 80 * 1024 ** 3, procs: [], ...over });
  it('credits each distinct GPU user and splits shared cards evenly', () => {
    const { db } = fixture(), at = Math.floor(Date.now() / 60000) * 60000;
    const server = { id: 'host', collectedAt: at, gpus: [gpu({ procs: [{ user: 'alice' }, { user: 'bob' }] }), gpu({ uuid: 'u2', index: 1, name: 'A100', procs: [{ user: 'carol' }] })] };
    db.snapshot(server); // 基线：不计时
    expect(db.usageByUserDays('host', 30)).toEqual([]);
    server.collectedAt = at + 60000;
    db.snapshot(server); // 1 分钟，alice/bob 均摊 GPU0，carol 独占 GPU1
    const rows = Object.fromEntries(db.usageByUserDays('host', 30).map((r) => [r.user, r.totalMinutes]));
    expect(rows.alice).toBeCloseTo(0.5, 5);
    expect(rows.bob).toBeCloseTo(0.5, 5);
    expect(rows.carol).toBeCloseTo(1, 5);
    // 断链超过 10 分钟 → 丢弃，防伪造时长
    server.collectedAt = at + 31 * 60000;
    db.snapshot(server);
    const after = Object.fromEntries(db.usageByUserDays('host', 30).map((r) => [r.user, r.totalMinutes]));
    expect(after.alice).toBeCloseTo(0.5, 5);
  });
});

describe('history observation integrity', () => {
  it('does not credit a gap or a changed occupancy, and expires usage after30 days', () => {
    const { db } = fixture(), at = Date.now() - 20000;
    const snap = (time, user = 'alice') => ({ id: 'host', collectedAt: time, gpus: [{ uuid: 'u', procs: [{ user }] }] });
    db.ingestUsage(snap(at), at); db.ingestUsage(snap(at + 2000), at + 2000); db.gap('host', at + 3000); db.ingestUsage(snap(at + 5000), at + 5000);
    db.ingestUsage(snap(at + 7000, 'bob'), at + 7000);
    expect(db.usageByUserDays('host', 30)[0].totalMinutes).toBeCloseTo(2 / 60);
    db.db.prepare('INSERT INTO usage_minutes VALUES(?,?,?,?)').run('2000-01-01', 'host', 'old', 999); db.cleanup();
    expect(db.db.prepare("SELECT COUNT(*) n FROM usage_minutes WHERE user='old'").get().n).toBe(0);
  });
  it('stores revised second buckets idempotently without losing subsecond peaks or coverage', () => {
    const { db } = fixture(), at = Math.floor((Date.now()-10000)/1000)*1000;
    const bucket = { server: 'host', device: 'gpu:u', metric: 'util', label: 'GPU0', bucket_at: at, integral: 50000, coverage_ms: 1000, sample_count: 10, sum: 500, min: 10, max: 95, last_value: 12, last_at: at+999, missing: 0, revision: 10 };
    db.appendBuckets([bucket, bucket]); db.appendBuckets([{...bucket, integral: 60000, sum: 600, max: 99, revision: 11}]); db.appendBuckets([bucket]);
    const row = db.db.prepare('SELECT * FROM minutes').get(); expect(row.coverage).toBe(1000); expect(row.weighted).toBe(60000); expect(row.sum).toBe(600);
    const result = db.query({serverId: 'host', device: 'gpu:u', metric: 'util', rangeMs: 1800000, end: at+1000});
    const point = result.points.find((p) => p.max === 99); expect(point.coveredMs).toBe(1000); expect(point.value).toBe(60);
  });
});
