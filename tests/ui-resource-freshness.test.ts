import { describe, expect, it } from 'vitest';
import { freeGiB, gpuMetricAvailable, isFreshSample, matchingGpus } from '../src/resources';
import { isFreshTelemetry, matchingGpusFromTelemetry } from '../src/telemetry/selectors';
import { createEmptyTelemetry } from '../src/types/monitoring';
import type { Gpu, Server } from '../src/types';

const now = 100000;
const gpu: Gpu = { index: 0, name: 'GPU', util: 0, memUsed: 0, memTotal: 81920, temp: 0, power: 0, fan: 0, procs: [] };
const server = { id: 'test', name: 'Test', host: 'test', status: 'online', collectedAt: now, gpus: [gpu], processes: [] } as unknown as Server;
describe('monitoring lane and metric validity', () => {
  it('never lets system or GPU activity refresh a stale process list', () => {
    const sample = { ...server, laneTimestamps: { gpu: now, system: now, processes: now - 16000 } };
    expect(isFreshSample(sample, false, 200, now)).toBe(true);
    expect(isFreshSample(sample, false, 200, now, 'processes')).toBe(false);
    expect(isFreshSample({ ...sample, laneTimestamps: { system: now } }, false, 200, now)).toBe(false);
    expect(isFreshSample(server, false, 200, now, 'processes')).toBe(true);
  });
  it('marks a lane stale immediately when its last query failed', () => {
    const sample = { ...server, laneTimestamps: { gpu: now, system: now }, monitoring: { laneHealth: { gpu: { healthy: false }, system: { healthy: true } } } };
    expect(isFreshSample(sample, false, 200, now)).toBe(false);
    expect(isFreshSample(sample, false, 200, now, 'system')).toBe(true);
  });
  it('does not offer a cached device when another device keeps reporting', () => {
    const sample = { ...server, gpus: [{ ...gpu, observedAt: now - 10001 }, { ...gpu, index: 1, observedAt: now }] };
    expect(matchingGpus(sample, 0, '', '', now).map((item) => item.index)).toEqual([1]);
  });
  it('treats unavailable fallback zeroes as unknown but accepts observed zeroes', () => {
    const unknown = { ...gpu, unavailableMetrics: ['util', 'memUsed', 'temp', 'power', 'fan'] };
    expect(gpuMetricAvailable(gpu, 'util')).toBe(true);
    expect(gpuMetricAvailable(gpu, 'temp')).toBe(true);
    expect(gpuMetricAvailable(unknown, 'util')).toBe(false);
    expect(Number.isNaN(freeGiB(unknown))).toBe(true);
    expect(matchingGpus({ ...server, gpus: [unknown] }, 0, '', '', now)).toEqual([]);
  });
  it('applies the same eligibility and lane clock to external-store selectors', () => {
    const telemetry = { ...createEmptyTelemetry('test'), status: 'online' as const, collectedAt: now, laneTimestamps: { system: now, gpu: now - 10001 }, gpus: [gpu] };
    expect(isFreshTelemetry(telemetry, false, 200, now)).toBe(false);
    expect(matchingGpusFromTelemetry({ ...telemetry, gpus: [{ ...gpu, unavailableMetrics: ['memTotal'] }] }, 0, '', '', '', '', '', now)).toEqual([]);
  });
});
