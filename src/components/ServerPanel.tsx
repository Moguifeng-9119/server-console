import { useEffect, useMemo, useState, useRef } from 'react';
import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import { freeGiB, gpuOwners, isFreshSample } from '../resources';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { api } from '../api';
import type { ProcessItem, Server } from '../types';
import { ContextMenu } from './ContextMenu';
import { FileManager } from './FileManager';
import { TerminalSessions } from './TerminalPane';

type SortKey = 'pid' | 'user' | 'cpu' | 'mem' | 'rssMb' | 'state' | 'command';

function KpiStrip({ s }: { s: Server }) {
  const { colorOf } = useStore();
  const { t } = useTranslation();
  const avg = s.gpus.reduce((a, g) => a + g.util, 0) / (s.gpus.length || 1);
  const vram =
    (s.gpus.reduce((a, g) => a + g.memUsed, 0) / (s.gpus.reduce((a, g) => a + g.memTotal, 0) || 1)) * 100;
  const zombies = s.processes.filter((p) => p.state === 'Z').length;
  const cells: Array<{ k: string; v: string; color?: string }> = [
    { k: t('kpi.processes'), v: String(s.processes.length) },
    { k: t('kpi.zombies'), v: String(zombies), color: zombies ? 'var(--crit)' : undefined },
    { k: t('kpi.avgGpu'), v: `${Math.round(avg)}%`, color: colorOf(avg) },
    { k: t('kpi.vram'), v: `${Math.round(vram)}%`, color: colorOf(vram) },
    { k: t('kpi.load'), v: s.loadAvg[0].toFixed(1) },
    { k: t('kpi.cpu', { cores: s.cpuCores }), v: s.cpuUsage == null ? 'N/A' : `${s.cpuUsage}%`, color: s.cpuUsage == null ? undefined : colorOf(s.cpuUsage) },
    { k: t('kpi.mem'), v: `${Math.round(s.memUsed)}/${Math.round(s.memTotal)}G`, color: colorOf((s.memUsed / s.memTotal) * 100) },
    { k: t('kpi.swap'), v: `${s.swapUsed}/${s.swapTotal}G` },
  ];
  return (
    <div className="kpi-strip">
      {cells.map((c) => (
        <div className="cell" key={c.k}>
          <div className="v num" style={{ color: c.color }} data-console-kpi={c.k}>
            {c.v}
          </div>
          <div className="k">{c.k}</div>
        </div>
      ))}
    </div>
  );
}

function GpuList({ s, onMenu }: { s: Server; onMenu: (pid: number, x: number, y: number) => void }) {
  const { colorOf } = useStore();
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sc.gpu.matrix');
      return saved === null ? s.gpus.length >= 4 : saved === 'true';
    } catch {
      return s.gpus.length >= 4;
    }
  });

  const toggleMatrix = () => {
    setMatrix((prev) => {
      const next = !prev;
      localStorage.setItem('sc.gpu.matrix', String(next));
      return next;
    });
  };

  return (
    <>
      {s.gpus.length >= 4 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <button className="btn mini" onClick={toggleMatrix} title={t('workbench.gpuLayout')}>
            {t(matrix ? 'workbench.detailed' : 'workbench.compact')}
          </button>
        </div>
      )}
      <p className="gpu-model-heading">{[...new Set(s.gpus.map((g) => g.name))].join(' / ')}</p>
      <div className={`gpu-list ${matrix ? 'matrix' : ''}`}>
      {s.gpus.map((g) => {
        const memPct = (g.memUsed / g.memTotal) * 100;
        return (
          <div className="gpu-card" key={g.index}>
            <div className="h">
              <span className="idx">GPU {g.index}</span>
              <span className="nm">{gpuOwners(s, g).join(', ') || t('workbench.noProcesses')}</span>
            </div>

            <div className="metric-line">
              <span className="num" style={{ fontSize: 'calc(var(--fs-kpi) - 6px)', color: colorOf(g.util) }}>
                {g.util}%
              </span>
              <span className="note">{t('gpu.util')}</span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}>
              <i style={{ width: `${g.util}%`, background: colorOf(g.util) }} />
            </div>

            <div className="metric-line" style={{ marginTop: 10 }}>
              <span className="num" style={{ fontSize: 15, color: colorOf(memPct) }}>
                {(g.memUsed / 1024).toFixed(1)} / {(g.memTotal / 1024).toFixed(0)} GiB
              </span>
              <span className="note">{t('gpu.vramPct', { v: memPct.toFixed(0) })}</span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}>
              <i style={{ width: `${memPct}%`, background: colorOf(memPct) }} />
            </div>

            <div className="gpu-free"><strong className="num">{freeGiB(g).toFixed(1)} GiB</strong><span>{t('workbench.freeMemory')}</span></div>
            <div className="metrics">
              <div>
                {t('gpu.temp')}<b style={g.temp == null ? undefined : { color: colorOf(g.temp) }}>{g.temp == null ? t('gpu.na') : `${g.temp}°C`}</b>
              </div>
              <div>
                {t('gpu.power')}<b>{g.power == null ? t('gpu.na') : `${g.power} W`}</b>
              </div>
              <div title={g.fan == null ? t('gpu.fanNaTip') : undefined}>
                {t('gpu.fan')}<b>{g.fan == null ? t('gpu.na') : `${g.fan}%`}</b>
              </div>
            </div>

            <div className="gpu-procs">
              {g.procs.length === 0 && <span className="faint">{t('workbench.noProcesses')}</span>}
              {g.procs.map((p) => (
                <div
                  key={p.pid}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onMenu(p.pid, e.clientX, e.clientY);
                  }}
                  className="gpu-proc-line"
                >
                  <span className="mono" style={{ color: 'var(--text)' }}>
                    {p.pid}
                  </span>
                  <span title={p.name}>{p.user || s.processes.find((item) => item.pid === p.pid)?.user || p.name}</span>
                  <span className="mono" style={{ marginLeft: 'auto' }}>
                    {(p.memMb / 1024).toFixed(1)} GiB
                  </span><button className="btn mini proc-action" aria-label={t('ctx.proc', { pid: p.pid })} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(p.pid, r.left, r.bottom); }}>⋯</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}

function ProcessTable({ s, onMenu }: { s: Server; onMenu: (pid: number, x: number, y: number) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [user, setUser] = useState('all');
  const [onlyGpu, setOnlyGpu] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [asc, setAsc] = useState(false);

  const users = useMemo(() => Array.from(new Set(s.processes.map((p) => p.user))).sort(), [s.processes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = s.processes.filter((p) => {
      if (user !== 'all' && p.user !== user) return false;
      if (onlyGpu && p.gpu === null) return false;
      if (!q) return true;
      return p.command.toLowerCase().includes(q) || String(p.pid).includes(q) || p.user.includes(q);
    });
    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const r = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return asc ? r : -r;
    });
    return list;
  }, [s.processes, query, user, onlyGpu, sortKey, asc]);

  const th = (key: SortKey, label: string, w?: number) => (
    <th
      style={{ width: w }}
      onClick={() => {
        if (key === sortKey) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(false);
        }
      }}
    >
      <button className="table-sort">{label}{sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );

  return (
    <>
      <div className="toolbar">
        <input
          className="mini"
          placeholder={t('proc.searchPh')} aria-label={t('proc.searchPh')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="mini" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="all">{t('proc.allUsers')}</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <label className="dim" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyGpu} onChange={(e) => setOnlyGpu(e.target.checked)} />
          {t('proc.onlyGpu')}
        </label>
        <span className="faint">
          {t('proc.count', { a: rows.length, b: s.processes.length })}
        </span>
      </div>

      <div className="table-wrap">
        <table className="proc">
          <thead>
            <tr>
              {th('pid', 'PID', 80)}
              {th('user', 'USER', 90)}
              {th('cpu', 'CPU%', 80)}
              {th('mem', 'MEM%', 80)}
              {th('rssMb', 'RSS', 90)}
              {th('state', 'STAT', 60)}
              <th style={{ width: 60 }}>GPU</th>
              <th>COMMAND</th><th aria-label={t('workbench.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((p: ProcessItem) => (
              <tr
                key={p.pid}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu(p.pid, e.clientX, e.clientY);
                }}
              >
                <td className="mono">{p.pid}</td>
                <td>{p.user}</td>
                <td className="num">{p.cpu.toFixed(1)}</td>
                <td className="num">{p.mem.toFixed(1)}</td>
                <td className="num">{(p.rssMb / 1024).toFixed(1)}G</td>
                <td className="mono" style={{ color: p.state === 'Z' ? 'var(--crit)' : undefined }}>
                  {p.state}
                </td>
                <td className="mono">{(p.gpuIndices || (p.gpu == null ? [] : [p.gpu])).join(', ')}</td>
                <td className="mono" title={p.command}>
                  {p.command}
                </td><td><button className="btn mini proc-action" aria-label={t('ctx.proc', { pid: p.pid })} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(p.pid, r.left, r.bottom); }}>⋯</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ServerPanel({
  s,
  onBack,
  tab,
  onTab,
}: {
  s: Server;
  onBack: () => void;
  tab: 'gpu' | 'proc' | 'files' | 'term';
  onTab: (t: 'gpu' | 'proc' | 'files' | 'term') => void;
}) {
  const { kill, restartService, demo, refreshMs, sampleNow } = useStore();
  const { t } = useTranslation();
  const fresh = isFreshSample(s, demo, refreshMs, sampleNow);
  const [menu, setMenu] = useState<{ pid: number; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ pid: number; signal: 'TERM' | 'KILL' } | null>(null);
  const [restartAsk, setRestartAsk] = useState(false);
  const [svcName, setSvcName] = useState('docker');
  const [snippets, setSnippets] = useState<Array<{ id: string; name: string; cmd: string }>>([]);
  const [snipOut, setSnipOut] = useState<{ name: string; output: string; running: boolean } | null>(null);

  useEffect(() => {
    api?.snippetsList().then(setSnippets).catch(() => {});
  }, []);

  const runSnippet = async (sn: { id: string; name: string; cmd: string }) => {
    if (!api) return;
    setSnipOut({ name: sn.name, output: t('server.running'), running: true });
    const r = await api.exec(s.id, sn.cmd);
    if (r.ok && r.data) {
      const out = (r.data.stdout + (r.data.stderr ? `\n${r.data.stderr}` : '')).trim() || t('server.noOutput');
      setSnipOut({ name: sn.name, output: out, running: false });
    } else {
      setSnipOut({ name: sn.name, output: r.error || t('server.execFail'), running: false });
    }
  };

  const confirmRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  useDialogFocus(!!confirm, confirmRef, () => setConfirm(null));
  useDialogFocus(restartAsk, restartRef, () => setRestartAsk(false));
  useDialogFocus(!!snipOut, outputRef, () => setSnipOut(null));
  const target = confirm ? s.processes.find((p) => p.pid === confirm.pid) : undefined;

  const doRestart = () => {
    const name = svcName.trim();
    if (!name) return;
    restartService(s.id, name);
    setRestartAsk(false);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--gap)' }}>
        <button className="btn" onClick={onBack}>
          ← {t('nav.overview')}
        </button>
        <span style={{ fontWeight: 600, fontSize: 'calc(var(--fs) + 2px)' }}>{s.name}</span>
        <span className="mono faint">
          {s.host}
        </span>
        <span style={{ flex: 1 }} />
        {snippets.length > 0 && (
          <select
            className="mini"
            value=""
            title={t('server.quickCommands')}
            onChange={(e) => {
              const sn = snippets.find((x) => x.id === e.target.value);
              if (sn) runSnippet(sn);
              e.target.value = '';
            }}
          >
            <option value="">{t('server.quickCommands')}</option>
            {snippets.map((sn) => (
              <option key={sn.id} value={sn.id}>
                {sn.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {s.status !== 'online' ? (
        <div className="empty">
          {t('server.offline', {status: t(s.status === 'timeout' ? 'server.timeout' : 'server.offlineWord')})}
        </div>
      ) : (
        <>
          {fresh ? <KpiStrip s={s} /> : <div className="inline-status" role="status">{t('workbench.staleDetail')}</div>}
          <div className="tabs">
            <button className={tab === 'gpu' ? 'on' : ''} onClick={() => onTab('gpu')}>
              {t('server.gpuTab', { n: s.gpus.length })}
            </button>
            <button className={tab === 'proc' ? 'on' : ''} onClick={() => onTab('proc')}>
              {t('server.procTab', { n: s.processes.length })}
            </button>
            <button className={tab === 'files' ? 'on' : ''} onClick={() => onTab('files')}>
              {t('server.filesTab')}
            </button>
            <button className={tab === 'term' ? 'on' : ''} onClick={() => onTab('term')}>
              {t('server.termTab')}
            </button>
            <span className="note" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              {t(tab === 'files' ? 'server.filesHint' : 'workbench.processHint')}
            </span>
          </div>
          {/* 终端会话常驻挂载（切 tab 只隐藏不卸载，xterm 与输出保留） */}
          <div style={{ display: tab === 'term' ? 'block' : 'none' }}>
            <TerminalSessions serverId={s.id} visible={tab === 'term'} />
          </div>
          {tab === 'gpu' && fresh && <GpuList s={s} onMenu={(pid, x, y) => setMenu({ pid, x, y })} />}
          {tab === 'proc' && fresh && <ProcessTable s={s} onMenu={(pid, x, y) => setMenu({ pid, x, y })} />}
          {tab === 'files' && <FileManager serverId={s.id} />}
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="hdr">{t('ctx.proc', { pid: menu.pid })}</div>
          <button
            onClick={() => {
              setConfirm({ pid: menu.pid, signal: 'TERM' });
              setMenu(null);
            }}
          >
            {t('ctx.termSig')}
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirm({ pid: menu.pid, signal: 'KILL' });
              setMenu(null);
            }}
          >
            {t('ctx.forceKill')}
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(String(menu.pid));
              setMenu(null);
            }}
          >
            {t('ctx.copyPid')}
          </button>
          <button
            onClick={() => {
              const cmd = s.processes.find((p) => p.pid === menu.pid)?.command ?? '';
              navigator.clipboard?.writeText(cmd);
              setMenu(null);
            }}
          >
            {t('ctx.copyCmd')}
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              setSvcName('docker');
              setRestartAsk(true);
              setMenu(null);
            }}
          >
            {t('ctx.restartSvc')}
          </button>
        </ContextMenu>
      )}

      {confirm && (
        <div className="mask" onClick={() => setConfirm(null)}>
          <div className="dialog" ref={confirmRef} role="dialog" aria-modal="true" aria-label={t('ctx.proc', {pid: confirm?.pid})} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--crit)' }}>
              {t('ctx.confirmKillTitle', { force: confirm.signal === 'KILL' ? t('ctx.forceWord') : '', pid: confirm.pid })}
            </h3>
            <div className="body">
              {t('ctx.targetMachine')} <code>{s.name}</code>（{s.host}）
              <br />
              {t('ctx.cmdline')} <code>{target?.command ?? ''}</code>
              <br />
              {t('ctx.willExec')} <code>kill -{confirm.signal === 'KILL' ? '9' : '15'} {confirm.pid}</code>
              <br />
              <span style={{ color: 'var(--warn)' }}>{t('ctx.irreversible')}</span>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirm(null)}>
                {t('ctx.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  kill(s.id, confirm.pid, confirm.signal);
                  setConfirm(null);
                }}
              >
                {t('ctx.confirmExec')}
              </button>
            </div>
          </div>
        </div>
      )}

      {restartAsk && (
        <div className="mask" onClick={() => setRestartAsk(false)}>
          <div className="dialog" ref={restartRef} role="dialog" aria-modal="true" aria-label={t('restart.title')} tabIndex={-1} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('restart.title')}</h3>
            <div className="field">
              <label>{t('restart.svcName')}</label>
              <input
                className="mini"
                style={{ width: '100%' }}
                autoFocus
                value={svcName}
                onChange={(e) => setSvcName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doRestart()}
              />
            </div>
            <div className="body dim">
              {t('restart.willExecOn', { name: s.name })} <code>systemctl restart {svcName.trim() || '…'}</code>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setRestartAsk(false)}>
                {t('ctx.cancel')}
              </button>
              <button className="btn primary" disabled={!svcName.trim()} onClick={doRestart}>
                {t('restart.confirmRestart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {snipOut && (
        <div className="mask" onClick={() => setSnipOut(null)}>
          <div className="dialog" ref={outputRef} role="dialog" aria-modal="true" aria-label={t('server.quickCommands')} tabIndex={-1} style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('server.quickTitle', {name: snipOut.name})}</h3>
            <div className="body">
              <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
                {snipOut.output}
              </pre>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(snipOut.output)}>
                {t('server.copyOutput')}
              </button>
              <button className="btn primary" onClick={() => setSnipOut(null)}>
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
