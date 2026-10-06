// Opt-in: existing trusted SSH aliases, isolated packaged app, fresh owned remote directories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright-core');
const { readConfig } = require('../electron/sshconfig.cjs');
const { Pool, setHostKeyChecker } = require('../electron/ssh.cjs');
const hostkeys = require('../electron/hostkeys.cjs');
const { TransferManager } = require('../electron/transfer.cjs');
const { uploadPart } = require('../electron/safe-files.cjs');
const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const q = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await sleep(200); }
  throw new Error('Timed out: ' + label);
}
function config(alias, id) {
  assert(alias && !alias.startsWith('--'), 'Two existing SSH aliases are required');
  const entry = readConfig(path.join(os.homedir(), '.ssh/config')).entries.find((entry) => entry.alias === alias || entry.allAliases.includes(alias));
  assert(entry?.keyExists && !entry.proxyJump, 'Alias must have an existing direct key configuration');
  const cfg = { id, name: id, host: entry.host, port: entry.port, username: entry.user, authType: 'key', keyPath: entry.keyPath };
  const endpoint = cfg.port === 22 ? cfg.host : `[${cfg.host}]:${cfg.port}`;
  const known = execFileSync('ssh-keygen', ['-F', endpoint], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#')).map((line) => line.trim().split(/\s+/)[2]);
  assert(known.length, 'Alias must have a verified existing known_hosts entry');
  return { cfg, known };
}
async function main() {
  const exe = process.env.SC_ELECTRON_PATH;
  assert(exe && fs.existsSync(exe), 'Set SC_ELECTRON_PATH to the current unpacked app');
  const base = arg('--base');
  assert(base && base.startsWith('/') && path.posix.normalize(base) === base && base !== '/', 'Supply the authorized absolute parent with --base');
  const source = config(arg('--source'), 'source'), destination = config(arg('--destination'), 'destination');
  assert(source.cfg.host !== destination.cfg.host || source.cfg.port !== destination.cfg.port, 'Use two different SSH endpoints');
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-desktop-live-'));
  const userData = path.join(local, 'userdata'); fs.mkdirSync(userData);
  const output = path.resolve(__dirname, '../test-artifacts/remote-desktop'); fs.mkdirSync(output, { recursive: true });
  const receipt = { version: require('../package.json').version, at: new Date().toISOString(),
    scope: 'Real two-server SSH/SFTP/rsync through current packaged Windows app; isolated data; exact main-process forced crash', checks: [], result: 'failed' };
  const pass = (name) => { receipt.checks.push(name); console.log('PASS ' + name); };
  const pool = new Pool(), directories = [], observedKeys = new Map();
  let application, page, servers;
  setHostKeyChecker((host, port, key) => {
    const endpoint = [source, destination].find((item) => item.cfg.host === host && item.cfg.port === port);
    const blob = Buffer.from(key).toString('base64');
    if (!endpoint?.known.includes(blob)) return false;
    observedKeys.set(endpoint.cfg.id, Buffer.from(key)); return true;
  });
  const a = pool.get(source.cfg), b = pool.get(destination.cfg);
  const launch = async () => {
    application = await _electron.launch({ executablePath: path.resolve(exe), env: { ...process.env, SC_USER_DATA: userData }, timeout: 30000 });
    assert(await application.evaluate(({ app }) => app.isPackaged));
    assert.equal(await application.evaluate(({ app }) => app.getVersion()), receipt.version);
    page = await application.firstWindow(); await page.waitForSelector('.nav');
    await page.evaluate(() => {
      localStorage.setItem('sc.tf.limit', '1');
      localStorage.setItem('sc.tf.opts', JSON.stringify({ notifyDone: false, notifyFail: false }));
    });
    await page.reload(); await page.waitForSelector('.nav');
    await page.evaluate(() => window.api.transferOptions({ limitBytes: 1024 * 1024, notifyDone: false, notifyFail: false }));
  };
  const finished = (id) => until(async () => {
    const task = (await page.evaluate(() => window.api.transferList())).find((item) => item.id === id);
    if (task && ['error', 'canceled'].includes(task.status)) throw new Error('Application transfer failed');
    return task?.status === 'done' ? task : null;
  }, 'transfer completion');
  const forceCrash = async () => {
    const launchedProcess = application.process();
    const launchedPid = launchedProcess.pid;
    const main = await application.evaluate(({ app }) => ({ pid: process.pid, exe: process.execPath, data: app.getPath('userData') }));
    assert.equal(path.resolve(main.exe).toLowerCase(), path.resolve(exe).toLowerCase());
    assert.equal(path.resolve(main.data), userData);
    const pid = main.pid;
    assert(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
    assert(process.platform === 'win32', 'This live forced-crash case currently targets Windows');
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await until(() => launchedProcess.exitCode !== null || launchedProcess.signalCode !== null, 'owned launcher exit', 15000);
    receipt.mainPidMatchedLauncher = receipt.mainPidMatchedLauncher !== false && pid === launchedPid;
    application = null; page = null;
    pass('forced termination of recorded packaged Electron main PID and its child processes');
  };
  const remoteHash = async (conn, file) => {
    const result = await conn.exec('sha256sum -- ' + q(file)); assert.equal(result.code, 0);
    return result.stdout.trim().split(/\s+/)[0];
  };
  try {
    await a.connect(); await b.connect();
    hostkeys.init(userData);
    const verify = hostkeys.makeVerifier();
    for (const item of [source, destination]) verify(item.cfg.host, item.cfg.port, observedKeys.get(item.cfg.id));
    hostkeys.setOpts({ tofu: false });
    pass('both SSH hosts matched existing OpenSSH known_hosts; isolated app trust seeded without TOFU');
    for (const conn of [a, b]) {
      const owner = crypto.randomUUID(), dir = base + '/sc-test-' + owner;
      const result = await conn.exec('umask 077; mkdir -- ' + q(dir) + " && printf '%s' " + q(owner) + ' >' + q(dir + '/owner'));
      assert.equal(result.code, 0); directories.push({ conn, dir, owner });
    }
    const sourceDir = directories[0].dir, targetDir = directories[1].dir;
    const payload = crypto.randomBytes(16 * 1024 * 1024), payloadFile = path.join(local, 'payload.bin');
    fs.writeFileSync(payloadFile, payload); receipt.payloadBytes = payload.length; receipt.payloadSha256 = hash(payload);
    await launch();
    const sourceRoot = path.resolve(__dirname, '..');
    const files = fs.readdirSync(path.join(sourceRoot, 'electron')).filter((name) => name.endsWith('.cjs')).map((name) => 'electron/' + name);
    files.push('dist/index.html', ...fs.readdirSync(path.join(sourceRoot, 'dist/assets')).map((name) => 'dist/assets/' + name),
      ...fs.readdirSync(path.join(sourceRoot, 'src/i18n/locales')).map((name) => 'src/i18n/locales/' + name));
    const expected = files.map((file) => ({ file, digest: hash(fs.readFileSync(path.join(sourceRoot, file))) }));
    const mismatch = await application.evaluate(({ app }, expected) => {
      const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), crypto = process.getBuiltinModule('node:crypto');
      return expected.filter(({ file, digest }) => crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(), file))).digest('hex') !== digest).map(({ file }) => file);
    }, expected);
    assert.deepEqual(mismatch, []); pass('packaged backend, production assets and all native catalogs match current source SHA-256');
    servers = await page.evaluate(async (configs) => {
      const items = [];
      for (const cfg of configs) { const result = await window.api.addServer(cfg); if (!result.ok) throw new Error('Test server registration failed'); items.push(result.server); }
      return items;
    }, [source.cfg, destination.cfg]);
    const [sourceServer, destinationServer] = servers;
    const failedOperation = await page.evaluate(async (id) => window.api.restartService(id, 'sc-acceptance-nonexistent-' + Date.now() + '.service'), sourceServer.id);
    assert.equal(failedOperation.ok, false); pass('real failed systemctl command reports failure through preload IPC');
    await page.evaluate(() => window.api.transferOptions({ limitBytes: 1024 * 1024, notifyDone: false, notifyFail: false }));
    const uploaded = await page.evaluate(async ({ id, file, dir }) => window.api.transferUpload(id, [file], dir), { id: sourceServer.id, file: payloadFile, dir: sourceDir });
    assert(uploaded.ok); const upload = uploaded.data[0], stage = uploadPart(sourceDir + '/payload.bin', upload.id);
    await until(async () => {
      const tasksFile = path.join(userData, 'transfers.json');
      const journalFile = tasksFile + '.staging.json';
      const taskCommitted = fs.existsSync(tasksFile) && JSON.parse(fs.readFileSync(tasksFile, 'utf8')).some((task) => task.id === upload.id);
      const recoveryCommitted = fs.existsSync(journalFile) && JSON.parse(fs.readFileSync(journalFile, 'utf8')).entries.some((entry) => entry.taskId === upload.id && entry.recovery?.id === upload.id);
      if (!taskCommitted && !recoveryCommitted) return false;
      const value = await a.statRemote(stage).catch(() => null);
      return value?.size > 0 && value.size < payload.length;
    }, 'committed task and partial remote stage');
    await forceCrash(); await launch();
    const recovered = (await page.evaluate(() => window.api.transferList())).find((task) => task.id === upload.id);
    assert.equal(recovered.status, 'paused'); assert.equal(recovered.resumable, true);
    await page.evaluate(() => { window.__sawPrefixCheck = false; window.api.onTransferUpdate((task) => { if (task.resumeCheck?.total > 0) window.__sawPrefixCheck = true; }); });
    await page.evaluate((id) => window.api.transferResume(id), upload.id); await finished(upload.id);
    assert(await page.evaluate(() => window.__sawPrefixCheck));
    assert.equal(await remoteHash(a, sourceDir + '/payload.bin'), receipt.payloadSha256);
    assert.equal(await a.statRemote(stage).catch(() => null), null);
    pass('whole packaged main crash: paused task, verified-prefix resume, final SHA-256 and stage removal');
    const relay = await page.evaluate(async ({ sourceId, destinationId, file, dir, size }) => window.api.transferRelay(sourceId, destinationId,
      [{ name: 'relay.bin', path: file, type: 'file', size, mtime: Date.now() }], dir),
      { sourceId: sourceServer.id, destinationId: destinationServer.id, file: sourceDir + '/payload.bin', dir: targetDir, size: payload.length });
    assert(relay.ok); const directTask = relay.data[0], directFile = path.join(userData, 'transfers.json.direct.json');
    const owned = await until(async () => {
      if (!fs.existsSync(directFile)) return false;
      const entry = JSON.parse(fs.readFileSync(directFile, 'utf8')).entries.find((entry) => entry.taskId === directTask.id && entry.publicKey);
      if (!entry) return false;
      const running = await a.exec("pgrep -f '[b]ash " + entry.path + "/run.sh' >/dev/null");
      return running.code === 0 ? entry : false;
    }, 'real rsync in progress with durable key ownership');
    await forceCrash(); await launch();
    await until(() => JSON.parse(fs.readFileSync(directFile, 'utf8')).entries.length === 0, 'application reconnect cleanup', 45000);
    const oldScratch = await a.statRemote(owned.path).catch(() => null); assert.equal(oldScratch, null);
    const oldKey = await b.exec('grep -Fxq -- ' + q(owned.publicKey) + ' ~/.ssh/authorized_keys'); assert.equal(oldKey.code, 1);
    pass('whole packaged main crash: application removed exact old direct public key and owned source scratch on reconnect');
    await page.evaluate((id) => window.api.transferResume(id), directTask.id);
    const completed = await finished(directTask.id); assert.equal(completed.direct, true); assert.equal(completed.directMode, 'rsync');
    assert.equal(await remoteHash(b, targetDir + '/relay.bin'), receipt.payloadSha256);
    assert.deepEqual(JSON.parse(fs.readFileSync(directFile, 'utf8')).entries, []);
    pass('real server-to-server rsync after crash: mode assertion, final SHA-256 and empty direct cleanup journal');
    receipt.result = 'passed';
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.log'), String(error.stack || error));
    throw new Error('Live acceptance failed; private details retained only in ignored local failure.log');
  } finally {
    if (application) {
      await page?.evaluate(async () => window.api.transferCancelMany((await window.api.transferList()).filter((task) => ['running', 'queued'].includes(task.status)).map((task) => task.id))).catch(() => {});
      await application.close().catch(() => {});
    }
    if (servers) {
      const connections = new Map([[servers[0].id, a], [servers[1].id, b]]);
      const endpointIdentity = (id) => { const conn = connections.get(id); return hash(JSON.stringify([conn.cfg.host, conn.cfg.port || 22, conn.cfg.username, conn.cfg.proxyJump || ''])); };
      const cleanup = new TransferManager({ storeFile: path.join(userData, 'transfers.json'), getConn: (id) => connections.get(id), endpointIdentity });
      await cleanup.directResources.collect(); clearTimeout(cleanup._saveTimer);
      if (cleanup.directResources.journal.list().length) { receipt.result = 'failed'; receipt.checks.push('FAILED: exact direct cleanup remains pending'); }
    }
    for (const { conn, dir, owner } of directories) {
      const result = await conn.exec('test "$(cat ' + q(dir + '/owner') + ')" = ' + q(owner) + ' && find ' + q(dir) + ' -maxdepth 1 -type f -delete && rmdir -- ' + q(dir)).catch(() => null);
      if (result?.code !== 0) { receipt.result = 'failed'; receipt.checks.push('FAILED: owned test directory cleanup'); }
    }
    pool.remove(source.cfg.id); pool.remove(destination.cfg.id);
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
    if (receipt.result !== 'passed') process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
