// Production renderer journeys with explicitly simulated training/SSH data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { installFixture, emitSamples } = require('./renderer-fixture.cjs');
function installResearchFixture() {
  const original = window.api, now = Date.now();
  const run = { id: 'run-a', serverId: 'fake1', name: 'Training A', command: 'python train.py', cwd: '/runs/experiment-a', gpu: '0,1', parameters: { lr: 0.001 }, totalSteps: null, status: 'running', startedAt: now - 120000, createdAt: now - 120000, updatedAt: now, exitCode: null,
    summary: [{ name: 'loss', value: 0.3, at: now, step: 2 }, { name: 'step', value: 2, at: now, step: 2 }, { name: 'lr', value: 0.001, at: now, step: 2 }], events: [{ id: 'e1', kind: 'oom', at: now, evidence: 'SIMULATED CUDA out of memory evidence' }] };
  const state = window.__research = { runs: [run, { ...run, id: 'run-b', name: 'Training B', status: 'failed', exitCode: 7 }], tasks: [], calls: [], writes: [], paths: [], holdMetric: '', completeMetric: null };
  window.api = new Proxy(original, { get: (target, key) => {
    if (key === 'terminalWrite') return (...args) => { state.writes.push(args); return Promise.resolve(true); };
    if (key === 'sftpList') return (...args) => { state.paths.push(args); return target[key](...args); };
    if (key !== 'workbenchRequest') return target[key];
    return async (request) => {
      state.calls.push(request); let data = [];
      switch (request.operation) {
        case 'runList': data = state.runs.filter((r) => !request.serverId || r.serverId === request.serverId); break;
        case 'runGet': data = state.runs.find((r) => r.id === request.id); break;
        case 'runMetrics': {
          const value = request.name === 'lr' ? 0.001 : 0.3;
          data = { points: [{ at: now - 1000, step: 1, value: value * 2 }, { at: now, step: 2, value }], total: 2, downsampled: false };
          if (state.holdMetric === request.name) return new Promise((resolve) => { state.completeMetric = () => resolve({ ok: true, data }); });
          break;
        }
        case 'taskSave': data = { ...request, id: 'task-new', status: 'saved' }; state.tasks.push(data); break;
        case 'taskStart': { const task = state.tasks.find((t) => t.id === request.id); data = { ...task, remoteId: 'run-new', status: 'starting' }; state.runs.unshift({ ...run, ...task, id: 'run-new', startedAt: Date.now(), createdAt: Date.now(), status: 'starting', summary: [], events: [] }); break; }
        case 'taskList': data = state.tasks; break;
        case 'workspaceList': {
          data = [{ id: 'workspace-a', serverId: 'fake1', name: 'Workspace training', cwd: '/workspace/project', gpu: '2,3' }];
          if (state.holdWorkspace) await new Promise((resolve) => { state.completeWorkspace = resolve; });
          break;
        }
        case 'runDelete': state.runs = state.runs.filter((r) => r.id !== request.id); data = { deleted: true, trackingCleanupPending: false }; break;
        case 'logList': data = [{ id: 'log', runId: 'run-a', serverId: 'fake1', name: 'Training A', path: '/runs/experiment-a/train.log', lastLines: ['step=2 loss=0.3'], patterns: [], trackLoss: true, enabled: true }]; break;
        case 'logSave': data = { ...request, id: 'log-added' }; break;
        case 'system': data = { filesystems: [], inodes: [], disks: [], networks: [], platform: 'Linux', capabilities: {} }; break;
        case 'notificationGet': data = { enabled: false }; break;
      }
      return { ok: true, data };
    };
  } });
}
async function main() {
  const root = path.resolve(__dirname, '../dist'), output = path.resolve(__dirname, '../test-artifacts/research'); fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html')), relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser; const checks = [], errors = [], requests = [], pass = (name) => { checks.push(name); console.log('PASS ' + name); };
  try {
    const executablePath = [process.env.SC_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', (e) => errors.push(e.message)); page.on('request', (r) => requests.push(r.url()));
    await page.addInitScript(installFixture); await page.addInitScript(installResearchFixture);
    await page.goto(`http://127.0.0.1:${server.address().port}`); await emitSamples(page); await page.locator('.resource-grid').waitFor();
    assert.equal(requests.some((url) => /ResearchPane-.*\.js/.test(url)), false); pass('resource home does not load training forms or chart libraries');
    await page.locator('.home-view-switch').getByRole('button', { name: 'Experiments', exact: true }).click(); await page.locator('.training-chart canvas').first().waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('sc.homeView')), 'experiments'); pass('experiment view is discoverable and remembers the selected home view');
    assert(await page.locator('.research-detail').getByRole('button', { name: 'Remove', exact: true }).isDisabled()); pass('active runs cannot be deleted from the experiment detail');
    const eta = page.locator('.research-summary > div').filter({ has: page.getByText('ETA', { exact: true }) }); assert.equal(await eta.locator('strong').innerText(), '—'); pass('ETA stays unknown without an explicit total step count');
    await page.locator('.research-evidence summary').click(); await page.getByText('SIMULATED CUDA out of memory evidence', { exact: true }).waitFor(); pass('diagnostics retain their original evidence and time');
    await page.evaluate(() => { window.__research.holdMetric = 'lr'; });
    await page.getByLabel('Metric', { exact: true }).selectOption('lr'); await page.waitForFunction(() => typeof window.__research.completeMetric === 'function');
    assert(await page.getByRole('button', { name: 'CSV', exact: true }).isDisabled()); assert.equal(await page.locator('.training-chart').count(), 0); pass('a pending metric request cannot relabel or export the previous metric');
    await page.evaluate(() => { window.__research.holdMetric = ''; window.__research.completeMetric(); }); await page.locator('.training-chart canvas').first().waitFor();
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV', exact: true }).click(); const download = await downloaded, csvPath = path.join(output, download.suggestedFilename()); await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8'); assert.deepEqual(csv.trim().split(/\r?\n/).slice(1).map((row) => Number(row.split(',')[2].replace(/"/g, ''))), [0.002, 0.001]); pass('metric CSV contains the selected observations');
    await page.locator('.training-chart canvas').first().evaluate((node) => { node.dataset.identity = 'stable'; });
    const reads = await page.evaluate(() => window.__research.calls.filter((c) => c.operation === 'runGet').length);
    await page.waitForFunction((before) => window.__research.calls.filter((c) => c.operation === 'runGet').length > before, reads); await page.waitForFunction(() => document.querySelector('.training-chart canvas')?.dataset.identity === 'stable'); pass('live metric refresh preserves the chart instance');
    await page.locator('.research-create summary').click();
    await page.getByLabel('Run name', { exact: true }).fill('New training'); await page.getByLabel('Launch command', { exact: true }).fill('printf training'); await page.getByLabel('Working directory', { exact: true }).fill('relative');
    await page.getByRole('button', { name: 'Create and start', exact: true }).click(); await page.locator('#cwd-error').waitFor(); assert.equal(await page.evaluate(() => window.__research.calls.filter((c) => c.operation === 'taskSave').length), 0); pass('inline validation prevents invalid launch requests');
    await page.getByLabel('Working directory', { exact: true }).fill('/runs/new'); await page.getByLabel('Total steps (optional)', { exact: true }).fill('100'); await page.getByLabel('Parameters (JSON)', { exact: true }).fill('{"lr":0.01}');
    await page.getByRole('button', { name: 'Create and start', exact: true }).click(); await page.locator('.research-detail h2').getByText('New training', { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.__research.calls.find((c) => c.operation === 'taskSave')); assert.equal(saved.parameters.lr, 0.01); assert.equal(saved.totalSteps, 100); pass('an explicit launch records parameters and selects its new independent run');
    await page.locator('.research-run').filter({ hasText: 'Training A' }).click(); await page.locator('.research-detail').getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.waitForFunction(() => window.__research.writes.some(([, command]) => command.includes("cd -- '/runs/experiment-a'"))); pass('home run terminal shortcut retains the experiment directory command');
    await page.locator('.nav > button').first().click(); await page.locator('.research-pane').waitFor(); await page.locator('.research-run').filter({ hasText: 'Training A' }).click(); await page.locator('.research-detail').getByRole('button', { name: 'Files', exact: true }).click();
    await page.waitForFunction(() => window.__research.paths.some(([, directory]) => directory === '/runs/experiment-a')); pass('home run file shortcut retains the experiment directory');
    await page.locator('.nav > button').first().click(); await page.locator('.research-pane').waitFor();
    await page.locator('.research-run').filter({ hasText: 'Training B' }).click(); page.once('dialog', (dialog) => void dialog.accept());
    await page.locator('.research-detail').getByRole('button', { name: 'Remove', exact: true }).click(); await page.locator('.research-run').filter({ hasText: 'Training B' }).waitFor({ state: 'detached' }); pass('completed-run deletion is explicit and removes the selected record');
    await page.locator('.research-run').filter({ hasText: 'Training A' }).click(); await page.locator('.training-chart canvas').first().waitFor(); await page.screenshot({ path: path.join(output, 'experiments-en.png'), fullPage: true });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sc:workbench', { detail: { serverId: 'fake1' } })));
    await page.getByRole('button', { name: 'Experiment workspaces', exact: true }).click();
    await page.locator('.workspace-card').getByRole('button', { name: 'Experiments', exact: true }).click();
    await page.locator('.workcenter .research-create summary').click();
    await page.waitForFunction(() => document.querySelector('.workcenter input[aria-label="Working directory"]')?.value === '/workspace/project');
    assert.equal(await page.getByLabel('GPU selection', { exact: true }).inputValue(), '2,3');
    pass('workspace experiment launches inherit the saved directory and GPU selection');
    await page.getByRole('button', { name: 'Experiment workspaces', exact: true }).click();
    await page.locator('.workspace-card').waitFor();
    await page.evaluate(() => { window.__research.holdWorkspace = true; });
    await page.locator('.workspace-card').getByRole('button', { name: 'Experiments', exact: true }).click();
    await page.waitForFunction(() => typeof window.__research.completeWorkspace === 'function');
    await page.locator('.workcenter .research-create summary').click();
    await page.getByLabel('GPU selection', { exact: true }).fill('7'); await page.getByLabel('GPU selection', { exact: true }).fill('');
    await page.getByLabel('Working directory', { exact: true }).fill('/user/edited');
    await page.evaluate(() => { window.__research.holdWorkspace = false; window.__research.completeWorkspace(); });
    await page.waitForTimeout(100);
    assert.equal(await page.getByLabel('GPU selection', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Working directory', { exact: true }).inputValue(), '/user/edited');
    pass('delayed defaults preserve an explicitly cleared GPU selection and an edited directory');
    await page.locator('.nav > button').first().click(); await page.locator('.research-pane').waitFor();
    await page.setViewportSize({ width: 900, height: 700 });
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt-BR']) {
      await page.evaluate((value) => localStorage.setItem('sc.lang', value), language); await page.reload(); await page.locator('.research-pane').waitFor();
      const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/i18n/locales', language + '.json'), 'utf8'));
      await page.locator('.research-pane').getByRole('heading', { name: catalog.research.title, exact: true }).waitFor(); assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    }
    pass('ten languages retain the experiment view without page overflow at 900px');
    await page.screenshot({ path: path.join(output, 'experiments-narrow.png'), fullPage: true }); assert.deepEqual(errors, []); pass('research workflows have no uncaught renderer errors');
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ version: require('../package.json').version, scope: 'Production renderer, simulated runs and SSH IPC', checks, errors }, null, 2));
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
