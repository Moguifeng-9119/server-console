export interface WorkspaceTask { id: string; serverId: string; name: string; cwd: string; command: string; gpu?: string; status: string; remoteId?: string; sessionName?: string; exitCode?: number; startedAt?: number; finishedAt?: number; ownedLog?: string }
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
export interface ResourceReport { start: number; end: number; note: string; devices: Array<{ device: string; label: string; metric: string; average: number | null; peak: number | null; coveredMs: number; coveragePercent: number; busyEquivalentHours: number }>; tasks: Array<WorkspaceTask> }
