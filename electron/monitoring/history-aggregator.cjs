// Observed samples are integrated across second boundaries before UI coalescing.
const finite = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;

class HistoryAggregator {
  constructor({ maxPendingAgeMs = 2000, maxGapMs = 60000, maxChannels = 20000 } = {}) {
    this.maxPendingAgeMs = maxPendingAgeMs;
    this.maxGapMs = maxGapMs;
    this.maxChannels = maxChannels;
    this.channels = new Map();
  }
  bucket(ch, at) {
    const bucketAt = Math.floor(at / 1000) * 1000;
    let b = ch.buckets.get(bucketAt);
    if (!b) {
      b = { server: ch.server, device: ch.device, metric: ch.metric, label: ch.label,
        bucket_at: bucketAt, integral: 0, coverage_ms: 0, sample_count: 0, sum: 0,
        min: null, max: null, last_value: null, last_at: null, missing: 0, revision: 0 };
      ch.buckets.set(bucketAt, b);
    }
    return b;
  }
  ingest(r) {
    if (!Number.isSafeInteger(r.at) || r.at <= 0) return;
    const key = JSON.stringify([r.server, r.device, r.metric]);
    let ch = this.channels.get(key);
    if (!ch) {
      if (this.channels.size >= this.maxChannels) throw new Error('History channel limit exceeded');
      ch = { server: r.server, device: r.device, metric: r.metric, label: r.label,
        previous: null, buckets: new Map(), emitted: new Map() };
      this.channels.set(key, ch);
    }
    if (ch.previous && r.at <= ch.previous.at) return;
    ch.label = r.label;
    const value = finite(r.value), previous = ch.previous;
    if (previous && previous.value !== null && value !== null && r.at - previous.at <= this.maxGapMs) {
      const duration = r.at - previous.at;
      for (let from = previous.at; from < r.at;) {
        const b = this.bucket(ch, from), to = Math.min(r.at, b.bucket_at + 1000);
        const a = previous.value + (value - previous.value) * (from - previous.at) / duration;
        const z = previous.value + (value - previous.value) * (to - previous.at) / duration;
        b.integral += (a + z) / 2 * (to - from); b.coverage_ms += to - from;
        b.min = b.min === null ? Math.min(a, z) : Math.min(b.min, a, z);
        b.max = b.max === null ? Math.max(a, z) : Math.max(b.max, a, z);
        b.revision++;
        from = to;
      }
    }
    const b = this.bucket(ch, r.at);
    b.label = r.label; b.last_at = r.at; b.last_value = value;
    if (value === null) b.missing++;
    else {
      b.sample_count++; b.sum += value;
      b.min = b.min === null ? value : Math.min(b.min, value);
      b.max = b.max === null ? value : Math.max(b.max, value);
    }
    b.revision++;
    // A null breaks the integration chain, including inside a second.
    ch.previous = { at: r.at, value };
  }
  ingestSnapshot(s) {
    const lane = s.lastLane;
    const gpu = !lane || lane === 'gpu' || lane === 'legacy';
    const system = !lane || lane === 'system' || lane === 'legacy';
    if (!gpu && !system) return;
    const at = s.laneTimestamps?.[lane] || s.collectedAt || Date.now();
    const add = (device, metric, label, value, observedAt = at) => this.ingest({ server: s.id, device, metric, label, at: observedAt, value: finite(value) });
    if (system) {
      add('system', 'cpu', 'System', s.cpuUsage);
      add('system', 'memory', 'System', s.memTotal ? s.memUsed / s.memTotal * 100 : null);
    }
    if (gpu) {
      const cards = s.gpus || [];
      const available = (g, key) => !g.unavailableMetrics?.includes(key) && finite(g[key]) !== null;
      const utils = cards.filter((g) => available(g, 'util')).map((g) => g.util);
      // A partial stream row must not refresh the cached observations of other
      // cards. Advance the fleet mean only after every device advances.
      const fleetAt = cards.length ? Math.min(...cards.map((g) => g.observedAt || at)) : at;
      add('all', 'util', 'All GPUs', utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : null, fleetAt);
      const live = new Set();
      for (const g of cards) {
        const device = 'gpu:' + (g.uuid || g.index), label = 'GPU ' + g.index + ' · ' + g.name;
        live.add(device);
        const memoryKnown = available(g, 'memUsed') && available(g, 'memTotal');
        for (const [metric, value] of Object.entries({ util: available(g, 'util') ? g.util : null,
          memory: memoryKnown && g.memTotal ? g.memUsed / g.memTotal * 100 : null,
          memoryUsed: available(g, 'memUsed') ? g.memUsed : null,
          memoryTotal: available(g, 'memTotal') ? g.memTotal : null,
          temp: available(g, 'temp') ? g.temp : null, power: available(g, 'power') ? g.power : null })) add(device, metric, label, value, g.observedAt || at);
      }
      for (const ch of this.channels.values()) {
        if (ch.server === s.id && ch.device.startsWith('gpu:') && !live.has(ch.device)) add(ch.device, ch.metric, ch.label, null);
      }
    }
  }
  gap(server, at = Date.now(), lane = null) {
    for (const ch of this.channels.values()) {
      if (ch.server !== server || lane === 'processes' || lane === 'gpu' && ch.device === 'system' || lane === 'system' && ch.device !== 'system') continue;
      this.ingest({ server, device: ch.device, metric: ch.metric, label: ch.label, at, value: null });
    }
    return this.flushAll(server);
  }
  flush(cutoffTime = Date.now() - this.maxPendingAgeMs, server = null) {
    const out = [];
    for (const ch of this.channels.values()) {
      if (server !== null && ch.server !== server) continue;
      for (const [at, b] of ch.buckets) {
        if (at + 1000 > cutoffTime) continue;
        if ((ch.emitted.get(at) || 0) < b.revision) {
          out.push(Object.freeze({ ...b })); ch.emitted.set(at, b.revision);
        }
        if (ch.previous && at + 1000 < ch.previous.at - this.maxGapMs) { ch.buckets.delete(at); ch.emitted.delete(at); }
      }
    }
    return out.sort((a, b) => a.bucket_at - b.bucket_at);
  }
  flushAll(server = null) { return this.flush(Infinity, server); }
  removeServer(server) {
    const buckets = this.flushAll(server);
    for (const [key, ch] of this.channels) if (ch.server === server) this.channels.delete(key);
    return buckets;
  }
}
module.exports = { HistoryAggregator };
