const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid relative sync path');
  return value;
}
function exclusion(patterns) {
  if (!Array.isArray(patterns) || patterns.length > 100) throw new Error('At most 100 exclusion patterns are allowed');
  const expressions = patterns.map((pattern) => {
    if (typeof pattern !== 'string' || pattern.length > 200 || pattern.includes('..')) throw new Error('Invalid exclusion pattern');
    const clean = pattern.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const source = clean.split('**').map((segment) => segment.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
    return new RegExp(`(?:^|/)${source}(?:/|$)`);
  });
  return (relative) => expressions.some((expression) => expression.test(relative));
}
const same = (a, b) => a && b && a.type === b.type && a.size === b.size && Math.abs(a.mtime - b.mtime) < 1500;
const endpoint = (cfg) => JSON.stringify([cfg.host, cfg.port || 22, cfg.username, cfg.proxyJump || '']);
const exact = (a, b) => a && b && a.type === b.type && a.size === b.size && Math.abs(a.mtime - b.mtime) < 1;
const localOverlap = (a, b) => { const relative = path.relative(a, b); return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
const remoteOverlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
function windowsName(relative) {
  if (relative.split('/').some((name) => /[<>:"|?*]/.test(name) || [...name].some((ch) => ch.charCodeAt(0) < 32) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) throw new Error('Remote filename cannot be represented safely on Windows: ' + relative);
}

class SyncPlanner {
  constructor({ directory, getConnection, getServers, transfers, now = Date.now, platform = process.platform, maxEntries = 10000 }) {
    this.file = path.join(directory, 'sync-runs.json');
    this.getConnection = getConnection; this.getServers = getServers; this.transfers = transfers; this.now = now;
    this.plans = new Map(); this.runs = []; this.working = false; this.platform = platform; this.maxEntries = maxEntries;
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(saved)) throw new Error('Invalid sync recovery journal');
      const liveTasks = new Map(this.transfers.list().map((task) => [task.id, task.status]));
      const active = (run) => ['copying', 'deleting'].includes(run.status) || run.preparing || (run.taskIds || []).some((id) => liveTasks.has(id) && !['done', 'error', 'canceled'].includes(liveTasks.get(id)));
      this.runs = saved.filter(active).concat(saved.filter((run) => !active(run)).slice(-30));
      for (const run of this.runs) if (run.preparing) { run.status = 'error'; run.error = 'Sync preparation was interrupted; create a new preview. Deletions were not started.'; }
    }
    this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref?.();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.runs), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  cfg(id) { const cfg = this.getServers().find((item) => item.id === id); if (!cfg) throw new Error('Server no longer exists'); return cfg; }
  async scan(request) {
    const cfg = this.cfg(request.serverId), conn = await this.getConnection(cfg.id);
    if (!['upload', 'download'].includes(request.direction)) throw new Error('Invalid sync direction');
    if (!path.isAbsolute(request.localDir || '') || !path.posix.isAbsolute(request.remoteDir || '')) throw new Error('Choose absolute local and remote directories');
    const localDir = await fs.promises.realpath(request.localDir), remoteInput = path.posix.normalize(request.remoteDir);
    const sftp = await conn.sftp();
    const remoteDir = await new Promise((resolve, reject) => sftp.realpath(remoteInput, (error, result) => error ? reject(error) : resolve(result)));
    if (localDir === path.parse(localDir).root || remoteDir === '/' || remoteDir.includes('\0')) throw new Error('A filesystem root cannot be used as a sync directory');
    const exclude = request.exclude || [], skip = exclusion(exclude), skipped = [], local = new Map(), remote = new Map(); let count = 0;
    const limit = () => { if (++count > this.maxEntries) throw new Error('Sync preview entry limit exceeded; choose a smaller directory or exclusions'); };
    const walkLocal = async (base, prefix = '') => {
      for (const entry of await fs.promises.readdir(base, { withFileTypes: true })) {
        const relative = prefix ? prefix + '/' + entry.name : entry.name; safeRelative(relative); limit();
        if (skip(relative)) continue;
        if (entry.isSymbolicLink()) { skipped.push(relative + ' (local symlink)'); continue; }
        const absolute = path.join(base, entry.name), stat = await fs.promises.lstat(absolute);
        if (stat.isDirectory()) { local.set(relative, { type: 'dir', size: 0, mtime: stat.mtimeMs }); await walkLocal(absolute, relative); }
        else if (stat.isFile()) local.set(relative, { type: 'file', size: stat.size, mtime: stat.mtimeMs });
      }
    };
    const walkRemote = async (base, prefix = '') => {
      const listing = await conn.listDir(base);
      for (const entry of listing.entries) {
        if (['.', '..'].includes(entry.name)) continue;
        const relative = prefix ? prefix + '/' + entry.name : entry.name; safeRelative(relative); limit();
        if (skip(relative)) continue;
        if (entry.type === 'link') { skipped.push(relative + ' (remote symlink)'); continue; }
        if (!['file', 'dir'].includes(entry.type)) continue;
        remote.set(relative, { type: entry.type, size: entry.type === 'dir' ? 0 : entry.size, mtime: entry.mtime });
        if (entry.type === 'dir') await walkRemote(path.posix.join(base, entry.name), relative);
      }
    };
    await walkLocal(localDir); await walkRemote(remoteDir);
    if (request.direction === 'download' && this.platform === 'win32') {
      const names = new Map();
      for (const relative of [...local.keys(), ...remote.keys()]) {
        windowsName(relative);
        const key = relative.normalize('NFC').toLowerCase(), prior = names.get(key);
        if (prior && prior !== relative) throw new Error(`Windows filename collision: ${prior} / ${relative}`);
        names.set(key, relative);
      }
    }
    // A skipped symlink blocks its entire subtree on both sides.
    const blocked = skipped.map((item) => item.replace(/ \((local|remote) symlink\)$/, ''));
    for (const tree of [local, remote]) for (const key of tree.keys()) if (blocked.some((item) => key === item || key.startsWith(item + '/'))) tree.delete(key);
    const source = request.direction === 'upload' ? local : remote, target = request.direction === 'upload' ? remote : local;
    const changes = []; let unchanged = 0;
    for (const [relative, item] of source) {
      const existing = target.get(relative);
      if (existing && existing.type !== item.type) throw new Error(`File/directory conflict: ${relative}`);
      if (item.type === 'dir') { if (!existing) changes.push({ path: relative, action: 'add', size: 0, directory: true }); continue; }
      if (!existing) changes.push({ path: relative, action: 'add', size: item.size });
      else if (!same(item, existing)) changes.push({ path: relative, action: 'update', size: item.size });
      else unchanged++;
    }
    if (request.deleteExtraneous) for (const [relative, item] of target) if (!source.has(relative) && item.type === 'file') changes.push({ path: relative, action: 'delete', size: item.size });
    return { cfg, conn, localDir, remoteDir, exclude, changes, skipped, unchanged, local, remote };
  }
  async preview(request) {
    const scan = await this.scan(request);
    const plan = { id: crypto.randomUUID(), serverId: scan.cfg.id, localDir: scan.localDir, remoteDir: scan.remoteDir, direction: request.direction, exclude: scan.exclude,
      deleteExtraneous: !!request.deleteExtraneous, createdAt: this.now(), changes: scan.changes, skipped: scan.skipped, unchanged: scan.unchanged };
    for (const [id, saved] of this.plans) if (this.now() - saved.plan.createdAt > 600000) this.plans.delete(id);
    if (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value);
    this.plans.set(plan.id, { plan, identity: endpoint(scan.cfg), local: [...scan.local], remote: [...scan.remote] });
    return plan;
  }
  async apply(planId) {
    const stored = this.plans.get(planId);
    if (!stored || this.now() - stored.plan.createdAt > 600000) throw new Error('Sync preview expired; preview again');
    const { plan } = stored, fresh = await this.scan(plan);
    if (endpoint(fresh.cfg) !== stored.identity || JSON.stringify([...fresh.local]) !== JSON.stringify(stored.local) || JSON.stringify([...fresh.remote]) !== JSON.stringify(stored.remote)) throw new Error('Directory contents changed since preview; preview again');
    const taskStates = new Map(this.transfers.list().map((task) => [task.id, task.status]));
    const stillWriting = (run) => ['copying', 'deleting'].includes(run.status) || run.taskIds.some((id) => taskStates.has(id) && !['done', 'error', 'canceled'].includes(taskStates.get(id)));
    if (this.runs.some((run) => stillWriting(run) && (
      (plan.direction === 'download' || run.plan.direction === 'download') && (localOverlap(run.plan.localDir, plan.localDir) || localOverlap(plan.localDir, run.plan.localDir)) ||
      run.identity === stored.identity && (plan.direction === 'upload' || run.plan.direction === 'upload') && remoteOverlap(run.plan.remoteDir, plan.remoteDir)))) throw new Error('Another sync is active for an overlapping directory');
    const run = { id: plan.id, serverId: plan.serverId, status: 'copying', preparing: true, createdAt: this.now(), taskIds: [], copies: [], deleted: 0, plan, identity: stored.identity,
      deletions: plan.changes.filter((item) => item.action === 'delete').map((item) => ({ ...item, expected: (plan.direction === 'upload' ? fresh.remote : fresh.local).get(item.path) })) };
    this.runs = this.runs.filter(stillWriting).concat(this.runs.filter((item) => !stillWriting(item)).slice(-20), run); this.save();
    try {
      for (const item of plan.changes.filter((change) => change.action !== 'delete')) {
        const local = path.join(plan.localDir, ...safeRelative(item.path).split('/')), remote = path.posix.join(plan.remoteDir, item.path);
        if (item.directory) { if (plan.direction === 'upload') await fresh.conn.mkdirpRemote(remote); else await fs.promises.mkdir(local, { recursive: true }); continue; }
        const job = plan.direction === 'upload' ? { kind: 'upload', serverId: plan.serverId, srcLocal: local, dstRemote: remote, name: item.path, size: item.size, groupId: run.id }
          : { kind: 'download', serverId: plan.serverId, srcRemote: remote, dstLocal: local, name: item.path, size: item.size, groupId: run.id };
        const added = this.transfers.addMany([job]);
        if (added.length !== 1) throw new Error('Sync transfer was not queued');
        run.taskIds.push(added[0].id); run.copies.push({ id: added[0].id, path: item.path, source: (plan.direction === 'upload' ? fresh.local : fresh.remote).get(item.path), preserved: false }); this.save();
      }
      run.preparing = false; this.save(); this.plans.delete(planId); await this.tick(); return this.publicRun(run);
    } catch (error) { run.status = 'error'; run.error = String(error.message || error); this.save(); throw error; }
  }
  publicRun(run) { const { plan: _plan, deletions: _deletions, copies: _copies, identity: _identity, preparing: _preparing, ...info } = run; return info; }
  list() { return this.runs.map((run) => this.publicRun(run)); }
  async preserveTimes(run, tasks, conn) {
    const plan = run.plan, sftp = await conn.sftp();
    for (const copy of run.copies || []) {
      if (copy.preserved) continue;
      const relative = safeRelative(copy.path), local = path.join(plan.localDir, ...relative.split('/')), remote = path.posix.join(plan.remoteDir, relative);
      const localParent = await fs.promises.realpath(path.dirname(local));
      if (!localOverlap(plan.localDir, localParent)) throw new Error('Sync file escaped local directory');
      const remoteParent = await new Promise((resolve, reject) => sftp.realpath(path.posix.dirname(remote), (error, value) => error ? reject(error) : resolve(value)));
      if (remoteParent !== plan.remoteDir && !remoteParent.startsWith(plan.remoteDir + '/')) throw new Error('Sync file escaped remote directory');
      const localStat = await fs.promises.lstat(local);
      const remoteStat = await new Promise((resolve, reject) => sftp.lstat(remote, (error, value) => error ? reject(error) : resolve(value)));
      if (!localStat.isFile() || localStat.isSymbolicLink() || (remoteStat.mode & 0o170000) !== 0o100000) throw new Error('Sync file changed type: ' + relative);
      const localInfo = { type: 'file', size: localStat.size, mtime: localStat.mtimeMs }, remoteInfo = { type: 'file', size: remoteStat.size, mtime: remoteStat.mtime * 1000 };
      const source = plan.direction === 'upload' ? localInfo : remoteInfo, destination = plan.direction === 'upload' ? remoteInfo : localInfo;
      if (!exact(copy.source, source) || destination.size !== source.size) throw new Error('Sync source or destination changed: ' + relative);
      const task = tasks.get(copy.id);
      const committed = task.completedDestination;
      if (!committed) throw new Error('Sync completion metadata is unavailable; preview again before deleting files');
      const sameIdentity = plan.direction === 'upload' || committed.ino === localStat.ino && committed.dev === localStat.dev;
      // A persisted intent permits recovery after utimes committed but before
      // the journal acknowledgement. Otherwise require the original commit.
      const recoveredIntent = copy.preserving && same(source, destination);
      if (!sameIdentity || !exact({ type: 'file', ...committed }, destination) && !recoveredIntent) throw new Error('Sync destination changed after copy: ' + relative);
      copy.preserving = true; this.save();
      if (plan.direction === 'upload') await new Promise((resolve, reject) => sftp.utimes(remote, remoteStat.atime || remoteStat.mtime, source.mtime / 1000, (error) => error ? reject(error) : resolve()));
      else await fs.promises.utimes(local, localStat.atime, new Date(source.mtime));
      const finalSource = plan.direction === 'upload' ? await fs.promises.lstat(local) : await new Promise((resolve, reject) => sftp.lstat(remote, (error, value) => error ? reject(error) : resolve(value)));
      const sourceInfo = { type: 'file', size: finalSource.size, mtime: plan.direction === 'upload' ? finalSource.mtimeMs : finalSource.mtime * 1000 };
      if (!exact(copy.source, sourceInfo)) throw new Error('Sync source changed during metadata commit: ' + relative);
      copy.preserved = true; this.save();
    }
  }
  async tick() {
    if (this.working) return; this.working = true;
    try {
      for (const run of this.runs.filter((item) => ['copying', 'deleting'].includes(item.status))) {
        if (run.preparing) continue;
        try {
          if (endpoint(this.cfg(run.serverId)) !== run.identity) throw new Error('Sync server configuration changed');
          const tasks = new Map(this.transfers.list().map((task) => [task.id, task]));
          const states = run.taskIds.map((id) => tasks.get(id)?.status);
          if (states.some((state) => !state || ['error', 'canceled'].includes(state))) throw new Error('A sync transfer failed or was removed; deletions were stopped');
          if (states.some((state) => state !== 'done')) continue;
          const conn = await this.getConnection(run.serverId), plan = run.plan;
          await this.preserveTimes(run, tasks, conn);
          run.status = 'deleting'; this.save();
          for (; run.deleted < run.deletions.length; run.deleted++) {
            const deletion = run.deletions[run.deleted], relative = safeRelative(deletion.path);
            if (plan.direction === 'upload') {
              const absolute = path.posix.join(plan.remoteDir, relative), sftp = await conn.sftp();
              const parent = await new Promise((resolve, reject) => sftp.realpath(path.posix.dirname(absolute), (e, result) => e ? reject(e) : resolve(result)));
              if (parent !== plan.remoteDir && !parent.startsWith(plan.remoteDir + '/')) throw new Error('Sync deletion escaped remote directory');
              const stat = await new Promise((resolve, reject) => sftp.lstat(absolute, (e, result) => e?.code === 2 ? resolve(null) : e ? reject(e) : resolve(result)));
              if (stat) {
                if ((stat.mode & 0o170000) !== 0o100000 || !same(deletion.expected, { type: 'file', size: stat.size, mtime: stat.mtime * 1000 })) throw new Error(`Sync deletion target changed: ${relative}`);
                await new Promise((resolve, reject) => sftp.unlink(absolute, (e) => e ? reject(e) : resolve()));
              }
            } else {
              const absolute = path.resolve(plan.localDir, ...relative.split('/')), parent = await fs.promises.realpath(path.dirname(absolute));
              const fromRoot = path.relative(plan.localDir, parent);
              if (path.isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + path.sep)) throw new Error('Sync deletion escaped local directory');
              const stat = await fs.promises.lstat(absolute).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
              if (stat) { if (!stat.isFile() || stat.isSymbolicLink() || !same(deletion.expected, { type: 'file', size: stat.size, mtime: stat.mtimeMs })) throw new Error(`Sync deletion target changed: ${relative}`); await fs.promises.unlink(absolute); }
            }
            this.save();
          }
          run.status = 'done'; this.save();
        } catch (error) { run.status = 'error'; run.error = String(error.message || error); this.save(); }
      }
    } finally { this.working = false; }
  }
  close() { clearInterval(this.timer); this.save(); }
}
module.exports = { SyncPlanner, safeRelative, exclusion };
