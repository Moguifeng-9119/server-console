import { describe, expect, it } from 'vitest';
import { createFrame, computeDelta, applyDelta } from '../electron/monitoring/protocol.cjs';

describe('Monitoring protocol and delta encoding', () => {
  it('creates valid frame headers and validates required fields', () => {
    const frame = createFrame({
      serverId: 'srv-1',
      epoch: 'epoch-1',
      lane: 'gpu',
      seq: 42,
      kind: 'delta',
      payload: { util: 85 },
    });

    expect(frame.version).toBe(1);
    expect(frame.serverId).toBe('srv-1');
    expect(frame.epoch).toBe('epoch-1');
    expect(frame.lane).toBe('gpu');
    expect(frame.seq).toBe(42);
    expect(frame.kind).toBe('delta');
    expect(frame.payload).toEqual({ util: 85 });
    expect(frame.observedAt).toBeGreaterThan(0);
  });

  it('computes minimal delta patch between snapshots', () => {
    const prev = { util: 50, memUsed: 1000, temp: 60 };
    const next = { util: 55, memUsed: 1000, temp: 60 };

    const delta = computeDelta(prev, next);
    expect(delta).toEqual({ util: 55 });

    // Merging delta reproduces next state
    expect(applyDelta(prev, delta)).toEqual(next);
  });

  it('differentiates 0 from null in deltas', () => {
    const prev = { util: 50, temp: 65 };
    const next = { util: 0, temp: null };

    const delta = computeDelta(prev, next);
    expect(delta).toEqual({ util: 0, temp: null });
    expect(delta?.util).toBe(0);
    expect(delta?.temp).toBeNull();
  });

  it('returns null when there are no changes', () => {
    const obj = { util: 80, name: 'RTX 3090' };
    expect(computeDelta(obj, { ...obj })).toBeNull();
  });
});
