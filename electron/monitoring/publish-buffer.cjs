// Publish buffer: coalesces rapid telemetry frames to regulate IPC traffic
class PublishBuffer {
  constructor({ onPublish = (_payload) => {}, maxFps = 10, now = Date.now } = {}) {
    this.onPublish = onPublish;
    this.maxFps = maxFps;
    this.minIntervalMs = Math.floor(1000 / maxFps);
    this.now = now;

    // Map: serverId -> { state, lastPublishedAt, timer }
    this.buffers = new Map();
  }

  /**
   * Enqueue an updated state for a server.
   * If enough time has elapsed since last publish, flushes immediately.
   * Otherwise, schedules a flush timer to publish the latest state.
   */
  enqueue(serverId, state, immediate = false) {
    let buf = this.buffers.get(serverId);
    if (!buf) {
      buf = {
        state: null,
        lastPublishedAt: 0,
        timer: null,
      };
      this.buffers.set(serverId, buf);
    }

    buf.state = state;
    const nowMs = this.now();
    const elapsed = nowMs - buf.lastPublishedAt;

    if (immediate || elapsed >= this.minIntervalMs) {
      this.flush(serverId);
    } else if (!buf.timer) {
      const waitMs = this.minIntervalMs - elapsed;
      buf.timer = setTimeout(() => {
        buf.timer = null;
        this.flush(serverId);
      }, waitMs);
    }
  }

  flush(serverId) {
    const buf = this.buffers.get(serverId);
    if (!buf || !buf.state) return;

    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }

    const payload = buf.state;
    buf.state = null;
    buf.lastPublishedAt = this.now();

    try {
      this.onPublish(payload);
    } catch {
      /* ignore broadcast errors */
    }
  }

  flushAll() {
    for (const serverId of this.buffers.keys()) {
      this.flush(serverId);
    }
  }

  clear(serverId) {
    if (serverId) {
      const buf = this.buffers.get(serverId);
      if (buf && buf.timer) clearTimeout(buf.timer);
      this.buffers.delete(serverId);
    } else {
      for (const buf of this.buffers.values()) {
        if (buf.timer) clearTimeout(buf.timer);
      }
      this.buffers.clear();
    }
  }
}

module.exports = {
  PublishBuffer,
};
