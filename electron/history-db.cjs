// SQLite runs exclusively in the history worker, never on the UI/SSH event loop.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const DAY = 86400000, MINUTE = 60000;
const RAW_RETENTION = DAY, RETENTION = 30 * DAY;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;

class HistoryDatabase {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL; PRAGMA cache_size=-4096; PRAGMA wal_autocheckpoint=256;
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY, server TEXT NOT NULL, device TEXT NOT NULL, metric TEXT NOT NULL,
        label TEXT NOT NULL, last_at INTEGER, last_value REAL, UNIQUE(server,device,metric));
      CREATE TABLE IF NOT EXISTS raw (
        channel INTEGER NOT NULL, at INTEGER NOT NULL, value REAL,
        PRIMARY KEY(channel,at)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS raw_expiry ON raw(at);
      CREATE TABLE IF NOT EXISTS minutes (
        channel INTEGER NOT NULL, at INTEGER NOT NULL, sum REAL NOT NULL DEFAULT 0,
        count INTEGER NOT NULL DEFAULT 0, low REAL, high REAL,
        weighted REAL NOT NULL DEFAULT 0, coverage INTEGER NOT NULL DEFAULT 0,
        missing INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(channel,at)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS minutes_expiry ON minutes(at);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.channel = this.db.prepare('SELECT * FROM channels WHERE server=? AND device=? AND metric=?');
    this.create = this.db.prepare('INSERT OR IGNORE INTO channels(server,device,metric,label) VALUES(?,?,?,?)');
    this.insert = this.db.prepare('INSERT OR IGNORE INTO raw VALUES(?,?,?)');
    this.minute = this.db.prepare(`INSERT INTO minutes(channel,at,sum,count,low,high,weighted,coverage,missing)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(channel,at) DO UPDATE SET
      sum=sum+excluded.sum, count=count+excluded.count,
      low=CASE WHEN excluded.low IS NULL THEN low WHEN low IS NULL THEN excluded.low ELSE MIN(low,excluded.low) END,
      high=CASE WHEN excluded.high IS NULL THEN high WHEN high IS NULL THEN excluded.high ELSE MAX(high,excluded.high) END,
      weighted=weighted+excluded.weighted, coverage=coverage+excluded.coverage, missing=missing+excluded.missing`);
    this.last = this.db.prepare('UPDATE channels SET last_at=?,last_value=?,label=? WHERE id=?');
  }

  /** @param {Array<{server:string,device:string,metric:string,label:string,at:number,value:number|null}>} records */
  append(records, now = Date.now()) {
    this.db.exec('BEGIN');
    try {
      for (const r of records) {
        if (!Number.isSafeInteger(r.at) || r.at <= 0 || r.at > now + MINUTE || r.at < now - RETENTION) continue;
        this.create.run(r.server, r.device, r.metric, r.label);
        const c = this.channel.get(r.server, r.device, r.metric);
        const at = r.at, value = finite(r.value);
        // Ordered ingestion and the persisted watermark make retries idempotent,
        // including after raw records have expired.
        if (c.last_at != null && at <= Number(c.last_at)) continue;
        if (at >= now - RAW_RETENTION) this.insert.run(Number(c.id), at, value);
        this.minute.run(Number(c.id), Math.floor(at / MINUTE) * MINUTE,
          value ?? 0, value == null ? 0 : 1, value, value, 0, 0, value == null ? 1 : 0);
        const before = finite(c.last_value), previousAt = Number(c.last_at);
        if (before != null && value != null && at > previousAt && at - previousAt <= MINUTE) {
          // Clip every trapezoid at minute boundaries. Long disconnects never
          // contribute fabricated time coverage or a zero-valued interval.
          const duration = at - previousAt;
          for (let start = Math.max(previousAt, now - RETENTION); start < at;) {
            const bucket = Math.floor(start / MINUTE) * MINUTE;
            const end = Math.min(at, bucket + MINUTE);
            const a = before + (value - before) * (start - previousAt) / duration;
            const b = before + (value - before) * (end - previousAt) / duration;
            this.minute.run(Number(c.id), bucket, 0, 0, Math.min(a, b), Math.max(a, b), (a + b) / 2 * (end - start), end - start, 0);
            start = end;
          }
        }
        this.last.run(at, value, r.label, Number(c.id));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  snapshot(s) {
    const at = s.collectedAt || Date.now();
    const records = [];
    const add = (device, metric, label, value) => records.push({ server: s.id, device, metric, label, at, value: finite(value) });
    add('all', 'util', 'All GPUs', s.gpus.length ? s.gpus.reduce((n, g) => n + g.util, 0) / s.gpus.length : null);
    add('system', 'cpu', 'System', s.cpuUsage);
    add('system', 'memory', 'System', s.memTotal ? s.memUsed / s.memTotal * 100 : null);
    for (const g of s.gpus) {
      const device = 'gpu:' + (g.uuid || g.index), label = `GPU ${g.index} · ${g.name}`;
      add(device, 'util', label, g.util);
      add(device, 'memory', label, g.memTotal ? g.memUsed / g.memTotal * 100 : null);
      add(device, 'memoryUsed', label, g.memUsed);
      add(device, 'memoryTotal', label, g.memTotal);
      add(device, 'temp', label, g.temp);
      add(device, 'power', label, g.power);
    }
    const live = new Set(s.gpus.map((g) => 'gpu:' + (g.uuid || g.index)));
    for (const c of this.db.prepare("SELECT device,metric,label FROM channels WHERE server=? AND device LIKE 'gpu:%'").all(s.id)) {
      if (!live.has(String(c.device))) add(String(c.device), String(c.metric), String(c.label), null);
    }
    this.append(records);
  }

  gap(server, at = Date.now()) {
    const channels = this.db.prepare('SELECT device,metric,label FROM channels WHERE server=?').all(server);
    this.append(channels.map((c) => ({ server, device: String(c.device), metric: String(c.metric), label: String(c.label), at, value: null })));
  }

  cleanup(now = Date.now()) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM raw WHERE at < ?').run(now - RAW_RETENTION);
      // Expire entire minute buckets; no sample beyond the absolute maximum
      // is retained in the oldest partial bucket.
      this.db.prepare('DELETE FROM minutes WHERE at < ?').run(now - RETENTION);
      this.db.prepare('DELETE FROM channels WHERE last_at < ? AND id NOT IN (SELECT channel FROM minutes) AND id NOT IN (SELECT channel FROM raw)').run(now - RETENTION);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.exec('PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE);');
    return this.stats();
  }

  query({ serverId, device = 'all', metric = 'util', rangeMs, end = Date.now() }) {
    const now = Date.now(), rawCutoff = now - RAW_RETENTION;
    const allowed = [1800000, 3600000, 43200000, DAY, 7 * DAY];
    if (!allowed.includes(rangeMs) || !Number.isSafeInteger(end) || end > now + MINUTE) throw new Error('Invalid history range');
    const start = end - rangeMs;
    const rawWindow = rangeMs < DAY && start >= rawCutoff;
    const requestedStep = rangeMs <= 1800000 ? 5000 : rangeMs <= 3600000 ? 10000 : rangeMs <= 43200000 ? MINUTE : rangeMs <= DAY ? 120000 : 900000;
    const step = rawWindow ? requestedStep : Math.max(MINUTE, requestedStep);
    const c = this.channel.get(serverId, device, metric);
    const devices = this.db.prepare('SELECT device,label,metric FROM channels WHERE server=? ORDER BY device,metric').all(serverId);
    const first = Math.floor(start / step) * step;
    const bucketCount = Math.ceil((end - first) / step);
    const buckets = new Map();
    const get = (at) => {
      const index = Math.min(bucketCount - 1, Math.floor((at - first) / step));
      if (!buckets.has(index)) buckets.set(index, { at: first + index * step, sum: 0, count: 0, low: null, high: null, weighted: 0, coverage: 0, missing: false });
      return buckets.get(index);
    };
    const extrema = (b, low, high) => {
      if (low != null) b.low = b.low == null ? low : Math.min(b.low, low);
      if (high != null) b.high = b.high == null ? high : Math.max(b.high, high);
    };
    if (c) {
      const collectRaw = (fromAt, toAt, includeEnd = true) => {
        // Read the first successor too, so a trapezoid crossing the requested
        // boundary can be clipped rather than silently dropping its head.
        const rows = this.db.prepare('SELECT at,value FROM raw WHERE channel=? AND at>=? AND at<=? ORDER BY at').all(Number(c.id), fromAt - MINUTE, toAt + MINUTE);
        let previous = null;
        for (const row of rows) {
          const at = Number(row.at), value = finite(row.value);
          if (at >= fromAt && (at < toAt || includeEnd && at === toAt)) {
            const b = get(at); b.sum += value ?? 0; b.count += value == null ? 0 : 1;
            b.missing ||= value == null; extrema(b, value, value);
          }
          if (previous && previous.value != null && value != null && at - previous.at <= MINUTE) {
            const duration = at - previous.at;
            for (let from = Math.max(fromAt, previous.at); from < Math.min(at, toAt);) {
              const b = get(from), to = Math.min(at, toAt, b.at + step);
              const a = previous.value + (value - previous.value) * (from - previous.at) / duration;
              const z = previous.value + (value - previous.value) * (to - previous.at) / duration;
              b.weighted += (a + z) / 2 * (to - from); b.coverage += to - from;
              extrema(b, a, z); from = to;
            }
          }
          previous = { at, value };
          if (at > toAt) break;
        }
      };
      if (rawWindow) {
        collectRaw(start, end);
      } else {
        // Whole minute summaries only: partial historical minutes cannot be
        // reconstructed from a summary and are honestly left uncovered.
        const firstMinute = Math.ceil(start / MINUTE) * MINUTE, lastMinute = Math.floor(end / MINUTE) * MINUTE;
        const rows = this.db.prepare('SELECT * FROM minutes WHERE channel=? AND at>=? AND at<? ORDER BY at').all(Number(c.id), firstMinute, lastMinute);
        for (const row of rows) {
          const b = get(Number(row.at)); b.sum += Number(row.sum); b.count += Number(row.count);
          b.weighted += Number(row.weighted); b.coverage += Number(row.coverage);
          b.missing ||= Number(row.missing) > 0; extrema(b, finite(row.low), finite(row.high));
        }
        const headStart = Math.max(start, rawCutoff);
        if (headStart < Math.min(end, firstMinute)) collectRaw(headStart, Math.min(end, firstMinute), false);
        if (lastMinute >= rawCutoff) collectRaw(Math.max(start, lastMinute), end);
      }
    }
    const points = Array.from({ length: bucketCount }, (_, i) => {
      const b = buckets.get(i);
      const at = Math.max(start, first + i * step), duration = Math.min(end, first + (i + 1) * step) - at;
      return { at, value: b ? b.coverage ? b.weighted / b.coverage : b.count ? b.sum / b.count : null : null,
        min: b?.low ?? null, max: b?.high ?? null, coveredMs: b?.coverage ?? 0, gap: !b || b.missing || b.coverage < duration * 0.8 };
    });
    return { start, end, stepMs: step, retentionDays: 30, rawHours: 24, points, devices };
  }

  legacyLoad() {
    const result = {};
    for (const c of this.db.prepare("SELECT id,server FROM channels WHERE device='all' AND metric='util'").all()) {
      result[String(c.server)] = this.db.prepare('SELECT at,value FROM raw WHERE channel=? ORDER BY at DESC LIMIT 720').all(Number(c.id)).reverse().map((r) => ({ at: Number(r.at), value: finite(r.value) }));
    }
    return result;
  }

  legacySave(map) {
    const records = [];
    for (const [server, points] of Object.entries(map)) {
      if (!Array.isArray(points)) continue;
      for (const p of points.filter((p) => p && typeof p === 'object').sort((a, b) => a.at - b.at)) {
        if (p && typeof p === 'object') records.push({ server, device: 'all', metric: 'util', label: 'All GPUs', at: p.at, value: finite(p.value) });
      }
    }
    this.append(records);
    return true;
  }

  migrate(file) {
    if (this.db.prepare("SELECT value FROM metadata WHERE key='legacy-import'").get()) return;
    if (fs.existsSync(file)) this.legacySave(JSON.parse(fs.readFileSync(file, 'utf8')));
    this.db.prepare("INSERT INTO metadata VALUES('legacy-import','done')").run();
  }

  stats() {
    const scalar = (sql) => Number(Object.values(this.db.prepare(sql).get())[0]);
    return { rawRows: scalar('SELECT COUNT(*) FROM raw'), minuteRows: scalar('SELECT COUNT(*) FROM minutes'),
      pageSize: scalar('PRAGMA page_size'), pages: scalar('PRAGMA page_count'), freePages: scalar('PRAGMA freelist_count') };
  }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}

module.exports = { HistoryDatabase, DAY, RAW_RETENTION, RETENTION };
