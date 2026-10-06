// Durable ownership records precede any staged-file mutation. Never glob remote files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const suffix = (id) => '.scpart-' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
function validEntry(entry, owner) {
  return entry && entry.owner === owner && typeof entry.taskId === 'string'
    && ['local', 'remote'].includes(entry.side) && typeof entry.path === 'string'
    && entry.path.endsWith(suffix(entry.taskId))
    && typeof entry.target === 'string' && entry.path === entry.target + suffix(entry.taskId)
    && ['retain', 'cleanup'].includes(entry.disposition)
    && (entry.side === 'local' || (typeof entry.serverId === 'string' && typeof entry.endpoint === 'string'));
}

class StageJournal {
  constructor(file) {
    this.file = file;
    this.owner = crypto.randomUUID();
    this.entries = new Map();
    this.error = '';
    this.pending = Promise.resolve();
    if (!file) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || typeof data.owner !== 'string' || !Array.isArray(data.entries)
        || data.entries.some((entry) => !validEntry(entry, data.owner))) throw new Error('Invalid ownership manifest');
      this.owner = data.owner;
      for (const entry of data.entries) this.entries.set(this.key(entry), entry);
    } catch (error) {
      if (error.code !== 'ENOENT') this.error = 'Cannot read staging ownership journal: ' + error.message;
    }
    this.loadError = this.error;
  }

  key(entry) { return JSON.stringify([entry.taskId, entry.side, entry.serverId || '', entry.path]); }
  list() { return [...this.entries.values()].map((entry) => ({ ...entry })); }

  mutate(operation) {
    const next = this.pending.then(async () => {
      if (this.loadError) throw new Error(this.loadError);
      const draft = new Map(this.entries);
      try {
        operation(draft);
        if (this.file) {
          await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
          const temporary = this.file + '.tmp';
          const handle = await fs.promises.open(temporary, 'w', 0o600);
          try {
            await handle.writeFile(JSON.stringify({ version: 1, owner: this.owner, entries: [...draft.values()] }));
            await handle.sync();
          } finally { await handle.close(); }
          await fs.promises.rename(temporary, this.file);
        }
        this.entries = draft;
        this.error = '';
      } catch (error) { this.error = error.message; throw error; }
    });
    this.pending = next.catch(() => {});
    return next;
  }

  register({ taskId, side, serverId, endpoint, target, path: staged, recovery }) {
    const entry = { owner: this.owner, taskId, side, serverId, endpoint, target, path: staged, recovery, disposition: 'retain', at: Date.now() };
    if (!validEntry(entry, this.owner)) return Promise.reject(new Error('Invalid task-owned staging path'));
    return this.mutate((entries) => {
      const key = this.key(entry);
      const current = entries.get(key);
      if (current && current.endpoint !== entry.endpoint) throw new Error('Server identity changed; start a new transfer and retain the original staging record');
      if (current?.disposition === 'cleanup') throw new Error('Staging cleanup is pending; create a new transfer');
      entries.set(key, { ...entry, at: current?.at || entry.at });
    });
  }

  markCleanup(taskId) {
    return this.mutate((entries) => {
      for (const [key, entry] of entries) if (entry.taskId === taskId) entries.set(key, { ...entry, disposition: 'cleanup' });
    });
  }

  forget(entry) { return this.mutate((entries) => entries.delete(this.key(entry))); }
}

module.exports = { StageJournal, validEntry };
