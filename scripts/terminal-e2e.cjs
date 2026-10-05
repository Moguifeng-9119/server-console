// Native packaged-app check: isolated userData, real preload IPC, loopback SSH and local shell.
// SC_ELECTRON_PATH must point to the CURRENT unpacked app executable, not the portable launcher wrapper.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { _electron } = require('playwright-core');
const { createFakeSshd } = require('./fake-sshd.cjs');

async function main() {
  const exe = process.env.SC_ELECTRON_PATH;
  assert(exe && fs.existsSync(exe), 'Set SC_ELECTRON_PATH to the newly built unpacked app executable (not its portable wrapper)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-term-e2e-'));
  const artifacts = path.resolve(process.env.SC_TERMINAL_ARTIFACTS || path.join(__dirname, '../test-artifacts/terminal'));
  fs.mkdirSync(artifacts, {recursive: true});
  let sshd, application;
  const checks = [], errors = [];
  const pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    sshd = await createFakeSshd({port: 0, root: path.join(tmp, 'srv')});
    application = await _electron.launch({executablePath: path.resolve(exe), env: {...process.env, SC_USER_DATA: path.join(tmp, 'userdata')}, timeout: 30000});
    const version = await application.evaluate(({app}) => app.getVersion());
    assert.equal(version, JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'))).version, 'Packaged app must match current source version');
    pass('current packaged version launches');
    const sourceRoot = path.resolve(__dirname, '..');
    const files = fs.readdirSync(path.join(sourceRoot, 'electron')).filter((name) => name.endsWith('.cjs')).map((name) => 'electron/' + name);
    files.push('dist/index.html', ...fs.readdirSync(path.join(sourceRoot, 'dist/assets')).map((name) => 'dist/assets/' + name));
    const expected = files.map((file) => ({file, hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, file))).digest('hex')}));
    const mismatches = await application.evaluate(({app}, expectedFiles) => {
      const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), crypto = process.getBuiltinModule('node:crypto');
      return expectedFiles.filter(({file, hash}) => crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(), file))).digest('hex') !== hash).map(({file}) => file);
    }, expected);
    assert.deepEqual(mismatches, [], 'Packaged backend and production assets must match current source/build');
    pass('packaged code and assets match source SHA-256');
    const page = await application.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.nav');
    await page.evaluate(() => { localStorage.setItem('sc.lang', 'zh-CN'); localStorage.setItem('sc.theme.user', 'light'); });
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
    await page.locator('.xterm:visible').click();
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
    assert.deepEqual(errors, []); pass('no uncaught renderer errors');
    await page.screenshot({path: path.join(artifacts, 'multi.png')});
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({at: new Date().toISOString(), platform: process.platform, arch: process.arch, version, executablePath: path.resolve(exe), scope: 'Native Electron packaged app + real IPC + loopback SSH + local shell; simulated GPU metrics.', checks}, null, 2) + '\n');
    console.log(checks.length + ' native terminal checks passed; artifacts: ' + artifacts);
  } finally {
    if (application) await application.close();
    if (sshd) await new Promise((resolve) => sshd.close(resolve));
    if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith('sc-term-e2e-')) fs.rmSync(tmp, {recursive: true, force: true});
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
