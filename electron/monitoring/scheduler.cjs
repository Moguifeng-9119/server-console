const { probeCapabilities } = require('./capabilities.cjs');
const { pollGpus } = require('./gpu-poller.cjs');
const { pollSystem } = require('./system-collector.cjs');
const { pollProcesses } = require('./process-collector.cjs');
const { StreamChannel } = require('./stream-channel.cjs');
const { RateController } = require('./rate-controller.cjs');
const { PublishBuffer } = require('./publish-buffer.cjs');

class TieredScheduler {
  constructor({ configs, getConnection, onSnapshot, onObservation = (_snapshot) => {}, onStatus = (_status) => {}, interval = () => 2000, onError = (_error, _cfg, _lane) => {}, now = Date.now }) {
    this.configs = configs; this.getConnection = getConnection; this.onSnapshot = onSnapshot; this.onObservation = onObservation;
    this.onStatus = onStatus; this.interval = interval; this.onError = onError; this.now = now;
    this.focused = null; this.hidden = false; this.timer = null; this.stopped = false;
    this.running = new Set(); this.lastRun = new Map(); this.serverStates = new Map();
    this.publisher = new PublishBuffer({ onPublish: (snapshot) => { if (!this.stopped && this.serverStates.has(snapshot.id)) onSnapshot(snapshot); }, maxFps: 10, now });
  }
  getState(id, connection = null) {
    let state = this.serverStates.get(id);
    if (state && connection && state.connection !== connection) { this.remove(id); state = null; }
    if (!state) {
      state = { connection, caps: null, gpus: [], processes: [], gpuProcs: new Map(), system: null, previousCpu: null, gpuUuidMap: new Map(), laneTimestamps: {}, stream: null,
        retryStreamAt: 0, streamChangedAt: 0, lastMetadataAt: 0, controller: new RateController({ desiredHz: Math.min(5, 1000 / Math.max(200, this.interval())), minHz: 0.1, maxHz: 5, now: this.now }) };
      this.serverStates.set(id, state);
    }
    return state;
  }
  valid(cfg, state) { return !this.stopped && this.serverStates.get(cfg.id) === state && this.configs().some((item) => item.id === cfg.id); }
  remove(id) {
    this.serverStates.get(id)?.stream?.stop(); this.serverStates.delete(id); this.publisher.clear(id);
    for (const key of this.lastRun.keys()) if (key.startsWith(id + ':')) this.lastRun.delete(key);
  }
  buildSnapshot(cfg, state, lane) {
    return { id: cfg.id, status: 'online', error: '', gpus: state.gpus, processes: state.processes,
      cpuCores: state.system?.cpuCores || 0, cpuUsage: state.system?.cpuUsage ?? null, loadAvg: state.system?.loadAvg || [0, 0, 0],
      memUsed: state.system?.memUsed || 0, memTotal: state.system?.memTotal || 0, swapUsed: state.system?.swapUsed || 0, swapTotal: state.system?.swapTotal || 0,
      collectedAt: this.now(), lastLane: lane, laneTimestamps: { ...state.laneTimestamps },
      monitoring: { desiredIntervalMs: this.interval(), effectiveIntervalMs: state.controller.getIntervalMs(), mode: state.stream?.active ? 'stream' : state.caps?.legacyOnly ? 'compatible' : 'poll', reason: state.controller.reason } };
  }
  publish(cfg, state, lane) {
    if (!this.valid(cfg, state)) return;
    state.laneTimestamps[lane] = this.now();
    const snapshot = this.buildSnapshot(cfg, state, lane);
    this.onObservation(snapshot); this.publisher.enqueue(cfg.id, snapshot);
  }
  mergeGpus(state, values, complete = true) {
    const map = complete ? new Map() : new Map(state.gpus.map((gpu) => [gpu.uuid || String(gpu.index), gpu]));
    for (const gpu of values) {
      state.gpuUuidMap.set(gpu.uuid, gpu.index);
      map.set(gpu.uuid || String(gpu.index), { ...gpu, observedAt: this.now(), procs: state.gpuProcs.get(gpu.uuid) || [] });
    }
    state.gpus = [...map.values()].sort((a, b) => a.index - b.index);
  }
  async runLane(cfg, lane, fn, state = this.getState(cfg.id)) {
    const key = cfg.id + ':' + lane; if (this.running.has(key)) return;
    this.running.add(key); this.lastRun.set(key, this.now());
    try { await fn(); }
    catch (error) {
      if (!this.valid(cfg, state)) return;
      if (lane === 'gpu') state.controller.observePressure({ error });
      this.onError(error, cfg, lane);
      const hasRecentSystem = state.laneTimestamps.system && this.now() - state.laneTimestamps.system < 15000;
      const status = lane !== 'system' && hasRecentSystem ? 'online' : /authentic/i.test(String(error)) ? 'auth' : /timeout|timed out/i.test(String(error)) ? 'timeout' : 'offline';
      this.onStatus({ id: cfg.id, status, error: String(error.message || error), lane });
    } finally { this.running.delete(key); }
  }
  tick(force = null) {
    if (this.stopped) return;
    const now = this.now(), configs = this.configs(), live = new Set(configs.map((cfg) => cfg.id));
    for (const id of this.serverStates.keys()) if (!live.has(id)) this.remove(id);
    for (const cfg of configs) {
      const conn = this.getConnection(cfg); if (!conn || conn.isBackedOff?.()) continue;
      const state = this.getState(cfg.id, conn), focused = !this.focused || cfg.id === this.focused;
      const target = this.hidden ? Math.max(5000, this.interval()) : focused ? Math.max(200, this.interval()) : Math.max(2000, this.interval() * 2);
      state.controller.setDesiredHz(1000 / target);
      const gpuInterval = Math.max(target, state.controller.getIntervalMs());
      const due = (lane, duration) => force === cfg.id || now - (this.lastRun.get(cfg.id + ':' + lane) ?? -Infinity) >= duration;
      if (!state.caps) {
        if (due('probe', 5000)) void this.runLane(cfg, 'probe', async () => { const caps = await probeCapabilities(conn, cfg.id); if (this.valid(cfg, state)) state.caps = caps; }, state);
        continue;
      }
      if (state.caps.legacyOnly && typeof conn.collect === 'function') {
        if (due('legacy', Math.max(1000, target))) void this.runLane(cfg, 'legacy', async () => {
          const sample = await conn.collect(); if (!this.valid(cfg, state)) return;
          Object.assign(state, { gpus: sample.gpus, processes: sample.processes, system: sample });
          state.laneTimestamps = { gpu: this.now(), system: this.now(), processes: this.now() };
          const payload = { ...this.buildSnapshot(cfg, state, undefined), ...sample, collectedAt: this.now() }; this.onObservation(payload); this.publisher.enqueue(cfg.id, payload);
        }, state);
        continue;
      }
      if (state.caps.hasNvidiaSmi) {
        if (state.stream?.active && state.stream.intervalMs !== gpuInterval && now - state.streamChangedAt >= 30000) { state.stream.stop(); state.stream = null; }
        if (!state.stream?.active && now >= state.retryStreamAt && conn.client && typeof conn.connect === 'function') {
          const stream = new StreamChannel({ connection: conn, intervalMs: gpuInterval, idleTimeoutMs: Math.max(6000, gpuInterval * 4), now: this.now,
            onGpus: (gpus) => { if (!this.valid(cfg, state)) return; state.controller.observePressure(); this.mergeGpus(state, gpus, false); this.publish(cfg, state, 'gpu'); },
            onError: (error) => { if (!this.valid(cfg, state)) return; state.retryStreamAt = this.now() + 30000; state.stream = null; state.controller.observePressure({ error }); this.onError(error, cfg, 'stream'); } });
          state.stream = stream; state.streamChangedAt = now; void stream.start();
        }
        if ((!state.stream?.active && due('gpu', gpuInterval)) || (state.stream?.active && now - state.lastMetadataAt > 60000)) {
          void this.runLane(cfg, 'gpu', async () => {
            const started = this.now(), gpus = await pollGpus(conn, 5000); if (!this.valid(cfg, state)) return;
            state.lastMetadataAt = this.now(); state.controller.observePressure({ queryDurationMs: this.now() - started });
            this.mergeGpus(state, gpus); this.publish(cfg, state, 'gpu');
          }, state);
        }
      } else if (!state.laneTimestamps.gpu) this.publish(cfg, state, 'gpu');
      if (due('system', this.hidden ? 5000 : focused ? Math.max(1000, target) : Math.max(4000, target))) void this.runLane(cfg, 'system', async () => {
        const value = await pollSystem(conn, state.previousCpu, 5000); if (!this.valid(cfg, state)) return;
        state.system = value; state.previousCpu = value.cpuSample; this.publish(cfg, state, 'system');
      }, state);
      if (due('processes', this.hidden ? 10000 : focused ? 3000 : 8000)) void this.runLane(cfg, 'processes', async () => {
        const value = await pollProcesses(conn, state.gpuUuidMap, 8000); if (!this.valid(cfg, state)) return;
        state.processes = value.processes; state.gpuProcs = value.gpuProcs;
        state.gpus = state.gpus.map((gpu) => ({ ...gpu, procs: state.gpuProcs.get(gpu.uuid) || [] })); this.publish(cfg, state, 'processes');
      }, state);
    }
  }
  focus(id) { this.focused = id; if (id) this.tick(id); }
  setHidden(hidden) { this.hidden = !!hidden; this.tick(); }
  start() { this.stopped = false; if (this.timer) clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 50); this.timer.unref?.(); this.tick(); }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; for (const state of this.serverStates.values()) state.stream?.stop(); this.publisher.clear(); }
}
module.exports = { TieredScheduler };

