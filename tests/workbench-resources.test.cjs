import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager, parseSystem } from '../electron/workbench.cjs';

const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const sample = ({ sectors = 100, network = 1000, busy = 200 } = {}) => `__SC_OS__
Linux
__SC_DF__
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda 1000 200 800 20% /
__SC_INODE__
Filesystem Inodes IUsed IFree IUse% Mounted on
/dev/sda 100 10 90 10% /
__SC_DISK__
8 0 sda 1 0 ${sectors} 0 1 0 ${sectors * 2} 0 0 ${busy} 0
__SC_NET__
eth0: ${network} 0 0 0 0 0 0 0 ${network * 2} 0 0 0 0 0 0 0
__SC_CAP__
docker
`;
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-resources-test-'));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 100000;
  const servers = [{ id: 's', host: 'first' }, { id: 'other', host: 'second' }];
  const connection = { exec: vi.fn(async () => ({ code: 0, stdout: sample() })) };
  const onResource = vi.fn();
  const manager = new WorkbenchManager({ directory, getConnection: async () => connection, getServers: () => servers, onResource, now: () => now, ...options });
  cleanups.push(() => manager.close());
  return { manager, connection, onResource, servers, advance: (ms) => { now += ms; } };
}

describe('shared resource observations', () => {
  it('keeps initial/reset counters unknown and derives rates only from valid intervals', () => {
    const first = parseSystem(sample(), null, 1000);
    expect(first.disks[0].readBytesPerSecond).toBeNull(); expect(first.networks[0].receiveBytesPerSecond).toBeNull();
    const second = parseSystem(sample({ sectors: 120, network: 3000, busy: 300 }), first, 3000);
    expect(second.disks[0].readBytesPerSecond).toBe(5120); expect(second.disks[0].writeBytesPerSecond).toBe(10240);
    expect(second.disks[0].busyPercent).toBe(5); expect(second.networks[0].receiveBytesPerSecond).toBe(1000);
    expect(second.filesystems[0].total).toBe(1024000); expect(second.inodes[0].percent).toBe(10);
    const reset = parseSystem(sample({ sectors: 1, network: 1, busy: 1 }), second, 4000);
    expect(reset.disks[0].readBytesPerSecond).toBeNull(); expect(reset.disks[0].busyPercent).toBeNull(); expect(reset.networks[0].receiveBytesPerSecond).toBeNull();
    const stale = parseSystem(sample({ sectors: 1000, busy: 1000 }), first, 200000);
    expect(stale.disks[0].readBytesPerSecond).toBeNull(); expect(stale.disks[0].busyPercent).toBeNull();
  });

  it('shares one in-flight command and fires the history callback once for a fresh sample', async () => {
    const f = fixture(); let release;
    f.connection.exec.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const one = f.manager.observeResources('s'), two = f.manager.request({ operation: 'system', serverId: 's' });
    await Promise.resolve(); expect(f.connection.exec).toHaveBeenCalledTimes(1);
    release({ code: 0, stdout: sample() }); const [a, b] = await Promise.all([one, two]);
    expect(a).toBe(b); expect(f.onResource).toHaveBeenCalledTimes(1);
    expect(await f.manager.observeResources('s', { maxAgeMs: 5000 })).toBe(a); expect(f.connection.exec).toHaveBeenCalledTimes(1);
    f.advance(5000); await f.manager.observeResources('s', { maxAgeMs: 5000 });
    expect(f.connection.exec).toHaveBeenCalledTimes(2); expect(f.onResource).toHaveBeenCalledTimes(2);
  });

  it('reports command errors and retries at most once per five seconds', async () => {
    const f = fixture(); f.connection.exec.mockRejectedValueOnce(new Error('remote failure'));
    await expect(f.manager.observeResources('s')).rejects.toThrow('remote failure');
    f.advance(4000); await expect(f.manager.observeResources('s')).rejects.toThrow('remote failure');
    expect(f.connection.exec).toHaveBeenCalledTimes(1); expect(f.onResource).not.toHaveBeenCalled();
    f.advance(1000); await f.manager.observeResources('s'); expect(f.connection.exec).toHaveBeenCalledTimes(2);
  });

  it('drops late results after close instead of creating history observations', async () => {
    const f = fixture(); let release;
    f.connection.exec.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = f.manager.observeResources('s'); await Promise.resolve(); f.manager.close();
    const rejected = expect(pending).rejects.toThrow('closed'); release({ code: 0, stdout: sample() }); await rejected;
    expect(f.onResource).not.toHaveBeenCalled(); expect(f.manager.previous.size).toBe(0);
  });

  it('resets rate baselines when the configured resource source changes', async () => {
    const f = fixture(); await f.manager.observeResources('s'); f.advance(1000); f.servers[0].host = 'replacement';
    const value = await f.manager.observeResources('s', { maxAgeMs: 5000 });
    expect(f.connection.exec).toHaveBeenCalledTimes(2); expect(value.disks[0].readBytesPerSecond).toBeNull();
  });

  it('bounds concurrent commands across hosts', async () => {
    const f = fixture({ resourceConcurrency: 1 }); let release;
    f.connection.exec.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = f.manager.observeResources('s'), second = f.manager.observeResources('other');
    await Promise.resolve(); expect(f.connection.exec).toHaveBeenCalledTimes(1);
    release({ code: 0, stdout: sample() }); await Promise.all([first, second]);
    expect(f.connection.exec).toHaveBeenCalledTimes(2); expect(f.onResource).toHaveBeenCalledTimes(2);
  });
});
