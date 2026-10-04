import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Search, Terminal } from 'lucide-react';
import { useStore } from './state';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import type { Server } from './types';
import { Overview } from './components/Overview';
import { ServerPanel } from './components/ServerPanel';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ServerManager } from './components/ServerManager';
import { ImportSshConfig } from './components/ImportSshConfig';
import { ConfigWatchBanner } from './components/ConfigWatchBanner';
import { TransferDrawer } from './components/TransferDrawer';
import { ParallelCommand } from './components/ParallelCommand';
import { HistoryDialog } from './components/HistoryDialog';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { useTransfers } from './transfers';

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
  const { servers, theme, setTheme, toasts, demo, configs } = useStore();
  const { t } = useTranslation();
  const tf = useTransfers();
  const activeTransferCount = tf.runningCount + tf.queuedCount;
  const [view, setView] = useState<{ kind: 'overview' } | { kind: 'parallel' } | { kind: 'server'; id: string; tab: ServerTab }>(loadView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quitAsk, setQuitAsk] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyView, setHistoryView] = useState<Server | null>(null);

  // 页面/标签持久化
  useEffect(() => {
    localStorage.setItem(LS_VIEW, JSON.stringify(view));
  }, [view]);

  // 上次页面对应的服务器已被删除 → 回总览
  const serversReady = servers.length > 0;
  useEffect(() => {
    if (serversReady && view.kind === 'server' && !servers.find((s) => s.id === view.id)) {
      setView({ kind: 'overview' });
    }
  }, [serversReady, servers, view]);

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
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 打开服务器：同一台保留当前 tab，换台回到 GPU；tab 状态提升到这里，避免切 tab 重挂载丢文件面板状态
  const openServer = (id: string, tab?: ServerTab) =>
    setView((v) => ({
      kind: 'server',
      id,
      tab: tab ?? (v.kind === 'server' && v.id === id ? v.tab : 'gpu'),
    }));

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
    [servers, openServer, setTheme, theme, t]
  );

  const current = view.kind === 'server' ? servers.find((s) => s.id === view.id) : undefined;



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
    return [...map.entries()].map(([key, items]) => ({ key, name: key === '__ungrouped__' ? '未分组' : key, items }));
  }, [servers]);

  const renderServerItem = (s: Server) => {
    const avg = s.gpus.length ? s.gpus.reduce((a, g) => a + g.util, 0) / s.gpus.length : 0;
    return (
      <div
        key={s.id}
        className={`nav-item ${view.kind === 'server' && view.id === s.id ? 'active' : ''}`}
        style={{ cursor: 'pointer' }}
        title="单击查看监控 · 双击或点右侧“文件”直达文件管理"
        onClick={() => openServer(s.id)}
        onDoubleClick={() => openServer(s.id, 'files')}
      >
        <i className={`dot ${s.status}`} />
        <span>{s.name}</span>
        <span className="sub mono">{s.status === 'online' ? `${Math.round(avg)}%` : '—'}</span>
        <button
          className="nav-files"
          title="打开文件管理"
          onClick={(e) => {
            e.stopPropagation();
            openServer(s.id, 'files');
          }}
        >
          文件
        </button>
      </div>
    );
  };

  return (
    <div className="app">
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
                  <div className="group-head" onClick={() => toggleGroup(sec.key)} title="点击折叠/展开">
                    <span>{sec.name}</span>
                    <span>
                      {sec.items.length} {collapsedGroups.has(sec.key) ? '▸' : '▾'}
                    </span>
                  </div>
                  {!collapsedGroups.has(sec.key) && sec.items.map(renderServerItem)}
                </div>
              ))
            : servers.map(renderServerItem)}
        </nav>
        <div className="sidebar-foot">
          <button className="btn" style={{ flex: 1, paddingInline: 4 }} onClick={() => setImportOpen(true)}>
            {t('nav.import')}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setManagerOpen(true)}>
            {t('nav.servers')}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setSettingsOpen(true)}>
            {t('nav.settings')}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="title">{view.kind === 'overview' ? t('nav.overview') : view.kind === 'parallel' ? t('nav.parallel') : current?.name}</span>
          {demo && (
            <button className="btn" style={{ color: 'var(--warn)' }} onClick={() => setManagerOpen(true)}>
              {t('topbar.demoBanner')}
            </button>
          )}
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} title="搜索服务器 / 执行动作">
            <Search size={13} />
            <span>{t('topbar.search')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="spacer" />
          <button
            className={`transfer-entry ${activeTransferCount ? 'active' : ''}`}
            onClick={() => window.dispatchEvent(new Event('sc:show-transfers'))}
            title="打开传输中心"
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
                还没有连接任何服务器。
                <div style={{ marginTop: 12 }}>
                  <button className="btn primary" onClick={() => setManagerOpen(true)}>
                    添加服务器
                  </button>
                </div>
              </div>
            ) : (
              <Overview onOpen={(id) => openServer(id)} onHistory={(s) => setHistoryView(s)} />
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
            <div className="empty">未找到该服务器</div>
          )}
        </div>
      </main>

      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
      {managerOpen && <ServerManager onClose={() => setManagerOpen(false)} />}
      {importOpen && <ImportSshConfig onClose={() => setImportOpen(false)} />}
      <TransferDrawer />

      <div className="toasts">
        {toasts.map((t) => (
          <div className={`toast ${t.level}`} key={t.id}>
            <div className="t">{t.title}</div>
            {t.detail && <div className="d">{t.detail}</div>}
          </div>
        ))}
      </div>

      {quitAsk && (
        <div className="mask" onClick={() => setQuitAsk(false)}>
          <div className="dialog" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>还有 {activeTransferCount} 个传输任务进行中</h3>
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} servers={servers} actions={paletteActions} />

      {kiAsk && (
        <div className="mask">
          <div className="dialog" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3>{kiAsk.title}</h3>
            <div className="body" style={{ color: 'var(--text-dim)' }}>
              服务器要求交互式认证（如二次验证码）。
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
                取消（回退密码）
              </button>
              <button className="btn primary" onClick={submitKi}>
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
