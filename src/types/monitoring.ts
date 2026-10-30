import type { Gpu, ProcessItem, ServerStatus, SnapshotPayload } from '../types';

export type MonitoringLane = 'gpu' | 'system' | 'processes' | 'metadata' | 'health';
export type MonitoringKind = 'keyframe' | 'delta' | 'heartbeat' | 'gap' | 'controlAck';

export interface MonitoringFrame<T = unknown> {
  version: number;
  serverId: string;
  epoch: string;
  lane: MonitoringLane;
  seq: number;
  kind: MonitoringKind;
  metaRevision?: number;
  observedAt: number;
  receivedAt: number;
  payload: T;
}

export interface LaneHealth {
  lane: MonitoringLane;
  lastObservedAt: number | null;
  lastReceivedAt: number | null;
  healthy: boolean;
  effectiveRateHz?: number;
  reason?: string;
}

export interface MonitoringCapabilities {
  hasNvidiaSmi: boolean;
  loopMsSupported: boolean;
  pythonAvailable: boolean;
  minSupportedIntervalMs: number;
}

export interface ServerTelemetryState {
  gpuProcessesAvailable?: boolean;
  laneTimestamps?: SnapshotPayload['laneTimestamps'];
  monitoring?: SnapshotPayload['monitoring'];
  serverId: string;
  status: ServerStatus;
  error?: string;
  gpus: Gpu[];
  processes: ProcessItem[];
  cpuCores: number;
  cpuUsage: number | null;
  loadAvg: [number, number, number];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  collectedAt: number | null;
  lastGpuAt: number | null;
  lastSystemAt: number | null;
  lastProcessAt: number | null;
}

export function createEmptyTelemetry(serverId: string): ServerTelemetryState {
  return {
    serverId,
    status: 'offline',
    error: '',
    gpus: [],
    processes: [],
    cpuCores: 0,
    cpuUsage: null,
    loadAvg: [0, 0, 0],
    memUsed: 0,
    memTotal: 0,
    swapUsed: 0,
    swapTotal: 0,
    collectedAt: null,
    lastGpuAt: null,
    lastSystemAt: null,
    lastProcessAt: null,
  };
}
