// Exact, durable ownership for direct-transfer keys. Never sweep another session.
const fs = require('node:fs');
const { StageJournal } = require('./stage-journal.cjs');
const lang = require('./lang.cjs');
const { serializeTask, migrateTask, canResume } = require('./task-store.cjs');
const q = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
const keyCommand = (command) => `(test -d ~/.ssh || (umask 077; mkdir ~/.ssh)) && (umask 077; flock -x ~/.ssh/.serverconsole-keys.lock sh -c ${q(command)})`;

function valid(entry, owner) {
  return entry && entry.owner === owner && typeof entry.taskId === 'string'
    && /^sckey-[a-f0-9]{8}$/.test(entry.tag) && entry.path === '/tmp/.' + entry.tag
    && entry.side === 'direct' && ['retain', 'cleanup'].includes(entry.disposition)
    && typeof entry.serverId === 'string' && typeof entry.peerId === 'string'
    && /^[a-f0-9]{64}$/.test(entry.endpoint) && /^[a-f0-9]{64}$/.test(entry.peerEndpoint)
    && (!entry.recovery || entry.recovery.id === entry.taskId && entry.recovery.kind === 'relay'
      && entry.recovery.serverId === entry.serverId && entry.recovery.peerId === entry.peerId && canResume(entry.recovery))
    && (!entry.publicKey || /^ssh-ed25519 [A-Za-z0-9+/=]+ sckey-[a-f0-9]{8}$/.test(entry.publicKey)
      && entry.publicKey.endsWith(' ' + entry.tag));
}

class DirectJournal extends StageJournal {
  constructor(file) {
    super(null);
    this.file = file;
    try {
      if (!file) return;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || typeof data.owner !== 'string' || !Array.isArray(data.entries)
        || data.entries.some((entry) => !valid(entry, data.owner))) throw new Error('Invalid direct ownership manifest');
      this.owner = data.owner;
      for (const entry of data.entries) this.entries.set(this.key(entry), entry);
    } catch (error) {
      if (error.code !== 'ENOENT') this.error = 'Cannot read direct ownership journal: ' + error.message;
    }
    this.loadError = this.error;
  }
}

class DirectResources {
  constructor(manager) {
    this.manager = manager;
    this.journal = new DirectJournal(manager.storeFile ? manager.storeFile + '.direct.json' : null);
    this.restored = new Set(this.journal.list().map((entry) => entry.tag));
    this.busy = new Set();
    for (const entry of this.journal.list()) {
      if (entry.recovery && !manager.tasks.has(entry.taskId)) {
        const task = migrateTask(entry.recovery);
        task.status = 'paused';
        manager.tasks.set(task.id, task);
      }
    }
  }
  async register(task, source, destination, tag) {
    if (!this.journal.file) throw new Error('Direct transfers need a durable ownership journal');
    const identity = this.manager.staging.endpointIdentity;
    const entry = { owner: this.journal.owner, taskId: task.id, side: 'direct', serverId: task.serverId,
      peerId: task.peerId, endpoint: identity(task.serverId, source), peerEndpoint: identity(task.peerId, destination),
      tag, path: '/tmp/.' + tag, disposition: 'retain', at: Date.now() };
    if (task.kind === 'relay' && canResume(task)) entry.recovery = serializeTask(task, this.manager.pub(task));
    if (!valid(entry, this.journal.owner)) throw new Error('Invalid direct-transfer ownership');
    await this.journal.mutate((entries) => entries.set(this.journal.key(entry), entry));
    return entry;
  }
  async recordPublicKey(entry, publicKey) {
    const next = { ...entry, publicKey };
    if (!valid(next, this.journal.owner)) throw new Error('Invalid direct-transfer public key');
    await this.journal.mutate((entries) => entries.set(this.journal.key(entry), next));
    return next;
  }
  async connection(entry, destination) {
    const id = destination ? entry.peerId : entry.serverId;
    const expected = destination ? entry.peerEndpoint : entry.endpoint;
    const identity = this.manager.staging.endpointIdentity;
    if (identity(id) !== expected) throw new Error('Direct cleanup needs the original server identity');
    const conn = await this.manager._conn(id);
    if (identity(id) !== expected || identity(id, conn) !== expected) throw new Error('Direct cleanup connection identity changed');
    return conn;
  }
  async cleanup(entry) {
    if (this.busy.has(entry.tag)) return false;
    this.busy.add(entry.tag);
    try {
      await this.journal.markCleanup(entry.taskId);
      // Remove access before stopping the source process and deleting its private key.
      if (entry.publicKey) {
        const destination = await this.connection(entry, true);
        const pattern = entry.publicKey.replace(/\//g, '\\/');
        const body = `if test -f ~/.ssh/authorized_keys; then sed -i '/^${pattern}$/d' ~/.ssh/authorized_keys || exit $?; if grep -Fxq -- ${q(entry.publicKey)} ~/.ssh/authorized_keys; then exit 1; else rc=$?; test "$rc" -eq 1; fi; fi`;
        const result = await destination.exec(keyCommand(body), 10000);
        if (result.code !== 0 || result.signal) throw new Error('Cannot remove direct-transfer public key');
      }
      const source = await this.connection(entry, false);
      const directory = q(entry.path), owner = q(entry.owner);
      const ownership = await source.exec(`if test -e ${directory}; then test "$(cat ${directory}/owner 2>/dev/null)" = ${owner}; fi`, 10000);
      if (ownership.code !== 0 || ownership.signal) throw new Error('Direct scratch ownership does not match');
      // A combined shell command containing the literal directory would match its own pkill.
      const stopped = await source.exec(`pkill -f '[s]${entry.tag.slice(1)}'`, 10000);
      if (![0, 1].includes(stopped.code) || stopped.signal) throw new Error('Cannot stop owned direct-transfer process');
      const result = await source.exec(`if test -e ${directory}; then test "$(cat ${directory}/owner 2>/dev/null)" = ${owner} || exit 77; rm -rf -- ${directory}; fi`, 10000);
      if (result.code !== 0 || result.signal) throw new Error('Cannot remove owned direct-transfer scratch directory');
      // Keep the last durable execution inputs until the regular task store commits them.
      if (entry.recovery && this.manager.tasks.has(entry.taskId)) {
        if (!await this.manager._persistNow()) throw new Error('Cannot commit recovered direct-transfer task');
      }
      await this.journal.forget(entry);
      this.restored.delete(entry.tag);
      return true;
    } catch (error) {
      const task = this.manager.tasks.get(entry.taskId);
      if (task) { task.error = lang.t('transferFailed', { detail: error.message }); this.manager.emit(task); }
      return false;
    } finally { this.busy.delete(entry.tag); }
  }
  async cleanupTask(taskId) {
    let ok = true;
    for (const entry of this.journal.list().filter((entry) => entry.taskId === taskId)) {
      if (!await this.cleanup(entry)) ok = false;
    }
    return ok;
  }
  /** @param {{serverId?: string, localOnly?: boolean}} [options] */
  async collect({ serverId, localOnly = false } = {}) {
    if (localOnly) return;
    for (const entry of this.journal.list()) {
      if ((!serverId || entry.serverId === serverId || entry.peerId === serverId)
        && (entry.disposition === 'cleanup' || this.restored.has(entry.tag))) await this.cleanup(entry);
    }
  }
}
module.exports = { DirectResources, DirectJournal, valid, keyCommand };
