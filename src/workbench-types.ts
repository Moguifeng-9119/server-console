export interface TaskSchedule {
  start: string; // 'HH:MM' 窗口开始（服务器本地时间）
  end: string; // 'HH:MM' 窗口结束，支持跨夜（如 22:00–06:00）
  days: number[]; // 生效的星期（0=周日…6=周六）
  enabled: boolean;
  lastOccurrence?: string; // 上次触发的窗口起始日 YYYY-MM-DD（防同窗重复启动）
  lastStartAt?: number;
}
export interface WorkspaceTask { id: string; serverId: string; name: string; cwd: string; command: string; gpu?: string; status: string; remoteId?: string; sessionName?: string; exitCode?: number; startedAt?: number; finishedAt?: number; ownedLog?: string; schedule?: TaskSchedule }
export interface GpuWatch { id: string; serverId: string; model: string; minFreeGiB: number; durationSeconds: number; enabled: boolean }
export interface WorkbenchEvent { id: string; serverId: string; type: string; title: string; body?: string; at: number }
export interface AlertRule { id: string; serverId: string; name: string; metric: string; direction: string; threshold: number; recovery: number; durationSeconds: number; cooldownSeconds: number; quietStart?: string; quietEnd?: string; enabled: boolean }
export interface ServiceTemplate { name: string; serverId: string; remoteHost: string; remotePort: number; localPort: number; url: string; command: string }
export interface SystemResources {
  at: number; platform: string;
  filesystems: Array<{ mount: string; device: string; total: number; used: number; available: number; percent: number }>;
  inodes: Array<{ mount: string; total: number; used: number; available: number; percent: number }>;
  disks: Array<{ device: string; readBytesPerSecond: number | null; writeBytesPerSecond: number | null; busyPercent: number | null }>;
  networks: Array<{ device: string; receiveBytesPerSecond: number | null; transmitBytesPerSecond: number | null }>;
  capabilities: { procfs: boolean; containers: string[]; ratesReady: boolean };
}
export interface ContainerList { available: boolean; engine: string; statsError?: string; stats: Array<Record<string, string>>; containers: Array<{ id: string; name: string; image: string; status: string; ports: unknown }> }
export interface CommandTemplate { id: string; name: string; command: string }
export interface LogWatcher { id: string; serverId: string; name: string; path: string; patterns: string[]; trackLoss: boolean; enabled: boolean; lastLines?: string[]; lastHits?: Array<{ line: string; at: number }>; lossPoints?: number[]; backlogBytes?: number; lastPollAt?: number; lastError?: string; lastErrorAt?: number; progressPoints?: Array<{ at: number; loss?: number; step?: number; epoch?: number }> }
export interface EnvEntry { id: string; serverId: string; at: number; driver: string; cuda: string; kernel: string; os: string; python: string; torch: string }
export interface UsageRow { user: string; totalMinutes: number; byServer: Record<string, number> }
export interface ResourceReport { start: number; end: number; note: string; devices: Array<{ device: string; label: string; metric: string; average: number | null; peak: number | null; coveredMs: number; coveragePercent: number; busyEquivalentHours: number }>; tasks: Array<WorkspaceTask> }

export interface ExperimentWorkspace { id: string; serverId: string; name: string; cwd: string; gpu?: string; taskId?: string; sessionName?: string; logPath?: string; remotePort?: number; localPort?: number }
export interface SlurmResult { available: boolean; jobs?: Array<{ id: string; [key: string]: string }>;  output?: string }

export interface GpuDiagnostics { at: number; available: boolean; devices: Array<{ index: number; uuid: string; metrics: Record<string, { value: string | null; supported: boolean }> }>; layout: string; nvlink?: string }
