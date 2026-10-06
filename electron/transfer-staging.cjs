const fs = require('node:fs');
const path = require('node:path');
const { StageJournal } = require('./stage-journal.cjs');
const { serializeTask, migrateTask } = require('./task-store.cjs');
const { uploadPart } = require('./safe-files.cjs');

class TransferStaging {
  constructor(manager, endpointIdentity) {
    this.manager = manager;
    this.endpointIdentity = endpointIdentity || ((id) => `server:${id}`);
    this.journal = new StageJournal(manager.storeFile ? manager.storeFile + '.staging.json' : null);
    this.busy = new Set();
    this.lastAttempt = new Map();
  }

  restore() {
    const m = this.manager;
    for (const entry of this.journal.list()) {
      let task = m.tasks.get(entry.taskId);
      if (!task && entry.recovery?.id === entry.taskId) {
        task = migrateTask(entry.recovery);
        task.status = entry.disposition === 'cleanup' ? 'canceled' : 'paused';
        m.tasks.set(task.id, task);
      }
      if (!task) continue;
      const key = entry.side === 'local' ? 'stagedDownloads' : 'stagedUploads';
      task[key] = [...new Set([...(task[key] || []), entry.path])];
      if (entry.disposition === 'cleanup') task.status = 'canceled';
    }
  }

  async stage(task, key, staged, target, connection) {
    const side = key === 'stagedDownloads' ? 'local' : 'remote';
    const serverId = side === 'remote' ? (task.kind === 'relay' ? task.peerId : task.serverId) : undefined;
    const endpoint = side === 'remote' ? this.endpointIdentity(serverId, connection) : undefined;
    if (side === 'remote' && endpoint !== this.endpointIdentity(serverId)) throw new Error('Server identity changed during transfer setup');
    await this.journal.register({ taskId: task.id, side, serverId,
      endpoint,
      path: staged, target, recovery: serializeTask(task, this.manager.pub(task)) });
    task[key] = [...new Set([...(task[key] || []), staged])];
    this.manager.saveSoon();
  }

  async unstage(task, key, staged) {
    const entry = this.journal.list().find((e) => e.taskId === task.id && e.path === staged);
    if (entry) await this.journal.forget(entry);
    task[key] = (task[key] || []).filter((item) => item !== staged);
  }

  // Import only task-owned paths recorded by the previous version, bounded to its destination.
  async adopt(task) {
    for (const key of ['stagedDownloads', 'stagedUploads']) {
      const local = key === 'stagedDownloads';
      const root = local ? task.dstLocal : task.dstRemote;
      if (!root) continue;
      const p = local ? path : path.posix;
      for (const staged of task[key] || []) {
        if (this.journal.list().some((e) => e.taskId === task.id && e.path === staged)) continue;
        if (!local) throw new Error('Older staging record has no server identity. Inspect it on the original server before removing it manually');
        const target = staged.slice(0, -uploadPart('', task.id).length);
        const rel = p.relative(p.resolve(root), p.resolve(target));
        if (staged !== uploadPart(target, task.id) || (rel && (rel === '..' || rel.startsWith('..' + p.sep) || p.isAbsolute(rel)))) {
          throw new Error('Unrecognized staging ownership; inspect the file manually');
        }
        await this.stage(task, key, staged, target);
      }
    }
  }

  async erase(entry) {
    const m = this.manager;
    if (this.busy.has(this.journal.key(entry))) return false;
    this.busy.add(this.journal.key(entry));
    try {
      if (entry.side === 'local') await fs.promises.unlink(entry.path);
      else {
        if (this.endpointIdentity(entry.serverId) !== entry.endpoint) throw new Error('Server identity changed; staging cleanup needs the original server');
        const connection = await m._conn(entry.serverId);
        if (this.endpointIdentity(entry.serverId, connection) !== entry.endpoint) throw new Error('Connection identity does not match staging ownership');
        const sftp = await connection.sftp();
        // Recheck after asynchronous connection setup so a changed config cannot redirect deletion.
        if (this.endpointIdentity(entry.serverId) !== entry.endpoint) throw new Error('Server identity changed during cleanup');
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Staging cleanup timed out')), 10000);
          sftp.unlink(entry.path, (error) => { clearTimeout(timer); if (error) reject(error); else resolve(); });
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 2) {
        const task = m.tasks.get(entry.taskId);
        if (task) { task.error = 'Could not remove temporary transfer file: ' + error.message; m.emit(task); }
        return false;
      }
    } finally { this.busy.delete(this.journal.key(entry)); }
    await this.journal.forget(entry);
    const task = m.tasks.get(entry.taskId);
    if (task) {
      const key = entry.side === 'local' ? 'stagedDownloads' : 'stagedUploads';
      task[key] = (task[key] || []).filter((item) => item !== entry.path);
      m.emit(task);
    }
    return true;
  }

  async cleanup(task) {
    try {
      await this.adopt(task);
      await this.journal.markCleanup(task.id);
      let success = true;
      for (const entry of this.journal.list().filter((e) => e.taskId === task.id)) {
        if (!await this.erase(entry)) success = false;
      }
      return success;
    } catch (error) { task.error = 'Could not record staging cleanup: ' + error.message; return false; }
  }

  /** @param {{serverId?: string, localOnly?: boolean}} [options] */
  async collect({ serverId, localOnly = false } = {}) {
    if (this.journal.error) return;
    for (const entry of this.journal.list()) {
      const task = this.manager.tasks.get(entry.taskId);
      if (entry.disposition !== 'cleanup' || task?._gate || task?._cleaning) continue;
      if (localOnly && entry.side !== 'local') continue;
      if (serverId && (entry.side !== 'remote' || entry.serverId !== serverId)) continue;
      const key = this.journal.key(entry);
      if (Date.now() - (this.lastAttempt.get(key) || 0) < 30000) continue;
      this.lastAttempt.set(key, Date.now());
      try { await this.erase(entry); } catch (error) {
        if (task) { task.error = 'Staging journal update failed: ' + error.message; this.manager.emit(task); }
      }
      if (!this.journal.list().some((e) => this.journal.key(e) === key)) this.lastAttempt.delete(key);
    }
  }
}

module.exports = { TransferStaging };
