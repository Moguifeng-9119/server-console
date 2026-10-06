// Geometry regressions use simulated IPC in a browser and real window chrome in Electron.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium, _electron } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');
const languages = ['en', 'zh-CN', 'zh-TW', 'de', 'es', 'fr', 'ja', 'ko', 'ru', 'pt-BR'];
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-artifacts/window-layout');

async function checkBounds(page, selector, label) {
  const failures = await page.locator(selector).evaluateAll((nodes) => nodes.flatMap((node) => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    const bar = document.querySelector('.desktop-titlebar').getBoundingClientRect().height;
    return r.left < -1 || r.right > innerWidth + 1 || r.top < bar - 1 || r.bottom > innerHeight + 1
      ? [{ tag: node.className, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, viewport: [innerWidth, innerHeight], bar }] : [];
  }));
  assert.deepEqual(failures, [], label + ' controls must remain in the usable window');
}
async function checkOverflow(page, selector, label) {
  const failures = await page.locator(selector).evaluateAll((nodes) => nodes.filter((n) => n.clientWidth && n.scrollWidth > n.clientWidth + 2).map((n) => ({ tag: n.className, width: n.clientWidth, scrollWidth: n.scrollWidth })));
  assert.deepEqual(failures, [], label + ' must not overflow horizontally');
}
async function settings(page, locale, label) {
  await page.locator('.sidebar-foot .btn').last().click();
  await page.waitForSelector('.settings-drawer');
  await checkBounds(page, '.settings-drawer h3 button', label);
  for (const section of ['appearance', 'monitoring', 'security', 'workflow', 'activity']) {
    await page.locator('#settings-tab-' + section).click();
    await checkOverflow(page, '.settings-drawer,.settings-pane,.settings-pane .seg,.settings-tabs', label + ' settings ' + section);
  }
  await page.locator('.settings-drawer h3').getByRole('button', { name: locale.settings.close, exact: true }).click();
  assert.equal(await page.locator('.settings-drawer').count(), 0, 'Settings close button must be clickable');
}
async function transfer(page, label) {
  await page.locator('.transfer-entry').click();
  await page.waitForSelector('.td-drawer');
  await checkBounds(page, '.td-header button', label);
  await checkOverflow(page, '.td-drawer,.td-header,.td-settings-line,.td-toolbar', label + ' transfer');
  if (await page.locator('.td-expand').count()) {
    await page.locator('.td-expand').first().click();
    await checkOverflow(page, '.td-task,.td-detail-grid,.td-stats', label + ' expanded transfer');
  }
  // Test full width as well as the regular drawer.
  await page.locator('.td-head-btns button').first().click();
  await checkBounds(page, '.td-header button', label + ' full');
  await checkOverflow(page, '.td-drawer,.td-settings-line', label + ' full');
  await page.locator('.td-head-btns button').last().click();
  assert.equal(await page.locator('.td-drawer').count(), 0, 'Transfer close button must be clickable');
}
async function browserChecks() {
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, 'dist', '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    const rel = path.relative(path.join(root, 'dist'), target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [], errors = [];
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const language of languages) {
      const locale = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', language + '.json'), 'utf8'));
      for (const size of [{ width: 900, height: 600 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
        const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(installFixture, language);
        await page.addInitScript(() => { localStorage.setItem('sc.density.user', 'comfy'); });
        await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
        // Also emulate an overlay band in the browser; real WCO is checked separately.
        await page.evaluate(() => document.documentElement.style.setProperty('--window-titlebar-height', '34px'));
        for (const sidebar of [224, 480]) {
          if (sidebar === 480) {
            await page.evaluate(() => localStorage.setItem('sc.sidebar.w', '480')); await page.reload(); await emitSamples(page);
            await page.evaluate(() => document.documentElement.style.setProperty('--window-titlebar-height', '34px'));
          }
          const label = `${language} ${size.width}x${size.height} sidebar=${sidebar}`;
          await checkBounds(page, '.topbar button', label);
          await checkOverflow(page, '.topbar,.content,.sidebar-foot', label);
          await settings(page, locale, label); await transfer(page, label);
          await page.locator('.nav-files').first().click(); await page.waitForSelector('.fm-table');
          await checkOverflow(page, '.fm,.fm-toolbar,.fm-panes', label + ' files');
          await page.locator('.fm-pane').last().locator('input[type=checkbox]').first().check();
          await page.locator('.fm-toolbar').getByRole('button', { name: locale.files.relayBtn }).click();
          await page.waitForSelector('.relay-dialog');
          await checkOverflow(page, '.relay-dialog,.relay-dual,.relay-col-head,.relay-dialog .foot', label + ' relay');
          await page.keyboard.press('Escape');
          await page.locator('.sidebar-foot .btn').nth(1).click(); await page.waitForSelector('[aria-labelledby=manager-title]');
          await checkOverflow(page, '[aria-labelledby=manager-title]', label + ' servers');
          await page.keyboard.press('Escape');
          checks.push(label); console.log('PASS ' + label);
          if (language === 'de' && size.width === 900 && sidebar === 224) await page.screenshot({ path: path.join(out, 'browser-de-900.png') });
        }
        await context.close();
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'browser.json'), JSON.stringify({ version: require('../package.json').version, scope: 'Simulated IPC, 10 languages, 3 window sizes, 2 sidebar widths, comfortable density and emulated title-bar band', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
async function nativeChecks() {
  assert(process.env.SC_ELECTRON_PATH, 'Set SC_ELECTRON_PATH to the current unpacked app');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-layout-'));
  const checks = [];
  const files = fs.readdirSync(path.join(root, 'electron')).filter((n) => n.endsWith('.cjs')).map((n) => 'electron/' + n);
  files.push('dist/index.html', ...fs.readdirSync(path.join(root, 'dist/assets')).map((n) => 'dist/assets/' + n));
  files.push(...fs.readdirSync(path.join(root, 'src/i18n/locales')).map((n) => 'src/i18n/locales/' + n));
  const expected = files.map((file) => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
  const version = require('../package.json').version;
  try {
    for (const scale of process.platform === 'win32' ? [1, 1.25, 1.5] : [1]) {
      const app = await _electron.launch({ executablePath: path.resolve(process.env.SC_ELECTRON_PATH), args: [`--force-device-scale-factor=${scale}`], env: { ...process.env, SC_USER_DATA: path.join(temp, String(scale)) } });
      try {
        assert.equal(await app.evaluate(({ app }) => app.getVersion()), version, 'Packaged app version must match current source');
        const mismatches = await app.evaluate(({ app }, expectedFiles) => {
          const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path'), crypto = process.getBuiltinModule('node:crypto');
          return expectedFiles.filter(({ file, sha256 }) => crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(), file))).digest('hex') !== sha256).map(({ file }) => file);
        }, expected);
        assert.deepEqual(mismatches, [], 'Packaged Electron sources and renderer assets must match current source SHA-256');
        const page = await app.firstWindow(); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForSelector('.sidebar-foot');
        for (const language of ['en', 'de', 'fr', 'ru', 'pt-BR', 'zh-CN']) {
          const locale = require('../src/i18n/locales/' + language + '.json');
          await page.evaluate((lang) => { localStorage.setItem('sc.lang', lang); localStorage.setItem('sc.density.user', 'comfy'); }, language);
          await page.reload(); await page.waitForSelector('.sidebar-foot');
          for (const maximized of [false, true]) {
            await app.evaluate(({ BrowserWindow }, maximize) => { const win = BrowserWindow.getAllWindows()[0]; if (maximize) win.maximize(); else { win.unmaximize(); win.setSize(900, 600); } }, maximized);
            await page.waitForTimeout(200);
            const band = await page.locator('.desktop-titlebar').evaluate((n) => n.getBoundingClientRect().height);
            if (process.platform === 'win32') assert(band >= 34, 'Actual Windows overlay environment must reserve title-bar height');
            const label = `${process.platform} ${language} scale=${scale} maximized=${maximized}`;
            await checkBounds(page, '.topbar button', label); await checkOverflow(page, '.topbar,.content', label);
            await settings(page, locale, label); await transfer(page, label);
            checks.push({ label, titlebarHeight: band }); console.log('PASS ' + label);
          }
        }
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(out, 'native.json'), JSON.stringify({ version, sourceAndAssetSHA256: 'passed', scope: 'Current packaged app, isolated data; real native window chrome; no remote server connections', checks }, null, 2));
  } finally {
    const relative = path.relative(os.tmpdir(), temp);
    assert(relative.startsWith('sc-layout-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Cleanup must stay in the generated test directory');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
fs.mkdirSync(out, { recursive: true });
(process.argv.includes('--native') ? nativeChecks() : browserChecks()).catch((e) => { console.error(e); process.exitCode = 1; });
