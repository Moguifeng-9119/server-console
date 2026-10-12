import { describe, expect, it } from 'vitest';
import { PublishBuffer } from '../electron/monitoring/publish-buffer.cjs';

describe('PublishBuffer rate limiter and coalescing', () => {
  it('coalesces rapid state updates within the frame window', async () => {
    let now = 1000;
    const published = [];
    const buffer = new PublishBuffer({
      maxFps: 5, // 200ms window
      now: () => now,
      onPublish: (snap) => published.push(snap),
    });

    // Enqueue frame 1 at t=1000: immediate publish
    buffer.enqueue('srv-1', { v: 1 });
    expect(published).toEqual([{ v: 1 }]);

    // Enqueue frame 2 and 3 within 200ms: must coalesce into latest
    now = 1050;
    buffer.enqueue('srv-1', { v: 2 });
    now = 1100;
    buffer.enqueue('srv-1', { v: 3 });
    // Still not reached minIntervalMs (200ms)
    expect(published).toEqual([{ v: 1 }]);

    // Fast forward time and flush
    now = 1250;
    buffer.flush('srv-1');
    expect(published).toEqual([{ v: 1 }, { v: 3 }]);

    buffer.clear();
  });

  it('supports immediate flush for critical updates', () => {
    let now = 1000;
    const published = [];
    const buffer = new PublishBuffer({
      maxFps: 5,
      now: () => now,
      onPublish: (snap) => published.push(snap),
    });

    buffer.enqueue('srv-1', { v: 1 });
    expect(published).toHaveLength(1);

    // Immediate flush bypasses throttling
    now = 1020;
    buffer.enqueue('srv-1', { v: 'offline' }, true);
    expect(published).toHaveLength(2);
    expect(published[1]).toEqual({ v: 'offline' });

    buffer.clear();
  });
});
