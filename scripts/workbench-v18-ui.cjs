const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');

async function renameWithDelayedActivation(page) {
  await page.evaluate(() => {
    const timeout = window.setTimeout, clear = window.clearTimeout;
    const state = window.__renameActivation = { timers: new Map(), released: 0 };
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 50 || typeof callback !== 'function') return timeout(callback, delay, ...args);
      const id = timeout(() => {}, 60000); state.timers.set(id, () => callback(...args)); return id;
    };
    window.clearTimeout = (id) => { state.timers.delete(id); clear(id); };
    state.restore = () => { for (const id of state.timers.keys()) clear(id); state.timers.clear(); if (state.focus) document.removeEventListener('focusin', state.focus); window.setTimeout = timeout; window.clearTimeout = clear; };
  });
  try {
    await page.locator('.term-chip-select').first().click(); await page.locator('.term-chip-select').nth(1).click();
    await page.waitForFunction(() => window.__renameActivation.timers.size > 0);
    await page.getByRole('button', { name: 'Rename', exact: true }).first().click();
    await page.evaluate(() => {
      const state = window.__renameActivation, input = document.querySelector('input[aria-label="Rename"]'); input.blur(); state.writes = window.__v18.writes.length;
      state.focus = (event) => { if (event.target !== input) return; document.removeEventListener('focusin', state.focus); queueMicrotask(() => { const callbacks = [...state.timers.values()]; state.released += callbacks.length; for (const callback of callbacks) callback(); }); };
      document.addEventListener('focusin', state.focus);
    });
    await page.getByRole('textbox', { name: 'Rename', exact: true }).fill('Training shell');
    const result = await page.evaluate(() => ({ value: document.querySelector('input[aria-label="Rename"]').value, focus: document.activeElement.getAttribute('aria-label'), released: window.__renameActivation.released, writes: window.__v18.writes.slice(window.__renameActivation.writes) }));
    assert(result.released > 0, 'Regression must release an actual delayed activation'); assert.equal(result.value, 'Training shell'); assert.equal(result.focus, 'Rename'); assert.equal(result.writes.some(([, text]) => text.includes('Training shell')), false);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('button', { name: 'Training shell', exact: true }).waitFor();
  } finally { await page.evaluate(() => window.__renameActivation.restore()); }
}

function installWorkbenchFixture() {
  const original = window.api;
  const state = window.__v18 = { calls: [], writes: [], workspaces: [{ id: 'workspace', serverId: 'fake1', name: 'Training workspace', cwd: '/data/experiment', gpu: '0', sessionName: 'existing train', logPath: '/data/experiment/train.log' }] };
  window.api = new Proxy(original, { get: (target, key) => {
    if (key === 'terminalWrite') return (...args) => { state.writes.push(args); return Promise.resolve(true); };
    if (key === 'historyQuery') return (query) => {
      state.calls.push({ operation: 'historyQuery', ...query });
      const end = query.end || Date.now();
      return Promise.resolve({ start: end - query.rangeMs, end, stepMs: 5000, rawHours: 24, retentionDays: 30,
        devices: [{ device: 'all', label: 'All GPUs', metric: 'util' }, { device: 'system', label: 'System', metric: 'cpu' }, { device: 'disk:nvme0', label: 'nvme0', metric: 'readBytesPerSecond' }, ...Array.from({ length: 9 }, (_, index) => ({ device: 'gpu:' + index, label: 'GPU ' + index, metric: 'util' }))],
        points: [{ at: end - 5000, value: query.device.startsWith('disk:') ? 1024 ** 2 : 50, min: 10, max: query.device.startsWith('disk:') ? 1024 ** 2 : 90, coveredMs: 5000, gap: false }] });
    };
    if (key === 'workbenchRequest') return (request) => {
      state.calls.push(request); let data;
      if (request.operation === 'backupImport' && request.apply && state.holdImport) return new Promise((resolve) => { state.completeImport = () => { state.mainApplied = true; resolve({ ok: true, data: { imported: true } }); }; });
      switch (request.operation) {
        case 'system': data = { filesystems: [], inodes: [], disks: [], networks: [], capabilities: { ratesReady: true } }; break;
        case 'envList': case 'taskList': case 'usageReport': case 'templateList': data = []; break;
        case 'workspaceList': data = state.workspaces.filter((item) => item.serverId === request.serverId); break;
        case 'workspaceSave': { const item = { ...request.workspace, id: 'saved-workspace' }; state.workspaces.push(item); data = item; break; }
        case 'workspaceDelete': state.workspaces = state.workspaces.filter((item) => item.id !== request.id); data = true; break;
        case 'eventList': data = [{ id: 'event', serverId: request.serverId, at: Date.now() - 2500, title: 'Fixture task completed', type: 'task' }]; break;
        case 'tmux.list': data = { available: true, sessions: [{ name: 'existing train', windows: 1, attached: 0 }] }; break;
        case 'tmux.attach': data = { command: "tmux attach-session -t 'existing train'" }; break;
        case 'gpuDiagnostics': data = { at: Date.now(), available: true, devices: [{ index: 0, uuid: 'fixture', metrics: { pstate: { value: 'P0', supported: true }, 'ecc.mode.current': { value: null, supported: false } } }], layout: 'GPU 0: SIMULATED' }; break;
        case 'slurmJobs': data = { available: true, jobs: [{ id: '123', name: 'training', user: 'demo', state: 'RUNNING', elapsed: '00:10', nodes: '1', reason: '' }] }; break;
        case 'slurmDetail': data = { id: request.jobId, fields: { JobId: '123' }, raw: 'JobId=123' }; break;
        case 'slurmLog': data = { id: request.jobId, path: '/data/slurm-123.out', text: 'SLURM FIXTURE OUTPUT' }; break;
        case 'diagnostics': data = { writesPerformed: false, checks: [{ name: 'SSH', status: 'ok' }] }; break;
        case 'notificationGet': data = { enabled: false, configured: false }; break;
        case 'notificationSave': data = { enabled: request.settings.enabled }; break;
        case 'notificationTest': data = state.notificationResult || { delivered: true }; break;
        case 'backupExport': data = { format: 'serverconsole-config', version: 1, credentialsIncluded: false }; break;
        case 'backupImport': data = request.apply ? { imported: true } : { counts: { workspaces: 1 }, preview: true }; break;
        default: data = {};
      }
      return Promise.resolve({ ok: true, data });
    };
    return target[key];
  } });
}
async function main() {
  const root = path.resolve(__dirname, '../dist'), output = path.resolve(__dirname, '../test-artifacts/workbench-v18');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(target)] || 'application/octet-stream'); fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser; const checks = [], errors = [], pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((candidate) => candidate && fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(installFixture); await page.addInitScript(installWorkbenchFixture);
    await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
    const open = async () => page.evaluate(() => window.dispatchEvent(new CustomEvent('sc:workbench', { detail: { serverId: 'fake1' } })));
    await open(); await page.getByRole('button', { name: 'Experiment workspaces', exact: true }).click(); await page.getByRole('heading', { name: /Training workspace/ }).waitFor();
    assert.equal(await page.locator('.workcenter-nav-group').count(), 4); pass('work center has grouped navigation and saved experiment cards');
    await page.locator('.workspace-card').getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.waitForFunction(() => window.__v18.writes.some(([, command]) => command.includes('tmux attach-session')));
    assert.equal(await page.evaluate(() => window.__v18.writes.filter(([, command]) => command.includes('tmux attach-session')).length), 1);
    await page.locator('.nav-server').nth(1).click(); await page.locator('.nav-server').first().click(); await page.locator('.tabs').getByRole('button', { name: /Terminal/ }).click();
    assert.equal(await page.evaluate(() => window.__v18.writes.filter(([, command]) => command.includes('tmux attach-session')).length), 1); pass('workspace terminal command executes once after terminal attach and survives navigation');
    await page.locator('.term-chip.add').click(); await page.waitForFunction(() => document.querySelectorAll('.term-host').length >= 2);
    await page.getByRole('button', { name: 'Columns', exact: true }).click(); await page.waitForFunction(() => [...document.querySelectorAll('.terminal-split.columns .term-host')].filter((node) => getComputedStyle(node).display !== 'none').length === 2);
    const heights = await page.evaluate(async () => { const values = []; for (let frame = 0; frame < 20; frame++) { await new Promise(requestAnimationFrame); values.push(document.querySelector('.terminal-split').getBoundingClientRect().height); } return values; });
    assert(Math.max(...heights) - Math.min(...heights) < 2, 'split height must not grow through fit feedback');
    for (let index = 0; index < 2; index++) {
      const host = page.locator('.term-host:visible').nth(index); const termId = await host.getAttribute('data-term-id');
      await host.locator('.xterm-screen').click(); await page.keyboard.type('focus-probe');
      assert.equal(await page.evaluate(() => window.__v18.writes.at(-1)[0]), termId);
    }
    pass('split height stays bounded and real mouse clicks route input to each pane');
    await renameWithDelayedActivation(page); pass('delayed terminal activation cannot steal form input or send it remotely');
    assert.equal(await page.evaluate(() => localStorage.getItem('sc.term.layout.fake1')), 'columns'); pass('terminal split and session rename preserve mounted panes and persist layout');
    await page.locator('.term-chip.add').click();
    await page.waitForFunction(() => document.querySelectorAll('.term-host').length >= 3);
    await page.waitForFunction(() => [...document.querySelectorAll('.term-host')].filter((node) => getComputedStyle(node).display !== 'none').length === 2);
    const splitBefore = await page.locator('.term-host:visible').evaluateAll((nodes) => nodes.map((node) => node.dataset.termId));
    await page.locator('.term-host:visible').first().locator('.xterm-screen').click();
    assert.deepEqual(await page.locator('.term-host:visible').evaluateAll((nodes) => nodes.map((node) => node.dataset.termId)), splitBefore);
    pass('focusing one of three terminals leaves both split panes unchanged');
    const sessions = await page.evaluate(async () => (await window.api.terminalList()).filter((session) => session.serverId === 'fake1'));
    const displayed = await page.locator('.term-host:visible').evaluateAll((nodes) => nodes.map((node) => node.dataset.termId));
    const hiddenIndex = sessions.findIndex((session) => !displayed.includes(session.termId));
    assert(hiddenIndex >= 0, 'third terminal must be hidden before replacement');
    const stablePane = page.locator('.term-host[data-term-id="' + displayed[0] + '"]');
    const stableBefore = await stablePane.boundingBox();
    await page.locator('.term-host:visible').nth(1).locator('.xterm-screen').click();
    await page.locator('.term-chip-select').nth(hiddenIndex).click();
    const stableAfter = await stablePane.boundingBox();
    assert(stableBefore && stableAfter && Math.abs(stableBefore.x - stableAfter.x) < 1, 'unselected split pane must stay on the same side');
    pass('replacing one terminal keeps the other pane in place');
    const closeAndCheck = async (side) => {
      const panels = await page.locator('.term-host:visible').evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.termId, x: node.getBoundingClientRect().x })).sort((a, b) => a.x - b.x));
      const survivor = panels[side === 0 ? 1 : 0], removed = panels[side];
      const ordered = await page.evaluate(async () => (await window.api.terminalList()).filter((session) => session.serverId === 'fake1'));
      const index = ordered.findIndex((session) => session.termId === removed.id);
      await page.locator('.term-chip').nth(index).getByRole('button', { name: /^End this session/ }).click();
      await page.locator('.term-host[data-term-id="' + removed.id + '"]').waitFor({ state: 'detached' });
      const after = await page.locator('.term-host[data-term-id="' + survivor.id + '"]').boundingBox();
      assert(after && Math.abs(after.x - survivor.x) < 1, 'closing one side must preserve the surviving pane position');
    };
    await closeAndCheck(0);
    await page.locator('.term-chip.add').click(); await page.waitForFunction(() => document.querySelectorAll('.term-host').length >= 3);
    await closeAndCheck(1);
    pass('closing either split side preserves the other terminal position');
    await page.getByRole('button', { name: 'tmux', exact: true }).click(); await page.getByRole('button', { name: 'Attach', exact: true }).click();
    await page.waitForFunction(() => window.__v18.writes.filter(([, command]) => command.includes('tmux attach-session')).length === 2); pass('tmux discovery attaches a selected remote session in a new terminal');
    await page.locator('.tabs').getByRole('button', { name: 'History monitoring', exact: true }).click(); await page.locator('.monitor-chart').waitFor();
    await page.getByLabel('GPU 0', { exact: true }).check(); await page.locator('.history-legend').getByText('GPU 0', { exact: true }).waitFor();
    for (let i = 1; i < 7; i++) await page.getByLabel('GPU ' + i, { exact: true }).check();
    assert(await page.getByLabel('GPU 7', { exact: true }).isDisabled()); pass('historical comparison limits the chart to eight series');
    await page.getByLabel('End time', { exact: true }).fill('2026-10-20T10:30'); await page.locator('.monitor-chart').waitFor();
    await page.getByRole('button', { name: 'Live', exact: true }).click(); assert.equal(await page.getByLabel('End time', { exact: true }).inputValue(), ''); pass('history end-time control returns to live without stale field state');
    await page.locator('.monitor-toolbar select').first().selectOption('disk:nvme0'); await page.locator('.monitor-stats').getByText(/MiB\/s/).first().waitFor(); pass('disk I/O history uses rate units');
    await page.locator('.history-events summary').click(); await page.locator('.history-events').getByText(/Fixture task completed/).waitFor(); pass('history shows task events on the selected timeline');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV', exact: true }).click(); assert((await download).suggestedFilename().endsWith('.csv')); pass('historical series export as CSV');
    await open(); await page.getByRole('button', { name: 'GPU diagnostics', exact: true }).click(); await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await page.getByRole('cell', { name: 'Unavailable', exact: true }).waitFor(); pass('GPU diagnostics disclose unsupported metrics');
    await page.getByRole('button', { name: 'Slurm jobs', exact: true }).click(); await page.getByLabel('Job ID', { exact: true }).fill('123'); await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await page.locator('.workcenter-output').getByText(/JobId=123/).waitFor();
    await page.getByRole('button', { name: 'Logs', exact: true }).click(); await page.getByText('SLURM FIXTURE OUTPUT', { exact: true }).waitFor(); pass('Slurm job details and owned output log requests carry the selected job');
    await page.getByRole('button', { name: 'Diagnostics & backup', exact: true }).click(); await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click(); await page.locator('.workcenter-output').getByText(/writesPerformed/).waitFor();
    await page.evaluate(() => { window.__v18.notificationResult = { delivered: false, reason: 'disabled' }; });
    await page.getByRole('button', { name: 'Send test', exact: true }).click();
    await page.getByRole('alert').getByText(/Notification not delivered/).waitFor();
    pass('a disabled notification cannot be reported as delivered');
    await page.getByLabel('Import backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'serverconsole-config', version: 1, presentation: { 'sc.theme.user': 'dark' } })) });
    await page.getByRole('button', { name: 'Preview', exact: true }).click(); await page.getByRole('button', { name: 'Import selected backup', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__v18.calls.filter((call) => call.operation === 'backupImport' && call.apply === true).length), 0);
    await page.evaluate(() => { window.__v18.holdImport = true; });
    await page.getByRole('button', { name: 'Import selected backup', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__v18.completeImport));
    await page.locator('.nav > button').first().click();
    await page.evaluate(() => window.__v18.completeImport());
    await page.waitForFunction(() => window.__v18.mainApplied && localStorage.getItem('sc.theme.user') === 'dark');
    pass('a committed backup remains applied when leaving the work center');
    assert.deepEqual(errors, []); pass('all new workflows have no uncaught renderer errors');
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'Production renderer with explicitly simulated IPC; remote behavior has separate acceptance tests', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
