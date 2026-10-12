import type { Gpu } from '../types';
import type { ServerTelemetryState } from '../types/monitoring';

export function freeGiBFromGpu(gpu: Gpu): number {
  return Math.max(0, gpu.memTotal - gpu.memUsed) / 1024;
}

export function isFreshTelemetry(
  telemetry: ServerTelemetryState,
  demo: boolean,
  refreshMs: number,
  now = Date.now(),
): boolean {
  if (demo) return true;
  if (!telemetry.collectedAt) return false;
  return now - telemetry.collectedAt < Math.max(45000, refreshMs * 12);
}

export function gpuOwnersFromTelemetry(telemetry: ServerTelemetryState, gpu: Gpu): string[] {
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
): Gpu[] {
  if (telemetry.status !== 'online') return [];
  const q = query.trim().toLowerCase();

  return telemetry.gpus.filter((gpu) => {
    if (gpu.memTotal <= 0 || freeGiBFromGpu(gpu) < Math.max(0, minGiB)) return false;
    if (model && gpu.name !== model) return false;
    if (!q) return true;

    const owners = gpuOwnersFromTelemetry(telemetry, gpu);
    const haystack = [serverName, serverHost, serverGroup, gpu.name, ...owners]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
