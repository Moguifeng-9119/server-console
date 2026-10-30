import { describe, expect, it } from 'vitest';
import { TieredScheduler } from '../electron/monitoring/scheduler.cjs';
import { probeCapabilities } from '../electron/monitoring/capabilities.cjs';

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('Tiered multi-lane monitoring scheduler', () => {
  it('does not turn an expired probe into a permanent legacy fallback', async () => {
    const error = Object.assign(new Error('SSH command belongs to a replaced connection'), { staleConnection: true });
    await expect(probeCapabilities({ exec: async () => { throw error; } }, 'host')).rejects.toBe(error);
  });
  it('clears probe and legacy failures after a successful retry', async () => {
    const cfg = { id: 'host' }, connection = { status: 'online', exec: async () => ({ stdout: 'unrecognized' }), collect: async () => ({ gpus: [], processes: [], gpuProcessesAvailable: true }) };
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection });
    const state = scheduler.getState(cfg.id, connection); state.laneHealth.probe = { healthy: false }; state.laneHealth.legacy = { healthy: false };
    scheduler.tick(cfg.id); await settle(); expect(state.laneHealth.probe.healthy).toBe(true);
    scheduler.tick(cfg.id); await settle(); expect(state.laneHealth.legacy.healthy).toBe(true); scheduler.stop();
  });
  it('ignores an expired SSH command without marking the new connection unhealthy', async () => {
    const cfg = { id: 'host' }, connection = { status: 'online' }, statuses = [], errors = [];
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection, onStatus: (s) => statuses.push(s), onError: (e) => errors.push(e) });
    const state = scheduler.getState(cfg.id, connection);
    await scheduler.runLane(cfg, 'system', async () => { throw Object.assign(new Error('replaced'), { staleConnection: true }); }, state);
    expect(statuses).toEqual([]); expect(errors).toEqual([]); expect(state.laneHealth).toEqual({}); scheduler.stop();
  });
  it('keeps the host online and preserves a system failure while another lane succeeds', async () => {
    const cfg = { id: 'host' }, connection = { status: 'online' }, statuses = [], samples = [];
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection,
      onSnapshot: (value) => samples.push(value), onStatus: (value) => statuses.push(value), now: () => 100000 });
    const state = scheduler.getState(cfg.id, connection);
    state.laneTimestamps.system = 99000;
    await scheduler.runLane(cfg, 'system', async () => { throw new Error('system query failed'); }, state);
    expect(statuses[0]).toMatchObject({ status: 'online', lane: 'system' });
    scheduler.publish(cfg, state, 'gpu'); scheduler.publisher.flush(cfg.id);
    expect(samples.at(-1).monitoring.laneHealth.system.healthy).toBe(false);
    expect(samples.at(-1).laneTimestamps.system).toBe(99000);
    connection.status = 'offline'; const count = samples.length;
    scheduler.publish(cfg, state, 'gpu'); scheduler.publisher.flush(cfg.id);
    expect(samples).toHaveLength(count);
    scheduler.stop();
  });
  it('drops a buffered online sample when its connection closes or changes', () => {
    let now = 100000, connection = { status: 'online' }; const cfg = { id: 'host' }, samples = [];
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection, onSnapshot: (value) => samples.push(value), now: () => now });
    const state = scheduler.getState(cfg.id, connection);
    scheduler.publish(cfg, state, 'gpu'); now += 10; scheduler.publish(cfg, state, 'gpu');
    connection.status = 'offline'; scheduler.publisher.flush(cfg.id); expect(samples).toHaveLength(1);
    connection.status = 'online'; now += 100; scheduler.publish(cfg, state, 'gpu');
    now += 10; scheduler.publish(cfg, state, 'gpu'); connection = { status: 'online' }; scheduler.publisher.flush(cfg.id);
    expect(samples).toHaveLength(2); scheduler.stop();
  });
  it('drops a buffered sample across reconnects of the same connection object', () => {
    let now = 100000; const connection = { status: 'online', generation: 1 }, cfg = { id: 'host' }, samples = [];
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection, onSnapshot: (value) => samples.push(value), now: () => now });
    const state = scheduler.getState(cfg.id, connection);
    scheduler.publish(cfg, state, 'gpu'); now += 10; scheduler.publish(cfg, state, 'gpu');
    connection.status = 'offline'; connection.generation++; connection.status = 'online'; connection.generation++;
    scheduler.publisher.flush(cfg.id); expect(samples).toHaveLength(1); scheduler.stop();
  });
  it('invalidates cached GPU owners when process collection fails', async () => {
    const cfg = { id: 'host' }, connection = { status: 'online' }, statuses = [];
    const scheduler = new TieredScheduler({ configs: () => [cfg], getConnection: () => connection, onSnapshot: () => {}, onStatus: (value) => statuses.push(value), now: () => 100000 });
    const state = scheduler.getState(cfg.id, connection);
    state.gpuProcessesAvailable = true; state.laneTimestamps.processes = 99999;
    state.gpus = [{ index: 0, procs: [{ pid: 1, user: 'alice' }] }]; state.processes = [{ pid: 1, gpu: 0, gpuIndices: [0] }];
    await scheduler.runLane(cfg, 'processes', async () => { throw new Error('ps failed'); }, state);
    expect(statuses[0]).toMatchObject({ status: 'online', gpuProcessesAvailable: false });
    expect(state.gpus[0].procs).toEqual([]); expect(state.processes[0].gpu).toBeNull();
    scheduler.stop();
  });
  it('rejects an old configuration without asking the pool to reopen it', () => {
    const old = { id: 'host', host: 'old' }, updated = { id: 'host', host: 'new' };
    const calls = [], connection = { status: 'online' }; let current = old;
    const scheduler = new TieredScheduler({ configs: () => [current], getConnection: (cfg) => { calls.push(cfg.host); return connection; }, onSnapshot: () => {} });
    const state = scheduler.getState(old.id, connection); current = updated;
    expect(scheduler.valid(old, state)).toBe(false); expect(calls).toEqual([]);
    scheduler.stop();
  });
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
    const cfg = { id: 'srv-1' };
    const scheduler = new TieredScheduler({
      configs: () => [cfg],
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

    const cfg = { id: 'srv-reentrancy' };
    const scheduler = new TieredScheduler({
      configs: () => [cfg],
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
