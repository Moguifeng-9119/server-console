// Synthetic seven-day capacity measurement using the production SQLite schema.
// No SSH connections or user data are read or modified.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { HistoryDatabase, DAY } = require('../electron/history-db.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-capacity-'));
const end = Math.floor(Date.now() / 60000) * 60000;
const intervalMs = 1000, sourceIntervalMs = 200, sampleCount = 7 * DAY / intervalMs;
const modes = process.argv.includes('--gpu-only') ? ['gpu'] : ['gpu', 'gpu-and-server'];
const measurements = [];
try {
  for (const mode of modes) {
    const file = path.join(directory, mode + '.sqlite'), db = new HistoryDatabase(file);
    global.gc?.(); const baseline = process.memoryUsage(); let peakHeap = baseline.heapUsed;
    const started = performance.now();
    try {
      for (let offset = 0; offset < sampleCount; offset += 1200) {
        const records = [], buckets = [];
        for (let i = offset; i < Math.min(offset + 1200, sampleCount); i++) {
          const at = end - 7 * DAY + i * intervalMs, util = (i * 17 % 101), memory = (i * 13 % 100);
          const metrics = { util, memory, memoryUsed: memory * 245.76, memoryTotal: 24576, temp: 45 + i % 40, power: 60 + i % 180 };
          for (const [metric, value] of Object.entries(metrics)) {
            const record = { server: 'capacity-server-00000000-0000-0000-0000-000000000000', device: 'gpu:GPU-00000000-0000-0000-0000-000000000000', label: 'GPU 0 · Capacity test 24 GiB', metric, at, value };
            if (at >= end - DAY) buckets.push({ ...record, bucket_at: at, integral: value * 1000, coverage_ms: 1000, sample_count: 5, sum: value * 5, min: value, max: value, last_value: value, last_at: at + 800, missing: 0, revision: 6 });
            else if (at % 60000 === 0) records.push(record);
          }
          if (mode === 'gpu-and-server' && (at >= end - DAY || at % 60000 === 0)) for (const [device, metric, value] of [['all', 'util', util], ['system', 'cpu', i % 80], ['system', 'memory', 30 + i % 40]]) records.push({ server: 'capacity-server-00000000-0000-0000-0000-000000000000', device, label: 'System', metric, at, value });
        }
        // Model retained storage: six days of minute summaries, then one day of
        // production second buckets (five 200 ms observations in each GPU bucket).
        db.append(records, end); db.appendBuckets(buckets, end); peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
        if (offset % 60000 === 0) console.log(mode + ' ' + Math.round(offset / sampleCount * 100) + '%');
      }
      const stats = db.cleanup(end);
      global.gc?.(); const beforeQuery = process.memoryUsage();
      const query = db.query({ serverId: 'capacity-server-00000000-0000-0000-0000-000000000000', device: 'gpu:GPU-00000000-0000-0000-0000-000000000000', metric: 'util', rangeMs: 7 * DAY, end });
      const afterQuery = process.memoryUsage();
      const files = ['', '-wal', '-shm'].map((suffix) => ({ kind: suffix || 'database', bytes: fs.existsSync(file + suffix) ? fs.statSync(file + suffix).size : 0 }));
      measurements.push({ mode, runtime: { node: process.versions.node, electron: process.versions.electron || null, sqlite: db.db.prepare('SELECT sqlite_version() AS version').get().version }, inputSamplesPerGpu: sampleCount * intervalMs / sourceIntervalMs, sourceIntervalMs, storedBucketIntervalMs: intervalMs, rawBucketRows: Number(db.db.prepare('SELECT COUNT(*) AS n FROM raw_buckets').get().n), durationDays: 7, rawHours: 24, summaryRetentionDays: 30,
        metricsPerSample: mode === 'gpu' ? 6 : 9, ...stats, files, diskBytes: files.reduce((n, f) => n + f.bytes, 0),
        weekQueryPoints: query.points.length, weekResponseBytes: Buffer.byteLength(JSON.stringify(query)),
        memory: { baselineRss: baseline.rss, rssBeforeQuery: beforeQuery.rss, rssAfterQuery: afterQuery.rss,
          retainedHeapDelta: beforeQuery.heapUsed - baseline.heapUsed, queryHeapDelta: afterQuery.heapUsed - beforeQuery.heapUsed, peakBatchHeap: peakHeap },
        seconds: Math.round((performance.now() - started) / 1000) });
      console.log(JSON.stringify(measurements[measurements.length - 1]));
    } finally { db.close(); }
  }
  const output = path.resolve(__dirname, '../test-artifacts/history-capacity.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ scope: 'Synthetic retained seven-day state using production SQLite second buckets for the latest 24 hours and minute summaries for the preceding six days. Five constant-value 200 ms observations are modeled per second; this measures storage, not live sampling performance. Process memory belongs to this standalone batch utility, not the entire desktop app.', measurements }, null, 2) + '\n');
} finally {
  if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('sc-history-capacity-')) fs.rmSync(directory, { recursive: true, force: true });
}
