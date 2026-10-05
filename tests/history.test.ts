import { describe, it, expect } from 'vitest';
import { appendSample, normalizeHistory, historySummary } from '../src/history';

describe('timestamped history', () => {
  it('keeps steady readings and rejects legacy arrays with no timestamps', () => {
    expect(normalizeHistory([10, 20, 30])).toEqual([]);
    expect(appendSample([{ at: 1000, value: 20 }], { at: 9000, value: 20 })).toHaveLength(2);
  });
  it('weights by actual time and excludes gaps instead of inventing samples', () => {
    const summary = historySummary([{ at: 1000, value: 0 }, { at: 3000, value: 100 }, { at: 11000, value: 100 }]);
    expect(summary.average).toBe(90);
    expect(summary.spanMs).toBe(10000);
    expect(historySummary([{ at: 1000, value: 30 }, { at: 2000, value: null }, { at: 90000, value: 80 }]).average).toBe(null);
  });
});
