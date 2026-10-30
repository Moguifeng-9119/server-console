// Opt-in trusted-host acceptance. Only generated task directories are written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readConfig } = require('../electron/sshconfig.cjs');
const { Pool, setHostKeyChecker } = require('../electron/ssh.cjs');
const { WorkbenchManager } = require('../electron/workbench.cjs');
const { TieredScheduler } = require('../electron/monitoring/scheduler.cjs');
const { HistoryStore } = require('../electron/history-store.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

async function main() {
  const aliases = process.argv.slice(2);
  assert(aliases.length && aliases.every((alias) => /^[\w.-]+$/.test(alias)), 'Supply existing SSH aliases');
  const entries = readConfig(path.join(os.homedir(), '.ssh', 'config')).entries;
  const hosts = aliases.map((alias, index) => {
    const e = entries.find((item) => item.alias === alias || item.allAliases.includes(alias));
    assert(e?.keyExists && !e.proxyJump, 'A direct trusted key alias is required');
    const cfg = { id: 'acceptance-' + index, host: e.host, port: e.port, username: e.user, authType: 'key', keyPath: e.keyPath };
    const endpoint = e.port === 22 ? e.host : `[${e.host}]:${e.port}`;
    const keys = execFileSync('ssh-keygen', ['-F', endpoint], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => line.trim().split(/\s+/)[2]);
    assert(keys.length, 'Alias requires an existing known_hosts entry');
    return { alias, cfg, keys };
  });
  setHostKeyChecker((host, port, key) => hosts.some((item) => item.cfg.host === host && item.cfg.port === port && item.keys.includes(Buffer.from(key).toString('base64'))));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-workbench-live-'));
  const pool = new Pool();
  const output = path.resolve(__dirname, '../test-artifacts/workbench-remote/checks.json');
  const receipt = { at: new Date().toISOString(), version: require('../package.json').version, scope: 'Real ssh2 connections, tiered scheduler, resource counters and owned exit-code task; no user jobs modified', hosts: [], passed: false };
  try {
    for (const host of hosts) {
      const checks = []; const item = { alias: host.alias, checks, passed: false }; receipt.hosts.push(item);
      const conn = pool.get(host.cfg); let scheduler, task;
      const history = new HistoryStore(path.join(directory, host.cfg.id));
      const manager = new WorkbenchManager({ directory: path.join(directory, host.cfg.id), getServers: () => [host.cfg], getConnection: () => conn, researchRequest: (method, payload) => history.request(method, payload) }).init();
      const pass = (name) => { checks.push(name); console.log('PASS ' + host.alias + ': ' + name); };
      try {
        await conn.connect(); pass('SSH host key matched existing known_hosts');
        const failed = await conn.exec("sh -c 'exit 7'"); assert.equal(failed.code, 7); pass('nonzero SSH exit code preserved');
        const first = await manager.request({ operation: 'system', serverId: host.cfg.id });
        assert.equal(first.platform, 'Linux'); assert(first.filesystems.length > 0); assert(first.inodes.length > 0);
        await sleep(2100);
        const second = await manager.request({ operation: 'system', serverId: host.cfg.id });
        assert(second.at > first.at); assert(second.networks.some((n) => Number.isFinite(n.receiveBytesPerSecond))); pass('filesystem, inode and network rate observations');
        task = await manager.request({ operation: 'taskSave', serverId: host.cfg.id, name: 'Acceptance exit-code check', cwd: '~', totalSteps: 100, command: "printf '%s\\n' 'SC_WORKBENCH_SMOKE' '{\"step\":1,\"loss\":0.5,\"learning_rate\":0.001}' '{\"step\":2,\"loss\":0.3}' '{\"step\":3,\"loss\":NaN}' 'CUDA out of memory (synthetic acceptance marker)'; exec sh -c 'exit 7'" });
        task = await manager.request({ operation: 'taskStart', serverId: host.cfg.id, id: task.id });
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) { task = await manager.request({ operation: 'taskStatus', serverId: host.cfg.id, id: task.id }); if (task.status === 'failed') break; await sleep(250); }
        assert.equal(task.exitCode, 7); assert.equal(task.status, 'failed');
        const log = await manager.request({ operation: 'taskLog', serverId: host.cfg.id, id: task.id }); assert(log.text.includes('SC_WORKBENCH_SMOKE')); pass('owned task captures exec exit code 7 and output');
        const watcher = manager.data.logs.find((entry) => entry.runId === task.remoteId); assert(watcher, task.logError || 'Automatic training log watcher is missing');
        await manager.pollLog(watcher.id);
        const run = await history.request('runGet', { id: task.remoteId }), curve = await history.request('runMetrics', { runId: task.remoteId, name: 'loss', axis: 'step' });
        assert.equal(run.status, 'failed'); assert.equal(run.exitCode, 7); assert.deepEqual(curve.points.map((point) => point.value), [0.5, 0.3, null]); assert.deepEqual(run.events.map((event) => event.kind).sort(), ['nan', 'oom']);
        await manager.pollLog(watcher.id); const repeated = await history.request('runMetrics', { runId: task.remoteId, name: 'loss', axis: 'step' }); assert.equal(repeated.total, 3);
        item.research = { runPersisted: true, metricPoints: repeated.total, duplicatePoints: 0, syntheticNanOomEvidence: true };
        pass('real SSH task logs persist independent Run, curves and synthetic NaN/OOM evidence without duplicates');
        const counts = { gpu: 0, system: 0, processes: 0 }; const failures = []; let streamed = false;
        scheduler = new TieredScheduler({ configs: () => [host.cfg], getConnection: () => conn, interval: () => 500,
          onObservation: (snapshot) => { if (snapshot.lastLane in counts) counts[snapshot.lastLane]++; streamed ||= snapshot.monitoring?.mode === 'stream'; },
          onSnapshot: () => {}, onError: (error, _cfg, lane) => failures.push({ lane, error: String(error.message || error).slice(0, 200) }) });
        scheduler.start(); await sleep(6500); scheduler.stop();
        assert(counts.system >= 2 && counts.processes >= 1 && counts.gpu >= 1, 'All collection tiers must produce observations');
        item.observations = counts; item.streamObserved = streamed; item.collectionErrors = failures;
        assert.equal(failures.length, 0); pass('production tiered scheduler collects GPU/system/process lanes');
        item.passed = true;
      } catch (error) { item.error = String(error.message || error).slice(0, 500); console.error('FAIL ' + host.alias + ': ' + item.error); }
      finally {
        scheduler?.stop();
        if (task?.remoteId && /^[a-f0-9-]{36}$/.test(task.remoteId) && ['failed', 'succeeded'].includes(task.status)) {
          const owned = '"$HOME"/.local/state/serverconsole/tasks/' + quote(task.remoteId);
          const result = await conn.exec('rm -f -- ' + ['runner.sh', 'output.log', 'exit.code', 'exit.tmp', 'runner.pid', 'runner.start'].map((name) => owned + '/' + name).join(' ') + '; rmdir -- ' + owned).catch(() => null);
          item.ownedTaskRemoved = result?.code === 0;
        }
        manager.close(); await history.close(); pool.remove(host.cfg.id);
      }
    }
    receipt.passed = receipt.hosts.every((host) => host.passed);
    if (!receipt.passed) process.exitCode = 1;
  } finally {
    for (const host of hosts) pool.remove(host.cfg.id);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('sc-workbench-live-')) fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
