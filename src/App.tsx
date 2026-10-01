import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { useStore, type Density, type ThemeMode } from './state';
import { Overview } from './components/Overview';
import { ServerPanel } from './components/ServerPanel';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ServerManager } from './components/ServerManager';
import { ImportSshConfig } from './components/ImportSshConfig';
import { ConfigWatchBanner } from './components/ConfigWatchBanner';
import { TransferDrawer } from './components/TransferDrawer';
import { useTransfers } from './transfers';

type ServerTab = 'gpu' | 'proc' | 'files';

export default function App() {
  const { servers, theme, setTheme, density, setDensity, toasts, demo, configs } = useStore();
  const tf = useTransfers();
  const activeTransferCount = tf.runningCount + tf.queuedCount;
  const [view, setView] = useState<{ kind: 'overview' } | { kind: 'server'; id: string; tab: ServerTab }>({ kind: 'overview' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const current = view.kind === 'server' ? servers.find((s) => s.id === view.id) : undefined;

  // 打开服务器：同一台保留当前 tab，换台回到 GPU；tab 状态提升到这里，避免切 tab 重挂载丢文件面板状态
  const openServer = (id: string, tab?: ServerTab) =>
    setView((v) => ({
      kind: 'server',
      id,
      tab: tab ?? (v.kind === 'server' && v.id === id ? v.tab : 'gpu'),
    }));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Server Console <small>v0.4.0</small>
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view.kind === 'overview' ? 'active' : ''}`}
            onClick={() => setView({ kind: 'overview' })}
          >
            <span>总览</span>
            <span className="sub">{servers.filter((s) => s.status === 'online').length}/{servers.length}</span>
          </button>
          <div className="note" style={{ padding: '10px 10px 4px' }}>服务器</div>
          {servers.map((s) => {
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
          })}
        </nav>
        <div className="sidebar-foot">
          <button className="btn" style={{ flex: 1, paddingInline: 4 }} onClick={() => setImportOpen(true)}>
            导入
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setManagerOpen(true)}>
            服务器
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="title">{view.kind === 'overview' ? '总览' : current?.name}</span>
          {demo && (
            <button className="btn" style={{ color: 'var(--warn)' }} onClick={() => setManagerOpen(true)}>
              演示数据 · 点此连接真实服务器
            </button>
          )}
          <span className="spacer" />
          <button
            className={`transfer-entry ${activeTransferCount ? 'active' : ''}`}
            onClick={() => window.dispatchEvent(new Event('sc:show-transfers'))}
            title="打开传输中心"
          >
            <span className="transfer-entry-ico"><ArrowUpDown size={13} strokeWidth={2.2} /></span>
            传输
            {activeTransferCount > 0 && <span className="transfer-entry-badge num">{activeTransferCount}</span>}
          </button>
          <div className="seg">
            {(
              [
                ['system', '跟随'],
                ['light', '浅'],
                ['dark', '深'],
              ] as Array<[ThemeMode, string]>
            ).map(([v, l]) => (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="seg">
            {(
              [
                ['compact', '紧凑'],
                ['default', '默认'],
                ['comfy', '宽松'],
              ] as Array<[Density, string]>
            ).map(([v, l]) => (
              <button key={v} className={density === v ? 'on' : ''} onClick={() => setDensity(v)}>
                {l}
              </button>
            ))}
          </div>
        </header>

        <ConfigWatchBanner />
        <div className="content">
          {view.kind === 'overview' ? (
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
              <Overview onOpen={(id) => openServer(id)} />
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
    </div>
  );
}
