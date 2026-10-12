import { useSyncExternalStore, useCallback } from 'react';
import type { SnapshotPayload, ServerStatus, Gpu, ProcessItem } from '../types';
import { createEmptyTelemetry, type ServerTelemetryState } from '../types/monitoring';

type Listener = () => void;

export class TelemetryStore {
  private states = new Map<string, ServerTelemetryState>();
  private serverListeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  getServer(serverId: string): ServerTelemetryState {
    let state = this.states.get(serverId);
    if (!state) {
      state = createEmptyTelemetry(serverId);
      this.states.set(serverId, state);
    }
    return state;
  }

  ingestSnapshot(snap: SnapshotPayload) {
    const prev = this.getServer(snap.id);
    const now = Date.now();
    const collectedAt = snap.collectedAt ?? now;

    const next: ServerTelemetryState = {
      serverId: snap.id,
      status: snap.status,
      error: snap.error || '',
      gpus: snap.gpus || [],
      processes: snap.processes || [],
      cpuCores: snap.cpuCores ?? prev.cpuCores,
      cpuUsage: snap.cpuUsage ?? null,
      loadAvg: snap.loadAvg || [0, 0, 0],
      memUsed: snap.memUsed ?? 0,
      memTotal: snap.memTotal ?? 0,
      swapUsed: snap.swapUsed ?? 0,
      swapTotal: snap.swapTotal ?? 0,
      collectedAt,
      lastGpuAt: snap.gpus && snap.gpus.length > 0 ? collectedAt : prev.lastGpuAt,
      lastSystemAt: collectedAt,
      lastProcessAt: snap.processes && snap.processes.length > 0 ? collectedAt : prev.lastProcessAt,
    };

    this.states.set(snap.id, next);
    this.notifyServer(snap.id);
  }

  updateStatus(serverId: string, status: ServerStatus, error = '') {
    const prev = this.getServer(serverId);
    if (prev.status === status && prev.error === error) return;
    const next: ServerTelemetryState = {
      ...prev,
      status,
      error,
    };
    this.states.set(serverId, next);
    this.notifyServer(serverId);
  }

  subscribeServer(serverId: string, listener: Listener): () => void {
    let set = this.serverListeners.get(serverId);
    if (!set) {
      set = new Set();
      this.serverListeners.set(serverId, set);
    }
    set.add(listener);
    return () => {
      const current = this.serverListeners.get(serverId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) this.serverListeners.delete(serverId);
      }
    };
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  clear() {
    this.states.clear();
    this.serverListeners.clear();
    this.globalListeners.clear();
  }

  private notifyServer(serverId: string) {
    const listeners = this.serverListeners.get(serverId);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(); } catch { /* ignore subscriber error */ }
      }
    }
    for (const fn of this.globalListeners) {
      try { fn(); } catch { /* ignore subscriber error */ }
    }
  }
}

export const telemetryStore = new TelemetryStore();

/**
 * Hook to subscribe to a single server's telemetry.
 * Only triggers re-render when the specific server's telemetry updates.
 */
export function useServerTelemetry(serverId: string): ServerTelemetryState {
  const subscribe = useCallback(
    (onStoreChange: () => void) => telemetryStore.subscribeServer(serverId, onStoreChange),
    [serverId],
  );
  const getSnapshot = useCallback(
    () => telemetryStore.getServer(serverId),
    [serverId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to read just the GPUs for a specific server with stable subscription.
 */
export function useServerGpus(serverId: string): Gpu[] {
  const telemetry = useServerTelemetry(serverId);
  return telemetry.gpus;
}

/**
 * Hook to read just the processes for a specific server.
 */
export function useServerProcesses(serverId: string): ProcessItem[] {
  const telemetry = useServerTelemetry(serverId);
  return telemetry.processes;
}
