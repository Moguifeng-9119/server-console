import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Copy } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../state';

// 多服务器并行命令：勾选 N 台 → 同一命令同时执行 → 分栏实时输出
export function ParallelCommand() {
  const { servers, pushToast } = useStore();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cmd, setCmd] = useState('nvidia-smi');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState('');
  const [out, setOut] = useState<Record<string, { text: string; done: boolean }>>({});
  const outRef = useRef<Record<string, { text: string; done: boolean }>>({});

  useEffect(() => {
    if (!api) return;
    const offData = api.onParallelData(({ serverId, text, done }) => {
      const cur = outRef.current[serverId] || { text: '', done: false };
      outRef.current = {
        ...outRef.current,
        [serverId]: { text: cur.text + (text || ''), done: done ? true : cur.done },
      };
      setOut(outRef.current);
    });
    const offDone = api.onParallelDone(() => {
      setRunning(false);
      pushToast({ level: 'info', title: '并行命令已结束' });
    });
    return () => {
      offData();
      offDone();
    };
  }, [pushToast]);

  const online = useMemo(() => servers.filter((s) => s.status === 'online'), [servers]);
  const pickedOnline = useMemo(() => [...picked].filter((id) => online.some((s) => s.id === id)), [picked, online]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async () => {
    if (!api) return;
    if (!pickedOnline.length) {
      pushToast({ level: 'warn', title: '请先勾选至少一台在线服务器' });
      return;
    }
    if (!cmd.trim()) {
      pushToast({ level: 'warn', title: '请输入要执行的命令' });
      return;
    }
    outRef.current = {};
    setOut({});
    const r = await api.parallelRun(pickedOnline, cmd.trim());
    if (!r.ok) {
      pushToast({ level: 'error', title: '启动失败', detail: r.error });
      return;
    }
    setRunId(r.data || '');
    setRunning(true);
  };

  const stop = async () => {
    if (runId && api) await api.parallelStop(runId);
    setRunning(false);
  };

  const entries = Object.entries(out);
  const cols = entries.length <= 1 ? 1 : entries.length <= 4 ? 2 : 3;

  return (
    <div className="pc">
      <div className="pc-toolbar">
        <span className="pc-label">目标（{pickedOnline.length}/{online.length} 在线）：</span>
        <button className="btn mini" onClick={() => setPicked(new Set(online.map((s) => s.id)))}>
          全选在线
        </button>
        <button className="btn mini" onClick={() => setPicked(new Set())}>
          清空
        </button>
        <span style={{ flex: 1 }} />
        {running ? (
          <button className="btn danger" onClick={stop}>
            <Square size={13} /> 停止
          </button>
        ) : (
          <button className="btn primary" onClick={run} disabled={!api}>
            <Play size={13} /> 运行
          </button>
        )}
      </div>
      <div className="pc-servers">
        {servers.map((s) => (
          <label key={s.id} className={`pc-server ${picked.has(s.id) ? 'on' : ''} ${s.status !== 'online' ? 'off' : ''}`}>
            <input type="checkbox" checked={picked.has(s.id)} disabled={s.status !== 'online'} onChange={() => toggle(s.id)} />
            <i className={`dot ${s.status}`} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
      <div className="pc-cmd">
        <input
          className="mini mono"
          style={{ flex: 1 }}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="在所有选中服务器上执行的命令，如：nvidia-smi --query-gpu=index,utilization.gpu --format=csv"
        />
      </div>
      {entries.length === 0 ? (
        <div className="pc-empty">输入命令并运行，输出会按服务器分栏实时显示。右键可结束远端进程——请谨慎执行破坏性命令。</div>
      ) : (
        <div className="pc-outputs" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {entries.map(([serverId, v]) => {
            const s = servers.find((x) => x.id === serverId);
            return (
              <div key={serverId} className="pc-out">
                <div className="pc-out-head">
                  <span>{s?.name || serverId}</span>
                  <span className="pc-out-status">{v.done ? '已结束' : '运行中'}</span>
                  <button
                    className="btn mini"
                    title="复制输出"
                    onClick={() => navigator.clipboard?.writeText(v.text)}
                  >
                    <Copy size={12} />
                  </button>
                </div>
                <pre className="pc-out-body mono">{v.text || '（无输出）'}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
