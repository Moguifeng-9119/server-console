// Experiment summaries and training points share the existing SQLite worker.
const crypto = require('node:crypto');
const path = require('node:path');
const { z } = require('zod');
const { redact } = require('./productivity.cjs');
const DAY = 86400000;
const { itemIdSchema: id, timestampSchema: timestamp, runStatusSchema: status, runInputSchema: runSchema, metricPointSchema: pointSchema } = require('./generated/schema.js');
const terminal = new Set(['succeeded', 'failed', 'stopped']);

class ResearchDatabase {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL, workspace_id TEXT, task_id TEXT,
      name TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL, gpu TEXT NOT NULL,
      parameters TEXT NOT NULL, total_steps INTEGER, status TEXT NOT NULL,
      started_at INTEGER, finished_at INTEGER, exit_code INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT);
      CREATE INDEX IF NOT EXISTS research_runs_server ON research_runs(server_id,created_at DESC,id);
      CREATE INDEX IF NOT EXISTS research_runs_recent ON research_runs(created_at DESC,id);
      CREATE INDEX IF NOT EXISTS research_runs_workspace ON research_runs(workspace_id,created_at DESC,id);
      CREATE TABLE IF NOT EXISTS research_deleted (id TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS research_metrics (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      name TEXT NOT NULL, at INTEGER NOT NULL, step REAL, value REAL,
      source TEXT NOT NULL, source_id TEXT NOT NULL,
      UNIQUE(run_id,source,source_id,name));
      CREATE INDEX IF NOT EXISTS research_metrics_time ON research_metrics(run_id,name,at);
      CREATE INDEX IF NOT EXISTS research_metrics_step ON research_metrics(run_id,name,step,at DESC,seq DESC);
      CREATE INDEX IF NOT EXISTS research_metrics_expiry ON research_metrics(at);
      CREATE TABLE IF NOT EXISTS research_events (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, at INTEGER NOT NULL, evidence TEXT NOT NULL, source_id TEXT NOT NULL,
      UNIQUE(run_id,kind,source_id));
      CREATE INDEX IF NOT EXISTS research_events_recent ON research_events(run_id,at DESC);
      CREATE TABLE IF NOT EXISTS research_summaries (
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      name TEXT NOT NULL, value REAL, at INTEGER NOT NULL, step REAL,
      PRIMARY KEY(run_id,name)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS research_progress (
      run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,
      step REAL NOT NULL, changed_at INTEGER NOT NULL, observed_at INTEGER NOT NULL);`);
  }
  decode(row) {
    if (!row) return null;
    return { id: row.id, serverId: row.server_id, workspaceId: row.workspace_id, taskId: row.task_id, name: row.name, command: row.command, cwd: row.cwd, gpu: row.gpu, parameters: JSON.parse(row.parameters), totalSteps: row.total_steps, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, exitCode: row.exit_code, createdAt: row.created_at, updatedAt: row.updated_at, lastError: row.last_error };
  }
  record(runId) {
    if (this.db.prepare('SELECT id FROM research_deleted WHERE id=?').get(id.parse(runId))) throw Object.assign(new Error('Run was deleted'), { code: 'RUN_DELETED' });
    const run = this.decode(this.db.prepare('SELECT * FROM research_runs WHERE id=?').get(id.parse(runId)));
    if (!run) throw new Error('Run not found');
    return run;
  }
  get(runId) {
    const run = this.record(runId);
    return { ...run, summary: this.db.prepare('SELECT name,value,at,step FROM research_summaries WHERE run_id=? ORDER BY name').all(run.id), events: this.db.prepare('SELECT id,kind,at,evidence FROM research_events WHERE run_id=? ORDER BY at DESC LIMIT 200').all(run.id) };
  }
  create(input) {
    const value = runSchema.parse(input), runId = value.id || crypto.randomUUID(), now = Date.now(), command = redact(value.command);
    if (this.db.prepare('SELECT id FROM research_deleted WHERE id=?').get(runId)) throw Object.assign(new Error('Run was deleted'), { code: 'RUN_DELETED' });
    if (terminal.has(value.status)) throw new Error('Create an active run before recording its outcome');
    const existing = this.db.prepare('SELECT * FROM research_runs WHERE id=?').get(runId);
    if (existing) {
      if (existing.server_id !== value.serverId || existing.command !== command || existing.task_id !== (value.taskId || null)) throw new Error('Run identity conflicts with an existing run');
      return this.decode(existing);
    }
    this.db.prepare('INSERT INTO research_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId, value.serverId, value.workspaceId || null, value.taskId || null, value.name, command, value.cwd, value.gpu, JSON.stringify(redact(value.parameters)), value.totalSteps || null, value.status, value.startedAt || null, null, null, now, now, null);
    return this.record(runId);
  }
  update(input) {
    const run = this.record(input.id), next = status.parse(input.status);
    if (terminal.has(run.status) && next !== run.status) throw new Error('A completed run cannot return to an active state');
    const code = input.exitCode == null ? run.exitCode : z.number().int().min(0).max(255).parse(input.exitCode);
    if ((next === 'succeeded' || next === 'failed') && code === null) throw new Error('A completed run requires an observed exit code');
    if (next === 'succeeded' && code !== 0 || next === 'failed' && code === 0) throw new Error('Run status does not match its exit code');
    this.db.prepare('UPDATE research_runs SET status=?,exit_code=?,finished_at=?,updated_at=?,last_error=? WHERE id=?').run(next, code, terminal.has(next) ? timestamp.parse(input.finishedAt ?? run.finishedAt ?? Date.now()) : null, Date.now(), input.error ? redact(String(input.error).slice(0, 4000)) : null, run.id);
    return this.record(run.id);
  }
  list({ serverId = null, workspaceId = null, limit = 100 } = {}) {
    if (serverId) id.parse(serverId); if (workspaceId) id.parse(workspaceId);
    const conditions = [], parameters = [];
    if (serverId) { conditions.push('server_id=?'); parameters.push(serverId); }
    if (workspaceId) { conditions.push('workspace_id=?'); parameters.push(workspaceId); }
    return this.db.prepare('SELECT * FROM research_runs' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') + ' ORDER BY created_at DESC,id LIMIT ?').all(...parameters, Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)))).map((row) => this.decode(row));
  }
  append({ runId, points = [], events = [], observedAt = Date.now() }) {
    const run = this.record(runId);
    const observed = timestamp.parse(observedAt);
    if (!Array.isArray(points) || points.length > 10000 || !Array.isArray(events) || events.length > 1000) throw new Error('Training batch limit exceeded');
    const clean = points.map((point) => pointSchema.parse({ ...point, runId: run.id }));
    const insert = this.db.prepare('INSERT OR IGNORE INTO research_metrics(run_id,name,at,step,value,source,source_id) VALUES(?,?,?,?,?,?,?)');
    const summary = this.db.prepare(`INSERT INTO research_summaries VALUES(?,?,?,?,?) ON CONFLICT(run_id,name) DO UPDATE SET value=excluded.value,at=excluded.at,step=excluded.step WHERE excluded.at>=research_summaries.at`);
    this.db.exec('BEGIN'); let added = 0;
    try {
      for (const p of clean) {
        const result = insert.run(run.id, p.name, p.at, p.step, p.value, p.source, p.sourceId);
        if (Number(result.changes)) {
          added++; summary.run(run.id, p.name, p.value, p.at, p.step);
          if (p.name === 'step' && p.value !== null) this.db.prepare(`INSERT INTO research_progress VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET step=excluded.step,changed_at=CASE WHEN excluded.step<>research_progress.step THEN excluded.changed_at ELSE research_progress.changed_at END,observed_at=excluded.observed_at WHERE excluded.observed_at>=research_progress.observed_at`).run(run.id, p.value, observed, observed);
        }
      }
      for (const event of events) {
        const kind = z.enum(['oom', 'nan', 'no-progress', 'disk-full', 'gpu-idle']).parse(event.kind);
        this.db.prepare('INSERT OR IGNORE INTO research_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), run.id, kind, timestamp.parse(event.at), redact(z.string().max(2000).parse(event.evidence)), z.string().min(1).max(300).parse(event.sourceId));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { added };
  }
  diagnose({ runId, at, filesystems = [], physicalCwd = null }) {
    const run = this.record(runId), now = timestamp.parse(at);
    if (run.status !== 'running') return { added: 0 };
    const events = [], progress = this.db.prepare('SELECT * FROM research_progress WHERE run_id=?').get(run.id);
    const anchor = progress ? Math.max(progress.changed_at, run.startedAt || run.createdAt) : null;
    if (anchor !== null && now - anchor >= 10 * 60000) events.push({ kind: 'no-progress', at: now, sourceId: 'progress:' + anchor, evidence: `Observed running task; log polling is healthy and caught up. Step ${progress.step} has not changed since ${new Date(anchor).toISOString()} (at least ${Math.floor((now - anchor) / 60000)} minutes).` });
    const cwd = typeof physicalCwd === 'string' && physicalCwd.startsWith('/') ? path.posix.normalize(physicalCwd) : null;
    const mount = cwd ? filesystems.filter((m) => typeof m.mount === 'string' && m.mount.startsWith('/') && (m.mount === '/' || cwd === m.mount || cwd.startsWith(m.mount.replace(/\/$/, '') + '/'))).sort((a, b) => b.mount.length - a.mount.length)[0] : null;
    if (mount && Number.isFinite(mount.percent) && mount.percent >= 95 && Number.isFinite(mount.available) && mount.available >= 0) events.push({ kind: 'disk-full', at: now, sourceId: 'disk:' + crypto.createHash('sha256').update(mount.mount).digest('hex').slice(0, 24) + ':' + Math.floor(now / 3600000), evidence: `Physical working directory ${cwd}; filesystem ${mount.mount} is ${mount.percent}% used, ${mount.available} bytes available, observed ${new Date(now).toISOString()}. Threshold: 95%.`.slice(0, 2000) });
    return this.append({ runId: run.id, events });
  }
  metrics({ runId, name, axis = 'time', limit = 5000 }) {
    this.record(runId); z.string().max(80).parse(name);
    // Equal-width sampling retains each bucket's last point, min and max.
    const x = axis === 'step' ? 'step' : 'at';
    const bounds = this.db.prepare(`SELECT MIN(${x}) AS lo, MAX(${x}) AS hi,COUNT(*) AS n FROM research_metrics WHERE run_id=? AND name=? AND ${x} IS NOT NULL`).get(runId, name);
    const count = Math.max(2, Math.min(10000, Math.trunc(Number(limit) || 5000)));
    if (Number(bounds.n) <= count) return { points: this.db.prepare(`SELECT at,step,value FROM research_metrics WHERE run_id=? AND name=? AND ${x} IS NOT NULL ORDER BY ${x},at,seq`).all(runId, name), total: Number(bounds.n), downsampled: false };
    const width = Math.max(1, Math.ceil((Number(bounds.hi) - Number(bounds.lo) + 1) / count));
    const points = this.db.prepare(`WITH buckets AS (SELECT CAST((${x}-?)/? AS INTEGER) AS bucket, MIN(value) AS min, MAX(value) AS max,MAX(${x}) AS x,SUM(value IS NULL) AS missing FROM research_metrics WHERE run_id=? AND name=? AND ${x} IS NOT NULL GROUP BY bucket), selected AS (SELECT b.*, (SELECT seq FROM research_metrics m WHERE m.run_id=? AND m.name=? AND m.${x}=b.x ORDER BY m.at DESC,m.seq DESC LIMIT 1) AS seq FROM buckets b)
      SELECT m.at,m.step,m.value,b.min,b.max,b.missing FROM selected b JOIN research_metrics m ON m.seq=b.seq ORDER BY b.x`).all(Number(bounds.lo), width, runId, name, runId, name);
    return { points, total: Number(bounds.n), downsampled: true };
  }
  remove(runId) {
    this.record(runId); this.db.exec('BEGIN');
    try { this.db.prepare('INSERT OR IGNORE INTO research_deleted VALUES(?,?)').run(runId, Date.now()); for (const table of ['research_metrics', 'research_events', 'research_summaries', 'research_progress']) this.db.prepare('DELETE FROM ' + table + ' WHERE run_id=?').run(runId); this.db.prepare('DELETE FROM research_runs WHERE id=?').run(runId); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return true;
  }
  cleanup(now) { this.db.prepare('DELETE FROM research_metrics WHERE at < ?').run(now - 30 * DAY); }
}
module.exports = { ResearchDatabase };
