// 开发/测试用假 SSH 服务：本地起一个 sshd，返回假的 nvidia-smi / ps 输出，
// 并提供基于真实临时目录的 SFTP 子系统（列表/读写/建删/改名），
// 用于无真实 GPU 服务器时验证采集与传输链路。不会打进最终安装包。
//   启动：node scripts/fake-sshd.cjs   （默认 2222 端口，任意用户名密码）
//   作为库：const { createFakeSshd } = require('./fake-sshd.cjs')
const { Server } = require('ssh2');
const { STATUS_CODE } = require('ssh2/lib/protocol/SFTP.js'); // ssh2 未从顶层导出，仅 dev/测试脚本使用
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const PORT = Number(process.env.FAKE_SSH_PORT || 2222);

function hostKey() {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    return privateKey;
}

const GPU_CSV = [
  '0, GPU-aaaa, NVIDIA A100-SXM4-80GB, 92, 78320, 81920, 78, 342.5, 71',
  '1, GPU-bbbb, NVIDIA A100-SXM4-80GB, 12, 2048, 81920, 41, 88.0, 34',
  '2, GPU-cccc, NVIDIA A100-SXM4-80GB, 0, 0, 81920, N/A, 62.0, N/A',
].join('\n');

const APPS_CSV = ['GPU-aaaa, 2311, 40231', 'GPU-aaaa, 2455, 38089', 'GPU-bbbb, 3102, 2048', 'GPU-zzzz, 9999, 512'].join('\n');

const SYS = [
  '3.42 2.98 2.71 2/913 88213',
  '64',
  '               total        used        free      shared  buff/cache   available',
  'Mem:   540587950080 312475783168 201338826752  1073741824 26773340160 224089440256',
  'Swap:  68719476736  2147483648 66571993088',
].join('\n');

const PS = [
  '2311 lin       187.4  3.1 13312000 Rl   03:14:22 python train.py --config configs/llama_7b.yaml',
  '2455 wang       92.1  2.8 12042240 Sl+  01:02:11 python eval.py --ckpt exp42',
  '3102 zhao        0.4  0.1   204800 S    4-02:11:03 python inference_server.py --model qwen2-7b',
  '8899 root        0.0  0.0     5120 Z           00:10 /usr/bin/defunct',
  '9001 ops         0.1  0.0    98304 S    10:02:31 sshd: ops@pts/3',
].join('\n');

function fakeCollect() {
  return `${GPU_CSV}\n__APPS__\n${APPS_CSV}\n__SYS__\n${SYS}\n__PS__\n${PS}\n`;
}

// ===== SFTP 子系统：以 rootDir 为根的文件操作 =====
const SFTP_ROOT = path.resolve(process.env.FAKE_SSH_ROOT || '.');

function makeRealPath(rootDir) {
  return (p) => {
    const rel = String(p || '.').replace(/^\/+/, '');
    const abs = path.resolve(rootDir, rel);
    if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) return null; // 越界拒绝
    return abs;
  };
}

function convertStats(stats) {
  return { mode: stats.mode, uid: stats.uid, gid: stats.gid, size: stats.size, atime: stats.atimeMs / 1000, mtime: stats.mtimeMs / 1000 };
}

function attachSftp(sftpStream, rootDir) {
  const realPath = makeRealPath(rootDir);
  const handles = new Map(); // hex -> { fd?, dir?, done? }
  const replyFail = (reqId, msg) => sftpStream.status(reqId, /ENOENT/.test(msg) ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE, msg);
  const openFlags = (flags) => {
    const READ = 1, WRITE = 2, APPEND = 4, CREAT = 8, TRUNC = 16;
    if (flags & READ && !(flags & WRITE)) return 'r';
    if (flags & WRITE && flags & APPEND) return 'a';
    if (flags & WRITE && flags & CREAT && flags & TRUNC) return 'w';
    if (flags & WRITE && flags & CREAT) return 'w';
    if (flags & WRITE) return 'r+';
    return 'r';
  };
  const newHandle = (props) => {
    const h = Buffer.from(require('node:crypto').randomBytes(8)).toString('hex');
    handles.set(h, props);
    return Buffer.from(h, 'utf8');
  };

  sftpStream.on('REALPATH', (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    sftpStream.name(reqId, [{ filename: abs, longname: abs }]);
  });

  sftpStream.on('OPENDIR', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      const st = await fsp.stat(abs);
      if (!st.isDirectory()) return replyFail(reqId, 'not a directory');
      sftpStream.handle(reqId, newHandle({ dir: abs, done: false }));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('READDIR', async (reqId, handle) => {
    const h = handles.get(handle.toString('utf8'));
    if (!h || !h.dir || h.done) return sftpStream.status(reqId, STATUS_CODE.EOF);
    try {
      const names = await fsp.readdir(h.dir, { withFileTypes: true });
      const entries = [];
      for (const d of names) {
        const full = path.join(h.dir, d.name);
        try {
          const st = await fsp.lstat(full);
          // ssh2 服务端 name() 约定条目字段为 attrs（不是 stats），缺失会被客户端当普通文件
          entries.push({ filename: d.name, longname: d.name, attrs: convertStats(st) });
        } catch {
          /* 并发删除竞态：跳过 */
        }
      }
      h.done = true;
      sftpStream.name(reqId, entries);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('OPEN', async (reqId, p, flags, _attrs) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const fd = await fsp.open(abs, openFlags(flags));
      sftpStream.handle(reqId, newHandle({ fd }));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('READ', async (reqId, handle, offset, len) => {
    const h = handles.get(handle.toString('utf8'));
    if (!h || h.fd === undefined) return replyFail(reqId, 'bad handle');
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await h.fd.read(buf, 0, len, offset);
      sftpStream.data(reqId, buf.subarray(0, bytesRead));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('WRITE', async (reqId, handle, offset, data) => {
    const h = handles.get(handle.toString('utf8'));
    if (!h || h.fd === undefined) return replyFail(reqId, 'bad handle');
    try {
      await h.fd.write(data, 0, data.length, offset);
      sftpStream.status(reqId, STATUS_CODE.OK);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('CLOSE', async (reqId, handle) => {
    const h = handles.get(handle.toString('utf8'));
    if (!h) return replyFail(reqId, 'bad handle');
    handles.delete(handle.toString('utf8'));
    try {
      if (h.fd !== undefined) await h.fd.close();
    } catch {
      /* ignore */
    }
    sftpStream.status(reqId, STATUS_CODE.OK);
  });

  sftpStream.on('STAT', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      sftpStream.attrs(reqId, convertStats(await fsp.stat(abs)));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('LSTAT', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      sftpStream.attrs(reqId, convertStats(await fsp.lstat(abs)));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('FSTAT', async (reqId, handle) => {
    const h = handles.get(handle.toString('utf8'));
    if (!h || h.fd === undefined) return replyFail(reqId, 'bad handle');
    try {
      sftpStream.attrs(reqId, convertStats(await h.fd.stat()));
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('SETSTAT', (reqId) => sftpStream.status(reqId, STATUS_CODE.OK));
  sftpStream.on('FSETSTAT', (reqId) => sftpStream.status(reqId, STATUS_CODE.OK));

  sftpStream.on('MKDIR', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      await fsp.mkdir(abs, { recursive: true });
      sftpStream.status(reqId, STATUS_CODE.OK);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('RMDIR', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      await fsp.rmdir(abs);
      sftpStream.status(reqId, STATUS_CODE.OK);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('REMOVE', async (reqId, p) => {
    const abs = realPath(p);
    if (!abs) return replyFail(reqId, 'path escapes root');
    try {
      await fsp.unlink(abs);
      sftpStream.status(reqId, STATUS_CODE.OK);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });

  sftpStream.on('RENAME', async (reqId, from, to) => {
    const a = realPath(from);
    const b = realPath(to);
    if (!a || !b) return replyFail(reqId, 'path escapes root');
    try {
      await fsp.rename(a, b);
      sftpStream.status(reqId, STATUS_CODE.OK);
    } catch (e) {
      replyFail(reqId, e.message);
    }
  });
}

function attachSession(client, rootDir) {
  client.on('session', (accept) => {
    const session = accept();
    // 客户端请求 PTY（xterm 终端必须），直接接受
    session.on('pty', (accept, reject, info) => {
      console.log('[fake-sshd] pty ok, cols=' + info.cols);
      accept();
    });
    // 真实 shell（终端 e2e 测试用）：把 ssh 流接到本机 shell 子进程
    session.on('shell', (acceptShell) => {
      const stream = acceptShell();
      const { spawn } = require('node:child_process');
      const exe = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
      const args = process.platform === 'win32' ? ['-NoLogo', '-NonInteractive', '-Command', '-'] : [];
      const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      stream.write('\r\nfake-shell ready\r\n');
      stream.on('data', (d) => {
        // Pipes do not perform the PTY's CR -> LF input translation for POSIX shells.
        const input = process.platform === 'win32' ? d : d.toString('utf8').replace(/\r\n?/g, '\n');
        try { child.stdin.write(input); } catch { /* noop */ }
      });
      child.stdout.on('data', (d) => stream.write(d));
      child.stderr.on('data', (d) => stream.write(d));
      child.on('error', (error) => { stream.write('Shell failed: ' + error.message); stream.end(); });
      child.on('close', () => stream.end());
      stream.on('close', () => {
        try { child.kill(); } catch { /* noop */ }
      });
      stream.on('error', () => { /* noop */ });
    });
    session.on('exec', (acceptExec, _reject, info) => {
      const stream = acceptExec();
      const cmd = info.command;
      if (/nvidia-smi|__PS__/.test(cmd)) stream.write(fakeCollect());
      else stream.write('');
      stream.exit(0);
      stream.end();
    });
    session.on('sftp', (accept) => attachSftp(accept(), rootDir));
  });
}

// 起一个假 sshd。port=0 时由系统分配并从返回的 server 上取实际端口。
function createFakeSshd({ port = PORT, root = SFTP_ROOT, hostKeyBuf } = {}) {
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });
  const srv = new Server({ hostKeys: [hostKeyBuf || hostKey()] }, (client) => {
    client
      .on('authentication', (ctx) => ctx.accept())
      .on('ready', () => attachSession(client, rootDir))
      .on('error', () => {
        /* noop */
      });
  });
  return new Promise((resolve, reject) => {
    srv.listen(port, '127.0.0.1', () => resolve(srv)).on('error', reject);
  });
}

module.exports = { createFakeSshd, fakeCollect };

// 直接运行：CLI 模式（根目录为当前目录）
if (require.main === module) {
  createFakeSshd().then(() => console.log(`假 SSH 服务已启动：127.0.0.1:${PORT}（SFTP 根：${SFTP_ROOT}）`));
}
