// SQLite runs exclusively in the history worker, never on the UI/SSH event loop.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { ResearchDatabase } = require('./research-db.cjs');
const { backupBeforeResearchMigration } = require('./sqlite-migration.cjs');
const DAY = 86400000, MINUTE = 60000;
const RAW_RETENTION = DAY, RETENTION = 30 * DAY;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;

class HistoryDatabase {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file);
    this.db = new DatabaseSync(file);
    if (existing && !this.db.prepare("SELECT name FROM sqlite_master WHERE name='research_runs'").get()) {
      try { backupBeforeResearchMigration(this.db, file); }
      catch (error) { this.db.close(); throw new Error('Database upgrade stopped: the pre-upgrade backup could not be validated. Original database retained. ' + error.message); }
    }
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
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_minutes (
        day TEXT NOT NULL, server TEXT NOT NULL, user TEXT NOT NULL,
        gpu_minutes REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(day,server,user)) WITHOUT ROWID;`);
    this.research = new ResearchDatabase(this.db);
    this.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('research-schema','1')").run();
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
    this.usageMinute = this.db.prepare(`INSERT INTO usage_minutes(day,server,user,gpu_minutes) VALUES(?,?,?,?)
      ON CONFLICT(day,server,user) DO UPDATE SET gpu_minutes=gpu_minutes+excluded.gpu_minutes`);
    // usage 按用户聚合查询：rangeDays 内各用户总 GPU·分钟与分服务器明细
    this.usageByUser = this.db.prepare(`SELECT user, SUM(gpu_minutes) AS total,
      SUM(CASE WHEN server=? THEN gpu_minutes ELSE 0 END) AS thisServer
      FROM usage_minutes WHERE day >= date('now', ?) GROUP BY user ORDER BY total DESC`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS raw_buckets (
      channel INTEGER NOT NULL, bucket_at INTEGER NOT NULL, integral REAL NOT NULL DEFAULT 0,
      coverage_ms INTEGER NOT NULL DEFAULT 0, sample_count INTEGER NOT NULL DEFAULT 0,
      min REAL, max REAL, last_value REAL, last_at INTEGER, missing INTEGER NOT NULL DEFAULT 0,
      sum REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(channel,bucket_at)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS raw_buckets_expiry ON raw_buckets(bucket_at);`);
    const columns = this.db.prepare('PRAGMA table_info(raw_buckets)').all().map((row) => String(row.name));
    if (!columns.includes('sum')) { this.db.exec('ALTER TABLE raw_buckets ADD COLUMN sum REAL NOT NULL DEFAULT 0'); this.db.exec('UPDATE raw_buckets SET sum=COALESCE(last_value,0)*sample_count, missing=MAX(missing,1)'); }
    if (!columns.includes('revision')) this.db.exec('ALTER TABLE raw_buckets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    this.migrateRawBuckets();
    this.usageLastAt = new Map();
    this.usageOccupancy = new Map();
  }

  // 旧版 raw_buckets 表迁移：把 last_value/last_at 作为稀疏样本导入 raw。
  // coverage_ms=0 的桶不制造时间覆盖（不把 0 integral 当作 0 值区间），
  // 保留真实读数本身；查询端 coverage<80% 自然标记为 gap。
  migrateRawBuckets() {
    const has = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_buckets'").get();
    if (!has) return;
    if (this.db.prepare("SELECT value FROM metadata WHERE key='raw-buckets-import'").get()) return;
    this.db.exec('BEGIN');
    try {
      const rows = this.db
        .prepare('SELECT channel, bucket_at, last_value, last_at, missing, coverage_ms FROM raw_buckets')
        .all();
      const insert = this.db.prepare('INSERT OR REPLACE INTO raw(channel,at,value) VALUES(?,?,?)');
      for (const r of rows) {
        if (Number(r.missing)) continue;
        const value = finite(r.last_value);
        if (value == null) continue; // 无真实读数的零覆盖桶不导入（不伪造 0）
        const at = Number(r.last_at ?? r.bucket_at);
        if (!Number.isSafeInteger(at) || at <= 0) continue;
        insert.run(Number(r.channel), at, value);
      }
      this.db.prepare("INSERT INTO metadata VALUES('raw-buckets-import','done')").run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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

  appendBuckets(buckets, now = Date.now()) {
    const prior = this.db.prepare('SELECT * FROM raw_buckets WHERE channel=? AND bucket_at=?');
    const upsert = this.db.prepare(`INSERT INTO raw_buckets(channel,bucket_at,integral,coverage_ms,sample_count,min,max,last_value,last_at,missing,sum,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel,bucket_at) DO UPDATE SET integral=excluded.integral, coverage_ms=excluded.coverage_ms,
      sample_count=excluded.sample_count,min=excluded.min,max=excluded.max,last_value=excluded.last_value,last_at=excluded.last_at,missing=excluded.missing,sum=excluded.sum,revision=excluded.revision`);
    this.db.exec('BEGIN');
    try {
      for (const b of buckets) {
        const at = b.bucket_at;
        if (!Number.isSafeInteger(at) || at % 1000 || at < now - RAW_RETENTION || at > now + MINUTE) continue;
        if (![b.integral, b.coverage_ms, b.sample_count, b.sum, b.revision, b.missing].every((value) => typeof value === 'number' && Number.isFinite(value))) throw new Error('Invalid history bucket');
        if (b.coverage_ms < 0 || b.coverage_ms > 1000 || b.sample_count < 0 || b.missing < 0 || b.revision < 1) throw new Error('Invalid history bucket coverage');
        this.create.run(b.server, b.device, b.metric, b.label);
        const channel = this.channel.get(b.server, b.device, b.metric), channelId = Number(channel.id);
        const old = prior.get(channelId, at);
        if (old && Number(old.revision) >= b.revision) continue;
        upsert.run(channelId, at, b.integral, b.coverage_ms, b.sample_count, finite(b.min), finite(b.max), finite(b.last_value), b.last_at, b.missing, b.sum, b.revision);
        this.minute.run(channelId, Math.floor(at / MINUTE) * MINUTE,
          b.sum - Number(old?.sum || 0), b.sample_count - Number(old?.sample_count || 0), finite(b.min), finite(b.max),
          b.integral - Number(old?.integral || 0), b.coverage_ms - Number(old?.coverage_ms || 0), b.missing - Number(old?.missing || 0));
        if (Number.isSafeInteger(b.last_at) && (channel.last_at == null || b.last_at >= Number(channel.last_at))) this.last.run(b.last_at, finite(b.last_value), b.label, channelId);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  snapshot(s) {
    const at = s.collectedAt || Date.now();
    if (s.status && s.status !== 'online') { this.gap(s.id, at); return; }
    const available = (g, key) => !(g.unavailableMetrics || []).includes(key) && finite(g[key]) != null;
    const records = [];
    const add = (device, metric, label, value) => records.push({ server: s.id, device, metric, label, at, value: finite(value) });
    add('all', 'util', 'All GPUs', s.gpus.length && s.gpus.every((g) => available(g, 'util')) ? s.gpus.reduce((n, g) => n + g.util, 0) / s.gpus.length : null);
    add('system', 'cpu', 'System', s.cpuUsage);
    add('system', 'memory', 'System', s.memTotal ? s.memUsed / s.memTotal * 100 : null);
    for (const g of s.gpus) {
      const device = 'gpu:' + (g.uuid || g.index), label = `GPU ${g.index} · ${g.name}`;
      add(device, 'util', label, available(g, 'util') ? g.util : null);
      add(device, 'memory', label, available(g, 'memTotal') && available(g, 'memUsed') && g.memTotal > 0 ? g.memUsed / g.memTotal * 100 : null);
      add(device, 'memoryUsed', label, available(g, 'memUsed') ? g.memUsed : null);
      add(device, 'memoryTotal', label, available(g, 'memTotal') ? g.memTotal : null);
      add(device, 'temp', label, available(g, 'temp') ? g.temp : null);
      add(device, 'power', label, available(g, 'power') ? g.power : null);
    }
    const live = new Set(s.gpus.map((g) => 'gpu:' + (g.uuid || g.index)));
    for (const c of this.db.prepare("SELECT device,metric,label FROM channels WHERE server=? AND device LIKE 'gpu:%'").all(s.id)) {
      if (!live.has(String(c.device))) add(String(c.device), String(c.metric), String(c.label), null);
    }
    this.append(records);
    this.ingestUsage(s, at);
  }

  // 按用户 GPU·时长：每张有进程占用的 GPU，把与上次快照的间隔分钟数均摊给卡上去重的用户集合
  ingestUsage(s, at, previousAt = null) {
    if (s.status && s.status !== 'online') { this.usageLastAt.delete(s.id); this.usageOccupancy.delete(s.id); return; }
    if (s.lastLane && !['legacy', 'processes'].includes(s.lastLane)) return;
    if (s.gpuProcessesAvailable === false) { this.usageLastAt.delete(s.id); this.usageOccupancy.delete(s.id); return; }
    const prev = previousAt ?? this.usageLastAt.get(s.id);
    if (prev != null && at <= prev) return;
    const prior = this.usageOccupancy.get(s.id);
    const occupancy = new Map((s.gpus || []).map((g) => [g.uuid || String(g.index), [...new Set((g.procs || []).map((p) => p.user).filter(Boolean))].slice(0, 16)]));
    this.usageLastAt.set(s.id, at);
    this.usageOccupancy.set(s.id, occupancy);
    if (prev == null || !prior || at - prev > MINUTE) return;
    this.db.exec('BEGIN');
    try {
      for (const [gpu, users] of occupancy) {
        const before = prior.get(gpu);
        // A changed occupancy has an unknown transition time; restart its baseline.
        if (!users.length || !before || JSON.stringify([...users].sort()) !== JSON.stringify([...before].sort())) continue;
        for (let start = prev; start < at;) {
          const end = Math.min(at, Math.floor(start / DAY) * DAY + DAY);
          const share = (end - start) / MINUTE / users.length;
          const day = new Date(start).toISOString().slice(0, 10);
          for (const user of users) this.usageMinute.run(day, s.id, String(user).slice(0, 64), share);
          start = end;
        }
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  usageByUserDays(server, rangeDays) {
    return this.usageByUser.all(String(server), `-${Math.max(1, Math.min(365, rangeDays))} day`)
      .map((r) => ({ user: String(r.user), totalMinutes: Number(r.total) || 0, thisServerMinutes: Number(r.thisServer) || 0 }));
  }

  gap(server, at = Date.now()) {
    this.usageLastAt.delete(server); this.usageOccupancy.delete(server);
    const channels = this.db.prepare('SELECT device,metric,label FROM channels WHERE server=?').all(server);
    this.append(channels.map((c) => ({ server, device: String(c.device), metric: String(c.metric), label: String(c.label), at, value: null })));
  }

  cleanup(now = Date.now()) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM raw WHERE at < ?').run(now - RAW_RETENTION);
      this.db.prepare('DELETE FROM raw_buckets WHERE bucket_at < ?').run(now - RAW_RETENTION);
      // Expire entire minute buckets; no sample beyond the absolute maximum
      // is retained in the oldest partial bucket.
      this.db.prepare('DELETE FROM minutes WHERE at < ?').run(now - RETENTION);
      // Daily accounting cannot split the oldest partial UTC day; expire it in full.
      this.db.prepare('DELETE FROM usage_minutes WHERE day <= ?').run(new Date(now - RETENTION).toISOString().slice(0, 10));
      this.db.prepare('DELETE FROM channels WHERE last_at < ? AND id NOT IN (SELECT channel FROM minutes) AND id NOT IN (SELECT channel FROM raw)').run(now - RETENTION);
      this.research.cleanup(now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.exec('PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE);');
    return this.stats();
  }

  query({ serverId, device = 'all', metric = 'util', rangeMs, end = Date.now() }) {
    const now = Date.now(), rawCutoff = now - RAW_RETENTION;
    if ((!Number.isSafeInteger(rangeMs) || rangeMs < MINUTE || rangeMs > 7 * DAY) || !Number.isSafeInteger(end) || end > now + MINUTE) throw new Error('Invalid history range');
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
        const seconds = this.db.prepare('SELECT * FROM raw_buckets WHERE channel=? AND bucket_at>=? AND bucket_at<=? ORDER BY bucket_at')
          .all(Number(c.id), Math.floor(fromAt / 1000) * 1000, toAt);
        const secondStarts = new Set(seconds.map((row) => Number(row.bucket_at)));
        const overlapsSeconds = (start, end) => { for (let cursor = Math.floor(start / 1000) * 1000; cursor < end; cursor += 1000) if (secondStarts.has(cursor)) return true; return false; };
        for (const row of seconds) {
          const sourceAt = Number(row.bucket_at), from = Math.max(fromAt, sourceAt), to = Math.min(toAt, sourceAt + 1000);
          if (to <= from) continue;
          const b = get(from), fraction = Math.max(0, to - from) / 1000;
          b.sum += Number(row.sum); b.count += Number(row.sample_count);
          b.weighted += Number(row.integral) * fraction; b.coverage += Number(row.coverage_ms) * fraction;
          b.missing ||= Number(row.missing) > 0; extrema(b, finite(row.min), finite(row.max));
        }
        // Read the first successor too, so a trapezoid crossing the requested
        // boundary can be clipped rather than silently dropping its head.
        const rows = this.db.prepare('SELECT at,value FROM raw WHERE channel=? AND at>=? AND at<=? AND NOT EXISTS (SELECT 1 FROM raw_buckets b WHERE b.channel=raw.channel AND b.bucket_at=CAST(raw.at/1000 AS INTEGER)*1000) ORDER BY at').all(Number(c.id), fromAt - MINUTE, toAt + MINUTE);
        let previous = null;
        for (const row of rows) {
          const at = Number(row.at), value = finite(row.value);
          if (at >= fromAt && (at < toAt || includeEnd && at === toAt)) {
            const b = get(at); b.sum += value ?? 0; b.count += value == null ? 0 : 1;
            b.missing ||= value == null; extrema(b, value, value);
          }
          if (previous && previous.value != null && value != null && at - previous.at <= MINUTE && !overlapsSeconds(previous.at, at)) {
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
      result[String(c.server)] = this.db.prepare(`SELECT at,value FROM (SELECT at,value FROM raw WHERE channel=?
        UNION ALL SELECT COALESCE(last_at,bucket_at) AS at,last_value AS value FROM raw_buckets WHERE channel=?) ORDER BY at DESC LIMIT 720`)
        .all(Number(c.id), Number(c.id)).reverse().map((r) => ({ at: Number(r.at), value: finite(r.value) }));
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
