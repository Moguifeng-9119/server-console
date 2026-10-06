// Explicitly simulated IPC for interaction regressions and product illustrations.
function installFixture(language = 'en') {
  if (!localStorage.getItem('sc.lang')) localStorage.setItem('sc.lang', language);
  localStorage.setItem('sc.theme.user', 'light');
  const callbacks = {}, listeners = {}, config = { id: 'fake1', name: 'Demo training', host: 'demo.invalid', port: 22, username: 'demo', authType: 'key' };
  const entry = { name: 'test.txt', type: 'file', size: 10, mtime: Date.now(), path: '/home/demo/test.txt' };
  const sessions = [];
  let nextSession = 0;
  const tasks = [{ id: 'demo-transfer', kind: 'upload', name: 'checkpoint.pt', size: 10 * 1024 ** 3, transferred: 4 * 1024 ** 3, status: 'running', speed: 0, serverName: config.name, resumeCheck: { bytes: 2 * 1024 ** 3, total: 4 * 1024 ** 3, files: 1 }, srcPath: '/demo/checkpoint.pt', dstPath: 'demo:/data/checkpoint.pt', resumable: true }];
  window.__fixture = { callbacks, tasks, finishWrite: null, lastWrite: null };
  window.api = new Proxy({}, { get: (_, key) => {
    if (key === 'platform') return 'win32';
    if (String(key).startsWith('on')) return (fn) => {
      (listeners[key] ||= new Set()).add(fn);
      callbacks[key] = (...args) => { for (const listener of listeners[key]) listener(...args); };
      return () => { listeners[key].delete(fn); if (!listeners[key].size) delete callbacks[key]; };
    };
    return (...args) => {
      if (key === 'sftpWriteText') {
        window.__fixture.lastWrite = args;
        return new Promise((resolve) => { window.__fixture.finishWrite = () => resolve({ ok: true }); });
      }
      if (key === 'terminalOpen') { const id = 'demo-term-' + (++nextSession); sessions.push({ termId: id, serverId: args[0] }); callbacks.onTerminalSessions?.([...sessions]); return Promise.resolve({ ok: true, data: id }); }
      if (key === 'terminalClose') { const i = sessions.findIndex((s) => s.termId === args[0]); if (i >= 0) sessions.splice(i, 1); callbacks.onTerminalSessions?.([...sessions]); return Promise.resolve(true); }
      if (key === 'terminalAttach') return Promise.resolve({data: '\u001b[32mdemo@training\u001b[0m:~$ nvidia-smi\r\nSIMULATED DEMO · NVIDIA H100 · 80 GiB\r\n', sequence: 0});
      return Promise.resolve(key === 'listServers' ? [config, { ...config, id: 'fake2', name: 'Demo inference' }]
        : key === 'terminalList' ? sessions
        : key === 'transferList' ? tasks
        : ['auditList', 'snippetsList', 'hostKeysList', 'forwardingsList'].includes(key) ? []
        : key === 'historyLoad' ? {}
        : key === 'localHome' ? '/home/demo'
        : key === 'sftpHome' ? { ok: true, data: '/home/demo' }
        : ['localList', 'sftpList'].includes(key) ? { ok: true, data: { path: '/home/demo', entries: [entry, { ...entry, name: 'datasets', type: 'dir', path: '/home/demo/datasets' }] } }
        : key === 'sftpReadText' ? { ok: true, data: { text: 'original' } }
        : key === 'storeInfo' ? { mode: 'session', backend: 'fixture' }
        : key === 'sshConfigRefresh' ? { entries: [], added: [], changed: [], removed: [] }
        : key === 'sshConfigDefault' ? { configPath: '/demo/.ssh/config', configExists: false, keys: [] }
        : {});
    };
  } });
  document.addEventListener('DOMContentLoaded', () => {
    const caption = document.createElement('div'); caption.textContent = 'SIMULATED DEMO · no real server data';
    caption.style.cssText = 'position:fixed;bottom:4px;left:240px;z-index:10000;padding:5px 10px;background:#123848;color:white;border-radius:6px;font:12px sans-serif;pointer-events:none';
    document.body.append(caption);
  });
}

async function emitSamples(page) {
  await page.waitForFunction(() => !!window.__fixture?.callbacks.onSnapshot);
  await page.evaluate(() => ['fake1', 'fake2'].forEach((id, i) => window.__fixture.callbacks.onSnapshot({
    id, status: 'online', gpus: [{ index: 0, name: 'NVIDIA H100', util: i ? 45 : 0, memUsed: i ? 22000 : 4000, memTotal: 81920, temp: 42, power: 100, fan: null, procs: [{ pid: 12345, name: 'python', mem: 2048 }] }],
    processes: [{ pid: 12345, user: 'demo', cpu: 15, mem: 2, rssMb: 2048, state: 'S', started: '12:00', command: 'python demo_train.py', gpu: 0, gpuIndices: [0] }], cpuCores: 16, cpuUsage: 20, loadAvg: [0, 0, 0], memUsed: 2, memTotal: 64, swapUsed: 0, swapTotal: 0, collectedAt: Date.now(),
  })));
}
module.exports = { installFixture, emitSamples };
