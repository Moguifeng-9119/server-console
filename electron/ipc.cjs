const { ipcMain, BrowserWindow, Notification, dialog, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Pool, Connection, setHostKeyChecker } = require('./ssh.cjs');
const store = require('./store.cjs');
const localfs = require('./localfs.cjs');
const sshconfig = require('./sshconfig.cjs');
const audit = require('./audit.cjs');
const hostkeys = require('./hostkeys.cjs');
const { TransferManager } = require('./transfer.cjs');

const pool = new Pool();
let servers = [];
let timer = null;
let intervalMs = 2000;
let ticking = false;
let transfers = null;
let configWatchPath = '';
let lastConfigMtime = 0;
let knownAliases = null; // 上次 config 的别名集合（null=尚未建立基线，首次不报删除）

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

function statusOfError(e) {
  const m = String(e && e.message);
  if (/authentic/i.test(m)) return 'auth';
  if (/timed out|timeout/i.test(m)) return 'timeout';
  return 'offline';
}

async function tick() {
  if (ticking) return;
  ticking = true;
  // 采集错峰：把各服务器的采集起点按索引摊开，避免同刻打满本机与对端
  const stagger = Math.min(250, Math.floor((intervalMs * 0.8) / Math.max(1, servers.length)));
  await Promise.all(
    servers.map(async (cfg, i) => {
      await new Promise((r) => setTimeout(r, i * stagger));
      const conn = pool.get(cfg);
      if (conn.isBackedOff()) return; // 退避窗口内不重试也不重复广播
      try {
        const snap = await conn.collect();
        broadcast('ssh:snapshot', { id: cfg.id, status: 'online', error: '', ...snap });
      } catch (e) {
        broadcast('ssh:status', { id: cfg.id, status: statusOfError(e), error: e.message });
      }
    }),
  );
  ticking = false;
}

function start() {
  if (timer) clearInterval(timer);
  if (!servers.length) return;
  timer = setInterval(tick, intervalMs);
  tick();
}

function persist() {
  store.save(servers);
  start();
}

// 统一包装：成功 {ok:true,data}，失败 {ok:false,error}
function wrap(fn) {
  return async (_e, arg) => {
    try {
      return { ok: true, data: await fn(arg) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  };
}

function getCfg(id) {
  const cfg = servers.find((s) => s.id === id);
  if (!cfg) throw new Error('服务器不存在或已删除');
  return cfg;
}
async function getConn(id) {
  return pool.get(getCfg(id));
}

// 服务器配置入库前校验/归一化（渲染进程传来的值不可尽信）
function validateServerCfg(cfg) {
  const host = String(cfg.host || '').trim();
  const username = String(cfg.username || '').trim();
  const port = Math.floor(Number(cfg.port) || 22);
  const authType = cfg.authType === 'key' ? 'key' : 'password';
  if (!host) throw new Error('主机地址不能为空');
  if (!username) throw new Error('用户名不能为空');
  if (port < 1 || port > 65535) throw new Error('端口必须是 1-65535 的整数');
  if (authType === 'key' && !String(cfg.keyPath || '').trim()) throw new Error('私钥认证需要提供私钥文件路径');
  return { host, username, port, authType };
}

const posixJoin = (dir, name) => (!dir || dir === '.' ? name : dir.replace(/\/$/, '') + '/' + name);
const toLocalRel = (posixRel) => posixRel.split('/').join(path.sep);
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function formatBytesHuman(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

// ===== ~/.ssh/config 变化检测 =====
function inspectConfig(filePath) {
  try {
    const parsed = sshconfig.readConfig(filePath);
    const { added, changed } = sshconfig.diffConfig(parsed.entries, servers);
    const removed = [];
    const curAliases = new Set(parsed.entries.map((e) => e.alias));
    if (knownAliases) {
      // 上次有、这次没有的别名，且程序里存在同名服务器 → 提醒，绝不自动删除
      for (const alias of knownAliases) {
        if (curAliases.has(alias)) continue;
        const srv = servers.find((s) => s.name === alias);
        if (srv) removed.push({ targetId: srv.id, alias, name: srv.name, host: srv.host });
      }
    }
    knownAliases = curAliases; // 首次调用建立基线（不把缺失当删除）
    if (added.length || changed.length || removed.length) {
      broadcast('sshconfig:changed', { path: parsed.path, added, changed, removed });
    }
    return { entries: parsed.entries, added, changed, removed };
  } catch (e) {
    return { entries: [], added: [], changed: [], removed: [], error: e.message };
  }
}

function watchDefaultConfig() {
  const info = sshconfig.defaultInfo();
  if (!info.configExists) return;
  configWatchPath = info.configPath;
  lastConfigMtime = 0;
  fs.watchFile(configWatchPath, { interval: 1000 }, () => inspectConfig(configWatchPath));
}

function registerIpc() {
  ipcMain.handle('app:notify', (_e, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.handle('store:info', () => ({ encryptionAvailable: store.encryptionAvailable() }));

  ipcMain.handle('audit:list', () => audit.loadRecent());
  ipcMain.handle('audit:append', (_e, entry) => {
    audit.append(entry);
    return true;
  });

  // 主机指纹信任库（TOFU）
  ipcMain.handle('hostkeys:list', () => hostkeys.list());
  ipcMain.handle('hostkeys:remove', (_e, keyId) => hostkeys.remove(String(keyId)));
  ipcMain.handle('security:get', () => hostkeys.getOpts());
  ipcMain.handle('security:set', (_e, o) => hostkeys.setOpts(o || {}));

  ipcMain.handle('servers:list', () => servers.map(store.publicView));

  ipcMain.handle('servers:add', (_e, cfg) => {
    try {
      const v = validateServerCfg(cfg);
      const full = { id: `srv_${Date.now().toString(36)}`, ...cfg, ...v };
      servers.push(full);
      persist();
      return { ok: true, server: store.publicView(full) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('servers:update', (_e, cfg) => {
    const i = servers.findIndex((s) => s.id === cfg.id);
    if (i < 0) return { ok: false, error: '服务器不存在' };
    try {
      const patch = { ...cfg };
      delete patch.id; // id 不可被覆盖
      // 凭据键为 undefined/空串时视为“保持不变”，避免误覆盖已存凭据
      for (const k of ['password', 'passphrase']) {
        if (!patch[k]) delete patch[k];
      }
      const v = validateServerCfg({ ...servers[i], ...patch });
      servers[i] = { ...servers[i], ...patch, ...v };
      persist();
      return { ok: true, server: store.publicView(servers[i]) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('servers:remove', (_e, id) => {
    servers = servers.filter((s) => s.id !== id);
    pool.remove(id);
    persist();
    return true;
  });

  ipcMain.handle('servers:test', async (_e, cfg) => {
    const conn = new Connection({ id: '__test__', port: 22, ...cfg });
    try {
      const snap = await conn.collect();
      return { ok: true, gpus: snap.gpus.length, processes: snap.processes.length };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      conn.close();
    }
  });

  ipcMain.handle('ssh:setInterval', (_e, ms) => {
    intervalMs = Math.max(1000, Number(ms) || 2000);
    start();
    return intervalMs;
  });

  ipcMain.handle('ssh:kill', async (_e, { id, pid, signal }) => {
    try {
      const res = await pool.get(getCfg(id)).kill(pid, signal);
      if (res.ok) setTimeout(tick, 300);
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ssh:restartService', async (_e, { id, service }) => {
    try {
      return await pool.get(getCfg(id)).restartService(service);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ============ 本机文件对话框 ============
  ipcMain.handle('dialog:openFiles', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:openDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('dialog:pickKey', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择私钥文件',
      properties: ['openFile'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('dialog:save', async (_e, arg) => {
    const r = await dialog.showSaveDialog({ defaultPath: arg?.defaultPath, title: arg?.title || '下载到' });
    return r.canceled ? '' : r.filePath;
  });

  // ============ SSH config 解析 / 监听 ============
  ipcMain.handle('sshconfig:default', () => sshconfig.defaultInfo());
  ipcMain.handle('sshconfig:read', wrap((p) => sshconfig.readConfig(p)));
  ipcMain.handle(
    'sshconfig:statKey',
    wrap((p) => ({ path: p, exists: !!p && fs.existsSync(p) })),
  );
  ipcMain.handle('sshconfig:refresh', (_e, p) => inspectConfig(p || configWatchPath));

  // ============ 本地文件系统 ============
  ipcMain.handle('local:list', wrap((p) => localfs.list(p)));
  ipcMain.handle('local:home', () => localfs.homeDir());
  ipcMain.handle('local:roots', () => localfs.roots());
  ipcMain.handle('local:mkdir', wrap((p) => localfs.mkdirp(p)));
  ipcMain.handle('local:rename', wrap(({ from, to }) => localfs.rename(from, to)));
  ipcMain.handle('local:delete', wrap((p) => localfs.rmrf(p)));

  // ============ 远程 SFTP ============
  ipcMain.handle(
    'sftp:list',
    wrap(async ({ id, path: p }) => (await getConn(id)).listDir(p)),
  );
  ipcMain.handle('sftp:home', wrap(async ({ id }) => (await getConn(id)).homePath()));
  ipcMain.handle('sftp:mkdir', wrap(async ({ id, path: p }) => (await getConn(id)).mkdirpRemote(p)));
  ipcMain.handle('sftp:rename', wrap(async ({ id, from, to }) => (await getConn(id)).renameRemote(from, to)));
  ipcMain.handle('sftp:delete', wrap(async ({ id, path: p }) => (await getConn(id)).removeRemote(p)));
  ipcMain.handle('sftp:stat', wrap(async ({ id, path: p }) => (await getConn(id)).statRemote(p)));

  // 文本查看：小文件读前 512KB；tail 模式取最后 500 行
  ipcMain.handle(
    'sftp:readText',
    wrap(async ({ id, path: p, tail }) => {
      const conn = await getConn(id);
      const MAX = 512 * 1024;
      if (tail) {
        const { stdout } = await conn.exec(`tail -n 500 -- ${shq(p)}`, 15000);
        if (stdout.includes('\x00')) throw new Error('疑似二进制文件，请下载后用本地程序打开');
        return { text: stdout, truncated: true, mode: 'tail' };
      }
      const st = await conn.statRemote(p);
      const sftp = await conn.sftp();
      const text = await new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(p, { start: 0, end: MAX - 1 });
        let buf = '';
        stream.on('data', (d) => (buf += d.toString('utf8')));
        stream.on('end', () => {
          // 含 NUL 字节通常是二进制文件，不做文本预览
          if (buf.includes('\x00')) return reject(new Error('疑似二进制文件，请下载后用本地程序打开'));
          resolve(buf);
        });
        stream.on('error', reject);
      });
      return { text, truncated: st.size > MAX, size: st.size, mode: 'head' };
    }),
  );

  // 文件搜索：远程 find（限制深度与条数）
  ipcMain.handle(
    'sftp:search',
    wrap(async ({ id, base, keyword }) => {
      const conn = await getConn(id);
      const kw = String(keyword).replace(/['"]/g, '').slice(0, 120);
      const cmd = `find ${shq(base)} -maxdepth 4 -iname ${shq('*' + kw + '*')} 2>/dev/null | head -200`;
      const { stdout } = await conn.exec(cmd, 20000);
      return {
        base,
        paths: stdout
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      };
    }),
  );

  // 压缩：tar czf
  ipcMain.handle(
    'sftp:archive',
    wrap(async ({ id, cwd, names, archiveName }) => {
      const conn = await getConn(id);
      const target = archiveName.endsWith('.tar.gz') || archiveName.endsWith('.tgz') ? archiveName : archiveName + '.tar.gz';
      const cmd = `cd ${shq(cwd)} && tar -czf ${shq(target)} ${names.map(shq).join(' ')}`;
      const { stdout, stderr } = await conn.exec(cmd, 120000);
      if (stderr && /permission denied/i.test(stderr)) throw new Error(stderr);
      return { name: target, stdout };
    }),
  );

  // 解压：tar / unzip
  ipcMain.handle(
    'sftp:extract',
    wrap(async ({ id, cwd, path: p }) => {
      const conn = await getConn(id);
      let cmd;
      if (/\.tar\.(gz|tgz|bz2|xz)$/i.test(p) || /\.tgz$/i.test(p)) cmd = `cd ${shq(cwd)} && tar -xf ${shq(p)}`;
      else if (/\.zip$/i.test(p)) cmd = `cd ${shq(cwd)} && (unzip -o ${shq(p)} || (echo 'NO_UNZIP' && exit 1))`;
      else cmd = `cd ${shq(cwd)} && tar -xf ${shq(p)}`;
      const { stderr, stdout } = await conn.exec(cmd, 120000);
      if (/NO_UNZIP/i.test(stderr + stdout)) throw new Error('远程未安装 unzip，无法解压 zip（tar.gz 可用）');
      if (stderr && /permission denied/i.test(stderr)) throw new Error(stderr);
      return { ok: true };
    }),
  );

  // ============ 传输队列 ============
  transfers = new TransferManager({
    getConn,
    storeFile: path.join(app.getPath('userData'), 'transfers.json'),
    knownHostsLine: hostkeys.knownHostsLine,
    notify: (t, isFail) => {
      if (!Notification.isSupported()) return;
      const kindText = t.kind === 'upload' ? '上传' : t.kind === 'download' ? '下载' : '服务器互传';
      const title = isFail ? `${kindText}失败：${t.name}` : `${kindText}完成：${t.name}`;
      const body = isFail
        ? (t.error || '未知错误').slice(0, 160)
        : t.size ? `已传输 ${formatBytesHuman(t.size)}` : '传输已完成';
      new Notification({ title, body, silent: !isFail }).show(); // 失败带系统提示音，完成静默
    },
  });
  transfers.onUpdate((t) => broadcast('transfer:update', t));

  ipcMain.handle('transfer:list', () => transfers.list());
  ipcMain.handle('transfer:pause', (_e, id) => transfers.pause(id));
  ipcMain.handle('transfer:cancel', (_e, id) => transfers.cancel(id));
  ipcMain.handle('transfer:resume', (_e, id) => transfers.resume(id, false));
  ipcMain.handle('transfer:retry', (_e, id) => transfers.resume(id, false)); // 重试=从断点续传，不删目标端文件
  ipcMain.handle('transfer:remove', (_e, id) => transfers.remove(id));
  ipcMain.handle('transfer:clear', () => transfers.clearFinished());
  ipcMain.handle('transfer:pause-all', () => transfers.pauseAll());
  ipcMain.handle('transfer:resume-all', () => transfers.resumeAll());
  ipcMain.handle('transfer:cancel-many', (_e, ids) => transfers.cancelMany(ids));
  ipcMain.handle('transfer:retry-failed', () => transfers.retryFailed());
  ipcMain.handle('transfer:move', (_e, { id, dir }) => transfers.move(id, dir));
  ipcMain.handle('transfer:concurrency', (_e, n) => transfers.setConcurrency(n));
  ipcMain.handle('transfer:options', (_e, o) => {
    transfers.setOptions(o || {});
    return true;
  });

  // 上传：本地 → 远程。文件逐个建任务；目录建一个顶层任务，执行期边遍历边传（大目录不再阻塞入队）
  ipcMain.handle(
    'transfer:upload',
    wrap(async ({ id, localPaths, remoteDir, serverName }) => {
      const jobs = [];
      const gid = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      for (const lp of localPaths) {
        const st = await fs.promises.lstat(lp);
        const base = path.basename(lp);
        jobs.push({
          kind: 'upload',
          serverId: id,
          serverName,
          srcLocal: lp,
          dstRemote: posixJoin(remoteDir, base),
          name: base,
          size: st.isDirectory() ? 0 : st.size,
          groupId: gid,
        });
      }
      return transfers.addMany(jobs);
    }),
  );

  // 下载：远程 → 本地。文件逐个建任务；目录建一个顶层任务，执行期边遍历边传
  ipcMain.handle(
    'transfer:download',
    wrap(async ({ id, items, localDir, serverName }) => {
      await getConn(id);
      const jobs = [];
      const gid = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      for (const item of items) {
        const isDir = item.type === 'dir' || item.linkToDir;
        jobs.push({
          kind: 'download',
          serverId: id,
          serverName,
          srcRemote: item.path,
          dstLocal: path.join(localDir, toLocalRel(item.name)),
          name: item.name,
          size: isDir ? 0 : item.size || 0,
          groupId: gid,
        });
      }
      return transfers.addMany(jobs);
    }),
  );

  // 服务器互传：A 的文件/文件夹 → B。入队不做全量遍历（大目录会很慢），
  // 每个顶层项建一个任务，目录在执行期边遍历边传
  ipcMain.handle(
    'transfer:relay',
    wrap(async ({ srcId, dstId, items, dstDir, srcName, dstName }) => {
      await getConn(srcId);
      await getConn(dstId);
      const jobs = [];
      for (const item of items) {
        const gid = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        jobs.push({
          kind: 'relay',
          serverId: srcId,
          peerId: dstId,
          serverName: srcName,
          peerName: dstName,
          srcRemote: item.path,
          dstRemote: posixJoin(dstDir, item.name),
          name: item.name,
          size: item.size || 0,
          groupId: gid,
        });
      }
      return transfers.addMany(jobs);
    }),
  );
}

function init() {
  setHostKeyChecker(hostkeys.makeVerifier()); // 所有出站 SSH 连接启用 TOFU 指纹校验
  servers = store.load();
  registerIpc();
  start();
  watchDefaultConfig();
}

module.exports = { init, hasActiveTransfers: () => (transfers ? transfers.hasActive() : false) };
