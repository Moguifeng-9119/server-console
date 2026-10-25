import type { Gpu, Server } from './types';

type SampleLike = { collectedAt?: number; laneTimestamps?: Partial<Record<string, number | undefined>> } & Pick<Partial<Server>, 'status' | 'name' | 'host' | 'group' | 'processes'>;

/** 指标在该 GPU 上可用（驱动有上报）；unavailableMetrics 中的为未知，占位 0 不算真实读数 */
export function gpuMetricAvailable(gpu: Gpu, metric: keyof Gpu | string): boolean {
  return !gpu.unavailableMetrics?.includes(String(metric));
}

export function freeGiB(gpu: Gpu): number {
  if (!gpuMetricAvailable(gpu, 'memTotal') || !gpuMetricAvailable(gpu, 'memUsed')) return Number.NaN;
  return Math.max(0, gpu.memTotal - gpu.memUsed) / 1024;
}

/** 单 GPU 数据新鲜度：GPU 通道独立采集，按自己的 observedAt 判断（无时间戳视为新鲜） */
export function isFreshGpu(gpu: Gpu, refreshMs: number, now: number): boolean {
  if (gpu.observedAt == null) return true;
  return now - gpu.observedAt < Math.max(4000, refreshMs * 4);
}

/**
 * 样本新鲜度。
 * 指定 lane：只看该通道时间戳（GPU/系统活动不应让过期进程表“显得新鲜”）；
 * 新格式数据（有 laneTimestamps）缺该通道时间戳 → 视为该通道未上报（过期）；
 * 旧格式（无 laneTimestamps）回退整体 collectedAt。
 * 未指定 lane：新格式看 GPU 通道（主通道）门控；旧格式看 collectedAt。
 */
export function isFreshSample(
  server: SampleLike,
  demo: boolean,
  refreshMs: number,
  now: number,
  lane?: string,
): boolean {
  if (demo) return true;
  const laneWindow = Math.max(8000, refreshMs * 8);
  const overallWindow = Math.max(45000, refreshMs * 12);
  if (server.laneTimestamps) {
    const key = lane ?? 'gpu'; // 整体新鲜度由 GPU 主通道门控
    const at = server.laneTimestamps[key];
    return at != null && now - at < laneWindow;
  }
  return !!server.collectedAt && now - server.collectedAt < overallWindow;
}

export function gpuOwners(server: Server, gpu: Gpu) {
  return [...new Set(gpu.procs.map((p) => p.user || server.processes.find((item) => item.pid === p.pid)?.user || '?'))];
}

export function matchingGpus(
  server: Server,
  minGiB: number,
  model: string,
  query: string,
  now = Date.now(),
  refreshMs = 2000,
): Gpu[] {
  if (server.status !== 'online') return [];
  const q = query.trim().toLowerCase();
  return server.gpus.filter((gpu) =>
    isFreshGpu(gpu, refreshMs, now)
    && gpu.memTotal > 0
    && gpuMetricAvailable(gpu, 'memTotal')
    && gpuMetricAvailable(gpu, 'memUsed')
    && freeGiB(gpu) >= Math.max(0, minGiB)
    && (!model || gpu.name === model)
    && (!q || [server.name, server.host, server.group, gpu.name, ...gpuOwners(server, gpu)].join(' ').toLowerCase().includes(q)));
}
