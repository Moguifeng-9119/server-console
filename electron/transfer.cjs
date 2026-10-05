// 传输引擎：多任务队列 + 任务级并发 + 进度/速度 + 暂停/取消 + 断点续传
// 支持：upload（本地→远程）、download（远程→本地，先写 .scpart 完成后改名）、
//      relay（服务器 A→服务器 B，本机内存流中继、不落盘）
// Sequential streams resume only from verified task-owned staging files.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { serializeTask, canResume } = require('./task-store.cjs');
const { verifiedOffset, verifiedRemoteOffset, remoteStat, uploadPart, commitUpload, assertActive } = require('./safe-files.cjs');

const DEFAULT_CONCURRENCY = 15; // 同时传输的顶层任务数（默认，可在设置中 1-15 调整）
const MAX_CONCURRENT_TASKS = DEFAULT_CONCURRENCY;
const RECENT_KEEP = 120; // 每个任务保留的最近传输文件名条数（环形，避免广播/内存膨胀）
const RELAY_FILE_CONCURRENCY = 6; // Bounded concurrency within one directory task; tune from measured workloads.
const DIR_LIST_TIMEOUT = 30000; // 列举单个远程目录的超时，避免异常目录无限挂起
const STREAM_CHUNK = 128 * 1024; // 单流读块大小
const PART_SUFFIX = '.scpart';
const EMIT_MS = 250;
const KEEP_FINISHED = 200; // 已结束/暂停任务最多保留条数，超出按时间淘汰，防止任务无限累积撑爆内存与持久化文件
const SAVE_DEBOUNCE = 1000; // 持久化防抖（毫秒）

/** @type {Error & { aborted?: boolean }} */
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
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label || '操作'}超时（${Math.round(ms / 1000)}s）`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function humanErr(e) {
  const m = String((e && e.message) || e || '传输失败');
  return m === '__ABORT__' ? '已中止' : m;
}

// 把可读流泵到可写流，带背压、字节计数、可中止、可选全局限速
// limitTake: 管理器级共享令牌桶回调，入参字节数，返回需要暂停的毫秒数（0=不限）
function pump(rs, ws, onBytes, gate, limitTake) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    gate.track(rs);
    gate.track(ws);
    const cleanup = () => {
      gate.untrack(rs);
      gate.untrack(ws);
      if (limitTimer) clearTimeout(limitTimer);
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
    let limitTimer = null;
    rs.on('error', fail);
    ws.on('error', fail);
    rs.on('data', (d) => {
      bytes += d.length;
      onBytes(bytes);
      const ok = ws.write(d);
      const wait = limitTake ? limitTake(d.length) : 0;
      if (ok === false) {
        rs.pause();
        ws.once('drain', () => {
          if (!settled) rs.resume();
        });
      } else if (wait > 0 && !limitTimer) {
        rs.pause();
        limitTimer = setTimeout(() => {
          limitTimer = null;
          if (!settled) rs.resume();
        }, Math.min(wait, 500));
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
  // knownHostsLine(host, port) -> 目标机 known_hosts 行（由 ipc 注入 hostkeys 信任库；直传防中间人）
  constructor({ getConn, storeFile, notify, knownHostsLine }) {
    this.getConn = getConn;
    this.storeFile = storeFile || null;
    this.notify = typeof notify === 'function' ? notify : null; // 任务完成/失败系统通知回调
    this.knownHostsLine = typeof knownHostsLine === 'function' ? knownHostsLine : null;
    this.maxConcurrent = DEFAULT_CONCURRENCY;
    this.options = { notifyDone: true, notifyFail: true, verify: false, limitBytes: 0 };
    this.tasks = new Map();
    this.queue = [];
    this.running = 0;
    this.listener = null;
    this.persistenceError = '';
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
    if (!this.options.limitBytes) this._bucket = { tokens: 0, last: Date.now() };
  }

  // 全局令牌桶限速：返回需要暂停的毫秒数（0 = 放行）
  _limitTake(n) {
    const limit = this.options.limitBytes || 0;
    if (!limit) return 0;
    const now = Date.now();
    const b = this._bucket || (this._bucket = { tokens: 0, last: now });
    b.tokens = Math.min(limit * 2, b.tokens + ((now - b.last) / 1000) * limit);
    b.last = now;
    if (b.tokens >= n) {
      b.tokens -= n;
      return 0;
    }
    return ((n - b.tokens) / limit) * 1000;
  }

  onUpdate(fn) {
    this.listener = fn;
  }

  pub(t) {
    let srcPath = '';
    let dstPath = '';
    if (t.kind === 'upload') {
      srcPath = t.srcLocal || t.srcPath || '';
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
      waitConflict: !!t._waitConflict,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      verification: t.verification || 'not-requested',
      resumable: canResume(t),
      persistenceError: this.persistenceError,
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
      if (!['done', 'canceled'].includes(t.status) || t.stagedUploads?.length || t.stagedDownloads?.length || t._cleaning) active.push(t);
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
    const previousError = this.persistenceError;
    try {
      this._prune();
      // recentFiles 仅用于实时展示，不落盘（避免大目录把 transfers.json 撑大）
      const data = [...this.tasks.values()].map((t) => {
        return serializeTask(t, this.pub(t));
      });
      const tmp = this.storeFile + '.tmp';
      await fsp.mkdir(path.dirname(this.storeFile), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fsp.rename(tmp, this.storeFile);
      this.persistenceError = '';
    } catch (error) {
      this.persistenceError = `Unable to save transfer recovery data: ${error.message}`;
    } finally {
      this._writing = false;
      if (this.listener && previousError !== this.persistenceError) {
        for (const task of this.tasks.values()) this.listener(this.pub(task));
      }
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
      const kinds = ['upload', 'download', 'relay'];
      for (const t of arr) {
        // 版本兼容/坏数据防护：缺关键字段的条目直接丢弃
        if (!t || !kinds.includes(t.kind) || typeof t.id !== 'string') continue;
        if (t.status === 'running' || t.status === 'queued') t.status = 'paused';
        if (!canResume(t) && !['done', 'canceled'].includes(t.status)) {
          t.status = 'error';
          t.error = 'This older task has no recovery inputs. Start a new transfer from the file manager.';
        }
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

  // 是否存在运行中/排队中的任务（关窗确认用）
  hasActive() {
    for (const t of this.tasks.values()) {
      if (t.status === 'running' || t.status === 'queued') return true;
    }
    return false;
  }

  _md5Local(p) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const rs = fs.createReadStream(p);
      rs.on('data', (d) => hash.update(d))
        .on('end', () => resolve(hash.digest('hex')))
        .on('error', reject);
    });
  }

  // Verify staging before replacing a completed destination. null means unavailable.
  async _verifyChecksum(t, stagedRemote, stagedLocal) {
    const remoteMd5 = async (conn, p) => {
      const r = await conn.exec(`md5sum ${shq(p)}`, 60000);
      const h = (r.stdout || '').trim().split(/\s+/)[0] || '';
      return /^[0-9a-f]{32}$/.test(h) ? h : null;
    };
    if (t.kind === 'upload') {
      const conn = await this._conn(t.serverId);
      const [local, remote] = await Promise.all([this._md5Local(t.srcLocal), remoteMd5(conn, stagedRemote || t.dstRemote)]);
      if (!local || !remote) return null;
      return local === remote;
    }
    if (t.kind === 'download') {
      const conn = await this._conn(t.serverId);
      const [local, remote] = await Promise.all([this._md5Local(stagedLocal || t.dstLocal), remoteMd5(conn, t.srcRemote)]);
      if (!local || !remote) return null;
      return local === remote;
    }
    return null;
  }

  async _checkStaged(t, gate, remotePath, localPath) {
    if (!this.options.verify) { t.verification = 'not-requested'; return; }
    const ok = await this._verifyChecksum(t, remotePath, localPath);
    assertActive(gate);
    t.verification = ok === null ? 'unavailable' : ok ? 'verified' : 'failed';
    if (ok === false) throw new Error('Transfer checksum mismatch. The completed destination was preserved.');
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
      ignoreExisting: !!job.ignoreExisting,
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

  // 任务的目标端唯一键：两个任务写同一目标会交错损坏数据（尤其断点续传的追加写）
  _targetKey(t) {
    const target = this._target(t);
    return `${target.endpoint}:${target.path}`;
  }

  _target(t) {
    if (t.kind === 'download') {
      const resolved = path.resolve(t.dstLocal || '.');
      return { endpoint: 'local', path: process.platform === 'win32' ? resolved.toLowerCase() : resolved, separator: path.sep };
    }
    return { endpoint: 'remote:' + (t.kind === 'relay' ? t.peerId : t.serverId),
      path: path.posix.normalize(t.dstRemote || '.').replace(/\/$/, '') || '/', separator: '/' };
  }

  _targetsConflict(a, b) {
    const first = this._target(a), second = this._target(b);
    if (first.endpoint !== second.endpoint) return false;
    const prefix = (target) => target.path.endsWith(target.separator) ? target.path : target.path + target.separator;
    return first.path === second.path || first.path.startsWith(prefix(second)) || second.path.startsWith(prefix(first));
  }

  _schedule() {
    const runningTasks = [];
    for (const t of this.tasks.values()) {
      if (t.status === 'running' || t._cleaning) runningTasks.push(t);
    }
    let deferred = 0; // 本轮被互斥推迟的任务数；等于队列长度时说明全冲突，避免空转
    while (this.running < this.maxConcurrent && this.queue.length && deferred < this.queue.length) {
      const id = this.queue.shift();
      const t = this.tasks.get(id);
      if (!t || t.status !== 'queued') continue;
      if (runningTasks.some((active) => this._targetsConflict(t, active))) {
        // 同目标互斥：推回队尾，等占用者结束后由其 finally 的 _schedule 再次调度
        this.queue.push(id);
        if (!t._waitConflict) {
          t._waitConflict = true;
          this.emit(t);
        }
        deferred += 1;
        continue;
      }
      runningTasks.push(t);
      this._launch(t);
    }
  }

  async _launch(t) {
    this.running++;
    t.status = 'running';
    t._waitConflict = false;
    t.error = '';
    t.speed = 0;
    t.startedAt = t.startedAt || Date.now();
    const gate = makeGate();
    t._gate = gate;
    this.emit(t);
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
      if (t._cleanupPromise) await t._cleanupPromise;
      assertActive(gate);
      if (t.kind === 'upload') await this._runUpload(t, gate, makeProgress());
      else if (t.kind === 'download') await this._runDownload(t, gate, makeProgress());
      else if (t.kind === 'relay') await this._runRelay(t, gate);
      else throw new Error('未知任务类型');
      t.speed = 0;
      t.transferred = t.size;
      t.finishedAt = Date.now();
      if (this.options.verify && (t._isTree || t.kind === 'relay')) t.verification = 'unavailable';
      assertActive(gate);
      t.status = 'done';
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
      t._restart = false;
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
    const errors = [];
    for (const local of t.stagedDownloads || []) {
      try { await fsp.unlink(local); }
      catch (error) { if (error.code !== 'ENOENT') errors.push(error.message); }
    }
    for (const remote of t.stagedUploads || []) {
      try {
        const sftp = await (await this._conn(t.kind === 'relay' ? t.peerId : t.serverId)).sftp();
        await withTimeout(new Promise((resolve, reject) => sftp.unlink(remote, (error) => error ? reject(error) : resolve())), 10000, 'Staging cleanup');
      } catch (error) { if (error.code !== 2 && error.code !== 'ENOENT') errors.push(error.message); }
    }
    if (errors.length) t.error = 'Could not remove all temporary transfer files: ' + errors[0];
    else { t.stagedUploads = []; t.stagedDownloads = []; }
    return errors.length === 0;
  }

  _stage(t, key, target) {
    if (!t[key]) t[key] = [];
    if (!t[key].includes(target)) t[key].push(target);
    this.saveSoon();
  }

  _unstage(t, key, target) { t[key] = (t[key] || []).filter((item) => item !== target); }

  async _conn(id) {
    const c = await this.getConn(id);
    if (!c) throw new Error('服务器连接不可用');
    return c;
  }

  // ---- 上传：本地 → 远程。文件直传；目录交给 _uploadTree 边遍历边传（不阻塞预扫描） ----
  async _runUpload(t, gate, onProgress) {
    const conn = await this._conn(t.serverId);
    const localStat = await fsp.lstat(t.srcLocal);
    if (localStat.isDirectory()) return this._uploadTree(t, gate);
    const sftp = await conn.sftp();
    t.size = localStat.size;
    await conn.mkdirpRemote(posixDir(t.dstRemote));
    const version = `${localStat.size}:${localStat.mtimeMs}`;
    if (t.sourceVersion && t.sourceVersion !== version) throw new Error('Source file changed since this transfer started. Start a new transfer.');
    t.sourceVersion = version;
    const staged = uploadPart(t.dstRemote, t.id);
    this._stage(t, 'stagedUploads', staged);
    const offset = t._restart ? 0 : await verifiedOffset(sftp, t.srcLocal, staged, t.size, true, gate);
    t._baseOffset = offset;
    t.transferred = offset;
    this.emit(t);
    await this._uploadOneFile(gate, sftp, t.srcLocal, staged, t.size, offset, (abs) =>
      onProgress(abs - offset, t.size),
    );
    const finalStat = await fsp.stat(t.srcLocal);
    if (`${finalStat.size}:${finalStat.mtimeMs}` !== version) throw new Error('Source file changed during upload. Destination was not replaced.');
    if ((await remoteStat(sftp, staged)).size !== t.size) throw new Error('Staged upload size mismatch');
    await this._checkStaged(t, gate, staged);
    assertActive(gate);
    await commitUpload(sftp, staged, t.dstRemote);
    this._unstage(t, 'stagedUploads', staged);
  }

  // 上传单个文件：0 字节直接建空文件（避免空流触发 SFTP Failure）；offset 由调用方算好传入
  async _uploadOneFile(gate, sftp, localAbs, remoteAbs, size, offset, onBytes) {
    assertActive(gate);
    if (size > 0 && offset === size) { if (onBytes) onBytes(size); return; }
    if (size === 0 && offset === 0) {
      await new Promise((res, rej) => sftp.writeFile(remoteAbs, Buffer.alloc(0), (e) => (e ? rej(e) : res())));
      if (onBytes) onBytes(0);
      return;
    }
    const local = fs.createReadStream(localAbs, { start: offset, highWaterMark: STREAM_CHUNK * 2 });
    const remote = sftp.createWriteStream(remoteAbs, {
      start: offset,
      flags: offset ? 'a' : 'w',
      chunkSize: STREAM_CHUNK,
    });
    const bytes = await pump(local, remote, (d) => onBytes && onBytes(offset + d), gate, (n) => this._limitTake(n));
    if (bytes !== size - offset) throw new Error('Source upload length changed');
  }

  // 目录上传：本地 readdir 渐进展开 + 有界文件并发，总量/文件数随遍历回填
  async _uploadTree(t, gate) {
    t._isTree = true;
    const conn = await this._conn(t.serverId);
    const sftp = await conn.sftp();
    const srcRoot = t.srcLocal;
    await this._runTree(
      t,
      gate,
      [{ key: srcRoot, isDir: true, size: 0, abs: srcRoot, remote: t.dstRemote }],
      // 展开一个目录：建远程目录 + 列本地子项（符号链接按指向处理，悬空跳过）
      async (j) => {
        await conn.mkdirpRemote(j.remote);
        const names = await fsp.readdir(j.abs, { withFileTypes: true });
        const children = [];
        for (const d of names) {
          const abs = path.join(j.abs, d.name);
          const remote = posixJoin(j.remote, d.name);
          let isDir = false;
          let size = 0;
          try {
            if (d.isSymbolicLink()) {
              const s2 = await fsp.stat(abs);
              isDir = s2.isDirectory();
              size = s2.size;
            } else if (d.isDirectory()) {
              isDir = true;
            } else {
              size = (await fsp.lstat(abs)).size;
            }
          } catch {
            continue; // 无权限/悬空链接：不进入任务队列
          }
          children.push({ key: abs, isDir, size, abs, remote });
        }
        return children;
      },
      // 传输一个文件：逐文件断点续传（远程已有部分则追加）
      async (j, report) => {
        const before = await fsp.stat(j.abs);
        if (before.size !== j.size) throw new Error('Source file changed since directory listing');
        const staged = uploadPart(j.remote, t.id);
        this._stage(t, 'stagedUploads', staged);
        const offset = t._restart ? 0 : await verifiedOffset(sftp, j.abs, staged, j.size, true, gate);
        await this._uploadOneFile(gate, sftp, j.abs, staged, j.size, offset, report);
        const after = await fsp.stat(j.abs);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source file changed during directory upload');
        if ((await remoteStat(sftp, staged)).size !== j.size) throw new Error('Staged upload size mismatch');
        assertActive(gate);
        await commitUpload(sftp, staged, j.remote);
        this._unstage(t, 'stagedUploads', staged);
      },
      (j) => j.abs.slice(srcRoot.length).split(path.sep).join('/').replace(/^\/+/, ''),
    );
  }

  // ---- 下载：远程 → 本地（.scpart → 完成改名）。文件直传；目录交给 _downloadTree ----
  async _runDownload(t, gate, onProgress) {
    const conn = await this._conn(t.serverId);
    const rstat = await conn.statRemote(t.srcRemote);
    if (rstat.type === 'dir') return this._downloadTree(t, gate);
    const sftp = await conn.sftp();
    t.size = rstat.size;
    const version = `${rstat.size}:${rstat.mtime}`;
    if (t.sourceVersion && t.sourceVersion !== version) throw new Error('Source file changed since this transfer started. Start a new transfer.');
    t.sourceVersion = version;
    await fsp.mkdir(path.dirname(t.dstLocal), { recursive: true });
    const part = uploadPart(t.dstLocal, t.id);
    this._stage(t, 'stagedDownloads', part);
    const before = await remoteStat(sftp, t.srcRemote);
    if (`${before.size}:${before.mtime * 1000}` !== version) throw new Error('Source file changed before download');
    const offset = t._restart ? 0 : await verifiedOffset(sftp, part, t.srcRemote, t.size, false, gate);
    t._baseOffset = offset;
    t.transferred = offset;
    this.emit(t);
    await this._downloadOneFile(gate, sftp, t.srcRemote, t.dstLocal, t.size, offset, (abs) =>
      onProgress(abs - offset, t.size), before, () => this._checkStaged(t, gate, undefined, part), part);
    this._unstage(t, 'stagedDownloads', part);
  }

  // 下载单个文件：写 .scpart，完成后原子改名；offset 由调用方算好传入
  async _downloadOneFile(gate, sftp, remoteAbs, localAbs, size, offset, onBytes, before, verify, stagedPath) {
    assertActive(gate);
    before = before || await remoteStat(sftp, remoteAbs);
    if (before.size !== size) throw new Error('Source file changed before download');
    const part = stagedPath || localAbs + PART_SUFFIX;
    if (size === 0 && offset === 0) {
      await fsp.writeFile(part, Buffer.alloc(0));
      if (onBytes) onBytes(0);
    } else if (offset < size) {
      const remote = sftp.createReadStream(remoteAbs, { start: offset, chunkSize: STREAM_CHUNK });
      const local = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
      const bytes = await pump(remote, local, (d) => onBytes && onBytes(offset + d), gate, (n) => this._limitTake(n));
      if (bytes !== size - offset) throw new Error('Source download length changed. Destination was preserved.');
    } else if (onBytes) onBytes(size);
    const after = await remoteStat(sftp, remoteAbs);
    if (before.size !== after.size || before.mtime !== after.mtime || (await fsp.stat(part)).size !== size) {
      throw new Error('Source file changed during download. Destination was preserved.');
    }
    if (verify) await verify();
    assertActive(gate);
    await fsp.rename(part, localAbs);
  }

  // 目录下载：listDir 渐进展开（含 linkToDir 解析，不再把指向目录的符号链接当小文件）+ 有界文件并发
  async _downloadTree(t, gate) {
    t._isTree = true;
    const conn = await this._conn(t.serverId);
    const sftp = await conn.sftp();
    const srcRoot = t.srcRemote;
    await this._runTree(
      t,
      gate,
      [{ key: srcRoot, isDir: true, size: 0, remote: srcRoot, local: t.dstLocal }],
      // 展开一个远程目录：建本地目录 + 列远程子项（readdir 自带属性，无额外往返）
      async (j) => {
        await fsp.mkdir(j.local, { recursive: true });
        const listing = await withTimeout(conn.listDir(j.remote), DIR_LIST_TIMEOUT, '列举目录 ' + j.remote);
        return listing.entries.map((e) => ({
          key: posixJoin(j.remote, e.name),
          isDir: e.type === 'dir' || !!e.linkToDir,
          size: e.size || 0,
          remote: posixJoin(j.remote, e.name),
          local: path.join(j.local, e.name),
        }));
      },
      // 传输一个文件：逐文件 .scpart 断点续传
      async (j, report) => {
        const before = await remoteStat(sftp, j.remote);
        if (before.size !== j.size) throw new Error('Source file changed since directory listing');
        const part = uploadPart(j.local, t.id);
        this._stage(t, 'stagedDownloads', part);
        const offset = t._restart ? 0 : await verifiedOffset(sftp, part, j.remote, j.size, false, gate);
        await this._downloadOneFile(gate, sftp, j.remote, j.local, j.size, offset, report, before, undefined, part);
        this._unstage(t, 'stagedDownloads', part);
      },
      (j) => j.remote.slice(srcRoot.length).replace(/^\/+/, ''),
    );
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
    // tag 格式：sckey- + 8 位随机 base36（GC 端用 / sckey-[a-z0-9]{8}$/ 精确匹配，
    // 避免误删 authorized_keys 中碰巧以 sc 开头 8 位的用户自有密钥注释）
    const tag = 'sckey-' + Math.random().toString(36).slice(2, 10);
    const dir = '/tmp/.' + tag;
    const key = dir + '/k';
    const script = dir + '/run.sh';
    const rcfile = dir + '/rc';
    const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    const wf = (s, p, b) => new Promise((res, rej) => s.writeFile(p, b, (e) => (e ? rej(e) : res())));

    const sa = await connA.sftp();
    const top = await connA.statRemote(t.srcRemote);
    const isDir = top.type === 'dir';

    // 0) 目标机指纹：必须已经通过本机连接并记录在信任库，写进源机临时 known_hosts（随临时目录即焚）。
    //    取不到说明目标机从未成功连接过 —— 放弃直传，回退本机中继。
    const khLine = this.knownHostsLine ? this.knownHostsLine(host, port) : null;
    if (!khLine) throw new Error('无法获取目标主机指纹（目标机尚未连接过）');
    const khfile = dir + '/known_hosts';
    await connA.exec(`mkdir -p ${dir} && chmod 700 ${dir}`); // 目录先建好，known_hosts 才有落点
    await wf(sa, khfile, Buffer.from(khLine + '\n'));

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
      const sshOpt = `-i ${key} -p ${port} -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${khfile} -o BatchMode=yes -o ConnectTimeout=8`;
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
      // Safe direct path requires rsync on both ends; otherwise use staged SFTP relay.
      const dst = user + '@' + host;
      const cap = await connA.exec(
        `s(){ command -v $1 >/dev/null 2>&1 && echo y || echo n; }; echo "src rsync=$(s rsync) tar=$(s tar) scp=$(s scp)"; ` +
          `timeout 12 ssh ${sshOpt} ${q(dst)} 'r(){ command -v $1 >/dev/null 2>&1 && echo y || echo n; }; echo "dst rsync=$(r rsync) tar=$(r tar) scp=$(r scp)"'`,
        20000,
      );
      const capText = (cap.stdout || '').replace(/\s+/g, ' ').trim();
      const has = (side, tool) => new RegExp(side + ' .*?' + tool + '=y').test(capText);
      const useRsync = has('src', 'rsync') && has('dst', 'rsync');
      if (!useRsync) throw new Error('Safe direct transfer requires rsync on both servers; using local SFTP relay');
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
        // 同步模式（ignoreExisting）仅 rsync 支持
        const flags = '-aW --numeric-ids' + (t.ignoreExisting ? ' --ignore-existing' : '');
        modeLines +=
          `if rsync ${flags} --out-format='@@%n' -e ${q(sshVar)} -- ${rsyncSrc} ${rsyncDst} 2>>${logf}; then echo rsync >${modefile}; echo 0 >${rcfile}; exit 0; ` +
          `else echo "rsync:$(tail -c 180 ${logf}|tr '\\n' ' ')" >>${notefile}; fi\n`;
      }
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
      // 进度：每秒在目标端统计已落盘字节；首次采样作为基线扣除（目标目录已有旧数据时进度不虚高）
      let lastBytes = 0;
      let lastTime = Date.now();
      let baseline = null;
      const timer = setInterval(async () => {
        try {
          const cmd = isDir ? `du -sb ${q(t.dstRemote)} 2>/dev/null | cut -f1` : `stat -c %s ${q(t.dstRemote)} 2>/dev/null`;
          const n = parseInt((await connB.exec(cmd, 8000)).stdout) || 0;
          if (baseline === null) baseline = n;
          const effective = Math.max(0, n - baseline);
          const now = Date.now();
          const dt = (now - lastTime) / 1000;
          if (dt > 0) t.speed = Math.max(0, (effective - lastBytes) / dt);
          lastBytes = effective;
          lastTime = now;
          t.transferred = t.size ? Math.min(effective, t.size) : effective;
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
    const version = `${top.size}:${top.mtime}`;
    if (t.sourceVersion && t.sourceVersion !== version) throw new Error('Relay source changed since this transfer started');
    t.sourceVersion = version;
    await this._relayOneFile(t, gate, sa, sb, t.srcRemote, t.dstRemote, top.size, (d) => {
      t.transferred = d;
      this.emit(t);
    });
    t.transferred = t.size;
    t.filesDone = 1;
    this._pushRecent(t, t.name);
  }

  // 单个文件中继（断点续传；0 字节直接建空文件，避免空流触发 SFTP Failure）
  async _relayOneFile(t, gate, sa, sb, srcAbs, dstAbs, size, onBytes) {
    assertActive(gate);
    const before = await remoteStat(sa, srcAbs);
    if (before.size !== size) throw new Error('Relay source changed before transfer');
    const staged = uploadPart(dstAbs, t.id);
    this._stage(t, 'stagedUploads', staged);
    const offset = t._restart ? 0 : await verifiedRemoteOffset(sa, sb, srcAbs, staged, size, gate);
    assertActive(gate);
    if (size === 0 && offset === 0) {
      await new Promise((res, rej) => sb.writeFile(staged, Buffer.alloc(0), (e) => (e ? rej(e) : res())));
      onBytes && onBytes(0);
    } else if (offset < size) {
      const bytes = await pump(
        sa.createReadStream(srcAbs, { start: offset, chunkSize: STREAM_CHUNK }),
        sb.createWriteStream(staged, { start: offset, flags: offset ? 'a' : 'w', chunkSize: STREAM_CHUNK }),
        (d) => onBytes && onBytes(offset + d), gate, (n) => this._limitTake(n),
      );
      if (bytes !== size - offset) throw new Error('Relay source length changed');
    } else if (onBytes) onBytes(size);
    const after = await remoteStat(sa, srcAbs);
    if (after.size !== before.size || after.mtime !== before.mtime || (await remoteStat(sb, staged)).size !== size) {
      throw new Error('Relay source changed. Destination was preserved.');
    }
    assertActive(gate);
    await commitUpload(sb, staged, dstAbs);
    this._unstage(t, 'stagedUploads', staged);
  }

  // 目录任务的通用骨架：BFS 边遍历边传 + 有界文件并发 + 节流进度/速度 + 单文件错误汇总。
  // expand(j) 展开一个目录项为子项数组（含建目标目录）；transferFile(j, report) 传输单个文件，
  // report(absInFile) 上报文件内绝对字节位置；relName(j) 生成最近文件流里的相对路径展示。
  async _runTree(t, gate, jobs, expand, transferFile, relName) {
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
    let errorsDropped = 0; // 超出封顶后只计数，防止极端目录（如整树无权限）把内存撑爆
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
        const children = await expand(j);
        for (const c of children) {
          if (!c.isDir) {
            totalBytes += c.size || 0;
            filesTotal += 1;
          }
          jobs.push(c);
        }
        emit(false);
      } else {
        inflight.set(j.key, 0);
        let succeeded = false;
        try {
          await transferFile(j, (absInFile) => {
            inflight.set(j.key, absInFile);
            emit(false);
          });
          succeeded = true;
        } catch (e) {
          if (e && e.aborted) throw e;
          if (errors.length < 100) errors.push(`${j.key}: ${e && e.message ? e.message : e}`);
          else errorsDropped += 1;
        } finally {
          inflight.delete(j.key);
          if (succeeded) {
            doneFilesBytes += j.size || 0;
            filesDone += 1;
            this._pushRecent(t, relName(j) || j.key);
          }
          emit(false);
        }
      }
    };
    await new Promise((resolve, reject) => {
      let stop = false;
      let failure;
      const schedule = () => {
        if (stop) { if (running === 0) reject(failure); return; }
        while (!stop && running < RELAY_FILE_CONCURRENCY && jobs.length) {
          const j = jobs.shift();
          running += 1;
          handle(j).then(
            () => {
              running -= 1;
              schedule();
            },
            (err) => {
              running -= 1;
              stop = true;
              failure = failure || err;
              gate.abort();
              schedule();
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
    if (errors.length) {
      const total = errors.length + errorsDropped;
      throw new Error(`目录内 ${total} 项失败${errorsDropped ? `（仅列出前 ${errors.length} 项）` : ''}，首个：${errors[0]}`);
    }
  }

  // 目录中继：走通用树引擎；readdir 自带文件属性（不再每文件多一次往返）、单目录列举超时
  async _relayTree(t, gate, connA, connB, sa, sb, srcRoot, dstRoot) {
    await this._runTree(
      t,
      gate,
      [{ key: srcRoot, isDir: true, size: 0, src: srcRoot, dst: dstRoot }],
      async (j) => {
        await connB.mkdirpRemote(j.dst);
        const listing = await withTimeout(connA.listDir(j.src), DIR_LIST_TIMEOUT, '列举目录 ' + j.src);
        return listing.entries.map((e) => ({
          key: posixJoin(j.src, e.name),
          isDir: e.type === 'dir' || !!e.linkToDir,
          size: e.size || 0,
          src: posixJoin(j.src, e.name),
          dst: posixJoin(j.dst, e.name),
        }));
      },
      async (j, report) => {
        await this._relayOneFile(t, gate, sa, sb, j.src, j.dst, j.size, report);
      },
      (j) => (j.src.startsWith(srcRoot) ? j.src.slice(srcRoot.length).replace(/^\/+/, '') : j.src),
    );
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
    if (['queued', 'paused', 'error'].includes(t.status)) {
      this.queue = this.queue.filter((x) => x !== id);
      t.status = 'canceled';
      t._cleanupPromise = this._cleanup(t).then(() => this.emit(t));
      this.emit(t);
      return true;
    }
    if (t.status === 'running' && t._gate) {
      t._gate.abort();
    }
    return true;
  }

  // 续传/重试：reset=true 则从头来（不做远程删除——offset=0 时 'w' flag 会整文件覆盖，
  // 先删后传反而会在重传失败时丢掉目标端已有文件）
  resume(id, reset = false) {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (!canResume(t)) return false;
    if (t._cleaning) return false;
    if (t.status === 'running') return true;
    if (reset) {
      t.transferred = 0;
      t._baseOffset = 0;
      t._restart = true;
      t.sourceVersion = undefined;
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

  async remove(id) {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (t.status === 'running' || t._cleaning) return false;
    t._cleaning = true;
    try {
      if (t._cleanupPromise) await t._cleanupPromise;
      if (!await this._cleanup(t)) { this.emit(t); return false; }
      this.tasks.delete(id);
      this.queue = this.queue.filter((x) => x !== id);
      this.saveSoon();
      return true;
    } finally { t._cleaning = false; this._schedule(); }
  }

  async clearFinished() {
    let success = true;
    for (const [id, t] of [...this.tasks]) {
      if (['done', 'canceled'].includes(t.status) && !await this.remove(id)) success = false;
    }
    return success;
  }
}

function posixDir(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '.';
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

module.exports = { TransferManager, MAX_CONCURRENT_TASKS };
