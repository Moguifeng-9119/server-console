// 凭据存储：safeStorage 加密 + 不可用时 base64 降级（plain: 前缀）。
// 通过 init({ dataDir, safeStorage }) 注入，避免测试环境依赖 electron。
const fs = require('node:fs');
const path = require('node:path');

let file = null;
let dataDir = '';
let enc = null; // electron safeStorage 适配器

function init(opts = {}) {
  dataDir = opts.dataDir || '';
  enc = opts.safeStorage || null;
  file = null;
}

function storeFile() {
  if (!file) file = path.join(dataDir || require('electron').app.getPath('userData'), 'servers.json');
  return file;
}

function encrypt(v) {
  if (!v) return '';
  if (enc && enc.isEncryptionAvailable()) {
    return `enc:${enc.encryptString(v).toString('base64')}`;
  }
  // 兜底：无 safeStorage（Linux 无 libsecret / 测试环境）时明文落盘并标记
  return `plain:${Buffer.from(v, 'utf8').toString('base64')}`;
}

function decrypt(v) {
  if (!v) return '';
  if (v.startsWith('enc:')) {
    try {
      return enc ? enc.decryptString(Buffer.from(v.slice(4), 'base64')) : '';
    } catch {
      return '';
    }
  }
  if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf8');
  return v;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return (raw.servers || []).map((s) => ({
      ...s,
      password: decrypt(s.password || ''),
      passphrase: decrypt(s.passphrase || ''),
    }));
  } catch {
    return [];
  }
}

function save(servers) {
  const payload = {
    servers: servers.map(({ password, passphrase, ...rest }) => ({
      ...rest,
      password: encrypt(password),
      passphrase: encrypt(passphrase),
    })),
  };
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(payload, null, 2), { mode: 0o600 });
}

// 给渲染进程的列表不含密钥
function publicView(s) {
  const { password, passphrase, ...rest } = s;
  return { ...rest, hasPassword: Boolean(password), hasPassphrase: Boolean(passphrase) };
}

module.exports = {
  init,
  load,
  save,
  publicView,
  encryptionAvailable: () => !!(enc && enc.isEncryptionAvailable()),
};
