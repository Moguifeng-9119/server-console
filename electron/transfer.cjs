// 传输引擎：多任务队列 + 任务级并发 + 进度/速度 + 暂停/取消 + 断点续传
// 支持：upload（本地→远程）、download（远程→本地，先写 .scpart 完成后改名）、
//      relay（服务器 A→服务器 B，本机内存流中继、不落盘）
// 顺序流式 + 大 chunk + 任务级并发：顺序写使“目标当前大小 == 已连续完成字节”，断点续传严格正确。
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DEFAULT_CONCURRENCY = 15; // 同时传输的顶层任务数（默认，可在设置中 1-15 调整）
const MAX_CONCURRENT_TASKS = DEFAULT_CONCURRENCY;
const RECENT_KEEP = 120; // 每个任务保留的最近传输文件名条数（环形，避免广播/内存膨胀）
const RELAY_FILE_CONCURRENCY = 6; // 单个目录中继任务内同时传输的文件数（真机基准：6 路即吃满链路，再高无益）
const DIR_LIST_TIMEOUT = 30000; // 列举单个远程目录的超时，避免异常目录无限挂起
const STREAM_CHUNK = 128 * 1024; // 单流读块大小
const PART_SUFFIX = '.scpart';
const EMIT_MS = 250;
const KEEP_FINISHED = 200; // 已结束/暂停任务最多保留条数，超出按时间淘汰，防止任务无限累积撑爆内存与持久化文件
const SAVE_DEBOUNCE = 1000; // 持久化防抖（毫秒）

const ABORT = new Error('__ABORT__');
ABORT.aborted = true;

const posixJoin = (dir, name) => (!dir || dir === '.' ? name : dir.replace(/\/$/, '') + '/' + name);

// 任务级门控：登记在传流与中止回调，取消/暂停时一次性中断所有在传流，结束即注销（不残留引用）
function makeGate() {
  return {
    canceled: false,
    _streams: new Set(),
    _abortFns: new Set(),
    track(s) {
      if (s) this._streams.add(s);
    },
    untrack(s) {
      if (s) this._streams.delete(s);
    },
    onAbort(fn) {
      this._abortFns.add(fn);
      return () => this._abortFns.delete(fn);
    },
    abort() {
      this.canceled = true;
      for (const fn of this._abortFns) {
        try {
          fn();
        } catch {
          /* noop */
        }
      }
      for (const s of this._streams) {
        try {
          s.destroy();
        } catch {
          /* noop */
        }
      }
    },
  };
}

// 给 SFTP 操作加超时，防止异常目录/网络抖动让任务无限 pending
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || '操作'}超时（${Math.round(ms / 1000)}s）`)), ms)),
  ]);
}

function humanErr(e) {
  const m = String((e && e.message) || e || '传输失败');
  return m === '__ABORT__' ? '已中止' : m;
}

// 把可读流泵到可写流，带背压、字节计数、可中止
function pump(rs, ws, onBytes, gate) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    gate.track(rs);
    gate.track(ws);
    const cleanup = () => {
      gate.untrack(rs);
      gate.untrack(ws);
      try {
        rs.destroy();
      } catch {
        /* noop */
      }
      try {
        ws.destroy();
      } catch {
        /* noop */
      }
    };
    const fail = (e) => {
      if (settled) return;
      settled = true;
      offAbort();
      cleanup();
      reject(e || new Error('流异常'));
    };
    const offAbort = gate.onAbort(() => fail(ABORT));
    rs.on('error', fail);
    ws.on('error', fail);
    rs.on('data', (d) => {
      bytes += d.length;
      onBytes(bytes);
      const ok = ws.write(d);
      if (ok === false) {
        rs.pause();
        ws.once('drain', () => {
          if (!settled) rs.resume();
        });
      }
    });
    rs.on('end', () => ws.end());
    ws.on('close', () => {
      if (settled) return;
      settled = true;
      offAbort();
      cleanup();
      resolve(bytes);
    });
  });
}

class TransferManager {
  // getConn(serverId) -> Promise<Connection>（由 ipc 注入，复用连接池）
  constructor({ getConn, storeFile, notify }) {
    this.getConn = getConn;
    this.storeFile = storeFile || null;
    this.notify = typeof notify === 'function' ? notify : null; // 任务完成/失败系统通知回调
    this.maxConcurrent = DEFAULT_CONCURRENCY;
    this.options = { notifyDone: true, notifyFail: true };
    this.tasks = new Map();
    this.queue = [];
    this.running = 0;
    this.listener = null;
    this._saveTimer = null;
    this._load();
  }

  setConcurrency(n) {
    const v = Math.max(1, Math.min(15, Number(n) || DEFAULT_CONCURRENCY));
    this.maxConcurrent = v;
    this._schedule();
    return v;
  }

  setOptions(o = {}) {
    this.options = { ...this.options, ...o };
  }

  onUpdate(fn) {
    this.listener = fn;
  }

  pub(t) {
    let srcPath = '';
    let dstPath = '';
    if (t.kind === 'upload') {
      srcPath = t.srcLocal || '';
      dstPath = `${t.serverName || ''}:${t.dstRemote || ''}`;
    } else if (t.kind === 'download') {
      srcPath = `${t.serverName || ''}:${t.srcRemote || ''}`;
      dstPath = t.dstLocal || '';
    } else {
      srcPath = `${t.serverName || ''}:${t.srcRemote || ''}`;
      dstPath = `${t.peerName || ''}:${t.dstRemote || ''}`;
    }
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      size: t.size,
      transferred: t.transferred,
      status: t.status,
      speed: t.speed,
      error: t.error,
      groupId: t.groupId,
      serverName: t.serverName,
      peerName: t.peerName,
      direction: t.direction,
      srcPath,
      dstPath,
      filesTotal: t.filesTotal || 0,
      filesDone: t.filesDone || 0,
      recentFiles: t.recentFiles || [],
      direct: !!t.direct,
      directMode: t.directMode || '',
      directNote: t.directNote || '',
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
    };
  }

  // 记录一个刚完成的文件（rsync 逐文件输出），环形保留最近 RECENT_KEEP 条
  _noteFile(t, name) {
    if (!name) return;
    t.filesDone = (t.filesDone || 0) + 1;
    this._pushRecent(t, name);
  }

  // 仅追加到最近文件流（计数由调用方自行维护时使用）
  _pushRecent(t, name) {
    if (!name) return;
    if (!t.recentFiles) t.recentFiles = [];
    t.recentFiles.push({ name, at: Date.now() });
    if (t.recentFiles.length > RECENT_KEEP) t.recentFiles.splice(0, t.recentFiles.length - RECENT_KEEP);
  }

  emit(t) {
    if (this.listener) this.listener(this.pub(t));
    this.saveSoon();
  }

  // 裁剪任务表：运行/排队中的全保留；其余（暂停/完成/失败/取消）只留最近 KEEP_FINISHED 条
  _prune() {
    const active = [];
    const rest = [];
    for (const t of this.tasks.values()) {
      if (t.status === 'running' || t.status === 'queued') active.push(t);
      else rest.push(t);
    }
    if (rest.length <= KEEP_FINISHED) return false;
    rest.sort((a, b) => (b.finishedAt || b.startedAt || 0) - (a.finishedAt || a.startedAt || 0));
    const keep = new Set(active);
    for (let i = 0; i < KEEP_FINISHED; i++) keep.add(rest[i]);
    let removed = 0;
    for (const [id, t] of this.tasks) {
      if (!keep.has(t)) {
        this.tasks.delete(id);
        removed += 1;
      }
    }
    return removed > 0;
  }

  // ---- 持久化（用于跨重启断点续传）。异步原子写，绝不阻塞主进程事件循环 ----
  saveSoon() {
    if (!this.storeFile) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._persistNow();
    }, SAVE_DEBOUNCE);
  }

  async _persistNow() {
    if (!this.storeFile) return;
    if (this._writing) {
      this._dirty = true; // 写盘期间又有变更，写完再补一次
      return;
    }
    this._writing = true;
    try {
      this._prune();
      // recentFiles 仅用于实时展示，不落盘（避免大目录把 transfers.json 撑大）
      const data = [...this.tasks.values()].map((t) => {
        const p = this.pub(t);
        delete p.recentFiles;
        return p;
      });
      const tmp = this.storeFile + '.tmp';
      await fsp.mkdir(path.dirname(this.storeFile), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fsp.rename(tmp, this.storeFile);
    } catch {
      /* ignore */
    } finally {
      this._writing = false;
      if (this._dirty) {
        this._dirty = false;
        this._persistNow();
      }
    }
  }

  _load() {
    if (!this.storeFile) return;
    try {
      const arr = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
      for (const t of arr) {
        if (t.status === 'running' || t.status === 'queued') t.status = 'paused';
        t.speed = 0;
        this.tasks.set(t.id, t);
      }
      // 加载后立即裁剪并异步落盘：把历史累积的超大文件一次性瘦身
      if (this._prune()) this._persistNow();
    } catch {
      /* ignore */
    }
  }

  list() {
    this._prune();
    return [...this.tasks.values()].map((t) => this.pub(t));
  }

  _add(job) {
    const id = job.id || `tf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const t = {
      id,
      kind: job.kind,
      name: job.name,
      size: job.size || 0,
      transferred: job.transferred || 0,
      status: 'queued',
      speed: 0,
      error: '',
      groupId: job.groupId || '',
      serverId: job.serverId,
      serverName: job.serverName || '',
      peerId: job.peerId,
      peerName: job.peerName || '',
      srcLocal: job.srcLocal,
      dstLocal: job.dstLocal,
      srcRemote: job.srcRemote,
      dstRemote: job.dstRemote,
      direction: job.direction,
      direct: false,
      directMode: '',
      directNote: '',
      filesTotal: 0,
      filesDone: 0,
      recentFiles: [],
      startedAt: 0,
      finishedAt: 0,
      _gate: null,
    };
    this.tasks.set(id, t);
    this.queue.push(id);
    this.emit(t);
    this._schedule();
    return this.pub(t);
  }

  addMany(jobs) {
    const out = jobs.map((j) => this._add(j));
    this._prune();
    return out;
  }

  _schedule() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      const t = this.tasks.get(id);
      if (!t || t.status !== 'queued') continue;
      this._launch(t);
    }
  }

  async _launch(t) {
    this.running++;
    t.status = 'running';
    t.error = '';
    t.speed = 0;
    t.startedAt = t.startedAt || Date.now();
    this.emit(t);
    const gate = makeGate();
    t._gate = gate;
    const makeProgress = () => {
      let last = Date.now();
      let lastBytes = t.transferred || 0;
      return (delta, size) => {
        t.transferred = (t._baseOffset || 0) + delta;
        const n = Date.now();
        if (n - last >= EMIT_MS || t.transferred >= size) {
          const dt = (n - last) / 1000;
          t.speed = dt > 0 ? Math.max(0, (t.transferred - lastBytes) / dt) : t.speed;
          last = n;
          lastBytes = t.transferred;
          if (size) t.size = size;
          this.emit(t);
        }
      };
    };
    try {
      if (t.kind === 'upload') await this._runUpload(t, gate, makeProgress());
      else if (t.kind === 'download') await this._runDownload(t, gate, makeProgress());
      else if (t.kind === 'relay') await this._runRelay(t, gate);
      else throw new Error('未知任务类型');
      t.status = 'done';
      t.speed = 0;
      t.transferred = t.size;
      t.finishedAt = Date.now();
    } catch (e) {
      t.speed = 0;
      if (e && e.aborted) {
        // 暂停保留现场；取消则清理半成品
        if (t._wantCancel) {
          t.status = 'canceled';
          await this._cleanup(t);
        } else {
          t.status = 'paused';
        }
      } else {
        t.status = 'error';
        t.error = humanErr(e);
      }
    } finally {
      t._gate = null;
      this.running = Math.max(0, this.running - 1);
      this.emit(t);
      if (t.status === 'done' && this.notify && this.options.notifyDone) this.notify(t, false);
      else if (t.status === 'error' && this.notify && this.options.notifyFail) this.notify(t, true);
      this._schedule();
    }
  }

  // 队列排序：上移/下移（仅对排队中的任务有效，运行中的不可抢占）
  move(id, dir) {
    const i = this.queue.indexOf(id);
    if (i < 0) return false;
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= this.queue.length) return false;
    const tmp = this.queue[i];
    this.queue[i] = this.queue[j];
    this.queue[j] = tmp;
    return true;
  }

  pauseAll() {
    for (const id of [...this.queue]) this.pause(id);
    for (const [id, t] of this.tasks) if (t.status === 'running') this.pause(id);
    return true;
  }

  resumeAll() {
    for (const [id, t] of this.tasks) if (t.status === 'paused') this.resume(id, false);
    return true;
  }

  cancelMany(ids) {
    for (const id of ids || []) this.cancel(id);
    return true;
  }

  retryFailed() {
    for (const [id, t] of this.tasks) if (t.status === 'error') this.resume(id, true);
    return true;
  }

  async _cleanup(t) {
    try {
      if (t.dstLocal && fs.existsSync(t.dstLocal + PART_SUFFIX)) await fsp.unlink(t.dstLocal + PART_SUFFIX);
    } catch {
      /* noop */
    }
  }

  async _conn(id) {
    const c = await this.getConn(id);
    if (!c) throw new Error('服务器连接不可用');
    return c;
  }

  // ---- 上传：本地 → 远程 ----
  async _runUpload(t, gate, onProgress) {
    const conn = await this._conn(t.serverId);
    const sftp = await conn.sftp();
    const localStat = await fsp.stat(t.srcLocal);
    t.size = localStat.size;
    await conn.mkdirpRemote(posixDir(t.dstRemote));
    let offset = 0;
    try {
      const rs = await new Promise((res, rej) => sftp.stat(t.dstRemote, (e, r) => (e ? rej(e) : res(r))));
      if (rs.size > 0 && rs.size < t.size) offset = rs.size;
    } catch {
      /* 远程不存在 → 全新 */
    }
    t._baseOffset = offset;
    t.transferred = offset;
    if (t.size === 0 && offset === 0) {
      await new Promise((res, rej) =>
        sftp.writeFile(t.dstRemote, Buffer.alloc(0), (e) => (e ? rej(e) : res())),
      );
      return;
    }
    const local = fs.createReadStream(t.srcLocal, { start: offset, highWaterMark: STREAM_CHUNK * 2 });
    const remote = sftp.createWriteStream(t.dstRemote, {
      start: offset,
      flags: offset ? 'a' : 'w',
      chunkSize: STREAM_CHUNK,
    });
    await pump(local, remote, (d) => onProgress(d, t.size), gate);
  }

  // ---- 下载：远程 → 本地（.scpart → 完成改名） ----
  async _runDownload(t, gate, onProgress) {
    const conn = await this._conn(t.serverId);
    const sftp = await conn.sftp();
    const rstat = await conn.statRemote(t.srcRemote);
    t.size = rstat.size;
    await fsp.mkdir(path.dirname(t.dstLocal), { recursive: true });
    const part = t.dstLocal + PART_SUFFIX;
    let offset = 0;
    try {
      const ps = await fsp.stat(part);
      if (ps.size > 0 && ps.size < t.size) offset = ps.size;
    } catch {
      /* 无半成品 → 全新 */
    }
    t._baseOffset = offset;
    t.transferred = offset;
    if (t.size === 0 && offset === 0) {
      await fsp.writeFile(part, Buffer.alloc(0));
      await fsp.rename(part, t.dstLocal);
      return;
    }
    const remote = sftp.createReadStream(t.srcRemote, { start: offset, chunkSize: STREAM_CHUNK });
    const local = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
    await pump(remote, local, (d) => onProgress(d, t.size), gate);
    await fsp.rename(part, t.dstLocal);
  }

  // ---- 中继：服务器 A → 服务器 B。优先服务器直传（数据不过本机，同机/同机房快数十倍），不可达自动回退本机内存中继 ----
  async _runRelay(t, gate) {
    const a = await this._conn(t.serverId);
    const b = await this._conn(t.peerId);
    try {
      const done = await this._runRelayDirect(t, gate, a, b);
      if (done) {
        t.direct = true;
        t.speed = 0;
        if (t.size) t.transferred = t.size; // 目录总量若仍在后台统计，保留已采样到的传输量
        return;
      }
    } catch (e) {
      if (e && e.aborted) throw e;
      t.direct = false; // 直传不可用/中断 → 静默回退本机中继，保证一定能传
    }
    await this._runRelayPump(t, gate, a, b);
  }

  // 服务器直传：在源 A 上生成临时密钥、把公钥临时注入目标 B，由 A 用 rsync/scp 直接推到 B，结束即焚
  // 返回 true=直传完成；抛出异常=不可用（调用方回退）
  async _runRelayDirect(t, gate, connA, connB) {
    const cfgB = connB.cfg || {};
    const host = cfgB.host;
    const port = cfgB.port || 22;
    const user = cfgB.username || 'root';
    if (!host) throw new Error('目标缺少主机地址');
    const tag = 'sc' + Math.random().toString(36).slice(2, 10);
    const dir = '/tmp/.' + tag;
    const key = dir + '/k';
    const script = dir + '/run.sh';
    const rcfile = dir + '/rc';
    const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    const wf = (s, p, b) => new Promise((res, rej) => s.writeFile(p, b, (e) => (e ? rej(e) : res())));

    const sa = await connA.sftp();
    const top = await connA.statRemote(t.srcRemote);
    const isDir = top.type === 'dir';

    // 1) 源端生成一次性临时密钥（不使用用户主私钥）
    await connA.exec(`mkdir -p ${dir} && chmod 700 ${dir} && ssh-keygen -t ed25519 -N '' -f ${key} -q`);
    let installed = false;
    try {
      const pubRaw = (await connA.exec(`cat ${key}.pub`)).stdout.trim();
      const marked = pubRaw.split(' ').slice(0, 2).join(' ') + ' ' + tag; // 用随机 tag 作注释，便于精确删除
      // 2) 临时把公钥注入目标 authorized_keys
      await connB.exec(
        `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ` +
          `grep -qF ${q(marked)} ~/.ssh/authorized_keys || echo ${q(marked)} >> ~/.ssh/authorized_keys`,
      );
      installed = true;
      const sshOpt = `-i ${key} -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=8`;
      // 3) 探测源能否免密直连目标（连不通就直接回退，不浪费时间）
      const probe = await connA.exec(`timeout 15 ssh ${sshOpt} ${q(user + '@' + host)} 'echo DIRECT_OK'; echo "__P=$?"`, 20000);
      if (!/DIRECT_OK/.test(probe.stdout)) throw new Error('源到目标不可直连');
      t.direct = true; // 确定走直传，运行中即可在界面显示
      // 4) 总大小：单文件用 stat；目录不做阻塞式全量 du（几十万文件要遍历数分钟，会造成“开始前干等/0速度”），
      //    改为后台异步估算，算完再回填，传输本身立即开始
      t.size = isDir ? 0 : top.size;
      if (isDir) {
        connA
          .exec(`du -sb ${q(t.srcRemote)}`, 30 * 60 * 1000)
          .then((r) => {
            const n = parseInt(r.stdout);
            if (n && gate && !gate.canceled) {
              t.size = n;
              this.emit(t);
            }
          })
          .catch(() => {});
        // 后台统计文件总数（同样不阻塞开传），用于 文件 x/y
        connA
          .exec(`find ${q(t.srcRemote)} -type f | wc -l`, 30 * 60 * 1000)
          .then((r) => {
            const n = parseInt(r.stdout);
            if (n && gate && !gate.canceled) {
              t.filesTotal = n;
              this.emit(t);
            }
          })
          .catch(() => {});
      }
      // 5) 目标落点目录
      await connB.exec(`mkdir -p ${q(isDir ? t.dstRemote : posixDir(t.dstRemote))}`);
      // 6) 两端能力探测：rsync 需两端都安装；tar-over-ssh 通用性最好；scp 最后兜底
      const dst = user + '@' + host;
      const cap = await connA.exec(
        `s(){ command -v $1 >/dev/null 2>&1 && echo y || echo n; }; echo "src rsync=$(s rsync) tar=$(s tar) scp=$(s scp)"; ` +
          `timeout 12 ssh ${sshOpt} ${q(dst)} 'r(){ command -v $1 >/dev/null 2>&1 && echo y || echo n; }; echo "dst rsync=$(r rsync) tar=$(r tar) scp=$(r scp)"'`,
        20000,
      );
      const capText = (cap.stdout || '').replace(/\s+/g, ' ').trim();
      const has = (side, tool) => new RegExp(side + ' .*?' + tool + '=y').test(capText);
      const useRsync = has('src', 'rsync') && has('dst', 'rsync');
      const useTar = has('src', 'tar') && has('dst', 'tar');
      const logf = dir + '/out.log';
      const notefile = dir + '/note';
      const modefile = dir + '/mode';
      t.directNote = 'caps[' + capText + ']';
      // 各形态参数
      const rsyncSrc = isDir ? q(t.srcRemote + '/.') : q(t.srcRemote);
      const rsyncDst = isDir ? q(dst + ':' + t.dstRemote + '/') : q(dst + ':' + t.dstRemote);
      const sshVar = `ssh ${sshOpt}`;
      let modeLines = '';
      if (useRsync) {
        // rsync：两端都有时最优，支持增量续传；--out-format 逐文件回传已完成文件名（@@前缀，stdout 实时流出），错误仍进日志
        modeLines +=
          `if rsync -aW --partial --numeric-ids --out-format='@@%n' -e ${q(sshVar)} ${rsyncSrc} ${rsyncDst} 2>>${logf}; then echo rsync >${modefile}; echo 0 >${rcfile}; exit 0; ` +
          `else echo "rsync:$(tail -c 180 ${logf}|tr '\\n' ' ')" >>${notefile}; fi\n`;
      }
      if (useTar) {
        // tar over ssh：不依赖 rsync，远端只需 tar+ssh；目录打包内容解到目标，单文件按原名解到目标父目录
        const tarCmd = isDir
          ? `tar c -C ${q(t.srcRemote)} . | ${sshVar} ${q(dst)} ${q(`mkdir -p ${t.dstRemote} && tar x -C ${t.dstRemote}`)}`
          : `SB=$(basename ${q(t.srcRemote)}); tar c -C $(dirname ${q(t.srcRemote)}) "$SB" | ${sshVar} ${q(dst)} ${q(
              `DP=$(dirname ${t.dstRemote}); mkdir -p "$DP" && tar x -C "$DP"`,
            )}`;
        modeLines +=
          `if ${tarCmd} >>${logf} 2>&1; then echo tar >${modefile}; echo 0 >${rcfile}; exit 0; ` +
          `else echo "tar:$(tail -c 180 ${logf}|tr '\\n' ' ')" >>${notefile}; fi\n`;
      }
      const scpOpt = `-i ${key} -P ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes`;
      modeLines +=
        `if scp -r ${scpOpt} ${rsyncSrc} ${rsyncDst} >>${logf} 2>&1; then echo scp >${modefile}; echo 0 >${rcfile}; exit 0; ` +
        `else echo "scp:$(tail -c 180 ${logf}|tr '\\n' ' ')" >>${notefile}; fi\n`;
      modeLines += `echo 1 >${rcfile}\n`;
      const body = '#!/bin/bash\nset +e\nrm -f ' + logf + ' ' + notefile + ' ' + modefile + '\n' + modeLines;
      await wf(sa, script, Buffer.from(body));
      // 取消：杀掉源端本次直传相关进程（命令行含随机 tag）
      const killRemote = () => {
        connA.exec(`pkill -f ${tag}`).catch(() => {});
      };
      const offAbort = gate.onAbort(killRemote);
      if (gate.canceled) {
        offAbort();
        throw ABORT; // 取消发生在准备阶段：不启动远程传输，直接走中止流程（finally 仍会清理临时密钥）
      }
      // 进度：每秒在目标端统计已落盘字节
      let lastBytes = 0;
      let lastTime = Date.now();
      const timer = setInterval(async () => {
        try {
          const cmd = isDir ? `du -sb ${q(t.dstRemote)} 2>/dev/null | cut -f1` : `stat -c %s ${q(t.dstRemote)} 2>/dev/null`;
          const n = parseInt((await connB.exec(cmd, 8000)).stdout) || 0;
          const now = Date.now();
          const dt = (now - lastTime) / 1000;
          if (dt > 0) t.speed = Math.max(0, (n - lastBytes) / dt);
          lastBytes = n;
          lastTime = now;
          t.transferred = t.size ? Math.min(n, t.size) : n;
          this.emit(t);
        } catch {
          /* 进度采样失败不影响传输 */
        }
      }, 2000);
      let ok = false;
      let tail = '';
      try {
        // 流式执行：rsync 的 @@文件名 行实时解析为文件计数/最近文件流（节流广播，避免海量文件刷屏）
        let lastFileEmit = 0;
        const run = await connA.execStream(`bash ${script}`, {
          timeout: 24 * 3600 * 1000,
          onLine: (line) => {
            if (!line.startsWith('@@')) return;
            const nm = line.slice(2).trim();
            if (!nm || nm.endsWith('/')) return; // 目录行（rsync 以 / 结尾）不计入文件
            this._noteFile(t, nm);
            const now = Date.now();
            if (now - lastFileEmit >= 500) {
              lastFileEmit = now;
              this.emit(t);
            }
          },
        });
        tail = (run.stderr || '').slice(-300);
        const rcOut = await connA.exec(`cat ${rcfile} 2>/dev/null`);
        ok = /(^|\s)0(\s|$)/.test((rcOut.stdout || '').trim());
        const safeCat = async (p) => {
          try {
            return ((await connA.exec(`cat ${p} 2>/dev/null`)).stdout || '').trim();
          } catch {
            return '';
          }
        };
        t.directMode = await safeCat(modefile);
        const note = await safeCat(notefile);
        if (note) t.directNote += ' | failed: ' + note;
      } finally {
        clearInterval(timer);
        offAbort();
      }
      if (gate.canceled) throw ABORT;
      if (!ok) throw new Error('直传失败：' + tail + ' ' + (t.directNote || ''));
      t.directNote += ' | mode=' + (t.directMode || '?');
      this.emit(t);
      return true;
    } finally {
      // 7) 即焚：移除目标端临时公钥、删除源端临时密钥/脚本
      if (installed) {
        try {
          await connB.exec(`sed -i '\\#${tag}#d' ~/.ssh/authorized_keys`);
        } catch {
          /* noop */
        }
      }
      try {
        await connA.exec(`rm -rf ${dir}`);
      } catch {
        /* noop */
      }
    }
  }

  // 本机内存中继（直传不可用时的兜底，数据经本机转发）
  async _runRelayPump(t, gate, a, b) {
    const [sa, sb] = await Promise.all([a.sftp(), b.sftp()]);
    const top = await a.statRemote(t.srcRemote);
    const topIsDir = top.type === 'dir';
    await b.mkdirpRemote(topIsDir ? t.dstRemote : posixDir(t.dstRemote));
    if (topIsDir) {
      t.filesTotal = 0;
      t.filesDone = 0;
      await this._relayTree(t, gate, a, b, sa, sb, t.srcRemote, t.dstRemote);
      t.transferred = t.size;
      return;
    }
    t.size = top.size;
    await this._relayOneFile(gate, sa, sb, t.srcRemote, t.dstRemote, top.size, (d) => {
      t.transferred = d;
      this.emit(t);
    });
    t.transferred = t.size;
    t.filesDone = 1;
    this._pushRecent(t, t.name);
  }

  // 单个文件中继（断点续传；0 字节直接建空文件，避免空流触发 SFTP Failure）
  async _relayOneFile(gate, sa, sb, srcAbs, dstAbs, size, onBytes) {
    let offset = 0;
    try {
      const ex = await new Promise((res, rej) => sb.stat(dstAbs, (e, r) => (e ? rej(e) : res(r))));
      if (ex.size > 0 && ex.size < size) offset = ex.size;
    } catch {
      /* 目标不存在 → 全新 */
    }
    if (size === 0 && offset === 0) {
      await new Promise((res, rej) => sb.writeFile(dstAbs, Buffer.alloc(0), (e) => (e ? rej(e) : res())));
      onBytes && onBytes(0);
      return;
    }
    await pump(
      sa.createReadStream(srcAbs, { start: offset, chunkSize: STREAM_CHUNK }),
      sb.createWriteStream(dstAbs, { start: offset, flags: offset ? 'a' : 'w', chunkSize: STREAM_CHUNK }),
      (d) => onBytes && onBytes(offset + d),
      gate,
    );
  }

  // 目录中继：边遍历边传。readdir 自带文件属性（不再每文件多一次往返）、有界文件并发、单目录列举超时
  async _relayTree(t, gate, connA, connB, sa, sb, srcRoot, dstRoot) {
    const jobs = [{ src: srcRoot, dst: dstRoot, isDir: true, size: 0 }];
    let totalBytes = 0;
    let doneFilesBytes = 0;
    let filesTotal = 0;
    let filesDone = 0;
    const inflight = new Map();
    let running = 0;
    let lastEmit = 0;
    let lastBytes = 0;
    let lastTime = Date.now();
    const errors = [];
    const curDone = () => {
      let s = doneFilesBytes;
      for (const v of inflight.values()) s += v;
      return s;
    };
    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < EMIT_MS) return;
      const dt = (now - lastTime) / 1000;
      const done = curDone();
      if (dt > 0) t.speed = Math.max(0, (done - lastBytes) / dt);
      lastEmit = now;
      lastTime = now;
      lastBytes = done;
      t.size = totalBytes;
      t.transferred = done;
      t.filesTotal = filesTotal;
      t.filesDone = filesDone;
      this.emit(t);
    };
    const handle = async (j) => {
      if (gate.canceled) throw ABORT;
      if (j.isDir) {
        await connB.mkdirpRemote(j.dst);
        const listing = await withTimeout(connA.listDir(j.src), DIR_LIST_TIMEOUT, '列举目录 ' + j.src);
        const children = listing.entries.map((e) => ({
          src: posixJoin(j.src, e.name),
          dst: posixJoin(j.dst, e.name),
          isDir: e.type === 'dir' || !!e.linkToDir,
          size: e.size || 0,
        }));
        for (const c of children) {
          if (!c.isDir) {
            totalBytes += c.size;
            filesTotal += 1;
          }
          jobs.push(c);
        }
        emit(false);
      } else {
        inflight.set(j.src, 0);
        try {
          await this._relayOneFile(gate, sa, sb, j.src, j.dst, j.size, (absInFile) => {
            inflight.set(j.src, absInFile);
            emit(false);
          });
        } catch (e) {
          if (e && e.aborted) throw e;
          errors.push(`${j.src}: ${e && e.message ? e.message : e}`);
        } finally {
          inflight.delete(j.src);
          doneFilesBytes += j.size;
          filesDone += 1;
          const rel = j.src.startsWith(srcRoot) ? j.src.slice(srcRoot.length).replace(/^\/+/, '') : j.src;
          this._pushRecent(t, rel || j.src);
          emit(false);
        }
      }
    };
    await new Promise((resolve, reject) => {
      let stop = false;
      const schedule = () => {
        while (!stop && running < RELAY_FILE_CONCURRENCY && jobs.length) {
          const j = jobs.shift();
          running += 1;
          handle(j).then(
            () => {
              running -= 1;
              if (stop) return;
              schedule();
            },
            (err) => {
              stop = true;
              reject(err);
            },
          );
        }
        if (!stop && jobs.length === 0 && running === 0) {
          stop = true;
          emit(true);
          resolve();
        }
      };
      schedule();
    });
    if (errors.length) throw new Error(`目录内 ${errors.length} 项失败，首个：${errors[0]}`);
  }

  pause(id) {
    const t = this.tasks.get(id);
    if (!t) return false;
    t._wantCancel = false;
    if (t.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      t.status = 'paused';
      this.emit(t);
      return true;
    }
    if (t.status === 'running' && t._gate) {
      t._gate.abort();
    }
    return true;
  }

  cancel(id) {
    const t = this.tasks.get(id);
    if (!t) return false;
    t._wantCancel = true;
    if (t.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== id);
      t.status = 'canceled';
      this._cleanup(t);
      this.emit(t);
      return true;
    }
    if (t.status === 'running' && t._gate) {
      t._gate.abort();
    }
    return true;
  }

  // 续传/重试：reset=true 则从头来
  resume(id, reset = false) {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (t.status === 'running') return true;
    if (reset) {
      t.transferred = 0;
      t._baseOffset = 0;
      this._cleanup(t);
      // upload/relay 的远程残留由下次 'w' 覆盖；这里尽力删除
      if (t.kind === 'upload' || t.kind === 'relay') {
        const rid = t.kind === 'upload' ? t.serverId : t.peerId;
        const remote = t.kind === 'upload' ? t.dstRemote : t.dstRemote;
        this._conn(rid)
          .then((c) => c.removeRemote(remote).catch(() => {}))
          .catch(() => {});
      }
    }
    t.status = 'queued';
    t.speed = 0;
    t.error = '';
    t._wantCancel = false;
    if (!this.queue.includes(id)) this.queue.push(id);
    this.emit(t);
    this._schedule();
    return true;
  }

  remove(id) {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (t.status === 'running') return false;
    this.tasks.delete(id);
    this.queue = this.queue.filter((x) => x !== id);
    this.saveSoon();
    return true;
  }

  clearFinished() {
    for (const [id, t] of this.tasks) {
      if (['done', 'canceled'].includes(t.status)) this.tasks.delete(id);
    }
    this.saveSoon();
    return true;
  }
}

function posixDir(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '.';
}

module.exports = { TransferManager, MAX_CONCURRENT_TASKS };
