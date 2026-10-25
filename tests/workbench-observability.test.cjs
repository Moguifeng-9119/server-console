import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager } from '../electron/workbench.cjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-obs-'));
const GiB = 1024 ** 3;

// 连接 stub：exec 返回 {stdout, stderr, code}；handle 按命令子串定制返回
function manager({ usageQuery = null, handle = {} } = {}) {
  const events = [], commands = [];
  const m = new WorkbenchManager({
    directory: dir(),
    getConnection: async () => ({
      exec: async (cmd) => {
        commands.push(cmd);
        for (const [pattern, value] of Object.entries(handle)) if (cmd.includes(pattern)) return typeof value === 'function' ? value(cmd) : value;
        return { stdout: '', stderr: '', code: 0 };
      },
    }),
    getServers: () => [{ id: 's1', name: 'alpha' }],
    notify: () => {},
    onEvent: (event) => events.push(event),
    usageQuery,
  });
  m.init();
  return { m, events, commands };
}
const gpu = (over = {}) => ({ index: 0, uuid: 'u0', name: 'A100', util: 2, memUsed: 60 * GiB, memTotal: 80 * GiB, procs: [{ user: 'alice' }, { user: 'bob' }], ...over });
const snapshot = (over = {}) => ({ id: 's1', status: 'online', collectedAt: Date.now(), gpus: [gpu()], laneTimestamps: { gpu: Date.now() }, ...over });

describe('log watchers', () => {
  it('rejects invalid patterns and caps the list at 8', async () => {
    const { m } = manager();
    await expect(m.request({ operation: 'logSave', serverId: 's1', name: 'bad', path: '/a.log', patterns: ['[unclosed'] })).rejects.toThrow(/Invalid pattern/);
    const saved = await m.request({ operation: 'logSave', serverId: 's1', name: 'train', path: '/a.log', patterns: Array.from({ length: 12 }, (_, i) => 'p' + i) });
    expect(saved.patterns).toHaveLength(8);
    expect(saved.trackLoss).toBe(false);
    expect(saved.enabled).toBe(true);
  });
  it('accepts a string of newline-separated patterns and dedupes blanks', async () => {
    const { m } = manager();
    const saved = await m.request({ operation: 'logSave', serverId: 's1', name: 'train', path: '/a.log', patterns: 'error\n\n  CUDA out of memory \nerror' });
    expect(saved.patterns).toEqual(['error', 'CUDA out of memory']);
  });
  it('newLines aligns the previous tail block and reports the lines after it', () => {
    expect(WorkbenchManager.newLines([], ['a', 'b'])).toEqual([]); // 首次建基线
    expect(WorkbenchManager.newLines(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']); // 追加
    expect(WorkbenchManager.newLines(['a', 'b'], ['a', 'b'])).toEqual([]); // 无变化
    expect(WorkbenchManager.newLines(['b'], ['a', 'b', 'c'])).toEqual(['c']); // 窗口滑动后仍按内容对齐
    expect(WorkbenchManager.newLines(['x'], ['p', 'q'])).toEqual(['p', 'q']); // 轮转/清空 → 全量新增
    expect(WorkbenchManager.newLines(['a', 'a'], ['a', 'a', 'a'])).toEqual(['a']); // 重复行按追加处理
  });
  it('pollLog records pattern hits as events and extracts loss values', async () => {
    const base = ['epoch 1', 'errok: NaN loss=0.5', 'all good'];
    let polls = 0;
    const { m, events } = manager({
      handle: { 'tail -n 60': () => { polls += 1; const lines = polls === 1 ? base : [...base, 'error: boom', 'done loss=0.25']; return { stdout: lines.join('\n') + '\n', stderr: '', code: 0 }; } },
    });
    await m.request({ operation: 'logSave', serverId: 's1', name: 'train', path: '/a.log', patterns: ['^error', 'loss='], trackLoss: true });
    const first = await m.request({ operation: 'logPoll', serverId: 's1', id: m.data.logs[0].id });
    expect(first.lastHits).toEqual([]); // 首次 poll 只建基线
    expect(events).toHaveLength(0);
    expect(first.lossPoints).toEqual([]); // loss 也不从基线回溯
    const again = await m.request({ operation: 'logPoll', serverId: 's1', id: m.data.logs[0].id });
    expect(again.lastHits.map((h) => h.line)).toEqual(['error: boom', 'done loss=0.25']);
    expect(again.lossPoints).toEqual([0.25]);
    expect(events.filter((e) => e.type === 'log-hit')).toHaveLength(1);
    // 再 poll：无新行 → 不重复报警
    await m.request({ operation: 'logPoll', serverId: 's1', id: m.data.logs[0].id });
    expect(events.filter((e) => e.type === 'log-hit')).toHaveLength(1);
  });
  it('logDelete removes the watcher', async () => {
    const { m } = manager();
    const saved = await m.request({ operation: 'logSave', serverId: 's1', name: 'x', path: '/x.log', patterns: ['e'] });
    await m.request({ operation: 'logDelete', serverId: 's1', id: saved.id });
    expect(m.data.logs).toHaveLength(0);
  });
});

describe('environment comparison', () => {
  it('envCollect parses tagged probe output and caches per server', async () => {
    const probe = [
      '__SC_DRV__', '550.54.15', '',
      '__SC_CUDA__', 'release 12.4', '',
      '__SC_OS__', '5.15.0-91-generic', 'Ubuntu 22.04.4 LTS', '',
      '__SC_PY__', 'Python 3.10.12', '',
      '__SC_TORCH__', '2.4.0+cu124 12.4', '',
      '',
    ].join('\n');
    const { m } = manager({ handle: { '__SC_DRV__': { stdout: probe, stderr: '', code: 0 } } });
    const entry = await m.request({ operation: 'envCollect', serverId: 's1' });
    expect(entry.driver).toBe('550.54.15');
    expect(entry.cuda).toBe('12.4');
    expect(entry.kernel).toBe('5.15.0-91-generic');
    expect(entry.os).toBe('Ubuntu 22.04.4 LTS');
    expect(entry.python).toBe('3.10.12');
    expect(entry.torch).toBe('2.4.0+cu124 12.4');
    const list = await m.request({ operation: 'envList', serverId: 's1' });
    expect(list).toHaveLength(1);
    // 重新收集同一台服务器 → 覆盖缓存而不是追加
    await m.request({ operation: 'envCollect', serverId: 's1' });
    expect((await m.request({ operation: 'envList', serverId: 's1' }))).toHaveLength(1);
  });
  it('envCollect marks torch as not-installed when import fails', async () => {
    const probe = '__SC_DRV__\n1.0\n__SC_CUDA__\n__SC_OS__\nx\n__SC_PY__\nPython 3.10.12\n__SC_TORCH__\nnot-installed\n';
    const { m } = manager({ handle: { '__SC_DRV__': { stdout: probe, stderr: '', code: 0 } } });
    const entry = await m.request({ operation: 'envCollect', serverId: 's1' });
    expect(entry.torch).toBe('not-installed');
    expect(entry.cuda).toBe('');
  });
});

describe('occupied-idle alert rules', () => {
  const rule = { operation: 'ruleSave', serverId: 's1', name: 'idle hog', metric: 'occupiedIdle', direction: 'above', threshold: 10, recovery: 50, durationSeconds: 0, cooldownSeconds: 0 };
  it('fires when a GPU holds memory without utilization and names card + users', async () => {
    const { m, events } = manager();
    await m.request(rule);
    m.consumeSnapshot(snapshot());
    const hit = events.find((e) => e.type === 'rule-triggered');
    expect(hit).toBeDefined();
    expect(hit.body).toContain('GPU 0 (alice,bob)');
  });
  it('stays quiet while the card is actually working or nearly empty', async () => {
    const { m, events } = manager();
    await m.request(rule);
    m.consumeSnapshot(snapshot({ gpus: [gpu({ util: 90 })] }));
    m.consumeSnapshot(snapshot({ gpus: [gpu({ util: 2, memUsed: 2 * GiB })] }));
    expect(events.filter((e) => e.type === 'rule-triggered')).toHaveLength(0);
  });
  it('ruleSave still rejects unknown metrics', async () => {
    const { m } = manager();
    await expect(m.request({ ...rule, metric: 'weather' })).rejects.toThrow(/Invalid alert metric/);
  });
});

describe('usage report', () => {
  it('delegates to the usage query and clamps the range', async () => {
    const seen = [];
    const { m } = manager({ usageQuery: (days) => { seen.push(days); return [{ user: 'alice', totalMinutes: 90, byServer: { alpha: 90 } }] } });
    const rows = await m.request({ operation: 'usageReport', serverId: 's1', rangeDays: 30 });
    expect(rows[0].user).toBe('alice');
    await m.request({ operation: 'usageReport', serverId: 's1', rangeDays: 9999 });
    await m.request({ operation: 'usageReport', serverId: 's1', rangeDays: 0 });
    expect(seen).toEqual([30, 365, 1]);
  });
  it('throws a friendly error without a usage backend', async () => {
    const { m } = manager();
    await expect(m.request({ operation: 'usageReport', serverId: 's1' })).rejects.toThrow(/Usage accounting/);
  });
});
