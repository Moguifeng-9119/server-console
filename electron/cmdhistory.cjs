const fs = require('node:fs');
const path = require('node:path');

// 跨服务器命令历史：并行命令执行后追加记录（FIFO，上限 200 条），供 UI 搜索回填
class CommandHistory {
  constructor({ file, cap = 200, now = Date.now }) {
    this.file = file; this.cap = cap; this.now = now;
    this.entries = [];
  }
  init() {
    try { if (fs.existsSync(this.file)) this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.entries = []; }
    if (!Array.isArray(this.entries)) this.entries = [];
    return this;
  }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2), { mode: 0o600 }); }
  list(query = '') {
    const q = String(query || '').trim().toLowerCase();
    const filtered = q ? this.entries.filter((e) => (e.command + ' ' + (e.servers || []).join(' ')).toLowerCase().includes(q)) : this.entries;
    return filtered.slice(0, 50);
  }
  record({ command, servers = [], source = 'parallel', ok = true }) {
    const text = String(command || '').trim();
    if (!text) return;
    this.entries = this.entries.filter((e) => !(e.command === text && e.servers.join() === servers.join()));
    this.entries.unshift({ id: 'ch_' + this.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6), at: this.now(), command: text.slice(0, 4096), servers: servers.slice(0, 32), source, ok: !!ok });
    this.entries = this.entries.slice(0, this.cap);
    this.persist();
  }
  remove(id) { this.entries = this.entries.filter((e) => e.id !== id); this.persist(); return true; }
  clear() { this.entries = []; this.persist(); return true; }
}

module.exports = { CommandHistory };
