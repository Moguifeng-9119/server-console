import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseText, buildEntries, expandPath, diffConfig } from '../electron/sshconfig.cjs';

const SAMPLE_CONFIG = `
# comment
Host *
  ServerAliveInterval 60
  IdentityFile ~/.ssh/id_ed25519

Host dgx-01 dgx-alias
  HostName 10.20.1.11
  User lin
  Port 2222
  IdentityFile ~/.ssh/id_dgx

Host=equal-syntax
  HostName = 10.0.0.9
  User root

Host bare
  HostName bare.example.com
`;

describe('parseText', () => {
  it('splits blocks and supports space/equals separators', () => {
    const blocks = parseText(SAMPLE_CONFIG);
    expect(blocks.length).toBe(4);
    expect(blocks[1].patterns).toEqual(['dgx-01', 'dgx-alias']);
    expect(blocks[1].kv.hostname).toBe('10.20.1.11');
    expect(blocks[2].patterns).toEqual(['equal-syntax']);
    expect(blocks[2].kv.hostname).toBe('10.0.0.9');
  });

  it('collects repeated IdentityFile and skips comments/blank lines', () => {
    const blocks = parseText(SAMPLE_CONFIG);
    expect(blocks[1].identities).toEqual(['~/.ssh/id_dgx']);
    expect(blocks[0].identities).toEqual(['~/.ssh/id_ed25519']);
  });
});

describe('buildEntries', () => {
  it('merges global block, takes first concrete alias, expands keys', () => {
    const blocks = parseText(SAMPLE_CONFIG);
    const entries = buildEntries(blocks, '/tmp');
    const dgx = entries.find((e) => e.alias === 'dgx-01');
    expect(dgx.allAliases).toEqual(['dgx-01', 'dgx-alias']);
    expect(dgx.host).toBe('10.20.1.11');
    expect(dgx.port).toBe(2222);
    expect(dgx.user).toBe('lin');
    // 全局 IdentityFile 展开：~ 指向当前测试进程的 home
    expect(dgx.keyCandidates.some((p) => p.endsWith('id_ed25519'))).toBe(true);
    expect(entries.find((e) => e.alias === 'equal-syntax')).toBeTruthy();
  });

  it('missing user/port fall back to defaults', () => {
    const entries = buildEntries(parseText(SAMPLE_CONFIG), '/tmp');
    const bare = entries.find((e) => e.alias === 'bare');
    expect(bare.user).toBe('');
    expect(bare.port).toBe(22);
  });
});

describe('expandPath', () => {
  it('expands ~ and strips quotes', () => {
    const home = expandPath('~').replace(/\\/g, '/');
    expect(expandPath('"~/id_rsa"').replace(/\\/g, '/')).toBe(home + '/id_rsa');
    expect(expandPath('~/x/y').replace(/\\/g, '/')).toBe(home + '/x/y');
  });
  it('resolves relative paths against baseDir', () => {
    expect(expandPath('keys/k', '/tmp/base')).toBe(path.resolve('/tmp/base', 'keys/k'));
  });
});

describe('diffConfig', () => {
  const servers = [
    { id: 'a', name: 'dgx-01', host: '10.20.1.11', port: 2222, username: 'lin', keyPath: '' },
    { id: 'b', name: 'same-host', host: '10.0.0.9', port: 22, username: 'root' },
  ];
  const mkEntry = (alias, host, port, user, keyPath = '') => ({ alias, host, port, user, keyPath });

  it('new alias + unknown triple → added', () => {
    const { added } = diffConfig([mkEntry('new', '1.2.3.4', 22, 'u')], servers);
    expect(added.length).toBe(1);
    expect(added[0].alias).toBe('new');
  });

  it('same alias with changed port → changed (可一键更新)', () => {
    const { changed, added } = diffConfig([mkEntry('dgx-01', '10.20.1.11', 2200, 'lin')], servers);
    expect(added).toEqual([]);
    expect(changed.length).toBe(1);
    expect(changed[0].targetId).toBe('a');
    expect(changed[0].fromPort).toBe(2222);
    expect(changed[0].toPort).toBe(2200);
  });

  it('known host+port+user under a different alias → skipped, not added', () => {
    const { added } = diffConfig([mkEntry('renamed', '10.0.0.9', 22, 'root')], servers);
    expect(added).toEqual([]);
  });

  it('same host different port counts as a distinct host', () => {
    const { added } = diffConfig([mkEntry('other-port', '10.0.0.9', 2223, 'root')], servers);
    expect(added.length).toBe(1);
  });
});
