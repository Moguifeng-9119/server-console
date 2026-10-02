export type ProcState = 'R' | 'S' | 'D' | 'Z' | 'T';

export interface GpuProc {
  pid: number;
  name: string;
  memMb: number;
}

export interface Gpu {
  index: number;
  name: string;
  util: number;
  memUsed: number;
  memTotal: number;
  temp: number | null;
  power: number | null;
  fan: number | null;
  procs: GpuProc[];
}

export interface ProcessItem {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rssMb: number;
  state: ProcState;
  started: string;
  command: string;
  gpu: number | null;
}

export type ServerStatus = 'online' | 'offline' | 'auth' | 'timeout';

export interface Server {
  id: string;
  name: string;
  host: string;
  status: ServerStatus;
  group?: string;
  gpus: Gpu[];
  processes: ProcessItem[];
  history: number[];
  cpuCores: number;
  cpuUsage: number;
  loadAvg: [number, number, number];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  keyPath?: string;
  group?: string; // 分组（侧栏分区显示）
  proxyJump?: string; // 跳板机 [user@]host[:port]
  agentPath?: string; // 自定义 ssh-agent 路径（authType=agent 时可选）
}

export interface SnapshotPayload {
  id: string;
  status: ServerStatus;
  error: string;
  gpus: Gpu[];
  processes: ProcessItem[];
  cpuCores: number;
  cpuUsage: number;
  loadAvg: [number, number, number];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
}

export interface AuditEntry {
  id: number;
  time: string;
  server: string;
  action: string;
  target: string;
  result: 'ok' | 'failed';
}

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  title: string;
  detail?: string;
}

// ============ 文件管理 / SFTP ============
export type FileKind = 'dir' | 'file' | 'link';

export interface FileEntry {
  name: string;
  type: FileKind;
  size: number;
  mtime: number;
  rights?: string;
  path?: string; // 本地条目：绝对路径
  linkToDir?: boolean; // 远程符号链接且指向目录
  longname?: string;
}

export interface DirListing {
  path: string;
  parent?: string;
  entries: FileEntry[];
}

export type TransferStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled';
export type TransferKind = 'upload' | 'download' | 'relay';

export interface TransferFileTick {
  name: string;
  at: number;
}

export interface TransferItem {
  id: string;
  kind: TransferKind;
  name: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  speed: number;
  error?: string;
  groupId?: string;
  filesTotal?: number; // 目录任务：发现的文件总数（边遍历边增长）
  filesDone?: number; // 目录任务：已完成文件数
  recentFiles?: TransferFileTick[]; // 最近传输的文件流（环形，仅实时）
  srcPath?: string; // 完整源路径（含服务器名）
  dstPath?: string; // 完整目标路径（含服务器名）
  direct?: boolean; // 服务器互传是否走"服务器直传"（数据不过本机）
  directMode?: string; // 直传实际采用的方式：rsync / tar / scp
  directNote?: string; // 直传能力探测与回退诊断信息
  waitConflict?: boolean; // 排队中且同目标任务正在传输（互斥保护，避免交错写入）
  serverName?: string;
  peerName?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface SshKeyCandidate {
  name: string;
  path: string;
  preferred: boolean;
}

export interface SshHostEntry {
  alias: string;
  allAliases: string[];
  host: string;
  port: number;
  user: string;
  keyPath: string;
  keyExists: boolean;
  keyCandidates: string[];
  ownKeyCandidates: string[];
  proxyJump?: string;
}

export interface SshConfigInfo {
  home: string;
  sshDir: string;
  configPath: string;
  configExists: boolean;
  keys: SshKeyCandidate[];
}

export interface ConfigChange {
  path: string;
  added: SshHostEntry[];
  changed: Array<{ targetId: string; alias: string; host: string; fromPort: number; toPort: number; keyPath: string; entry: SshHostEntry }>;
  removed: Array<{ targetId: string; alias: string; name: string; host: string }>;
}

// 主进程 wrap() 的统一返回
export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// 已信任的主机指纹（TOFU 信任库条目）
export interface TrustedHost {
  keyId: string; // 'host|port'
  host: string;
  port: number;
  type: string; // 密钥算法，如 ssh-ed25519
  fp: string; // SHA256:... 指纹
  firstSeen: number;
}
