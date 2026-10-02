import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state';
import { api } from '../api';
import type { ProcessItem, Server } from '../types';
import { ContextMenu } from './ContextMenu';
import { FileManager } from './FileManager';
import { TerminalPane } from './TerminalPane';

type SortKey = 'pid' | 'user' | 'cpu' | 'mem' | 'rssMb' | 'state' | 'command';

function KpiStrip({ s }: { s: Server }) {
  const { colorOf } = useStore();
  const avg = s.gpus.reduce((a, g) => a + g.util, 0) / (s.gpus.length || 1);
  const vram =
    (s.gpus.reduce((a, g) => a + g.memUsed, 0) / (s.gpus.reduce((a, g) => a + g.memTotal, 0) || 1)) * 100;
  const zombies = s.processes.filter((p) => p.state === 'Z').length;
  const cells: Array<{ k: string; v: string; color?: string }> = [
    { k: '进程总数', v: String(s.processes.length) },
    { k: '僵尸进程', v: String(zombies), color: zombies ? 'var(--crit)' : undefined },
    { k: '平均 GPU 利用率', v: `${Math.round(avg)}%`, color: colorOf(avg) },
    { k: '显存占用', v: `${Math.round(vram)}%`, color: colorOf(vram) },
    { k: '负载 1m', v: s.loadAvg[0].toFixed(1) },
    { k: `CPU（${s.cpuCores} 核）`, v: `${s.cpuUsage}%`, color: colorOf(s.cpuUsage) },
    { k: '内存', v: `${s.memUsed}/${s.memTotal} GB`, color: colorOf((s.memUsed / s.memTotal) * 100) },
    { k: 'Swap', v: `${s.swapUsed}/${s.swapTotal} GB` },
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
  return (
    <div className="gpu-list">
      {s.gpus.map((g) => {
        const memPct = (g.memUsed / g.memTotal) * 100;
        return (
          <div className="gpu-card" key={g.index}>
            <div className="h">
              <span className="idx">GPU {g.index}</span>
              <span className="nm">{g.name}</span>
            </div>

            <div className="metric-line">
              <span className="num" style={{ fontSize: 'calc(var(--fs-kpi) - 6px)', color: colorOf(g.util) }}>
                {g.util}%
              </span>
              <span className="note">利用率</span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}>
              <i style={{ width: `${g.util}%`, background: colorOf(g.util) }} />
            </div>

            <div className="metric-line" style={{ marginTop: 10 }}>
              <span className="num" style={{ fontSize: 15, color: colorOf(memPct) }}>
                {(g.memUsed / 1024).toFixed(1)} / {(g.memTotal / 1024).toFixed(0)} GiB
              </span>
              <span className="note">显存 {memPct.toFixed(0)}%</span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}>
              <i style={{ width: `${memPct}%`, background: colorOf(memPct) }} />
            </div>

            <div className="metrics">
              <div>
                温度<b style={g.temp == null ? undefined : { color: colorOf(g.temp) }}>{g.temp == null ? 'N/A' : `${g.temp}°C`}</b>
              </div>
              <div>
                功耗<b>{g.power == null ? 'N/A' : `${g.power} W`}</b>
              </div>
              <div title={g.fan == null ? '该显卡未向驱动报告风扇转速（机房/被动散热卡常见），不是 0 转' : undefined}>
                风扇<b>{g.fan == null ? 'N/A' : `${g.fan}%`}</b>
              </div>
            </div>

            <div className="gpu-procs">
              {g.procs.length === 0 && <span className="faint">无进程占用</span>}
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
                  <span>{p.name}</span>
                  <span className="mono" style={{ marginLeft: 'auto' }}>
                    {(p.memMb / 1024).toFixed(1)} GiB
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProcessTable({ s, onMenu }: { s: Server; onMenu: (pid: number, x: number, y: number) => void }) {
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
      {label}
      {sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <>
      <div className="toolbar">
        <input
          className="mini"
          placeholder="搜索 PID / 用户 / 命令行…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="mini" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="all">全部用户</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <label className="dim" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyGpu} onChange={(e) => setOnlyGpu(e.target.checked)} />
          只看 GPU 进程
        </label>
        <span className="faint">
          {rows.length} / {s.processes.length} 条
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
              <th>COMMAND</th>
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
                <td className="mono">{p.gpu === null ? '' : p.gpu}</td>
                <td className="mono" title={p.command}>
                  {p.command}
                </td>
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
  const { kill, restartService } = useStore();
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
    setSnipOut({ name: sn.name, output: '执行中…', running: true });
    const r = await api.exec(s.id, sn.cmd);
    if (r.ok && r.data) {
      const out = (r.data.stdout + (r.data.stderr ? `\n${r.data.stderr}` : '')).trim() || '（无输出）';
      setSnipOut({ name: sn.name, output: out, running: false });
    } else {
      setSnipOut({ name: sn.name, output: r.error || '执行失败', running: false });
    }
  };

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
          ← 总览
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
            title="一键执行快速命令（设置中管理）"
            onChange={(e) => {
              const sn = snippets.find((x) => x.id === e.target.value);
              if (sn) runSnippet(sn);
              e.target.value = '';
            }}
          >
            <option value="">快速命令…</option>
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
          该节点当前不可达（{s.status === 'timeout' ? '连接超时' : '离线'}），无法采集数据。
        </div>
      ) : (
        <>
          <KpiStrip s={s} />
          <div className="tabs">
            <button className={tab === 'gpu' ? 'on' : ''} onClick={() => onTab('gpu')}>
              GPU（{s.gpus.length}）
            </button>
            <button className={tab === 'proc' ? 'on' : ''} onClick={() => onTab('proc')}>
              进程（{s.processes.length}）
            </button>
            <button className={tab === 'files' ? 'on' : ''} onClick={() => onTab('files')}>
              文件
            </button>
            <button className={tab === 'term' ? 'on' : ''} onClick={() => onTab('term')}>
              终端
            </button>
            <span className="note" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              {tab === 'files' ? '双击进入目录 · 右键更多操作 · 可拖拽文件到右侧上传' : '右键任意进程行可执行操作'}
            </span>
          </div>
          {tab === 'gpu' ? (
            <GpuList s={s} onMenu={(pid, x, y) => setMenu({ pid, x, y })} />
          ) : tab === 'proc' ? (
            <ProcessTable s={s} onMenu={(pid, x, y) => setMenu({ pid, x, y })} />
          ) : tab === 'term' ? (
            <TerminalPane serverId={s.id} />
          ) : (
            <FileManager serverId={s.id} />
          )}
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="hdr">进程 {menu.pid}</div>
          <button
            onClick={() => {
              setConfirm({ pid: menu.pid, signal: 'TERM' });
              setMenu(null);
            }}
          >
            结束进程（SIGTERM）
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirm({ pid: menu.pid, signal: 'KILL' });
              setMenu(null);
            }}
          >
            强制结束（SIGKILL）
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(String(menu.pid));
              setMenu(null);
            }}
          >
            复制 PID
          </button>
          <button
            onClick={() => {
              const cmd = s.processes.find((p) => p.pid === menu.pid)?.command ?? '';
              navigator.clipboard?.writeText(cmd);
              setMenu(null);
            }}
          >
            复制命令行
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              setSvcName('docker');
              setRestartAsk(true);
              setMenu(null);
            }}
          >
            重启服务…
          </button>
        </ContextMenu>
      )}

      {confirm && (
        <div className="mask" onClick={() => setConfirm(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--crit)' }}>
              确认{confirm.signal === 'KILL' ? '强制' : ''}结束进程 {confirm.pid}？
            </h3>
            <div className="body">
              目标机器：<code>{s.name}</code>（{s.host}）
              <br />
              命令行：<code>{target?.command ?? '（进程已退出）'}</code>
              <br />
              将执行：<code>kill -{confirm.signal === 'KILL' ? '9' : '15'} {confirm.pid}</code>
              <br />
              <span style={{ color: 'var(--warn)' }}>此操作不可撤销，已记录到本地审计日志。</span>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  kill(s.id, confirm.pid, confirm.signal);
                  setConfirm(null);
                }}
              >
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}

      {restartAsk && (
        <div className="mask" onClick={() => setRestartAsk(false)}>
          <div className="dialog" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>重启 systemd 服务</h3>
            <div className="field">
              <label>服务名</label>
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
              将在 <code>{s.name}</code> 上执行：<code>systemctl restart {svcName.trim() || '…'}</code>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setRestartAsk(false)}>
                取消
              </button>
              <button className="btn primary" disabled={!svcName.trim()} onClick={doRestart}>
                确认重启
              </button>
            </div>
          </div>
        </div>
      )}

      {snipOut && (
        <div className="mask" onClick={() => setSnipOut(null)}>
          <div className="dialog" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>快速命令 · {snipOut.name}</h3>
            <div className="body">
              <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
                {snipOut.output}
              </pre>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(snipOut.output)}>
                复制输出
              </button>
              <button className="btn primary" onClick={() => setSnipOut(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
