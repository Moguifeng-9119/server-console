import type { Gpu, Server } from './types';

export function freeGiB(gpu: Gpu) { return Math.max(0, gpu.memTotal - gpu.memUsed) / 1024; }
export function isFreshSample(server: Server, demo: boolean, refreshMs: number, now: number) {
  return demo || !!server.collectedAt && now - server.collectedAt < Math.max(45000, refreshMs * 12);
}
export function gpuOwners(server: Server, gpu: Gpu) {
  return [...new Set(gpu.procs.map((p) => p.user || server.processes.find((item) => item.pid === p.pid)?.user || '?'))];
}
export function matchingGpus(server: Server, minGiB: number, model: string, query: string) {
  if (server.status !== 'online') return [];
  const q = query.trim().toLowerCase();
  return server.gpus.filter((gpu) => gpu.memTotal > 0 && freeGiB(gpu) >= Math.max(0, minGiB)
    && (!model || gpu.name === model)
    && (!q || [server.name, server.host, server.group, gpu.name, ...gpuOwners(server, gpu)].join(' ').toLowerCase().includes(q)));
}
