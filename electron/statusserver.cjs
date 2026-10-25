const http = require('node:http');
const os = require('node:os');
const nodeCrypto = require('node:crypto');

// 手机状态页：纯只读。一个 GET /status.json（GPU/显存/温度摘要 + 活跃传输 + 告警事件）
// 和一个内联单文件 HTML（深色移动端布局，5s 轮询）。无凭据、无命令、无写入。
class StatusServer {
  constructor({ getSummary, token, log = (_tag, _detail) => {} }) {
    this.getSummary = getSummary;
    this.token = String(token || '');
    this.log = log;
    this.server = null;
    this.port = 0;
  }
  safeEqual(a, b) {
    const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
    if (ba.length !== bb.length || !ba.length) return false;
    return nodeCrypto.timingSafeEqual(ba, bb);
  }
  start(port = 0) {
    if (this.server) return Promise.resolve({ port: this.port });
    if (!this.token) this.token = nodeCrypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://local');
          if (url.pathname !== '/' && url.pathname !== '/status.json') { res.writeHead(404); res.end(); return; }
          if (!this.safeEqual(url.searchParams.get('token'), this.token)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Forbidden'); return; }
          if (url.pathname === '/status.json') {
            const body = JSON.stringify(this.getSummary());
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(body);
            return;
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(StatusServer.page(url.searchParams.get('token') || ''));
        } catch (error) {
          this.log('statuspage-handler', String((error && error.message) || error));
          res.writeHead(500); res.end();
        }
      });
      server.on('error', (error) => { this.server = null; reject(error); });
      server.listen(port, '0.0.0.0', () => {
        this.server = server;
        const addr = server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : Number(addr) || 0;
        resolve({ port: this.port });
      });
    });
  }
  stop() {
    const server = this.server;
    this.server = null; this.port = 0;
    if (!server) return;
    try { server.close(); } catch { /* already closed */ }
  }
  running() { return !!this.server; }
  lanAddresses(port = this.port) {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    return { urls: ips.map((ip) => `http://${ip}:${port}/?token=${this.token}`), localhost: `http://127.0.0.1:${port}/?token=${this.token}` };
  }

  // 单文件内联页面：无构建步骤，深色移动端优先，5 秒轮询
  static page(token) {
    const tokenJson = JSON.stringify(token);
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ServerConsole Status</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { background: #0e1116; color: #e7eef8; font: 14px/1.45 -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 14px; padding-bottom: 40px; }
h1 { font-size: 17px; margin-bottom: 2px; } .sub { color: #8b98ab; font-size: 12px; margin-bottom: 14px; }
.card { background: #141a23; border: 1px solid #232d3b; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.offline { opacity: 0.45; }
.srv-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; flex: none; }
.dot.online { background: #34d399; }
.srv-head b { flex: 1; }
.cpu { color: #8b98ab; font-size: 12px; }
.gpu { margin: 10px 0 2px; }
.gpu .name { font-size: 12px; color: #aab6c8; display: flex; justify-content: space-between; }
.bar { height: 7px; background: #1d2632; border-radius: 4px; overflow: hidden; margin: 3px 0; }
.bar i { display: block; height: 100%; background: #22d3ee; border-radius: 4px; transition: width .4s; }
.bar.mem i { background: #a78bfa; }
.bar.hot i { background: #f87171; }
.meta { color: #8b98ab; font-size: 11px; }
h2 { font-size: 13px; color: #aab6c8; margin-bottom: 6px; }
.xfer, .evt { font-size: 12px; padding: 4px 0; border-top: 1px solid #1d2632; display: flex; gap: 8px; align-items: center; }
.xfer .name, .evt .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evt time { color: #8b98ab; font-size: 11px; }
.empty { color: #8b98ab; font-size: 12px; }
.err { color: #f87171; font-size: 12px; padding: 8px 0; }
</style></head><body>
<h1>ServerConsole</h1><div class="sub" id="sub">connecting…</div><div id="root"><div class="empty">…</div></div>
<script>
const TOKEN = ${tokenJson};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
const gb = (n) => n == null ? '—' : (n / 1073741824).toFixed(1) + ' GiB';
function render(d) {
  document.getElementById('sub').textContent = 'updated ' + new Date(d.generatedAt).toLocaleTimeString();
  const root = document.getElementById('root');
  const parts = [];
  for (const s of d.servers || []) {
    parts.push('<div class="card' + (s.status !== 'online' ? ' offline' : '') + '"><div class="srv-head"><i class="dot ' + esc(s.status) + '"></i><b>' + esc(s.name) + '</b><span class="cpu">' + (s.cpu == null ? '' : 'CPU ' + s.cpu.toFixed(0) + '%') + (s.memTotal ? ' · RAM ' + pct(s.memUsed || 0, s.memTotal) + '%' : '') + '</span></div>');
    if (s.status !== 'online') parts.push('<div class="empty">offline</div>');
    for (const g of s.gpus || []) {
      const up = pct(g.util || 0, 100), mp = pct(g.memUsed || 0, g.memTotal || 0);
      parts.push('<div class="gpu"><div class="name"><span>GPU ' + esc(g.index) + ' · ' + esc(g.name) + '</span><span>' + (g.temp != null ? g.temp + '°C · ' : '') + up + '%</span></div>' +
        '<div class="bar' + (up > 90 ? ' hot' : '') + '"><i style="width:' + up + '%"></i></div>' +
        '<div class="bar mem"><i style="width:' + mp + '%"></i></div>' +
        '<div class="meta">' + gb(g.memUsed) + ' / ' + gb(g.memTotal) + '</div></div>');
    }
    parts.push('</div>');
  }
  const active = (d.transfers || []).filter((t) => t.active);
  parts.push('<div class="card"><h2>Transfers</h2>' + (active.length ? active.map((t) => '<div class="xfer"><span class="name">' + esc(t.name) + '</span><span class="meta">' + Math.round(t.percent || 0) + '%</span></div>').join('') : '<div class="empty">none</div>') + '</div>');
  parts.push('<div class="card"><h2>Recent events</h2>' + ((d.events || []).length ? (d.events || []).map((e) => '<div class="evt"><span class="txt">' + esc(e.title) + (e.body ? ' — ' + esc(e.body) : '') + '</span><time>' + new Date(e.at).toLocaleTimeString() + '</time></div>').join('') : '<div class="empty">none</div>') + '</div>');
  root.innerHTML = parts.join('');
}
async function tick() {
  try {
    const r = await fetch('/status.json?token=' + encodeURIComponent(TOKEN));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    render(await r.json());
  } catch (e) {
    document.getElementById('sub').textContent = 'connection lost, retrying…';
  }
}
tick(); setInterval(tick, 5000);
</script></body></html>`;
  }
}

module.exports = { StatusServer };
