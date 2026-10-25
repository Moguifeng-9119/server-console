// Production renderer with simulated IPC; this does not establish remote-host acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');

function installRegressionFixture() {
  const original = window.api;
  const state = window.__regression = { calls: [], holds: {}, lists: {}, previewCount: 0, applyCount: 0 };
  const ok = (data) => ({ ok: true, data });
  const tasks = (serverId) => [{ id: 'task-' + serverId, serverId, name: 'Task ' + serverId, cwd: '/task/project', command: 'echo fixture', status: 'saved' }];
  const output = (request) => {
    const id = request.serverId;
    switch (request.operation) {
      case 'system': return { at: Date.now(), platform: 'linux', filesystems: [{ mount: '/fixture-' + id, available: 1024, percent: 10 }], inodes: [], disks: [], networks: [], capabilities: { ratesReady: true } };
      case 'taskList': return tasks(id);
      case 'watchList': return [{ id: 'watch-' + id, serverId: id, minFreeGiB: 40, durationSeconds: 30, enabled: true }];
      case 'ruleList': return [{ id: 'rule-' + id, serverId: id, name: 'Rule ' + id, metric: 'temperature', threshold: 85, durationSeconds: 30 }];
      case 'eventList': return [{ id: 'event-' + id, serverId: id, at: Date.now(), title: 'Event ' + id }];
      case 'containers': return { available: true, engine: 'docker', stats: [], containers: [{ id: 'fixture-container', name: 'Container ' + id, image: 'fixture:image', status: 'running' }] };
      case 'containerLogs': return { text: 'Container logs ' + id };
      case 'containerShell': return { command: 'docker exec -it fixture-container sh' };
      case 'templateList': return [{ id: 'template', name: 'Template fixture', command: 'echo {{message}}' }];
      case 'templateRender': return { command: 'echo rendered' };
      case 'process': return { pid: request.pid, startTicks: '98765', cwd: '/process/' + request.pid };
      case 'report': return { start: Date.now() - 604800000, end: Date.now(), note: 'Recorded fixture coverage', devices: [{ device: 'gpu:fixture', label: 'Report ' + id, average: 25, peak: 80, coveragePercent: 90, busyEquivalentHours: 3 }], tasks: [] };
      case 'serviceTemplate': return { serverId: id, name: request.name, remoteHost: '127.0.0.1', remotePort: request.remotePort, localPort: request.localPort, url: 'http://127.0.0.1:' + request.localPort, command: 'echo service' };
      case 'tmuxList': return ['fixture-session'];
      default: return {};
    }
  };
  window.api = new Proxy(original, { get: (target, key) => {
    if (key === 'workbenchRequest') return (request) => {
      state.calls.push(request);
      const holdKey = request.operation + ':' + request.serverId;
      if (state.holds[holdKey]) return new Promise((resolve) => { state.holds[holdKey] = () => resolve(ok(output(request))); });
      return Promise.resolve(ok(output(request)));
    };
    if (key === 'sftpHome') return (serverId) => new Promise((resolve) => { state.holds['home:' + serverId] = () => resolve(ok('/home/demo')); });
    if (key === 'sftpList' || key === 'localList') return (...args) => {
      const directory = key === 'sftpList' ? args[1] : args[0];
      const result = ok({ path: directory, entries: [] });
      if (directory === '/slow') return new Promise((resolve) => { state.lists.slow = () => resolve(result); });
      return Promise.resolve(result);
    };
    if (key === 'syncPreview') return (request) => {
      state.previewCount += 1; state.previewRequest = request;
      return new Promise((resolve) => { state.holds.preview = () => resolve(ok({ id: 'preview-' + state.previewCount, changes: [{ path: 'fixture.txt', action: 'copy', size: 12 }], unchanged: 0, skipped: [] })); });
    };
    if (key === 'syncApply') return (id) => { state.applyCount += 1; state.appliedPlan = id; return Promise.resolve(ok({ id: 'run', status: 'done', taskIds: [], deleted: 0 })); };
    if (key === 'kill') return (...args) => { state.lastKill = args; return Promise.resolve({ ok: true }); };
    if (key === 'historyQuery') return (query) => Promise.resolve({ start: query.end - query.rangeMs, end: query.end, stepMs: 5000, rawHours: 24, retentionDays: 30,
      devices: [{ device: 'all', metric: 'util', label: 'All GPUs' }, { device: 'system', metric: 'cpu', label: 'System' }, { device: 'disk:nvme0n1', metric: 'readBytesPerSecond', label: 'nvme0n1' }, { device: 'disk:nvme0n1', metric: 'busyPercent', label: 'nvme0n1' }, { device: 'network:eth0', metric: 'receiveBytesPerSecond', label: 'eth0' }, { device: 'mount:/data', metric: 'availableBytes', label: '/data' }],
      points: [{ at: query.end - 5000, value: query.metric === 'availableBytes' ? 1024 ** 3 : query.metric.endsWith('BytesPerSecond') ? 1024 ** 2 : 40, min: 0, max: query.metric === 'availableBytes' ? 1024 ** 3 : query.metric.endsWith('BytesPerSecond') ? 1024 ** 2 : 40, coveredMs: 5000, gap: false }] });
    return target[key];
  } });
}

async function main() {
  const root = path.resolve(__dirname, '../dist');
  const out = path.resolve(__dirname, '../test-artifacts/ui-finalize'); fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const checks = [], errors = [], pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  let browser;
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((candidate) => candidate && fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(installFixture); await page.addInitScript(installRegressionFixture);
    await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page);
    const open = async (serverId = 'fake1', pid) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent('sc:workbench', { detail })), { serverId, pid });
    await open(); await page.getByText('/fixture-fake1', { exact: true }).waitFor(); pass('system tools render scoped storage');
    await page.getByRole('button', { name: 'Tasks', exact: true }).click(); await page.getByText('Task fake1', { exact: false }).first().waitFor();
    await page.evaluate(() => { window.__regression.holds['taskList:fake2'] = true; });
    await page.locator('.workcenter-heading select').selectOption('fake2');
    assert.equal(await page.getByText('Task fake1', { exact: false }).count(), 0);
    await page.waitForFunction(() => typeof window.__regression.holds['taskList:fake2'] === 'function');
    await page.locator('.workcenter-heading select').selectOption('fake1');
    await page.evaluate(() => window.__regression.holds['taskList:fake2']());
    await page.getByText('Task fake1', { exact: false }).first().waitFor();
    assert.equal(await page.getByText('Task fake2', { exact: false }).count(), 0); pass('server change clears task lists and ignores late responses');
    await page.getByRole('button', { name: 'Reminders & rules', exact: true }).click(); await page.getByText('Rule fake1', { exact: false }).waitFor(); await page.getByText('Event fake1', { exact: true }).waitFor(); pass('reminders, rules and event list render');
    await page.getByRole('button', { name: 'Containers', exact: true }).click(); await page.getByText('Container fake1', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Logs', exact: true }).click(); await page.getByText('Container logs fake1', { exact: true }).waitFor(); pass('container tools fetch log output');
    await page.getByRole('button', { name: 'Services', exact: true }).click(); await page.getByRole('button', { name: 'Open tunnel & browser', exact: true }).click(); await page.locator('.workcenter-output').getByText(/http:\/\/127.0.0.1:8888/).waitFor(); pass('service template opens tunnel and keeps resulting command');
    await page.getByRole('button', { name: 'Command templates', exact: true }).click(); await page.getByText('Template fixture', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Preview', exact: true }).click(); await page.getByText('echo rendered', { exact: true }).waitFor(); pass('command templates render parameter preview');
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    await page.evaluate(() => { window.__regression.holds['report:fake1'] = true; });
    await page.getByRole('button', { name: 'Generate report', exact: true }).click();
    assert(await page.locator('.workcenter-heading select').isDisabled());
    assert(await page.getByRole('button', { name: 'Tasks', exact: true }).isDisabled());
    await page.evaluate(() => window.__regression.holds['report:fake1']()); await page.getByText('Report fake1', { exact: true }).waitFor();
    await page.locator('.workcenter-heading').getByRole('button', { name: 'Refresh', exact: true }).click();
    assert.equal(await page.getByText('Report fake1', { exact: true }).count(), 1); pass('mutation locks server/tab switching and report survives refresh');
    await open('fake1', 12345); await page.locator('.workcenter-form input[type=number]').waitFor();
    assert.equal(await page.locator('.workcenter-form input[type=number]').inputValue(), '12345');
    await open('fake1', 54321); await page.waitForFunction(() => document.querySelector('.workcenter-form input[type=number]')?.value === '54321');
    await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await page.locator('.workcenter-output').getByText(/\/process\/54321/).waitFor(); pass('repeated process-detail navigation updates the PID');
    await page.getByRole('button', { name: 'Tasks', exact: true }).click(); await page.getByText('Task fake1', { exact: false }).first().waitFor();
    await page.locator('.workcenter-grid .card').getByRole('button', { name: 'Files', exact: true }).click();
    const remote = page.locator('.fm:visible .fm-pane').last().locator('.fm-address input');
    await remote.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.fm-address input')].some((input) => input.value === '/task/project'));
    await page.evaluate(() => window.__regression.holds['home:fake1']());
    assert.equal(await remote.inputValue(), '/task/project'); pass('task directory wins over delayed initial remote home');
    await remote.fill('/slow'); await remote.press('Enter'); await remote.fill('/fast'); await remote.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.fm-address input')].some((input) => input.value === '/fast'));
    await page.evaluate(() => window.__regression.lists.slow());
    await page.waitForTimeout(50); assert.equal(await remote.inputValue(), '/fast'); pass('late directory listing cannot overwrite newer navigation');
    await page.locator('.fm:visible').getByRole('button', { name: 'Sync preview', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert(await page.locator('.sync-dialog input').first().isDisabled());
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.sync-dialog').count(), 1);
    await page.evaluate(() => window.__regression.holds.preview()); await page.getByText('fixture.txt', { exact: true }).waitFor();
    await page.locator('.sync-dialog input').first().fill('/new-source');
    assert(await page.getByRole('button', { name: 'Apply this preview', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Preview', exact: true }).click(); assert.equal(await page.getByText('fixture.txt', { exact: true }).count(), 0);
    await page.evaluate(() => window.__regression.holds.preview()); await page.getByText('fixture.txt', { exact: true }).waitFor();
    pass('sync preview clears old plan, locks config and rejects old configuration');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.evaluate(() => { window.__regression.latePreview = window.__regression.holds.preview; });
    await page.locator('.nav-server').nth(1).evaluate((element) => element.click());
    assert.equal(await page.locator('.sync-dialog').count(), 0);
    await page.locator('.nav-server').nth(1).focus(); assert(await page.locator('.nav-server').nth(1).evaluate((element) => document.activeElement === element)); pass('hidden file workspace releases sync focus trap');
    await page.locator('.nav-files').first().click(); await page.locator('.sync-dialog').waitFor();
    await page.evaluate(() => window.__regression.latePreview());
    await page.waitForTimeout(50); assert(await page.getByRole('button', { name: 'Apply this preview', exact: true }).isDisabled());
    assert.equal(await page.getByText('fixture.txt', { exact: true }).count(), 0); pass('preview from an unmounted dialog never revives a stale plan');
    await page.keyboard.press('Escape'); await page.locator('.nav-server').nth(1).click();
    await page.locator('.tabs').getByRole('button', { name: 'History monitoring', exact: true }).click();
    const end = page.getByLabel('End time', { exact: true }); await end.fill('2026-10-12T10:20'); assert.equal(await end.inputValue(), '2026-10-12T10:20');
    await page.getByRole('button', { name: 'Live', exact: true }).click(); assert.equal(await end.inputValue(), '');
    await end.fill('2026-10-12T10:20'); await end.fill(''); assert.equal(await page.getByRole('button', { name: 'Live', exact: true }).count(), 0); pass('history controlled time clears when returning to live');
    const historyDevice = page.locator('.monitor-toolbar label').filter({ hasText: /^Device/ }).locator('select');
    await historyDevice.selectOption('disk:nvme0n1'); await page.locator('.monitor-stats').getByText(/MiB\/s/).first().waitFor();
    await historyDevice.selectOption('mount:/data'); await page.locator('.monitor-stats').getByText(/GiB/).first().waitFor(); pass('I/O and filesystem history are selectable with correct units');
    await page.locator('.tabs').getByRole('button', { name: /GPU/ }).first().click();
    await page.evaluate(() => { window.__regression.holds['process:fake2'] = true; });
    await page.locator('.gpu-proc-line .proc-action').first().click(); await page.getByRole('button', { name: 'End process (SIGTERM)', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Confirm', exact: true }).isDisabled());
    await page.waitForFunction(() => typeof window.__regression.holds['process:fake2'] === 'function');
    await page.evaluate(() => { window.__regression.holds['process:fake2'](); delete window.__regression.holds['process:fake2']; });
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__regression.lastKill), ['fake2', 12345, 'TERM', '98765']); pass('kill confirms remote process identity and passes it for revalidation');
    await page.locator('.gpu-proc-line .proc-action').first().click(); await page.getByRole('button', { name: 'Process details', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.workcenter-form input[type=number]')?.value === '12345'); pass('process action opens work center detail for the correct PID');
    await page.locator('.nav-server').nth(1).click();
    await page.locator('.tabs').getByRole('button', { name: /Terminal/ }).click(); await page.waitForSelector('.term-chip-select');
    await page.getByLabel('Terminal layout', { exact: true }).selectOption('columns'); await page.waitForFunction(() => document.querySelectorAll('.terminal-split.columns .term-pane').length === 2);
    await page.getByTitle('Rename', { exact: true }).first().click(); await page.getByLabel('Rename', { exact: true }).fill('Fixture session'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('button', { name: 'Fixture session', exact: true }).waitFor();
    const search = page.getByLabel('Search terminal output', { exact: true }).first(); await search.fill('SIMULATED'); await search.press('Enter');
    assert.equal(await search.inputValue(), 'SIMULATED'); pass('terminal split, rename and output search remain usable');
    assert.deepEqual(errors, []); pass('new workflow pages have no uncaught renderer errors');
    await page.screenshot({ path: path.join(out, 'terminal-split.png') });
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'production renderer with explicitly simulated IPC', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
