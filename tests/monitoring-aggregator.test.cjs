import { describe, expect, it } from 'vitest';
import { HistoryAggregator } from '../electron/monitoring/history-aggregator.cjs';

describe('HistoryAggregator 1-second statistical buckets', () => {
  it('preserves high-frequency peaks (min/max) and calculates sample count', () => {
    const agg = new HistoryAggregator();
    const baseSecond = 10000; // 10.000s

    // Ingest 5 samples within the same second (e.g. 200ms intervals)
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 0, value: 12 });
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 200, value: 95 }); // peak!
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 400, value: 50 });
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 600, value: 8 });  // trough!
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 800, value: 40 });

    // Moving to next second closes the previous bucket
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 1000, value: 20 });

    const flushed = agg.flush(baseSecond + 1000);
    expect(flushed).toHaveLength(1);
    const b = flushed[0];

    expect(b.bucket_at).toBe(baseSecond);
    expect(b.sample_count).toBe(5);
    expect(b.min).toBe(8);
    expect(b.max).toBe(95);
    expect(b.last_value).toBe(40);
    expect(b.last_at).toBe(baseSecond + 800);
    expect(b.coverage_ms).toBe(800);
    expect(b.integral).toBeGreaterThan(0);
  });

  it('handles null / gaps without fabricating zeroes', () => {
    const agg = new HistoryAggregator();
    const baseSecond = 20000;

    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 100, value: null });
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 300, value: null });
    agg.ingest({ server: 's1', device: 'gpu:0', metric: 'util', label: 'GPU 0', at: baseSecond + 1200, value: 15 });

    const flushed = agg.flush(baseSecond + 1000);
    expect(flushed).toHaveLength(1);
    const b = flushed[0];
    expect(b.bucket_at).toBe(baseSecond);
    expect(b.sample_count).toBe(0);
    expect(b.missing).toBe(2);
    expect(b.min).toBeNull();
    expect(b.max).toBeNull();
  });

  it('aggregates entire snapshot payload properly', () => {
    const agg = new HistoryAggregator();
    const snap = {
      id: 'srv-agg',
      collectedAt: 30200,
      cpuUsage: 45,
      memUsed: 8,
      memTotal: 16,
      gpus: [
        { index: 0, uuid: 'GPU-UUID-A', name: 'RTX 3090', util: 70, memUsed: 10000, memTotal: 24000, temp: 62, power: 250 },
        { index: 1, uuid: 'GPU-UUID-B', name: 'RTX 3090', util: 90, memUsed: 12000, memTotal: 24000, temp: 68, power: 280 },
      ],
    };

    agg.ingestSnapshot(snap);

    // Trigger close
    const flushed = agg.flush(40000);
    expect(flushed.length).toBeGreaterThan(5);
    const allGpus = flushed.find((b) => b.device === 'all' && b.metric === 'util');
    expect(allGpus).toBeDefined();
    expect(allGpus?.last_value).toBe(80); // (70 + 90) / 2
  });
});
