// Product illustration, with simulated IPC and a persistent visible caption.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');

async function main() {
  const root = path.resolve(__dirname, '../dist');
  const out = path.resolve(__dirname, '../test-artifacts/demo');
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(target)] || 'application/octet-stream');
      fs.createReadStream(target).pipe(res);
    } catch { res.writeHead(400); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: out, size: { width: 1440, height: 1000 } } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(installFixture);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await emitSamples(page);
    await page.waitForSelector('.resource-card');
    await page.locator('.resource-toolbar input[type=number]').fill('40');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(out, 'workbench-en.png') });
    await page.getByRole('button', { name: 'Inspect', exact: true }).first().click();
    await page.locator('.tabs button').nth(1).click();
    await page.waitForTimeout(4000);
    await page.locator('.tabs button').nth(3).click();
    await page.waitForSelector('.xterm-screen');
    await page.waitForTimeout(5000);
    await page.locator('.tabs button').nth(2).click();
    await page.waitForTimeout(3500);
    await page.locator('.fm-pane').last().getByRole('checkbox', { name: /test.txt/ }).check();
    await page.locator('.fm-toolbar').getByRole('button', { name: 'Server relay', exact: true }).click();
    await page.waitForSelector('.relay-dialog');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(out, 'relay-en.png') });
    await page.keyboard.press('Escape');
    await page.locator('.transfer-entry').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(out, 'transfer-en.png') });
    assert.deepEqual(errors, []);
    const video = page.video();
    await context.close();
    await video.saveAs(path.join(out, 'workflow.webm'));
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ at: new Date().toISOString(), version: require('../package.json').version, scope: 'simulated product illustration; no real SSH or user data', scenes: ['GPU memory filter', 'process owner', 'terminal', 'files', 'server relay', 'resume verification progress'], errors }, null, 2));
    console.log('Demo saved to test-artifacts/demo/workflow.webm');
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
