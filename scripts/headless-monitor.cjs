const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { HistoryStore } = require('../electron/history-store.cjs');
const { GPU_CMD, parseGpuCsv } = require('../electron/monitoring/gpu-poller.cjs');
const { SYS_CMD, parseSystem } = require('../electron/monitoring/system-collector.cjs');
const run = promisify(execFile);

function normalizeConfig(value) {
  if (!value || !Array.isArray(value.servers) || !value.servers.length || value.servers.length > 100) throw new Error('Configure between 1 and 100 trusted SSH aliases');
  const ids = new Set();
  const servers = value.servers.map((server) => {
    const alias = String(server.alias || ''), id = String(server.id || alias);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(alias) || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate SSH alias/server ID');
    ids.add(id); return { id, alias, name: String(server.name || alias).slice(0, 120) };
  });
  const port = Number(value.port ?? 9187); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid listening port');
  const host = String(value.host || '127.0.0.1'); if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) throw new Error('Invalid listening host');
  return { servers, port, host, intervalMs: Math.max(5000, Math.min(60000, Number(value.intervalMs) || 10000)) };
}

function tokenMatches(header, token) {
  const supplied = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(), crypto.createHash('sha256').update(token).digest());
}

async function collectViaSSH(server) {
  const command = "printf '__SC_GPU__\\n'; " + GPU_CMD + "; printf '__SC_SYS__\\n'; " + SYS_CMD;
  const { stdout } = await run('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', server.alias, command], { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  const separator = stdout.indexOf('__SC_SYS__'); if (separator < 0) throw new Error('Unsupported SSH monitoring response');
  return { gpus: parseGpuCsv(stdout.slice(0, separator).replace('__SC_GPU__', '')), system: stdout.slice(separator + '__SC_SYS__'.length) };
}

async function createHeadlessMonitor({ config, token, directory, collect = collectViaSSH, history = null }) {
  const settings = normalizeConfig(config);
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('SC_MONITOR_TOKEN must contain at least 32 bytes');
  const store = history || new HistoryStore(directory, () => {}), snapshots = new Map(), previousCpu = new Map(), busy = new Set();
  let closing = false, activeQueries = 0, nextServer = 0;
  const poll = async () => {
    const ordered = settings.servers.slice(nextServer).concat(settings.servers.slice(0, nextServer));
    nextServer = (nextServer + 4) % settings.servers.length;
    for (const server of ordered) {
      if (closing || busy.size >= 4 || busy.has(server.id)) continue;
      busy.add(server.id);
      void (async () => {
        try {
          const response = await collect(server); if (closing) return;
          const system = parseSystem(response.system, previousCpu.get(server.id)); previousCpu.set(server.id, system.cpuSample);
          const snapshot = { ...system, id: server.id, name: server.name, status: 'online', gpus: response.gpus, collectedAt: Date.now() };
          snapshots.set(server.id, snapshot);
          try { await store.request('snapshot', snapshot); }
          catch { snapshots.set(server.id, { ...snapshot, historyStatus: 'error' }); }
        } catch {
          if (!closing) { const at = Date.now(); snapshots.set(server.id, { id: server.id, name: server.name, status: 'error', gpus: [], collectedAt: at }); previousCpu.delete(server.id); await store.request('gap', { server: server.id, at }).catch(() => {}); }
        } finally { busy.delete(server.id); }
      })();
    }
  };
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); };
    if (!tokenMatches(request.headers.authorization, token)) { send(401, { error: 'Authentication required' }); return; }
    if (request.method !== 'GET') { send(405, { error: 'Read-only API' }); return; }
    if (!request.url || request.url.length > 4096) { send(400, { error: 'Invalid request' }); return; }
    if (activeQueries >= 16) { send(429, { error: 'Query limit reached' }); return; }
    activeQueries++;
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/servers') { send(200, settings.servers.map((host) => snapshots.get(host.id) || { id: host.id, name: host.name, status: 'connecting', gpus: [] })); return; }
      if (url.pathname === '/api/history') {
        const id = url.searchParams.get('serverId'), range = Number(url.searchParams.get('rangeMs') || 3600000);
        if (!settings.servers.some((host) => host.id === id) || ![1800000, 3600000, 43200000, 86400000, 7 * 86400000].includes(range)) { send(400, { error: 'Invalid history range/server' }); return; }
        const at = Date.now(), device = String(url.searchParams.get('device') || 'all').slice(0, 200), metric = String(url.searchParams.get('metric') || 'util').slice(0, 100);
        send(200, await store.request('query', { serverId: id, device, metric, rangeMs: range, end: at })); return;
      }
      send(404, { error: 'Unknown endpoint' });
    } catch { send(500, { error: 'Monitoring query failed' }); }
    finally { activeQueries--; }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 32;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(settings.port, settings.host, () => { server.removeListener('error', reject); resolve(true); }); }); }
  catch (error) { await store.close(); throw error; }
  const timer = setInterval(() => void poll(), settings.intervalMs); timer.unref(); await poll();
  return { server, poll, snapshots, async close() { closing = true; clearInterval(timer); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); const end = Date.now() + 21000; while (busy.size && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25)); await store.close(); } };
}

if (require.main === module) {
  const configPath = process.argv[2], directory = process.argv[3];
  if (!configPath || !directory) { process.stderr.write('Usage: node scripts/headless-monitor.cjs config.json /absolute/data-directory\n'); process.exitCode = 1; }
  else if (!path.isAbsolute(directory)) { process.stderr.write('Data directory must be absolute\n'); process.exitCode = 1; }
  else {
    Promise.resolve().then(async () => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const monitor = await createHeadlessMonitor({ config, directory, token: process.env.SC_MONITOR_TOKEN });
      process.stdout.write('Headless monitoring listening at ' + (config.host || '127.0.0.1') + ':' + monitor.server.address().port + '\n');
      let stopping = false; const stop = () => { if (stopping) return; stopping = true; void monitor.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    }).catch((error) => { process.stderr.write(String(error.message || error) + '\n'); process.exitCode = 1; });
  }
}
module.exports = { createHeadlessMonitor, normalizeConfig, tokenMatches };
