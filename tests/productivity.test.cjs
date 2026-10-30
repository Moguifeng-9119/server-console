import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductivityManager, redact } from '../electron/productivity.cjs';

const directories = [];
function manager(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-productivity-')); directories.push(directory);
  const servers = [{ id: 's1', name: 'GPU', host: 'gpu.example', port: 22, username: 'student', password: 'private-pass', authType: 'key', keyPath: 'C:/keys/id_key', privateKey: 'PRIVATE KEY CONTENT' }];
  const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
  const getConnection = vi.fn(() => ({ exec, sftp: async () => ({}) }));
  const instance = new ProductivityManager({ directory, getServers: () => servers, getConnection, ...options }).init();
  return { instance, directory, servers, exec, getConnection };
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('persisted experiment workspaces', () => {
  it('saves contexts without connecting or launching commands', async () => {
    const { instance, getConnection, directory } = manager();
    const value = await instance.request({ operation: 'workspaceSave', workspace: { serverId: 's1', name: 'Run A', cwd: '/work/run', gpu: '0,1', sessionName: 'training', logPath: '/work/run/log.txt', remotePort: 8888 } });
    expect(value).toMatchObject({ serverId: 's1', cwd: '/work/run', remotePort: 8888 });
    expect(getConnection).not.toHaveBeenCalled();
    const reloaded = new ProductivityManager({ directory, getConnection, getServers: () => [{ id: 's1' }] }).init();
    expect(await reloaded.request({ operation: 'workspaceList' })).toHaveLength(1);
    await reloaded.request({ operation: 'workspaceDelete', id: value.id });
    expect(await reloaded.request({ operation: 'workspaceList' })).toEqual([]);
  });
  it('rejects missing servers, relative paths, and invalid ports', () => {
    const { instance } = manager();
    expect(() => instance.workspaceSave({ serverId: 's2', name: 'x', cwd: '/x' })).toThrow(/server/);
    expect(() => instance.workspaceSave({ serverId: 's1', name: 'x', cwd: '../x' })).toThrow(/absolute/);
    expect(() => instance.workspaceSave({ serverId: 's1', name: 'x', cwd: '/x', localPort: 99999 })).toThrow(/port/);
  });
});

describe('read-only remote tools', () => {
  it('returns capability-based diagnostics without writes', async () => {
    const { instance, exec } = manager(); exec.mockResolvedValue({ code: 0, stdout: 'ssh=ok\nrsync=available\ntmux=unavailable\nprocfs=available\n', stderr: '' });
    expect(await instance.diagnostics('s1')).toMatchObject({ writesPerformed: false, checks: { ssh: 'ok', rsync: 'available', tmux: 'unavailable', sftp: 'available' } });
    expect(exec.mock.calls[0][0]).not.toMatch(/mkdir|touch|rm /);
  });
  it('reports unavailable Slurm and parses supported jobs', async () => {
    const { instance, exec } = manager(); exec.mockResolvedValueOnce({ code: 0, stdout: '__SC_UNAVAILABLE__', stderr: '' });
    expect(await instance.slurmJobs('s1')).toEqual({ available: false, jobs: [] });
    exec.mockResolvedValueOnce({ code: 0, stdout: '123_4|train|student|RUNNING|1:00|1:00:00|1|gpu-node\n', stderr: '' });
    expect((await instance.slurmJobs('s1')).jobs[0]).toMatchObject({ id: '123_4', state: 'RUNNING' });
  });
  it('rejects injected job IDs and reads the scheduler-declared log path', async () => {
    const { instance, exec } = manager();
    await expect(instance.slurmDetail('s1', '1; rm -rf /')).rejects.toThrow(/ID/);
    expect(exec).not.toHaveBeenCalled();
    exec.mockResolvedValueOnce({ code: 0, stdout: 'JobId=12 JobName=train StdOut=/work/a b/output.log StdErr=/work/a b/error.log', stderr: '' });
    exec.mockResolvedValueOnce({ code: 0, stdout: 'step 10 loss 0.2', stderr: '' });
    expect(await instance.slurmLog('s1', '12')).toMatchObject({ path: '/work/a b/output.log', text: 'step 10 loss 0.2' });
    expect(exec.mock.calls[1][0]).toBe("tail -c 131072 -- '/work/a b/output.log'");
  });
  it('does not present failed remote commands as successful results', async () => {
    const { instance, exec } = manager(); exec.mockResolvedValue({ code: 1, stdout: '', stderr: 'permission denied token=superprivate' });
    await expect(instance.slurmJobs('s1')).rejects.toThrow('permission denied token=[REDACTED]');
  });
});

describe('credential-free configuration migration', () => {
  it('persists successful import receipts and makes an operation ID idempotent', async () => {
    const onImport = vi.fn(), importState = vi.fn(async () => {}), { instance, directory } = manager({ onImport, importState });
    const request = { operation: 'backupImport', apply: true, backup: instance.backupExport(), operationId: 'import-one' };
    await instance.request(request); await instance.request(request);
    expect(importState).toHaveBeenCalledOnce(); expect(onImport).toHaveBeenCalledOnce();
    const restored = new ProductivityManager({ directory }).init();
    expect(await restored.request({ operation: 'backupResults' })).toEqual([expect.objectContaining({ operationId: 'import-one', status: 'committed', applied: true })]);
  });
  it('retains a failed import result without publishing a success', async () => {
    const onImport = vi.fn(), { instance } = manager({ onImport, importState: async () => { throw new Error('test failure'); } });
    await expect(instance.request({ operation: 'backupImport', apply: true, backup: instance.backupExport(), operationId: 'import-bad' })).rejects.toThrow('test failure');
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(await instance.request({ operation: 'backupResults' })).toEqual([expect.objectContaining({ status: 'failed', error: 'test failure' })]);
  });
  it('omits credentials and redacts command assignments', () => {
    const { instance } = manager({ exportState: () => ({ templates: [{ id: 't1', command: 'TOKEN=abc python run.py', apiKey: 'abcd' }], password: 'secret', preferences: { layout: 'columns' } }) });
    const backup = instance.backupExport(), serialized = JSON.stringify(backup);
    expect(backup.servers[0].keyPath).toBe('C:/keys/id_key');
    expect(serialized).not.toMatch(/private-pass|PRIVATE KEY CONTENT|"apiKey"|TOKEN=abc/);
    expect(backup.state.templates[0].command).toContain('[REDACTED]');
  });
  it('previews imports and disables imported schedules/rules before explicit apply', async () => {
    const importState = vi.fn(async () => {}), { instance, directory } = manager({ importState });
    const backup = instance.backupExport(); backup.state = { rules: [{ id: 'r1', enabled: true, schedule: { enabled: true } }] };
    expect(await instance.backupImport(backup)).toMatchObject({ applied: false, servers: 1 });
    expect(importState).not.toHaveBeenCalled();
    expect(await instance.backupImport(backup, true)).toMatchObject({ applied: true, recoveryAvailable: true });
    expect(importState.mock.calls[0][0].rules[0]).toMatchObject({ enabled: false });
    expect(importState.mock.calls[0][0].rules[0].schedule).toBeUndefined();
    expect(fs.existsSync(path.join(directory, 'configuration-before-import.json'))).toBe(true);
  });
  it('rejects unsafe hosts before calling the import hook', async () => {
    const importState = vi.fn(), { instance } = manager({ importState }), backup = instance.backupExport();
    backup.servers[0].host = '-o ProxyCommand=evil';
    await expect(instance.backupImport(backup, true)).rejects.toThrow(/host/);
    expect(importState).not.toHaveBeenCalled();
  });
  it('retains independently named workspaces on merge', async () => {
    const { instance } = manager(); instance.workspaceSave({ id: 'a', serverId: 's1', name: 'A', cwd: '/a' });
    const backup = instance.backupExport(); backup.workspaces = [{ id: 'b', serverId: 's1', name: 'B', cwd: '/b' }];
    await instance.backupImport(backup, true);
    expect(instance.data.workspaces.map((item) => item.id)).toEqual(['a', 'b']);
  });
  it('strips nested secret fields and private key payloads', () => {
    expect(redact({ nested: { authorization: 'Bearer hi', api_key: 'secret', safe: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' } })).toEqual({ nested: { safe: '[REDACTED]' } });
  });
});

describe('explicit optional webhook notifications', () => {
  it('makes no requests until enabled, bounds rate, and hides the secret URL', async () => {
    let now = 100000; const deliver = vi.fn(async () => ({ delivered: true }));
    const { instance } = manager({ deliver, now: () => now });
    const event = { serverId: 's1', type: 'rule-triggered', title: 'Hot', body: 'token=secret' };
    expect(await instance.dispatchEvent(event)).toMatchObject({ delivered: false }); expect(deliver).not.toHaveBeenCalled();
    instance.notificationSave({ enabled: true, url: 'https://notify.example/hook?token=private', cooldownMs: 10000 });
    expect(JSON.stringify(instance.notificationGet())).not.toContain('private');
    expect(await instance.dispatchEvent(event)).toEqual({ delivered: true });
    expect(deliver.mock.calls[0][1].event.body).toBe('token=[REDACTED]');
    expect(await instance.dispatchEvent(event)).toMatchObject({ reason: 'cooldown' });
    now += 10001; await instance.dispatchEvent(event); expect(deliver).toHaveBeenCalledTimes(2);
  });
  it('rejects insecure or credential-bearing webhook URLs', () => {
    const { instance } = manager();
    expect(() => instance.notificationSave({ enabled: true, url: 'http://localhost/hook' })).toThrow(/HTTPS/);
    expect(() => instance.notificationSave({ enabled: true, url: 'https://user:pass@example.org/hook' })).toThrow(/credentials/);
  });
});

describe('configuration persistence transactions', () => {
  it('does not mutate saved workspace memory when save or delete persistence fails', async () => {
    const {instance,directory} = manager();instance.workspaceSave({id:'a',serverId:'s1',name:'A',cwd:'/a'});
    const before=JSON.stringify(instance.data), disk=fs.readFileSync(instance.file,'utf8');fs.mkdirSync(path.join(directory,'productivity.json.tmp'));
    expect(()=>instance.workspaceSave({id:'a',serverId:'s1',name:'Changed',cwd:'/changed'})).toThrow();
    await expect(instance.request({operation:'workspaceDelete',id:'a'})).rejects.toThrow();
    expect(JSON.stringify(instance.data)).toBe(before);expect(fs.readFileSync(instance.file,'utf8')).toBe(disk);
  });
  it('does not enable a webhook or change its URL when persistence fails', async () => {
    const deliver=vi.fn(async()=>({delivered:true}));const {instance,directory}=manager({deliver});
    fs.mkdirSync(path.join(directory,'productivity.json.tmp'));
    expect(()=>instance.notificationSave({enabled:true,url:'https://notify.example/private'})).toThrow();
    expect(instance.notificationGet()).toMatchObject({enabled:false,configured:false});
    expect(await instance.dispatchEvent({type:'rule-triggered'})).toMatchObject({reason:'disabled'});expect(deliver).not.toHaveBeenCalled();
  });
  it('rolls external import state back automatically if productivity commit fails', async () => {
    let external='original';const rollback=vi.fn(async()=>{external='original';});
    const {instance,directory}=manager({importState:async()=>{external='imported';return rollback;}});
    instance.workspaceSave({id:'a',serverId:'s1',name:'A',cwd:'/a'});const before=JSON.stringify(instance.data),backup=instance.backupExport();
    backup.workspaces=[{id:'b',serverId:'s1',name:'B',cwd:'/b'}];fs.mkdirSync(path.join(directory,'productivity.json.tmp'));
    await expect(instance.backupImport(backup,true)).rejects.toThrow();
    expect(external).toBe('original');expect(rollback).toHaveBeenCalledOnce();expect(JSON.stringify(instance.data)).toBe(before);expect(instance.importing).toBe(false);
  });
  it('blocks concurrent writes while import state is pending', async () => {
    let release;const pending=new Promise((resolve)=>{release=resolve;});const {instance}=manager({importState:async()=>{await pending;return()=>{};}});
    const applied=instance.backupImport(instance.backupExport(),true);
    expect(()=>instance.notificationSave({enabled:false})).toThrow(/in progress/);release();await applied;
  });
});
