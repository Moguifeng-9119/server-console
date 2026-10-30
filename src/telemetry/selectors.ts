import type { Gpu } from '../types';
import type { ServerTelemetryState } from '../types/monitoring';
import { freeGiB, gpuMetricAvailable, isFreshGpu, isFreshSample } from '../resources';

export function freeGiBFromGpu(gpu: Gpu): number {
  return freeGiB(gpu);
}

export function isFreshTelemetry(
  telemetry: ServerTelemetryState,
  demo: boolean,
  refreshMs: number,
  now = Date.now(),
): boolean {
  return isFreshSample({ collectedAt: telemetry.collectedAt ?? undefined, laneTimestamps: telemetry.laneTimestamps, monitoring: telemetry.monitoring }, demo, refreshMs, now);
}

export function gpuOwnersFromTelemetry(telemetry: ServerTelemetryState, gpu: Gpu): string[] {
  if (telemetry.gpuProcessesAvailable === false) return ['?'];
  const processUsers = new Map<number, string>();
  for (const p of telemetry.processes) {
    if (p.user) processUsers.set(p.pid, p.user);
  }

  const owners = new Set<string>();
  for (const proc of gpu.procs) {
    const user = proc.user || processUsers.get(proc.pid) || '?';
    owners.add(user);
  }
  return [...owners];
}

export function matchingGpusFromTelemetry(
  telemetry: ServerTelemetryState,
  minGiB: number,
  model: string,
  query: string,
  serverName = '',
  serverHost = '',
  serverGroup = '',
  now = Date.now(),
  refreshMs = telemetry.monitoring?.effectiveIntervalMs ?? 2000,
): Gpu[] {
  if (telemetry.status !== 'online' || !isFreshTelemetry(telemetry, false, refreshMs, now)) return [];
  const q = query.trim().toLowerCase();

  return telemetry.gpus.filter((gpu) => {
    if (!isFreshGpu(gpu, refreshMs, now) || !gpuMetricAvailable(gpu, 'memTotal') || !gpuMetricAvailable(gpu, 'memUsed') || gpu.memTotal <= 0 || freeGiBFromGpu(gpu) < Math.max(0, minGiB)) return false;
    if (model && gpu.name !== model) return false;
    if (!q) return true;

    const owners = gpuOwnersFromTelemetry(telemetry, gpu);
    const haystack = [serverName, serverHost, serverGroup, gpu.name, ...owners]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
