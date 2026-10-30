import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager, parseSystem } from '../electron/workbench.cjs';
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture(exec = async () => ({ code: 0, stdout: '' })) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-workbench-test-')); directories.push(directory);
  const events = [], manager = new WorkbenchManager({ directory, getServers: () => [{ id: 'a' }, { id: 'b' }], getConnection: () => ({ exec }), onEvent: (event) => events.push(event) }).init();
  return { manager, events, directory };
}
const snap = (at, memUsed, extra = {}) => ({ id: 'a', status: 'online', collectedAt: at, lastLane: 'gpu', gpus: [{ index: 0, uuid: 'gpu-a', name: 'Test', memTotal: 81920, memUsed, util: 50, temp: 50, ...extra }] });
describe('workbench tasks and resource reminders', () => {
  it('persists cards without starting a remote command', async () => {
    let calls = 0; const { manager, directory } = fixture(async () => { calls++; return { code: 0, stdout: '' }; });
    const task = await manager.request({ operation: 'taskSave', serverId: 'a', name: 'Test', cwd: '/work', command: 'exec python train.py' });
    expect(calls).toBe(0); expect(task.status).toBe('saved');
    const reloaded = new WorkbenchManager({ directory, getServers: () => [{ id: 'a' }], getConnection: () => ({}) }).init();
    expect((await reloaded.request({ operation: 'taskList', serverId: 'a' }))[0].command).toBe(task.command);
  });
  it('does not claim startup succeeded when tmux/remote launch fails', async () => {
    const { manager } = fixture(async () => ({ code: 1, stderr: 'tmux failed' }));
    const task = await manager.request({ operation: 'taskSave', serverId: 'a', command: 'echo test' });
    await expect(manager.request({ operation: 'taskStart', serverId: 'a', id: task.id })).rejects.toThrow('tmux failed');
    expect(manager.data.tasks[0].status).toBe('unknown');
  });
  it('captures exec-command completion through a surviving parent wrapper and reports exit codes once', async () => {
    let launch = ''; let status = '7'; const { manager, events } = fixture(async (command) => { if (command.includes('mkdir -p')) { launch = command; return { code: 0, stdout: 'nohup\n' }; } return { code: 0, stdout: status }; });
    const task = await manager.request({ operation: 'taskSave', serverId: 'a', command: 'exec python train.py' });
    await manager.request({ operation: 'taskStart', serverId: 'a', id: task.id }); expect(launch).toContain('runner.start'); expect(launch).toContain('sh -c');
    expect((await manager.request({ operation: 'taskStatus', serverId: 'a', id: task.id })).status).toBe('failed');
    await manager.request({ operation: 'taskStatus', serverId: 'a', id: task.id }); expect(events).toHaveLength(1);
    status = '__UNKNOWN__'; expect(await manager.request({ operation: 'taskStatus', serverId: 'a', id: task.id })).toMatchObject({ status: 'failed', exitCode: 7 });
  });
  it('rejects task actions under another server scope', async () => {
    const { manager } = fixture(); const task = await manager.request({ operation: 'taskSave', serverId: 'a', command: 'true' });
    await expect(manager.request({ operation: 'taskStart', serverId: 'b', id: task.id })).rejects.toThrow('another server');
  });
  it('requires sustained valid memory from the same GPU and fires only once', async () => {
    const { manager, events } = fixture(); await manager.request({ operation: 'watchSave', serverId: 'a', minFreeGiB: 40, durationSeconds: 2 });
    manager.consumeSnapshot(snap(10000, null)); manager.consumeSnapshot(snap(12000, 0, { unavailableMetrics: ['memUsed'] })); expect(events).toHaveLength(0);
    manager.consumeSnapshot(snap(13000, 1000)); manager.consumeSnapshot(snap(14000, 1000)); expect(events).toHaveLength(0);
    manager.consumeSnapshot(snap(15000, 1000)); manager.consumeSnapshot(snap(18000, 1000)); expect(events).toHaveLength(1); expect(events[0].type).toBe('gpu-available');
  });
  it('does not satisfy GPU reminders by replaying system-lane cached values', async () => {
    const { manager, events } = fixture(); await manager.request({ operation: 'watchSave', serverId: 'a', minFreeGiB: 40, durationSeconds: 2 });
    manager.consumeSnapshot(snap(10000, 1000)); manager.consumeSnapshot({ ...snap(13000, 1000), lastLane: 'system' }); expect(events).toHaveLength(0);
  });
  it('uses persistent duration and hysteresis for alert recovery', async () => {
    const { manager, events } = fixture(); await manager.request({ operation: 'ruleSave', serverId: 'a', name: 'Hot', metric: 'temperature', threshold: 85, recovery: 75, durationSeconds: 2, cooldownSeconds: 0 });
    manager.consumeSnapshot(snap(10000, 1000, { temp: 90 })); manager.consumeSnapshot(snap(12000, 1000, { temp: 90 }));
    manager.consumeSnapshot(snap(13000, 1000, { temp: 80 })); expect(events).toHaveLength(1);
    manager.consumeSnapshot(snap(14000, 1000, { temp: 74 })); expect(events.map((e) => e.type)).toEqual(['rule-triggered', 'rule-recovered']);
  });
  it('quotes template parameter values and rejects missing parameters', async () => {
    const { manager } = fixture(); const template = await manager.request({ operation: 'templateSave', name: 'Train', command: 'python train.py --data {{dataset}}' });
    expect((await manager.request({ operation: 'templateRender', id: template.id, parameters: { dataset: '/data/a; echo bad' } })).command).toContain("'/data/a; echo bad'");
    await expect(manager.request({ operation: 'templateRender', id: template.id, parameters: {} })).rejects.toThrow('Missing parameter');
  });
  it('uses actual utilization metric names and recorded coverage in weekly reports', async () => {
    const { manager } = fixture(); const calls = [];
    manager.historyQuery = async (query) => { calls.push(query); return { start: 1000, end: 3000, devices: [{ device: 'gpu:a', metric: 'util', label: 'GPU A' }], points: [{ value: 50, max: 95, coveredMs: 1000 }] }; };
    const report = await manager.request({ operation: 'report', serverId: 'a' }); expect(calls.every((query) => query.metric === 'util')).toBe(true); expect(report.devices[0]).toMatchObject({ average: 50, peak: 95, coveragePercent: 50 });
  });
  it('reports unknown first-sample rates and counter resets instead of zero traffic', () => {
    const output = '__SC_OS__\nLinux\n__SC_DF__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/a 1000 400 600 40% /data\n__SC_DISK__\n8 0 sda 1 0 100 0 1 0 200 0 0 100 0\n__SC_NET__\neth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n';
    const first = parseSystem(output, null, 1000); const second = parseSystem(output.replace('eth0: 1000', 'eth0: 3000'), first, 3000);
    expect(first.networks[0].receiveBytesPerSecond).toBeNull(); expect(second.networks[0].receiveBytesPerSecond).toBe(1000); expect(first.filesystems[0].available).toBe(600 * 1024);
    expect(parseSystem(output, second, 4000).networks[0].receiveBytesPerSecond).toBeNull();
  });
});
