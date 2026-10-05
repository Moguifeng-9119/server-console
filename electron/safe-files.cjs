const fs = require('node:fs');
const crypto = require('node:crypto');

function assertActive(gate) {
  if (gate?.canceled) { const error = Object.assign(new Error('__ABORT__'), { aborted: true }); throw error; }
}

function hashPrefix(stream, size, gate) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    gate?.track(stream);
    const off = gate?.onAbort(() => { const error = Object.assign(new Error('__ABORT__'), { aborted: true }); reject(error); stream.destroy(); });
    const cleanup = () => { off?.(); gate?.untrack(stream); };
    stream.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });
    stream.on('error', (error) => { cleanup(); reject(error); });
    stream.on('close', cleanup);
    stream.on('end', () => { cleanup(); bytes === size ? resolve(hash.digest('hex')) : reject(new Error('Resume prefix size changed')); });
  });
}

// Never infer that an existing destination is a partial upload. Only a task's
// own staging file is eligible, and its complete prefix must match the source.
async function verifiedOffset(sftp, localPath, remotePath, size, remoteIsPartial = true, gate = null) {
  assertActive(gate);
  let offset;
  try {
    const stat = remoteIsPartial
      ? await new Promise((resolve, reject) => sftp.stat(remotePath, (error, value) => error ? reject(error) : resolve(value)))
      : await fs.promises.stat(localPath);
    offset = stat.size;
  } catch (error) {
    if (error.code === 2 || error.code === 'ENOENT') return 0;
    throw error;
  }
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > size) return 0;
  const [local, remote] = await Promise.all([
    hashPrefix(fs.createReadStream(localPath, { start: 0, end: offset - 1 }), offset, gate),
    hashPrefix(sftp.createReadStream(remotePath, { start: 0, end: offset - 1 }), offset, gate),
  ]);
  assertActive(gate);
  return local === remote ? offset : 0;
}

const remoteStat = (sftp, target) => new Promise((resolve, reject) => sftp.stat(target, (error, value) => error ? reject(error) : resolve(value)));

async function verifiedRemoteOffset(source, destination, sourcePath, staged, size, gate) {
  assertActive(gate);
  let offset;
  try { offset = (await remoteStat(destination, staged)).size; }
  catch (error) { if (error.code === 2 || error.code === 'ENOENT') return 0; throw error; }
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > size) return 0;
  const [a, b] = await Promise.all([
    hashPrefix(source.createReadStream(sourcePath, { start: 0, end: offset - 1 }), offset, gate),
    hashPrefix(destination.createReadStream(staged, { start: 0, end: offset - 1 }), offset, gate),
  ]);
  assertActive(gate);
  return a === b ? offset : 0;
}

function uploadPart(remotePath, taskId) {
  const tag = crypto.createHash('sha256').update(String(taskId)).digest('hex').slice(0, 16);
  return `${remotePath}.scpart-${tag}`;
}

async function commitUpload(sftp, staged, target) {
  const run = (rename) => new Promise((resolve, reject) => rename(staged, target, (error) => error ? reject(error) : resolve()));
  if (typeof sftp.ext_openssh_rename === 'function') {
    try { await run(sftp.ext_openssh_rename.bind(sftp)); return; }
    catch (error) { if (error.code !== 8 && !/not support|unsupported/i.test(error.message)) throw error; }
  }
  await run(sftp.rename.bind(sftp));
}

module.exports = { verifiedOffset, verifiedRemoteOffset, remoteStat, uploadPart, commitUpload, assertActive };
