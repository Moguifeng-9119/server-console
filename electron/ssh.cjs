const { Client } = require('ssh2');
const fs = require('node:fs');

// 一次 exec 取回 GPU / 进程 / 负载 / 内存，尽量少打扰服务器
const COLLECT_CMD = [
  'nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits 2>/dev/null',
  'echo __APPS__',
  'nvidia-smi --query-compute-apps=gpu_uuid,pid,used_memory --format=csv,noheader,nounits 2>/dev/null',
  'echo __SYS__',
  'cat /proc/loadavg; nproc; free -b',
  'echo __PS__',
  'ps -eo pid,user,pcpu,pmem,rss,stat,etime,args --no-headers',
].join('; ');

function num(v, fallback = 0) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

// 传感器读数：[N/A]、空、非数字一律视为“无读数”(null)，绝不伪造为 0
function numOrNull(v) {
  const s = String(v).trim();
  if (s === '' || /n\/a|not\s*support|unsupported/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const roundOrNull = (v) => {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
};

// ===== SFTP 辅助（远程均为 POSIX 路径） =====
function posixJoin(dir, name) {
  if (!dir || dir === '.') return name;
  return dir.replace(/\/$/, '') + '/' + name;
}
function sftpType(mode) {
  const t = mode & 0o170000;
  if (t === 0o040000) return 'dir';
  if (t === 0o120000) return 'link';
  return 'file';
}
function rightsOf(mode) {
  const s = ['r', 'w', 'x'];
  let out = '';
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out += mode & (0o400 >> (i * 3 + j)) ? s[j] : '-';
  return out;
}

function section(out, marker, next) {
  const start = out.indexOf(marker);
  if (start < 0) return '';
  const from = start + marker.length;
  const end = next ? out.indexOf(next, from) : out.length;
  return out.slice(from, end < 0 ? out.length : end);
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function parseSnapshot(out) {
  const gpuRaw = section(out, '', '__APPS__').trim();
  const appRaw = section(out, '__APPS__', '__SYS__').trim();
  const sysRaw = section(out, '__SYS__', '__PS__').trim();
  const psRaw = section(out, '__PS__').trim();

  // GPU：index,uuid,name,util,memUsed,memTotal,temp,power,fan
  const gpus = [];
  const uuidToIndex = new Map();
  for (const line of gpuRaw ? gpuRaw.split('\n') : []) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length < 6) continue;
    const index = num(f[0]);
    uuidToIndex.set(f[1], index);
    gpus.push({
      index,
      name: f[2] || 'GPU',
      util: Math.round(num(f[3])),
      memUsed: Math.round(num(f[4])),
      memTotal: Math.round(num(f[5])),
      temp: roundOrNull(f[6]),
      power: roundOrNull(f[7]),
      fan: roundOrNull(f[8]),
      procs: [],
    });
  }

  // 进程 → 显卡映射
  const pidToGpu = new Map();
  for (const line of appRaw ? appRaw.split('\n') : []) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length < 3) continue;
    const idx = uuidToIndex.get(f[0]);
    if (idx === undefined) continue;
    pidToGpu.set(num(f[1]), { index: idx, memMb: num(f[2]) });
  }
  for (const [pid, info] of pidToGpu) {
    const g = gpus.find((x) => x.index === info.index);
    if (g) g.procs.push({ pid, name: '', memMb: info.memMb });
  }

  // 系统：loadavg / nproc / free -b
  const sysLines = sysRaw.split('\n').map((l) => l.trim());
  const load = (sysLines[0] || '0 0 0').split(/\s+/).slice(0, 3).map((x) => num(x));
  const cpuCores = num(sysLines[1], 1);
  const memLine = (sysLines.find((l) => l.startsWith('Mem:')) || '').split(/\s+/);
  const swapLine = (sysLines.find((l) => l.startsWith('Swap:')) || '').split(/\s+/);
  const toGb = (v) => Math.round((num(v) / 1024 ** 3) * 10) / 10;

  // 进程表：pid user pcpu pmem rss stat etime args...
  const processes = [];
  for (const line of psRaw ? psRaw.split('\n') : []) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = num(m[1]);
    processes.push({
      pid,
      user: m[2],
      cpu: num(m[3]),
      mem: num(m[4]),
      rssMb: Math.round(num(m[5]) / 1024),
      state: m[6].charAt(0),
      started: m[7],
      command: m[8],
      gpu: pidToGpu.has(pid) ? pidToGpu.get(pid).index : null,
    });
  }

  // 补全 GPU 上进程的名字
  for (const g of gpus) {
    g.procs = g.procs.map((p) => {
      const hit = processes.find((x) => x.pid === p.pid);
      return { ...p, name: hit ? hit.command.split(/\s+/)[0].split('/').pop() : 'unknown' };
    });
  }

  return {
    gpus,
    processes,
    cpuCores,
    loadAvg: [load[0] || 0, load[1] || 0, load[2] || 0],
    cpuUsage: Math.min(100, Math.round(((load[0] || 0) / cpuCores) * 100)),
    memUsed: toGb(memLine[2]),
    memTotal: toGb(memLine[1]),
    swapUsed: toGb(swapLine[2]),
    swapTotal: toGb(swapLine[1]) || 0,
  };
}

class Connection {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = null;
    this.pending = null;
    this.status = 'offline';
    this.error = '';
    this._hostKeyError = '';
    this._fails = 0; // 连续失败次数（指数退避）
    this._nextRetryAt = 0;
    this._gcDone = false;
  }

  // 退避窗口内跳过重连尝试，避免对宕机服务器每个采集周期都发起 10s 超时的连接
  isBackedOff() {
    return Date.now() < this._nextRetryAt;
  }

  authConfig() {
    return authOpts(this.cfg);
  }

  connect() {
    if (this.client) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        /** @type {Record<string, any>} */
        const connectOpts = { host: this.cfg.host, port: this.cfg.port || 22, ...this.authConfig() };
        if (hostKeyCheck) {
          // TOFU 指纹校验：注入的 checker 返回 true 放行，抛错则记下原因并让握手失败
          connectOpts.hostVerifier = (hkey, cb) => {
            Promise.resolve()
              .then(() => hostKeyCheck(this.cfg.host, this.cfg.port || 22, hkey))
              .then((ok) => {
                if (!ok) this._hostKeyError = this._hostKeyError || '主机指纹校验未通过';
                cb(ok !== false);
              })
              .catch((e) => {
                this._hostKeyError = (e && e.message) || '主机指纹校验失败';
                cb(false);
              });
          };
        }
        // ProxyJump：先建立跳板机连接，再把目标连接隧道进其通道（forwardOut）
        if (this.cfg.proxyJump && jumpResolver) {
          const jump = await Promise.resolve()
            .then(() => jumpResolver(this.cfg))
            .catch((e) => {
              throw new Error(`跳板机解析失败：${e.message}`);
            });
          if (jump) {
            const jc = new Client();
            this._jumpClient = jc;
            jc.on('close', () => {
              // 跳板断开时一并断开目标，避免半挂连接
              try {
                if (this.client) this.client.end();
              } catch {
                /* noop */
              }
            });
            await new Promise((res, rej) => {
              jc.once('ready', res);
              jc.once('error', (e) => rej(new Error(`跳板机连接失败：${e.message}`)));
              jc.connect({ host: jump.host, port: jump.port || 22, ...authOpts(jump) });
            });
            connectOpts.sock = await new Promise((res, rej) =>
              jc.forwardOut('127.0.0.1', 0, this.cfg.host, this.cfg.port || 22, (e, s) => (e ? rej(e) : res(s))),
            );
          }
        }
        await new Promise((resolve, reject) => {
          const client = new Client();
          client
            .on('ready', () => {
              this.status = 'online';
              this.error = '';
              this._fails = 0;
              this._nextRetryAt = 0;
              this.pending = null;
              resolve();
              this._scheduleGc();
            })
            .on('error', (err) => {
              // 指纹校验的拒绝原因比 ssh2 的通用报错更有用，替换之
              if (this._hostKeyError) {
                err.message = this._hostKeyError;
                this._hostKeyError = '';
              }
              this.status = /authentic/i.test(err.message) ? 'auth' : 'offline';
              this.error = err.message;
              this._fails += 1;
              this._nextRetryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this._fails, 5));
              reject(err);
            })
            .on('close', () => {
              this.status = 'offline';
              this.pending = null;
              this.dispose();
            });
          // keyboard-interactive（2FA/MFA）：有注入的交互通道就走渲染层弹框；否则回退用配置密码作答
          client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
            const qs = prompts.map((p) => p.prompt || '');
            Promise.resolve()
              .then(() => (interactiveHandler ? interactiveHandler({ name: _name, prompts: qs }) : null))
              .then((answers) => finish(Array.isArray(answers) && answers.length === qs.length ? answers : qs.map(() => this.cfg.password || '')))
              .catch(() => finish(qs.map(() => this.cfg.password || '')));
          });
          client.connect(connectOpts);
          this.client = client;
        });
      } catch (e) {
        this.pending = null;
        this.dispose();
        throw e;
      }
    })();
    return this.pending;
  }

  dispose() {
    if (this._sftp) {
      try {
        this._sftp.end();
      } catch {
        /* noop */
      }
      this._sftp = null;
    }
    if (this._jumpClient) {
      try {
        this._jumpClient.end();
      } catch {
        /* noop */
      }
      this._jumpClient = null;
    }
    if (this.client) {
      try {
        this.client.end();
      } catch {
        /* noop */
      }
      this.client = null;
    }
    this._gcDone = false;
  }

  // 异步机会性 GC：清理由于客户端非正常退出（掉电/杀进程）残留的历史一次性临时直传密钥与临时目录
  // 匹配两种格式：新版 sckey-xxxxxxxx（v0.10.1+）与旧版 scxxxxxxxx（v0.9.x 遗留）
  // 均要求行尾精确匹配，不会影响用户自有密钥的常规注释（如邮箱、主机名）
  _scheduleGc() {
    if (this._gcDone) return;
    this._gcDone = true;
    setTimeout(() => {
      if (this.status !== 'online') return;
      this.exec(
        'if [ -f ~/.ssh/authorized_keys ]; then sed -i -E "/ sckey-[a-z0-9]{8}$/d; / sc[a-z0-9]{8}$/d" ~/.ssh/authorized_keys; fi; rm -rf /tmp/.sckey-* /tmp/.sc[a-z0-9]* 2>/dev/null',
        8000,
      ).catch(() => {});
    }, 5000);
  }

  close() {
    this.dispose();
    this.status = 'offline';
  }

  exec(cmd, timeout = 15000) {
    return this.connect().then(
      () =>
        new Promise((resolve, reject) => {
          this.client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let out = '';
            let errOut = '';
            const timer = setTimeout(() => {
              try {
                stream.close();
              } catch {
                /* noop */
              }
              reject(new Error('命令执行超时'));
            }, timeout);
            stream
              .on('close', () => {
                clearTimeout(timer);
                resolve({ stdout: out, stderr: errOut });
              })
              .on('data', (d) => (out += d.toString()))
              .stderr.on('data', (d) => (errOut += d.toString()));
          });
        }),
    );
  }

  // 流式执行：过程中按行回调 stdout（用于实时解析 rsync 逐文件输出），结束时汇总
  /**
   * @param {string} cmd
   * @param {{ onLine?: (line: string) => void; onStream?: (stream: unknown) => void; timeout?: number }=} opts
   */
  execStream(cmd, { onLine, onStream, timeout = 0 } = {}) {
    return this.connect().then(
      () =>
        new Promise((resolve, reject) => {
          this.client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            if (onStream) {
              try {
                onStream(stream);
              } catch {
                /* noop */
              }
            }
            // 百万文件的 rsync 逐文件输出可能极大；stdout/stderr 只保留尾部用于诊断
            const OUT_CAP = 256 * 1024;
            let out = '';
            let errOut = '';
            let buf = '';
            const timer = timeout
              ? setTimeout(() => {
                  try {
                    stream.close();
                  } catch {
                    /* noop */
                  }
                  reject(new Error('命令执行超时'));
                }, timeout)
              : null;
            const feed = (chunk) => {
              const s = chunk.toString();
              out += s;
              if (out.length > OUT_CAP * 2) out = out.slice(-OUT_CAP);
              if (!onLine) return;
              buf += s;
              let idx;
              while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                onLine(line);
              }
            };
            stream
              .on('close', (code) => {
                if (timer) clearTimeout(timer);
                if (buf.trim() && onLine) onLine(buf.replace(/\r$/, ''));
                resolve({ stdout: out, stderr: errOut.slice(-OUT_CAP), code });
              })
              .on('data', (d) => feed(d))
              .stderr.on('data', (d) => (errOut += d.toString()));
          });
        }),
    );
  }

  async collect() {
    const { stdout } = await this.exec(COLLECT_CMD);
    const snap = parseSnapshot(stdout);
    if (!snap.gpus.length) {
      // 没有 nvidia-smi 或驱动异常时，不要当成整体失败
      snap.gpuError = /nvidia-smi/i.test(stdout) ? '未获取到 GPU 数据（驱动异常或无 NVIDIA 显卡）' : undefined;
    }
    return snap;
  }

  async kill(pid, signal) {
    const flag = signal === 'KILL' ? '-9' : '-15';
    const { stdout, stderr } = await this.exec(`kill ${flag} ${Number(pid)}`, 8000);
    if (stderr && /no such process/i.test(stderr)) return { ok: false, error: '进程不存在' };
    if (stderr && /not permitted|permission denied/i.test(stderr))
      return { ok: false, error: '权限不足（需要该进程属主或 root）' };
    return { ok: true, stdout };
  }

  async restartService(name) {
    const { stdout, stderr } = await this.exec(`systemctl restart ${shq(name)}`, 20000);
    if (stderr && /access denied|not permitted/i.test(stderr)) return { ok: false, error: '权限不足' };
    return { ok: true, stdout: stdout || stderr };
  }

  // ===== SFTP 文件管理 =====
  sftp() {
    if (this._sftp) return Promise.resolve(this._sftp);
    return this.connect().then(
      () =>
        new Promise((resolve, reject) => {
          this.client.sftp((err, sftp) => {
            if (err) return reject(err);
            this._sftp = sftp;
            sftp.on('close', () => {
              if (this._sftp === sftp) this._sftp = null;
            });
            resolve(sftp);
          });
        }),
    );
  }

  async homePath() {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.realpath('.', (e, p) => (e ? reject(e) : resolve(p)));
    });
  }

  async listDir(dirPath) {
    const sftp = await this.sftp();
    const target = dirPath || '.';
    const items = await new Promise((resolve, reject) => {
      sftp.readdir(target, (e, list) => (e ? reject(e) : resolve(list || [])));
    });
    const entries = items.map((f) => {
      const mode = f.attrs.mode || 0o100644;
      return {
        name: f.filename,
        type: sftpType(mode),
        size: f.attrs.size || 0,
        mtime: (f.attrs.mtime || 0) * 1000,
        mode,
        rights: rightsOf(mode & 0o777),
        longname: f.longname || '',
        linkToDir: false,
      };
    });
    // 符号链接：解析其指向，指向目录则允许进入（有界并发，避免上千链接逐个串行往返）
    const links = entries.filter((e) => e.type === 'link');
    let linkIdx = 0;
    const resolveLink = async (e) => {
      try {
        const st = await new Promise((res, rej) =>
          sftp.stat(posixJoin(target, e.name), (er, r) => (er ? rej(er) : res(r))),
        );
        e.linkToDir = sftpType(st.mode) === 'dir';
      } catch {
        /* 悬空链接保持 link */
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(8, links.length) }, async () => {
        while (linkIdx < links.length) {
          const e = links[linkIdx++];
          await resolveLink(e);
        }
      }),
    );
    entries.sort((a, b) => {
      const ad = a.type === 'dir' || a.linkToDir;
      const bd = b.type === 'dir' || b.linkToDir;
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
    });
    let abs = target;
    try {
      abs = await new Promise((res, rej) => {
        sftp.realpath(target, (e, p) => (e ? rej(e) : res(p)));
      });
    } catch {
      /* 保留原值 */
    }
    return { path: abs, entries };
  }

  async statRemote(p) {
    const sftp = await this.sftp();
    const st = await new Promise((res, rej) => {
      sftp.stat(p, (e, r) => (e ? rej(e) : res(r)));
    });
    return { size: st.size, mode: st.mode, mtime: (st.mtime || 0) * 1000, type: sftpType(st.mode) };
  }

  async mkdirpRemote(p) {
    const sftp = await this.sftp();
    const isAbs = p.startsWith('/');
    const parts = p.split('/').filter(Boolean);
    let cur = isAbs ? '' : '.';
    for (const seg of parts) {
      cur = cur ? posixJoin(cur, seg) : isAbs ? '/' + seg : seg;
      await new Promise((resolve) => sftp.mkdir(cur, () => resolve())); // 已存在则忽略错误
    }
    return cur;
  }

  async renameRemote(from, to) {
    const sftp = await this.sftp();
    await new Promise((res, rej) => {
      sftp.rename(from, to, (e) => (e ? rej(e) : res()));
    });
    return true;
  }

  async removeRemote(target) {
    const sftp = await this.sftp();
    const lstat = (p) =>
      new Promise((res, rej) => {
        sftp.lstat(p, (e, r) => (e ? rej(e) : res(r)));
      });
    const rm = async (p) => {
      const st = await lstat(p);
      if (sftpType(st.mode) === 'dir') {
        const items = await new Promise((res, rej) => {
          sftp.readdir(p, (e, r) => (e ? rej(e) : res(r)));
        });
        for (const it of items) await rm(posixJoin(p, it.filename));
        await new Promise((res, rej) => {
          sftp.rmdir(p, (e) => (e ? rej(e) : res()));
        });
      } else {
        await new Promise((res, rej) => {
          sftp.unlink(p, (e) => (e ? rej(e) : res()));
        });
      }
    };
    await rm(target);
    return true;
  }
}

// 主机指纹校验器由主进程注入（依赖 electron 的 hostkeys 信任库），ssh.cjs 自身保持纯净可测试
let hostKeyCheck = null;
function setHostKeyChecker(fn) {
  hostKeyCheck = typeof fn === 'function' ? fn : null;
}

// 交互式认证（2FA/MFA 键盘提示）与跳板机凭据解析均由主进程注入
let interactiveHandler = null; // ({name, prompts}) => Promise<string[]>
function setInteractiveHandler(fn) {
  interactiveHandler = typeof fn === 'function' ? fn : null;
}
let jumpResolver = null; // (cfg) => {host,port,username,authType,password,keyPath,passphrase,agentPath} | null
function setJumpResolver(fn) {
  jumpResolver = typeof fn === 'function' ? fn : null;
}

// 由配置构造 ssh2 认证参数（目标连接与跳板机共用）
function authOpts(cfg) {
  const base = { username: cfg.username, readyTimeout: 10000, keepaliveInterval: 15000, tryKeyboard: true };
  if (cfg.compress) base.compress = true; // 慢链路可选：SSH 通道压缩
  if (cfg.authType === 'agent') {
    const agent =
      cfg.agentPath || process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
    if (!agent) throw new Error('未找到系统 ssh-agent（未设置 SSH_AUTH_SOCK）');
    return { ...base, agent };
  }
  if (cfg.keyPath) {
    try {
      return { ...base, privateKey: fs.readFileSync(cfg.keyPath), passphrase: cfg.passphrase || undefined };
    } catch (e) {
      throw new Error(`读取私钥失败：${e.message}`);
    }
  }
  return { ...base, password: cfg.password };
}

class Pool {
  constructor() {
    this.conns = new Map();
  }

  get(cfg) {
    const cur = this.conns.get(cfg.id);
    if (cur) {
      const changed =
        cur.cfg.host !== cfg.host || cur.cfg.port !== cfg.port || cur.cfg.username !== cfg.username;
      if (changed) {
        cur.close();
      } else {
        cur.cfg = cfg;
        return cur;
      }
    }
    const conn = new Connection(cfg);
    this.conns.set(cfg.id, conn);
    return conn;
  }

  remove(id) {
    const c = this.conns.get(id);
    if (c) c.close();
    this.conns.delete(id);
  }

  statusOf(id) {
    const c = this.conns.get(id);
    return c ? { status: c.status, error: c.error } : { status: 'offline', error: '' };
  }
}

module.exports = { Pool, Connection, parseSnapshot, COLLECT_CMD, setHostKeyChecker, setInteractiveHandler, setJumpResolver };
