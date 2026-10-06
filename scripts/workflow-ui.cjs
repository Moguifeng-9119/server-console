const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');

async function main() {
  const root = path.resolve(__dirname, '../dist'), out = path.resolve(__dirname, '../test-artifacts/workflow'); fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream'); fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [], pass = (s) => { checks.push(s); console.log('PASS ' + s); };
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(installFixture); await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
    await page.locator('.nav-files').first().click(); await page.waitForSelector('.fm-table');
    assert(!/[\u3400-\u9fff]/.test(await page.locator('.fm').innerText())); pass('English file manager labels');
    const file = page.locator('.fm-pane').last().getByRole('button', { name: 'test.txt', exact: true });
    await file.focus(); await page.keyboard.press('Enter'); await page.locator('.viewer-edit').fill('unsaved-draft');
    await page.keyboard.press('Control+k'); assert.equal(await page.locator('.pal-item').count(), 0);
    await page.locator('.nav-server').nth(1).evaluate((el) => el.click()); assert.equal(await page.locator('.viewer-dlg').count(), 1);
    assert.equal(await page.locator('.viewer-edit').inputValue(), 'unsaved-draft'); pass('dirty draft blocks keyboard and direct navigation');
    await page.locator('.viewer-dlg').getByRole('button', { name: 'Close', exact: true }).click(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.viewer-dlg').count(), 1); pass('dirty close and Escape retain draft');
    page.once('dialog', (d) => d.dismiss()); await page.getByRole('button', { name: 'Head', exact: true }).click(); assert.equal(await page.locator('.viewer-edit').inputValue(), 'unsaved-draft'); pass('declining reload preserves text');
    await page.getByRole('button', { name: 'Save to server', exact: true }).click(); assert(await page.locator('.viewer-edit').evaluate((el) => el.readOnly)); assert(await page.getByRole('button', { name: 'Head', exact: true }).isDisabled());
    await page.keyboard.press('Control+k'); assert.equal(await page.locator('.pal-item').count(), 0); await page.locator('.nav-server').nth(1).evaluate((el) => el.click()); assert.equal(await page.locator('.viewer-dlg').count(), 1); pass('save locks editing, reload and navigation');
    await page.evaluate(() => window.__fixture.finishWrite()); await page.waitForFunction(() => !document.querySelector('[data-unsaved=true]')); assert.equal(await page.evaluate(() => window.__fixture.lastWrite[2]), 'unsaved-draft');
    await page.locator('.viewer-dlg').getByRole('button', { name: 'Close', exact: true }).click(); pass('saved text closes normally');
    const checkbox = page.locator('.fm-pane').last().getByRole('checkbox', { name: /test.txt/ }); await checkbox.focus(); await page.keyboard.press('Space'); assert(await checkbox.isChecked()); pass('file selection with keyboard');
    await page.locator('.sidebar-foot button').last().click(); await page.keyboard.press('Delete'); assert.equal(await page.locator('#fm-confirm-title').count(), 0); await page.keyboard.press('Escape'); pass('external modal prevents background file deletion');
    await page.locator('.fm-toolbar').getByRole('button', { name: 'Server relay', exact: true }).click();
    for (let i = 0; i < 20; i++) await page.keyboard.press('Tab'); assert(await page.locator('.relay-dialog').evaluate((el) => el.contains(document.activeElement))); pass('relay traps focus');
    await page.locator('.relay-col').first().locator('.rb-bar button').nth(3).click(); await page.locator('.rb-mk input').focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.rb-mk').count(), 0); assert.equal(await page.locator('.relay-dialog').count(), 1); pass('folder input handles local Escape');
    await page.screenshot({ path: path.join(out, 'relay-en.png') }); await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(out, 'files-en.png') });
    const separator = page.getByRole('separator', { name: /Resize panes/ }); await separator.focus(); const before = await separator.getAttribute('aria-valuenow'); await page.keyboard.press('ArrowRight'); assert(Number(await separator.getAttribute('aria-valuenow')) > Number(before)); pass('pane resize with keyboard');
    await page.locator('.transfer-entry').click(); await page.waitForSelector('progress'); assert.equal(await page.locator('progress').getAttribute('value'), String(2 * 1024 ** 3)); assert((await page.locator('.td-task').innerText()).includes('Verifying saved prefix')); await page.screenshot({ path: path.join(out, 'transfer-en.png') }); pass('prefix progress visible in collapsed task');
    assert.deepEqual(errors, []); pass('workflow renderer has no uncaught errors');
    await context.close();
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt-BR']) {
      const locale = require('../src/i18n/locales/' + language + '.json');
      const localizedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const localized = await localizedContext.newPage();
      localized.on('pageerror', (e) => errors.push(language + ': ' + e.message));
      await localized.addInitScript(installFixture, language);
      await localized.goto(`http://127.0.0.1:${server.address().port}`);
      await emitSamples(localized);
      await localized.waitForSelector('.resource-card');
      assert.equal(await localized.locator('.workbench-heading h1').innerText(), locale.workbench.title);
      await localized.locator('.sidebar-foot button').last().click();
      const selector = localized.locator('select:has(option[value="ja"])');
      await selector.selectOption('en');
      await localized.waitForFunction(() => document.documentElement.lang === 'en');
      await selector.selectOption(language);
      await localized.waitForFunction((code) => localStorage.getItem('sc.lang') === code, language);
      await localized.reload(); await emitSamples(localized); await localized.waitForSelector('.resource-card');
      assert.equal(await localized.locator('.workbench-heading h1').innerText(), locale.workbench.title);
      await localized.locator('.nav-files').first().click(); await localized.waitForSelector('.fm-table');
      assert((await localized.locator('.fm-toolbar').innerText()).includes(locale.files.relayBtn));
      pass(language + ' loads, switches, persists after reload and translates files');
      await localizedContext.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), version: require('../package.json').version, scope: 'production renderer with explicitly simulated IPC', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
