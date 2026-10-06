import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Copy } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../state';

// 多服务器并行命令：勾选 N 台 → 同一命令同时执行 → 分栏实时输出
export function ParallelCommand() {
  const { t } = useTranslation();
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
      pushToast({ level: 'info', title: t('parallel.ended') });
    });
    return () => {
      offData();
      offDone();
    };
  }, [pushToast, t]);

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
      pushToast({ level: 'warn', title: t('parallel.needServers') });
      return;
    }
    if (!cmd.trim()) {
      pushToast({ level: 'warn', title: t('parallel.needCmd') });
      return;
    }
    outRef.current = {};
    setOut({});
    const r = await api.parallelRun(pickedOnline, cmd.trim());
    if (!r.ok) {
      pushToast({ level: 'error', title: t('parallel.startFail'), detail: r.error });
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
        <span className="pc-label">{t('parallel.targets', { a: pickedOnline.length, b: online.length })}</span>
        <button className="btn mini" onClick={() => setPicked(new Set(online.map((s) => s.id)))}>
          {t('parallel.selectAllOnline')}
        </button>
        <button className="btn mini" onClick={() => setPicked(new Set())}>
          {t('parallel.clear')}
        </button>
        <span style={{ flex: 1 }} />
        {running ? (
          <button className="btn danger" onClick={stop}>
            <Square size={13} /> {t('parallel.stop')}
          </button>
        ) : (
          <button className="btn primary" onClick={run} disabled={!api}>
            <Play size={13} /> {t('parallel.run')}
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
          placeholder={t('parallel.cmdPh')}
        />
      </div>
      {entries.length === 0 ? (
        <div className="pc-empty">{t('parallel.emptyHint')}</div>
      ) : (
        <div className="pc-outputs" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {entries.map(([serverId, v]) => {
            const s = servers.find((x) => x.id === serverId);
            return (
              <div key={serverId} className="pc-out">
                <div className="pc-out-head">
                  <span>{s?.name || serverId}</span>
                  <span className="pc-out-status">{v.done ? t('parallel.done') : t('parallel.running')}</span>
                  <button
                    className="btn mini"
                    title={t('parallel.copyOut')}
                    onClick={() => navigator.clipboard?.writeText(v.text)}
                  >
                    <Copy size={12} />
                  </button>
                </div>
                <pre className="pc-out-body mono">{v.text || t('parallel.noOut')}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
