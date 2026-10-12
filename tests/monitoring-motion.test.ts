import { describe, expect, it } from 'vitest';

describe('Gauge motion formula and exponential smoothing', () => {
  const tau = 100; // ms

  function step(current: number, target: number, dt: number): number {
    const factor = 1 - Math.exp(-dt / tau);
    const diff = target - current;
    if (Math.abs(diff) < 0.05) return target;
    return current + diff * factor;
  }

  it('converges smoothly toward target value', () => {
    let current = 0;
    const target = 100;

    // After 100ms (1 tau), should reach ~63.2%
    current = step(current, target, 100);
    expect(current).toBeCloseTo(63.21, 1);

    // After another 100ms (total 2 tau), should reach ~86.4%
    current = step(current, target, 100);
    expect(current).toBeCloseTo(86.46, 1);

    // After another 100ms (total 3 tau), should reach ~95%
    current = step(current, target, 100);
    expect(current).toBeCloseTo(95.02, 1);

    // Continue stepping until convergence
    for (let i = 0; i < 8; i++) {
      current = step(current, target, 100);
    }
    expect(current).toBe(100);
  });

  it('snaps to target when within 0.05 margin', () => {
    const current = 99.96;
    const target = 100;
    const next = step(current, target, 16);
    expect(next).toBe(100);
  });

  it('handles negative step (utilization decrease)', () => {
    let current = 80;
    const target = 20;

    // After 100ms, diff is -60, factor ~0.632, delta ~ -37.92
    current = step(current, target, 100);
    expect(current).toBeCloseTo(42.07, 1);
  });
});
