// High-speed GPU poller: queries dynamic GPU metrics without executing ps or system commands
const GPU_CMD = 'nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits 2>/dev/null';

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function roundOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'N/A' || s === '[N/A]' || s === 'ERR!' || s === 'ERR') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseGpuCsv(raw) {
  const gpus = [];
  if (!raw || typeof raw !== 'string') return gpus;

  for (const line of raw.split('\n')) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length !== 9 || !/^\d+$/.test(f[0]) || !f[1]) continue;
    const index = Math.floor(num(f[0]));
    const metrics = Object.fromEntries(['util', 'memUsed', 'memTotal', 'temp', 'power', 'fan'].map((key, i) => [key, roundOrNull(f[i + 3])]));
    gpus.push({
      index,
      uuid: f[1] || `gpu-${index}`,
      name: f[2] || 'GPU',
      // Numeric compatibility fields are paired with explicit availability;
      // consumers must never treat these placeholders as observed zeros.
      util: metrics.util ?? 0,
      memUsed: metrics.memUsed ?? 0,
      memTotal: metrics.memTotal ?? 0,
      temp: metrics.temp,
      power: metrics.power,
      fan: metrics.fan,
      unavailableMetrics: Object.keys(metrics).filter((key) => metrics[key] === null),
      procs: [],
    });
  }

  return gpus;
}

async function pollGpus(connection, timeoutMs = 4000) {
  const { stdout, stderr, code, signal } = await connection.exec(GPU_CMD, timeoutMs);
  if (signal || code !== undefined && code !== 0) throw new Error(stderr || `GPU query failed (${signal || code})`);
  return parseGpuCsv(stdout);
}

module.exports = {
  GPU_CMD,
  parseGpuCsv,
  pollGpus,
};
