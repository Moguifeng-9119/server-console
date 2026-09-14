const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let file = null;

function storeFile() {
  if (!file) file = path.join(app.getPath('userData'), 'servers.json');
  return file;
}

function encrypt(v) {
  if (!v) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(v).toString('base64')}`;
  }
  // 兜底：Linux 无 libsecret 时 safeStorage 不可用，明文落盘并标记
  return `plain:${Buffer.from(v, 'utf8').toString('base64')}`;
}

function decrypt(v) {
  if (!v) return '';
  if (v.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
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

module.exports = { load, save, publicView, encryptionAvailable: () => safeStorage.isEncryptionAvailable() };
