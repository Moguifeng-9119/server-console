const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');

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
        case 'notificationTest': data = true; break;
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
    await page.getByRole('button', { name: 'Rename', exact: true }).first().click(); await page.getByRole('textbox', { name: 'Rename', exact: true }).fill('Training shell'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('button', { name: 'Training shell', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('sc.term.layout.fake1')), 'columns'); pass('terminal split and session rename preserve mounted panes and persist layout');
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
    await page.getByLabel('Import backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'serverconsole-config', version: 1 })) });
    await page.getByRole('button', { name: 'Preview', exact: true }).click(); await page.getByRole('button', { name: 'Import selected backup', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__v18.calls.filter((call) => call.operation === 'backupImport' && call.apply === true).length), 0);
    await page.getByRole('button', { name: 'Import selected backup', exact: true }).click(); await page.getByText('Backup imported. Restart the app to apply appearance and terminal layout settings.', { exact: true }).waitFor(); pass('backup import requires a visible preview before the explicit apply action');
    await page.screenshot({ path: path.join(output, 'tools.png') });
    assert.deepEqual(errors, []); pass('all new workflows have no uncaught renderer errors');
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'Production renderer with explicitly simulated IPC; remote behavior has separate acceptance tests', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
