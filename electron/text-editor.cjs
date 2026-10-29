const crypto = require('node:crypto');
const { commitUpload } = require('./safe-files.cjs');
const MAX_TEXT = 512 * 1024;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const call = (target, method, ...args) => new Promise((resolve, reject) => target[method](...args, (error, result) => error ? reject(error) : resolve(result)));
async function readBytes(sftp, file) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const stream = sftp.createReadStream(file, { start: 0, end: MAX_TEXT });
    stream.on('data', (chunk) => { size += chunk.length; if (size > MAX_TEXT) { stream.destroy(new Error('File exceeds the editing limit')); return; } chunks.push(chunk); });
    stream.on('end', () => resolve(Buffer.concat(chunks))); stream.on('error', reject);
  });
}
class TextEditor {
  constructor({ getConnection }) { this.getConnection = getConnection; this.writes = new Set(); }
  async write({ id, path: file, text, expectedHash }) {
    if (typeof file !== 'string' || !file || file.includes('\0') || typeof text !== 'string') throw new Error('Invalid text edit');
    const bytes = Buffer.from(text, 'utf8'); if (bytes.length > MAX_TEXT) throw new Error('File exceeds the editing limit');
    if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Reload the file before saving; a content fingerprint is required');
    const key = JSON.stringify([id, file]); if (this.writes.has(key)) throw new Error('Another save is in progress'); this.writes.add(key);
    let sftp, temporary;
    try {
      const conn = await this.getConnection(id); sftp = await conn.sftp();
      const stat = await call(sftp, 'lstat', file);
      if ((stat.mode & 0o170000) !== 0o100000 || stat.size > MAX_TEXT) throw new Error('Only complete ordinary text files can be edited');
      if (digest(await readBytes(sftp, file)) !== expectedHash) throw new Error('Remote file changed. Reload and review your changes before saving.');
      temporary = file + '.sc-edit-' + crypto.randomUUID();
      await call(sftp, 'writeFile', temporary, bytes);
      if (typeof sftp.chmod === 'function') await call(sftp, 'chmod', temporary, stat.mode & 0o777);
      if (digest(await readBytes(sftp, file)) !== expectedHash) throw new Error('Remote file changed during save. Original destination was preserved.');
      await commitUpload(sftp, temporary, file); temporary = null;
      return { saved: true, contentHash: digest(bytes) };
    } finally {
      this.writes.delete(key);
      if (temporary && sftp) await call(sftp, 'unlink', temporary);
    }
  }
}
module.exports = { TextEditor, digest, MAX_TEXT };
