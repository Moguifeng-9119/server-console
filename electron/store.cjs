// Secure OS storage when available; otherwise credentials stay in memory only.
// 通过 init({ dataDir, safeStorage }) 注入，避免测试环境依赖 electron。
const fs = require('node:fs');
const path = require('node:path');

let file = null;
let dataDir = '';
let enc = null; // electron safeStorage 适配器
let sessionSecrets = new Map();
let migrationError = '';

function init(opts = {}) {
  dataDir = opts.dataDir || '';
  enc = opts.safeStorage || null;
  file = null;
  sessionSecrets = new Map();
  migrationError = '';
  // Upgrade old base64/basic_text records before exposing the server list.
  const target = storeFile();
  if (fs.existsSync(target)) {
    try {
      const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!Array.isArray(raw?.servers)) throw new Error('Invalid server store format');
      for (const server of raw.servers) {
        if (!server || typeof server !== 'object' || typeof server.id !== 'string' ||
            ['password', 'passphrase'].some((key) => server[key] != null && typeof server[key] !== 'string')) {
          throw new Error('Invalid server credential record');
        }
      }
      const weak = (value) => typeof value === 'string' && !!value && (!value.startsWith('enc:') || info().backend === 'basic_text');
      if (raw.servers.some((server) => weak(server.password) || weak(server.passphrase))) {
        save(raw.servers.map((server) => ({ ...server, password: decrypt(server.password || ''), passphrase: decrypt(server.passphrase || '') })));
      }
    } catch (error) { migrationError = 'Credential migration failed: ' + error.message; }
  }
}

function info() {
  let backend = 'unavailable';
  try {
    backend = enc?.getSelectedStorageBackend ? enc.getSelectedStorageBackend() : 'os';
    const encryptionAvailable = !!(enc && enc.isEncryptionAvailable() && backend !== 'basic_text');
    return { encryptionAvailable, backend, mode: encryptionAvailable ? 'encrypted' : 'session', migrationError };
  } catch { return { encryptionAvailable: false, backend, mode: 'session', migrationError }; }
}

function storeFile() {
  if (!file) file = path.join(dataDir || require('electron').app.getPath('userData'), 'servers.json');
  return file;
}

function encrypt(v) {
  if (!v) return '';
  if (info().encryptionAvailable) {
    return `enc:${enc.encryptString(v).toString('base64')}`;
  }
  return '';
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
      password: sessionSecrets.get(s.id)?.password ?? decrypt(s.password || ''),
      passphrase: sessionSecrets.get(s.id)?.passphrase ?? decrypt(s.passphrase || ''),
    }));
  } catch {
    return [];
  }
}

function save(servers) {
  if (migrationError) throw new Error(migrationError + '; repair or restore servers.json before saving');
  const nextSecrets = new Map();
  const payload = {
    servers: servers.map(({ password, passphrase, ...rest }) => {
      nextSecrets.set(rest.id, { password: password || '', passphrase: passphrase || '' });
      return { ...rest, password: encrypt(password), passphrase: encrypt(passphrase) };
    }),
  };
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  const temp = storeFile() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(temp, storeFile());
  sessionSecrets = nextSecrets;
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
  encryptionAvailable: () => info().encryptionAvailable,
  info,
};
