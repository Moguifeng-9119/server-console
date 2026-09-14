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
import { createServers, killProcess, tick } from './mock';
import type { AuditEntry, Server, ServerConfig, SnapshotPayload, Toast } from './types';
import { api, isElectron } from './api';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'default' | 'comfy';
export interface Thresholds {
  warn: number;
  high: number;
  crit: number;
}

type NewServer = Partial<ServerConfig> & { password?: string; passphrase?: string };

export interface AddResult {
  ok: boolean;
  created?: ServerConfig;
  error?: string;
}

interface Store {
  servers: Server[];
  configs: ServerConfig[];
  demo: boolean;
  setDemo: (v: boolean) => void;
  hasApi: boolean;
  refresh: () => Promise<void>;
  addServer: (cfg: NewServer) => Promise<AddResult>;
  removeServer: (id: string) => Promise<void>;
  testServer: (cfg: NewServer) => Promise<{ ok: boolean; error?: string; gpus?: number; processes?: number }>;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  density: Density;
  setDensity: (d: Density) => void;
  thresholds: Thresholds;
  setThresholds: (t: Thresholds) => void;
  refreshMs: number;
  setRefreshMs: (n: number) => void;
  alertsEnabled: boolean;
  setAlertsEnabled: (b: boolean) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  audit: AuditEntry[];
  kill: (serverId: string, pid: number, signal: 'TERM' | 'KILL') => void;
  restartService: (serverId: string, service: string) => void;
  colorOf: (pct: number) => string;
}

const Ctx = createContext<Store | null>(null);

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(!isElectron);
  const [demoServers, setDemoServers] = useState<Server[]>(() => createServers());
  const [configs, setConfigs] = useState<ServerConfig[]>([]);
  const [snaps, setSnaps] = useState<Record<string, SnapshotPayload>>({});
  const [histories, setHistories] = useState<Record<string, number[]>>({});
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const v = localStorage.getItem('sc.theme.user');
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
  });
  const [density, setDensity] = useState<Density>(() => {
    const v = localStorage.getItem('sc.density.user');
    return v === 'compact' || v === 'comfy' || v === 'default' ? v : 'compact';
  });
  const [thresholds, setThresholds] = useState<Thresholds>({ warn: 50, high: 75, crit: 90 });
  const [refreshMs, setRefreshMs] = useState(2000);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const seq = useRef(1);
  const knownAlerts = useRef<Set<string>>(new Set());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // 仅在用户主动切换时记忆，避免启动时把默认值写成“脏偏好”
  const selectTheme = useCallback((t: ThemeMode) => {
    setTheme(t);
    localStorage.setItem('sc.theme.user', t);
  }, []);
  const selectDensity = useCallback((d: Density) => {
    setDensity(d);
    localStorage.setItem('sc.density.user', d);
  }, []);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = seq.current++;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    setConfigs(await api.listServers());
  }, []);

  // 首次加载：有真实服务器配置就切到实数据，否则停在演示数据
  useEffect(() => {
    if (!api) return;
    api.listServers().then((list) => {
      setConfigs(list);
      if (list.length) setDemo(false);
    });
  }, []);

  // 订阅主进程采集结果
  useEffect(() => {
    if (!api || demo) return;
    const offSnap = api.onSnapshot((s) => {
      setSnaps((prev) => ({ ...prev, [s.id]: s }));
    });
    const offStatus = api.onStatus((st) => {
      setSnaps((prev) => {
        const cur = prev[st.id];
        return {
          ...prev,
          [st.id]: {
            id: st.id,
            status: st.status as SnapshotPayload['status'],
            error: st.error,
            gpus: cur?.gpus ?? [],
            processes: cur?.processes ?? [],
            cpuCores: cur?.cpuCores ?? 0,
            cpuUsage: cur?.cpuUsage ?? 0,
            loadAvg: cur?.loadAvg ?? [0, 0, 0],
            memUsed: cur?.memUsed ?? 0,
            memTotal: cur?.memTotal ?? 0,
            swapUsed: cur?.swapUsed ?? 0,
            swapTotal: cur?.swapTotal ?? 0,
          },
        };
      });
    });
    return () => {
      offSnap();
      offStatus();
    };
  }, [demo]);

  // 历史曲线单独维护，避免快照对象每次都被替换
  const lastAvg = useRef<Record<string, number>>({});
  useEffect(() => {
    if (demo) return;
    const next: Record<string, number[]> = {};
    let changed = false;
    for (const [id, s] of Object.entries(snaps)) {
      const avg = s.gpus.length ? s.gpus.reduce((a, g) => a + g.util, 0) / s.gpus.length : 0;
      if (lastAvg.current[id] === avg) continue;
      lastAvg.current[id] = avg;
      next[id] = [...(histories[id] ?? []), avg].slice(-60);
      changed = true;
    }
    if (changed) setHistories((prev) => ({ ...prev, ...next }));
  }, [snaps, demo, histories]);

  useEffect(() => {
    if (!api || demo) return;
    api.setInterval(refreshMs);
  }, [refreshMs, demo]);

  // 演示数据的模拟轮询
  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => setDemoServers((prev) => prev.map(tick)), refreshMs);
    return () => clearInterval(timer);
  }, [demo, refreshMs]);

  const servers = useMemo<Server[]>(() => {
    if (demo) return demoServers;
    return configs.map((c) => {
      const s = snaps[c.id];
      return {
        id: c.id,
        name: c.name,
        host: `${c.username}@${c.host}`,
        status: s?.status ?? 'offline',
        gpus: s?.gpus ?? [],
        processes: s?.processes ?? [],
        history: histories[c.id] ?? [],
        cpuCores: s?.cpuCores ?? 0,
        cpuUsage: s?.cpuUsage ?? 0,
        loadAvg: s?.loadAvg ?? [0, 0, 0],
        memUsed: s?.memUsed ?? 0,
        memTotal: s?.memTotal ?? 0,
        swapUsed: s?.swapUsed ?? 0,
        swapTotal: s?.swapTotal ?? 0,
      };
    });
  }, [demo, demoServers, configs, snaps, histories]);

  // 告警：新异常只通知一次，持续异常不重复打扰
  useEffect(() => {
    if (!alertsEnabled) return;
    const keys = new Set<string>();
    for (const s of servers) {
      if (s.status !== 'online') continue;
      if (s.gpus.some((g) => (g.temp ?? 0) >= 85)) keys.add(`temp:${s.id}`);
      if (s.gpus.some((g) => (g.memUsed / (g.memTotal || 1)) * 100 >= thresholds.crit)) keys.add(`vram:${s.id}`);
      if (s.processes.some((p) => p.state === 'Z')) keys.add(`zombie:${s.id}`);
    }
    for (const k of keys) {
      if (knownAlerts.current.has(k)) continue;
      const [type, id] = k.split(':');
      const s = servers.find((x) => x.id === id);
      if (!s) continue;
      const label: Record<string, string> = {
        temp: `GPU 温度过高（${s.name}）`,
        vram: `显存接近占满（${s.name}）`,
        zombie: `出现僵尸进程（${s.name}）`,
      };
      pushToast({ level: 'warn', title: label[type], detail: nowTime() });
      api?.notify(label[type], `${s.name} · ${nowTime()}`);
    }
    knownAlerts.current = keys;
  }, [servers, alertsEnabled, thresholds.crit, pushToast]);

  const addServer = useCallback(async (cfg: NewServer): Promise<AddResult> => {
    if (!api) return { ok: false, error: '当前不在桌面端（无 Electron 主进程）' };
    try {
      const res = await api.addServer(cfg);
      if (!res?.ok) return { ok: false, error: res?.error || '主进程返回空结果' };
      setConfigs(await api.listServers());
      setDemo(false);
      return { ok: true, created: res.server };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const removeServer = useCallback(async (id: string) => {
    if (!api) return;
    await api.removeServer(id);
    setConfigs(await api.listServers());
  }, []);

  const testServer = useCallback(async (cfg: NewServer) => {
    if (!api) return { ok: false, error: '仅在桌面端可用' };
    return api.testServer(cfg);
  }, []);

  const kill = useCallback(
    (serverId: string, pid: number, signal: 'TERM' | 'KILL') => {
      const s = servers.find((x) => x.id === serverId);
      const target = s?.processes.find((p) => p.pid === pid);
      const action = signal === 'KILL' ? 'kill -9' : 'kill -15';
      if (!demo) {
        if (!api) return;
        api.kill(serverId, pid, signal).then((res) => {
          if (!res.ok) {
            pushToast({ level: 'error', title: `结束进程 ${pid} 失败`, detail: res.error });
            setAudit((prev) => [
              { id: seq.current++, time: nowTime(), server: s?.name ?? serverId, action, target: String(pid), result: 'failed' as const },
              ...prev,
            ].slice(0, 50));
            return;
          }
          pushToast({ level: 'info', title: `已发送 SIG${signal} → ${pid}`, detail: s?.name ?? '' });
          setAudit((prev) => [
            { id: seq.current++, time: nowTime(), server: s?.name ?? serverId, action, target: `${pid} ${target?.command.slice(0, 40) ?? ''}`, result: 'ok' as const },
            ...prev,
          ].slice(0, 50));
        });
        return;
      }
      if (!s || !target) {
        pushToast({ level: 'error', title: `进程 ${pid} 不存在`, detail: '可能已自行退出' });
        return;
      }
      setDemoServers((prev) => prev.map((x) => (x.id === serverId ? killProcess(x, pid) : x)));
      setAudit((prev) => [
        { id: seq.current++, time: nowTime(), server: s.name, action, target: `${pid} ${target.command.slice(0, 40)}`, result: 'ok' as const },
        ...prev,
      ].slice(0, 50));
      pushToast({ level: 'info', title: `已发送 SIG${signal} → ${pid}`, detail: `${s.name} · ${target.user}` });
    },
    [servers, demo, pushToast],
  );

  const restartService = useCallback(
    (serverId: string, service: string) => {
      const s = servers.find((x) => x.id === serverId);
      const log = (result: 'ok' | 'failed', detail?: string) => {
        setAudit((prev) => [
          { id: seq.current++, time: nowTime(), server: s?.name ?? serverId, action: 'systemctl restart', target: service, result },
          ...prev,
        ].slice(0, 50));
        if (result === 'ok') pushToast({ level: 'info', title: `正在重启 ${service}`, detail: s?.name });
        else pushToast({ level: 'error', title: `重启 ${service} 失败`, detail });
      };
      if (!demo && api) {
        api.restartService(serverId, service).then((res) => (res.ok ? log('ok') : log('failed', res.error)));
        return;
      }
      if (!s) return;
      log('ok');
    },
    [servers, demo, pushToast],
  );

  const colorOf = useCallback(
    (pct: number) => {
      if (pct >= thresholds.crit) return 'var(--crit)';
      if (pct >= thresholds.high) return 'var(--high)';
      if (pct >= thresholds.warn) return 'var(--warn)';
      return 'var(--ok)';
    },
    [thresholds],
  );

  const value = useMemo<Store>(
    () => ({
      servers,
      configs,
      demo,
      setDemo,
      hasApi: isElectron,
      refresh,
      addServer,
      removeServer,
      testServer,
      theme,
      setTheme: selectTheme,
      density,
      setDensity: selectDensity,
      thresholds,
      setThresholds,
      refreshMs,
      setRefreshMs,
      alertsEnabled,
      setAlertsEnabled,
      toasts,
      pushToast,
      audit,
      kill,
      restartService,
      colorOf,
    }),
    [
      servers,
      configs,
      demo,
      refresh,
      addServer,
      removeServer,
      testServer,
      theme,
      selectTheme,
      density,
      selectDensity,
      thresholds,
      refreshMs,
      alertsEnabled,
      toasts,
      pushToast,
      audit,
      kill,
      restartService,
      colorOf,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}
