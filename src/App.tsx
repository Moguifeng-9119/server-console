import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { ArrowUpDown, Search, Terminal, Bell } from 'lucide-react';
import { useStore } from './state';
import { useTranslation } from 'react-i18next';
import { isFreshSample } from './resources';
import { api } from './api';
import type { Server } from './types';
import { AlertCenter } from './components/AlertCenter';
import { useDialogFocus } from './hooks/useDialogFocus';
import { Overview } from './components/Overview';
import { ServerPanel } from './components/ServerPanel';
import { TerminalWorkspace } from './components/TerminalPane';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ServerManager } from './components/ServerManager';
import { ImportSshConfig } from './components/ImportSshConfig';
import { ConfigWatchBanner } from './components/ConfigWatchBanner';
import { TransferDrawer } from './components/TransferDrawer';
import { ParallelCommand } from './components/ParallelCommand';
import { HistoryDialog } from './components/HistoryDialog';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { useTransfers } from './transfers';
import type { SetStateAction } from 'react';

type ServerTab = 'gpu' | 'proc' | 'files' | 'term';

const LS_VIEW = 'sc.view';

// 恢复上次页面：只在结构合法时采用，服务器已被删除则由下方 effect 兜底回总览
function loadView(): { kind: 'overview' } | { kind: 'parallel' } | { kind: 'server'; id: string; tab: ServerTab } {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_VIEW) || 'null');
    if (raw && raw.kind === 'parallel') {
      return { kind: 'parallel' };
    }
    if (raw && raw.kind === 'server' && typeof raw.id === 'string' && ['gpu', 'proc', 'files', 'term'].includes(raw.tab)) {
      return { kind: 'server', id: raw.id, tab: raw.tab };
    }
  } catch {
    /* 忽略坏数据 */
  }
  return { kind: 'overview' };
}

export default function App() {
  const { servers, theme, setTheme, toasts, dismissToast, alertRecords, demo, configs, sampleNow, refreshMs } = useStore();
  const { t } = useTranslation();
  const tClose = t('settings.close');
  const tf = useTransfers();
  const activeTransferCount = tf.runningCount + tf.queuedCount;
  const [view, updateView] = useState<ReturnType<typeof loadView>>(loadView);
  const serverTabs = useRef<Record<string, ServerTab>>({});
  const setView = useCallback((next: SetStateAction<ReturnType<typeof loadView>>) => {
    if (document.querySelector('[data-unsaved="true"]')) {
      window.dispatchEvent(new Event('sc:blocked-navigation'));
      return;
    }
    updateView(next);
  }, []);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quitAsk, setQuitAsk] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyView, setHistoryView] = useState<Server | null>(null);

  // 页面/标签持久化
  useEffect(() => {
    localStorage.setItem(LS_VIEW, JSON.stringify(view));
    if (view.kind === 'server') serverTabs.current[view.id] = view.tab;
  }, [view]);
  const focusedId = view.kind === 'server' ? view.id : null;
  useEffect(() => { void api?.setFocusedServer(focusedId); }, [focusedId]);

  // 上次页面对应的服务器已被删除 → 回总览
  const serversReady = servers.length > 0;
  useEffect(() => {
    if (serversReady && view.kind === 'server' && !servers.find((s) => s.id === view.id)) {
      setView({ kind: 'overview' });
    }
  }, [serversReady, servers, view, setView]);

  // 主进程在有活跃传输时拦截了关窗，这里弹确认框
  useEffect(() => {
    if (!api) return;
    return api.onConfirmQuit(() => setQuitAsk(true));
  }, []);

  // 2FA/MFA 键盘交互认证弹框（主进程广播提示问题，这里收集作答）
  const [kiAsk, setKiAsk] = useState<{ reqId: string; title: string; prompts: string[]; values: string[] } | null>(null);
  useEffect(() => {
    if (!api) return;
    return api.onKeyboardInteractive(({ reqId, title, prompts }) => {
      setKiAsk({ reqId, title, prompts, values: prompts.map(() => '') });
    });
  }, []);
  const submitKi = () => {
    if (!kiAsk || !api) return;
    void api.submitInteractive(kiAsk.reqId, kiAsk.values);
    setKiAsk(null);
  };

  // Ctrl+K 命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (document.querySelector('[data-unsaved="true"]')) { window.dispatchEvent(new Event('sc:blocked-navigation')); return; }
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Each server remembers its selected tab for this app window.
  const openServer = useCallback((id: string, tab?: ServerTab) =>
    setView((v) => ({
      kind: 'server',
      id,
      tab: tab ?? (v.kind === 'server' && v.id === id ? v.tab : serverTabs.current[id] || 'gpu'),
    })), [setView]);

  const quitRef = useRef<HTMLDivElement>(null);
  const kiRef = useRef<HTMLDivElement>(null);
  useDialogFocus(quitAsk, quitRef, () => setQuitAsk(false));
  useDialogFocus(!!kiAsk, kiRef, () => { if (kiAsk) void api?.submitInteractive(kiAsk.reqId, kiAsk.prompts.map(() => '')); setKiAsk(null); });

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...servers.map((s) => ({ id: 'open-server:' + s.id, label: t('palette.connect', { name: s.name }), hint: s.host, run: () => openServer(s.id) })),
      { id: 'overview', label: t('palette.openOverview'), run: () => setView({ kind: 'overview' }) },
      { id: 'parallel', label: t('palette.openParallel'), run: () => setView({ kind: 'parallel' }) },
      { id: 'transfers', label: t('palette.openTransfers'), run: () => window.dispatchEvent(new Event('sc:show-transfers')) },
      { id: 'settings', label: t('palette.openSettings'), run: () => setSettingsOpen(true) },
      { id: 'manager', label: t('palette.manageServers'), run: () => setManagerOpen(true) },
      { id: 'theme', label: t('palette.toggleTheme'), run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    ],
    [servers, openServer, setView, setTheme, theme, t]
  );

  const current = view.kind === 'server' ? servers.find((s) => s.id === view.id) : undefined;

  // 侧栏可拖拽宽度调节（范围 180px - 480px，默认 224px）
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('sc.sidebar.w'));
      return Number.isFinite(saved) && saved >= 180 && saved <= 480 ? saved : 224;
    } catch {
      return 224;
    }
  });

  const onSidebarResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(180, Math.min(480, startW + (ev.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalW = Math.max(180, Math.min(480, startW + (ev.clientX - startX)));
      localStorage.setItem('sc.sidebar.w', String(finalW));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 侧栏分组：只要有服务器带分组信息就启用分区；折叠状态持久化
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('sc.groups.collapsed') || '[]'));
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      localStorage.setItem('sc.groups.collapsed', JSON.stringify([...n]));
      return n;
    });
  const hasGroups = servers.some((s) => (s.group || '').trim() !== '');
  const groupSections = useMemo(() => {
    const map = new Map<string, Server[]>();
    for (const s of servers) {
      const g = (s.group || '').trim();
      const key = g || '__ungrouped__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].map(([key, items]) => ({ key, name: key === '__ungrouped__' ? t('workbench.ungrouped') : key, items }));
  }, [servers, t]);

  const renderServerItem = (s: Server) => {
    const avg = s.gpus.length ? s.gpus.reduce((a, g) => a + g.util, 0) / s.gpus.length : 0;
    return (
      <div
        key={s.id}
        className={`nav-item ${view.kind === 'server' && view.id === s.id ? 'active' : ''}`}
        style={{ cursor: 'pointer' }}

      >
        <i className={`dot ${s.status}`} />
        <button className="nav-server" onClick={() => openServer(s.id)} onDoubleClick={() => openServer(s.id, 'files')} aria-current={view.kind === 'server' && view.id === s.id ? 'page' : undefined}>{s.name}</button>
        <span className="sub mono">{s.status === 'online' && isFreshSample(s, demo, refreshMs, sampleNow) ? `${Math.round(avg)}%` : '—'}</span>
        <button
          className="nav-files"
          title={t('nav.files')}
          onClick={(e) => {
            e.stopPropagation();
            openServer(s.id, 'files');
          }}
        >
          {t('nav.files')}
        </button>
      </div>
    );
  };

  return (
    <>
    <div className="desktop-titlebar" aria-hidden="true"><span>ServerConsole</span></div>
    <div className="app" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" title="ServerConsole">
            <Terminal size={13} strokeWidth={2.6} />
          </span>
          ServerConsole <small>v{__APP_VERSION__}</small>
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view.kind === 'overview' ? 'active' : ''}`}
            onClick={() => setView({ kind: 'overview' })}
          >
            <span>{t('nav.overview')}</span>
            <span className="sub">{servers.filter((s) => s.status === 'online').length}/{servers.length}</span>
          </button>
          {!hasGroups && <div className="note" style={{ padding: '10px 10px 4px' }}>{t('nav.servers')}</div>}
          {hasGroups
            ? groupSections.map((sec) => (
                <div key={sec.key}>
                  <button className="group-head" onClick={() => toggleGroup(sec.key)} aria-expanded={!collapsedGroups.has(sec.key)}>
                    <span>{sec.name}</span>
                    <span>
                      {sec.items.length} {collapsedGroups.has(sec.key) ? '▸' : '▾'}
                    </span>
                  </button>
                  {!collapsedGroups.has(sec.key) && sec.items.map(renderServerItem)}
                </div>
              ))
            : servers.map(renderServerItem)}
        </nav>
        <div className="sidebar-foot">
          <button className="btn" style={{ paddingInline: 4 }} onClick={() => setImportOpen(true)}>
            {t('nav.import')}
          </button>
          <button className="btn" onClick={() => setManagerOpen(true)}>
            {t('nav.servers')}
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            {t('nav.settings')}
          </button>
        </div>
        <div
          className="sidebar-resizer"
          role="separator" aria-label={t('workbench.sidebarWidth')} aria-orientation="vertical" aria-valuenow={sidebarWidth} aria-valuemin={180} aria-valuemax={480} tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = Math.max(180, Math.min(480, sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16))); setSidebarWidth(next); localStorage.setItem('sc.sidebar.w', String(next)); } }}
          onMouseDown={onSidebarResizerMouseDown}
          onDoubleClick={() => {
            setSidebarWidth(224);
            localStorage.setItem('sc.sidebar.w', '224');
          }}
        />
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="title">{view.kind === 'overview' ? t('nav.overview') : view.kind === 'parallel' ? t('nav.parallel') : current?.name}</span>
          {demo && (
            <button className="btn" style={{ color: 'var(--warn)' }} onClick={() => setManagerOpen(true)}>
              {t('topbar.demoBanner')}
            </button>
          )}
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} title={t('topbar.search')}>
            <Search size={13} />
            <span>{t('topbar.search')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="spacer" />
          <button className="btn alert-entry" onClick={() => setAlertsOpen(true)}><Bell size={14} />{t('workbench.alerts')}{alertRecords.some((a) => !a.resolvedAt) && <span className="alert-count">{alertRecords.filter((a) => !a.resolvedAt).length}</span>}</button>
          <button
            className={`transfer-entry ${activeTransferCount ? 'active' : ''}`}
            onClick={() => window.dispatchEvent(new Event('sc:show-transfers'))}
            title={t('transfer.center')}
          >
            <span className="transfer-entry-ico"><ArrowUpDown size={13} strokeWidth={2.2} /></span>
            {t('topbar.transfers')}
            {activeTransferCount > 0 && <span className="transfer-entry-badge num">{activeTransferCount}</span>}
          </button>
        </header>

        <ConfigWatchBanner />
        <div className="content">
          {view.kind === 'parallel' ? (
            <ParallelCommand />
          ) : view.kind === 'overview' ? (
            configs.length === 0 && !demo ? (
              <div className="empty">
                {t('overview.emptyPrompt', '还没有连接任何服务器。')}
                <div style={{ marginTop: 12 }}>
                  <button className="btn primary" onClick={() => setManagerOpen(true)}>
                    {t('nav.servers', '添加服务器')}
                  </button>
                </div>
              </div>
            ) : (
              <Overview onOpen={openServer} onHistory={(s) => setHistoryView(s)} />
            )
          ) : current ? (
            <ServerPanel
              key={current.id}
              s={current}
              tab={view.tab}
              onTab={(tab) => setView((v) => (v.kind === 'server' ? { ...v, tab } : v))}
              onBack={() => setView({ kind: 'overview' })}
            />
          ) : (
            <div className="empty">{t('overview.serverNotFound', '未找到该服务器')}</div>
          )}
          <TerminalWorkspace serverIds={servers.map((s) => s.id)} activeServerId={view.kind === 'server' && view.tab === 'term' ? view.id : null} />
        </div>
      </main>

      {alertsOpen && <AlertCenter onClose={() => setAlertsOpen(false)} onOpen={openServer} />}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
      {managerOpen && <ServerManager onClose={() => setManagerOpen(false)} />}
      {importOpen && <ImportSshConfig onClose={() => setImportOpen(false)} />}
      <TransferDrawer />

      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div className={`toast ${t.level}`} key={t.id}>
            <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label={String(tClose)}>×</button><div className="t">{t.title}</div>
            {t.detail && <div className="d">{t.detail}</div>}
          </div>
        ))}
      </div>

      {quitAsk && (
        <div className="mask" onClick={() => setQuitAsk(false)}>
          <div className="dialog" ref={quitRef} role="dialog" aria-modal="true" aria-labelledby="quit-title" tabIndex={-1} style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="quit-title">{t('quit.title', { n: activeTransferCount })}</h3>
            <div className="body">
              {t('quit.body')}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setQuitAsk(false)}>
                {t('quit.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setQuitAsk(false);
                  api?.forceQuit();
                }}
              >
                {t('quit.forceQuit')}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setQuitAsk(false);
                  api?.backgroundContinue();
                }}
              >
                {t('quit.minimize')}
              </button>
            </div>
          </div>
        </div>
      )}

      <HistoryDialog s={historyView} onClose={() => setHistoryView(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />

      {kiAsk && (
        <div className="mask">
          <div className="dialog" ref={kiRef} role="dialog" aria-modal="true" aria-labelledby="ki-title" tabIndex={-1} style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="ki-title">{kiAsk.title}</h3>
            <div className="body" style={{ color: 'var(--text-dim)' }}>
              {t('ki.hint', '服务器要求交互式认证（如二次验证码）。')}
            </div>
            {kiAsk.prompts.map((p, i) => (
              <div className="field" key={i}>
                <label>{p}</label>
                <input
                  className="mini"
                  style={{ width: '100%' }}
                  autoFocus={i === 0}
                  type={/password|密码|口令|pin/i.test(p) ? 'password' : 'text'}
                  value={kiAsk.values[i]}
                  onChange={(e) =>
                    setKiAsk((prev) => {
                      if (!prev) return prev;
                      const values = [...prev.values];
                      values[i] = e.target.value;
                      return { ...prev, values };
                    })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && submitKi()}
                />
              </div>
            ))}
            <div className="foot">
              <button
                className="btn"
                onClick={() => {
                  void api?.submitInteractive(kiAsk.reqId, kiAsk.prompts.map(() => ''));
                  setKiAsk(null);
                }}
              >
                {t('ki.cancelFallback', '取消（回退密码）')}
              </button>
              <button className="btn primary" onClick={submitKi}>
                {t('ki.submit', '提交')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
