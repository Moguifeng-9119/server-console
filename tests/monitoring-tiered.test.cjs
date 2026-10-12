import { describe, expect, it } from 'vitest';
import { TieredScheduler } from '../electron/monitoring/scheduler.cjs';

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('Tiered multi-lane monitoring scheduler', () => {
  it('slow process lane does not block rapid GPU ticks', async () => {
    let now = 1000;
    let releaseProcesses;
    const completedLanes = [];

    // Mock connection with capabilities probed
    const mockConn = {
      isBackedOff: () => false,
      exec: async (cmd) => {
        if (cmd.includes('nvidia-smi >/dev/null')) {
          return { stdout: 'SMI:1\nPY3:1\n' };
        }
        if (cmd.includes('query-gpu=')) {
          completedLanes.push('gpu');
          return {
            stdout: '0, GPU-UUID-1, NVIDIA GeForce RTX 3090, 45, 4000, 24000, 55, 180, 40\n',
          };
        }
        if (cmd.includes('/proc/loadavg')) {
          completedLanes.push('system');
          return {
            stdout: '0.5 0.6 0.7\n16\nMem: 64000000000 16000000000\nSwap: 0 0\n__CPU__\ncpu 1000 100 500 5000\n',
          };
        }
        if (cmd.includes('query-compute-apps=')) {
          completedLanes.push('processes-start');
          await new Promise((r) => {
            releaseProcesses = r;
          });
          completedLanes.push('processes-done');
          return {
            stdout: 'GPU-UUID-1, 1234, 2000\n__PS__\n1234 user 15.0 5.0 2048000 S 01:00 /usr/bin/python3 main.py\n',
          };
        }
        return { stdout: '' };
      },
    };

    const snapshots = [];
    const scheduler = new TieredScheduler({
      configs: () => [{ id: 'srv-1' }],
      getConnection: () => mockConn,
      onSnapshot: (snap) => snapshots.push(snap.lastLane),
      interval: () => 200,
      now: () => now,
    });

    scheduler.focus('srv-1');

    // First tick: probes capabilities
    scheduler.tick();
    await settle();

    // Now capabilities probed, tick again for initial lanes
    now += 200;
    scheduler.tick();
    await settle();

    // GPU and system and processes started
    expect(completedLanes).toContain('gpu');
    expect(completedLanes).toContain('system');
    expect(completedLanes).toContain('processes-start');
    expect(completedLanes).not.toContain('processes-done');

    // Advance 200ms: GPU should tick AGAIN even though processes is still hanging!
    now += 200;
    scheduler.tick();
    await settle();

    const gpuCount = completedLanes.filter((x) => x === 'gpu').length;
    expect(gpuCount).toBeGreaterThanOrEqual(2);

    // Advance another 200ms: GPU ticks a 3rd time!
    now += 200;
    scheduler.tick();
    await settle();

    expect(completedLanes.filter((x) => x === 'gpu').length).toBeGreaterThanOrEqual(3);

    // Finally release the hanging process collector
    releaseProcesses();
    await settle();
    expect(completedLanes).toContain('processes-done');

    scheduler.stop();
  });

  it('respects non-reentrancy on the same lane', async () => {
    let now = 1000;
    let releaseGpu;
    let gpuExecCount = 0;

    const mockConn = {
      isBackedOff: () => false,
      exec: async (cmd) => {
        if (cmd.includes('nvidia-smi >/dev/null')) return { stdout: 'SMI:1\n' };
        if (cmd.includes('query-gpu=')) {
          gpuExecCount++;
          await new Promise((r) => {
            releaseGpu = r;
          });
          return { stdout: '0, GPU-1, RTX 4090, 10, 1000, 24000, 40, 100, 30\n' };
        }
        return { stdout: '' };
      },
    };

    const scheduler = new TieredScheduler({
      configs: () => [{ id: 'srv-reentrancy' }],
      getConnection: () => mockConn,
      onSnapshot: () => {},
      interval: () => 200,
      now: () => now,
    });

    scheduler.focus('srv-reentrancy');
    scheduler.tick(); // probe
    await settle();

    scheduler.tick(); // launches gpu lane
    await settle();
    expect(gpuExecCount).toBe(1);

    // Advance time while previous GPU exec is still unresolved
    now += 500;
    scheduler.tick();
    await settle();
    // gpuExecCount must NOT increase because the lane is still in-flight
    expect(gpuExecCount).toBe(1);

    // Once resolved, next tick can run
    releaseGpu();
    await settle();
    now += 500;
    scheduler.tick();
    await settle();
    expect(gpuExecCount).toBe(2);

    releaseGpu();
    await settle();
    scheduler.stop();
  });
});
