// Process collector: queries GPU compute applications and system processes
const PROC_CMD = [
  'nvidia-smi --query-compute-apps=gpu_uuid,pid,used_memory --format=csv,noheader,nounits 2>/dev/null',
  'echo __PS__',
  'ps -eo pid,user,pcpu,pmem,rss,stat,etime,args --no-headers',
].join('; ');

function num(v, fallback = 0) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseProcesses(raw, gpuUuidMap = new Map()) {
  const parts = String(raw || '').split('__PS__');
  const appRaw = (parts[0] || '').trim();
  const psRaw = (parts[1] || '').trim();

  // Map pid -> array of { index, memMb }
  const pidToGpu = new Map();
  for (const line of appRaw ? appRaw.split('\n') : []) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length < 3) continue;
    const uuid = f[0];
    const pid = num(f[1]);
    const memMb = num(f[2]);
    const idx = gpuUuidMap.get(uuid) ?? null;
    const cards = pidToGpu.get(pid) || [];
    cards.push({ uuid, index: idx, memMb });
    pidToGpu.set(pid, cards);
  }

  const processes = [];
  for (const line of psRaw ? psRaw.split('\n') : []) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = num(m[1]);
    const cards = pidToGpu.get(pid) || [];
    processes.push({
      pid,
      user: m[2],
      cpu: num(m[3]),
      mem: num(m[4]),
      rssMb: Math.round(num(m[5]) / 1024),
      state: m[6].charAt(0),
      started: m[7],
      command: m[8],
      gpu: cards.length > 0 ? cards[0].index : null,
      gpuIndices: cards.map((c) => c.index).filter((i) => i !== null),
    });
  }

  // Construct GPU procs map: uuid or index -> list of process info
  const gpuProcs = new Map();
  for (const [pid, cards] of pidToGpu) {
    const proc = processes.find((p) => p.pid === pid);
    const user = proc ? proc.user : undefined;
    const name = proc ? proc.command.split(/\s+/)[0].split('/').pop() : 'unknown';
    for (const card of cards) {
      const key = card.uuid;
      const list = gpuProcs.get(key) || [];
      list.push({ pid, user, name, memMb: card.memMb, index: card.index });
      gpuProcs.set(key, list);
    }
  }

  return { processes, gpuProcs };
}

async function pollProcesses(connection, gpuUuidMap = new Map(), timeoutMs = 8000) {
  const { stdout } = await connection.exec(PROC_CMD, timeoutMs);
  return parseProcesses(stdout, gpuUuidMap);
}

module.exports = {
  PROC_CMD,
  parseProcesses,
  pollProcesses,
};
