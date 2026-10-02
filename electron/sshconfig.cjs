// SSH config 解析与私钥路径处理（主进程，可用 fs/os/path）
// 负责：读取并解析 OpenSSH 的 config 文件，展开 IdentityFile，检查私钥是否存在。
// 解析结果交给渲染进程展示，最终复用 servers:add 导入为服务器。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 常见默认私钥文件名（config 未写 IdentityFile 时用于推荐）
const DEFAULT_KEY_NAMES = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa', 'identity'];

function homeDir() {
  return os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
}

// 把 ssh config 里的路径展开成绝对路径：~/、%d/%u、Windows 环境变量、相对路径
function expandPath(p, baseDir) {
  if (p == null) return '';
  let s = String(p).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  const home = homeDir();
  // OpenSSH 转义符：%d=home %u=本机用户 %h=目标主机 %r=登录用户
  s = s
    .replace(/%d/g, home)
    .replace(/%u/g, (os.userInfo().username || ''))
    .replace(/%%/g, '%');
  // Windows 风格环境变量 %USERPROFILE%
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => process.env[name] || m);
  if (s === '~') return home;
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(home, s.slice(2));
  if (path.isAbsolute(s)) return path.normalize(s);
  // 裸文件名（如 id_rsa）默认相对 ~/.ssh；带分隔符的相对路径相对 config 所在目录
  if (!/[\\/]/.test(s) && baseDir) {
    const guessSsh = path.join(home, '.ssh', s);
    if (fs.existsSync(guessSsh)) return path.normalize(guessSsh);
  }
  if (baseDir) return path.normalize(path.resolve(baseDir, s));
  return path.normalize(path.join(home, s));
}

function isWildcardPattern(p) {
  return /[*?]/.test(p) || p.charAt(0) === '!';
}

// 解析 config 文本。返回 blocks:[{patterns, kv, identities:[]}]
function parseText(text) {
  const blocks = [];
  let cur = null;
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    // 关键字与参数之间用空白或等号分隔
    const m = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*[=\s]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!val) continue;
    if (key === 'host') {
      cur = { patterns: val.split(/\s+/).filter(Boolean), kv: {}, identities: [] };
      blocks.push(cur);
    } else if (cur) {
      if (key === 'identityfile') {
        cur.identities.push(val); // IdentityFile 可出现多次
      } else if (!(key in cur.kv)) {
        cur.kv[key] = val; // 其余参数首个值生效
      }
    }
  }
  return blocks;
}

// 把全局块（Host *）与具体主机块合并，产出可导入条目
function buildEntries(blocks, baseDir) {
  const globalKv = {};
  const globalIds = [];
  for (const b of blocks) {
    const isGlobal = b.patterns.every(isWildcardPattern);
    if (!isGlobal) continue;
    for (const [k, v] of Object.entries(b.kv)) if (!(k in globalKv)) globalKv[k] = v;
    globalIds.push(...b.identities);
  }

  const entries = [];
  const seenAlias = new Set();
  for (const b of blocks) {
    const concrete = b.patterns.filter((p) => !isWildcardPattern(p));
    if (!concrete.length) continue;
    const alias = concrete[0];
    if (seenAlias.has(alias)) continue;
    seenAlias.add(alias);

    const kv = { ...globalKv, ...b.kv }; // 具体块覆盖全局
    const localIds = b.identities.map((v) => expandPath(v, baseDir));
    const globalIdsExp = globalIds.map((v) => expandPath(v, baseDir));
    // 选择私钥：优先主机块自己指定且存在的，其次全局存在的；都不存在则优先主机块首个候选
    let keyPath = '';
    let keyExists = false;
    const ordered = [...localIds, ...globalIdsExp];
    for (const cand of ordered) {
      if (cand && fs.existsSync(cand)) {
        keyPath = cand;
        keyExists = true;
        break;
      }
    }
    if (!keyPath) keyPath = localIds[0] || globalIdsExp[0] || '';
    // 候选去重，主机块在前
    const idList = [...new Set(ordered)];

    const hostName = (kv.hostname || alias).trim();
    entries.push({
      alias,
      allAliases: concrete,
      host: hostName,
      port: Number(kv.port) || 22,
      user: (kv.user || '').trim(),
      keyPath,
      keyExists,
      keyCandidates: idList,
      ownKeyCandidates: localIds,
      proxyJump: kv.proxyjump || '', // 仅支持 ProxyJump 指令；ProxyCommand 暂不解析
      raw: { hostname: hostName, user: (kv.user || '').trim(), port: kv.port || '' },
    });
  }
  return entries;
}

// 读取并解析一个 config 文件
function readConfig(filePath) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  const blocks = parseText(text);
  const entries = buildEntries(blocks, path.dirname(abs));
  return { path: abs, mtimeMs: fs.statSync(abs).mtimeMs, entries };
}

// 默认信息：~/.ssh/config 路径、是否存在、~/.ssh 下可用的候选私钥
function defaultInfo() {
  const home = homeDir();
  const sshDir = path.join(home, '.ssh');
  const configPath = path.join(sshDir, 'config');
  const result = {
    home,
    sshDir,
    configPath,
    configExists: false,
    keys: [],
  };
  try {
    result.configExists = fs.existsSync(configPath) && fs.statSync(configPath).isFile();
  } catch {
    result.configExists = false;
  }
  try {
    if (fs.existsSync(sshDir)) {
      const names = fs.readdirSync(sshDir);
      for (const name of names) {
        // 跳过公钥、已知主机/配置，以及明显不是私钥的文件
        const lower = name.toLowerCase();
        const skipExt = ['.pub', '.txt', '.bak', '.old', '.log', '.crt', '.cer', '.md', '.zip', '.tar', '.gz', '.7z', '.rar'];
        if (skipExt.some((x) => lower.endsWith(x))) continue;
        if (['config', 'known_hosts', 'known_hosts.old', 'authorized_keys'].includes(name)) continue;
        const full = path.join(sshDir, name);
        try {
          if (fs.statSync(full).isFile()) {
            result.keys.push({
              name,
              path: full,
              preferred: DEFAULT_KEY_NAMES.includes(lower) || lower.endsWith('.pem'),
            });
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  result.keys.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return result;
}

// ~/.ssh/config 条目与现有服务器列表的比对（纯函数，便于单测）。
// 第一依据是别名（导入时 name 取的就是 config 别名）；没有同名时按 host+port+user 三元组去重。
function diffConfig(entries, servers) {
  const added = [];
  const changed = [];
  for (const e of entries) {
    const byName = (servers || []).find((s) => s.name === e.alias);
    if (byName) {
      const portChg = byName.port !== e.port;
      const keyChg = !!e.keyPath && e.keyPath !== (byName.keyPath || '');
      if (portChg || keyChg) {
        changed.push({
          targetId: byName.id,
          alias: e.alias,
          host: e.host,
          fromPort: byName.port,
          toPort: e.port,
          keyPath: e.keyPath,
          entry: e,
        });
      }
      continue;
    }
    const exact = (servers || []).find((s) => s.host === e.host && s.port === e.port && s.username === e.user);
    if (!exact) added.push(e);
  }
  return { added, changed };
}

module.exports = { readConfig, parseText, buildEntries, expandPath, defaultInfo, homeDir, diffConfig };
