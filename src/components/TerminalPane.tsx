import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../state';
import type { TerminalSessionInfo } from '../types';

// 单个终端会话：xterm 绑定主进程会话（termId）。切走 tab 时脱离（会话保留），回来时回放缓冲。
export function TerminalPane({
  serverId,
  termId,
  onClosed,
}: {
  serverId: string;
  termId: string;
  onClosed: (termId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'attaching' | 'live' | 'closed'>('attaching');

  useEffect(() => {
    const a = api;
    if (!a) return;
    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let fit: import('@xterm/addon-fit').FitAddon | null = null;
    const offList: Array<() => void> = [];
    const dbg = { dataEvents: 0, wrote: 0 };

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
        /* 容器尚未布局时忽略 */
      }

      // 输出监听（先注册再挂接，避免早期输出丢失）
      offList.push(
        a.onTerminalData(({ termId: tid, data }) => {
          dbg.dataEvents += 1;
          if (tid === termId && term) term.write(data);
        }),
      );
      offList.push(
        a.onTerminalClosed(({ termId: tid }) => {
          if (tid !== termId || disposed) return;
          setStatus('closed');
          onClosed(tid);
        }),
      );

      // 挂接：主进程回放该会话累积缓冲（记忆恢复），之后实时广播
      const replay = await a.terminalAttach(termId);
      if (disposed) return;
      if (replay) term.write(replay);
      setStatus('live');

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
        if (!term || !fit) return;
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
      term.focus();
      host.addEventListener('mousedown', () => setTimeout(() => term?.focus(), 0));

      // e2e 测试钩子：canvas 渲染下 DOM 读不到文本，暴露缓冲区读取器
      (window as unknown as { __scTerm?: unknown }).__scTerm = {
        dbg,
        dump: () => {
          if (!term) return '';
          const buf = term.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i <= buf.cursorY + 1 && i < buf.length; i++) {
            const l = buf.getLine(i);
            if (l) lines.push(l.translateToString(true));
          }
          return lines.filter(Boolean).join('\n');
        },
      };
    })();

    return () => {
      disposed = true;
      offList.forEach((off) => off());
      // 脱离（不关闭）：会话与缓冲留在主进程，切回时回放
      void a.terminalDetach(termId);
      term?.dispose();
    };
  }, [termId, serverId, onClosed]);

  return (
    <div className="term-host-wrap">
      {status !== 'live' && (
        <div className="term-status">{status === 'attaching' ? '挂接会话中…' : '会话已结束'}</div>
      )}
      <div ref={hostRef} className="term-host" />
    </div>
  );
}

// 会话条 + 多开管理：自动创建首个会话；会话在主进程持有，切 tab / 多开互不影响
export function TerminalSessions({ serverId }: { serverId: string }) {
  const { pushToast } = useStore();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState('');
  const autoCreated = useRef(false);

  const refresh = () =>
    api?.terminalList().then((list) => {
      setSessions(list.filter((s) => s.serverId === serverId));
      setLoaded(true);
    });

  useEffect(() => {
    if (!api) return;
    refresh();
    const offSessions = api.onTerminalSessions(() => refresh());
    const offClosed = api.onTerminalClosed(({ termId }) => {
      refresh();
      setActive((a) => (a === termId ? '' : a));
    });
    return () => {
      offSessions();
      offClosed();
    };
  }, [serverId]);

  const create = () => {
    if (!api) return;
    void api
      .terminalOpen(serverId, 100, 30)
      .then((r) => {
        if (r.ok && r.data) {
          setActive(r.data);
          refresh();
        } else {
          pushToast({ level: 'error', title: '终端打开失败', detail: r.error });
          autoCreated.current = false;
        }
      })
      .catch((e) => {
        pushToast({ level: 'error', title: '终端打开失败', detail: e instanceof Error ? e.message : String(e) });
        autoCreated.current = false;
      });
  };

  // 首次进入自动创建一个会话；失败（如服务器离线）允许重试
  useEffect(() => {
    if (!loaded || autoCreated.current) return;
    if (sessions.length === 0) {
      autoCreated.current = true;
      create();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, sessions.length]);

  const closeSession = (termId: string) => {
    void api?.terminalClose(termId);
    setActive((a) => (a === termId ? '' : a));
  };

  return (
    <div className="term">
      <div className="term-chips">
        {sessions.map((s, i) => (
          <span
            key={s.termId}
            className={`term-chip ${s.termId === active ? 'on' : ''}`}
            onClick={() => setActive(s.termId)}
            title="点击切换会话"
          >
            终端 {i + 1}
            <button
              className="term-chip-x"
              title="结束此会话"
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.termId);
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button className="term-chip add" title="新建终端会话（多开）" onClick={create}>
          <Plus size={13} />
        </button>
        <span style={{ flex: 1 }} />
      </div>
      {active ? (
        <TerminalPane
          key={active}
          serverId={serverId}
          termId={active}
          onClosed={(tid) => {
            refresh();
            setActive((a) => (a === tid ? '' : a));
          }}
        />
      ) : (
        <div className="term-empty">{loaded ? '点击 ＋ 新建终端会话' : '加载会话…'}</div>
      )}
    </div>
  );
}
