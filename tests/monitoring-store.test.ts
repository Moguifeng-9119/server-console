import { describe, expect, it, beforeEach } from 'vitest';
import { TelemetryStore } from '../src/telemetry/store';
import type { SnapshotPayload } from '../src/types';

describe('TelemetryStore isolation and subscriptions', () => {
  let store: TelemetryStore;

  beforeEach(() => {
    store = new TelemetryStore();
  });

  it('provides empty telemetry default for unseen server', () => {
    const s = store.getServer('server-1');
    expect(s.serverId).toBe('server-1');
    expect(s.status).toBe('offline');
    expect(s.gpus).toEqual([]);
    expect(s.processes).toEqual([]);
  });

  it('notifies only the affected server subscriber upon snapshot ingestion', () => {
    let s1Calls = 0;
    let s2Calls = 0;
    let globalCalls = 0;

    const unsub1 = store.subscribeServer('server-1', () => { s1Calls++; });
    const unsub2 = store.subscribeServer('server-2', () => { s2Calls++; });
    const unsubGlobal = store.subscribeAll(() => { globalCalls++; });

    const snap1: SnapshotPayload = {
      id: 'server-1',
      status: 'online',
      error: '',
      gpus: [
        { index: 0, name: 'RTX 4090', util: 50, memUsed: 12000, memTotal: 24576, temp: 65, power: 250, fan: 40, procs: [] },
      ],
      processes: [],
      cpuCores: 16,
      cpuUsage: 12,
      collectedAt: 1700000000000,
      loadAvg: [0.5, 0.4, 0.3],
      memUsed: 16000000000,
      memTotal: 64000000000,
      swapUsed: 0,
      swapTotal: 0,
    };

    store.ingestSnapshot(snap1);

    expect(s1Calls).toBe(1);
    expect(s2Calls).toBe(0); // Server 2 subscriber is NOT called!
    expect(globalCalls).toBe(1);

    const retrieved1 = store.getServer('server-1');
    expect(retrieved1.status).toBe('online');
    expect(retrieved1.gpus).toHaveLength(1);
    expect(retrieved1.gpus[0].name).toBe('RTX 4090');
    expect(retrieved1.lastGpuAt).toBe(1700000000000);

    // Now ingest for server 2
    const snap2: SnapshotPayload = {
      id: 'server-2',
      status: 'online',
      error: '',
      gpus: [],
      processes: [],
      cpuCores: 8,
      cpuUsage: 5,
      loadAvg: [0.1, 0.1, 0.1],
      memUsed: 8000000000,
      memTotal: 32000000000,
      swapUsed: 0,
      swapTotal: 0,
    };
    store.ingestSnapshot(snap2);

    expect(s1Calls).toBe(1); // Server 1 subscriber is still 1!
    expect(s2Calls).toBe(1); // Server 2 subscriber called
    expect(globalCalls).toBe(2);

    unsub1();
    unsub2();
    unsubGlobal();

    // After unsubscription, no further calls
    store.ingestSnapshot(snap1);
    expect(s1Calls).toBe(1);
    expect(s2Calls).toBe(1);
    expect(globalCalls).toBe(2);
  });

  it('updates status and errors cleanly', () => {
    let calls = 0;
    store.subscribeServer('server-3', () => { calls++; });

    store.updateStatus('server-3', 'timeout', 'SSH connection timed out');
    expect(calls).toBe(1);
    expect(store.getServer('server-3').status).toBe('timeout');
    expect(store.getServer('server-3').error).toBe('SSH connection timed out');

    // Duplicate status update is ignored
    store.updateStatus('server-3', 'timeout', 'SSH connection timed out');
    expect(calls).toBe(1);
  });
});
