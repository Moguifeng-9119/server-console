const fs = require('node:fs');
const path = require('node:path');

// 保存即上传（Dev Sync）：本地目录 ↔ 远程目录配对，fs.watch 递归监听，
// 500ms 去抖后把变更文件逐个送进传输队列（复用 transfers 的 staging 引擎，覆盖语义一致）
class DevSyncManager {
  constructor({ storeFile, enqueue, getServers = () => [], now = Date.now, debounceMs = 500 }) {
    this.file = storeFile; this.enqueue = enqueue; this.getServers = getServers; this.now = now; this.debounceMs = Math.max(50, debounceMs);
    this.pairs = [];
    this.watchers = new Map(); // id -> FSWatcher
    this.pending = new Map(); // id -> Set<绝对路径>
    this.timers = new Map(); // id -> setTimeout
  }
  init() {
    try { if (fs.existsSync(this.file)) this.pairs = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.pairs = []; }
    for (const pair of this.pairs.filter((p) => p.enabled)) this._start(pair.id);
    return this;
  }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.pairs, null, 2)); }
  list() { return this.pairs.map((p) => ({ ...p })); }
  serverName(id) { return this.getServers().find((s) => s.id === id)?.name || id; }

  static globToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?');
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
    const remoteDir = String(pair.remoteDir || '').trim();
    if (!remoteDir.startsWith('/') || remoteDir.endsWith('/.')) throw new Error('Remote directory must be an absolute POSIX path');
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
    const value = { ...existing, ...pair, ...clean, id, enabled: pair.enabled !== false, lastSyncAt: existing?.lastSyncAt || 0, lastFiles: existing?.lastFiles || [], lastError: '' };
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
    pair.enabled = !!enabled; pair.lastError = '';
    this.persist(); this._stop(id);
    if (pair.enabled) this._start(id);
    return { ...pair };
  }
  pickOnce(id) { // 手动触发一次：把整个目录（排除规则外）重新排队
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair) throw new Error('Sync pair not found');
    const files = this._walk(pair.localDir).filter((f) => !DevSyncManager.excluded(this._rel(pair, f), pair.excludes));
    this._queue(pair, files);
    return files.length;
  }
  _rel(pair, absFile) { return path.relative(pair.localDir, absFile).split(path.sep).join('/'); }
  _walk(dir) {
    const out = [];
    const visit = (d) => {
      let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) visit(full); else if (e.isFile()) out.push(full);
      }
    };
    visit(dir);
    return out.slice(0, 2000);
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
  _stop(id) { const w = this.watchers.get(id); if (w) { try { w.close(); } catch { /* already closed */ } this.watchers.delete(id); } const t = this.timers.get(id); if (t) { clearTimeout(t); this.timers.delete(id); } }
  _handleChange(id, absFile) {
    const pair = this.pairs.find((p) => p.id === id);
    if (!pair || !pair.enabled) return;
    const rel = path.relative(pair.localDir, absFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return; // 防目录穿越/越界
    const bucket = this.pending.get(id) || new Set();
    bucket.add(absFile);
    this.pending.set(id, bucket);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.set(id, setTimeout(() => void this._flush(id).catch(() => { /* 单次同步失败不中断监听 */ }), this.debounceMs));
  }
  async _flush(id) {
    this.timers.delete(id);
    const pair = this.pairs.find((p) => p.id === id);
    const bucket = this.pending.get(id);
    if (!pair || !bucket || !bucket.size) return;
    this.pending.set(id, new Set());
    const files = [];
    for (const f of bucket) {
      let st; try { st = await fs.promises.stat(f); } catch { continue; } // 删除/瞬态文件跳过
      if (!st.isFile()) continue;
      const rel = this._rel(pair, f);
      if (rel.startsWith('..') || DevSyncManager.excluded(rel, pair.excludes)) continue;
      files.push({ abs: f, size: st.size });
    }
    if (!files.length) return;
    this._queue(pair, files.map((f) => f.abs), files.map((f) => f.size));
  }
  _queue(pair, absFiles, sizes = []) {
    if (!absFiles.length) return 0;
    const gid = 'sync_' + pair.id + '_' + this.now().toString(36);
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
    this.enqueue(jobs);
    pair.lastSyncAt = this.now();
    pair.lastFiles = [...(pair.lastFiles || []), ...jobs.map((j) => path.basename(j.srcLocal))].slice(-20);
    pair.lastError = '';
    this.persist();
    return jobs.length;
  }
  stopAll() { for (const id of [...this.watchers.keys()]) this._stop(id); }
}

module.exports = { DevSyncManager };
