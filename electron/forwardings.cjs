const lang = require('./lang.cjs');
// 本地端口转发：把本机端口 → 经 SSH 通道 → 远程 host:port（等价 ssh -L）。
// 规则持久化 userData/forwardings.json；由 ipc 注入 getConn/closeStream。
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ruleFile = (dataDir) => path.join(dataDir, 'forwardings.json');

function load(dataDir) {
  try {
    const list = JSON.parse(fs.readFileSync(ruleFile(dataDir), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(dataDir, list) {
  fs.mkdirSync(path.dirname(ruleFile(dataDir)), { recursive: true });
  fs.writeFileSync(ruleFile(dataDir), JSON.stringify(list, null, 2), { mode: 0o600 });
}

class ForwardingManager {
  // getConn(serverId) -> Connection（复用连接池）；notify -> 状态变化回调
  constructor({ dataDir, getConn, onChange }) {
    this.dataDir = dataDir;
    this.getConn = getConn;
    this.onChange = onChange || (() => {});
    this.servers = new Map(); // ruleId -> net.Server
    this.sockets = new Map(); // ruleId -> active local sockets
    this.generations = new Map(); // latest requested lifecycle operation
    this.listenerQueues = new Map(); // serialize local bind/close, never SSH handshakes
    this.status = new Map(); // ruleId -> 'listening' | 'error' | 'stopped'
    this.errors = new Map(); // ruleId -> 错误信息
  }

  list() {
    return load(this.dataDir).map((r) => ({
      ...r,
      status: this.status.get(r.id) || 'stopped',
      error: this.errors.get(r.id) || '',
    }));
  }

  _emit() {
    this.onChange(this.list());
  }

  _invalidate(id) {
    const token = (this.generations.get(id) || 0) + 1;
    this.generations.set(id, token);
    return token;
  }

  _current(id, token) { return this.generations.get(id) === token; }

  async _withListenerLock(id, operation) {
    const previous = this.listenerQueues.get(id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    this.listenerQueues.set(id, pending);
    try { return await pending; }
    finally { if (this.listenerQueues.get(id) === pending) this.listenerQueues.delete(id); }
  }

  async upsert(rule) {
    const list = load(this.dataDir);
    const id = rule.id || `fw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const clean = {
      id,
      serverId: String(rule.serverId || ''),
      localPort: Math.floor(Number(rule.localPort)) || 0,
      remoteHost: String(rule.remoteHost || '127.0.0.1'),
      remotePort: Math.floor(Number(rule.remotePort)) || 0,
      enabled: !!rule.enabled,
    };
    if (!clean.serverId || clean.localPort < 1 || clean.localPort > 65535 || !clean.remoteHost || clean.remotePort < 1 || clean.remotePort > 65535) {
      throw new Error(lang.t('invalidConfig', { detail: 'SSH forwarding: server / port / host:port' }));
    }
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) list[idx] = clean;
    else list.push(clean);
    save(this.dataDir, list);
    const token = this._invalidate(id);
    if (clean.enabled) await this._start(clean, token);
    else await this._withListenerLock(id, () => this._current(id, token) && this._stopListener(id));
    this._emit();
    return id;
  }

  async remove(id) {
    save(this.dataDir, load(this.dataDir).filter((r) => r.id !== id));
    const token = this._invalidate(id);
    await this._withListenerLock(id, async () => {
      if (!this._current(id, token)) return;
      await this._stopListener(id);
      if (this._current(id, token)) { this.status.delete(id); this.errors.delete(id); }
    });
    this._emit();
    return true;
  }

  async start(rule) {
    return this._start(rule, this._invalidate(rule.id));
  }

  async _start(rule, token) {
    try { await this._startCurrent(rule, token); }
    catch (error) { if (this._current(rule.id, token)) throw error; }
  }

  async _startCurrent(rule, token) {
    await this._withListenerLock(rule.id, () => this._current(rule.id, token) && this._stopListener(rule.id));
    if (!this._current(rule.id, token)) return;
    const conn = await this.getConn(rule.serverId);
    if (!this._current(rule.id, token)) return;
    if (!conn) throw new Error(lang.t('connectionMissing'));
    await conn.connect();
    if (!this._current(rule.id, token)) return;
    const client = conn.client;
    if (!client) throw new Error(lang.t('clientMissing'));
    await this._withListenerLock(rule.id, async () => {
      if (!this._current(rule.id, token)) return;
      const sockets = new Set();
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        client.forwardOut('127.0.0.1', 0, rule.remoteHost, rule.remotePort, (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          if (socket.destroyed) { stream.destroy(); return; }
          stream.once('close', () => socket.destroy());
          stream.pipe(socket).pipe(stream);
          socket.once('close', () => stream.destroy());
          socket.on('error', () => stream.end());
          stream.on('error', () => socket.destroy());
        });
        socket.on('error', () => socket.destroy());
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port: Number(rule.localPort), host: '127.0.0.1' }, () => resolve());
      });
      if (!this._current(rule.id, token)) {
        const closed = new Promise((resolve) => server.close(resolve));
        for (const socket of sockets) socket.destroy();
        await closed;
        return;
      }
      server.on('error', (e) => {
        if (this.servers.get(rule.id) !== server) return;
        this.status.set(rule.id, 'error');
        this.errors.set(rule.id, e.message);
        this._emit();
      });
      this.servers.set(rule.id, server);
      this.sockets.set(rule.id, sockets);
      this.status.set(rule.id, 'listening');
      this.errors.delete(rule.id);
      this._emit();
    });
  }

  async stop(id) {
    const token = this._invalidate(id);
    await this._withListenerLock(id, () => this._current(id, token) && this._stopListener(id));
  }

  async _stopListener(id) {
    const server = this.servers.get(id);
    if (server) {
      this.servers.delete(id);
      const sockets = this.sockets.get(id);
      this.sockets.delete(id);
      const closed = new Promise((resolve) => server.close(() => resolve()));
      for (const socket of sockets || []) socket.destroy();
      await closed;
    }
    if (!this.servers.has(id) && this.status.get(id) === 'listening') this.status.set(id, 'stopped');
    this._emit();
  }

  // 应用启动时恢复所有启用中的规则（单条失败不阻塞其余）
  async startAll() {
    for (const { id } of load(this.dataDir)) {
      const rule = load(this.dataDir).find((entry) => entry.id === id);
      if (!rule?.enabled) continue;
      try {
        await this.start(rule);
      } catch (e) {
        this.status.set(rule.id, 'error');
        this.errors.set(rule.id, e.message);
      }
    }
    this._emit();
  }
}

module.exports = { ForwardingManager, load, save };
