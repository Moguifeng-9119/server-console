import type { Gpu, ProcessItem, Server } from './types';

const SERVER_SPECS: Array<{
  name: string;
  host: string;
  gpus: number;
  gpuName: string;
  memTotal: number;
  cores: number;
  memGb: number;
  users: string[];
}> = [
  { name: 'dgx-01', host: '10.20.1.11', gpus: 8, gpuName: 'NVIDIA A100-SXM4-80GB', memTotal: 81920, cores: 128, memGb: 512, users: ['lin', 'zhao'] },
  { name: 'dgx-02', host: '10.20.1.12', gpus: 8, gpuName: 'NVIDIA A100-SXM4-80GB', memTotal: 81920, cores: 128, memGb: 512, users: ['wang', 'lin'] },
  { name: 'a800-01', host: '10.20.1.13', gpus: 8, gpuName: 'NVIDIA A800-80GB', memTotal: 81920, cores: 96, memGb: 384, users: ['chen', 'sun'] },
  { name: 'rtx-4090-02', host: '10.20.1.24', gpus: 8, gpuName: 'NVIDIA RTX 4090', memTotal: 24564, cores: 64, memGb: 256, users: ['zhao', 'xu'] },
  { name: 'infer-01', host: '10.20.1.31', gpus: 4, gpuName: 'NVIDIA L20', memTotal: 46068, cores: 32, memGb: 128, users: ['ops'] },
];

const COMMANDS = [
  'python train.py --config configs/llama_7b.yaml --bs 32',
  'python -m torch.distributed.run --nproc 8 pretrain.py',
  'python eval.py --ckpt outputs/exp42 --split test',
  'jupyter-lab --ip 0.0.0.0 --port 8888',
  'python inference_server.py --model qwen2-7b --port 8000',
  'python data_preprocess.py --workers 16',
  '/usr/bin/dockerd -H fd://',
  'tensorboard --logdir runs --port 6006',
  'python ray_trainer.py --num-workers 8',
  'sshd: lin@pts/12',
  'systemd-journald',
  'nvidia-persistenced --persistence-mode',
  '/opt/conda/bin/python -c from multiprocessing.spawn import spawn_main',
];

const USERS = ['root', 'lin', 'zhao', 'wang', 'chen', 'sun', 'xu', 'ops', 'nobody'];

function rndInt(a: number, b: number) {
  return Math.floor(a + Math.random() * (b - a + 1));
}

function jitter(v: number, amount: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v + (Math.random() - 0.5) * 2 * amount));
}

function makeGpu(index: number, name: string, memTotal: number): Gpu {
  const util = rndInt(0, 100);
  const memUsed = Math.round(memTotal * (util > 20 ? 0.2 + Math.random() * 0.78 : Math.random() * 0.3));
  const procs: Gpu['procs'] = [];
  if (memUsed > 1024) {
    const n = rndInt(1, 3);
    let left = memUsed;
    for (let i = 0; i < n; i++) {
      const m = i === n - 1 ? left : Math.round(left * (0.3 + Math.random() * 0.5));
      left -= m;
      procs.push({ pid: rndInt(1000, 60000), name: Math.random() > 0.3 ? 'python' : 'docker-proxy', memMb: m });
    }
  }
  return {
    index,
    name,
    util,
    memUsed,
    memTotal,
    temp: Math.round(util * 0.45 + 32 + Math.random() * 8),
    power: Math.round(60 + util * 3.2 + Math.random() * 20),
    fan: Math.round(28 + util * 0.5),
    procs,
  };
}

function makeProcess(gpuCount: number): ProcessItem {
  const cmd = COMMANDS[rndInt(0, COMMANDS.length - 1)];
  const isGpu = Math.random() < 0.18 && gpuCount > 0;
  return {
    pid: rndInt(1000, 65000),
    user: USERS[rndInt(0, USERS.length - 1)],
    cpu: Math.round(Math.random() * (isGpu ? 780 : 120)) / 10,
    mem: Math.round(Math.random() * 120) / 10,
    rssMb: rndInt(80, 24000),
    state: (Math.random() < 0.02 ? 'Z' : Math.random() < 0.25 ? 'R' : 'S') as ProcessItem['state'],
    started: `${rndInt(0, 20)}:${String(rndInt(0, 59)).padStart(2, '0')}`,
    command: cmd,
    gpu: isGpu ? rndInt(0, gpuCount - 1) : null,
  };
}

export function createServers(): Server[] {
  return SERVER_SPECS.map((spec, i) => {
    const gpus = Array.from({ length: spec.gpus }, (_, g) => makeGpu(g, spec.gpuName, spec.memTotal));
    const processCount = rndInt(180, 420);
    const processes = Array.from({ length: processCount }, () => makeProcess(spec.gpus));
    // Use the same PID/user relationship as live GPU telemetry in the demo.
    for (const gpu of gpus) for (const proc of gpu.procs) {
      proc.user = spec.users[gpu.index % spec.users.length];
      processes.push({ pid: proc.pid, user: proc.user, cpu: rndInt(20, 90), mem: 1.5,
        rssMb: 2048, state: 'R', started: '09:00', command: 'python train.py', gpu: gpu.index, gpuIndices: [gpu.index] });
    }
    const avg = gpus.reduce((s, g) => s + g.util, 0) / gpus.length;
    return {
      id: `demo:s${i + 1}`,
      name: spec.name,
      host: spec.host,
      status: (i === 4 ? 'timeout' : 'online') as Server['status'],
      gpus,
      processes,
      history: Array.from({ length: 48 }, () => Math.max(0, Math.min(100, avg + (Math.random() - 0.5) * 18))),
      collectedAt: Date.now(),
      cpuCores: spec.cores,
      cpuUsage: Math.round(Math.random() * 70 + 10),
      loadAvg: [Math.round(Math.random() * 40) / 10, Math.round(Math.random() * 40) / 10, Math.round(Math.random() * 40) / 10],
      memUsed: Math.round(spec.memGb * (0.3 + Math.random() * 0.5) * 10) / 10,
      memTotal: spec.memGb,
      swapUsed: Math.round(Math.random() * 8 * 10) / 10,
      swapTotal: 64,
    };
  });
}

export function tick(s: Server): Server {
  if (s.status !== 'online') return s;
  const gpus = s.gpus.map((g) => {
    const util = Math.round(jitter(g.util, 7, 0, 100));
    const memUsed = Math.round(jitter(g.memUsed, g.memTotal * 0.02, 0, g.memTotal));
    return {
      ...g,
      util,
      memUsed,
      temp: Math.round(jitter(g.temp ?? 60, 1.5, 30, 92)),
      power: Math.round(jitter(g.power ?? 200, 12, 50, 450)),
      fan: Math.round(jitter(g.fan ?? 50, 3, 20, 100)),
    };
  });

  let processes = s.processes.map((p) => ({
    ...p,
    cpu: Math.round(Math.max(0, p.cpu + (Math.random() - 0.5) * 6) * 10) / 10,
    mem: Math.round(Math.max(0, p.mem + (Math.random() - 0.5) * 0.4) * 10) / 10,
  }));
  if (Math.random() < 0.35) processes = processes.slice(0, Math.max(60, processes.length + rndInt(-4, 4)));
  if (Math.random() < 0.2) processes = [...processes, makeProcess(gpus.length)];

  const avg = gpus.reduce((a, g) => a + g.util, 0) / gpus.length;
  return {
    ...s,
    gpus,
    processes,
    history: [...s.history.slice(-59), avg],
    cpuUsage: Math.round(Math.max(0, Math.min(100, (s.cpuUsage ?? 0) + (Math.random() - 0.5) * 8))),
    collectedAt: Date.now(),
    memUsed: Math.round(Math.max(0, Math.min(s.memTotal, s.memUsed + (Math.random() - 0.5) * 4)) * 10) / 10,
  };
}

export function killProcess(s: Server, pid: number): Server {
  const target = s.processes.find((p) => p.pid === pid);
  if (!target) return s;
  return {
    ...s,
    processes: s.processes.filter((p) => p.pid !== pid),
    gpus: s.gpus.map((g) => {
      const hit = g.procs.find((p) => p.pid === pid);
      if (!hit) return g;
      return { ...g, procs: g.procs.filter((p) => p.pid !== pid), memUsed: Math.max(0, g.memUsed - hit.memMb) };
    }),
  };
}
