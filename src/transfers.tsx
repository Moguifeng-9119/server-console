import i18n from './i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { FileEntry, TransferItem } from './types';

const HIST_WINDOW = 60_000; // 瞬时速度曲线保留近 60s
const LS_CONC = 'sc.tf.concurrency';
const LS_OPTS = 'sc.tf.opts';
const LS_LIMIT = 'sc.tf.limit';

interface TransferStore {
  items: TransferItem[];
  runningCount: number;
  pendingCount: number;
  doneCount: number;
  errorCount: number;
  queuedCount: number;
  upload: (serverId: string, localPaths: string[], remoteDir: string, serverName?: string) => Promise<number>;
  download: (serverId: string, items: FileEntry[], localDir: string, serverName?: string) => Promise<number>;
  relay: (srcId: string, dstId: string, items: FileEntry[], dstDir: string, srcName?: string, dstName?: string, ignoreExisting?: boolean) => Promise<number>;
  pause: (id: string) => void;
  cancel: (id: string) => void;
  resume: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  pauseAll: () => void;
  resumeAll: () => void;
  cancelMany: (ids: string[]) => void;
  retryFailed: () => void;
  move: (id: string, dir: 'up' | 'down') => void;
  setConcurrency: (n: number) => void;
  concurrency: number;
  limitMB: number;
  setLimitMB: (n: number) => void;
  notifyOpts: { notifyDone: boolean; notifyFail: boolean; sound: boolean };
  setNotifyOpts: (o: Partial<{ notifyDone: boolean; notifyFail: boolean; sound: boolean }>) => void;
  getSpeedHistory: (id: string) => number[];
  refresh: () => void;
}

const Ctx = createContext<TransferStore | null>(null);
const CommandsCtx = createContext<Pick<TransferStore, 'upload' | 'download'> | null>(null);

// 失败轻提示音（WebAudio 合成，无需音频文件）
function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type = 'sine';
    o.frequency.value = 620;
    g.gain.setValueAtTime(0.06, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
    o.start();
    o.stop(ac.currentTime + 0.36);
    o.onended = () => ac.close().catch(() => {});
  } catch {
    /* 音频不可用则忽略 */
  }
}

function loadOpts() {
  try {
    return { notifyDone: true, notifyFail: true, sound: true, ...(JSON.parse(localStorage.getItem(LS_OPTS) || '{}') as Record<string, boolean>) };
  } catch {
    return { notifyDone: true, notifyFail: true, sound: true };
  }
}

export function TransferProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TransferItem[]>([]);
  const [concurrency, setConcurrencyState] = useState<number>(() => {
    const n = Number(localStorage.getItem(LS_CONC));
    return n >= 1 && n <= 15 ? n : 15;
  });
  const [notifyOpts, setNotifyOptsState] = useState(loadOpts);
  const [limitMB, setLimitMBState] = useState<number>(() => {
    const n = Number(localStorage.getItem(LS_LIMIT));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const speedHist = useRef<Record<string, number[]>>([] as unknown as Record<string, number[]>);
  const histTime = useRef<Record<string, number[]>>([] as unknown as Record<string, number[]>);
  const prevStatus = useRef<Record<string, string>>({});
  const optsRef = useRef(notifyOpts);
  optsRef.current = notifyOpts;

  const pushHist = useCallback((id: string, speed: number) => {
    const now = Date.now();
    if (!speedHist.current[id]) {
      speedHist.current[id] = [];
      histTime.current[id] = [];
    }
    const ts = histTime.current[id];
    const vs = speedHist.current[id];
    ts.push(now);
    vs.push(speed);
    // 裁剪到近 60s
    while (ts.length && now - ts[0] > HIST_WINDOW) {
      ts.shift();
      vs.shift();
    }
  }, []);

  const getSpeedHistory = useCallback((id: string) => speedHist.current[id] || [], []);

  const refresh = useCallback(() => {
    api?.transferList().then(setItems);
  }, []);

  useEffect(() => {
    if (!api) return;
    api.transferList().then(setItems);
    // 启动时把本地保存的并发上限与通知选项同步给主进程
    api.transferConcurrency(concurrency);
    api.transferOptions({ notifyDone: notifyOpts.notifyDone, notifyFail: notifyOpts.notifyFail, limitBytes: limitMB * 1024 * 1024 });
    const off = api.onTransferUpdate((t) => {
      pushHist(t.id, t.speed || 0);
      // 任务新进入失败态：轻提示音
      const before = prevStatus.current[t.id];
      if (before && before !== 'error' && t.status === 'error' && optsRef.current.sound) beep();
      prevStatus.current[t.id] = t.status;
      setItems((prev) => {
        const i = prev.findIndex((x) => x.id === t.id);
        if (i < 0) return [...prev, t];
        const next = [...prev];
        next[i] = t;
        return next;
      });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(
    async (serverId: string, localPaths: string[], remoteDir: string, serverName?: string) => {
      if (!api) return 0;
      const r = await api.transferUpload(serverId, localPaths, remoteDir, serverName);
      if (!r.ok) throw new Error(r.error || i18n.t('files.uploadFail'));
      // 新任务由 transfer:update 增量广播加入，不再全量拉取列表
      return r.data?.length ?? 0;
    },
    [],
  );

  const download = useCallback(
    async (serverId: string, sel: FileEntry[], localDir: string, serverName?: string) => {
      if (!api) return 0;
      const r = await api.transferDownload(serverId, sel, localDir, serverName);
      if (!r.ok) throw new Error(r.error || i18n.t('files.downloadFail'));
      return r.data?.length ?? 0;
    },
    [],
  );

  const relay = useCallback(
    async (srcId: string, dstId: string, sel: FileEntry[], dstDir: string, srcName?: string, dstName?: string, ignoreExisting?: boolean) => {
      if (!api) return 0;
      const r = await api.transferRelay(srcId, dstId, sel, dstDir, srcName, dstName, ignoreExisting);
      if (!r.ok) throw new Error(r.error || i18n.t('transfer.error'));
      return r.data?.length ?? 0;
    },
    [],
  );

  const pause = useCallback((id: string) => void api?.transferPause(id), []);
  const cancel = useCallback((id: string) => void api?.transferCancel(id), []);
  const resume = useCallback((id: string) => void api?.transferResume(id), []);
  const retry = useCallback((id: string) => void api?.transferRetry(id), []);
  const remove = useCallback(
    (id: string) => {
      void api?.transferRemove(id).then(refresh).catch(() => refresh());
    },
    [refresh],
  );
  const clearFinished = useCallback(() => {
    void api?.transferClear().then(refresh).catch(() => refresh());
  }, [refresh]);

  const pauseAll = useCallback(() => {
    api?.transferPauseAll();
    setTimeout(refresh, 150);
  }, [refresh]);
  const resumeAll = useCallback(() => {
    api?.transferResumeAll();
    setTimeout(refresh, 150);
  }, [refresh]);
  const cancelMany = useCallback(
    (ids: string[]) => {
      api?.transferCancelMany(ids);
      setTimeout(refresh, 200);
    },
    [refresh],
  );
  const retryFailed = useCallback(() => {
    api?.transferRetryFailed();
    setTimeout(refresh, 200);
  }, [refresh]);
  const move = useCallback(
    (id: string, dir: 'up' | 'down') => {
      api?.transferMove(id, dir);
      // 本地即时反映排队顺序（仅排队任务之间交换）
      setItems((prev) => {
        const order = prev.filter((x) => x.status === 'queued');
        const i = order.findIndex((x) => x.id === id);
        const j = dir === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= order.length) return prev;
        const idA = order[i].id;
        const idB = order[j].id;
        return prev.map((x) => (x.id === idA ? order[j] : x.id === idB ? order[i] : x));
      });
    },
    [],
  );

  const setConcurrency = useCallback((n: number) => {
    const v = Math.max(1, Math.min(15, Math.round(n)));
    setConcurrencyState(v);
    localStorage.setItem(LS_CONC, String(v));
    api?.transferConcurrency(v);
  }, []);

  const setLimitMB = useCallback((n: number) => {
    const v = Math.max(0, Math.round(n));
    setLimitMBState(v);
    localStorage.setItem(LS_LIMIT, String(v));
    api?.transferOptions({ limitBytes: v * 1024 * 1024 });
  }, []);

  const setNotifyOpts = useCallback((o: Partial<{ notifyDone: boolean; notifyFail: boolean; sound: boolean }>) => {
    setNotifyOptsState((prev) => {
      const next = { ...prev, ...o };
      localStorage.setItem(LS_OPTS, JSON.stringify(next));
      api?.transferOptions({ notifyDone: next.notifyDone, notifyFail: next.notifyFail });
      return next;
    });
  }, []);

  const value = useMemo<TransferStore>(() => {
    const runningCount = items.filter((x) => x.status === 'running').length;
    const queuedCount = items.filter((x) => x.status === 'queued').length;
    const doneCount = items.filter((x) => x.status === 'done').length;
    const errorCount = items.filter((x) => x.status === 'error').length;
    const pendingCount = items.filter((x) => ['running', 'queued', 'paused', 'error'].includes(x.status)).length;
    return {
      items,
      runningCount,
      queuedCount,
      pendingCount,
      doneCount,
      errorCount,
      upload,
      download,
      relay,
      pause,
      cancel,
      resume,
      retry,
      remove,
      clearFinished,
      pauseAll,
      resumeAll,
      cancelMany,
      retryFailed,
      move,
      setConcurrency,
      concurrency,
      limitMB,
      setLimitMB,
      notifyOpts,
      setNotifyOpts,
      getSpeedHistory,
      refresh,
    };
  }, [
    items,
    upload,
    download,
    relay,
    pause,
    cancel,
    resume,
    retry,
    remove,
    clearFinished,
    pauseAll,
    resumeAll,
    cancelMany,
    retryFailed,
    move,
    setConcurrency,
    concurrency,
    limitMB,
    setLimitMB,
    notifyOpts,
    setNotifyOpts,
    getSpeedHistory,
    refresh,
  ]);

  const commands = useMemo(() => ({ upload, download }), [upload, download]);
  return <Ctx.Provider value={value}><CommandsCtx.Provider value={commands}>{children}</CommandsCtx.Provider></Ctx.Provider>;
}

export function useTransferCommands() {
  const value = useContext(CommandsCtx);
  if (!value) throw new Error('useTransferCommands must be used inside TransferProvider');
  return value;
}

export function useTransfers() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTransfers must be used inside TransferProvider');
  return v;
}
