// 预加载：renderer 只能通过 window.api 访问主进程能力（SSH/SFTP/传输/文件对话框/凭据存储）
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  // Electron 32+ 移除了 File.path，拖拽上传经此取本地绝对路径
  pathForFile: (file) => webUtils.getPathForFile(file),
  // 关窗确认：有活跃传输时主进程拦截 close 并通知渲染层弹框
  onConfirmQuit: (cb) => {
    const h = () => cb();
    ipcRenderer.on('app:confirm-quit', h);
    return () => ipcRenderer.removeListener('app:confirm-quit', h);
  },
  backgroundContinue: () => ipcRenderer.send('app:background-continue'),
  forceQuit: () => ipcRenderer.send('app:force-quit'),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('app:set-theme-overlay', theme),
  notify: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),
  storeInfo: () => ipcRenderer.invoke('store:info'),
  auditList: () => ipcRenderer.invoke('audit:list'),
  auditAppend: (entry) => ipcRenderer.invoke('audit:append', entry),

  // 主机指纹信任库（TOFU）
  hostKeysList: () => ipcRenderer.invoke('hostkeys:list'),
  hostKeysRemove: (keyId) => ipcRenderer.invoke('hostkeys:remove', keyId),
  securityGet: () => ipcRenderer.invoke('security:get'),
  securitySet: (o) => ipcRenderer.invoke('security:set', o),

  // 服务器配置
  listServers: () => ipcRenderer.invoke('servers:list'),
  addServer: (cfg) => ipcRenderer.invoke('servers:add', cfg),
  updateServer: (cfg) => ipcRenderer.invoke('servers:update', cfg),
  removeServer: (id) => ipcRenderer.invoke('servers:remove', id),
  testServer: (cfg) => ipcRenderer.invoke('servers:test', cfg),

  // 采集与进程操作
  setInterval: (ms) => ipcRenderer.invoke('ssh:setInterval', ms),
  setMonitoringHidden: (hidden) => ipcRenderer.invoke('ssh:visibility', hidden),
  setFocusedServer: (id) => ipcRenderer.invoke('ssh:set-focused', id),
  kill: (id, pid, signal, expectedStartTicks) => ipcRenderer.invoke('ssh:kill', { id, pid, signal, expectedStartTicks }),
  restartService: (id, service) => ipcRenderer.invoke('ssh:restartService', { id, service }),
  exec: (id, cmd) => ipcRenderer.invoke('ssh:exec', { id, cmd }),
  // 交互式认证（2FA/MFA）：主进程广播提示问题，渲染层弹框作答回传
  onKeyboardInteractive: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ssh:keyboard-interactive', h);
    return () => ipcRenderer.removeListener('ssh:keyboard-interactive', h);
  },
  submitInteractive: (reqId, answers) => ipcRenderer.invoke('ssh:interactive-reply', { reqId, answers }),

  // 并行命令
  parallelRun: (ids, cmd) => ipcRenderer.invoke('parallel:run', { ids, cmd }),
  parallelStop: (runId) => ipcRenderer.invoke('parallel:stop', runId),
  onParallelData: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('parallel:data', h);
    return () => ipcRenderer.removeListener('parallel:data', h);
  },
  onParallelDone: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('parallel:done', h);
    return () => ipcRenderer.removeListener('parallel:done', h);
  },

  // 端口转发
  forwardingsList: () => ipcRenderer.invoke('forwardings:list'),
  forwardingsUpsert: (rule) => ipcRenderer.invoke('forwardings:upsert', rule),
  forwardingsRemove: (id) => ipcRenderer.invoke('forwardings:remove', id),
  forwardingsStart: (id) => ipcRenderer.invoke('forwardings:start', id),
  forwardingsStop: (id) => ipcRenderer.invoke('forwardings:stop', id),
  onForwardingsChanged: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('forwardings:changed', h);
    return () => ipcRenderer.removeListener('forwardings:changed', h);
  },

  // 快速命令片段
  snippetsList: () => ipcRenderer.invoke('snippets:list'),
  snippetsSet: (list) => ipcRenderer.invoke('snippets:set', list),

  // 告警 Webhook
  webhookGet: () => ipcRenderer.invoke('webhook:get'),
  webhookSet: (o) => ipcRenderer.invoke('webhook:set', o),
  webhookSend: (payload) => ipcRenderer.invoke('webhook:send', payload),

  // 系统托盘 / 关窗行为
  setAppSettings: (o) => ipcRenderer.invoke('app:set-settings', o),
  getAppSettings: () => ipcRenderer.invoke('app:get-settings'),
  setAppLanguage: (lang) => ipcRenderer.invoke('app:set-language', { lang }),
  showMainWindow: () => ipcRenderer.send('app:show-main'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  configExport: (passphrase) => ipcRenderer.invoke('config:export', { passphrase }),
  configImport: (passphrase) => ipcRenderer.invoke('config:import', { passphrase }),

  // 内嵌 SSH 终端（多会话）
  terminalOpen: (id, cols, rows) => ipcRenderer.invoke('terminal:open', { id, cols, rows }),
  terminalList: () => ipcRenderer.invoke('terminal:list'),
  terminalAttach: (termId) => ipcRenderer.invoke('terminal:attach', { termId }),
  terminalDetach: (termId) => ipcRenderer.invoke('terminal:detach', { termId }),
  terminalWrite: (termId, data) => ipcRenderer.invoke('terminal:write', { termId, data }),
  terminalResize: (termId, cols, rows) => ipcRenderer.invoke('terminal:resize', { termId, cols, rows }),
  terminalClose: (termId) => ipcRenderer.invoke('terminal:close', { termId }),
  onTerminalData: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('terminal:data', h);
    return () => ipcRenderer.removeListener('terminal:data', h);
  },
  onTerminalClosed: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('terminal:closed', h);
    return () => ipcRenderer.removeListener('terminal:closed', h);
  },
  onTerminalSessions: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('terminal:sessions', h);
    return () => ipcRenderer.removeListener('terminal:sessions', h);
  },

    // GPU 历史持久化
  historyLoad: () => ipcRenderer.invoke('history:load'),
  historySave: (map) => ipcRenderer.invoke('history:save', map),
  historyQuery: (query) => ipcRenderer.invoke('history:query', query),
  onHistoryError: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('history:error', h);
    return () => ipcRenderer.removeListener('history:error', h);
  },
  onSnapshot: (cb) => {
    const h = (_e, data) => cb(data);
    const receiver = new FrameReceiver({ fetchCurrent: (id) => ipcRenderer.invoke('ssh:snapshot-current', id), emit: cb });
    const onFrame = (_event, frame) => receiver.receive(frame);
    ipcRenderer.on('ssh:frame', onFrame); ipcRenderer.on('ssh:snapshot', h);
    return () => { ipcRenderer.removeListener('ssh:snapshot', h); ipcRenderer.removeListener('ssh:frame', onFrame); };
  },
  onStatus: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ssh:status', h);
    return () => ipcRenderer.removeListener('ssh:status', h);
  },

  // 本机对话框
  dlgOpenFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  dlgOpenDir: () => ipcRenderer.invoke('dialog:openDir'),
  devsyncList: () => ipcRenderer.invoke('devsync:list'),
  devsyncSave: (pair) => ipcRenderer.invoke('devsync:save', pair),
  devsyncDelete: (id) => ipcRenderer.invoke('devsync:delete', { id }),
  devsyncToggle: (id, enabled) => ipcRenderer.invoke('devsync:toggle', { id, enabled }),
  devsyncPick: (id) => ipcRenderer.invoke('devsync:pick', { id }),
  cmdHistoryList: (query) => ipcRenderer.invoke('cmdhistory:list', { query }),
  cmdHistoryDelete: (id) => ipcRenderer.invoke('cmdhistory:delete', { id }),
  cmdHistoryClear: () => ipcRenderer.invoke('cmdhistory:clear'),
  setStatusPage: (enabled) => ipcRenderer.invoke('app:set-status-page', { enabled }),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  setUpdateAutoInstall: (on) => ipcRenderer.invoke('update:auto-install', on),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  dlgPickKey: () => ipcRenderer.invoke('dialog:pickKey'),
  dlgSave: (opts) => ipcRenderer.invoke('dialog:save', opts),

  // SSH config 解析与监听
  sshConfigDefault: () => ipcRenderer.invoke('sshconfig:default'),
  sshConfigRead: (p) => ipcRenderer.invoke('sshconfig:read', p),
  sshConfigStatKey: (p) => ipcRenderer.invoke('sshconfig:statKey', p),
  sshConfigRefresh: (p) => ipcRenderer.invoke('sshconfig:refresh', p),
  onConfigChanged: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('sshconfig:changed', h);
    return () => ipcRenderer.removeListener('sshconfig:changed', h);
  },

  // 本地文件系统（双面板左侧）
  localList: (p) => ipcRenderer.invoke('local:list', p),
  localHome: () => ipcRenderer.invoke('local:home'),
  localRoots: () => ipcRenderer.invoke('local:roots'),
  localMkdir: (p) => ipcRenderer.invoke('local:mkdir', p),
  localRename: (from, to) => ipcRenderer.invoke('local:rename', { from, to }),
  localDelete: (p) => ipcRenderer.invoke('local:delete', p),

  // 远程 SFTP
  sftpList: (id, p) => ipcRenderer.invoke('sftp:list', { id, path: p }),
  sftpHome: (id) => ipcRenderer.invoke('sftp:home', { id }),
  sftpMkdir: (id, p) => ipcRenderer.invoke('sftp:mkdir', { id, path: p }),
  sftpRename: (id, from, to) => ipcRenderer.invoke('sftp:rename', { id, from, to }),
  sftpDelete: (id, p) => ipcRenderer.invoke('sftp:delete', { id, path: p }),
  sftpStat: (id, p) => ipcRenderer.invoke('sftp:stat', { id, path: p }),
  sftpReadText: (id, p, tail) => ipcRenderer.invoke('sftp:readText', { id, path: p, tail }),
  sftpWriteText: (id, p, text, expectedHash) => ipcRenderer.invoke('sftp:writeText', { id, path: p, text, expectedHash }),
  sftpReadBinary: (id, p) => ipcRenderer.invoke('sftp:readBinary', { id, path: p }),
  sftpSearch: (id, base, keyword) => ipcRenderer.invoke('sftp:search', { id, base, keyword }),
  sftpArchive: (id, cwd, names, archiveName) =>
    ipcRenderer.invoke('sftp:archive', { id, cwd, names, archiveName }),
  sftpExtract: (id, cwd, p) => ipcRenderer.invoke('sftp:extract', { id, cwd, path: p }),
  sftpChmod: (id, p, mode) => ipcRenderer.invoke('sftp:chmod', { id, path: p, mode }),

  // 传输队列
  transferList: () => ipcRenderer.invoke('transfer:list'),
  transferPause: (id) => ipcRenderer.invoke('transfer:pause', id),
  transferCancel: (id) => ipcRenderer.invoke('transfer:cancel', id),
  transferResume: (id) => ipcRenderer.invoke('transfer:resume', id),
  transferRetry: (id) => ipcRenderer.invoke('transfer:retry', id),
  transferRemove: (id) => ipcRenderer.invoke('transfer:remove', id),
  transferForgetLegacy: (id) => ipcRenderer.invoke('transfer:forget-legacy', id),
  transferClear: () => ipcRenderer.invoke('transfer:clear'),
  transferPauseAll: () => ipcRenderer.invoke('transfer:pause-all'),
  transferResumeAll: () => ipcRenderer.invoke('transfer:resume-all'),
  transferCancelMany: (ids) => ipcRenderer.invoke('transfer:cancel-many', ids),
  transferRetryFailed: () => ipcRenderer.invoke('transfer:retry-failed'),
  transferMove: (id, dir) => ipcRenderer.invoke('transfer:move', { id, dir }),
  transferConcurrency: (n) => ipcRenderer.invoke('transfer:concurrency', n),
  transferOptions: (o) => ipcRenderer.invoke('transfer:options', o),
  transferUpload: (id, localPaths, remoteDir, serverName) =>
    ipcRenderer.invoke('transfer:upload', { id, localPaths, remoteDir, serverName }),
  transferDownload: (id, items, localDir, serverName) =>
    ipcRenderer.invoke('transfer:download', { id, items, localDir, serverName }),
  transferRelay: (srcId, dstId, items, dstDir, srcName, dstName) =>
    ipcRenderer.invoke('transfer:relay', { srcId, dstId, items, dstDir, srcName, dstName }),
  onTransferUpdate: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('transfer:update', h);
    return () => ipcRenderer.removeListener('transfer:update', h);
  },

  // 目录同步（预览 → 确认应用）
  syncPreview: (req) => ipcRenderer.invoke('sync:preview', req),
  syncApply: (planId) => ipcRenderer.invoke('sync:apply', planId),
  syncList: () => ipcRenderer.invoke('sync:list'),

  // 运维工作台（统一请求通道）
  workbenchRequest: (req) => ipcRenderer.invoke('workbench:request', req),
  onImportResult: (cb) => {
    const h = (_event, result) => cb(result);
    ipcRenderer.on('configuration:import-result', h);
    return () => ipcRenderer.removeListener('configuration:import-result', h);
  },
  onWorkbenchEvent: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('workbench:event', h);
    return () => ipcRenderer.removeListener('workbench:event', h);
  },
});

// Sandboxed preload: only electron is required. Each server owns its resync generation.
class FrameReceiver {
  constructor({ fetchCurrent, emit }) { this.fetchCurrent = fetchCurrent; this.emit = emit; this.states = new Map(); }
  receive(frame) {
    if (!frame || frame.version !== 1 || !Number.isSafeInteger(frame.seq) || frame.seq < 1 || !frame.serverId || !frame.epoch) return;
    let entry = this.states.get(frame.serverId);
    if (!entry) { entry = { id: frame.serverId, epoch: '', seq: 0, state: null, queue: [], resyncing: false, pastEpochs: new Set(), generation: 0 }; this.states.set(frame.serverId, entry); }
    if (entry.pastEpochs.has(frame.epoch)) return;
    if (frame.kind === 'keyframe') {
      if (entry.epoch === frame.epoch && frame.seq < entry.seq) return;
      if (entry.epoch && entry.epoch !== frame.epoch) { entry.pastEpochs.add(entry.epoch); if (entry.pastEpochs.size > 32) entry.pastEpochs.delete(entry.pastEpochs.values().next().value); }
      entry.generation++; entry.resyncing = false; entry.epoch = frame.epoch; entry.seq = frame.seq; entry.state = frame.payload;
      entry.queue = entry.queue.filter((item) => item.epoch === entry.epoch && item.seq > entry.seq);
      this.emit(entry.state); this._drain(entry); return;
    }
    if (frame.kind !== 'delta') return;
    if (frame.epoch === entry.epoch && frame.seq <= entry.seq) return;
    if (frame.epoch === entry.epoch && entry.state && frame.baseSeq === entry.seq) {
      entry.state = Object.assign({}, entry.state, frame.payload); entry.seq = frame.seq; this.emit(entry.state); this._drain(entry); return;
    }
    if (!entry.queue.some((item) => item.epoch === frame.epoch && item.seq === frame.seq)) entry.queue.push(frame);
    if (entry.queue.length > 64) entry.queue.shift(); this._resync(entry, frame.epoch);
  }
  _drain(entry) {
    for (;;) {
      entry.queue = entry.queue.filter((item) => !entry.pastEpochs.has(item.epoch) && (item.epoch !== entry.epoch || item.seq > entry.seq));
      const index = entry.queue.findIndex((item) => item.epoch === entry.epoch && item.baseSeq === entry.seq);
      if (index < 0) break;
      const [next] = entry.queue.splice(index, 1); entry.state = Object.assign({}, entry.state, next.payload); entry.seq = next.seq; this.emit(entry.state);
    }
  }
  _resync(entry, requestedEpoch) {
    if (entry.resyncing) return;
    entry.resyncing = true; const generation = ++entry.generation;
    let call; try { call = this.fetchCurrent(entry.id); } catch { entry.resyncing = false; return; }
    Promise.resolve(call).then((current) => {
      if (generation !== entry.generation || !current?.snapshot || current.epoch !== requestedEpoch || entry.pastEpochs.has(current.epoch)) return;
      if (entry.epoch === current.epoch && current.seq < entry.seq) return;
      if (entry.epoch && entry.epoch !== current.epoch) entry.pastEpochs.add(entry.epoch);
      entry.epoch = current.epoch; entry.state = current.snapshot; entry.seq = current.seq; this.emit(entry.state); this._drain(entry);
    }).catch(() => {}).finally(() => { if (generation === entry.generation) entry.resyncing = false; });
  }
}
