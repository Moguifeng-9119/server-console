const { probeCapabilities } = require('./capabilities.cjs');
const { pollGpus } = require('./gpu-poller.cjs');
const { pollSystem } = require('./system-collector.cjs');
const { pollProcesses } = require('./process-collector.cjs');

/**
 * TieredScheduler manages independent collection lanes per host:
 * - 'gpu': high frequency (500ms or 200ms when focused, 1s-2s when background)
 * - 'system': medium frequency (1s when focused, 2s-4s when background)
 * - 'processes': low frequency (3s when focused, 8s-10s when background)
 *
 * Each lane is strictly non-reentrant per host. A slow `ps` query will never
 * delay GPU telemetry frames.
 */
class TieredScheduler {
  constructor({
    configs,
    getConnection,
    onSnapshot,
    onStatus = () => {},
    interval = () => 2000,
    onError = (_err, _cfg, _lane) => {},
    now = Date.now,
  }) {
    this.configs = configs;
    this.getConnection = getConnection;
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.interval = interval;
    this.onError = onError;
    this.now = now;

    this.focused = null;
    this.timer = null;
    this.stopped = false;

    // Track running lanes: Set of `${serverId}:${lane}`
    this.running = new Set();
    // Track last execution time: Map of `${serverId}:${lane}` -> number
    this.lastRun = new Map();

    // Cache per-server telemetry components
    this.serverStates = new Map();
  }

  getState(id) {
    let s = this.serverStates.get(id);
    if (!s) {
      s = {
        caps: null,
        gpus: [],
        processes: [],
        system: null,
        previousCpu: null,
        gpuUuidMap: new Map(),
      };
      this.serverStates.set(id, s);
    }
    return s;
  }

  buildSnapshot(cfg, state, lane) {
    return {
      id: cfg.id,
      status: 'online',
      error: '',
      gpus: state.gpus,
      processes: state.processes,
      cpuCores: state.system?.cpuCores || 0,
      cpuUsage: state.system?.cpuUsage ?? null,
      loadAvg: state.system?.loadAvg || [0, 0, 0],
      memUsed: state.system?.memUsed || 0,
      memTotal: state.system?.memTotal || 0,
      swapUsed: state.system?.swapUsed || 0,
      swapTotal: state.system?.swapTotal || 0,
      collectedAt: this.now(),
      lastLane: lane,
    };
  }

  async runLane(cfg, lane, fn) {
    const key = `${cfg.id}:${lane}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    this.lastRun.set(key, this.now());

    try {
      await fn();
    } catch (err) {
      this.onError(err, cfg, lane);
    } finally {
      this.running.delete(key);
    }
  }

  tick(force = null) {
    if (this.stopped) return;
    const nowMs = this.now();
    const serverList = this.configs();

    for (const cfg of serverList) {
      const isFocused = !this.focused || cfg.id === this.focused;
      const baseInterval = Math.max(200, this.interval());

      // Target durations per lane
      const gpuDuration = isFocused ? baseInterval : Math.max(baseInterval * 2, 2000);
      const sysDuration = isFocused ? Math.max(baseInterval, 1000) : Math.max(baseInterval * 4, 4000);
      const procDuration = isFocused ? 3000 : 8000;

      const conn = this.getConnection(cfg);
      if (!conn || (conn.isBackedOff && conn.isBackedOff())) continue;

      const state = this.getState(cfg.id);

      // Probe capabilities if not yet probed
      if (!state.caps) {
        const probeKey = `${cfg.id}:probe`;
        if (!this.running.has(probeKey)) {
          this.runLane(cfg, 'probe', async () => {
            const caps = await probeCapabilities(conn, cfg.id);
            state.caps = caps;
          });
        }
      }

      // 1. GPU Lane
      if (state.caps && state.caps.hasNvidiaSmi) {
        const lastGpu = this.lastRun.get(`${cfg.id}:gpu`) ?? -Infinity;
        if (force === cfg.id || nowMs - lastGpu >= gpuDuration) {
          this.runLane(cfg, 'gpu', async () => {
            const gpus = await pollGpus(conn, 3000);
            state.gpus = gpus;
            for (const g of gpus) {
              state.gpuUuidMap.set(g.uuid, g.index);
            }
            // Attach processes to GPUs
            for (const g of state.gpus) {
              const matched = state.processes.filter((p) => p.gpu === g.index || (p.gpuIndices && p.gpuIndices.includes(g.index)));
              g.procs = matched.map((p) => ({
                pid: p.pid,
                user: p.user,
                name: (p.command || '').split(/\s+/)[0].split('/').pop() || 'unknown',
                memMb: p.rssMb,
              }));
            }
            this.onSnapshot(this.buildSnapshot(cfg, state, 'gpu'));
          });
        }
      }

      // 2. System Lane
      const lastSys = this.lastRun.get(`${cfg.id}:system`) ?? -Infinity;
      if (force === cfg.id || nowMs - lastSys >= sysDuration) {
        this.runLane(cfg, 'system', async () => {
          const sys = await pollSystem(conn, state.previousCpu, 3000);
          state.system = sys;
          state.previousCpu = sys.cpuSample;
          this.onSnapshot(this.buildSnapshot(cfg, state, 'system'));
        });
      }

      // 3. Process Lane
      const lastProc = this.lastRun.get(`${cfg.id}:processes`) ?? -Infinity;
      if (force === cfg.id || nowMs - lastProc >= procDuration) {
        this.runLane(cfg, 'processes', async () => {
          const res = await pollProcesses(conn, state.gpuUuidMap, 6000);
          state.processes = res.processes;
          // Enrich GPU procs
          for (const g of state.gpus) {
            const procsFromGpu = res.gpuProcs.get(g.uuid) || [];
            if (procsFromGpu.length > 0) {
              g.procs = procsFromGpu;
            } else {
              const matched = state.processes.filter((p) => p.gpu === g.index || (p.gpuIndices && p.gpuIndices.includes(g.index)));
              g.procs = matched.map((p) => ({
                pid: p.pid,
                user: p.user,
                name: (p.command || '').split(/\s+/)[0].split('/').pop() || 'unknown',
                memMb: p.rssMb,
              }));
            }
          }
          this.onSnapshot(this.buildSnapshot(cfg, state, 'processes'));
        });
      }
    }
  }

  focus(id) {
    this.focused = id;
    if (id) this.tick(id);
  }

  start() {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    const live = new Set(this.configs().map((c) => c.id));
    for (const key of this.lastRun.keys()) {
      const srvId = key.split(':')[0];
      if (!live.has(srvId)) {
        this.lastRun.delete(key);
        this.serverStates.delete(srvId);
      }
    }
    // High-resolution interval check (every 50ms) to trigger lanes precisely
    this.timer = setInterval(() => this.tick(), 50);
    this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  TieredScheduler,
};
