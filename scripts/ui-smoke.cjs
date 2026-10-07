// Browser checks exercise the production renderer with explicit simulated data.
// They do not prove Electron IPC, real GPU sampling or packaged app behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '../dist');
const artifacts = path.resolve(process.env.SC_SCREENSHOT_DIR || path.join(__dirname, '../test-artifacts/ui'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const checks = [];
const pass = (name) => { checks.push(name); console.log('PASS ' + name); };

async function main() {
  assert(fs.existsSync(path.join(root, 'index.html')), 'Run npm run build first');
  fs.mkdirSync(artifacts, {recursive: true});
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
      fs.createReadStream(target).pipe(res);
    } catch { res.writeHead(400); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const candidates = [process.env.SC_BROWSER_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    const executablePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      let seed = 3119;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      localStorage.setItem('sc.lang', 'zh-CN');
      localStorage.setItem('sc.theme.user', 'light');
      localStorage.setItem('sc.refreshMs', '10000');
      localStorage.removeItem('sc.view');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('.resource-card');
    assert.equal(await page.locator('.resource-card').count(), 5); pass('simulated fleet renders');
    assert.equal(await page.locator('.toast').count(), 0); pass('demo sends no anomaly toasts');
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)); pass('1440px viewport has no page overflow');
    await page.screenshot({path: path.join(artifacts, 'workbench-light.png')});

    await page.locator('.resource-toolbar input[type=number]').fill('40');
    assert(await page.locator('.resource-card').count() > 0);
    const free = await page.locator('.resource-gpu.matches').evaluateAll((cards) => cards.map((card) => Number(card.dataset.freeGib)));
    assert(free.length > 0 && free.every((value) => value >= 40)); pass('40 GiB filter uses individual cards');
    await page.locator('.resource-toolbar input[type=number]').fill('10000');
    await page.waitForSelector('.resource-empty');
    await page.locator('.resource-empty button').click();
    assert.equal(await page.locator('.resource-card').count(), 5); pass('empty filter result can reset');
    await page.locator('.resource-search input').fill('chen');
    assert.equal(await page.locator('.resource-card').count(), 1); pass('GPU owner search');
    await page.locator('.resource-search input').fill('');

    await page.locator('.resource-card').first().locator('.resource-actions button').nth(1).click();
    assert.equal(await page.locator('.tabs button.on').textContent(), '终端'); pass('terminal shortcut opens correct tab');
    await page.locator('.nav > button').first().click();
    await page.locator('.resource-card').first().locator('.resource-actions button').nth(2).click();
    assert.equal(await page.locator('.tabs button.on').textContent(), '文件'); pass('files shortcut opens correct tab');
    await page.locator('.nav > button').first().click();
    await page.locator('.resource-card').first().locator('.resource-actions button').first().click();
    await page.waitForSelector('.gpu-list.matrix'); pass('multi-GPU detail defaults to compact matrix');
    await page.screenshot({path: path.join(artifacts, 'gpu-matrix.png')});
    await page.locator('.gpu-proc-line button').first().click();
    await page.locator('.ctx-menu button').nth(2).focus();
    const selectedAction = await page.evaluate(() => document.activeElement.textContent);
    await page.waitForTimeout(5200);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), selectedAction); pass('monitor render does not reset process menu focus');
    await page.keyboard.press('Escape');
    await page.locator('.nav > button').first().click();

    const settings = page.locator('.sidebar-foot button').last();
    await settings.click();
    await page.waitForSelector('.settings-drawer');
    for (let i = 0; i < 18; i++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('.settings-drawer').contains(document.activeElement))); pass('settings traps keyboard focus');
    await page.screenshot({path: path.join(artifacts, 'settings.png')});
    await page.locator('.settings-tabs button').nth(2).click();
    assert.equal(await page.locator('.credential-status').count(), 1); pass('security explains actual credential mode');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.settings-drawer').count(), 0);
    assert(await settings.evaluate((element) => element === document.activeElement)); pass('Escape closes dialog and restores focus');

    await page.locator('.transfer-entry').click();
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.pal-item');
    assert(await page.evaluate(() => {
      const input = document.activeElement, rect = input.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === input;
    })); pass('palette above transfer drawer is visible and focused');
    const commands = await page.locator('.pal-item').allTextContents();
    assert.equal(new Set(commands).size, commands.length); pass('command palette has no duplicate server actions');
    await page.keyboard.press('Escape');
    await page.locator('.td-head-btns button').last().click();

    await page.locator('.sidebar-foot button').nth(1).click();
    await page.locator('.dialog').getByRole('button', {name: '从 ~/.ssh/config 一键导入'}).click();
    await page.waitForSelector('.import-dlg');
    await page.locator('.import-dlg input').first().focus();
    assert(await page.evaluate(() => document.querySelector('.import-dlg').contains(document.activeElement))); pass('nested import dialog keeps its own focus');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.import-dlg').count(), 0);
    assert.equal(await page.locator('[aria-labelledby=manager-title]').count(), 1); pass('Escape only closes top nested dialog');
    await page.keyboard.press('Escape');

    await page.locator('.alert-entry').click();
    assert(await page.locator('.alert-record').count() > 0); pass('demo alert details render');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.locator('.resource-footer button').first().click();
    assert.equal(await page.locator('.history-dialog').count(), 1); pass('timestamped history has a visible entry');
    await page.keyboard.press('Escape');

    await settings.click();
    await page.locator('.settings-drawer select').first().selectOption('en');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('h1').textContent(), 'Find a GPU. Start your work.');
    assert(!/[\u4e00-\u9fff]/.test(await page.locator('.content').innerText())); pass('English resource workbench has translated business labels');
    await page.screenshot({path: path.join(artifacts, 'workbench-en.png')});
    await settings.click();
    await page.locator('.settings-pane .seg').first().getByRole('button', {name: 'Dark', exact: true}).click();
    await page.keyboard.press('Escape');
    await page.screenshot({path: path.join(artifacts, 'workbench-dark.png')});
    await page.setViewportSize({width: 900, height: 600});
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)); pass('900px viewport has no page overflow');
    await page.screenshot({path: path.join(artifacts, 'workbench-narrow.png')});
    assert.deepEqual(errors, []); pass('no uncaught renderer errors');
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({at: new Date().toISOString(),scope: 'production renderer browser demo',checks,errors}, null, 2));
    console.log(`${checks.length} UI checks passed; screenshots: ${artifacts}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
