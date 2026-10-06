const { ipcMain, BrowserWindow, Notification, dialog, app, safeStorage } = require('electron');
const nodeCrypto = require('node:crypto');
const lang = require('./lang.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { Pool, Connection, setHostKeyChecker, setInteractiveHandler, setJumpResolver } = require('./ssh.cjs');
const store = require('./store.cjs');
const localfs = require('./localfs.cjs');
const sshconfig = require('./sshconfig.cjs');
const audit = require('./audit.cjs');
const hostkeys = require('./hostkeys.cjs');
const { ForwardingManager } = require('./forwardings.cjs');
const { TransferManager } = require('./transfer.cjs');

const pool = new Pool();
let servers = [];
let timer = null;
let intervalMs = 2000;
let ticking = false;
let transfers = null;
let forwardings = null;
let configWatchPath = '';
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

function logError(tag, e) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${tag}: ${e && e.stack ? e.stack : e}\n`);
  } catch {
    /* noop */
  }
}

const lastSnapJson = new Map(); // serverId -> 上次快照 JSON（增量广播：内容无变化不重发）
const lastCollectTime = new Map(); // serverId -> 上次采集时间戳（用于后台节点降频调度）
let activeServerId = null; // 当前前端聚焦的服务器 ID（null=在总览或其它页面，全量采集）

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
  // 采集错峰：把各服务器的采集起点按索引摊开，避免同刻打满本机与对端
  const stagger = Math.min(250, Math.floor((intervalMs * 0.8) / Math.max(1, servers.length)));
  const now = Date.now();
  const bgInterval = Math.max(intervalMs * 4, 8000);
  await Promise.all(
    servers.map(async (cfg, i) => {
      await new Promise((r) => setTimeout(r, i * stagger));
      const conn = pool.get(cfg);
      if (conn.isBackedOff()) return; // 退避窗口内不重试也不重复广播

      // 差异化调度：当前聚焦节点每轮必采；未聚焦的后台节点降频至 bgInterval（≥8s）探活，大幅降低机群网络与主进程负载
      const isFocused = !activeServerId || cfg.id === activeServerId;
      if (!isFocused && now - (lastCollectTime.get(cfg.id) || 0) < bgInterval) {
        return;
      }
      lastCollectTime.set(cfg.id, now);

      try {
        const snap = await conn.collect();
        void transfers?.collectStaging({ serverId: cfg.id });
        const json = JSON.stringify(snap);
        if (lastSnapJson.get(cfg.id) === json) return; // 无变化不重发
        lastSnapJson.set(cfg.id, json);
        broadcast('ssh:snapshot', { id: cfg.id, status: 'online', error: '', ...snap });
      } catch (e) {
        console.error('[tick-error]', cfg.host + ':' + cfg.port, statusOfError(e), e.message);
        broadcast('ssh:status', { id: cfg.id, status: statusOfError(e), error: e.message });
      }
    }),
  );
  } finally { ticking = false; }
}

function start() {
  if (timer) clearInterval(timer);
  if (!servers.length) return;
  timer = setInterval(tick, intervalMs);
  tick();
}

function persist(next = servers) {
  store.save(next);
  servers = next;
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
  fs.watchFile(configWatchPath, { interval: 1000 }, () => inspectConfig(configWatchPath));
}

function registerIpc() {
  ipcMain.handle('app:notify', (_e, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.handle('store:info', () => store.info());

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

  // 交互式认证作答回传
  ipcMain.handle('ssh:interactive-reply', (_e, { reqId, answers }) => {
    const p = pendingInteractive.get(String(reqId));
    if (p) {
      pendingInteractive.delete(String(reqId));
      p.resolve(Array.isArray(answers) ? answers.map(String) : []);
    }
    return true;
  });

  ipcMain.handle('servers:list', () => servers.map(store.publicView));

  ipcMain.handle('servers:add', (_e, cfg) => {
    try {
      const v = validateServerCfg(cfg);
      const full = { ...cfg, ...v, id: `srv_${nodeCrypto.randomUUID()}` };
      persist([...servers, full]);
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
      const next = [...servers];
      next[i] = { ...servers[i], ...patch, ...v };
      persist(next);
      pool.remove(servers[i].id); // 凭据/端口可能已变，丢弃旧连接让下个采集周期用新配置重建
      return { ok: true, server: store.publicView(servers[i]) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('servers:remove', (_e, id) => {
    persist(servers.filter((s) => s.id !== id));
    pool.remove(id);
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

  ipcMain.handle('ssh:set-focused', (_e, id) => {
    activeServerId = typeof id === 'string' && id ? id : null;
    return true;
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

  // 通用命令执行（快速命令片段等）：30s 超时，返回 stdout/stderr
  ipcMain.handle('ssh:exec', wrap(async ({ id, cmd }) => {
    const conn = await getConn(id);
    const { stdout, stderr } = await conn.exec(String(cmd), 30000);
    return { stdout, stderr };
  }));

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

  // 远程文本保存：写临时文件后原子改名，避免写一半损坏原文件
  ipcMain.handle(
    'sftp:writeText',
    wrap(async ({ id, path: p, text }) => {
      const conn = await getConn(id);
      const sftp = await conn.sftp();
      const tmp = `${p}.sctmp`;
      await new Promise((res, rej) => sftp.writeFile(tmp, Buffer.from(String(text), 'utf8'), (e) => (e ? rej(e) : res())));
      await new Promise((res, rej) => sftp.rename(tmp, p, (e) => (e ? rej(e) : res())));
      return true;
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
      const cmd = `cd ${shq(cwd)} && tar -czf ${shq(target)} -- ${names.map(shq).join(' ')}`;
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
      else if (/\.zip$/i.test(p)) cmd = `cd ${shq(cwd)} && (unzip -o -- ${shq(p)} || (echo 'NO_UNZIP' && exit 1))`;
      else cmd = `cd ${shq(cwd)} && tar -xf ${shq(p)}`;
      const { stderr, stdout } = await conn.exec(cmd, 120000);
      if (/NO_UNZIP/i.test(stderr + stdout)) throw new Error('远程未安装 unzip，无法解压 zip（tar.gz 可用）');
      if (stderr && /permission denied/i.test(stderr)) throw new Error(stderr);
      return { ok: true };
    }),
  );

  // 修改远程文件权限：chmod
  ipcMain.handle(
    'sftp:chmod',
    wrap(async ({ id, path: p, mode }) => {
      const conn = await getConn(id);
      const sftp = await conn.sftp();
      const numMode = typeof mode === 'number' ? mode : parseInt(String(mode), 8);
      if (Number.isNaN(numMode)) throw new Error('无效的八进制权限格式（如 755 或 644）');
      return new Promise((resolve, reject) => {
        sftp.chmod(p, numMode, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
    }),
  );

  // ============ 并行命令：多服务器同时执行，输出按行缓冲节流广播 ============
  const parallelRuns = new Map(); // runId -> { stop, remaining }
  ipcMain.handle(
    'parallel:run',
    wrap(async ({ ids, cmd }) => {
      const runId = `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const command = String(cmd || '').trim();
      if (!command) throw new Error('命令不能为空');
      if (!ids.length) throw new Error('请至少选择一台服务器');
      const buf = new Map(); // serverId -> 待发送文本
      let remaining = ids.length;
      const flush = setInterval(() => {
        for (const [serverId, text] of buf) {
          if (text) {
            buf.set(serverId, '');
            broadcast('parallel:data', { runId, serverId, text });
          }
        }
      }, 250);
      const finishOne = (serverId) => {
        broadcast('parallel:data', { runId, serverId, done: true });
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(flush);
          parallelRuns.delete(runId);
          broadcast('parallel:done', { runId });
        }
      };
      const run = { stop: () => clearInterval(flush), remaining: ids.length, streams: new Set() };
      parallelRuns.set(runId, run);
      for (const id of ids) {
        (async () => {
          try {
            const conn = await getConn(id);
            const res = await conn.execStream(command, {
              timeout: 0,
              onStream: (stream) => run.streams.add(stream),
              onLine: (line) => {
                const cur = buf.get(id) || '';
                buf.set(id, cur + line + '\n');
              },
            });
            if (res.stderr) buf.set(id, (buf.get(id) || '') + res.stderr);
            finishOne(id);
          } catch (e) {
            buf.set(id, (buf.get(id) || '') + `[错误] ${e.message}\n`);
            finishOne(id);
          }
        })();
      }
      return runId;
    }),
  );
  ipcMain.handle('parallel:stop', (_e, runId) => {
    const run = parallelRuns.get(String(runId));
    if (run) {
      for (const s of run.streams) {
        try {
          s.close();
        } catch {
          /* noop */
        }
      }
      run.stop();
      parallelRuns.delete(String(runId));
      broadcast('parallel:done', { runId: String(runId) });
    }
    return true;
  });

  // ============ 快速命令片段 ============
  const snippetsFile = () => path.join(app.getPath('userData'), 'snippets.json');
  ipcMain.handle('snippets:list', () => {
    try {
      return JSON.parse(fs.readFileSync(snippetsFile(), 'utf8'));
    } catch {
      return [];
    }
  });
  ipcMain.handle('snippets:set', (_e, list) => {
    fs.mkdirSync(path.dirname(snippetsFile()), { recursive: true });
    fs.writeFileSync(snippetsFile(), JSON.stringify(Array.isArray(list) ? list : [], null, 2), { mode: 0o600 });
    return true;
  });

  // ============ 告警 Webhook（钉钉/飞书/企微自定义机器人，按 URL 自动识别格式） ============
  const webhookFile = () => path.join(app.getPath('userData'), 'webhook.json');
  ipcMain.handle('webhook:get', () => {
    try {
      return JSON.parse(fs.readFileSync(webhookFile(), 'utf8'));
    } catch {
      return { url: '' };
    }
  });
  ipcMain.handle('webhook:set', (_e, o) => {
    fs.mkdirSync(path.dirname(webhookFile()), { recursive: true });
    fs.writeFileSync(webhookFile(), JSON.stringify({ url: String(o?.url || '') }, null, 2), { mode: 0o600 });
    return true;
  });
  ipcMain.handle('webhook:send', wrap(async (payload) => {
    let url = '';
    try {
      url = JSON.parse(fs.readFileSync(webhookFile(), 'utf8')).url || '';
    } catch {
      return { ok: true };
    }
    if (!url) return { ok: true };
    const text = `【${payload?.title || '告警'}】${payload?.body || ''}`;
    let body;
    if (/qyapi\.weixin/.test(url)) body = { msgtype: 'text', text: { content: text } };
    else if (/oapi\.dingtalk/.test(url)) body = { msgtype: 'text', text: { content: text } };
    else if (/open\.feishu/.test(url)) body = { msg_type: 'text', content: { text } };
    else body = { text };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      logError('webhook send failed', e);
    } finally {
      clearTimeout(timer);
    }
    return { ok: true };
  }));

  // ============ 内嵌 SSH 终端 ============
  // ============ 内嵌 SSH 终端（多会话：主进程持有，切 tab/重开不丢，缓冲有界） ============
  const TERMINAL_BUF_CAP = 256 * 1024; // 每会话回放缓冲上限（环形裁剪）
  const terminals = new Map(); // termId -> { stream, serverId, buf, attached, createdAt }
  const termData = (termId, s) => {
    const t = terminals.get(termId);
    if (t && t.attached) broadcast('terminal:data', { termId, data: s });
    else if (t) t.buf = (t.buf + s).slice(-TERMINAL_BUF_CAP);
  };
  const broadcastSessions = () => broadcast('terminal:sessions', [...terminals.entries()].map(([termId, t]) => ({ termId, serverId: t.serverId, createdAt: t.createdAt })));

  ipcMain.handle('terminal:open', wrap(async ({ id, cols, rows }) => {
    const conn = await getConn(id);
    const client = await new Promise((resolve, reject) => conn.connect().then(() => resolve(conn.client)).catch(reject));
    const termId = 'tm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    await new Promise((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
        if (err) return reject(err);
        // attached=false 期间输出进会话缓冲；挂接后实时广播。缓冲即会话记忆（切换/重开不丢）
        terminals.set(termId, { stream, serverId: id, buf: '', attached: false, createdAt: Date.now() });
        stream.on('data', (d) => termData(termId, d.toString('utf8')));
        stream.stderr?.on?.('data', (d) => termData(termId, d.toString('utf8')));
        stream.on('close', () => {
          terminals.delete(termId);
          broadcast('terminal:closed', { termId });
          broadcastSessions();
        });
        resolve();
      });
    });
    broadcastSessions();
    return termId;
  }));
  // 挂接：返回累积缓冲（会话记忆回放），之后实时广播
  ipcMain.handle('terminal:attach', (_e, { termId }) => {
    const t = terminals.get(String(termId));
    const replay = t ? t.buf : '';
    if (t) t.attached = true;
    return replay;
  });
  // 脱离：切走 tab 时调用，会话与缓冲保留、后续输出继续进缓冲
  ipcMain.handle('terminal:detach', (_e, { termId }) => {
    const t = terminals.get(String(termId));
    if (t) t.attached = false;
    return true;
  });
  ipcMain.handle('terminal:write', (_e, { termId, data }) => {
    const t = terminals.get(String(termId));
    if (t) t.stream.write(String(data));
    return true;
  });
  ipcMain.handle('terminal:resize', (_e, { termId, cols, rows }) => {
    const t = terminals.get(String(termId));
    if (t) {
      try {
        t.stream.setWindow(Math.floor(Number(rows)) || 24, Math.floor(Number(cols)) || 80, 0, 0);
      } catch {
        /* noop */
      }
    }
    return true;
  });
  ipcMain.handle('terminal:close', (_e, { termId }) => {
    const t = terminals.get(String(termId));
    if (t) {
      try {
        t.stream.end();
      } catch {
        /* noop */
      }
      terminals.delete(String(termId));
      broadcastSessions();
    }
    return true;
  });
  ipcMain.handle('terminal:list', () => [...terminals.entries()].map(([termId, t]) => ({ termId, serverId: t.serverId, createdAt: t.createdAt })));

    // ============ GPU 历史持久化 ============
  const historyFile = () => path.join(app.getPath('userData'), 'history.json');
  ipcMain.handle('history:load', () => {
    try {
      return JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
    } catch {
      return {};
    }
  });
  ipcMain.handle('history:save', (_e, map) => {
    fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
    const temp = historyFile() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(map || {}), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, historyFile());
    return true;
  });

  // ============ 配置导出/导入（AES-256-GCM 口令加密） ============
  ipcMain.handle('config:export', wrap(async ({ passphrase }) => {
    const r = await dialog.showSaveDialog({ title: '导出配置', defaultPath: 'serverconsole-config.json' });
    if (r.canceled || !r.filePath) return '';
    const key = nodeCrypto.createHash('sha256').update(String(passphrase || '')).digest();
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(servers), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    fs.writeFileSync(r.filePath, JSON.stringify({ sc_export: 1, iv: iv.toString('base64'), data: enc.toString('base64') }, null, 2), { mode: 0o600 });
    return r.filePath;
  }));
  ipcMain.handle('config:import', wrap(async ({ passphrase }) => {
    const r = await dialog.showOpenDialog({ title: '导入配置', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return -1;
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (j.sc_export !== 1) throw new Error('不是 ServerConsole 导出文件');
    const key = nodeCrypto.createHash('sha256').update(String(passphrase || '')).digest();
    const iv = Buffer.from(j.iv, 'base64');
    const buf = Buffer.from(j.data, 'base64');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    const plain = Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf8');
    const imported = JSON.parse(plain);
    if (!Array.isArray(imported)) throw new Error('Invalid server configuration list');
    const next = [...servers];
    let count = 0;
    for (const s of imported) {
      if (next.some((x) => x.name === s.name && x.host === s.host)) continue; // 重名同主机跳过
      const valid = validateServerCfg(s);
      next.push({ ...s, ...valid, id: 'srv_' + nodeCrypto.randomUUID() });
      count += 1;
    }
    persist(next);
    return count;
  }));

  // ============ 传输队列 ============
  transfers = new TransferManager({
    getConn,
    endpointIdentity: (id, connection) => { const cfg = connection?.cfg || getCfg(id); return nodeCrypto.createHash('sha256').update(JSON.stringify([cfg.host, cfg.port || 22, cfg.username, cfg.proxyJump || ''])).digest('hex'); },
    storeFile: path.join(app.getPath('userData'), 'transfers.json'),
    knownHostsLine: hostkeys.knownHostsLine,
    notify: (t, isFail) => {
      if (!Notification.isSupported()) return;
      const kindText = t.kind === 'upload' ? lang.t('up') : t.kind === 'download' ? lang.t('down') : lang.t('relay');
      const title = isFail ? `${kindText}: ${t.name}` : lang.t('done', { name: t.name });
      const body = isFail
        ? (t.error || 'Unknown error').slice(0, 160)
        : t.size ? lang.t('size', { size: formatBytesHuman(t.size) }) : lang.t('doneShort');
      new Notification({ title, body, silent: !isFail }).show(); // 失败带系统提示音，完成静默
    },
  });
  transfers.onUpdate((t) => broadcast('transfer:update', t));

  // 端口转发实例（handler 与 init 都用这个闭包）
  forwardings = new ForwardingManager({
    dataDir: app.getPath('userData'),
    getConn,
    onChange: (list) => broadcast('forwardings:changed', list),
  });
  const forwardingList = () => (forwardings ? forwardings.list() : []);

  ipcMain.handle('forwardings:list', () => forwardingList());
  ipcMain.handle('forwardings:upsert', wrap((rule) => forwardings.upsert(rule)));
  ipcMain.handle('forwardings:remove', wrap((id) => forwardings.remove(id)));
  ipcMain.handle('forwardings:start', wrap(async (id) => {
    const rule = forwardingList().find((r) => r.id === id);
    if (!rule) throw new Error('转发规则不存在');
    await forwardings.start(rule);
    return true;
  }));
  ipcMain.handle('forwardings:stop', wrap((id) => forwardings.stop(id)));

  ipcMain.handle('transfer:list', () => transfers.list());
  ipcMain.handle('transfer:pause', (_e, id) => transfers.pause(id));
  ipcMain.handle('transfer:cancel', (_e, id) => transfers.cancel(id));
  ipcMain.handle('transfer:resume', (_e, id) => transfers.resume(id, false));
  ipcMain.handle('transfer:retry', (_e, id) => transfers.resume(id, false)); // 重试=从断点续传，不删目标端文件
  ipcMain.handle('transfer:remove', (_e, id) => transfers.remove(id));
  ipcMain.handle('transfer:forget-legacy', (_e, id) => transfers.forgetLegacy(id));
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
    wrap(async ({ srcId, dstId, items, dstDir, srcName, dstName, ignoreExisting }) => {
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
          ignoreExisting: !!ignoreExisting,
        });
      }
      return transfers.addMany(jobs);
    }),
  );
}

// 跳板机凭据解析：优先复用已保存的、主机匹配的连接凭据；否则回退用目标自身凭据
function resolveJump(cfg) {
  const raw = String(cfg.proxyJump || '').trim();
  if (!raw) return null;
  let user = '';
  let hostPort = raw;
  const at = raw.lastIndexOf('@');
  if (at >= 0) {
    user = raw.slice(0, at);
    hostPort = raw.slice(at + 1);
  }
  let host = hostPort;
  let port = 22;
  const colon = hostPort.lastIndexOf(':');
  if (colon >= 0) {
    const p = Number(hostPort.slice(colon + 1));
    if (Number.isInteger(p) && p > 0 && p <= 65535) {
      host = hostPort.slice(0, colon);
      port = p;
    }
  }
  const hit = servers.find((s) => s.host === host && s.port === port && (!user || s.username === user));
  const base = hit || cfg;
  return {
    host,
    port,
    username: user || base.username,
    authType: base.authType || 'password',
    password: base.password,
    keyPath: base.keyPath,
    passphrase: base.passphrase,
    agentPath: base.agentPath,
  };
}

// 交互式认证（2FA/MFA）：广播给渲染层弹框作答，等待回复（2 分钟超时回退密码）
const pendingInteractive = new Map();
function handleInteractive({ name, prompts }) {
  const reqId = `ki_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  broadcast('ssh:keyboard-interactive', { reqId, title: name || '服务器身份验证', prompts });
  return new Promise((resolve, reject) => {
    pendingInteractive.set(reqId, { resolve });
    setTimeout(() => {
      if (pendingInteractive.has(reqId)) {
        pendingInteractive.delete(reqId);
        reject(new Error('交互式认证等待超时'));
      }
    }, 120000);
  });
}

function init() {
  const userData = app.getPath('userData');
  store.init({ dataDir: userData, safeStorage });
  audit.init(userData);
  hostkeys.init(userData);
  setHostKeyChecker(hostkeys.makeVerifier()); // 所有出站 SSH 连接启用 TOFU 指纹校验
  setJumpResolver(resolveJump);
  setInteractiveHandler(handleInteractive);
  servers = store.load();
  registerIpc();
  start();
  watchDefaultConfig();
  // 恢复启用的端口转发规则（异步，不阻塞启动）
  forwardings.startAll().catch((e) => logError('forwardings startAll', e));
}

module.exports = { init, hasActiveTransfers: () => (transfers ? transfers.hasActive() : false) };
