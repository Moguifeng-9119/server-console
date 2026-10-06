// Production renderer with explicitly simulated IPC and controlled locale fetch failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture } = require('./renderer-fixture.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const root = path.resolve(__dirname, '../dist');
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html'));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', path.extname(target) === '.js' ? 'text/javascript' : path.extname(target) === '.css' ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [];
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((file) => file && fs.existsSync(file));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const scenarios = [
      { name: 'first start uses system language', browser: 'ja-JP', expected: 'ja' },
      { name: 'main persisted language restores without local preference', persisted: 'fr', expected: 'fr' },
      { name: 'invalid local preference does not erase valid main language', saved: 'invalid', persisted: 'de', expected: 'de' },
      { name: 'failed language switch retains current preference and shows error', saved: 'en', expected: 'en', blocked: true, switchFailure: true },
      { name: 'startup locale failure keeps usable English and preserves saved preference', saved: 'de', expected: 'en', blocked: true, startupFailure: true },
      { name: 'delayed language request cannot override a later English selection', saved: 'en', expected: 'en', delayed: true },
    ];
    for (const scenario of scenarios) {
      const context = await browser.newContext(); const page = await context.newPage();
      await page.addInitScript(installFixture);
      await page.addInitScript((scenario) => {
        localStorage.removeItem('sc.lang');
        if (scenario.saved) localStorage.setItem('sc.lang', scenario.saved);
        Object.defineProperty(navigator, 'language', { configurable: true, get: () => scenario.browser || 'en-US' });
        const original = window.api; window.__languageCalls = [];
        window.api = new Proxy(original, { get(target, key) {
          if (key === 'getAppSettings') return async () => ({ closeAction: 'ask', language: scenario.persisted });
          if (key === 'setAppLanguage') return async (code) => { window.__languageCalls.push(code); return true; };
          return Reflect.get(target, key);
        } });
      }, scenario);
      if (scenario.blocked || scenario.delayed) await page.route('**/assets/de-*.js', async (route) => {
        if (scenario.blocked) await route.abort(); else { await sleep(1400); await route.continue(); }
      });
      await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForSelector('.nav');
      assert.equal(await page.evaluate(() => document.documentElement.lang), scenario.expected);
      if (scenario.switchFailure || scenario.delayed) {
        await page.locator('.sidebar-foot .btn').last().click();
        const selector = page.locator('.settings-pane select').first();
        await selector.selectOption('de');
        if (scenario.delayed) {
          assert.equal(await selector.inputValue(), 'de');
          await selector.focus();
          // Native select uses typeahead on Windows, Linux and macOS; Home is platform-dependent.
          await selector.press('e');
          await selector.press('Enter');
          assert.equal(await selector.inputValue(), 'en');
          await page.waitForTimeout(1800);
          assert.equal(await selector.inputValue(), 'en');
        }
        else await page.waitForFunction(() => !!document.querySelector('.inline-status')?.textContent);
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
        assert.equal(await page.evaluate(() => localStorage.getItem('sc.lang')), 'en');
        assert(!(await page.evaluate(() => window.__languageCalls)).includes('de'));
      } else if (scenario.startupFailure) {
        assert.equal(await page.evaluate(() => localStorage.getItem('sc.lang')), 'de');
        assert.deepEqual(await page.evaluate(() => window.__languageCalls), []);
        assert((await page.locator('.toast').allTextContents()).join(' ').includes('English'));
      } else {
        assert.equal(await page.evaluate(() => localStorage.getItem('sc.lang')), scenario.expected);
        assert((await page.evaluate(() => window.__languageCalls)).includes(scenario.expected));
      }
      checks.push(scenario.name); console.log('PASS ' + scenario.name); await context.close();
    }
    const out = path.resolve(__dirname, '../test-artifacts/languages'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ version: require('../package.json').version, scope: 'simulated IPC; production assets; controlled network failures', checks }, null, 2));
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
