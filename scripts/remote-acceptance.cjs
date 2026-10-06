// Opt-in live checks. Use only SSH aliases and a newly created dedicated directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, fork } = require('node:child_process');
const { readConfig } = require('../electron/sshconfig.cjs');
const { Pool, setHostKeyChecker } = require('../electron/ssh.cjs');
const { TransferManager } = require('../electron/transfer.cjs');
const { uploadPart } = require('../electron/safe-files.cjs');

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const shq = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function config(alias, id) {
  const entries = readConfig(path.join(require('node:os').homedir(), '.ssh', 'config')).entries;
  const e = entries.find((entry) => entry.alias === alias || entry.allAliases.includes(alias));
  if (!e || !e.keyExists || e.proxyJump) throw new Error('This check needs an existing direct SSH alias with an available key file');
  return { id, host: e.host, port: e.port, username: e.user, authType: 'key', keyPath: e.keyPath };
}

function trustedKeys(cfg) {
  const endpoint = cfg.port === 22 ? cfg.host : `[${cfg.host}]:${cfg.port}`;
  const lines = execFileSync('ssh-keygen', ['-F', endpoint], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const keys = lines.map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3);
  if (!keys.length) throw new Error('Alias must already have a verified OpenSSH known_hosts entry');
  return { keys: keys.map((p) => p[2]), line: endpoint + ' ' + keys[0][1] + ' ' + keys[0][2] };
}

async function waitFor(tm, id) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const task = tm.tasks.get(id);
    if (task && ['done', 'error', 'canceled'].includes(task.status) && !task._gate) {
      assert.equal(task.status, 'done', task.error); return task;
    }
    await sleep(50);
  }
  throw new Error('Live transfer timed out');
}

async function main() {
  const sourceAlias = arg('--source');
  if (!sourceAlias || sourceAlias.startsWith('--')) throw new Error('Usage: node scripts/remote-acceptance.cjs --source ALIAS');
  fs.mkdirSync(path.resolve(__dirname, '../test-artifacts'), { recursive: true });
  const local = arg('--local-dir') && process.argv.includes('--local-dir') ? path.resolve(arg('--local-dir')) : fs.mkdtempSync(path.resolve(__dirname, '../test-artifacts/live-'));
  const source = config(sourceAlias, 'source'), trust = trustedKeys(source), pool = new Pool();
  setHostKeyChecker((host, port, key) => host === source.host && port === source.port && trust.keys.includes(Buffer.from(key).toString('base64')));
  const conn = pool.get(source), storeFile = path.join(local, 'tasks.json');
  const tm = new TransferManager({ getConn: () => conn, storeFile, endpointIdentity: () => hash(JSON.stringify([source.host, source.port, source.username])) });
  const receipt = { at: new Date().toISOString(), scope: 'opt-in real Linux SSH/SFTP and NVIDIA sampling', checks: [], unavailable: [], payloadBytes: 16 * 1024 * 1024 };
  let remote;
  try {
    await conn.connect();
    if (process.argv.includes('--crash-child')) {
      remote = arg('--remote-dir');
      tm.setOptions({ limitBytes: 1024 * 1024 });
      tm.onUpdate((t) => { if (t.status === 'running' && t.transferred >= 2 * 1024 * 1024) process.send?.({ id: t.id, transferred: t.transferred }); });
      tm.addMany([{ kind: 'upload', serverId: 'source', srcLocal: path.join(local, 'payload.bin'), dstRemote: remote + '/crash.bin', name: 'crash.bin' }]);
      return;
    }
    const home = (await conn.exec('printf %s "$HOME"')).stdout.trim();
    assert(home.startsWith('/'));
    remote = home.replace(/\/$/, '') + '/.cache/serverconsole-validation-' + crypto.randomUUID();
    await conn.mkdirpRemote(remote);
    const sftp = await conn.sftp(), payload = crypto.randomBytes(receipt.payloadBytes);
    fs.writeFileSync(path.join(local, 'payload.bin'), payload); receipt.payloadSha256 = hash(payload);
    const snap = await conn.collect(); await sleep(1100); const second = await conn.collect();
    receipt.gpuCards = snap.gpus?.length || 0; receipt.cpuPercent = second.cpuUsage;
    assert(receipt.cpuPercent === null || (Number.isFinite(receipt.cpuPercent) && receipt.cpuPercent >= 0 && receipt.cpuPercent <= 100));
    assert(receipt.gpuCards > 0, 'Expected NVIDIA telemetry'); receipt.checks.push('real NVIDIA GPU snapshot');
    const [uploaded] = tm.addMany([{ kind: 'upload', serverId: 'source', srcLocal: path.join(local, 'payload.bin'), dstRemote: remote + '/uploaded.bin', name: 'uploaded.bin' }]);
    await waitFor(tm, uploaded.id);
    const remoteHash = (await conn.exec('sha256sum -- ' + shq(remote + '/uploaded.bin'))).stdout.trim().split(/\s+/)[0];
    assert.equal(remoteHash, receipt.payloadSha256); receipt.checks.push('upload final SHA-256');
    const [downloaded] = tm.addMany([{ kind: 'download', serverId: 'source', srcRemote: remote + '/uploaded.bin', dstLocal: path.join(local, 'downloaded.bin'), name: 'downloaded.bin' }]);
    await waitFor(tm, downloaded.id); assert.equal(hash(fs.readFileSync(path.join(local, 'downloaded.bin'))), remoteHash); receipt.checks.push('download final SHA-256');
    await tm._persistNow(); clearTimeout(tm._saveTimer);
    const child = fork(__filename, ['--source', sourceAlias, '--crash-child', '--local-dir', local, '--remote-dir', remote], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let childError = ''; child.stderr.on('data', (d) => { childError += String(d); });
    const crashTask = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Crash checkpoint timeout')); }, 60000);
      child.once('message', (value) => { clearTimeout(timer); child.kill(); resolve(value); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { if (code) { clearTimeout(timer); reject(new Error(childError || 'Crash child exited before checkpoint')); } });
    });
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
    const recovered = new TransferManager({ getConn: () => conn, storeFile, endpointIdentity: tm.staging.endpointIdentity });
    const task = recovered.tasks.get(crashTask.id); assert(task && task.status === 'paused');
    const staged = uploadPart(remote + '/crash.bin', crashTask.id);
    const stat = await new Promise((resolve, reject) => sftp.stat(staged, (error, value) => error ? reject(error) : resolve(value)));
    assert(stat.size > 0 && stat.size < payload.length); receipt.crashPrefixBytes = stat.size;
    let sawCheck = false; recovered.onUpdate((t) => { if (t.resumeCheck?.total > 0) sawCheck = true; });
    assert(recovered.resume(task.id)); await waitFor(recovered, task.id);
    assert(sawCheck); assert.equal((await conn.exec('sha256sum -- ' + shq(remote + '/crash.bin'))).stdout.trim().split(/\s+/)[0], remoteHash);
    receipt.checks.push('child-process termination, recovered prefix progress, final SHA-256');
    const cleanupTask = { id: crypto.randomUUID(), kind: 'upload', status: 'paused', serverId: 'source', srcLocal: path.join(local, 'payload.bin'), dstRemote: remote + '/discard.bin' };
    recovered.tasks.set(cleanupTask.id, cleanupTask);
    const cleanupPath = uploadPart(cleanupTask.dstRemote, cleanupTask.id);
    await recovered._stage(cleanupTask, 'stagedUploads', cleanupPath, cleanupTask.dstRemote, conn);
    await new Promise((resolve, reject) => sftp.writeFile(cleanupPath, Buffer.from('discard'), (e) => e ? reject(e) : resolve()));
    await recovered.staging.journal.markCleanup(cleanupTask.id); clearTimeout(recovered._saveTimer);
    const restarted = new TransferManager({ getConn: () => conn, storeFile, endpointIdentity: tm.staging.endpointIdentity });
    await restarted.collectStaging({ serverId: 'source' });
    await assert.rejects(new Promise((resolve, reject) => sftp.stat(cleanupPath, (error, value) => error ? reject(error) : resolve(value))));
    assert(!restarted.staging.journal.list().some((e) => e.taskId === cleanupTask.id)); receipt.checks.push('durable cleanup intent survives manager restart and removes actual remote stage');
    clearTimeout(recovered._saveTimer); clearTimeout(restarted._saveTimer);
    receipt.unavailable.push('cross-server rsync needs a reachable destination alias');
    const leftovers = (await conn.exec('find ' + shq(remote) + " -maxdepth 1 -name '*.scpart-*' -print")).stdout.trim();
    assert.equal(leftovers, ''); receipt.checks.push('dedicated test directory has no staging leftovers');
    receipt.result = 'passed';
  } finally {
    if (!process.argv.includes('--crash-child')) {
      clearTimeout(tm._saveTimer);
      // Only files created by this run, under its UUID directory. Preserve local receipts.
      if (remote && /\/.cache\/serverconsole-validation-[0-9a-f-]{36}$/.test(remote)) {
        await conn.exec('find ' + shq(remote) + ' -maxdepth 1 -type f -delete && rmdir -- ' + shq(remote)).catch(() => { receipt.unavailable.push('test directory cleanup failed'); });
      }
      fs.writeFileSync(path.join(local, 'receipt.json'), JSON.stringify(receipt, null, 2));
      pool.remove(source.id);
      console.log(JSON.stringify({ ...receipt, receipt: path.join(local, 'receipt.json') }, null, 2));
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
