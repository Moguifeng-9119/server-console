const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
const text = (value, max = 4096) => String(value ?? '').slice(0, max);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const pidOf = (value) => { const pid = Number(value); if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid process ID'); return pid; };
const portOf = (value) => { const port = Number(value); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port'); return port; };
const idOf = (value) => { const id = String(value || ''); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid item ID'); return id; };
const taskPath = (id) => '"$HOME"/.local/state/serverconsole/tasks/' + quote(idOf(id));
const clone = (value) => JSON.parse(JSON.stringify(value));

// ===== 定时计划（时间窗）辅助：纯函数，供测试直接导入 =====
const CLOCK_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (value) => { const [h, m] = String(value).split(':').map(Number); return h * 60 + m; };
const dayShift = (date, delta) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

// 服务器时钟解析：date '+%F %H:%M' 输出 → { date: 'YYYY-MM-DD', minutes: 当日分钟数 }
function parseClock(output) {
  const m = String(output).trim().match(CLOCK_RE);
  if (!m) throw new Error('Server clock unavailable');
  return { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) };
}

// 窗口判定：inside 含起点不含终点；跨夜窗口（start > end）的 occurrenceKey 归属窗口开始那天。
// days（0=周日…6=周六）按 occurrenceKey 的星期过滤；空数组视为每天。
function windowState(schedule, serverDate, serverMinutes) {
  const start = minutesOf(schedule.start), end = minutesOf(schedule.end), now = serverMinutes;
  let inside, occurrenceKey;
  if (start < end) { inside = now >= start && now < end; occurrenceKey = serverDate; }
  else { inside = now >= start || now < end; occurrenceKey = now >= start ? serverDate : dayShift(serverDate, -1); }
  const days = Array.isArray(schedule.days) && schedule.days.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  if (inside && !days.includes(weekdayOf(occurrenceKey))) inside = false;
  return { inside, occurrenceKey };
}

// schedule 入参校验与归一化；windowUnchanged 时保留 lastOccurrence/lastStartAt（防改名后同窗重复启动）
function normalizeSchedule(input, previous) {
  if (input == null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid schedule');
  const start = String(input.start || ''), end = String(input.end || '');
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new Error('Schedule window must use HH:MM');
  if (start === end) throw new Error('Schedule window start and end must differ');
  const rawDays = input.days == null ? [] : [...new Set((Array.isArray(input.days) ? input.days : [input.days]).map(Number))];
  const days = rawDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length) days.push(0, 1, 2, 3, 4, 5, 6); // 未指定/空数组归一为每天；全非法输入同样回退每天
  const schedule = { start, end, days, enabled: input.enabled !== false };
  if (previous && previous.start === start && previous.end === end && JSON.stringify(previous.days) === JSON.stringify(days)) {
    schedule.lastOccurrence = previous.lastOccurrence;
    schedule.lastStartAt = previous.lastStartAt;
  }
  return schedule;
}

/** Parse Linux procfs counters and POSIX df output, retaining unsupported values. */
function parseSystem(stdout, previous, at = Date.now()) {
  const blocks = {}; let section = '';
  for (const line of stdout.split(/\r?\n/)) { if (/^__SC_[A-Z]+__$/.test(line)) { section = line; blocks[section] = []; } else if (section) blocks[section].push(line); }
  const capacity = (key) => (blocks[key] || []).slice(1).filter(Boolean).flatMap((line) => {
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    return m ? [{ device: m[1], total: +m[2], used: +m[3], available: +m[4], percent: +m[5], mount: m[6] }] : [];
  });
  const disks = (blocks.__SC_DISK__ || []).flatMap((line) => { const f = line.trim().split(/\s+/); return f.length >= 14 && !/^(loop|ram)/.test(f[2]) ? [{ device: f[2], readBytes: +f[5] * 512, writeBytes: +f[9] * 512, busyMs: +f[12] }] : []; });
  const networks = (blocks.__SC_NET__ || []).flatMap((line) => { const p = line.indexOf(':'); if (p < 0) return []; const f = line.slice(p + 1).trim().split(/\s+/); return f.length >= 16 ? [{ device: line.slice(0, p).trim(), receiveBytes: +f[0], transmitBytes: +f[8], receiveErrors: +f[2], transmitErrors: +f[10] }] : []; });
  const elapsed = previous ? (at - previous.at) / 1000 : 0;
  const rate = (current, old, key) => elapsed > 0 && elapsed <= 120 && old && current[key] >= old[key] ? (current[key] - old[key]) / elapsed : null;
  return { at, platform: (blocks.__SC_OS__ || []).join('').trim(), capabilities: { procfs: Boolean(blocks.__SC_DISK__?.length), containers: (blocks.__SC_CAP__ || []).filter(Boolean), ratesReady: elapsed > 0 && elapsed <= 120 },
    filesystems: capacity('__SC_DF__').map((d) => ({ ...d, total: d.total * 1024, used: d.used * 1024, available: d.available * 1024 })), inodes: capacity('__SC_INODE__'),
    disks: disks.map((d) => { const old = previous?.disks.find((o) => o.device === d.device); return { ...d, readBytesPerSecond: rate(d, old, 'readBytes'), writeBytesPerSecond: rate(d, old, 'writeBytes'), busyPercent: elapsed > 0 && elapsed <= 120 && old && d.busyMs >= old.busyMs ? Math.min(100, (d.busyMs - old.busyMs) / (elapsed * 10)) : null }; }),
    networks: networks.map((d) => { const old = previous?.networks.find((o) => o.device === d.device); return { ...d, receiveBytesPerSecond: rate(d, old, 'receiveBytes'), transmitBytesPerSecond: rate(d, old, 'transmitBytes') }; }) };
}

const SYSTEM_COMMAND = "printf '__SC_OS__\\n'; uname -s; printf '__SC_DF__\\n'; LC_ALL=C df -Pk; printf '__SC_INODE__\\n'; LC_ALL=C df -Pi; printf '__SC_DISK__\\n'; cat /proc/diskstats 2>/dev/null; printf '__SC_NET__\\n'; cat /proc/net/dev 2>/dev/null; printf '__SC_CAP__\\n'; for c in docker podman tmux python3; do command -v \"$c\" >/dev/null 2>&1 && printf '%s\\n' \"$c\"; done; true";

/** Local persisted workspaces and explicitly requested remote tools. */
class WorkbenchManager {
  constructor({ directory, getConnection, getServers = () => [], notify = (_title, _body) => {}, onEvent = (_event) => {}, historyQuery = null, onResource = (_serverId, _value) => {}, resourceConcurrency = 4, now = Date.now }) {
    this.file = path.join(directory, 'workbench.json'); this.getConnection = getConnection; this.getServers = getServers; this.notify = notify; this.onEvent = onEvent; this.historyQuery = historyQuery;
    this.data = { version: 1, tasks: [], watches: [], rules: [], events: [], templates: [] }; this.previous = new Map(); this.snapshots = new Map(); this.progress = new Map(); this.running = new Set(); this.closed = false; this.taskPollAt = new Map();
    this.clockCache = new Map(); // serverId -> { at, date, minutes }（服务器本地时钟，10s 缓存）
    this.onResource = onResource; this.resourceNow = now; this.resourceConcurrency = Math.max(1, Math.min(16, Math.floor(Number(resourceConcurrency) || 4)));
    this.resourceIdentities = new Map(); this.resourceInFlight = new Map(); this.resourceFailures = new Map(); this.resourceQueue = []; this.resourceActive = 0; this.resourceBusyHosts = new Set();
  }
  init() { if (fs.existsSync(this.file)) { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); for (const key of ['tasks', 'watches', 'rules', 'events', 'templates']) if (Array.isArray(saved[key])) this.data[key] = saved[key]; } return this; }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(tmp, this.file); }
  close() { this.closed = true; for (const job of this.resourceQueue.splice(0)) { job.reject(new Error('Workbench is closed')); this.resourceInFlight.delete(job.serverId); } this.persist(); }
  server(id) { if (!this.getServers().some((s) => s.id === id)) throw new Error('Server no longer exists'); return this.getConnection(id); }
  async exec(serverId, command, timeout = 15000) { if (this.closed) throw new Error('Workbench is closed'); const connection = await this.server(serverId); const result = await connection.exec(command, timeout); if (result.code !== 0 || result.signal) throw new Error(text(result.stderr || 'Remote command failed: ' + (result.signal || result.code), 2000)); if (Buffer.byteLength(result.stdout || '') > 8 * 1024 * 1024) throw new Error('Remote result exceeds 8 MiB'); return result.stdout || ''; }
  resourceIdentity(serverId) {
    const cfg = this.getServers().find((item) => item.id === serverId);
    if (!cfg) throw new Error('Server no longer exists');
    return crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
  }
  observeResources(serverId, { maxAgeMs = 2000 } = {}) {
    if (this.closed) return Promise.reject(new Error('Workbench is closed'));
    let identity;
    try { identity = this.resourceIdentity(serverId); } catch (error) { return Promise.reject(error); }
    if (this.resourceIdentities.get(serverId) !== identity) {
      this.previous.delete(serverId); this.resourceFailures.delete(serverId); this.resourceIdentities.set(serverId, identity);
    }
    const active = this.resourceInFlight.get(serverId);
    if (active?.identity === identity) return active.promise;
    const cached = this.previous.get(serverId), age = this.resourceNow() - (cached?.at || 0);
    const maxAge = Math.max(0, Math.min(60000, Number(maxAgeMs) || 0));
    if (cached && age >= 0 && age < maxAge) return Promise.resolve(cached);
    const failed = this.resourceFailures.get(serverId);
    if (failed && this.resourceNow() - failed.at < 5000) return Promise.reject(failed.error);
    if (this.resourceQueue.length >= 128) return Promise.reject(new Error('Resource sampling queue is full'));
    let resolve, reject;
    const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
    const job = { serverId, identity, promise, resolve, reject };
    this.resourceInFlight.set(serverId, job); this.resourceQueue.push(job); this.pumpResources(); return promise;
  }
  pumpResources() {
    while (!this.closed && this.resourceActive < this.resourceConcurrency && this.resourceQueue.length) {
      const next = this.resourceQueue.findIndex((item) => !this.resourceBusyHosts.has(item.serverId));
      if (next < 0) break;
      const [job] = this.resourceQueue.splice(next, 1); this.resourceActive++; this.resourceBusyHosts.add(job.serverId);
      void (async () => {
        try {
          if (this.resourceIdentity(job.serverId) !== job.identity) throw new Error('Resource source changed');
          const output = await this.exec(job.serverId, SYSTEM_COMMAND, 15000);
          if (this.closed) throw new Error('Workbench is closed');
          if (this.resourceIdentity(job.serverId) !== job.identity || this.resourceIdentities.get(job.serverId) !== job.identity) throw new Error('Resource source changed');
          if (!output.includes('__SC_OS__\n') || !output.includes('__SC_DF__\n') || !output.includes('__SC_NET__\n')) throw new Error('Unsupported resource response');
          const value = parseSystem(output, this.previous.get(job.serverId), this.resourceNow());
          if (!value.platform) throw new Error('Resource platform is unavailable');
          this.previous.set(job.serverId, value); this.resourceFailures.delete(job.serverId);
          await this.onResource(job.serverId, value); job.resolve(value);
        } catch (error) {
          if (!this.closed && this.resourceIdentities.get(job.serverId) === job.identity) this.resourceFailures.set(job.serverId, { at: this.resourceNow(), error });
          job.reject(error);
        } finally {
          if (this.resourceInFlight.get(job.serverId) === job) this.resourceInFlight.delete(job.serverId);
          this.resourceActive--; this.resourceBusyHosts.delete(job.serverId); this.pumpResources();
        }
      })();
    }
  }
  event(type, serverId, title, body, extra = {}) { const item = { id: crypto.randomUUID(), type, serverId, title, body, at: Date.now(), ...extra }; this.data.events.unshift(item); this.data.events = this.data.events.slice(0, 1000); this.persist(); this.onEvent(item); Promise.resolve(this.notify(title, body)).catch((error) => this.onEvent({ type: 'notification-error', error: String(error), at: Date.now() })); return item; }
  quiet(rule, at) { if (!rule.quietStart || !rule.quietEnd || rule.quietStart === rule.quietEnd) return false; const d = new Date(at); const now = d.getHours() * 60 + d.getMinutes(); const minutes = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; }; const start = minutes(rule.quietStart), end = minutes(rule.quietEnd); return start < end ? now >= start && now < end : now >= start || now < end; }
  consumeSnapshot(snapshot) {
    if (this.closed || !snapshot?.id) return;
    const at = Number(snapshot.collectedAt) || Date.now(); const prior = this.snapshots.get(snapshot.id); this.snapshots.set(snapshot.id, snapshot);
    if (prior && snapshot.status === prior.status && at < (Number(prior.collectedAt) || 0)) return;
    const gpuMaxAge = Math.max(5000, (snapshot.monitoring?.effectiveIntervalMs || 2000) * 4);
    const laneAt = (lane) => snapshot.laneTimestamps?.[lane] ?? (!snapshot.lastLane || snapshot.lastLane === lane ? at : null);
    const freshAt = (observedAt, maxAge = gpuMaxAge) => Number.isFinite(observedAt) && observedAt <= at + 1000 && at - observedAt <= maxAge;
    const gpuAt = (g) => g.observedAt ?? laneAt('gpu');
    const available = (g, metric) => !g.unavailableMetrics?.includes(metric) && typeof g[metric] === 'number' && Number.isFinite(g[metric]);
    if (at - (this.taskPollAt.get(snapshot.id) || 0) > 10000) {
      this.taskPollAt.set(snapshot.id, at);
      for (const task of this.data.tasks.filter((item) => item.serverId === snapshot.id && item.remoteId && ['starting', 'running', 'unknown'].includes(item.status))) {
        if (this.running.has('poll:' + task.id)) continue;
        this.running.add('poll:' + task.id);
        void this.taskStatus(task.id).catch(() => { /* keep unknown remote status until a successful probe */ }).finally(() => this.running.delete('poll:' + task.id));
      }
    }
    for (const watch of this.data.watches.filter((w) => w.enabled && w.serverId === snapshot.id && (!snapshot.lastLane || snapshot.lastLane === 'gpu'))) {
      const key = 'watch:' + watch.id, state = this.progress.get(key) || { since: null, lastAt: 0 };
      const candidates = snapshot.status === 'online' ? (snapshot.gpus || []).filter((g) => available(g, 'memTotal') && available(g, 'memUsed') && g.memTotal > 0 && freshAt(laneAt('gpu')) && freshAt(gpuAt(g)) && (!watch.model || g.name.toLowerCase().includes(watch.model.toLowerCase())) && g.memTotal - g.memUsed >= watch.minFreeGiB * 1024) : [];
      // Keep tracking the same qualifying card when stream row order changes.
      const gpu = candidates.find((g) => (g.uuid || g.index) === state.gpu) || candidates[0];
      if (!gpu) { state.since = null; state.gpu = null; this.progress.set(key, state); continue; }
      const observedAt = gpuAt(gpu), identity = gpu.uuid || gpu.index;
      if (state.gpu !== identity || observedAt - state.lastAt > Math.max(15000, gpuMaxAge)) state.since = null;
      if (state.gpu === identity && observedAt <= state.lastAt) continue;
      state.gpu = identity; if (state.since === null) state.since = observedAt;
      state.lastAt = observedAt; this.progress.set(key, state);
      if (observedAt - state.since >= watch.durationSeconds * 1000) { watch.enabled = false; watch.firedAt = at; this.event('gpu-available', snapshot.id, 'GPU available', `${gpu.name} · GPU ${gpu.index} · ${((gpu.memTotal - gpu.memUsed) / 1024).toFixed(1)} GiB free`, { watchId: watch.id }); }
    }
    for (const rule of this.data.rules.filter((r) => r.enabled && (!r.serverId || r.serverId === snapshot.id))) {
      if (snapshot.lastLane && rule.metric !== 'offline' && snapshot.lastLane !== (rule.metric === 'cpuUsage' ? 'system' : 'gpu')) continue;
      const key = 'rule:' + rule.id + ':' + snapshot.id;
      const state = this.progress.get(key) || { active: false, notified: 0, devices: new Map() };
      const gs = snapshot.gpus || [], lane = rule.metric === 'cpuUsage' ? 'system' : 'gpu';
      let observations = rule.metric === 'offline' ? [{ id: 'status', value: snapshot.status === 'online' ? 0 : 1, at }] : rule.metric === 'cpuUsage' ? [{ id: 'cpu', value: snapshot.cpuUsage, at: laneAt('system') }] : gs.map((g) => ({ id: g.uuid || String(g.index), at: gpuAt(g), value: rule.metric === 'temperature' ? available(g, 'temp') ? g.temp : null : rule.metric === 'gpuUtil' ? available(g, 'util') ? g.util : null : available(g, 'memUsed') && available(g, 'memTotal') && g.memTotal > 0 ? g.memUsed / g.memTotal * 100 : null }));
      const expectedCount = observations.length;
      if (rule.metric !== 'offline' && (snapshot.status !== 'online' || !freshAt(laneAt(lane)))) observations = [];
      observations = observations.filter((o) => typeof o.value === 'number' && Number.isFinite(o.value) && freshAt(o.at));
      const live = new Set(observations.map((o) => o.id));
      for (const id of state.devices.keys()) if (!live.has(id)) state.devices.delete(id);
      const hit = (value) => rule.direction === 'below' ? value <= rule.threshold : value >= rule.threshold;
      for (const observation of observations) {
        const previous = state.devices.get(observation.id);
        if (previous && observation.at <= previous.lastAt) continue;
        const since = hit(observation.value) ? previous?.since != null && observation.at - previous.lastAt <= Math.max(15000, gpuMaxAge) ? previous.since : observation.at : null;
        state.devices.set(observation.id, { since, lastAt: observation.at });
      }
      const values = observations.map((o) => o.value);
      const recovered = values.length > 0 && values.length === expectedCount && values.every((v) => rule.direction === 'below' ? v >= rule.recovery : v <= rule.recovery);
      if (state.active && recovered) { state.active = false; this.event('rule-recovered', snapshot.id, rule.name + ' · recovered', 'The recovery threshold was reached.', { ruleId: rule.id }); }
      const sustained = observations.some((o) => { const d = state.devices.get(o.id); return hit(o.value) && d?.since != null && o.at - d.since >= rule.durationSeconds * 1000; });
      if (!state.active && sustained && at - state.notified >= rule.cooldownSeconds * 1000 && !this.quiet(rule, at)) { state.active = true; state.notified = at; this.event('rule-triggered', snapshot.id, rule.name, `${rule.metric}: ${values.join(', ')}`, { ruleId: rule.id }); }
      this.progress.set(key, state);
    }
  }
  upsert(kind, item) { const id = item.id ? idOf(item.id) : crypto.randomUUID(); const index = this.data[kind].findIndex((o) => o.id === id); if (index < 0 && this.data[kind].length >= 500) throw new Error('Workspace item limit reached'); const value = { ...item, id }; if (index < 0) this.data[kind].push(value); else this.data[kind][index] = value; this.persist(); return clone(value); }
  async request(request) {
    const r = request || {}; const op = r.operation; const sid = String(r.serverId || '');
    if (sid && ['taskStart', 'taskStatus', 'taskStop', 'taskLog', 'taskDelete'].includes(op) && this.task(idOf(r.id)).serverId !== sid) throw new Error('Task belongs to another server');
    if (op === 'eventList') return clone(this.data.events.filter((e) => !sid || e.serverId === sid));
    if (op === 'system') return this.observeResources(sid, { maxAgeMs: 2000 });
    if (op === 'process') return this.processDetails(sid, pidOf(r.pid));
    if (op === 'tmux' || op === 'tmux.list') { const result = await this.exec(sid, "if ! command -v tmux >/dev/null 2>&1; then printf '__UNSUPPORTED__'; elif tmux list-sessions -F '#{session_name}\\t#{session_windows}\\t#{session_attached}' 2>/dev/null; then :; else printf '__EMPTY__'; fi"); return { available: !result.includes('__UNSUPPORTED__'), sessions: result.split(/\r?\n/).filter((l) => l && !l.startsWith('__')).map((line) => { const [name, windows, attached] = line.split('\t'); return { name, windows: +windows, attached: +attached }; }) }; }
    if (op === 'tmux.attach') { const sessions = await this.request({ operation: 'tmux.list', serverId: sid }); if (!sessions.sessions.some((s) => s.name === r.name)) throw new Error('Session no longer exists'); return { command: 'tmux attach-session -t ' + quote(String(r.name)) }; }
    if (op === 'taskList') return clone(this.data.tasks.filter((t) => !sid || t.serverId === sid));
    if (op === 'taskSave') { this.server(sid); const existing = this.data.tasks.find((t) => t.id === r.id); if (existing && existing.serverId !== sid) throw new Error('Task server cannot be changed'); if (existing?.remoteId) throw new Error('Started tasks are immutable; create a new task'); const command = text(r.command, 65536).trim(); if (!command) throw new Error('Enter a command'); const cwd = text(r.cwd || '~'); if (cwd !== '~' && !cwd.startsWith('/')) throw new Error('Working directory must be absolute or ~'); const gpu = text(r.gpu, 2048); if (gpu && !/^[a-zA-Z0-9,._/-]+$/.test(gpu)) throw new Error('Invalid GPU selection'); const schedule = normalizeSchedule(r.schedule, existing?.schedule); return this.upsert('tasks', { id: r.id, serverId: sid, name: text(r.name || command.slice(0, 60), 120), command, cwd, gpu, schedule, logPath: text(r.logPath), terminal: r.terminal && typeof r.terminal === 'object' ? { name: text(r.terminal.name, 120) } : {}, status: 'saved', createdAt: existing?.createdAt || Date.now() }); }
    if (op === 'taskStart') return this.startTask(idOf(r.id));
    if (op === 'taskStop') return this.killTask(idOf(r.id), 'Stopped manually');
    if (op === 'taskStatus') return this.taskStatus(idOf(r.id));
    if (op === 'taskLog') { const task = this.task(idOf(r.id)); if (!task.remoteId) return { text: '', truncated: false }; return { text: await this.exec(task.serverId, 'tail -c 262144 -- ' + taskPath(task.remoteId) + '/output.log'), truncated: true }; }
    if (op === 'taskDelete') { const task = this.task(idOf(r.id)); if (['starting', 'running', 'unknown'].includes(task.status)) throw new Error('A live task must remain tracked'); this.data.tasks = this.data.tasks.filter((t) => t.id !== task.id); this.persist(); return true; }
    if (op === 'watchList' || op === 'ruleList' || op === 'templateList') return clone(this.data[op === 'watchList' ? 'watches' : op === 'ruleList' ? 'rules' : 'templates'].filter((t) => !sid || !t.serverId || t.serverId === sid));
    if (op === 'watchSave') { this.server(sid); return this.upsert('watches', { id: r.id, serverId: sid, model: text(r.model, 120), minFreeGiB: Math.max(0, finite(r.minFreeGiB)), durationSeconds: Math.max(0, Math.min(86400, finite(r.durationSeconds, 30))), enabled: r.enabled !== false }); }
    if (op === 'ruleSave') { if (sid) this.server(sid); if (!['gpuUtil', 'temperature', 'memoryPercent', 'cpuUsage', 'offline'].includes(r.metric)) throw new Error('Invalid alert metric'); if (![r.threshold, r.recovery].every((v) => Number.isFinite(Number(v)))) throw new Error('Invalid alert threshold'); const direction = r.direction === 'below' ? 'below' : 'above'; if (direction === 'above' ? +r.recovery > +r.threshold : +r.recovery < +r.threshold) throw new Error('Recovery must provide hysteresis'); for (const key of ['quietStart', 'quietEnd']) if (r[key] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r[key])) throw new Error('Invalid quiet hours'); return this.upsert('rules', { id: r.id, serverId: sid, name: text(r.name || r.metric, 120), metric: r.metric, direction, threshold: +r.threshold, recovery: +r.recovery, durationSeconds: Math.max(0, finite(r.durationSeconds, 30)), cooldownSeconds: Math.max(0, finite(r.cooldownSeconds, 300)), quietStart: r.quietStart || '', quietEnd: r.quietEnd || '', enabled: r.enabled !== false }); }
    if (op === 'templateSave') { const command = text(r.command, 65536); if (!command.trim()) throw new Error('Enter a command template'); return this.upsert('templates', { id: r.id, name: text(r.name || 'Command', 120), command }); }
    if (op === 'templateRender') { const template = this.data.templates.find((t) => t.id === r.id); if (!template) throw new Error('Template not found'); return { command: template.command.replace(/\{\{([a-zA-Z_]\w*)\}\}/g, (_whole, key) => { if (!Object.hasOwn(r.parameters || {}, key)) throw new Error('Missing parameter: ' + key); return quote(text(r.parameters[key], 4096)); }) }; }
    if (['watchDelete', 'ruleDelete', 'templateDelete'].includes(op)) { const kind = op === 'watchDelete' ? 'watches' : op === 'ruleDelete' ? 'rules' : 'templates'; const id = idOf(r.id); this.data[kind] = this.data[kind].filter((t) => t.id !== id); for (const key of this.progress.keys()) if (key.includes(':' + id)) this.progress.delete(key); this.persist(); return true; }
    if (op === 'containers') return this.containers(sid, r.engine);
    if (op === 'containerLogs' || op === 'containerShell') { const engine = r.engine === 'podman' ? 'podman' : 'docker'; const id = String(r.containerId || ''); if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid container ID'); if (op === 'containerShell') return { command: engine + ' exec -it ' + quote(id) + ' /bin/sh' }; return { text: await this.exec(sid, engine + ' logs --tail 300 --timestamps ' + quote(id) + ' 2>&1') }; }
    if (op === 'serviceTemplate') { const name = r.name === 'tensorboard' ? 'tensorboard' : r.name === 'web' ? 'web' : 'jupyter'; const remotePort = portOf(r.remotePort || (name === 'tensorboard' ? 6006 : 8888)); const localPort = portOf(r.localPort || remotePort); const command = name === 'jupyter' ? `jupyter lab --no-browser --ip=127.0.0.1 --port=${remotePort}` : name === 'tensorboard' ? `tensorboard --logdir=${quote(text(r.logDir || './runs'))} --host=127.0.0.1 --port=${remotePort}` : ''; return { name, serverId: sid, remoteHost: '127.0.0.1', remotePort, localPort, url: `http://127.0.0.1:${localPort}`, command }; }
    if (op === 'report') return this.report(sid, r.rangeMs);
    throw new Error('Unsupported workbench operation');
  }
  task(id) { const task = this.data.tasks.find((t) => t.id === id); if (!task) throw new Error('Task not found'); this.server(task.serverId); return task; }
  async startTask(id) {
    const task = this.task(id);
    if (this.running.has(id) || task.remoteId) throw new Error('Task already started; create a new card to rerun');
    this.running.add(id); task.remoteId = crypto.randomUUID(); task.status = 'starting'; task.startedAt = Date.now(); this.persist();
    const dir = taskPath(task.remoteId), cwd = task.cwd === '~' ? '"$HOME"' : quote(task.cwd);
    const script = [
      '#!/bin/sh', 'SC_TASK_DIR=' + dir,
      'printf "%s\\n" "$$" >"$SC_TASK_DIR/runner.pid"',
      'awk \'{print $22}\' /proc/$$/stat >"$SC_TASK_DIR/runner.start"',
      "trap 'rc=$?; trap - EXIT; printf \"%s\\n\" \"$rc\" >\"$SC_TASK_DIR/exit.tmp\"; mv \"$SC_TASK_DIR/exit.tmp\" \"$SC_TASK_DIR/exit.code\"; exit \"$rc\"' EXIT",
      'cd -- ' + cwd + ' || exit 125',
      task.gpu ? 'export CUDA_VISIBLE_DEVICES=' + quote(task.gpu) : '',
      'sh -c ' + quote(task.command), 'exit "$?"',
    ].join('\n') + '\n';
    const command = 'umask 077; mkdir -p "$HOME/.local/state/serverconsole/tasks" && mkdir ' + dir +
      ' && printf %s ' + quote(script) + ' >' + dir + '/runner.sh && chmod 700 ' + dir + '/runner.sh || exit 1; ' +
      'if command -v tmux >/dev/null 2>&1; then tmux new-session -d -s ' + quote('sc-' + task.remoteId) + ' ' +
      quote('sh ' + dir + '/runner.sh >' + dir + '/output.log 2>&1') + " || exit 1; printf 'tmux\\n'; " +
      'else nohup sh ' + dir + '/runner.sh >' + dir + "/output.log 2>&1 </dev/null & printf 'nohup\\n'; fi";
    try {
      const mode = (await this.exec(task.serverId, command)).trim();
      if (!['tmux', 'nohup'].includes(mode)) throw new Error('Task launcher did not acknowledge startup');
      task.mode = mode; task.sessionName = mode === 'tmux' ? 'sc-' + task.remoteId : null; task.status = 'starting';
      task.ownedLog = '~/.local/state/serverconsole/tasks/' + task.remoteId + '/output.log'; this.persist(); return clone(task);
    } catch (error) { task.status = 'unknown'; task.error = String(error); this.persist(); throw error; }
    finally { this.running.delete(id); }
  }
  async taskStatus(id) {
    const task = this.task(id); if (!task.remoteId) return clone(task);
    if (task.status === 'stopped') return clone(task); // 计划/手动终止后不再被退出码覆盖回 failed
    const dir = taskPath(task.remoteId);
    const command = 'if test -f ' + dir + '/exit.code; then cat ' + dir + '/exit.code; ' +
      'elif test -s ' + dir + '/runner.pid && test -s ' + dir + '/runner.start; then pid=$(cat ' + dir + '/runner.pid); expected=$(cat ' + dir + '/runner.start); ' +
      'case "$pid" in ""|*[!0-9]*) printf __UNKNOWN__;; *) current=$(awk \'{print $22}\' /proc/"$pid"/stat 2>/dev/null); ' +
      'if test -n "$current" && test "$current" = "$expected"; then printf __PENDING__; else printf __UNKNOWN__; fi;; esac; ' +
      'else printf __STARTING__; fi';
    const output = (await this.exec(task.serverId, command)).trim();
    if (/^\d+$/.test(output)) {
      const done = ['succeeded', 'failed'].includes(task.status);
      task.exitCode = +output; task.status = task.exitCode === 0 ? 'succeeded' : 'failed';
      if (!done) { task.finishedAt = Date.now(); this.event('task-finished', task.serverId, task.name, 'Exit code: ' + task.exitCode, { taskId: task.id }); }
    } else task.status = output === '__PENDING__' ? 'running' : output === '__STARTING__' && Date.now() - task.startedAt < 30000 ? 'starting' : 'unknown';
    this.persist(); return clone(task);
  }

  // 终止运行中的任务：tmux 会话优先杀；再按 runner.pid+runner.start 校验杀主进程（TERM→1s→KILL）
  async killTask(id, reason = 'Stopped') {
    const task = this.task(id);
    if (!task.remoteId || !['starting', 'running', 'unknown'].includes(task.status)) throw new Error('Task is not running');
    const dir = taskPath(task.remoteId);
    const parts = [];
    if (task.mode === 'tmux' && task.sessionName) parts.push('tmux kill-session -t ' + quote(task.sessionName) + ' 2>/dev/null || true');
    parts.push('if test -s ' + dir + '/runner.pid; then pid=$(cat ' + dir + '/runner.pid); case "$pid" in ""|*[!0-9]*) ;; *) kill -TERM "$pid" 2>/dev/null || true; sleep 1; kill -KILL "$pid" 2>/dev/null || true;; esac; fi');
    try { await this.exec(task.serverId, parts.join('; '), 15000); } catch { /* 尽力而为：状态仍标记停止 */ }
    task.status = 'stopped'; task.finishedAt = Date.now(); this.persist();
    this.event('task-stopped', task.serverId, task.name + ' · ' + reason, '', { taskId: task.id });
    return clone(task);
  }

  // 服务器本地时钟（10s 缓存）。按服务器时间计算窗口是用户确认的语义。
  async serverClock(serverId, now = Date.now()) {
    const cached = this.clockCache.get(serverId);
    if (cached && now - cached.at < 10000) return cached;
    const clock = { at: now, ...parseClock(await this.exec(serverId, "date '+%F %H:%M'", 10000)) };
    this.clockCache.set(serverId, clock);
    return clock;
  }

  // 定时计划 tick（主进程每 15s 调一次）：
  // 窗口内且本窗口未触发过 → 重置并启动；窗口外且仍在跑 → 强制终止。服务器不可达 → 本轮跳过。
  async tickSchedules(now = Date.now()) {
    if (this.closed) return;
    const scheduled = this.data.tasks.filter((t) => t.schedule && t.schedule.enabled !== false && t.serverId);
    if (!scheduled.length) return;
    const byServer = new Map();
    for (const task of scheduled) {
      if (!byServer.has(task.serverId)) byServer.set(task.serverId, []);
      byServer.get(task.serverId).push(task);
    }
    for (const [serverId, tasks] of byServer) {
      let clock;
      try { clock = await this.serverClock(serverId, now); } catch { continue; }
      for (const task of tasks) {
        const lock = 'sched:' + task.id;
        if (this.running.has(lock)) continue;
        this.running.add(lock);
        try { await this.applySchedule(task, clock, now); } catch { /* 下轮重试 */ }
        finally { this.running.delete(lock); }
      }
    }
  }

  async applySchedule(task, clock, now) {
    const schedule = task.schedule;
    const { inside, occurrenceKey } = windowState(schedule, clock.date, clock.minutes);
    const live = !!task.remoteId && ['starting', 'running', 'unknown'].includes(task.status);
    if (!inside) {
      if (live) await this.killTask(task.id, 'Window ended (' + schedule.start + '–' + schedule.end + ')');
      return;
    }
    if (schedule.lastOccurrence === occurrenceKey) return; // 本窗口已处理
    if (live) { // 用户在窗口内手动启动了：占用本窗口，避免双跑；到点终止依然生效
      schedule.lastOccurrence = occurrenceKey; schedule.lastStartAt = now; this.persist();
      return;
    }
    // 新窗口：重置上次运行痕迹后启动
    task.remoteId = undefined; task.sessionName = undefined; task.exitCode = undefined; task.error = undefined;
    task.mode = undefined; task.ownedLog = undefined; task.finishedAt = undefined; task.startedAt = undefined; task.status = 'saved';
    schedule.lastOccurrence = occurrenceKey; schedule.lastStartAt = now;
    this.persist();
    try {
      await this.startTask(task.id);
      this.event('schedule-start', task.serverId, task.name, 'Window ' + schedule.start + '–' + schedule.end + ' started', { taskId: task.id });
    } catch (error) {
      task.status = 'unknown'; task.error = String(error); this.persist();
      this.event('schedule-error', task.serverId, task.name, 'Scheduled start failed: ' + String(error), { taskId: task.id });
    }
  }

  async processDetails(sid, pid) {
    const command = `printf '__SC_STAT__\\n'; cat /proc/${pid}/stat || exit 1; printf '\\n__SC_CWD__\\n'; readlink /proc/${pid}/cwd 2>/dev/null || true; printf '__SC_CMD__\\n'; tr '\\000' ' ' </proc/${pid}/cmdline 2>/dev/null; printf '\\n__SC_TREE__\\n'; LC_ALL=C ps -eo pid,ppid,user,etime,args --no-headers; printf '__SC_CGROUP__\\n'; cat /proc/${pid}/cgroup 2>/dev/null || true`;
    const output = await this.exec(sid, command); const split = (start, end) => output.split(start + '\n')[1]?.split(end + '\n')[0]?.trim() || ''; const stat = split('__SC_STAT__', '__SC_CWD__'); const close = stat.lastIndexOf(')'); const fields = stat.slice(close + 2).split(/\s+/); const all = split('__SC_TREE__', '__SC_CGROUP__').split('\n').flatMap((line) => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/); return m ? [{ pid: +m[1], ppid: +m[2], user: m[3], elapsed: m[4], command: m[5] }] : []; });
    const selected = new Set([pid]); for (let i = 0; i < all.length; i++) { let changed = false; for (const p of all) if (selected.has(p.ppid) && !selected.has(p.pid)) { selected.add(p.pid); changed = true; } if (!changed) break; }
    const ppid = +fields[1]; return { pid, ppid, startTicks: fields[19] || null, cwd: split('__SC_CWD__', '__SC_CMD__'), command: split('__SC_CMD__', '__SC_TREE__'), cgroup: output.split('__SC_CGROUP__\n')[1]?.trim() || '', tree: all.filter((p) => selected.has(p.pid) || p.pid === ppid), gpus: (this.snapshots.get(sid)?.gpus || []).filter((g) => (g.procs || []).some((p) => p.pid === pid)).map((g) => ({ index: g.index, uuid: g.uuid, name: g.name })) };
  }
  async containers(sid, requested) {
    const engine = requested === 'podman' ? 'podman' : requested === 'docker' ? 'docker' : (await this.exec(sid, 'if command -v docker >/dev/null 2>&1; then printf docker; elif command -v podman >/dev/null 2>&1; then printf podman; else printf unavailable; fi')).trim();
    if (engine === 'unavailable') return { available: false, containers: [], engine: null };
    const command = engine === 'docker' ? "docker ps -a --no-trunc --format '{{json .}}'" : 'podman ps -a --no-trunc --format json'; const output = await this.exec(sid, command); const values = engine === 'podman' ? JSON.parse(output || '[]') : output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); let stats = [], statsError = null;
    try { const raw = await this.exec(sid, engine === 'docker' ? "docker stats --no-stream --format '{{json .}}'" : 'podman stats --no-stream --format json', 20000); stats = engine === 'docker' ? raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(raw || '[]'); } catch (error) { statsError = String(error); }
    return { available: true, engine, containers: values.map((c) => ({ id: c.ID || c.Id || c.id, name: c.Names || c.names || c.Name, image: c.Image || c.image, status: c.Status || c.status || c.State, ports: c.Ports || c.ports, raw: c })), stats, statsError };
  }
  async report(sid, rangeMs = 604800000) {
    this.server(sid); if (!this.historyQuery) throw new Error('History is unavailable'); const range = [1800000, 3600000, 43200000, 86400000, 604800000].includes(rangeMs) ? rangeMs : 604800000; const base = await this.historyQuery({ serverId: sid, device: 'all', metric: 'util', rangeMs: range });
    const devices = base.devices.filter((d) => d.metric === 'util').slice(0, 64); const results = await Promise.all(devices.map((d) => this.historyQuery({ serverId: sid, device: d.device, metric: d.metric, rangeMs: range })));
    return { serverId: sid, start: base.start, end: base.end, generatedAt: Date.now(), devices: results.map((result, i) => { let integral = 0, coveredMs = 0, peak = null; for (const p of result.points) { if (typeof p.value === 'number' && p.coveredMs > 0) { integral += p.value * p.coveredMs; coveredMs += p.coveredMs; } if (typeof p.max === 'number') peak = peak === null ? p.max : Math.max(peak, p.max); } return { ...devices[i], average: coveredMs ? integral / coveredMs : null, peak, coveredMs, coveragePercent: Math.min(100, coveredMs / (result.end - result.start) * 100), busyEquivalentHours: integral / 100 / 3600000 }; }), tasks: this.data.tasks.filter((t) => t.serverId === sid && t.startedAt >= base.start).map((t) => ({ name: t.name, status: t.status, exitCode: t.exitCode ?? null, startedAt: t.startedAt, finishedAt: t.finishedAt || null })), note: 'Busy-equivalent hours integrate utilization over observed time; uncovered time and untracked jobs are unknown.' };
  }
}

module.exports = { WorkbenchManager, parseSystem, quote, SYSTEM_COMMAND, windowState, parseClock, normalizeSchedule };


