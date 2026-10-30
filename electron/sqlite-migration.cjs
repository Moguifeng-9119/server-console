const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
function validateBackup(source, file) {
  let backup;
  try {
    backup = new DatabaseSync(file, { readOnly: true });
    const rows = backup.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('SQLite integrity check failed');
    const schema = (db) => db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name,type").all();
    const tables = schema(source);
    if (JSON.stringify(schema(backup)) !== JSON.stringify(tables)) throw new Error('SQLite backup schema differs from the source');
    for (const table of tables.filter((row) => row.type === 'table')) {
      const name = '"' + String(table.name).replace(/"/g, '""') + '"';
      if (source.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n !== backup.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n) throw new Error('SQLite backup row counts differ from the source');
    }
  } finally { backup?.close(); }
}
function backupBeforeResearchMigration(source, file) {
  const backup = file + '.pre-research-v1.sqlite';
  if (fs.existsSync(backup)) { validateBackup(source, backup); return backup; }
  const temporary = backup + '.tmp-' + crypto.randomBytes(12).toString('hex');
  const owned = fs.openSync(temporary, 'wx', 0o600); fs.closeSync(owned);
  try {
    source.exec('VACUUM INTO ' + quote(temporary)); validateBackup(source, temporary);
    const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, backup); return backup;
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* Keep the exact failed candidate available for diagnosis if the OS still locks it. */ }
    throw error;
  }
}
module.exports = { backupBeforeResearchMigration };
