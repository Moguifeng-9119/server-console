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
import type { AlertRecord, HistoryPoint, AuditEntry, Server, ServerConfig, SnapshotPayload, Toast } from './types';
import { api, isElectron } from './api';
import i18n, { initializationWarning } from './i18n';
import { appendSample, normalizeHistory } from './history';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'default' | 'comfy';
export interface Thresholds {
  warn: number;
  high: number;
  crit: number;
}

// localStorage 读取兜底：坏值/缺失一律回退默认（设置只在用户改动时写入，读到的一定是自己存的）
function loadPref<T>(key: string, fallback: T, isValid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return isValid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
const isThresholds = (v: unknown): boolean => {
  const t = v as Thresholds;
  return (
    !!t &&
    [t.warn, t.high, t.crit].every((n) => Number.isFinite(n) && n > 0 && n < 100) &&
    t.warn < t.high &&
    t.high < t.crit
  );
};

type NewServer = Partial<ServerConfig> & { password?: string; passphrase?: string };

export interface AddResult {
  ok: boolean;
  created?: ServerConfig;
  error?: string;
}

interface Store {
  servers: Server[];
  sampleNow: number;
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
  tempAlert: number;
  setTempAlert: (n: number) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  alertRecords: AlertRecord[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  audit: AuditEntry[];
  histories: Record<string, HistoryPoint[]>;
  kill: (serverId: string, pid: number, signal: 'TERM' | 'KILL') => void;
  restartService: (serverId: string, service: string) => void;
  colorOf: (pct: number) => string;
}

const Ctx = createContext<Store | null>(null);

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sampleNow, setSampleNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setSampleNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const [demo, setDemo] = useState(!isElectron);
  const [demoServers, setDemoServers] = useState<Server[]>([]);
  const mockRef = useRef<typeof import('./mock') | null>(null);
  const [configs, setConfigs] = useState<ServerConfig[]>([]);
  const [snaps, setSnaps] = useState<Record<string, SnapshotPayload>>({});
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({});
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const v = localStorage.getItem('sc.theme.user');
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
  });
  const [density, setDensity] = useState<Density>(() => {
    const v = localStorage.getItem('sc.density.user');
    return v === 'compact' || v === 'comfy' || v === 'default' ? v : 'default';
  });
  const [thresholds, setThresholdsState] = useState<Thresholds>(() =>
    loadPref('sc.thresholds', { warn: 50, high: 75, crit: 90 }, isThresholds),
  );
  const [refreshMs, setRefreshMsState] = useState<number>(() =>
    loadPref('sc.refreshMs', 2000, (v) => [1000, 2000, 5000, 10000].includes(Number(v))),
  );
  const [alertsEnabled, setAlertsEnabledState] = useState<boolean>(() =>
    loadPref('sc.alertsEnabled', true, (v) => typeof v === 'boolean'),
  );
  const [tempAlert, setTempAlertState] = useState<number>(() =>
    loadPref('sc.tempAlert', 85, (v) => Number.isFinite(v) && Number(v) >= 40 && Number(v) <= 120),
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alertRecords, setAlertRecords] = useState<AlertRecord[]>([]);
  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((item) => item.id !== id)), []);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const seq = useRef(1);
  const languageWarningShown = useRef(false);
  const knownAlerts = useRef<Set<string>>(new Set());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      void api?.setTitleBarTheme(resolved);
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

  // 设置持久化：与主题/密度同策略，只信自己写入的值
  const setThresholds = useCallback((t: Thresholds) => {
    setThresholdsState(t);
    localStorage.setItem('sc.thresholds', JSON.stringify(t));
  }, []);
  const setRefreshMs = useCallback((n: number) => {
    setRefreshMsState(n);
    localStorage.setItem('sc.refreshMs', JSON.stringify(n));
  }, []);
  const setAlertsEnabled = useCallback((b: boolean) => {
    setAlertsEnabledState(b);
    localStorage.setItem('sc.alertsEnabled', JSON.stringify(b));
  }, []);
  const setTempAlert = useCallback((n: number) => {
    setTempAlertState(n);
    localStorage.setItem('sc.tempAlert', JSON.stringify(n));
  }, []);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = seq.current++;
    setToasts((prev) => [...prev.slice(-1), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    if (initializationWarning && !languageWarningShown.current) {
      languageWarningShown.current = true;
      pushToast({ level: 'error', title: i18n.t('backend.error'), detail: initializationWarning });
    }
  }, [pushToast]);

  const refresh = useCallback(async () => {
    if (!api) return;
    setConfigs(await api.listServers());
  }, []);

  // 首次加载：有真实服务器配置就切到实数据，否则停在演示数据；同时回读上次会话的审计日志
  useEffect(() => {
    if (!api) return;
    api.listServers().then((list) => {
      setConfigs(list);
      if (list.length) setDemo(false);
    });
    api.auditList().then((list) => {
      if (list.length) setAudit(list.map((e, i) => ({ ...e, id: -(i + 1) }))); // 负数 id 与本次会话的内存 id 区分
    });
  }, []);

  // 审计：写内存视图 + 落盘（userData/audit.log，重启不丢）
  const logAudit = useCallback(
    (entry: { server: string; action: string; target: string; result: 'ok' | 'failed' }) => {
      const full: AuditEntry = { ...entry, id: seq.current++, time: nowTime() };
      setAudit((prev) => [full, ...prev].slice(0, 50));
      api?.auditAppend({ time: full.time, server: entry.server, action: entry.action, target: entry.target, result: entry.result });
    },
    [],
  );

  // 订阅主进程采集结果
  useEffect(() => {
    if (!api || demo) return;
    const offSnap = api.onSnapshot((s) => {
      const at = s.collectedAt || Date.now();
      setSnaps((prev) => ({ ...prev, [s.id]: { ...s, collectedAt: at } }));
      const value = s.gpus.length ? s.gpus.reduce((sum, g) => sum + g.util, 0) / s.gpus.length : null;
      setHistories((prev) => ({ ...prev, [s.id]: appendSample(prev[s.id] || [], { at, value }) }));
    });
    const offStatus = api.onStatus((st) => {
      setHistories((prev) => ({ ...prev, [st.id]: appendSample(prev[st.id] || [], { at: Date.now(), value: null }) }));
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
            cpuUsage: null,
            collectedAt: cur?.collectedAt,
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

  // 历史曲线持久化：启动恢复 + 每 30 秒落盘（无变化不写）
  const historiesRef = useRef(histories);
  historiesRef.current = histories;
  useEffect(() => {
    if (!api || demo) return;
    const a = api;
    a.historyLoad().then((saved) => {
      if (saved && Object.keys(saved).length) setHistories((prev) => {
        const next = { ...prev };
        for (const [id, values] of Object.entries(saved)) next[id] = normalizeHistory([...(values || []), ...(prev[id] || [])]);
        return next;
      });
    }).catch((error) => pushToast({level: 'error', title: i18n.t('workbench.historySaveFail'), detail: String(error)}));
    const timer = setInterval(() => {
      const cur = historiesRef.current;
      const live = Object.fromEntries(Object.entries(cur).filter(([id]) => !id.startsWith('demo:')));
      if (Object.keys(live).length) void a.historySave(live).catch((error) => pushToast({ level: 'error', title: i18n.t('workbench.historySaveFail'), detail: String(error) }));
    }, 30000);
    return () => clearInterval(timer);
  }, [demo, pushToast]);

  useEffect(() => {
    if (!api || demo) return;
    api.setInterval(refreshMs);
  }, [refreshMs, demo]);

  // 演示数据：懒加载 mock 模块（不进生产包）+ 模拟轮询
  useEffect(() => {
    if (!demo) return;
    import('./mock').then((m) => {
      mockRef.current = m;
      setDemoServers(m.createServers());
    });
  }, [demo]);

  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => {
      const m = mockRef.current;
      if (m) setDemoServers((prev) => prev.map(m.tick));
    }, refreshMs);
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
        group: c.group,
        status: s?.status ?? 'offline',
        gpus: s?.gpus ?? [],
        processes: s?.processes ?? [],
        history: (histories[c.id] ?? []).flatMap((point) => point.value == null ? [] : [point.value]),
        collectedAt: s?.collectedAt,
        cpuCores: s?.cpuCores ?? 0,
        cpuUsage: s?.cpuUsage ?? null,
        loadAvg: s?.loadAvg ?? [0, 0, 0],
        memUsed: s?.memUsed ?? 0,
        memTotal: s?.memTotal ?? 0,
        swapUsed: s?.swapUsed ?? 0,
        swapTotal: s?.swapTotal ?? 0,
      };
    });
  }, [demo, demoServers, configs, snaps, histories]);

  useEffect(() => {
    if (!demo) return;
    const at = Date.now();
    setHistories((prev) => {
      const next = { ...prev };
      for (const s of demoServers) next[s.id] = appendSample(prev[s.id] || [], {
        at, value: s.status === 'online' && s.gpus.length ? s.gpus.reduce((sum, g) => sum + g.util, 0) / s.gpus.length : null,
      });
      return next;
    });
  }, [demo, demoServers]);

  // One summary per polling cycle; detailed active/resolved records remain available.
  useEffect(() => {
    if (!alertsEnabled) return;
    const keys = new Set<string>();
    for (const s of servers) {
      if (s.status !== 'online') {
        if (s.collectedAt) keys.add('offline:' + s.id);
        for (const key of knownAlerts.current) if (key.slice(key.indexOf(':') + 1) === s.id && !key.startsWith('offline:')) keys.add(key);
        continue;
      }
      if (s.gpus.some((g) => (g.temp ?? 0) >= tempAlert)) keys.add('temp:' + s.id);
      if (s.gpus.some((g) => (g.memUsed / (g.memTotal || 1)) * 100 >= thresholds.crit)) keys.add('vram:' + s.id);
      if (s.processes.some((p) => p.state === 'Z')) keys.add('zombie:' + s.id);
    }
    const at = Date.now();
    const newRecords: AlertRecord[] = [];
    for (const key of keys) {
      if (knownAlerts.current.has(key)) continue;
      const separator = key.indexOf(':');
      const type = key.slice(0, separator), serverId = key.slice(separator + 1);
      const server = servers.find((s) => s.id === serverId);
      if (server) newRecords.push({ id: key + ':' + at, type, serverId, serverName: server.name, createdAt: at });
    }
    const resolved = [...knownAlerts.current].some((key) => !keys.has(key));
    if (newRecords.length || resolved) setAlertRecords((prev) => [
      ...newRecords,
      ...prev.map((item) => !item.resolvedAt && !keys.has(item.type + ':' + item.serverId) && (item.type === 'offline' || servers.find((server) => server.id === item.serverId)?.status === 'online') ? { ...item, resolvedAt: at } : item),
    ].slice(0, 100));
    if (newRecords.length && !demo) {
      const title = i18n.t('workbench.alertSummary', { n: newRecords.length });
      const body = [...new Set(newRecords.map((item) => item.serverName))].join(', ');
      pushToast({ level: 'warn', title, detail: body });
      void api?.notify(title, body);
      void api?.webhookSend({ title, body });
    }
    knownAlerts.current = keys;
  }, [servers, demo, alertsEnabled, thresholds.crit, tempAlert, pushToast]);

  const addServer = useCallback(async (cfg: NewServer): Promise<AddResult> => {
    if (!api) return { ok: false, error: i18n.t('state.desktopOnly') };
    try {
      const res = await api.addServer(cfg);
      if (!res?.ok) return { ok: false, error: res?.error || i18n.t('workbench.noOutput') };
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
    if (!api) return { ok: false, error: i18n.t('state.desktopOnly') };
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
            pushToast({ level: 'error', title: i18n.t('state.killFail', { pid }), detail: res.error });
            logAudit({ server: s?.name ?? serverId, action, target: String(pid), result: 'failed' });
            return;
          }
          pushToast({ level: 'info', title: i18n.t('state.sigSent', { signal, pid }), detail: s?.name ?? '' });
          logAudit({
            server: s?.name ?? serverId,
            action,
            target: `${pid} ${target?.command.slice(0, 40) ?? ''}`,
            result: 'ok',
          });
        });
        return;
      }
      if (!s || !target) {
        pushToast({ level: 'error', title: i18n.t('state.procGone', { pid }), detail: i18n.t('state.procGoneDetail') });
        return;
      }
      const m = mockRef.current;
      if (m) setDemoServers((prev) => prev.map((x) => (x.id === serverId ? m.killProcess(x, pid) : x)));
      setAudit((prev) => [
        { id: seq.current++, time: nowTime(), server: s.name, action, target: `${pid} ${target.command.slice(0, 40)}`, result: 'ok' as const },
        ...prev,
      ].slice(0, 50));
      pushToast({ level: 'info', title: i18n.t('state.sigSent', { signal, pid }), detail: `${s.name} · ${target.user}` });
    },
    [servers, demo, pushToast, logAudit],
  );

  const restartService = useCallback(
    (serverId: string, service: string) => {
      const s = servers.find((x) => x.id === serverId);
      const log = (result: 'ok' | 'failed', detail?: string) => {
        logAudit({ server: s?.name ?? serverId, action: 'systemctl restart', target: service, result });
        if (result === 'ok') pushToast({ level: 'info', title: i18n.t('state.restarting', { service }), detail: s?.name });
        else pushToast({ level: 'error', title: i18n.t('state.restartFail', { service }), detail });
      };
      if (!demo && api) {
        api.restartService(serverId, service).then((res) => (res.ok ? log('ok') : log('failed', res.error)));
        return;
      }
      if (!s) return;
      log('ok');
    },
    [servers, demo, pushToast, logAudit],
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
      sampleNow,
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
      tempAlert,
      setTempAlert,
      toasts,
      dismissToast,
      alertRecords,
      pushToast,
      audit,
      histories,
      kill,
      restartService,
      colorOf,
    }),
    [
      servers,
      sampleNow,
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
      setThresholds,
      refreshMs,
      setRefreshMs,
      alertsEnabled,
      setAlertsEnabled,
      tempAlert,
      setTempAlert,
      toasts,
      dismissToast,
      alertRecords,
      pushToast,
      audit,
      histories,
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
