import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseGpuCsv } from '../electron/monitoring/gpu-poller.cjs';
import { HistoryAggregator } from '../electron/monitoring/history-aggregator.cjs';
import { HistoryDatabase } from '../electron/history-db.cjs';

const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const gpu = (uuid, util, observedAt) => ({ uuid, index: uuid === 'a' ? 0 : 1, name: uuid,
  util, memUsed: 1, memTotal: 10, temp: 40, power: 20, observedAt });

describe('production GPU observation contracts', () => {
  it('distinguishes unsupported metrics from actual zeros', () => {
    const [unknown, zero] = parseGpuCsv('0, a, Test, N/A, [N/A], 24000, ERR!, N/A, N/A\n1, b, Test, 0, 0, 24000, 0, 0, 0');
    expect(unknown.unavailableMetrics).toEqual(['util', 'memUsed', 'temp', 'power', 'fan']);
    expect(zero.unavailableMetrics).toEqual([]);
    const aggregate = new HistoryAggregator();
    aggregate.ingestSnapshot({ id: 's', lastLane: 'gpu', collectedAt: 1000, gpus: [unknown, zero] });
    const rows = aggregate.flushAll();
    expect(rows.find((r) => r.device === 'gpu:a' && r.metric === 'memoryUsed').last_value).toBeNull();
    expect(rows.find((r) => r.device === 'gpu:b' && r.metric === 'memoryUsed').last_value).toBe(0);
  });

  it('preserves a second GPU peak arriving in the same millisecond as another GPU', () => {
    const aggregate = new HistoryAggregator();
    const emit = (at, cards) => aggregate.ingestSnapshot({ id: 's', lastLane: 'gpu', collectedAt: at, gpus: cards });
    emit(1000, [gpu('a', 10, 1000), gpu('b', 10, 1000)]);
    emit(1001, [gpu('a', 20, 1001), gpu('b', 10, 1000)]);
    emit(1001, [gpu('a', 20, 1001), gpu('b', 95, 1001)]);
    const rows = aggregate.flushAll();
    const b = rows.find((r) => r.device === 'gpu:b' && r.metric === 'util');
    expect(b.last_value).toBe(95); expect(b.max).toBe(95); expect(b.sample_count).toBe(2);
    expect(rows.find((r) => r.device === 'all' && r.metric === 'util').last_value).toBe(57.5);
  });

  it('does not fabricate observations or coverage for an unchanged cached GPU', () => {
    const aggregate = new HistoryAggregator();
    for (const at of [1000, 1200, 1400, 1600]) aggregate.ingestSnapshot({ id: 's', lastLane: 'gpu', collectedAt: at,
      gpus: [gpu('a', 50, at), gpu('b', 25, 1000)] });
    const b = aggregate.flushAll().find((r) => r.device === 'gpu:b' && r.metric === 'util');
    expect(b.sample_count).toBe(1); expect(b.coverage_ms).toBe(0); expect(b.last_at).toBe(1000);
  });

  it('migrates legacy zero-coverage buckets without replacing real readings with zero', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-observation-test-'));
    cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'history.sqlite'), at = Math.floor(Date.now() / 1000) * 1000 - 10000;
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE raw_buckets(channel INTEGER NOT NULL,bucket_at INTEGER NOT NULL,
      integral REAL NOT NULL DEFAULT 0,coverage_ms INTEGER NOT NULL DEFAULT 0,sample_count INTEGER NOT NULL DEFAULT 0,
      min REAL,max REAL,last_value REAL,last_at INTEGER,missing INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(channel,bucket_at)) WITHOUT ROWID;`);
    legacy.prepare('INSERT INTO raw_buckets VALUES(?,?,?,?,?,?,?,?,?,?)').run(1, at, 0, 0, 1, 42, 42, 42, at, 0);
    legacy.close();
    const database = new HistoryDatabase(file); cleanups.push(() => database.close());
    database.db.prepare('INSERT INTO channels(id,server,device,metric,label) VALUES(1,?,?,?,?)').run('s', 'gpu:a', 'util', 'GPU');
    const result = database.query({ serverId: 's', device: 'gpu:a', metric: 'util', rangeMs: 1800000, end: at + 2000 });
    expect(result.points.filter((p) => p.value !== null).map((p) => p.value)).toEqual([42]);
    expect(result.points.find((p) => p.value === 42).gap).toBe(true);
  });
});
