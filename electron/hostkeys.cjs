// 主机指纹信任库（TOFU：Trust On First Use）。
// 首次连接记录主机公钥指纹并放行；之后每次连接比对，不一致视为可疑（可能中间人）并拒绝。
// 指纹库：userData/hostkeys.json；TOFU 开关：userData/security.json。
// ssh.cjs / transfer.cjs 保持零 electron 依赖：通过 setHostKeyChecker / knownHostsLine 注入本模块能力。
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let trustFile = null;
let secFile = null;
let trust = null; // Map<'host|port', { type, blob, fp, firstSeen }>
let opts = { tofu: true };

function trustPath() {
  if (!trustFile) trustFile = path.join(app.getPath('userData'), 'hostkeys.json');
  return trustFile;
}
function secPath() {
  if (!secFile) secFile = path.join(app.getPath('userData'), 'security.json');
  return secPath();
}

function load() {
  if (trust) return;
  trust = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(trustPath(), 'utf8'));
    for (const [k, v] of Object.entries(raw.entries || {})) {
      if (v && typeof v.fp === 'string' && typeof v.blob === 'string') trust.set(k, v);
    }
  } catch {
    /* 首次为空 */
  }
  try {
    const o = JSON.parse(fs.readFileSync(secPath(), 'utf8'));
    if (typeof o.tofu === 'boolean') opts.tofu = o.tofu;
  } catch {
    /* 默认 TOFU 开 */
  }
}

function saveTrust() {
  try {
    fs.mkdirSync(path.dirname(trustPath()), { recursive: true });
    const entries = {};
    for (const [k, v] of trust) entries[k] = v;
    fs.writeFileSync(trustPath(), JSON.stringify({ entries }, null, 2), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function saveOpts() {
  try {
    fs.mkdirSync(path.dirname(secPath()), { recursive: true });
    fs.writeFileSync(secPath(), JSON.stringify(opts, null, 2), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function keyId(host, port) {
  return `${host}|${Number(port) || 22}`;
}

// OpenSSH known_hosts 行格式：非 22 端口写作 [host]:port
function hostSpec(host, port) {
  return Number(port) === 22 ? host : `[${host}]:${Number(port) || 22}`;
}

// ssh2 hostVerifier 回调拿到的是主机公钥的 wire-format Buffer（首段字符串即算法名）
function keyTypeOf(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 8) return '';
    const len = buf.readUInt32BE(0);
    if (len < 2 || len > 64 || 4 + len > buf.length) return '';
    return buf.toString('utf8', 4, 4 + len);
  } catch {
    return '';
  }
}

function fingerprintOf(keyBuf) {
  return 'SHA256:' + crypto.createHash('sha256').update(keyBuf).digest('base64');
}

// 校验入口。accept-new / ok → true；changed / unknown(tofu off) → 抛出带解释的错误
function verify(host, port, keyBuf) {
  load();
  const fp = fingerprintOf(keyBuf);
  const id = keyId(host, port);
  const known = trust.get(id);
  if (!known) {
    if (!opts.tofu) {
      throw new Error('尚未信任该主机的指纹，且已关闭「首次连接自动信任」。可在 设置 → 安全 中开启 TOFU 后重连。');
    }
    trust.set(id, { type: keyTypeOf(keyBuf), blob: keyBuf.toString('base64'), fp, firstSeen: Date.now() });
    saveTrust();
    return true;
  }
  if (known.fp !== fp) {
    throw new Error(
      `主机 ${host}:${Number(port) || 22} 的指纹与首次记录不一致，已拒绝连接（可能存在中间人风险）。` +
        `若确认是服务器重装/换钥，请在 设置 → 安全 中移除该主机指纹后重连。` +
        `旧 ${known.fp} → 新 ${fp}`,
    );
  }
  return true;
}

// 注入给 ssh.cjs 的校验器：返回 true 放行；抛错则由调用方转为「指纹校验失败」并携带本消息
function makeVerifier() {
  return (host, port, keyBuf) => verify(host, port, keyBuf);
}

// 给服务器直传生成目标机的 known_hosts 行（写进源机临时信任文件）；目标机从未连接过则返回 null
function knownHostsLine(host, port) {
  load();
  const known = trust.get(keyId(host, port));
  if (!known || !known.type || !known.blob) return null;
  return `${hostSpec(host, port)} ${known.type} ${known.blob}`;
}

function list() {
  load();
  return [...trust.entries()].map(([id, v]) => {
    const [host, port] = id.split('|');
    return { keyId: id, host, port: Number(port) || 22, type: v.type, fp: v.fp, firstSeen: v.firstSeen };
  });
}

function remove(id) {
  load();
  const ok = trust.delete(id);
  if (ok) saveTrust();
  return ok;
}

function getOpts() {
  load();
  return { ...opts };
}

function setOpts(o = {}) {
  load();
  if (typeof o.tofu === 'boolean') opts.tofu = o.tofu;
  saveOpts();
  return { ...opts };
}

module.exports = { makeVerifier, knownHostsLine, list, remove, getOpts, setOpts, fingerprintOf };
