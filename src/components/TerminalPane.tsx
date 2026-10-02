import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import { api } from '../api';

// 内嵌 SSH 终端：xterm.js + ssh2 shell 流。断线提示重连；demo/浏览器模式显示占位。
export function TerminalPane({ serverId }: { serverId: string }) {
  const { pushToast } = useStore();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termIdRef = useRef('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'closed' | 'no-api'>('idle');
  const [gen, setGen] = useState(0); // 重连计数，触发 effect 重建

  useEffect(() => {
    if (!api) {
      setStatus('no-api');
      return;
    }
    const a = api;
    let disposed = false;
    let termId = '';
    let term: import('@xterm/xterm').Terminal | null = null;
    let fit: import('@xterm/addon-fit').FitAddon | null = null;
    const offList: Array<() => void> = [];

    setStatus('connecting');
    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      if (disposed) return;
      const host = hostRef.current;
      if (!host) return;

      term = new Terminal({
        fontFamily: "'JetBrains Mono', Consolas, monospace",
        fontSize: 12.5,
        cursorBlink: true,
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

      const r = await a.terminalOpen(serverId, term.cols || 80, term.rows || 24);
      if (disposed) {
        if (r.ok && r.data) void a.terminalClose(r.data);
        return;
      }
      if (!r.ok || !r.data) {
        setStatus('closed');
        term.write(`\r\n\x1b[31m连接失败：${r.error || '未知错误'}\x1b[0m\r\n`);
        return;
      }
      termId = r.data;
      termIdRef.current = termId;
      setStatus('live');
      term.onData((data) => void a.terminalWrite(termId, data));
      offList.push(
        a.onTerminalData(({ termId: tid, data }) => {
          if (tid === termId) term?.write(data);
        }),
      );
      offList.push(
        a.onTerminalClosed(({ termId: tid }) => {
          if (tid !== termId || disposed) return;
          setStatus('closed');
          term?.write('\r\n\x1b[33m连接已断开，点击上方「重连」。\x1b[0m\r\n');
        }),
      );
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
    })();

    return () => {
      disposed = true;
      offList.forEach((off) => off());
      if (termId) void a.terminalClose(termId);
      termIdRef.current = '';
      term?.dispose();
    };
  }, [serverId, gen]);

  return (
    <div className="term">
      <div className="term-toolbar">
        <span className={`dot ${status === 'live' ? 'online' : status === 'connecting' ? 'timeout' : 'offline'}`} />
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
          {status === 'live' ? '已连接' : status === 'connecting' ? '连接中…' : status === 'no-api' ? '终端需在桌面端连接真实服务器' : '已断开'}
        </span>
        <span style={{ flex: 1 }} />
        {(status === 'closed' || status === 'live') && (
          <button
            className="btn mini"
            onClick={() => {
              if (termIdRef.current) void api?.terminalClose(termIdRef.current);
              setStatus('connecting');
              setGen((g) => g + 1);
              pushToast({ level: 'info', title: '正在重连终端' });
            }}
          >
            重连
          </button>
        )}
      </div>
      <div ref={hostRef} className="term-host" />
    </div>
  );
}
