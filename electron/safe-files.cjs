const crypto = require('node:crypto');

const { verifiedOffset, verifiedRemoteOffset, remoteStat, assertActive } = require('./resume-verifier.cjs');

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
