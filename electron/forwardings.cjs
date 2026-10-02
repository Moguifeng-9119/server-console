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
      throw new Error('转发规则不完整（服务器 / 本地端口 / 远程 host:port）');
    }
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) list[idx] = clean;
    else list.push(clean);
    save(this.dataDir, list);
    // 已在监听的旧实例先停，按新配置重启
    await this.stop(id);
    if (clean.enabled) await this.start(clean);
    this._emit();
    return id;
  }

  async remove(id) {
    await this.stop(id);
    save(this.dataDir, load(this.dataDir).filter((r) => r.id !== id));
    this.status.delete(id);
    this.errors.delete(id);
    this._emit();
    return true;
  }

  async start(rule) {
    await this.stop(rule.id);
    const conn = await this.getConn(rule.serverId);
    if (!conn) throw new Error('服务器连接不可用');
    const client = await new Promise((resolve, reject) => {
      conn.connect().then(() => resolve(conn.client)).catch(reject);
    });
    if (!client) throw new Error('SSH 客户端未就绪');
    const server = net.createServer((socket) => {
      client.forwardOut('127.0.0.1', 0, rule.remoteHost, rule.remotePort, (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        stream.pipe(socket).pipe(stream);
        socket.on('error', () => stream.end());
        stream.on('error', () => socket.destroy());
      });
      socket.on('error', () => socket.destroy());
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: Number(rule.localPort), host: '127.0.0.1' }, () => resolve());
    });
    server.on('error', (e) => {
      this.status.set(rule.id, 'error');
      this.errors.set(rule.id, e.message);
      this._emit();
    });
    this.servers.set(rule.id, server);
    this.status.set(rule.id, 'listening');
    this.errors.delete(rule.id);
    this._emit();
  }

  async stop(id) {
    const server = this.servers.get(id);
    if (server) {
      this.servers.delete(id);
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (this.status.get(id) === 'listening') this.status.set(id, 'stopped');
  }

  // 应用启动时恢复所有启用中的规则（单条失败不阻塞其余）
  async startAll() {
    for (const rule of load(this.dataDir)) {
      if (!rule.enabled) continue;
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
