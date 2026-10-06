const lang = require('./lang.cjs');
// 本地文件系统浏览（双面板左侧、上传源枚举、下载落盘）。主进程可用 node:fs。
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');

function homeDir() {
  return os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
}

function typeOf(st) {
  if (st.isDirectory()) return 'dir';
  if (st.isSymbolicLink()) return 'link';
  return 'file';
}

function rightsOf(mode) {
  const s = ['r', 'w', 'x'];
  let out = '';
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out += mode & (0o400 >> (i * 3 + j)) ? s[j] : '-';
  }
  return out;
}

function sortEntries(entries) {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

// 列目录，返回当前绝对路径 + 归一化条目（目录在前，按名排序）
async function list(dir) {
  const abs = path.resolve(dir || homeDir());
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new Error(lang.t('notDir', { path: abs }));
  const names = await fsp.readdir(abs);
  const entries = [];
  for (const name of names) {
    const fp = path.join(abs, name);
    try {
      const s = await fsp.lstat(fp);
      entries.push({
        name,
        path: fp,
        type: typeOf(s),
        size: s.size,
        mtime: s.mtimeMs,
        mode: s.mode,
        rights: rightsOf(s.mode & 0o777),
      });
    } catch {
      /* 无权限/已删除则跳过 */
    }
  }
  return { path: abs, parent: path.dirname(abs), entries: sortEntries(entries) };
}

async function stat(p) {
  const s = await fsp.lstat(p);
  return { path: path.resolve(p), name: path.basename(p), type: typeOf(s), size: s.size, mtime: s.mtimeMs, mode: s.mode };
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
  return path.resolve(p);
}

async function rename(from, to) {
  await fsp.rename(from, to);
  return true;
}

async function rmrf(target) {
  // 护栏：拒绝删除盘根目录和用户主目录本身（UI 有确认框，这里是最后一道保险）
  const abs = path.resolve(target);
  if (abs === path.parse(abs).root) throw new Error(lang.t('unsafeDelete', { path: abs }));
  const home = path.resolve(homeDir());
  if (home && abs === home) throw new Error(lang.t('unsafeDelete', { path: abs }));
  await fsp.rm(abs, { recursive: true, force: true });
  return true;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// 常见盘符（Windows）/ 根目录
async function roots() {
  if (process.platform === 'win32') {
    const out = [];
    for (let c = 65; c <= 90; c++) {
      const drv = String.fromCharCode(c) + ':\\';
      if (await exists(drv)) out.push(drv);
    }
    return out;
  }
  return ['/'];
}

module.exports = { homeDir, list, stat, mkdirp, rename, rmrf, exists, roots, rightsOf };
