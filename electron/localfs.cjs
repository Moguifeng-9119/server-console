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
  if (!st.isDirectory()) throw new Error('不是目录：' + abs);
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
  await fsp.rm(target, { recursive: true, force: true });
  return true;
}

// 递归枚举一个本地文件/文件夹（文件夹上传用），不跟随符号链接
async function walk(root) {
  const rootAbs = path.resolve(root);
  const rootStat = await fsp.lstat(rootAbs);
  const files = [];
  let totalSize = 0;
  const visit = async (abs, rel) => {
    const s = await fsp.lstat(abs);
    if (s.isDirectory()) {
      const names = await fsp.readdir(abs);
      for (const n of names) await visit(path.join(abs, n), rel ? path.join(rel, n) : n);
    } else if (s.isFile()) {
      files.push({ abs, rel: rel || path.basename(abs), size: s.size });
      totalSize += s.size;
    }
  };
  if (rootStat.isFile()) {
    files.push({ abs: rootAbs, rel: path.basename(rootAbs), size: rootStat.size });
    totalSize += rootStat.size;
  } else {
    await visit(rootAbs, '');
  }
  return { root: rootAbs, files, totalSize, totalFiles: files.length };
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

module.exports = { homeDir, list, stat, mkdirp, rename, rmrf, walk, exists, roots, rightsOf };
