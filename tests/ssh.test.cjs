import { describe, it, expect } from 'vitest';
import { parseSnapshot, COLLECT_CMD } from '../electron/ssh.cjs';

// 与 scripts/fake-sshd.cjs 的假输出同构，另含畸形行与 N/A 读数
const SAMPLE = [
  '0, GPU-aaaa, NVIDIA A100-SXM4-80GB, 92, 78320, 81920, 78, 342.5, 71',
  '1, GPU-bbbb, NVIDIA A100-SXM4-80GB, 12, 2048, 81920, 41, 88.0, 34',
  '2, GPU-cccc, NVIDIA A100-SXM4-80GB, 0, 0, 81920, N/A, 62.0, N/A',
  'bad-line-without-commas',
  '9, GPU-eeee, NVIDIA T4, 5', // 字段不足 6 → 忽略
  '__APPS__',
  'GPU-aaaa, 2311, 40231',
  'GPU-bbbb, 3102, 2048',
  'GPU-zzzz, 9999, 512', // 未知 uuid → 忽略
  '__SYS__',
  '3.42 2.98 2.71 2/913 88213',
  '64',
  'Mem:   540587950080 312475783168 201338826752  1073741824 26773340160 224089440256',
  'Swap:  68719476736  2147483648 66571993088',
  '__PS__',
  '2311 lin       187.4  3.1 13312000 Rl   03:14:22 python train.py --config configs/llama_7b.yaml',
  '8899 root        0.0  0.0     5120 Z           00:10 /usr/bin/defunct',
  '3102 zhao        0.4  0.1   204800 S    4-02:11:03 python inference_server.py --model qwen2-7b',
  'junk-line',
].join('\n');

describe('parseSnapshot', () => {
  const snap = parseSnapshot(SAMPLE);

  it('parses GPUs with sensor nulls (N/A → null, 绝不伪造 0)', () => {
    expect(snap.gpus.length).toBe(3);
    const g0 = snap.gpus[0];
    expect(g0.index).toBe(0);
    expect(g0.util).toBe(92);
    expect(g0.memUsed).toBe(78320);
    expect(g0.memTotal).toBe(81920);
    expect(g0.temp).toBe(78);
    expect(g0.power).toBe(343);
    expect(g0.fan).toBe(71);
    const g2 = snap.gpus[2];
    expect(g2.temp).toBe(null);
    expect(g2.fan).toBe(null);
  });

  it('maps compute apps onto GPUs by uuid and skips unknown uuids', () => {
    expect(snap.gpus[0].procs).toEqual([{ pid: 2311, name: 'python', memMb: 40231 }]);
    expect(snap.gpus[1].procs).toEqual([{ pid: 3102, name: 'python', memMb: 2048 }]);
    expect(snap.gpus[2].procs).toEqual([]);
  });

  it('fills process name from process table (basename of argv0)', () => {
    const p = snap.processes.find((x) => x.pid === 2311);
    expect(p.command).toContain('train.py');
  });

  it('parses system metrics', () => {
    expect(snap.cpuCores).toBe(64);
    expect(snap.loadAvg).toEqual([3.42, 2.98, 2.71]);
    // 312475783168 / 1024^3 ≈ 291.0
    expect(snap.memUsed).toBe(291);
    expect(snap.swapUsed).toBe(2);
    expect(snap.swapTotal).toBe(64);
  });

  it('marks zombie state', () => {
    const z = snap.processes.find((x) => x.pid === 8899);
    expect(z.state).toBe('Z');
  });

  it('empty sections parse to an empty snapshot (gpuError 由 collect() 包装层设置)', () => {
    const s = parseSnapshot(['__APPS__', '__SYS__', '1 1 1', '4', 'Mem: 1 1 1', '__PS__'].join('\n'));
    expect(s.gpus).toEqual([]);
    expect(s.processes).toEqual([]);
  });

  it('COLLECT_CMD keeps marker ordering intact', () => {
    expect(COLLECT_CMD).toContain('__APPS__');
    expect(COLLECT_CMD.indexOf('__APPS__')).toBeLessThan(COLLECT_CMD.indexOf('__SYS__'));
    expect(COLLECT_CMD.indexOf('__SYS__')).toBeLessThan(COLLECT_CMD.indexOf('__PS__'));
  });
});

describe('SFTP & Shell safety', () => {
  it('parses valid octal chmod and rejects NaN', () => {
    const parseMode = (m) => (typeof m === 'number' ? m : parseInt(String(m), 8));
    expect(parseMode('755')).toBe(0o755);
    expect(parseMode('644')).toBe(0o644);
    expect(parseMode(0o700)).toBe(0o700);
    expect(Number.isNaN(parseMode('invalid'))).toBe(true);
  });

  it('gc regex correctly matches server-console temporary direct relay tags only', () => {
    const oldRegex = / sc[a-z0-9]{8}$/;
    const newRegex = / sckey-[a-z0-9]{8}$/;
    // 新格式（v0.10.1+）：sckey- 前缀精确匹配
    expect(newRegex.test('ssh-ed25519 AAAAC3... sckey-9a1b2c3d')).toBe(true);
    expect(newRegex.test('ssh-ed25519 AAAAC3... sckey-test1abc')).toBe(true);
    expect(newRegex.test('ssh-rsa AAAAB3... user@my-desktop')).toBe(false);
    expect(newRegex.test('ssh-ed25519 AAAAC3... sckey-short')).toBe(false);
    // 旧格式（v0.9.x 遗留）：仍需清理
    expect(oldRegex.test('ssh-ed25519 AAAAC3... sc9a1b2c3d')).toBe(true);
    expect(oldRegex.test('ssh-rsa AAAAB3... user@my-desktop')).toBe(false);
    expect(oldRegex.test('ssh-ed25519 AAAAC3... sc123')).toBe(false);
    // 用户自有密钥注释（邮箱/主机名/常见格式）不应被任一模式误删
    expect(newRegex.test('ssh-ed25519 AAAAC3... user@my-desktop')).toBe(false);
    expect(oldRegex.test('ssh-ed25519 AAAAC3... scadmin')).toBe(false);
    expect(oldRegex.test('ssh-ed25519 AAAAC3... sc2024!')).toBe(false);
  });

  it('differential polling: focused server always collects, background respects bgInterval', () => {
    // 模拟差异化调度的核心判定逻辑
    const bgInterval = Math.max(2000 * 4, 8000); // 8000
    const lastCollectTime = new Map();
    const now = 1000000;

    const shouldCollect = (serverId, isActive) => {
      if (isActive) return true;
      const last = lastCollectTime.get(serverId) || 0;
      return now - last >= bgInterval;
    };

    // 活跃服务器每轮都采集
    expect(shouldCollect('srv-a', true)).toBe(true);
    // 后台服务器首次也采集（无历史记录）
    expect(shouldCollect('srv-b', false)).toBe(true);
    // 刚采集过的后台服务器被跳过
    lastCollectTime.set('srv-b', now - 4000); // 4s < 8s
    expect(shouldCollect('srv-b', false)).toBe(false);
    // 超过 bgInterval 后恢复采集
    lastCollectTime.set('srv-b', now - 9000); // 9s > 8s
    expect(shouldCollect('srv-b', false)).toBe(true);
  });
});
