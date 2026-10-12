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
    if (f.length < 6) continue;
    const index = Math.floor(num(f[0]));
    gpus.push({
      index,
      uuid: f[1] || `gpu-${index}`,
      name: f[2] || 'GPU',
      util: Math.round(num(f[3])),
      memUsed: Math.round(num(f[4])),
      memTotal: Math.round(num(f[5])),
      temp: roundOrNull(f[6]),
      power: roundOrNull(f[7]),
      fan: roundOrNull(f[8]),
      procs: [],
    });
  }

  return gpus;
}

async function pollGpus(connection, timeoutMs = 4000) {
  const { stdout } = await connection.exec(GPU_CMD, timeoutMs);
  return parseGpuCsv(stdout);
}

module.exports = {
  GPU_CMD,
  parseGpuCsv,
  pollGpus,
};
