// History aggregator: aggregates high-frequency observations into 1-second statistical buckets
// Preserves peaks (min/max), trapezoidal integral, coverage_ms, and sample_count.
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

class HistoryAggregator {
  constructor({ maxPendingAgeMs = 2000 } = {}) {
    this.maxPendingAgeMs = maxPendingAgeMs;
    // Key: `${server}|${device}|${metric}` -> state
    this.channels = new Map();
  }

  /**
   * Ingest an observation record.
   * @param {{ server: string, device: string, metric: string, label: string, at: number, value: number|null }} r
   */
  ingest(r) {
    const at = r.at;
    const value = finite(r.value);
    const key = `${r.server}|${r.device}|${r.metric}`;
    const bucketAt = Math.floor(at / 1000) * 1000;

    let ch = this.channels.get(key);
    if (!ch) {
      ch = {
        server: r.server,
        device: r.device,
        metric: r.metric,
        label: r.label,
        currentBucket: null,
        closedBuckets: [],
      };
      this.channels.set(key, ch);
    }
    ch.label = r.label;

    if (!ch.currentBucket || ch.currentBucket.bucket_at !== bucketAt) {
      // Close previous bucket if any
      if (ch.currentBucket) {
        ch.closedBuckets.push(ch.currentBucket);
      }
      ch.currentBucket = {
        server: ch.server,
        device: ch.device,
        metric: ch.metric,
        label: ch.label,
        bucket_at: bucketAt,
        integral: 0,
        coverage_ms: 0,
        sample_count: 0,
        sum: 0,
        min: null,
        max: null,
        last_value: null,
        last_at: null,
        missing: 0,
      };
    }

    const b = ch.currentBucket;
    if (value === null) {
      b.missing++;
    } else {
      b.sample_count++;
      b.sum += value;
      b.min = b.min === null ? value : Math.min(b.min, value);
      b.max = b.max === null ? value : Math.max(b.max, value);

      if (b.last_value !== null && b.last_at !== null && at > b.last_at) {
        const dt = at - b.last_at;
        if (dt <= 2000) {
          const trap = ((b.last_value + value) / 2) * dt;
          b.integral += trap;
          b.coverage_ms += dt;
        }
      }
      b.last_value = value;
      b.last_at = at;
    }
  }

  /**
   * Ingest all metrics from a server snapshot payload.
   */
  ingestSnapshot(s) {
    const at = s.collectedAt || Date.now();
    const records = [];
    const add = (device, metric, label, value) => {
      records.push({ server: s.id, device, metric, label, at, value: finite(value) });
    };

    if (s.gpus && s.gpus.length) {
      const avgUtil = s.gpus.reduce((n, g) => n + g.util, 0) / s.gpus.length;
      add('all', 'util', 'All GPUs', avgUtil);
    }
    if (s.cpuUsage !== undefined) {
      add('system', 'cpu', 'System', s.cpuUsage);
    }
    if (s.memTotal) {
      add('system', 'memory', 'System', (s.memUsed / s.memTotal) * 100);
    }
    for (const g of s.gpus || []) {
      const device = 'gpu:' + (g.uuid || g.index);
      const label = `GPU ${g.index} · ${g.name}`;
      add(device, 'util', label, g.util);
      add(device, 'memory', label, g.memTotal ? (g.memUsed / g.memTotal) * 100 : null);
      add(device, 'memoryUsed', label, g.memUsed);
      add(device, 'memoryTotal', label, g.memTotal);
      add(device, 'temp', label, g.temp);
      add(device, 'power', label, g.power);
    }

    for (const r of records) {
      this.ingest(r);
    }
  }

  /**
   * Flush all closed buckets up to cutoffTime (defaults to now - 1000ms).
   * @param {number} [cutoffTime]
   * @returns {Array<any>} closed buckets ready for database commit
   */
  flush(cutoffTime = Date.now() - 1000) {
    const out = [];
    for (const ch of this.channels.values()) {
      // If current bucket is older than cutoffTime, close it too
      if (ch.currentBucket && ch.currentBucket.bucket_at <= cutoffTime - 1000) {
        ch.closedBuckets.push(ch.currentBucket);
        ch.currentBucket = null;
      }

      while (ch.closedBuckets.length > 0) {
        const b = ch.closedBuckets[0];
        if (b.bucket_at <= cutoffTime) {
          out.push(ch.closedBuckets.shift());
        } else {
          break;
        }
      }
    }
    return out;
  }
}

module.exports = {
  HistoryAggregator,
};
