// System collector: reads CPU counters and system memory metrics
const SYS_CMD = 'cat /proc/loadavg; nproc; free -b; echo __CPU__; head -n 1 /proc/stat';

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function parseSystem(raw, previousCpu = null) {
  const parts = String(raw || '').split('__CPU__');
  const sysRaw = parts[0].trim();
  const cpuLine = (parts[1] || '').trim();

  const lines = sysRaw.split('\n').map((l) => l.trim());
  const load = (lines[0] || '0 0 0').split(/\s+/).slice(0, 3).map((x) => num(x));
  const cpuCores = Math.max(1, Math.floor(num(lines[1], 1)));

  const memLine = (lines.find((l) => l.startsWith('Mem:')) || '').split(/\s+/);
  const swapLine = (lines.find((l) => l.startsWith('Swap:')) || '').split(/\s+/);
  const toGb = (v) => Math.round((num(v) / 1024 ** 3) * 10) / 10;

  const memTotal = toGb(memLine[1]);
  const memUsed = toGb(memLine[2]);
  const swapTotal = toGb(swapLine[1]);
  const swapUsed = toGb(swapLine[2]);

  let cpuUsage = null;
  let cpuSample = previousCpu;

  if (cpuLine.startsWith('cpu')) {
    const fields = cpuLine.split(/\s+/).slice(1).map((x) => num(x));
    if (fields.length >= 4) {
      const idle = (fields[3] || 0) + (fields[4] || 0);
      // guest and guest_nice are already included in user/nice counters.
      const total = fields.slice(0, 8).reduce((sum, item) => sum + item, 0);
      if (previousCpu && total > previousCpu.total) {
        const deltaTotal = total - previousCpu.total;
        const deltaIdle = idle - previousCpu.idle;
        cpuUsage = Math.max(0, Math.min(100, Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100)));
      }
      cpuSample = { total, idle };
    }
  }

  return {
    loadAvg: [load[0] || 0, load[1] || 0, load[2] || 0],
    cpuCores,
    memTotal,
    memUsed,
    swapTotal,
    swapUsed,
    cpuUsage,
    cpuSample,
  };
}

async function pollSystem(connection, previousCpu = null, timeoutMs = 4000) {
  const { stdout, stderr, code, signal } = await connection.exec(SYS_CMD, timeoutMs);
  if (signal || code !== undefined && code !== 0) throw new Error(stderr || `System query failed (${signal || code})`);
  if (!String(stdout).includes('__CPU__')) throw new Error('System query returned an unsupported response');
  return parseSystem(stdout, previousCpu);
}

module.exports = {
  SYS_CMD,
  parseSystem,
  pollSystem,
};
