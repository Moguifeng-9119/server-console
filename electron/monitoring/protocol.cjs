// Monitoring Frame and Delta Protocol
const PROTOCOL_VERSION = 1;

/**
 * Creates a validated MonitoringFrame object.
 */
function createFrame({
  serverId,
  epoch,
  lane,
  seq = 1,
  kind = 'keyframe',
  metaRevision = 1,
  observedAt = Date.now(),
  receivedAt = Date.now(),
  payload = null,
}) {
  if (!serverId || typeof serverId !== 'string') throw new Error('Frame requires a valid serverId');
  if (!epoch || typeof epoch !== 'string') throw new Error('Frame requires a valid epoch');
  if (!['gpu', 'system', 'processes', 'metadata', 'health'].includes(lane)) {
    throw new Error(`Invalid lane: ${lane}`);
  }
  if (!['keyframe', 'delta', 'heartbeat', 'gap', 'controlAck'].includes(kind)) {
    throw new Error(`Invalid kind: ${kind}`);
  }

  return {
    version: PROTOCOL_VERSION,
    serverId,
    epoch,
    lane,
    seq,
    kind,
    metaRevision,
    observedAt,
    receivedAt,
    payload,
  };
}

/**
 * Computes a field-level delta between prev and next objects.
 * Returns null if there are no differences.
 * Explicitly preserves null vs 0 vs undefined.
 */
function computeDelta(prev, next) {
  if (!prev) return next;
  if (!next) return null;

  const diff = {};
  let changed = false;

  for (const key of Object.keys(next)) {
    const nextVal = next[key];
    const prevVal = prev[key];

    if (Array.isArray(nextVal) && Array.isArray(prevVal)) {
      if (JSON.stringify(nextVal) !== JSON.stringify(prevVal)) {
        diff[key] = nextVal;
        changed = true;
      }
    } else if (nextVal !== prevVal) {
      diff[key] = nextVal;
      changed = true;
    }
  }

  return changed ? diff : null;
}

/**
 * Merges a delta patch onto base state.
 */
function applyDelta(base, delta) {
  if (!base) return delta;
  if (!delta) return base;
  return { ...base, ...delta };
}

module.exports = {
  PROTOCOL_VERSION,
  createFrame,
  computeDelta,
  applyDelta,
};
