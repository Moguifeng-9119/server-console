// A local undo journal for the three files changed by configuration import.
// The server bytes are already encrypted by store.cjs; never serialize decrypted credentials.
const fs = require('node:fs');
const path = require('node:path');
const names = ['servers.json', 'workbench.json', 'productivity.json'];
function atomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.import-tmp', fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
class ConfigurationTransaction {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'configuration-import-journal.json'); }
  begin(operationId) {
    if (fs.existsSync(this.file)) throw new Error('An earlier configuration import requires recovery');
    const files = Object.fromEntries(names.map((name) => { const file = path.join(this.directory, name); return [name, fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null]; }));
    atomic(this.file, JSON.stringify({ version: 1, operationId, status: 'pending', files }));
  }
  finish() {
    const journal = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    for (const name of names) {
      const file = path.join(this.directory, name);
      if (fs.existsSync(file)) { const fd = fs.openSync(file, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    }
    atomic(this.file, JSON.stringify({ ...journal, status: 'committed' }));
    try { fs.unlinkSync(this.file); } catch { /* The committed marker is safe to recover. */ }
  }
  recover() {
    if (!fs.existsSync(this.file)) return null;
    const journal = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (journal.version !== 1 || !['pending', 'committed'].includes(journal.status) || !journal.files) throw new Error('Invalid configuration import recovery journal');
    if (journal.status === 'pending') {
      for (const name of names) {
        const value = journal.files[name], file = path.join(this.directory, name);
        if (value === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else if (typeof value === 'string') atomic(file, Buffer.from(value, 'base64'));
        else throw new Error('Incomplete configuration import recovery journal');
      }
      const file = path.join(this.directory, 'productivity.json');
      const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, workspaces: [] };
      data.importResults = [{ operationId: journal.operationId, status: 'failed', applied: false, error: 'Interrupted configuration import was rolled back during recovery', at: Date.now() }, ...(data.importResults || [])].slice(0, 20);
      atomic(file, JSON.stringify(data));
    }
    fs.unlinkSync(this.file);
    return { operationId: journal.operationId, status: journal.status };
  }
}
module.exports = { ConfigurationTransaction };
