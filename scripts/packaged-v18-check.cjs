// Packaged v0.18 acceptance: real sandboxed IPC against an isolated loopback SSH fixture.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { createFakeSshd } = require('./fake-sshd.cjs');
const root = path.resolve(__dirname, '..');
const executablePath = path.resolve(process.env.SC_ELECTRON_PATH || path.join(root, 'release/win-unpacked/ServerConsole.exe'));
const artifacts = path.join(root, 'test-artifacts/packaged-v18');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(promise, timeout = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Acceptance check timed out')), timeout); })]); }
  finally { clearTimeout(timer); }
}
const listen = (server) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
async function availablePort() { const server = net.createServer(); const port = await listen(server); await new Promise((resolve) => server.close(resolve)); return port; }
async function main() {
  assert(fs.existsSync(executablePath), 'Current unpacked app executable is missing');
  fs.mkdirSync(artifacts, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-packaged-v18-'));
  const userData = path.join(temporary, 'userdata'), sshRoot = path.join(temporary, 'remote');
  fs.mkdirSync(userData); fs.mkdirSync(sshRoot);
  fs.writeFileSync(path.join(userData, 'appsettings.json'), JSON.stringify({ closeAction: 'exit', language: 'en', updateAutoInstall: false, statusPage: { enabled: false, token: 'isolated-fixture-token', port: 0 }, acceptanceMarker: 'isolated' }));
  const checks = [], rendererErrors = [], sockets = new Set();
  let application, sshd, echo, page, serverId;
  const report = { at: new Date().toISOString(), executablePath, sourceVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, packagedVersion: '', checks, rendererErrors, cleanup: false,
    scope: 'Native packaged Electron, sandboxed preload, real IPC, authenticated loopback SSH/SFTP, SQLite and localhost forwarding. GPU values are simulated; 200ms checks configuration acceptance, not a native GPU stream rate.' };
  const check = async (name, operation) => {
    try { const evidence = await within(operation()); checks.push({ name, passed: true, evidence }); console.log('PASS ' + name); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  };
  try {
    echo = net.createServer((socket) => { sockets.add(socket); socket.on('error', () => {}); socket.pipe(socket); socket.once('close', () => sockets.delete(socket)); });
    const remotePort = await listen(echo);
    sshd = await createFakeSshd({ port: 0, root: sshRoot, credentials: { username: 'fixture', password: 'fixture' }, tcpPorts: [remotePort] });
    fs.writeFileSync(path.join(sshRoot, 'editable.txt'), 'initial text\n');
    application = await _electron.launch({ executablePath, env: { ...process.env, SC_USER_DATA: userData }, timeout: 30000 });
    report.packagedVersion = await application.evaluate(({ app }) => app.getVersion());
    await check('current package version and source identity', async () => {
      assert.equal(report.packagedVersion, report.sourceVersion);
      const names = ['electron/ipc.cjs', 'electron/preload.cjs', 'electron/main.cjs', 'electron/workbench.cjs', 'electron/productivity.cjs', 'electron/text-editor.cjs', 'electron/history-db.cjs', 'electron/history-worker.cjs', 'electron/devsync.cjs', 'electron/ssh.cjs', 'electron/log-parser-worker.cjs', 'electron/configuration-transaction.cjs', 'electron/monitoring/scheduler.cjs'];
      const expected = names.map((file) => ({ file, hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
      const mismatches = await application.evaluate(({ app }, files) => {
        const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), crypto = process.getBuiltinModule('node:crypto');
        return files.filter(({ file, hash }) => crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(), file))).digest('hex') !== hash).map(({ file }) => file);
      }, expected);
      assert.deepEqual(mismatches, [], 'Package contains backend source that differs from the checkout');
      return { version: report.packagedVersion, backendFilesMatched: names.length };
    });
    await application.evaluate(({ shell }) => { globalThis.__scAcceptanceOpenedUrls = []; shell.openExternal = async (url) => { globalThis.__scAcceptanceOpenedUrls.push(url); }; });
    page = await application.firstWindow(); page.on('pageerror', (error) => rendererErrors.push(error.message));
    await page.waitForSelector('.nav', { timeout: 30000 });
    const added = await page.evaluate((port) => window.api.addServer({ name: 'packaged-v18-fixture', host: '127.0.0.1', port, username: 'fixture', authType: 'password', password: 'fixture' }), sshd.address().port);
    assert(added.ok, added.error); serverId = added.server.id;
    await page.evaluate((id) => { window.__scAcceptanceSnapshots = []; window.api.onSnapshot((snapshot) => { if (snapshot.id === id) window.__scAcceptanceSnapshots.push(snapshot); }); }, serverId);
    await check('200ms configuration accepted through real IPC', async () => {
      assert.equal(await page.evaluate(() => window.api.setInterval(200)), 200);
      assert.equal(await page.evaluate((id) => window.api.setFocusedServer(id), serverId), true);
      assert.equal(await page.evaluate(() => window.api.setMonitoringHidden(false)), true);
      await page.waitForFunction(() => window.__scAcceptanceSnapshots.length > 0, undefined, { timeout: 12000 });
      const snapshot = await page.evaluate(() => window.__scAcceptanceSnapshots.at(-1));
      assert.equal(snapshot.gpus.length, 3); return { requestedIntervalMs: 200, observedMonitoring: snapshot.monitoring, simulatedGpuCount: snapshot.gpus.length };
    });
    await check('weekly report reaches SQLite without unavailable error', async () => {
      let history;
      for (let attempt = 0; attempt < 15; attempt++) {
        history = await page.evaluate((id) => window.api.historyQuery({ serverId: id, device: 'all', metric: 'util', rangeMs: 1800000 }), serverId);
        if (history.devices?.some((device) => device.device.startsWith('gpu:'))) break;
        await wait(400);
      }
      assert(history.devices?.some((device) => device.device.startsWith('gpu:')), 'Monitored GPU channels were not written to SQLite');
      const result = await page.evaluate((id) => window.api.workbenchRequest({ operation: 'report', serverId: id, rangeMs: 604800000 }), serverId);
      assert(result.ok, result.error); assert(result.data.devices.length >= 3); assert.equal(result.data.end - result.data.start, 604800000);
      return { devices: result.data.devices.length, rangeDays: 7, coverageIsMeasured: result.data.devices.every((device) => Number.isFinite(device.coveragePercent)) };
    });
    await check('text read fingerprint and atomic edit through real SFTP', async () => {
      const loaded = await page.evaluate((id) => window.api.sftpReadText(id, '/editable.txt', false), serverId);
      assert(loaded.ok, loaded.error); assert.match(loaded.data.contentHash, /^[a-f0-9]{64}$/); assert.equal(loaded.data.text, 'initial text\n');
      const saved = await page.evaluate(({ id, hash }) => window.api.sftpWriteText(id, '/editable.txt', 'saved text\n', hash), { id: serverId, hash: loaded.data.contentHash });
      assert(saved.ok, saved.error); assert(saved.data.saved); assert.equal(fs.readFileSync(path.join(sshRoot, 'editable.txt'), 'utf8'), 'saved text\n');
      return { contentHashReturned: true, saved: true };
    });
    await check('text edit rejects stale remote content and preserves external edit', async () => {
      const loaded = await page.evaluate((id) => window.api.sftpReadText(id, '/editable.txt', false), serverId); assert(loaded.ok, loaded.error);
      fs.writeFileSync(path.join(sshRoot, 'editable.txt'), 'external newer text\n');
      const result = await page.evaluate(({ id, hash }) => window.api.sftpWriteText(id, '/editable.txt', 'must not overwrite\n', hash), { id: serverId, hash: loaded.data.contentHash });
      assert.equal(result.ok, false); assert.match(result.error, /changed|Reload/i); assert.equal(fs.readFileSync(path.join(sshRoot, 'editable.txt'), 'utf8'), 'external newer text\n');
      assert.equal(fs.readdirSync(sshRoot).some((name) => name.includes('.sc-edit-')), false); return { staleRejected: true, destinationPreserved: true, temporaryFilesRemain: false };
    });
    await check('language and close settings preserve update and status fields', async () => {
      assert.equal(await page.evaluate(() => window.api.setUpdateAutoInstall(true)), true);
      assert.equal(await page.evaluate(() => window.api.setAppLanguage('de')), true);
      assert.equal(await page.evaluate(() => window.api.setAppSettings({ closeAction: 'minimize' })), true);
      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'appsettings.json'), 'utf8'));
      assert.equal(saved.updateAutoInstall, true); assert.equal(saved.language, 'de'); assert.equal(saved.closeAction, 'minimize'); assert.equal(saved.statusPage.token, 'isolated-fixture-token'); assert.equal(saved.acceptanceMarker, 'isolated');
      await page.evaluate(() => window.api.setUpdateAutoInstall(false)); await page.evaluate(() => window.api.setAppSettings({ closeAction: 'exit' }));
      return { retainedUpdateSetting: true, retainedStatusSetting: true, retainedUnknownSetting: true };
    });
    await check('workspace create update list delete through actual IPC', async () => {
      const created = await page.evaluate((id) => window.api.workbenchRequest({ operation: 'workspaceSave', workspace: { id: 'native-workspace', serverId: id, name: 'Experiment A', cwd: '/work/a', gpu: '0,1' } }), serverId); assert(created.ok, created.error);
      const updated = await page.evaluate((id) => window.api.workbenchRequest({ operation: 'workspaceSave', workspace: { id: 'native-workspace', serverId: id, name: 'Experiment B', cwd: '/work/b' } }), serverId); assert(updated.ok, updated.error);
      const listed = await page.evaluate((id) => window.api.workbenchRequest({ operation: 'workspaceList', serverId: id }), serverId); assert(listed.ok, listed.error); assert.equal(listed.data.find((workspace) => workspace.id === 'native-workspace').cwd, '/work/b');
      const deleted = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceDelete', id: 'native-workspace' })); assert(deleted.ok, deleted.error);
      const remaining = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' })); assert(remaining.ok, remaining.error); assert.equal(remaining.data.some((workspace) => workspace.id === 'native-workspace'), false);
      return { created: true, updated: true, listed: true, deleted: true };
    });
    await check('configuration backup preview and apply through real hook', async () => {
      const exported = await page.evaluate(() => window.api.workbenchRequest({ operation: 'backupExport' })); assert(exported.ok, exported.error); assert.equal(exported.data.credentialsIncluded, false);
      assert.equal(/"password"\s*:/.test(JSON.stringify(exported.data)), false);
      const backup = exported.data; backup.workspaces = [{ id: 'native-imported-workspace', serverId, name: 'Imported', cwd: '/imported' }];
      const preview = await page.evaluate((value) => window.api.workbenchRequest({ operation: 'backupImport', backup: value, apply: false }), backup); assert(preview.ok, preview.error); assert.equal(preview.data.applied, false);
      let listed = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' })); assert.equal(listed.data.some((workspace) => workspace.id === 'native-imported-workspace'), false);
      const applied = await page.evaluate((value) => window.api.workbenchRequest({ operation: 'backupImport', backup: value, apply: true }), backup); assert(applied.ok, applied.error); assert.equal(applied.data.applied, true);
      listed = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' })); assert.equal(listed.data.find((workspace) => workspace.id === 'native-imported-workspace').cwd, '/imported');
      const receipts = await page.evaluate(() => window.api.workbenchRequest({ operation: 'backupResults' })); assert(receipts.ok, receipts.error);
      assert.equal(receipts.data.find((item) => item.operationId === applied.data.operationId)?.status, 'committed');
      assert(fs.existsSync(path.join(userData, 'configuration-before-import.json'))); return { credentialsOmitted: true, previewMutatedNothing: true, applied: true, recoveryFileWritten: true };
    });
    await check('failed backup commit rolls server and workspace state back', async () => {
      const exported = await page.evaluate(() => window.api.workbenchRequest({ operation: 'backupExport' })); assert(exported.ok, exported.error);
      const beforeServers = await page.evaluate(() => window.api.listServers());
      const beforeWorkspaces = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' }));
      const beforeRules = await page.evaluate(() => window.api.workbenchRequest({ operation: 'ruleList' }));
      const backup = exported.data;
      backup.servers.push({ id: 'native-must-rollback', name: 'Rollback fixture', host: '127.0.0.1', port: sshd.address().port, username: 'fixture', authType: 'password' });
      backup.workspaces.push({ id: 'native-must-rollback-workspace', serverId: 'native-must-rollback', name: 'Rollback', cwd: '/rollback' });
      backup.state.rules = [{ id: 'native-must-rollback-rule', serverId, name: 'Rollback rule', metric: 'temperature', threshold: 90, recovery: 80, enabled: true }];
      const block = path.join(userData, 'productivity.json.tmp'); fs.mkdirSync(block);
      try {
        const result = await page.evaluate((value) => window.api.workbenchRequest({ operation: 'backupImport', backup: value, apply: true }), backup);
        assert.equal(result.ok, false, 'Blocked persistence must reject the import');
      } finally { fs.rmdirSync(block); }
      assert.deepEqual(await page.evaluate(() => window.api.listServers()), beforeServers);
      assert.deepEqual(await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' })), beforeWorkspaces);
      assert.deepEqual(await page.evaluate(() => window.api.workbenchRequest({ operation: 'ruleList' })), beforeRules);
      const onDiskServers = JSON.parse(fs.readFileSync(path.join(userData, 'servers.json'), 'utf8'));
      const onDiskWorkbench = JSON.parse(fs.readFileSync(path.join(userData, 'workbench.json'), 'utf8'));
      assert.equal(onDiskServers.servers.some((server) => server.id === 'native-must-rollback'), false);
      assert.equal(onDiskWorkbench.rules.some((rule) => rule.id === 'native-must-rollback-rule'), false);
      return { rejected: true, serverMemoryRestored: true, workspaceMemoryRestored: true, ruleMemoryRestored: true, externalFilesRestored: true };
    });
    await check('reopening a service reuses one forwarding and transports bytes', async () => {
      const localPort = await availablePort(), request = { operation: 'serviceOpen', serverId, name: 'web', localPort, remotePort };
      const first = await page.evaluate((value) => window.api.workbenchRequest(value), request); assert(first.ok, first.error);
      const second = await page.evaluate((value) => window.api.workbenchRequest(value), request); assert(second.ok, second.error);
      const list = await page.evaluate(() => window.api.forwardingsList()); const matching = list.filter((rule) => rule.serverId === serverId && rule.localPort === localPort && rule.remotePort === remotePort);
      assert.equal(matching.length, 1, 'Repeated service opening created duplicate forwarding rules'); assert.equal(matching[0].status, 'listening');
      const socket = net.connect(localPort, '127.0.0.1'); sockets.add(socket); socket.on('error', () => {});
      await within(new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }), 5000);
      const received = new Promise((resolve, reject) => { socket.once('data', resolve); socket.once('error', reject); }); socket.write('native-service-marker'); assert.equal((await within(received, 5000)).toString(), 'native-service-marker'); socket.destroy();
      const opened = await application.evaluate(() => globalThis.__scAcceptanceOpenedUrls);
      assert.equal(opened.filter((url) => url === 'http://127.0.0.1:' + localPort).length, 2);
      return { forwardingRules: matching.length, repeatedOpenSucceeded: true, roundTripVerified: true, browserWasStubbed: true };
    });
    for (const boundary of ['servers.json', 'workbench.json', 'productivity.json']) await check('forced main-process exit during import after ' + boundary, async () => {
      const exported = await page.evaluate(() => window.api.workbenchRequest({ operation: 'backupExport' })); assert(exported.ok, exported.error);
      const marker = 'crash-' + boundary.replace('.json', ''), backup = exported.data;
      backup.servers.push({ id: marker, name: marker, host: '127.0.0.1', port: sshd.address().port, username: 'fixture', authType: 'password' });
      backup.workspaces.push({ id: marker, serverId: marker, name: marker, cwd: '/crash-fixture' });
      await page.evaluate((id) => { localStorage.setItem('sc.lang', 'en'); localStorage.setItem('sc.pendingImport.' + id, JSON.stringify({ 'sc.lang': 'fr' })); }, marker);
      await application.evaluate((_electron, target) => {
        const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), rename = fs.renameSync;
        fs.renameSync = function (from, to) { const result = rename.call(this, from, to); if (path.basename(String(to)) === target) process.kill(process.pid, 'SIGKILL'); return result; };
      }, boundary);
      const exited = new Promise((resolve) => application.process().once('exit', resolve));
      void page.evaluate(({ value, id }) => window.api.workbenchRequest({ operation: 'backupImport', backup: value, apply: true, operationId: id }), { value: backup, id: marker }).catch(() => {});
      await within(exited, 10000); application = null;
      assert(fs.existsSync(path.join(userData, 'configuration-import-journal.json')), 'Interrupted import must have a recovery journal');
      application = await _electron.launch({ executablePath, env: { ...process.env, SC_USER_DATA: userData }, timeout: 15000 });
      page = await application.firstWindow(); page.on('pageerror', (error) => rendererErrors.push(error.message));
      await page.waitForSelector('.nav');
      await page.waitForFunction((id) => localStorage.getItem('sc.pendingImport.' + id) === null, marker);
      assert.equal(await page.evaluate(() => localStorage.getItem('sc.lang')), 'en', 'Interrupted import must not change presentation preferences');
      const servers = await page.evaluate(() => window.api.listServers()); assert.equal(servers.some((server) => server.id === marker), false);
      const workspaces = await page.evaluate(() => window.api.workbenchRequest({ operation: 'workspaceList' })); assert.equal(workspaces.data.some((workspace) => workspace.id === marker), false);
      const results = await page.evaluate(() => window.api.workbenchRequest({ operation: 'backupResults' })); assert.equal(results.data[0].status, 'failed'); assert.match(results.data[0].error, /Interrupted/);
      assert.equal(fs.existsSync(path.join(userData, 'configuration-import-journal.json')), false);
      return { forcedExit: true, restarted: true, originalConfigurationRestored: true, failedReceiptQueryable: true };
    });
    await check('no uncaught renderer errors', async () => { assert.deepEqual(rendererErrors, []); return { errors: rendererErrors.length }; });
    await page.screenshot({ path: path.join(artifacts, 'packaged.png') });
  } catch (error) { checks.push({ name: 'acceptance harness setup', passed: false, error: error.message }); console.error(error); }
  finally {
    try { if (application) await within(application.close(), 15000); }
    catch (error) { application?.process()?.kill(); checks.push({ name: 'native app clean shutdown', passed: false, error: error.message }); }
    for (const socket of sockets) socket.destroy();
    if (sshd) await within(new Promise((resolve) => sshd.close(resolve)), 5000).catch((error) => checks.push({ name: 'SSH fixture shutdown', passed: false, error: error.message }));
    if (echo) await within(new Promise((resolve) => echo.close(resolve)), 5000).catch((error) => checks.push({ name: 'TCP fixture shutdown', passed: false, error: error.message }));
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('sc-packaged-v18-')) { fs.rmSync(temporary, { recursive: true, force: true }); report.cleanup = true; }
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = checks.filter((check) => !check.passed); console.log(`${checks.length - failed.length}/${checks.length} packaged checks passed; artifacts: ${artifacts}`);
  if (failed.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
