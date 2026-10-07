// Each host owns its pending request. One slow SSH host cannot block another.
class PollScheduler {
  constructor({ configs, collect, interval, onError = () => {}, now = Date.now }) {
    this.configs = configs; this.collect = collect; this.interval = interval;
    this.onError = onError; this.now = now;
    this.running = new Set(); this.last = new Map(); this.focused = null;
    this.timer = null; this.stopped = false;
  }
  tick(force = null) {
    if (this.stopped) return;
    for (const cfg of this.configs()) {
      const duration = !this.focused || cfg.id === this.focused ? this.interval() : Math.max(this.interval() * 4, 8000);
      if (this.running.has(cfg.id) || force !== cfg.id && this.now() - (this.last.get(cfg.id) ?? -Infinity) < duration) continue;
      this.running.add(cfg.id); this.last.set(cfg.id, this.now());
      Promise.resolve().then(() => this.collect(cfg)).catch(this.onError).finally(() => {
        this.running.delete(cfg.id);
        // A focus change that arrived during this request is already satisfied
        // by its resulting snapshot; never open a concurrent collect channel.
      });
    }
  }
  focus(id) { this.focused = id; if (id) this.tick(id); }
  start() {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    const live = new Set(this.configs().map((c) => c.id));
    for (const id of this.last.keys()) if (!live.has(id)) this.last.delete(id);
    this.timer = setInterval(() => this.tick(), 250); this.tick();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = { PollScheduler };
