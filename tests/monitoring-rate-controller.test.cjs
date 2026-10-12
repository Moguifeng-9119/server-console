import { describe, expect, it } from 'vitest';
import { RateController } from '../electron/monitoring/rate-controller.cjs';

describe('RateController AIMD adaptive frequency control', () => {
  it('halves rate upon congestion and gradually increases after stability', () => {
    let now = 10000;
    const ctrl = new RateController({
      desiredHz: 5, // 200ms
      minHz: 1,
      maxHz: 5,
      cooldownMs: 10000,
      now: () => now,
    });

    expect(ctrl.effectiveHz).toBe(5);

    // 1. Encounter query duration over budget (congestion)
    const dec1 = ctrl.observePressure({ queryDurationMs: 800 });
    expect(dec1.changed).toBe(true);
    expect(ctrl.effectiveHz).toBe(2.5);
    expect(ctrl.state).toBe('degraded');

    // 2. Encounter second error: multiplicative decrease again down to floor
    now += 1000;
    const dec2 = ctrl.observePressure({ error: new Error('SSH slow') });
    expect(dec2.changed).toBe(true);
    expect(ctrl.effectiveHz).toBe(1.3); // Math.max(1, 2.5 * 0.5 -> 1.25 rounded to 1.3)

    // 3. Stable for 10 seconds: additive increase +0.5 Hz
    now += 11000;
    const inc1 = ctrl.observePressure({ queryDurationMs: 50 });
    expect(inc1.changed).toBe(true);
    expect(ctrl.effectiveHz).toBe(1.8);

    // 4. Another 10 seconds of stability: +0.5 Hz
    now += 11000;
    const inc2 = ctrl.observePressure({ queryDurationMs: 50 });
    expect(inc2.changed).toBe(true);
    expect(ctrl.effectiveHz).toBe(2.3);
  });

  it('clamps to desired and minimum boundaries', () => {
    const ctrl = new RateController({
      desiredHz: 2, // 500ms
      minHz: 0.5,
      maxHz: 5,
    });

    ctrl.setDesiredHz(1);
    expect(ctrl.desiredHz).toBe(1);
    expect(ctrl.effectiveHz).toBe(1);
  });
});
