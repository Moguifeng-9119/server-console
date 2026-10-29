import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Copy, History, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { CommandHistoryEntry } from '../types';
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

  // 跨服务器命令历史：搜索过滤、点击回填、单条删除/清空
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const loadHistory = async (query = historyQuery) => {
    if (!api) return;
    const r = await api.cmdHistoryList(query);
    if (r.ok && r.data) setHistory(r.data);
  };
  useEffect(() => { void loadHistory('');
    // This initial load intentionally does not follow the search field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (running) return; const timer = setTimeout(() => void loadHistory(historyQuery), 200); return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery, running]);

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
      <div className="pc-history">
        <div className="pc-history-head">
          <span className="pc-label"><History size={13} /> {t('parallel.historyTitle')}</span>
          <input
            className="mini"
            style={{ width: 200 }}
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder={t('parallel.historySearch')}
          />
          <button className="btn mini" disabled={!history.length} onClick={async () => { await api?.cmdHistoryClear(); void loadHistory(); }}>
            {t('parallel.historyClear')}
          </button>
        </div>
        {history.length === 0 ? (
          <div className="pc-history-empty">{t('parallel.historyEmpty')}</div>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className={`pc-history-row ${entry.ok ? '' : 'fail'}`}>
              <button className="pc-history-cmd mono" title={t('parallel.historyFill')} onClick={() => setCmd(entry.command)}>
                {entry.ok ? '' : '✗ '}
                {entry.command}
              </button>
              <span className="pc-history-meta">{entry.servers.join(', ')}</span>
              <time>{new Date(entry.at).toLocaleString()}</time>
              <button className="btn mini" title={t('parallel.historyDelete')} onClick={async () => { await api?.cmdHistoryDelete(entry.id); void loadHistory(); }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
