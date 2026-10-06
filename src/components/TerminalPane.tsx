import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import type { TerminalSessionInfo } from '../types';

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
}: {
  termId: string;
  onClosed: (termId: string) => void;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const activateRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState('');
  const { t } = useTranslation();
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
        term?.focus();
        debugWindow.__scTerm = debugWindow.__scTerms?.[termId];
      };
      host.addEventListener('mousedown', () => activateRef.current?.());

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
  }, [active]);

  return (
    <div
      ref={hostRef}
      className="term-host"
      data-term-id={termId}
      style={{ display: active ? 'block' : 'none' }}
    >{error && <div role="alert">{t('terminal.openFail')}: {error}</div>}</div>
  );
}

// 会话条 + 多开管理：所有 TerminalPane 常驻挂载（仅 CSS 隐藏非活跃的），切 tab 不卸载
export function TerminalSessions({ serverId, visible }: { serverId: string; visible: boolean }) {
  const { pushToast } = useStore();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState('');
  const autoCreated = useRef(false);
  const pendingCreate = useRef(false);
  const [creating, setCreating] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);

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

  const create = () => {
    if (!api || pendingCreate.current) return;
    pendingCreate.current = true;
    setCreating(true);
    void api
      .terminalOpen(serverId, 100, 30)
      .then((r) => {
        if (!mounted.current) return;
        if (r.ok && r.data) {
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

  return (
    <div className="term" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="term-chips">
        {sessions.map((s, i) => (
          <div
            key={s.termId}
            className={`term-chip ${s.termId === active ? 'on' : ''}`}
            title={t('terminal.switchHint')}
          >
            <button className="term-chip-select" aria-pressed={s.termId === active} onClick={() => setActive(s.termId)}>{t('terminal.termN', { n: i + 1 })}</button>
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
        <button className="term-chip add" title={t('terminal.newSession')} onClick={create} disabled={creating}>
          <Plus size={13} />
        </button>
        <span style={{ flex: 1 }} />
      </div>
      {sessions.map((s) => (
            <TerminalPane
              key={s.termId}
              termId={s.termId}
              active={visible && s.termId === active}
              onClosed={(tid) => {
                refresh();
                setActive((a) => (a === tid ? '' : a));
              }}
            />
          ))}
      {!active && (
        <div className="term-empty">{loaded ? t('terminal.clickPlus') : t('terminal.loadingSessions')}</div>
      )}
    </div>
  );
}
