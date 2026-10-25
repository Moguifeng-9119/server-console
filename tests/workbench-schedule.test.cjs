import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager, windowState, parseClock, normalizeSchedule } from '../electron/workbench.cjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sched-'));
const mins = (h, m = 0) => h * 60 + m;
const schedule = (over = {}) => ({ start: '00:00', end: '06:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, ...over });

// 连接 stub：exec 返回 {stdout, stderr, code}（与 ssh.cjs exec 的真实返回形态一致）
// clock 控制服务器时间；handle 允许按命令子串定制返回
function manager({ clock = '2026-10-12 02:00', handle = {} } = {}) {
  const commands = [];
  const m = new WorkbenchManager({
    directory: dir(),
    getConnection: async () => ({
      exec: async (cmd) => {
        commands.push(cmd);
        for (const [pattern, value] of Object.entries(handle)) if (cmd.includes(pattern)) return value;
        if (cmd.includes("date '+%F %H:%M'")) return { stdout: clock + '\n', stderr: '', code: 0 };
        return { stdout: 'tmux\n', stderr: '', code: 0 };
      },
    }),
    getServers: () => [{ id: 's1' }],
    notify: () => {},
    onEvent: () => {},
  });
  m.init();
  return { m, commands, setClock: (c) => { clock = c; } };
}
const live = (m) => m.data.tasks[0];

describe('windowState', () => {
  it('normal window contains start, excludes end', () => {
    expect(windowState(schedule(), '2026-10-12', mins(0)).inside).toBe(true);
    expect(windowState(schedule(), '2026-10-12', mins(5, 59)).inside).toBe(true);
    expect(windowState(schedule(), '2026-10-12', mins(6)).inside).toBe(false);
    expect(windowState(schedule(), '2026-10-12', mins(23)).inside).toBe(false);
  });
  it('overnight window wraps and occurrenceKey belongs to the start day', () => {
    const night = schedule({ start: '22:00', end: '06:00' });
    // 2026-10-12 是周一；凌晨 2 点属于前一天（10-11 周日）开始的窗口
    expect(windowState(night, '2026-10-12', mins(2))).toEqual({ inside: true, occurrenceKey: '2026-10-11' });
    expect(windowState(night, '2026-10-12', mins(23))).toEqual({ inside: true, occurrenceKey: '2026-10-12' });
    expect(windowState(night, '2026-10-12', mins(12)).inside).toBe(false);
  });
  it('day filter applies to the occurrence day', () => {
    // 2026-10-12 周一；只在周日生效 → 周一不触发
    expect(windowState(schedule({ days: [0] }), '2026-10-12', mins(1)).inside).toBe(false);
    // 跨夜窗口的 occurrence 是 10-11（周日）→ 生效
    expect(windowState(schedule({ start: '22:00', end: '06:00', days: [0] }), '2026-10-12', mins(2)).inside).toBe(true);
  });
});

describe('parseClock / normalizeSchedule', () => {
  it('parses server date output', () => {
    expect(parseClock('2026-10-12 02:34\n')).toEqual({ date: '2026-10-12', minutes: 154 });
  });
  it('rejects malformed clock output', () => {
    expect(() => parseClock('garbage')).toThrow();
  });
  it('validates and normalizes schedule input', () => {
    const s = normalizeSchedule({ start: '00:00', end: '06:00', days: [1, 1, 3], enabled: true });
    expect(s).toEqual({ start: '00:00', end: '06:00', days: [1, 3], enabled: true });
    expect(() => normalizeSchedule({ start: '0:00', end: '06:00' })).toThrow();
    expect(() => normalizeSchedule({ start: '06:00', end: '06:00' })).toThrow();
  });
  it('keeps lastOccurrence when the window is unchanged, resets when changed', () => {
    const prev = { start: '00:00', end: '06:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, lastOccurrence: '2026-10-11', lastStartAt: 1 };
    expect(normalizeSchedule({ start: '00:00', end: '06:00', enabled: true }, prev).lastOccurrence).toBe('2026-10-11');
    expect(normalizeSchedule({ start: '01:00', end: '06:00', enabled: true }, prev).lastOccurrence).toBeUndefined();
  });
  it('empty days array normalizes to every day', () => {
    expect(normalizeSchedule({ start: '00:00', end: '06:00', days: [] }).days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('tickSchedules behavior', () => {
  it('starts inside the window once per occurrence and kills outside it', async () => {
    const { m, commands, setClock } = manager();
    m.upsert('tasks', { serverId: 's1', name: 'night', cwd: '~', command: 'echo hi', status: 'saved', schedule: schedule() });

    await m.tickSchedules();
    expect(live(m).status).toBe('starting');
    expect(live(m).schedule.lastOccurrence).toBe('2026-10-12');
    expect(commands.some((c) => c.includes('tmux new-session'))).toBe(true);

    // 窗口内第二次 tick：不重复启动
    const launches = commands.filter((c) => c.includes('tmux new-session')).length;
    await m.tickSchedules();
    expect(commands.filter((c) => c.includes('tmux new-session')).length).toBe(launches);

    // 窗口外：到点终止（tmux kill-session）。服务器时钟有 10s 缓存，用推后的 now 越过缓存（对应生产 15s tick）
    setClock('2026-10-12 08:00');
    await m.tickSchedules(Date.now() + 30000);
    expect(live(m).status).toBe('stopped');
    expect(commands.some((c) => c.includes('tmux kill-session'))).toBe(true);
    m.close();
  });

  it('disabled schedule never fires and costs no clock queries', async () => {
    const { m, commands } = manager();
    m.upsert('tasks', { serverId: 's1', name: 'off', cwd: '~', command: 'x', status: 'saved', schedule: schedule({ enabled: false }) });
    await m.tickSchedules();
    expect(commands.length).toBe(0);
    m.close();
  });

  it('server clock failure skips the tick without changing state', async () => {
    const { m } = manager({ handle: { "date '+%F %H:%M'": { stdout: 'garbage', stderr: '', code: 0 } } });
    m.upsert('tasks', { serverId: 's1', name: 't', cwd: '~', command: 'x', status: 'saved', schedule: schedule() });
    await m.tickSchedules();
    expect(live(m).status).toBe('saved');
    expect(live(m).schedule.lastOccurrence).toBeUndefined();
    m.close();
  });

  it('taskStop kills a live task and marks it stopped', async () => {
    const { m, commands } = manager();
    m.upsert('tasks', { serverId: 's1', name: 't', cwd: '~', command: 'x', status: 'saved' });
    const task = live(m);
    task.remoteId = 'rid-1'; task.mode = 'tmux'; task.sessionName = 'sc-rid-1'; task.status = 'running';
    const stopped = await m.request({ operation: 'taskStop', serverId: 's1', id: task.id });
    expect(stopped.status).toBe('stopped');
    expect(commands.some((c) => c.includes("tmux kill-session -t 'sc-rid-1'"))).toBe(true);
    m.close();
  });

  it('taskSave accepts a schedule and preserves occurrence on identical re-save', async () => {
    const { m } = manager();
    const saved = await m.request({ operation: 'taskSave', serverId: 's1', name: 'n', cwd: '~', command: 'x', schedule: { start: '00:00', end: '06:00', days: [1, 2], enabled: true } });
    expect(saved.schedule).toEqual({ start: '00:00', end: '06:00', days: [1, 2], enabled: true });
    live(m).schedule.lastOccurrence = '2026-10-11';
    const resaved = await m.request({ operation: 'taskSave', serverId: 's1', id: saved.id, name: 'n2', cwd: '~', command: 'x', schedule: { start: '00:00', end: '06:00', days: [1, 2], enabled: true } });
    expect(resaved.schedule.lastOccurrence).toBe('2026-10-11');
    await expect(m.request({ operation: 'taskSave', serverId: 's1', id: saved.id, name: 'n', cwd: '~', command: 'x', schedule: { start: '25:00', end: '06:00' } })).rejects.toThrow();
    m.close();
  });
});
