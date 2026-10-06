import type {
  AuditEntry,
  CredentialInfo,
  HistoryPoint,
  ConfigChange,
  DirListing,
  FileEntry,
  ForwardingRule,
  IpcResult,
  ServerConfig,
  SnapshotPayload,
  SshConfigInfo,
  SshHostEntry,
  TerminalSessionInfo,
  TransferItem,
  TrustedHost,
} from './types';

interface Api {
  platform: string;
  pathForFile: (file: File) => string;
  onConfirmQuit: (cb: () => void) => () => void;
  backgroundContinue: () => void;
  forceQuit: () => void;
  setTitleBarTheme: (theme: 'light' | 'dark') => Promise<boolean>;
  notify: (title: string, body: string) => Promise<void>;
  storeInfo: () => Promise<CredentialInfo>;
  auditList: () => Promise<AuditEntry[]>;
  auditAppend: (entry: { time: string; server: string; action: string; target: string; result: 'ok' | 'failed' }) => Promise<boolean>;
  hostKeysList: () => Promise<TrustedHost[]>;
  hostKeysRemove: (keyId: string) => Promise<boolean>;
  securityGet: () => Promise<{ tofu: boolean }>;
  securitySet: (o: { tofu?: boolean }) => Promise<{ tofu: boolean }>;
  listServers: () => Promise<ServerConfig[]>;
  addServer: (cfg: Partial<ServerConfig> & { password?: string; passphrase?: string }) => Promise<{ ok: boolean; server?: ServerConfig; error?: string }>;
  updateServer: (cfg: Partial<ServerConfig> & { id: string; password?: string; passphrase?: string }) => Promise<{ ok: boolean; server?: ServerConfig; error?: string }>;
  removeServer: (id: string) => Promise<boolean>;
  testServer: (cfg: Partial<ServerConfig> & { password?: string; passphrase?: string }) => Promise<{ ok: boolean; error?: string; gpus?: number; processes?: number }>;
  setInterval: (ms: number) => Promise<number>;
  setFocusedServer: (id: string | null) => Promise<boolean>;
  kill: (id: string, pid: number, signal: 'TERM' | 'KILL') => Promise<{ ok: boolean; error?: string }>;
  restartService: (id: string, service: string) => Promise<{ ok: boolean; error?: string }>;
  exec: (id: string, cmd: string) => Promise<IpcResult<{ stdout: string; stderr: string }>>;
  onKeyboardInteractive: (cb: (data: { reqId: string; title: string; prompts: string[] }) => void) => () => void;
  submitInteractive: (reqId: string, answers: string[]) => Promise<boolean>;

  parallelRun: (ids: string[], cmd: string) => Promise<IpcResult<string>>;
  parallelStop: (runId: string) => Promise<unknown>;
  onParallelData: (cb: (d: { runId: string; serverId: string; text?: string; done?: boolean }) => void) => () => void;
  onParallelDone: (cb: (d: { runId: string }) => void) => () => void;

  forwardingsList: () => Promise<ForwardingRule[]>;
  forwardingsUpsert: (rule: Partial<ForwardingRule>) => Promise<IpcResult<string>>;
  forwardingsRemove: (id: string) => Promise<IpcResult<boolean>>;
  forwardingsStart: (id: string) => Promise<IpcResult<boolean>>;
  forwardingsStop: (id: string) => Promise<IpcResult<boolean>>;
  onForwardingsChanged: (cb: (list: ForwardingRule[]) => void) => () => void;

  snippetsList: () => Promise<Array<{ id: string; name: string; cmd: string }>>;
  snippetsSet: (list: Array<{ id: string; name: string; cmd: string }>) => Promise<boolean>;

  webhookGet: () => Promise<{ url: string }>;
  webhookSet: (o: { url: string }) => Promise<boolean>;
  webhookSend: (payload: { title: string; body: string }) => Promise<IpcResult<boolean>>;

  setAppSettings: (o: { closeAction?: 'ask' | 'minimize' | 'exit' }) => Promise<boolean>;
  getAppSettings: () => Promise<{ closeAction: 'ask' | 'minimize' | 'exit'; language?: string }>;
  setAppLanguage: (lang: string) => Promise<boolean>;
  showMainWindow: () => void;
  checkUpdate: () => Promise<IpcResult<{ latest: string; current: string; isNew: boolean; url: string }>>;
  configExport: (passphrase: string) => Promise<IpcResult<string>>;
  configImport: (passphrase: string) => Promise<IpcResult<number>>;

  terminalOpen: (id: string, cols: number, rows: number) => Promise<IpcResult<string>>;
  terminalList: () => Promise<TerminalSessionInfo[]>;
  terminalAttach: (termId: string) => Promise<string>;
  terminalDetach: (termId: string) => Promise<boolean>;
  terminalWrite: (termId: string, data: string) => Promise<unknown>;
  terminalResize: (termId: string, cols: number, rows: number) => Promise<unknown>;
  terminalClose: (termId: string) => Promise<unknown>;
  onTerminalData: (cb: (d: { termId: string; data: string }) => void) => () => void;
  onTerminalClosed: (cb: (d: { termId: string }) => void) => () => void;
  onTerminalSessions: (cb: (list: TerminalSessionInfo[]) => void) => () => void;

    historyLoad: () => Promise<Record<string, HistoryPoint[]>>;
  historySave: (map: Record<string, HistoryPoint[]>) => Promise<boolean>;
  onSnapshot: (cb: (s: SnapshotPayload) => void) => () => void;
  onStatus: (cb: (s: { id: string; status: string; error: string }) => void) => () => void;

  // 本机对话框
  dlgOpenFiles: () => Promise<string[]>;
  dlgOpenDir: () => Promise<string>;
  dlgPickKey: () => Promise<string>;
  dlgSave: (opts?: { defaultPath?: string; title?: string }) => Promise<string>;

  // SSH config
  sshConfigDefault: () => Promise<SshConfigInfo>;
  sshConfigRead: (p: string) => Promise<IpcResult<{ path: string; entries: SshHostEntry[] }>>;
  sshConfigStatKey: (p: string) => Promise<IpcResult<{ path: string; exists: boolean }>>;
  sshConfigRefresh: (p?: string) => Promise<{ entries: SshHostEntry[]; added: SshHostEntry[]; changed: ConfigChange['changed']; removed: ConfigChange['removed'] }>;
  onConfigChanged: (cb: (c: ConfigChange) => void) => () => void;

  // 本地文件系统
  localList: (p?: string) => Promise<IpcResult<DirListing>>;
  localHome: () => Promise<string>;
  localRoots: () => Promise<string[]>;
  localMkdir: (p: string) => Promise<IpcResult<string>>;
  localRename: (from: string, to: string) => Promise<IpcResult<boolean>>;
  localDelete: (p: string) => Promise<IpcResult<boolean>>;

  // 远程 SFTP
  sftpList: (id: string, p?: string) => Promise<IpcResult<DirListing>>;
  sftpHome: (id: string) => Promise<IpcResult<string>>;
  sftpMkdir: (id: string, p: string) => Promise<IpcResult<string>>;
  sftpRename: (id: string, from: string, to: string) => Promise<IpcResult<boolean>>;
  sftpDelete: (id: string, p: string) => Promise<IpcResult<boolean>>;
  sftpStat: (id: string, p: string) => Promise<IpcResult<{ size: number; type: string }>>;
  sftpReadText: (id: string, p: string, tail?: boolean) => Promise<IpcResult<{ text: string; truncated: boolean; mode: string; size?: number }>>;
  sftpWriteText: (id: string, p: string, text: string) => Promise<IpcResult<boolean>>;
  sftpSearch: (id: string, base: string, keyword: string) => Promise<IpcResult<{ base: string; paths: string[] }>>;
  sftpArchive: (id: string, cwd: string, names: string[], archiveName: string) => Promise<IpcResult<{ name: string }>>;
  sftpExtract: (id: string, cwd: string, p: string) => Promise<IpcResult<{ ok: boolean }>>;
  sftpChmod: (id: string, p: string, mode: string | number) => Promise<IpcResult<boolean>>;

  // 传输队列
  transferList: () => Promise<TransferItem[]>;
  transferPause: (id: string) => Promise<unknown>;
  transferCancel: (id: string) => Promise<unknown>;
  transferResume: (id: string) => Promise<unknown>;
  transferRetry: (id: string) => Promise<unknown>;
  transferRemove: (id: string) => Promise<unknown>;
  transferForgetLegacy: (id: string) => Promise<boolean>;
  transferClear: () => Promise<unknown>;
  transferPauseAll: () => Promise<unknown>;
  transferResumeAll: () => Promise<unknown>;
  transferCancelMany: (ids: string[]) => Promise<unknown>;
  transferRetryFailed: () => Promise<unknown>;
  transferMove: (id: string, dir: 'up' | 'down') => Promise<unknown>;
  transferConcurrency: (n: number) => Promise<number>;
  transferOptions: (o: { notifyDone?: boolean; notifyFail?: boolean; limitBytes?: number; verify?: boolean }) => Promise<unknown>;
  transferUpload: (id: string, localPaths: string[], remoteDir: string, serverName?: string) => Promise<IpcResult<TransferItem[]>>;
  transferDownload: (
    id: string,
    items: Array<Pick<FileEntry, 'name' | 'type' | 'size' | 'path' | 'linkToDir'>>,
    localDir: string,
    serverName?: string,
  ) => Promise<IpcResult<TransferItem[]>>;
  transferRelay: (
    srcId: string,
    dstId: string,
    items: Array<Pick<FileEntry, 'name' | 'type' | 'size' | 'path' | 'linkToDir'>>,
    dstDir: string,
    srcName?: string,
    dstName?: string,
    ignoreExisting?: boolean,
  ) => Promise<IpcResult<TransferItem[]>>;
  onTransferUpdate: (cb: (t: TransferItem) => void) => () => void;
}

declare global {
  interface Window {
    api?: Api;
  }
}

export const api = typeof window !== 'undefined' ? window.api : undefined;
export const isElectron = Boolean(typeof window !== 'undefined' && window.api);
