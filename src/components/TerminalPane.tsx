import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X, Columns2, Rows2, Square, Pencil, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useStoreControls } from '../state';
import { useTranslation } from 'react-i18next';
import type { TerminalSessionInfo } from '../types';
import { takeTerminalCommand } from '../workbench-navigation';
import './workcenter.css';

type TerminalDebug = { dbg: { dataEvents: number; wrote: number }; dump: () => string };
const debugWindow = window as unknown as { __scTerm?: TerminalDebug; __scTerms?: Record<string, TerminalDebug> };

// Terminal ownership is independent of the selected monitoring/file page.
// Visit lazily; retain each server's panes until it is removed from the store.
export function TerminalWorkspace({ serverIds, activeServerId }: { serverIds: string[]; activeServerId: string | null }) {
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    setVisited((previous) => {
      const next = previous.filter((id) => serverIds.includes(id));
      if (activeServerId && serverIds.includes(activeServerId) && !next.includes(activeServerId)) next.push(activeServerId);
      return next.length === previous.length && next.every((id, i) => id === previous[i]) ? previous : next;
    });
  }, [serverIds, activeServerId]);
  const mounted = activeServerId && !visited.includes(activeServerId) ? [...visited, activeServerId] : visited;
  return <div className="terminal-workspace">{mounted.filter((id) => serverIds.includes(id)).map((id) => (
    <TerminalSessions key={id} serverId={id} visible={id === activeServerId} />
  ))}</div>;
}

// 单个终端会话：xterm 绑定主进程会话（termId）。
// 生命周期设计：effect 只跑一次（deps 仅 termId），onClosed 用 ref 避免
// 父组件重渲染导致 effect 重跑（那会销毁 xterm → 闪屏 + 内容丢失）。
// 切 tab 由父组件控制可见性而非卸载，xterm DOM 常驻不销毁。
export function TerminalPane({
  termId,
  onClosed,
  active,
  selected = active,
  onSelect,
  onReady,
}: {
  termId: string;
  onClosed: (termId: string) => void;
  active: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onReady?: (termId: string) => void;
}) {
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const selectedRef = useRef(selected), selectCallback = useRef(onSelect);
  selectedRef.current = selected; selectCallback.current = onSelect;
  const activateRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState('');
  const { t } = useTranslation();
  // ===== 终端内搜索（Ctrl+F，xterm 官方 addon）=====
  const searchRef = useRef<import('@xterm/addon-search').SearchAddon | null>(null);
  const termFocusRef = useRef<(() => void) | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const runSearch = (direction: 'next' | 'previous') => {
    const addon = searchRef.current;
    if (!addon || !searchQuery) return;
    const opts = { caseSensitive: false, incremental: false };
    if (direction === 'next') void addon.findNext(searchQuery, opts); else void addon.findPrevious(searchQuery, opts);
  };
  // 用 ref 存 onClosed，避免它作为 effect 依赖导致反复重建
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    const a = api;
    if (!a) return;
    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let fit: import('@xterm/addon-fit').FitAddon | null = null;
    const offList: Array<() => void> = [];
    const dbg = { dataEvents: 0, wrote: 0 };
    const pending: Array<{ data: string; sequence: number }> = [];
    let replayReady = false;
    let lastSequence = 0;
    const write = (data: string) => { if (!disposed && term) { term.write(data); dbg.wrote += 1; } };

    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;

      term = new Terminal({
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        fontSize: 12.5,
        cursorBlink: true,
        scrollback: 2000,
        theme: {
          background: '#0e1116',
          foreground: '#e7eef8',
          cursor: '#22d3ee',
          selectionBackground: 'rgba(34, 211, 238, 0.3)',
        },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      const { SearchAddon } = await import('@xterm/addon-search');
      const search = new SearchAddon();
      term.loadAddon(search);
      searchRef.current = search;
      termFocusRef.current = () => term?.focus();
      term.open(host);
      try {
        fit.fit();
      } catch {
        /* 容器可能处于 display:none（首次在别的 tab 创建），等切回时 ResizeObserver 触发 */
      }

      // 输出监听（先注册再挂接，避免早期输出丢失）
      offList.push(
        a.onTerminalData(({ termId: tid, data, sequence }) => {
          if (tid !== termId || disposed) return;
          dbg.dataEvents += 1;
          if (!replayReady) pending.push({ data, sequence });
          else if (sequence > lastSequence) { lastSequence = sequence; write(data); }
        }),
      );
      offList.push(
        a.onTerminalClosed(({ termId: tid }) => {
          if (tid !== termId || disposed) return;
          onClosedRef.current(tid);
        }),
      );

      // 挂接：主进程回放该会话累积缓冲（记忆恢复），之后实时广播
      const replay = await a.terminalAttach(termId);
      if (disposed) return;
      if (!replay) { onClosedRef.current(termId); return; }
      lastSequence = replay.sequence;
      if (replay.data) write(replay.data);
      pending.forEach(({ data, sequence }) => { if (sequence > lastSequence) { lastSequence = sequence; write(data); } });
      pending.length = 0;
      replayReady = true;
      readyCallback.current?.(termId);

      term.onData((data) => void a.terminalWrite(termId, data));

      // ===== 复制/粘贴（Windows 习惯） =====
      const copySelection = () => {
        if (term?.hasSelection()) {
          void navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
        }
      };
      const pasteClipboard = async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (!t) return;
          // 多行粘贴：换行统一为 \r（逐行执行），与 Windows 控制台一致
          void a.terminalWrite(termId, t.replace(/\r\n/g, '\r').replace(/\n/g, '\r'));
        } catch {
          /* 剪贴板不可用时忽略 */
        }
      };
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== 'keydown') return true;
        const k = ev.key.toLowerCase();
        if (ev.ctrlKey && ev.shiftKey && k === 'c') { if (term) copySelection(); return false; }
        if (ev.ctrlKey && ev.shiftKey && k === 'v') { void pasteClipboard(); return false; }
        // Ctrl+F：终端内搜索
        if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'f') { setSearchOpen(true); return false; }
        // Windows 风格 Ctrl+C：有选中=复制，无选中=发送中断信号
        if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'c' && term && term.hasSelection()) {
          copySelection();
          return false;
        }
        if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'v') { void pasteClipboard(); return false; }
        if (ev.key === 'Insert' && ev.shiftKey) { void pasteClipboard(); return false; }
        if (ev.key === 'Insert' && ev.ctrlKey && term && term.hasSelection()) { copySelection(); return false; }
        return true;
      });
      // 右键：有选中=复制，无选中=粘贴
      host.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (term && term.hasSelection()) copySelection();
        else void pasteClipboard();
      });

      const onResize = () => {
        if (!term || !fit || disposed || !activeRef.current) return;
        // display:none 时 offsetWidth/Height 为 0，跳过避免 xterm 崩溃
        if (host.offsetWidth === 0 || host.offsetHeight === 0) return;
        try {
          fit.fit();
          void a.terminalResize(termId, term.cols, term.rows);
        } catch {
          /* noop */
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);
      onResize();

      // 关键：xterm 只有聚焦才会产生 onData
      activateRef.current = () => {
        if (!activeRef.current || disposed) return;
        onResize();
        if (!selectedRef.current) return;
        term?.focus();
        debugWindow.__scTerm = debugWindow.__scTerms?.[termId];
      };
      host.addEventListener('mousedown', () => { selectedRef.current = true; selectCallback.current?.(); activateRef.current?.(); });

      // e2e 测试钩子：canvas 渲染下 DOM 读不到文本，暴露缓冲区读取器
      debugWindow.__scTerms ||= {};
      debugWindow.__scTerms[termId] = {
        dbg,
        dump: () => {
          if (!term) return '';
          const buf = term.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i <= buf.baseY + buf.cursorY + 1 && i < buf.length; i++) {
            const l = buf.getLine(i);
            if (l) lines.push(l.translateToString(true));
          }
          return lines.filter(Boolean).join('\n');
        },
      };
      activateRef.current();
      offList.push(() => ro.disconnect());
    })().catch((e) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e));
      offList.splice(0).forEach((off) => off());
      void a.terminalDetach(termId);
      term?.dispose();
    });

    return () => {
      disposed = true;
      activateRef.current = null;
      searchRef.current = null;
      termFocusRef.current = null;
      setSearchOpen(false);
      offList.forEach((off) => off());
      if (debugWindow.__scTerm === debugWindow.__scTerms?.[termId]) delete debugWindow.__scTerm;
      if (debugWindow.__scTerms) delete debugWindow.__scTerms[termId];
      // 脱离（不关闭）：会话与缓冲留在主进程
      void a.terminalDetach(termId);
      term?.dispose();
    };
    // effect 仅依赖 termId：onClosed 用 ref，serverId 不变，active 由父组件控制 display
  }, [termId]);

  // 切回活跃时聚焦
  useEffect(() => {
    if (active) {
      // 等 display 恢复后再聚焦
      const timer = setTimeout(() => {
        // 通过 ResizeObserver 触发 fit + 聚焦
        activateRef.current?.();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [active, selected]);

  return (
    <div
      ref={hostRef}
      className="term-host term-pane"
      data-term-id={termId}
      style={{ display: active ? 'block' : 'none' }}
    >
      {searchOpen && (
        <div className="term-search-bar">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); runSearch(e.shiftKey ? 'previous' : 'next'); }
              if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); searchRef.current?.clearDecorations(); termFocusRef.current?.(); }
            }}
            placeholder={t('terminal.searchPh')}
            aria-label={t('terminal.searchPh')}
          />
          <button className="btn mini" title={t('terminal.searchPrev')} aria-label={t('terminal.searchPrev')} onClick={() => runSearch('previous')}><ChevronUp size={12} /></button>
          <button className="btn mini" title={t('terminal.searchNext')} aria-label={t('terminal.searchNext')} onClick={() => runSearch('next')}><ChevronDown size={12} /></button>
          <button className="btn mini" title={t('terminal.searchClose')} aria-label={t('terminal.searchClose')} onClick={() => { setSearchOpen(false); searchRef.current?.clearDecorations(); termFocusRef.current?.(); }}><X size={12} /></button>
        </div>
      )}
      {error && <div role="alert">{t('terminal.openFail')}: {error}</div>}
    </div>
  );
}

// 会话条 + 多开管理：所有 TerminalPane 常驻挂载（仅 CSS 隐藏非活跃的），切 tab 不卸载
export function TerminalSessions({ serverId, visible }: { serverId: string; visible: boolean }) {
  const { pushToast } = useStoreControls();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState('');
  const autoCreated = useRef(false);
  const pendingCreate = useRef(false);
  const [creating, setCreating] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const [layout, setLayout] = useState<'single' | 'columns' | 'rows'>(() => { try { const value = localStorage.getItem('sc.term.layout.' + serverId); return value === 'columns' || value === 'rows' ? value : 'single'; } catch { return 'single'; } });
  const [names, setNames] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('sc.term.names.' + serverId) || '{}'); } catch { return {}; } });
  const [renaming, setRenaming] = useState(''), [draftName, setDraftName] = useState('');
  const [tmux, setTmux] = useState<{ available: boolean; sessions: Array<{ name: string; windows: number; attached: number }> } | null>(null);
  const [tmuxBusy, setTmuxBusy] = useState(false), [tmuxSelected, setTmuxSelected] = useState('');
  const [commandRevision, setCommandRevision] = useState(0);
  const ready = useRef(new Set<string>()), pendingWrites = useRef(new Map<string, string>());
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const label = (key: string, fallback: string) => t('features.' + key, { defaultValue: fallback });
  const changeLayout = (next: typeof layout) => { setLayout(next); try { localStorage.setItem('sc.term.layout.' + serverId, next); } catch { /* layout stays available for this session */ } };
  const rename = () => { const value = draftName.trim().slice(0, 80); const next = { ...names }; if (value) next[renaming] = value; else delete next[renaming]; setNames(next); setRenaming(''); try { localStorage.setItem('sc.term.names.' + serverId, JSON.stringify(next)); } catch { /* keep in memory */ } };
  const flushCommand = (termId: string) => { const command = pendingWrites.current.get(termId); if (!command || !visibleRef.current || !ready.current.has(termId) || !api) return; pendingWrites.current.delete(termId); void api.terminalWrite(termId, command + '\r').catch((error) => pushToast({ level: 'error', title: t('terminal.openFail'), detail: String(error) })); };
  const terminalReady = (termId: string) => { ready.current.add(termId); flushCommand(termId); };
  useEffect(() => { const listener = (event: Event) => { if ((event as CustomEvent<{ serverId: string }>).detail?.serverId === serverId) setCommandRevision((n) => n + 1); }; window.addEventListener('sc:terminal-command', listener); return () => window.removeEventListener('sc:terminal-command', listener); }, [serverId]);


  const applySessions = useCallback((list: TerminalSessionInfo[]) => {
    const own = list.filter((s) => s.serverId === serverId);
    setSessions(own);
    setActive((previous) => own.some((s) => s.termId === previous) ? previous : own[0]?.termId || '');
    setLoaded(true);
  }, [serverId]);

  const refresh = useCallback(async () => {
    const currentRevision = ++revision.current;
    try {
      const list = await api?.terminalList();
      if (list && mounted.current && currentRevision === revision.current) applySessions(list);
    } catch (e) {
      if (mounted.current && currentRevision === revision.current) pushToast({ level: 'error', title: t('terminal.openFail'), detail: String(e) });
    }
  }, [applySessions, pushToast, t]);

  useEffect(() => {
    if (!api) return;
    mounted.current = true;
    const invalidate = () => { revision.current += 1; };
    void refresh();
    const offSessions = api.onTerminalSessions((list) => { ++revision.current; applySessions(list); });
    const offClosed = api.onTerminalClosed(({ termId }) => {
      refresh();
      setActive((a) => (a === termId ? '' : a));
    });
    return () => {
      offSessions();
      offClosed();
      mounted.current = false;
      invalidate();
    };
  }, [refresh, applySessions]);

  const create = (command?: string) => {
    if (!api || pendingCreate.current) return;
    pendingCreate.current = true;
    setCreating(true);
    void api
      .terminalOpen(serverId, 100, 30)
      .then((r) => {
        if (!mounted.current) return;
        if (r.ok && r.data) {
          if (command) pendingWrites.current.set(r.data, command);
          setActive(r.data);
          refresh();
        } else {
          pushToast({ level: 'error', title: t('terminal.openFail'), detail: r.error });
          autoCreated.current = false;
        }
      })
      .catch((e) => {
        if (!mounted.current) return;
        pushToast({ level: 'error', title: t('terminal.openFail'), detail: e instanceof Error ? e.message : String(e) });
        autoCreated.current = false;
      }).finally(() => { pendingCreate.current = false; if (mounted.current) setCreating(false); });
  };

  useEffect(() => {
    if (!visible || !loaded || pendingCreate.current) return;
    for (const termId of pendingWrites.current.keys()) flushCommand(termId);
    const command = takeTerminalCommand(serverId);
    if (command) { autoCreated.current = true; create(command); }
    // The create guard serializes terminal ownership; the revision is only an arrival signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loaded, commandRevision, creating, serverId]);
  const discoverTmux = async () => {
    if (!api || tmuxBusy) return; setTmuxBusy(true);
    try { const result = await api.workbenchRequest<{ available: boolean; sessions: Array<{ name: string; windows: number; attached: number }> }>({ operation: 'tmux.list', serverId }); if (!mounted.current) return; if (!result.ok || !result.data) throw new Error(result.error); setTmux(result.data); setTmuxSelected(result.data.sessions[0]?.name || ''); }
    catch (error) { if (mounted.current) pushToast({ level: 'error', title: 'tmux', detail: String(error) }); }
    finally { if (mounted.current) setTmuxBusy(false); }
  };
  const attachTmux = async () => {
    if (!api || !tmuxSelected || pendingCreate.current || tmuxBusy) return; setTmuxBusy(true);
    try { const result = await api.workbenchRequest<{ command: string }>({ operation: 'tmux.attach', serverId, name: tmuxSelected }); if (!mounted.current) return; if (!result.ok || !result.data) throw new Error(result.error); create(result.data.command); }
    catch (error) { if (mounted.current) pushToast({ level: 'error', title: 'tmux', detail: String(error) }); }
    finally { if (mounted.current) setTmuxBusy(false); }
  };

  // 首次进入自动创建一个会话；失败（如服务器离线）允许重试
  useEffect(() => {
    if (!loaded || autoCreated.current || !visible) return;
    if (sessions.length === 0) {
      autoCreated.current = true;
      create();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sessions.length, visible]);

  const closeSession = (termId: string) => {
    void api?.terminalClose(termId);
    setActive((a) => (a === termId ? '' : a));
  };

  // 服务器着色：serverId hash → 固定 hue，多开会话时防走错服务器
  const hue = useMemo(() => {
    let h = 0;
    for (let i = 0; i < serverId.length; i += 1) h = (h * 31 + serverId.charCodeAt(i)) % 360;
    return h;
  }, [serverId]);

  return (
    <div className="term" style={{ display: visible ? 'flex' : 'none', '--term-hue': hue } as React.CSSProperties}>
      <div className="term-chips">
        {sessions.map((s, i) => (
          <div
            key={s.termId}
            className={`term-chip ${s.termId === active ? 'on' : ''}`}
            title={t('terminal.switchHint')}
          >
            <i className="term-dot" aria-hidden="true" />
            <button className="term-chip-select" aria-pressed={s.termId === active} onClick={() => setActive(s.termId)}>{names[s.termId] || t('terminal.termN', { n: i + 1 })}</button><button className="term-chip-x" title={label('rename', 'Rename')} aria-label={label('rename', 'Rename')} onClick={() => { setDraftName(names[s.termId] || ''); setRenaming(s.termId); }}><Pencil size={10} /></button>
            <button
              className="term-chip-x"
              title={t('terminal.closeSession')}
              aria-label={`${t('terminal.closeSession')} · ${t('terminal.termN', { n: i + 1 })}`}
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.termId);
              }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button className="term-chip add" title={t('terminal.newSession')} onClick={() => create()} disabled={creating}>
          <Plus size={13} />
        </button>
        <span style={{ flex: 1 }} /><div className="term-tools">{([['single', Square], ['columns', Columns2], ['rows', Rows2]] as const).map(([kind, Icon]) => <button key={kind} className={`btn mini ${layout === kind ? 'on' : ''}`} aria-pressed={layout === kind} title={label('layout' + kind, kind)} aria-label={label('layout' + kind, kind)} onClick={() => changeLayout(kind)}><Icon size={13} /></button>)}<button className="btn mini" disabled={tmuxBusy} onClick={() => void discoverTmux()}><RefreshCw size={12} />tmux</button></div>
      </div>
      {renaming && <form className="terminal-search" onSubmit={(e) => { e.preventDefault(); rename(); }}><input autoFocus aria-label={label('rename', 'Rename')} maxLength={80} value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(''); }} /><button className="btn mini">{label('save', 'Save')}</button><button className="btn mini" type="button" onClick={() => setRenaming('')}>{t('settings.close')}</button></form>}
      {tmux && <div className="terminal-search"><span>{tmux.available ? label('tmuxSessions', 'Remote tmux sessions') : label('tmuxUnavailable', 'tmux is not installed')}</span>{tmux.sessions.length ? <><select aria-label={label('tmuxSessions', 'Remote tmux sessions')} value={tmuxSelected} onChange={(e) => setTmuxSelected(e.target.value)}>{tmux.sessions.map((session) => <option key={session.name} value={session.name}>{session.name} · {session.windows}</option>)}</select><button className="btn mini" disabled={tmuxBusy || creating} onClick={() => void attachTmux()}>{label('attach', 'Attach')}</button></> : tmux.available && <span>{label('noSessions', 'No sessions')}</span>}<button className="btn mini" onClick={() => setTmux(null)}>{t('settings.close')}</button></div>}
      <div className={`terminal-split ${layout}`}>{sessions.map((s) => (
            <TerminalPane
              key={s.termId}
              termId={s.termId}
              active={visible && (s.termId === active || layout !== 'single' && s.termId === sessions.find((session) => session.termId !== active)?.termId)}
              selected={visible && s.termId === active}
              onSelect={() => setActive(s.termId)}
              onReady={terminalReady}
              onClosed={(tid) => {
                refresh();
                setActive((a) => (a === tid ? '' : a));
              }}
            />
          ))}</div>
      {!active && (
        <div className="term-empty">{loaded ? t('terminal.clickPlus') : t('terminal.loadingSessions')}</div>
      )}
    </div>
  );
}
