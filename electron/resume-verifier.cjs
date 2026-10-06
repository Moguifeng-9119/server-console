const fs = require('node:fs');
const crypto = require('node:crypto');

function assertActive(gate) {
  if (gate?.canceled) throw Object.assign(new Error('__ABORT__'), { aborted: true });
}

function hashPrefix(stream, size, gate, progress) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0, settled = false;
    gate?.track(stream);
    let off;
    const finish = (error, digest) => {
      if (settled) return;
      settled = true; off?.(); gate?.untrack(stream);
      if (error) { stream.destroy(); reject(error); } else resolve(digest);
    };
    off = gate?.onAbort(() => finish(Object.assign(new Error('__ABORT__'), { aborted: true })));
    stream.on('data', (chunk) => {
      if (settled) return;
      try { bytes += chunk.length; hash.update(chunk); progress?.(bytes); }
      catch (error) { finish(error); }
    });
    stream.on('error', (error) => finish(error));
    stream.on('close', () => { if (!settled) finish(new Error('Resume verification stream closed before completion')); });
    stream.on('end', () => finish(bytes === size ? null : new Error('Resume prefix size changed'), bytes === size ? hash.digest('hex') : undefined));
    if (gate?.canceled) finish(Object.assign(new Error('__ABORT__'), { aborted: true }));
  });
}

async function comparePrefixes(a, b, size, gate, onProgress) {
  const counts = [0, 0];
  const update = (index, bytes) => { counts[index] = bytes; onProgress?.({ bytes: Math.min(...counts), total: size }); };
  try {
    onProgress?.({ bytes: 0, total: size });
    const hashes = await Promise.all([hashPrefix(a, size, gate, (n) => update(0, n)), hashPrefix(b, size, gate, (n) => update(1, n))]);
    assertActive(gate);
    return hashes[0] === hashes[1];
  } catch (error) {
    a.destroy(); b.destroy();
    throw error;
  }
}

const remoteStat = (sftp, target) => new Promise((resolve, reject) => sftp.stat(target, (error, value) => error ? reject(error) : resolve(value)));

async function verifiedOffset(sftp, localPath, remotePath, size, remoteIsPartial = true, gate = null, onProgress) {
  assertActive(gate);
  let offset;
  try { offset = (remoteIsPartial ? await remoteStat(sftp, remotePath) : await fs.promises.stat(localPath)).size; }
  catch (error) { if (error.code === 2 || error.code === 'ENOENT') return 0; throw error; }
  assertActive(gate);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > size) return 0;
  const a = fs.createReadStream(localPath, { start: 0, end: offset - 1 });
  let b;
  try { b = sftp.createReadStream(remotePath, { start: 0, end: offset - 1 }); }
  catch (error) { a.destroy(); throw error; }
  return await comparePrefixes(a, b, offset, gate, onProgress) ? offset : 0;
}

async function verifiedRemoteOffset(source, destination, sourcePath, staged, size, gate, onProgress) {
  assertActive(gate);
  let offset;
  try { offset = (await remoteStat(destination, staged)).size; }
  catch (error) { if (error.code === 2 || error.code === 'ENOENT') return 0; throw error; }
  assertActive(gate);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > size) return 0;
  const a = source.createReadStream(sourcePath, { start: 0, end: offset - 1 });
  let b;
  try { b = destination.createReadStream(staged, { start: 0, end: offset - 1 }); }
  catch (error) { a.destroy(); throw error; }
  return await comparePrefixes(a, b, offset, gate, onProgress) ? offset : 0;
}

module.exports = { hashPrefix, comparePrefixes, verifiedOffset, verifiedRemoteOffset, remoteStat, assertActive };
