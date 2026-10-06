import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import hostkeys from '../electron/hostkeys.cjs';
import store from '../electron/store.cjs';

describe('security persistence', () => {
  it('preserves disabled TOFU across reinitialization and keeps stores isolated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-security-'));
    hostkeys.init(dir);
    hostkeys.setOpts({ tofu: false });
    hostkeys.init(dir);
    expect(hostkeys.getOpts().tofu).toBe(false);
    hostkeys.init(path.join(dir, 'other'));
    expect(hostkeys.getOpts().tofu).toBe(true);
  });

  it('never writes recoverable credentials without a secure backend', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-secrets-'));
    store.init({ dataDir: dir, safeStorage: { isEncryptionAvailable: () => false } });
    store.save([{ id: 'fixture', password: 'fixture-secret', passphrase: 'fixture-passphrase' }]);
    const raw = fs.readFileSync(path.join(dir, 'servers.json'), 'utf8');
    expect(raw).not.toContain('fixture-secret');
    expect(raw).not.toContain(Buffer.from('fixture-secret').toString('base64'));
    expect(store.load()[0].password).toBe('fixture-secret');
    expect(store.info().mode).toBe('session');
    store.init({ dataDir: dir, safeStorage: { isEncryptionAvailable: () => false } });
    expect(store.load()[0].password).toBe('');
  });

  it('treats Linux basic_text as session-only even if encryption is available', () => {
    store.init({ dataDir: os.tmpdir(), safeStorage: {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text',
    } });
    expect(store.info().encryptionAvailable).toBe(false);
  });

  it('migrates legacy base64 secrets into session storage on startup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-migrate-'));
    const secret = 'legacy fixture credential';
    const target = path.join(dir, 'servers.json');
    fs.writeFileSync(target, JSON.stringify({servers: [{id: 'fixture', password: 'plain:' + Buffer.from(secret).toString('base64')}]}));
    store.init({dataDir: dir});
    expect(store.load()[0].password).toBe(secret);
    expect(fs.readFileSync(target, 'utf8')).not.toContain('plain:');
    store.init({dataDir: dir}); expect(store.load()[0].password).toBe('');
  });

  it('reports a corrupt legacy store without blocking startup or replacing the original file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-corrupt-'));
    const target = path.join(dir, 'servers.json'); fs.writeFileSync(target, '{truncated');
    expect(() => store.init({dataDir: dir})).not.toThrow();
    expect(store.info().migrationError).toContain('Credential migration failed');
    expect(fs.readFileSync(target, 'utf8')).toBe('{truncated');
  });

  it('preserves mixed malformed and legacy records rather than migrating an empty list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-shape-'));
    const target = path.join(dir, 'servers.json');
    const raw = JSON.stringify({servers: [{id: 'bad', password: 123}, {id: 'legacy', password: 'plain:' + Buffer.from('fixture').toString('base64')} ]});
    fs.writeFileSync(target, raw); store.init({dataDir: dir});
    expect(store.info().migrationError).toContain('Invalid server credential record');
    expect(fs.readFileSync(target, 'utf8')).toBe(raw);
  });

  it('blocks subsequent saves until a corrupt credential store is repaired', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-block-save-'));
    const target = path.join(dir, 'servers.json'); fs.writeFileSync(target, '{truncated');
    store.init({dataDir: dir});
    expect(() => store.save([{id: 'new', password: 'fixture'}])).toThrow('repair or restore');
    expect(fs.readFileSync(target, 'utf8')).toBe('{truncated');
  });

  it('rejects corrupted trust/options stores instead of silently learning a new fingerprint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-trust-corrupt-'));
    const trust = path.join(dir, 'hostkeys.json'); fs.writeFileSync(trust, '{broken');
    hostkeys.init(dir);
    expect(() => hostkeys.makeVerifier()('fixture', 22, Buffer.from('key'))).toThrow('Cannot load host trust store');
    expect(fs.readFileSync(trust, 'utf8')).toBe('{broken');
    fs.unlinkSync(trust); fs.writeFileSync(path.join(dir, 'security.json'), '{broken'); hostkeys.init(dir);
    expect(() => hostkeys.makeVerifier()('fixture', 22, Buffer.from('key'))).toThrow('Cannot load host trust options');
    expect(fs.existsSync(trust)).toBe(false);
  });

  it('does not accept a new host if atomic trust persistence fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-trust-write-'));
    hostkeys.init(dir); const verify = hostkeys.makeVerifier();
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('fixture write denied'); });
    try {
      expect(() => verify('fixture', 22, Buffer.from('key'))).toThrow('fixture write denied');
      expect(hostkeys.list()).toEqual([]);
    } finally { rename.mockRestore(); }
    expect(verify('fixture', 22, Buffer.from('key'))).toBe(true);
    hostkeys.init(dir);
    expect(() => verify('fixture', 22, Buffer.from('changed'))).toThrow('fingerprint');
  });

  it('restores a trusted host when removal cannot be persisted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-trust-remove-'));
    hostkeys.init(dir); const verify = hostkeys.makeVerifier(); verify('fixture', 22, Buffer.from('key'));
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('fixture write denied'); });
    try {
      expect(() => hostkeys.remove('fixture|22')).toThrow('fixture write denied');
      expect(() => verify('fixture', 22, Buffer.from('changed'))).toThrow('fingerprint');
    } finally { rename.mockRestore(); }
  });
});
