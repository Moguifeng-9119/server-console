const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
const cleanText = (value, limit = 4096) => String(value ?? '').replace(/\0/g, '').slice(0, limit);
const validId = (value) => { const id = String(value || ''); if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid item ID'); return id; };
const jobId = (value) => { const id = String(value || ''); if (!/^\d{1,15}(?:_\d{1,10})?$/.test(id)) throw new Error('Invalid Slurm job ID'); return id; };
const remotePath = (value) => { const result = cleanText(value, 4096); if (!result.startsWith('/') || /[\r\n]/.test(result)) throw new Error('An absolute remote path is required'); return result; };
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Export only configuration; credentials and secret-like assignments are omitted. */
function redact(value, key = '', depth = 0) {
  if (depth > 12) return undefined;
  if (/password|passphrase|private.?key|keycontent|token|authorization|cookie|secret|credential|webhook|environment|api.?key|access.?key|^env$/i.test(key)) return undefined;
  if (Array.isArray(value)) return value.slice(0, 2000).map((item) => redact(item, '', depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => !['__proto__', 'constructor', 'prototype'].includes(name)).flatMap(([name, item]) => { const result = redact(item, name, depth + 1); return result === undefined ? [] : [[name, result]]; }));
  if (typeof value === 'string') return value.slice(0, 65536)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/\b(?:Bearer\s+|sk-[A-Za-z0-9_-]{8,})[^\s'";]*/gi, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[_-]?key|access[_-]?key)(\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, '$1$2[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

const publicServer = (server) => Object.fromEntries(['id', 'name', 'host', 'port', 'username', 'authType', 'keyPath', 'sshAlias', 'group', 'tags', 'color', 'notes'].flatMap((key) => server[key] === undefined ? [] : [[key, redact(server[key], key)]]));
function webhookUrl(value) {
  let url; try { url = new URL(String(value)); } catch { throw new Error('Invalid webhook URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Webhook must use HTTPS without URL credentials');
  return url;
}
function sendWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = https.request(url, { method: 'POST', timeout: 8000, headers: { 'content-type': 'application/json', 'content-length': body.length } }, (response) => {
      response.resume();
      if (response.statusCode >= 200 && response.statusCode < 300) resolve({ delivered: true });
      else reject(new Error('Webhook rejected the notification (' + response.statusCode + ')'));
    });
    request.on('timeout', () => request.destroy(new Error('Webhook timed out')));
    request.on('error', () => reject(new Error('Webhook delivery failed')));
    request.end(body);
  });
}

class ProductivityManager {
  constructor({ directory, getServers = () => [], getConnection, exportState = () => ({}), importState = /** @type {(state:any)=>Promise<void | (()=>void | Promise<void>)>} */ (async (_state) => {}), now = Date.now, deliver = sendWebhook }) {
    this.file = path.join(directory, 'productivity.json'); this.getServers = getServers; this.getConnection = getConnection;
    this.exportState = exportState; this.importState = importState; this.now = now; this.deliver = deliver;
    /** @type {{ version: number, workspaces: any[], notification: any }} */
    this.data = { version: 1, workspaces: [], notification: { enabled: false, url: '', types: ['rule-triggered', 'rule-recovered', 'gpu-available', 'task-finished', 'log-hit'], cooldownMs: 60000 } };
    this.lastDelivered = new Map(); this.dispatching = new Set(); this.closed = false; this.importing = false;
  }
  init() {
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved.workspaces)) this.data.workspaces = saved.workspaces.slice(0, 1000);
      if (saved.notification && typeof saved.notification === 'object') this.data.notification = { ...this.data.notification, ...saved.notification };
    }
    return this;
  }
  persist(value = this.data) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temporary = this.file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, this.file); }
  commit(value) { if (this.importing) throw new Error('Configuration import is in progress'); this.persist(value); this.data = value; }
  close() { this.closed = true; }
  server(id) { if (!this.getServers().some((server) => server.id === id)) throw new Error('Unknown server'); return this.getConnection(id); }
  async exec(id, command) {
    if (this.closed) throw new Error('Productivity manager is closed');
    const connection = await this.server(id), result = await connection.exec(command, 15000);
    if (result.code !== 0 || result.signal) throw new Error(cleanText(redact(result.stderr || 'Remote operation failed'), 1000));
    if (Buffer.byteLength(result.stdout || '') > 2 * 1024 * 1024) throw new Error('Remote result exceeds 2 MiB');
    return result.stdout || '';
  }
  workspaceSave(value) {
    const serverId = validId(value.serverId); if (!this.getServers().some((server) => server.id === serverId)) throw new Error('Unknown server');
    const name = cleanText(value.name, 120).trim(); if (!name) throw new Error('Workspace name is required');
    const cwd = remotePath(value.cwd || '/');
    /** @type {any} */
    const item = { id: value.id ? validId(value.id) : crypto.randomUUID(), serverId, name, cwd, updatedAt: this.now() };
    for (const field of ['gpu', 'taskId', 'sessionName', 'logPath']) if (value[field]) item[field] = cleanText(value[field], field === 'logPath' ? 4096 : 200);
    for (const field of ['remotePort', 'localPort']) if (value[field] !== undefined && value[field] !== '') { const port = Number(value[field]); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid service port'); item[field] = port; }
    if (item.logPath) item.logPath = remotePath(item.logPath);
    const workspaces = [...this.data.workspaces], index = workspaces.findIndex((workspace) => workspace.id === item.id);
    if (index < 0) { if (workspaces.length >= 1000) throw new Error('Workspace limit reached'); workspaces.push(item); } else workspaces[index] = item;
    this.commit({ ...this.data, workspaces }); return clone(item);
  }
  async diagnostics(serverId) {
    const at = this.now();
    const output = await this.exec(serverId, "printf 'ssh=ok\\n'; for c in nvidia-smi rsync tmux squeue scontrol; do if command -v \"$c\" >/dev/null 2>&1; then printf '%s=available\\n' \"$c\"; else printf '%s=unavailable\\n' \"$c\"; fi; done; if test -r /proc/stat && test -r /proc/meminfo; then printf 'procfs=available\\n'; else printf 'procfs=unavailable\\n'; fi; if test -r /proc/driver/nvidia/version; then printf 'nvidiaDriver=available\\n'; fi; true");
    const checks = Object.fromEntries(output.trim().split(/\r?\n/).filter((line) => /^[A-Za-z-]+=(ok|available|unavailable)$/.test(line)).map((line) => line.split('=')));
    checks.sftp = 'unknown';
    const connection = await this.server(serverId);
    try { if (typeof connection.sftp === 'function') { await connection.sftp(); checks.sftp = 'available'; } } catch { checks.sftp = 'unavailable'; }
    return { serverId, at, elapsedMs: this.now() - at, checks, writesPerformed: false };
  }
  async slurmJobs(serverId) {
    const output = await this.exec(serverId, "command -v squeue >/dev/null 2>&1 || { printf '__SC_UNAVAILABLE__'; exit 0; }; squeue -h -o '%i|%j|%u|%T|%M|%l|%D|%R'");
    if (output.trim() === '__SC_UNAVAILABLE__') return { available: false, jobs: [] };
    return { available: true, jobs: output.trim().split(/\r?\n/).filter(Boolean).slice(0, 1000).map((line) => { const fields = line.split('|'); return { id: fields[0], name: fields[1], user: fields[2], state: fields[3], elapsed: fields[4], timeLimit: fields[5], nodes: fields[6], reason: fields.slice(7).join('|') }; }) };
  }
  async slurmDetail(serverId, id) {
    id = jobId(id);
    const output = await this.exec(serverId, 'scontrol show job -o ' + quote(id));
    const fields = Object.fromEntries([...output.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=(.*?)(?=\s[A-Za-z][A-Za-z0-9_]*=|$)/g)].map((match) => [match[1], match[2]]));
    return { id, fields: redact(fields), raw: redact(cleanText(output, 65536)) };
  }
  async slurmLog(serverId, id) {
    const detail = await this.slurmDetail(serverId, id);
    const logfile = remotePath(detail.fields.StdOut || '');
    return { id: detail.id, path: logfile, text: await this.exec(serverId, 'tail -c 131072 -- ' + quote(logfile)) };
  }
  notificationGet() { const { url, ...value } = this.data.notification; return { ...value, configured: Boolean(url), endpoint: url ? new URL(url).origin : '' }; }
  notificationSave(value) {
    const old = this.data.notification, url = value.url === undefined || value.url === '' ? old.url : webhookUrl(value.url).toString();
    if (value.enabled && !url) throw new Error('A webhook URL is required');
    const types = Array.isArray(value.types) ? [...new Set(value.types.map((type) => cleanText(type, 80)))].slice(0, 20) : old.types;
    const notification = { enabled: value.enabled === true, url, types, cooldownMs: Math.min(3600000, Math.max(10000, Number(value.cooldownMs) || 60000)) };
    this.commit({ ...this.data, notification }); return this.notificationGet();
  }
  async dispatchEvent(event, test = false) {
    const settings = this.data.notification;
    if (this.closed || !settings.enabled || !settings.url) return { delivered: false, reason: 'disabled' };
    if (!test && !settings.types.includes(event.type)) return { delivered: false, reason: 'type' };
    const key = test ? 'test' : cleanText(event.serverId, 100) + ':' + cleanText(event.type, 80);
    if (this.dispatching.has(key) || this.lastDelivered.has(key) && this.now() - this.lastDelivered.get(key) < settings.cooldownMs) return { delivered: false, reason: 'cooldown' };
    if (this.dispatching.size >= 4) return { delivered: false, reason: 'busy' };
    this.dispatching.add(key); this.lastDelivered.set(key, this.now());
    if (this.lastDelivered.size > 2000) this.lastDelivered.delete(this.lastDelivered.keys().next().value);
    try { return await this.deliver(webhookUrl(settings.url), { application: 'ServerConsole', event: redact({ type: cleanText(event.type, 80), serverId: cleanText(event.serverId, 100), title: cleanText(event.title, 240), body: cleanText(event.body, 4000), at: Number(event.at) || this.now() }) }); }
    finally { this.dispatching.delete(key); }
  }
  backupExport() {
    const supplied = this.exportState();
    const state = Object.fromEntries(['rules', 'watches', 'templates', 'layouts', 'preferences'].flatMap((key) => supplied[key] === undefined ? [] : [[key, redact(supplied[key], key)]]));
    return { format: 'serverconsole-config', version: 1, createdAt: this.now(), servers: this.getServers().map(publicServer), workspaces: clone(this.data.workspaces), state, credentialsIncluded: false, warning: 'Credentials are omitted. Review command templates and paths before sharing.' };
  }
  async backupImport(value, apply = false) {
    if (!value || value.format !== 'serverconsole-config' || value.version !== 1 || Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new Error('Invalid configuration backup');
    const servers = (Array.isArray(value.servers) ? value.servers : []).slice(0, 1000).map((server) => {
      const clean = publicServer(server); validId(clean.id);
      if (!clean.host || typeof clean.host !== 'string' || /[\s\0]/.test(clean.host) || clean.host.length > 253) throw new Error('Invalid backup host');
      if (clean.port !== undefined && (!Number.isInteger(clean.port) || clean.port < 1 || clean.port > 65535)) throw new Error('Invalid backup port');
      return clean;
    });
    const ids = new Set([...this.getServers().map((server) => server.id), ...servers.map((server) => server.id)]);
    const workspaces = (Array.isArray(value.workspaces) ? value.workspaces : []).slice(0, 1000).map((workspace) => {
      validId(workspace.id); validId(workspace.serverId); remotePath(workspace.cwd);
      if (!ids.has(workspace.serverId) || !cleanText(workspace.name, 120).trim()) throw new Error('Invalid backup workspace');
      const ports = {};
      for (const key of ['remotePort', 'localPort']) if (workspace[key] !== undefined) { const port = Number(workspace[key]); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid backup service port'); ports[key] = port; }
      if (workspace.logPath) remotePath(workspace.logPath);
      return { id: workspace.id, serverId: workspace.serverId, name: cleanText(workspace.name, 120), cwd: workspace.cwd, ...Object.fromEntries(['gpu', 'taskId', 'sessionName', 'logPath'].flatMap((key) => workspace[key] ? [[key, cleanText(workspace[key], 4096)]] : [])), ...ports, updatedAt: this.now() };
    });
    const supplied = value.state || {};
    const state = Object.fromEntries(['rules', 'watches', 'templates', 'layouts', 'preferences'].flatMap((key) => supplied[key] === undefined ? [] : [[key, redact(supplied[key], key)]]));
    // Restoring settings never enables remote execution, schedules, or notifications.
    for (const key of ['rules', 'watches', 'templates', 'tasks']) if (Array.isArray(state[key])) state[key] = state[key].map((item) => ({ ...item, enabled: false, schedule: undefined }));
    const preview = { servers: servers.length, workspaces: workspaces.length, sections: Object.keys(state), credentialsIncluded: false, applied: false };
    if (!apply) return preview;
    if (this.importing) throw new Error('Configuration import is in progress');
    const merged = new Map(this.data.workspaces.map((workspace) => [workspace.id, workspace]));
    for (const workspace of workspaces) merged.set(workspace.id, workspace);
    if (merged.size > 1000) throw new Error('Workspace limit reached');
    const previous = this.backupExport(), recoveryFile = path.join(path.dirname(this.file), 'configuration-before-import.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(recoveryFile, JSON.stringify(previous), { mode: 0o600 });
    this.importing = true;
    try {
      const rollback = await this.importState({ ...state, servers });
      try {
        const draft = { ...this.data, workspaces: [...merged.values()] };
        this.persist(draft); this.data = draft;
      } catch (error) {
        if (typeof rollback === 'function') {
          try { await rollback(); } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Configuration import failed and rollback could not be completed'); }
        }
        throw error;
      }
    } finally { this.importing = false; }
    return { ...preview, applied: true, recoveryAvailable: true };
  }
  supports(operation) { return ['workspaceList', 'workspaceSave', 'workspaceDelete', 'diagnostics', 'diagnosticsExport', 'slurmJobs', 'slurmDetail', 'slurmLog', 'notificationGet', 'notificationSave', 'notificationTest', 'backupExport', 'backupImport'].includes(operation); }
  async request(request) {
    switch (request.operation) {
      case 'workspaceList': return clone(this.data.workspaces.filter((item) => !request.serverId || item.serverId === request.serverId));
      case 'workspaceSave': return this.workspaceSave(request.workspace || request.value || request);
      case 'workspaceDelete': { const id = validId(request.id); this.commit({ ...this.data, workspaces: this.data.workspaces.filter((item) => item.id !== id) }); return true; }
      case 'diagnostics': return this.diagnostics(request.serverId);
      case 'diagnosticsExport': return { version: 1, at: this.now(), report: redact(await this.diagnostics(request.serverId)), application: 'ServerConsole', credentialsIncluded: false };
      case 'slurmJobs': return this.slurmJobs(request.serverId);
      case 'slurmDetail': return this.slurmDetail(request.serverId, request.jobId || request.id);
      case 'slurmLog': return this.slurmLog(request.serverId, request.jobId || request.id);
      case 'notificationGet': return this.notificationGet();
      case 'notificationSave': return this.notificationSave(request.settings || request.value || request);
      case 'notificationTest': return this.dispatchEvent({ type: 'test', title: 'ServerConsole test notification', body: 'Explicit notification test', at: this.now() }, true);
      case 'backupExport': return this.backupExport();
      case 'backupImport': return this.backupImport(request.backup || request.value, request.apply === true);
      default: throw new Error('Unknown productivity operation');
    }
  }
}

module.exports = { ProductivityManager, redact, publicServer, sendWebhook };
