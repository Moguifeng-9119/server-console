// Native packaged-app check: isolated userData, real preload IPC, loopback SSH and local shell.
// SC_ELECTRON_PATH must point to the CURRENT unpacked app executable, not the portable launcher wrapper.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const { _electron } = require('playwright-core');
const { createFakeSshd } = require('./fake-sshd.cjs');

async function within(promise, message, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
const listen = (server) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
async function availablePort() { const server = net.createServer(); const port = await listen(server); await new Promise((resolve) => server.close(resolve)); return port; }
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main() {
  const exe = process.env.SC_ELECTRON_PATH;
  assert(exe && fs.existsSync(exe), 'Set SC_ELECTRON_PATH to the newly built unpacked app executable (not its portable wrapper)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-term-e2e-'));
  const artifacts = path.resolve(process.env.SC_TERMINAL_ARTIFACTS || path.join(__dirname, '../test-artifacts/terminal'));
  fs.mkdirSync(artifacts, {recursive: true});
  let sshd, application, echo, tunnel;
  const echoSockets = new Set(), sizes = [];
  const checks = [], errors = [];
  const pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    echo = net.createServer((socket) => { echoSockets.add(socket); socket.on('error', () => {}); socket.pipe(socket); socket.once('close', () => echoSockets.delete(socket)); });
    const remotePort = await listen(echo);
    sshd = await createFakeSshd({port: 0, root: path.join(tmp, 'srv'), credentials: {username: 'fixture', password: 'fixture'}, tcpPorts: [remotePort], onWindowChange: (info) => sizes.push(info)});
    application = await _electron.launch({executablePath: path.resolve(exe), env: {...process.env, SC_USER_DATA: path.join(tmp, 'userdata')}, timeout: 30000});
    const version = await application.evaluate(({app}) => app.getVersion());
    assert.equal(version, JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version, 'Packaged app must match current source version');
    pass('current packaged version launches');
    const sourceRoot = path.resolve(__dirname, '..');
    const files = fs.readdirSync(path.join(sourceRoot, 'electron')).filter((name) => name.endsWith('.cjs')).map((name) => 'electron/' + name);
    files.push('dist/index.html', ...fs.readdirSync(path.join(sourceRoot, 'dist/assets')).map((name) => 'dist/assets/' + name));
    files.push(...fs.readdirSync(path.join(sourceRoot, 'src/i18n/locales')).map((name) => 'src/i18n/locales/' + name));
    const expected = files.map((file) => ({file, hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, file))).digest('hex')}));
    const mismatches = await application.evaluate(({app}, expectedFiles) => {
      const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), crypto = process.getBuiltinModule('node:crypto');
      return expectedFiles.filter(({file, hash}) => crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(), file))).digest('hex') !== hash).map(({file}) => file);
    }, expected);
    assert.deepEqual(mismatches, [], 'Packaged backend and production assets must match current source/build');
    pass('packaged code and assets match source SHA-256');
    let page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.nav');
    await page.evaluate(() => { localStorage.setItem('sc.lang', 'zh-CN'); localStorage.setItem('sc.theme.user', 'light'); });
    // Install before reload so StateProvider's timers belong to the controlled clock.
    await page.clock.install();
    await page.reload();
    await page.waitForSelector('.nav');
    assert.equal(await page.evaluate(() => typeof window.api?.addServer), 'function');
    pass('sandboxed preload bridge available');
    await page.getByRole('button', {name: '服务器', exact: true}).first().click();
    await page.getByPlaceholder('dgx-01').fill('e2e-test');
    await page.getByPlaceholder('10.20.1.11').fill('127.0.0.1');
    await page.locator('input[type="number"]').fill(String(sshd.address().port));
    await page.getByPlaceholder('root').fill('fixture');
    await page.locator('input[type="password"]').first().fill('fixture');
    await page.getByRole('button', {name: '添加', exact: true}).click();
    await page.waitForFunction(async () => (await window.api.listServers()).some((server) => server.name === 'e2e-test'));
    await page.locator('[role=dialog]').getByRole('button', {name: '关闭', exact: true}).click();
    const storage = await page.evaluate(() => window.api.storeInfo());
    const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'userdata', 'servers.json'), 'utf8'));
    if (storage.encryptionAvailable) {
      const roundTrip = await application.evaluate(({safeStorage}) => {
        const value = 'native-encryption-fixture'; const cipher = safeStorage.encryptString(value);
        return safeStorage.decryptString(cipher) === value && !cipher.includes(Buffer.from(value));
      });
      assert(roundTrip); assert(persisted.servers[0].password.startsWith('enc:'));
      pass((process.platform === 'win32' ? 'Windows DPAPI' : process.platform === 'darwin' ? 'Playwright MockKeychain safeStorage' : 'available safeStorage') + ' encryption round-trip and encrypted credential record');
    } else {
      assert.equal(persisted.servers[0].password, '');
      pass('unavailable OS encryption keeps credentials session-only');
    }
    const writeBlock = path.join(tmp, 'userdata', 'servers.json.tmp');
    fs.mkdirSync(writeBlock);
    try {
      const result = await page.evaluate(async (port) => {
        const before = await window.api.listServers();
        const added = await window.api.addServer({name: 'write-failure', host: '127.0.0.1', port, username: 'fixture', authType: 'password', password: 'fixture'});
        const updated = await window.api.updateServer({id: before[0].id, name: 'write-failure'});
        let removeFailed = false;
        try { await window.api.removeServer(before[0].id); } catch { removeFailed = true; }
        return {before, after: await window.api.listServers(), addFailed: added.ok === false, updateFailed: updated.ok === false, removeFailed};
      }, sshd.address().port);
      assert(result.addFailed && result.updateFailed && result.removeFailed);
      assert.deepEqual(result.after, result.before);
      pass('failed config writes preserve the in-memory server list');
    } finally { fs.rmdirSync(writeBlock); }
    await page.locator('.nav-server').filter({hasText: 'e2e-test'}).click();
    await page.waitForFunction(() => !!document.querySelector('.tabs'));
    await page.getByRole('button', {name: '终端', exact: true}).click();
    const dump = () => page.evaluate(() => window.__scTerm?.dump() || '');
    await page.waitForFunction(() => window.__scTerm?.dump().includes('fake-shell ready'), undefined, {timeout: 30000});
    pass('SSH shell opens through native IPC');
    await page.locator('.xterm:visible .xterm-helper-textarea').focus();
    // The expected result never occurs literally in the typed command, so echoed input cannot pass.
    const command = process.platform === 'win32' ? "echo ('sc-' + 'e2e-' + 'marker')" : "printf 'sc-%s-%s\\n' e2e marker";
    await page.keyboard.type(command, {delay: 10});
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__scTerm?.dump().split(/\r?\n/).some((line) => line.trim() === 'sc-e2e-marker'), undefined, {timeout: 30000});
    pass('typed command executes and returns computed output');
    fs.writeFileSync(path.join(artifacts, 'terminal.txt'), await dump());
    await page.screenshot({path: path.join(artifacts, 'terminal.png')});
    await page.getByRole('button', {name: /^进程（/}).click();
    await page.getByRole('button', {name: '终端', exact: true}).click();
    assert((await dump()).includes('sc-e2e-marker'));
    pass('terminal content survives tab switch');
    await page.locator('.term-chip.add').click();
    await page.waitForFunction(() => document.querySelectorAll('.term-chip:not(.add)').length === 2);
    await page.waitForFunction(async () => (await window.api.terminalList()).length === 2);
    pass('two native SSH sessions coexist');
    const termId = await page.evaluate(async () => (await window.api.terminalList())[0].termId);
    await page.evaluate(({termId}) => window.api.terminalResize(termId, 123, 37), {termId});
    await waitUntil(() => sizes.some((size) => size.cols === 123 && size.rows === 37), 'SSH server did not receive terminal resize');
    pass('terminal resize reaches the SSH server');
    const server = await page.evaluate(async () => (await window.api.listServers())[0]);
    const localPort = await availablePort();
    const added = await page.evaluate((rule) => window.api.forwardingsUpsert(rule), {serverId: server.id, localPort, remoteHost: '127.0.0.1', remotePort, enabled: true});
    assert(added.ok, added.error); const forwardingId = added.data;
    tunnel = net.connect(localPort, '127.0.0.1');
    await within(new Promise((resolve, reject) => { tunnel.once('connect', resolve); tunnel.once('error', reject); }), 'Local forwarding connection failed');
    const payload = Buffer.from('forwarding-' + crypto.randomUUID());
    const response = new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      tunnel.on('data', (chunk) => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= payload.length) resolve(bytes); });
      tunnel.once('error', reject);
    });
    tunnel.write(payload); assert((await within(response, 'SSH forwarding echo failed')).equals(payload));
    pass('native local forwarding carries exact bytes through SSH');
    const tunnelClosed = new Promise((resolve) => tunnel.once('close', resolve));
    const stopped = await within(page.evaluate((id) => window.api.forwardingsStop(id), forwardingId), 'Stopping active forwarding hung');
    assert(stopped.ok, stopped.error); await within(tunnelClosed, 'Active tunnel did not close');
    const removed = await page.evaluate((id) => window.api.forwardingsRemove(id), forwardingId);
    assert(removed.ok, removed.error);
    assert(!(await page.evaluate(() => window.api.forwardingsList())).some((rule) => rule.id === forwardingId));
    pass('stop closes active forwarding and remove clears the rule');
    // Suspend renderer timers while independently testing history IPC persistence.
    // Its normal 30s save would otherwise overwrite this isolated fixture.
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const history = {'native-fixture': [{at: Date.now() - 10000, value: 42}, {at: Date.now() - 5000, value: 42}, {at: Date.now(), value: null}]};
    await page.evaluate((map) => window.api.historySave(map), history);
    assert.deepEqual(await page.evaluate(() => window.api.historyLoad()), history);
    pass('native history persistence retains steady samples and gaps');
    await page.evaluate(() => window.api.securitySet({tofu: false}));
    const trusted = await page.evaluate(() => window.api.hostKeysList());
    assert(trusted.some((entry) => entry.host === '127.0.0.1' && entry.port === sshd.address().port));
    await page.screenshot({path: path.join(artifacts, 'multi.png')});
    await application.close(); application = null;
    application = await _electron.launch({executablePath: path.resolve(exe), env: {...process.env, SC_USER_DATA: path.join(tmp, 'userdata')}, timeout: 30000});
    page = await application.firstWindow(); page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install(); await page.reload();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.waitForSelector('.nav');
    const restored = await page.evaluate(() => window.api.listServers());
    assert.equal(restored[0].id, server.id); assert.equal(restored[0].hasPassword, storage.encryptionAvailable);
    if (!storage.encryptionAvailable) {
      const updated = await page.evaluate((id) => window.api.updateServer({id, password: 'fixture'}), server.id); assert(updated.ok, updated.error);
    }
    const reopened = await page.evaluate((id) => window.api.terminalOpen(id, 100, 30), server.id);
    assert(reopened.ok, reopened.error);
    pass('restart restores configurations and credential policy with authenticated SSH');
    assert.equal((await page.evaluate(() => window.api.securityGet())).tofu, false);
    assert.deepEqual(await page.evaluate(() => window.api.hostKeysList()), trusted);
    assert.deepEqual(await page.evaluate(() => window.api.historyLoad()), history);
    pass('restart preserves host trust, TOFU settings and timestamped history');
    assert.deepEqual(errors, []); pass('no uncaught renderer errors');
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({at: new Date().toISOString(), platform: process.platform, arch: process.arch, version, storage, encryptionEvidence: process.platform === 'darwin' ? 'Playwright MockKeychain; real Keychain not verified' : process.platform === 'win32' ? 'native Windows DPAPI' : storage.encryptionAvailable ? 'available safeStorage backend' : 'session-only; real secret-service not verified', historyTimersPaused: true, executablePath: path.resolve(exe), scope: 'Native Electron package + real IPC + authenticated loopback SSH + local shell/forwarding, storage policy and restart; simulated GPU metrics.', checks}, null, 2) + '\n');
    console.log(checks.length + ' native terminal checks passed; artifacts: ' + artifacts);
  } finally {
    try { if (application) await application.close(); }
    finally {
      tunnel?.destroy(); for (const socket of echoSockets) socket.destroy();
      if (sshd) await new Promise((resolve) => sshd.close(resolve));
      if (echo) await new Promise((resolve) => echo.close(resolve));
      if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith('sc-term-e2e-')) fs.rmSync(tmp, {recursive: true, force: true});
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
