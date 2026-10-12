// AIMD Adaptive Rate Controller and Health State Machine
class RateController {
  constructor({
    desiredHz = 2, // 500ms default
    minHz = 0.5,   // 2000ms floor
    maxHz = 5,     // 200ms ceiling (10Hz experimental)
    cooldownMs = 10000,
    now = Date.now,
  } = {}) {
    this.desiredHz = desiredHz;
    this.effectiveHz = Math.min(desiredHz, maxHz);
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.cooldownMs = cooldownMs;
    this.now = now;

    this.state = 'idle'; // 'idle' | 'probing' | 'streaming' | 'degraded' | 'reconnecting' | 'stopped'
    this.reason = 'normal';
    this.lastAdjustAt = now();
    this.lastCongestionAt = 0;
  }

  setDesiredHz(hz) {
    this.desiredHz = Math.max(this.minHz, Math.min(this.maxHz, Number(hz)));
    if (this.effectiveHz > this.desiredHz) {
      this.effectiveHz = this.desiredHz;
    }
    this.lastAdjustAt = this.now();
  }

  observePressure({ queryDurationMs = 0, error = null, timeout = false } = {}) {
    const nowMs = this.now();
    const targetIntervalMs = Math.floor(1000 / this.effectiveHz);

    // Congestion triggers: explicit error, timeout, or query duration exceeded 80% of budget
    const congested = error != null || timeout || (queryDurationMs > targetIntervalMs * 0.8 && queryDurationMs > 300);

    if (congested) {
      this.lastCongestionAt = nowMs;
      const prevHz = this.effectiveHz;
      // Multiplicative decrease (halve the frequency)
      this.effectiveHz = Math.max(this.minHz, Number((this.effectiveHz * 0.5).toFixed(1)));
      this.state = 'degraded';
      this.reason = timeout ? 'timeout' : error ? 'query_error' : 'high_latency';
      this.lastAdjustAt = nowMs;
      return {
        changed: prevHz !== this.effectiveHz,
        effectiveHz: this.effectiveHz,
        reason: this.reason,
      };
    }

    // Additive increase: +0.5 Hz after 10s of stability until reaching desiredHz
    if (nowMs - this.lastCongestionAt >= this.cooldownMs && nowMs - this.lastAdjustAt >= this.cooldownMs) {
      if (this.effectiveHz < this.desiredHz) {
        this.effectiveHz = Math.min(this.desiredHz, Number((this.effectiveHz + 0.5).toFixed(1)));
        this.lastAdjustAt = nowMs;
        if (this.effectiveHz >= this.desiredHz) {
          this.state = 'streaming';
          this.reason = 'normal';
        }
        return {
          changed: true,
          effectiveHz: this.effectiveHz,
          reason: this.reason,
        };
      }
    }

    return {
      changed: false,
      effectiveHz: this.effectiveHz,
      reason: this.reason,
    };
  }

  getIntervalMs() {
    return Math.floor(1000 / this.effectiveHz);
  }
}

module.exports = {
  RateController,
};
