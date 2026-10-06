// Production renderer regression with simulated IPC, large directories and slow remote I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright-core');
const {installFixture, emitSamples} = require('./renderer-fixture.cjs');

async function main() {
  const root = path.resolve(process.env.SC_RENDERER_ROOT || path.join(__dirname, '../dist'));
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const checks = [], errors = [], pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(installFixture);
    await page.addInitScript(() => {
      const original = window.api;
      const entries = Array.from({length: 12000}, (_, i) => ({name: 'checkpoint-' + (i * 9973 % 12000) + '.pt', type: 'file', size: i, mtime: Date.now(), path: '/home/demo/checkpoint-' + i + '.pt'}));
      window.__navigation = {calls: {}, remoteResolvers: [], holdRemote: false};
      window.api = new Proxy(original, {get: (api, key) => {
        if (String(key).startsWith('on') || key === 'platform') return api[key];
        return (...args) => {
          window.__navigation.calls[key] = (window.__navigation.calls[key] || 0) + 1;
          if (key === 'localList' || key === 'sftpList') return Promise.resolve({ok: true, data: {path: '/home/demo', entries}});
          if (key === 'sftpHome' && window.__navigation.holdRemote) return new Promise((resolve) => window.__navigation.remoteResolvers.push(resolve));
          if (key === 'terminalList' && window.__navigation.calls.terminalList === 1) return new Promise((resolve) => {
            setTimeout(() => { void original.terminalOpen('fake1', 80, 24); }, 20);
            setTimeout(() => resolve([]), 100);
          });
          if (key === 'terminalAttach') return new Promise((resolve) => {
            const id = args[0];
            setTimeout(() => {
              window.__fixture.callbacks.onTerminalData({termId: id, data: 'snapshot-' + id + '\r\n', sequence: 1});
              window.__fixture.callbacks.onTerminalData({termId: id, data: 'live-' + id + '\r\n', sequence: 2});
              resolve({data: 'snapshot-' + id + '\r\n', sequence: 1});
            }, 10);
          });
          return api[key](...args);
        };
      }});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
    await page.locator('.nav-files').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.fm-pane')].every((pane) => pane.querySelectorAll('tbody tr:not(.fm-more)').length === 500) && document.querySelectorAll('.fm-pane').length === 2);
    assert.deepEqual(await page.locator('.fm-pane').evaluateAll((panes) => panes.map((pane) => pane.querySelectorAll('tbody tr:not(.fm-more)').length)), [500, 500]);
    pass('12000-file directories render with bounded initial rows');
    await page.waitForFunction(() => typeof window.__fixture.callbacks.onTransferUpdate === 'function');
    const timings = [];
    for (let i = 0; i < 5; i++) timings.push(await page.evaluate(async () => {
      const start = performance.now();
      window.__fixture.callbacks.onStatus({id: 'fake2', status: 'online', error: ''});
      window.__fixture.callbacks.onTransferUpdate({...window.__fixture.tasks[0], transferred: 1000});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - start;
    }));
    const navigation = [];
    for (let i = 0; i < 8; i++) navigation.push(await page.evaluate(async (index) => {
      const start = performance.now();
      document.querySelectorAll('.nav-server')[index].click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {ms: performance.now() - start, title: document.querySelector('.topbar .title').textContent};
    }, i % 2 ? 0 : 1));
    assert(navigation.every((row, i) => row.title === (i % 2 ? 'Demo training' : 'Demo inference')));
    pass('a single click selects each server during large-directory updates');
    if (!process.env.SC_NAV_BENCH_ONLY) {
      assert(Math.max(...timings) < 700, 'Background updates must not repeatedly block the renderer with directory sorts');
      assert(Math.max(...navigation.map((row) => row.ms)) < 700, 'One-click navigation must paint promptly');
      await page.locator('.nav > button').first().click();
      await page.evaluate(() => { window.__navigation.holdRemote = true; });
      await page.locator('.nav-files').nth(1).click();
      await page.waitForFunction(() => window.__navigation.remoteResolvers.length > 0);
      await page.waitForFunction(() => document.querySelectorAll('.fm-pane:first-child tbody tr').length >= 500);
      await page.locator('.nav-server').first().click();
      assert.equal(await page.locator('.topbar .title').innerText(), 'Demo training');
      await page.evaluate(() => { window.__navigation.remoteResolvers.splice(0).forEach((resolve) => resolve({ok: true, data: '/home/demo'})); window.__navigation.holdRemote = false; });
      pass('pending remote directory requests do not prevent local loading or server navigation');
      await page.getByRole('button', {name: 'Terminal', exact: true}).click();
      await page.waitForSelector('.term-host:visible .xterm');
      await page.waitForFunction(() => window.__scTerm?.dump().includes('live-'));
      const firstReplay = await page.evaluate(() => window.__scTerm.dump());
      assert.equal(firstReplay.split(/\r?\n/).filter((line) => line.startsWith('snapshot-')).length, 1);
      assert(firstReplay.indexOf('snapshot-') < firstReplay.indexOf('live-'));
      assert.equal(await page.locator('.term:visible .term-chip:not(.add)').count(), 1);
      pass('attach replay precedes queued live output exactly once; stale lists cannot erase newer sessions');
      await page.locator('.term:visible .term-chip.add').click();
      await page.waitForFunction(() => Object.keys(window.__scTerms || {}).length === 2);
      const attached = await page.evaluate(() => window.__navigation.calls.terminalAttach);
      await page.locator('.term:visible .term-chip-select').first().click();
      await page.locator('.nav-server').nth(1).click();
      await page.getByRole('button', {name: 'Terminal', exact: true}).click();
      await page.waitForFunction(() => Object.keys(window.__scTerms || {}).length === 3);
      await page.locator('.nav > button').first().click(); await page.locator('.nav-server').first().click();
      assert.equal(await page.locator('.term:visible .term-chip-select').first().getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__navigation.calls.terminalAttach), attached + 1);
      assert.equal(await page.evaluate(() => window.__navigation.calls.terminalDetach || 0), 0);
      pass('terminal/server/overview switches retain panes without attaching again or detaching');
      const focusBefore = await page.evaluate(() => window.__navigation.calls.setFocusedServer);
      await page.getByRole('button', {name: /^Processes/}).click();
      await page.getByRole('button', {name: 'Terminal', exact: true}).click();
      assert.equal(await page.evaluate(() => window.__navigation.calls.setFocusedServer), focusBefore);
      pass('same-server tab switches do not reschedule backend focus');
    }
    assert.deepEqual(errors, []); pass('navigation has no uncaught renderer errors');
    const output = path.resolve(process.env.SC_NAV_OUTPUT || path.join(__dirname, '../test-artifacts/navigation/checks.json'));
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, JSON.stringify({version: require('../package.json').version, source: root, scope: 'Production renderer, simulated IPC, 12000 files per pane; timings are local synthetic measurements', checks, updateFrameMs: timings, navigation, errors}, null, 2));
    console.log(JSON.stringify({updateFrameMs: timings, navigationMs: navigation.map((row) => row.ms)}));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
