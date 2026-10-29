const fs = require('node:fs');
const path = require('node:path');

// 保存即上传（Dev Sync）：本地目录 ↔ 远程目录配对，fs.watch 递归监听，
// 500ms 去抖后把变更文件逐个送进传输队列（复用 transfers 的 staging 引擎，覆盖语义一致）
class DevSyncManager {
  constructor({ storeFile, enqueue, getTask = (_id) => undefined, listTasks = () => [], getServers = () => [], now = Date.now, debounceMs = 500 }) {
    this.file = storeFile; this.enqueue = enqueue; this.getServers = getServers; this.now = now; this.debounceMs = Math.max(50, debounceMs);
    this.pairs = [];
    this.watchers = new Map(); // id -> FSWatcher
    this.pending = new Map(); // id -> Set<绝对路径>
    this.timers = new Map(); // id -> setTimeout
    this.getTask = getTask; this.listTasks = listTasks; this.generations = new Map(); this.batches = new Map(); this.closed = false;
    this.completionTimer = setInterval(() => this.refresh(), 1000); this.completionTimer.unref();
  }
  init() {
    try { if (fs.existsSync(this.file)) this.pairs = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.pairs = []; }
    for (const pair of this.pairs) for (const batch of (pair.inflight || [])) if (batch.groupId && Array.isArray(batch.taskIds)) this.batches.set(batch.groupId, { ...batch, pairId: pair.id });
    for (const pair of this.pairs.filter((p) => p.enabled)) this._start(pair.id);
    return this;
  }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.pairs, null, 2)); }
  list() { this.refresh(); return this.pairs.map((p) => ({ ...p })); }
  serverName(id) { return this.getServers().find((s) => s.id === id)?.name || id; }

  static globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(new RegExp(String.fromCharCode(1), 'g'), '(?:.*/)?');
    return new RegExp('^' + escaped + '$', 'i');
  }
  static excluded(relPosix, excludes) {
    const segments = relPosix.split('/');
    return (excludes || []).some((raw) => {
      let re; try { re = DevSyncManager.globToRegExp(String(raw)); } catch { return false; }
      return re.test(relPosix) || segments.some((seg) => re.test(seg));
    });
  }
  static remotePathFor(localDir, remoteDir, absFile) {
    const rel = path.relative(localDir, absFile).split(path.sep).join('/');
    const base = remoteDir === '/' ? '' : remoteDir.replace(/\/+$/, '');
    return (base || '') + '/' + rel;
  }

  validate(pair) {
    if (!pair || typeof pair !== 'object') throw new Error('Invalid sync pair');
    const localDir = String(pair.localDir || '').trim();
    if (!path.isAbsolute(localDir)) throw new Error('Local directory must be an absolute path');
    let st; try { st = fs.statSync(localDir); } catch { throw new Error('Local directory does not exist'); }
    if (!st.isDirectory()) throw new Error('Local directory is not a directory');
    if (fs.lstatSync(localDir).isSymbolicLink()) throw new Error('Local directory must not be a symbolic link');
    const remoteDir = String(pair.remoteDir || '').trim();
    if (!remoteDir.startsWith('/') || remoteDir.endsWith('/.') || /[\0\r\n]/.test(remoteDir)) throw new Error('Remote directory must be an absolute POSIX path');
    const excludes = (Array.isArray(pair.excludes) ? pair.excludes : String(pair.excludes || '').split(/\r?\n/)).map((e) => String(e).trim()).filter(Boolean).slice(0, 16);
    for (const e of excludes) { try { DevSyncManager.globToRegExp(e); } catch { throw new Error('Invalid exclude pattern: ' + e); } }
    const serverId = String(pair.serverId || '');
    if (!this.getServers().some((s) => s.id === serverId)) throw new Error('Unknown server');
    return { localDir, remoteDir, excludes, serverId };
  }
  save(pair) {
    const clean = this.validate(pair);
    const id = pair.id || 'sync_' + this.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const existing = this.pairs.find((p) => p.id === id);
    if (!existing && this.pairs.length >= 1000) throw new Error('Sync pair limit reached');
    const value = { ...existing, ...clean, id, enabled: pair.enabled !== false, lastSyncAt: existing?.lastSyncAt || 0, lastFiles: existing?.lastFiles || [], lastError: '', status: pair.enabled === false ? 'paused' : 'watching' };
    const index = this.pairs.findIndex((p) => p.id === id);
    if (index < 0) this.pairs.push(value); else this.pairs[index] = value;
    this.persist();
    this._stop(id);
    if (value.enabled) this._start(id);
    return { ...value };
  }
  delete(id) { this._stop(id); this.pairs = this.pairs.filter((p) => p.id !== id); this.persist(); return true; }
  toggle(id, enabled) {
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair) throw new Error('Sync pair not found');
    pair.enabled = !!enabled; pair.lastError = ''; pair.status = pair.enabled ? 'watching' : 'paused';
    this.persist(); this._stop(id);
    if (pair.enabled) this._start(id);
    return { ...pair };
  }
  pickOnce(id) { // 手动触发一次：把整个目录（排除规则外）重新排队
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair) throw new Error('Sync pair not found');
    if (!pair.enabled || this.closed) throw new Error('Sync pair is paused');
    const files = this._walk(pair.localDir, pair.excludes).filter((f) => !DevSyncManager.excluded(this._rel(pair, f), pair.excludes));
    this._queue(pair, files);
    return files.length;
  }
  _rel(pair, absFile) { return path.relative(pair.localDir, absFile).split(path.sep).join('/'); }
  _walk(dir, excludes = []) {
    const out = []; let visited = 0;
    const visit = (d, depth = 0) => {
      if (depth > 64) throw new Error('Sync directory depth exceeds 64');
      let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (++visited > 10000 || out.length >= 2000) throw new Error('Sync scan limit reached; narrow the directory or add exclusions');
        const full = path.join(d, e.name);
        if (e.isSymbolicLink() || DevSyncManager.excluded(path.relative(dir, full).split(path.sep).join('/'), excludes)) continue;
        if (e.isDirectory()) visit(full, depth + 1); else if (e.isFile() && this._contained(dir, full)) out.push(full);
      }
    };
    visit(dir);
    return out;
  }
  _contained(root, file) {
    try {
      const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
      let cursor = file;
      while (cursor !== root) { if (fs.lstatSync(cursor).isSymbolicLink()) return false; const parent = path.dirname(cursor); if (parent === cursor) return false; cursor = parent; }
      return fs.lstatSync(file).isFile();
    } catch { return false; }
  }

  _start(id) {
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair || this.watchers.has(id)) return;
    try {
      const watcher = fs.watch(pair.localDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        this._handleChange(id, path.resolve(pair.localDir, String(filename)));
      });
      watcher.on('error', (error) => {
        const p = this.pairs.find((x) => x.id === id);
        if (p) { p.lastError = String(error.message || error); this.persist(); }
        this._stop(id);
      });
      this.watchers.set(id, watcher);
    } catch (error) {
      pair.lastError = String(error.message || error);
      this.persist();
    }
  }
  _stop(id) { this.generations.set(id, (this.generations.get(id) || 0) + 1); this.pending.delete(id); const w = this.watchers.get(id); if (w) { try { w.close(); } catch { /* already closed */ } this.watchers.delete(id); } const t = this.timers.get(id); if (t) { clearTimeout(t); this.timers.delete(id); } }
  _handleChange(id, absFile) {
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair || !pair.enabled || this.closed) return;
    const rel = path.relative(pair.localDir, absFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return; // 防目录穿越/越界
    const bucket = this.pending.get(id) || new Set();
    if (bucket.size >= 2000 && !bucket.has(absFile)) { pair.lastError = 'Pending sync limit reached'; pair.status = 'error'; this.persist(); return; }
    bucket.add(absFile);
    this.pending.set(id, bucket);
    pair.status = 'changed';
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.set(id, setTimeout(() => void this._flush(id).catch(() => { /* 单次同步失败不中断监听 */ }), this.debounceMs));
  }
  async _flush(id) {
    const generation = this.generations.get(id) || 0;
    this.timers.delete(id);
    const pair = this.pairs.find((p) => p.id === id);
    const bucket = this.pending.get(id);
    if (!pair || !pair.enabled || this.closed || !bucket || !bucket.size) return;
    this.pending.set(id, new Set());
    const files = [];
    for (const f of bucket) {
      let st; try { st = await fs.promises.stat(f); } catch { continue; } // 删除/瞬态文件跳过
      if (!st.isFile() || !this._contained(pair.localDir, f)) continue;
      const rel = this._rel(pair, f);
      if (rel.startsWith('..') || DevSyncManager.excluded(rel, pair.excludes)) continue;
      files.push({ abs: f, size: st.size });
    }
    if (!files.length || this.closed || !pair.enabled || (this.generations.get(id) || 0) !== generation) return;
    this._queue(pair, files.map((f) => f.abs), files.map((f) => f.size));
  }
  _queue(pair, absFiles, sizes = []) {
    if (!absFiles.length || !pair.enabled || this.closed) return 0;
    if (this.batches.size >= 200) throw new Error('Pending upload batch limit reached');
    absFiles = absFiles.filter((file) => this._contained(pair.localDir, file));
    if (!absFiles.length) return 0;
    const gid = 'sync_' + pair.id + '_' + this.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const jobs = absFiles.map((f, i) => ({
      kind: 'upload',
      serverId: pair.serverId,
      serverName: this.serverName(pair.serverId),
      srcLocal: f,
      dstRemote: DevSyncManager.remotePathFor(pair.localDir, pair.remoteDir, f),
      name: path.basename(f),
      size: sizes[i] ?? 0,
      groupId: gid,
    }));
    let created;
    try { created = this.enqueue(jobs); }
    catch (error) { pair.lastError = String(error.message || error); pair.status = 'error'; this.persist(); throw error; }
    const taskIds = Array.isArray(created) ? created.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean) : [];
    // Transfer managers normally return task IDs; group lookup also supports
    // adapters that emit updates synchronously but return no result.
    if (!taskIds.length) for (const task of this.listTasks()) if (task.groupId === gid) taskIds.push(task.id);
    this.batches.set(gid, { pairId: pair.id, taskIds, expected: jobs.length, files: jobs.map((job) => path.basename(job.srcLocal)) });
    pair.inflight = [...(pair.inflight || []), { groupId: gid, taskIds, expected: jobs.length }].slice(-200);
    pair.lastQueuedAt = this.now(); pair.taskIds = taskIds; pair.status = 'queued';
    pair.lastFiles = [...(pair.lastFiles || []), ...jobs.map((j) => path.basename(j.srcLocal))].slice(-20);
    pair.lastError = '';
    this.persist();
    return jobs.length;
  }
  refresh() {
    const results = new Map(), active = new Map();
    for (const [groupId, batch] of this.batches) {
      const pair = this.pairs.find((item) => item.id === batch.pairId);
      if (!pair) { this.batches.delete(groupId); continue; }
      const tasks = batch.taskIds.map((id) => this.getTask(id));
      const missing = !Number.isSafeInteger(batch.expected) || batch.expected < 1 || tasks.length !== batch.expected || tasks.some((task) => !task);
      const failed = tasks.find((task) => task && ['error', 'canceled', 'cancelled'].includes(task.status));
      const completed = !missing && tasks.length > 0 && tasks.every((task) => ['done', 'completed'].includes(task.status));
      if (missing || failed || completed) {
        const result = results.get(pair.id) || { completedAt: 0, error: '' };
        if (missing) result.error = 'Upload task records are missing or were pruned; completion cannot be verified';
        else if (failed) result.error = String(failed.error || 'Upload did not complete');
        else result.completedAt = Math.max(result.completedAt, ...tasks.map((task) => {
          const timestamp = Number(task.finishedAt || task.completedAt || task.updatedAt);
          return Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, this.now()) : this.now();
        }));
        results.set(pair.id, result); this.batches.delete(groupId);
      } else {
        const states = active.get(pair.id) || new Set();
        for (const task of tasks) states.add(['running', 'transferring', 'verifying'].includes(task.status) ? 'uploading' : task.status === 'paused' ? 'paused' : 'queued');
        active.set(pair.id, states);
      }
    }
    let changed = false;
    for (const pair of this.pairs) {
      const before = JSON.stringify(pair), result = results.get(pair.id), states = active.get(pair.id);
      pair.inflight = (pair.inflight || []).filter((batch) => this.batches.has(batch.groupId));
      if (result?.completedAt) pair.lastSyncAt = Math.max(Number(pair.lastSyncAt) || 0, result.completedAt);
      if (result?.error) pair.lastError = result.error;
      else if (result?.completedAt) pair.lastError = '';
      if (!pair.enabled) pair.status = 'paused';
      else if (states?.has('uploading')) pair.status = 'uploading';
      else if (states?.has('queued')) pair.status = 'queued';
      else if (states?.has('paused')) pair.status = 'paused';
      else if (this.pending.get(pair.id)?.size) pair.status = 'changed';
      else if (pair.lastError) pair.status = 'error';
      else if (result?.completedAt) pair.status = 'done';
      else if (['queued', 'uploading', 'paused', 'changed'].includes(pair.status)) pair.status = 'watching';
      changed ||= before !== JSON.stringify(pair);
    }
    if (changed) this.persist();
  }
  stopAll() { this.closed = true; clearInterval(this.completionTimer); for (const pair of this.pairs) this._stop(pair.id); }
}

module.exports = { DevSyncManager };
