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
  kill: (id, pid, signal) => ipcRenderer.invoke('ssh:kill', { id, pid, signal }),
  restartService: (id, service) => ipcRenderer.invoke('ssh:restartService', { id, service }),
  // 交互式认证（2FA/MFA）：主进程广播提示问题，渲染层弹框作答回传
  onKeyboardInteractive: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ssh:keyboard-interactive', h);
    return () => ipcRenderer.removeListener('ssh:keyboard-interactive', h);
  },
  submitInteractive: (reqId, answers) => ipcRenderer.invoke('ssh:interactive-reply', { reqId, answers }),
  onSnapshot: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ssh:snapshot', h);
    return () => ipcRenderer.removeListener('ssh:snapshot', h);
  },
  onStatus: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ssh:status', h);
    return () => ipcRenderer.removeListener('ssh:status', h);
  },

  // 本机对话框
  dlgOpenFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  dlgOpenDir: () => ipcRenderer.invoke('dialog:openDir'),
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
  sftpSearch: (id, base, keyword) => ipcRenderer.invoke('sftp:search', { id, base, keyword }),
  sftpArchive: (id, cwd, names, archiveName) =>
    ipcRenderer.invoke('sftp:archive', { id, cwd, names, archiveName }),
  sftpExtract: (id, cwd, p) => ipcRenderer.invoke('sftp:extract', { id, cwd, path: p }),

  // 传输队列
  transferList: () => ipcRenderer.invoke('transfer:list'),
  transferPause: (id) => ipcRenderer.invoke('transfer:pause', id),
  transferCancel: (id) => ipcRenderer.invoke('transfer:cancel', id),
  transferResume: (id) => ipcRenderer.invoke('transfer:resume', id),
  transferRetry: (id) => ipcRenderer.invoke('transfer:retry', id),
  transferRemove: (id) => ipcRenderer.invoke('transfer:remove', id),
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
});
