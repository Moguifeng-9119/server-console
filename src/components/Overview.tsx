import { useStore } from '../state';
import type { Server } from '../types';
import { Sparkline } from './Sparkline';

function ServerCard({ s, onOpen, onHistory }: { s: Server; onOpen: () => void; onHistory: (s: Server) => void }) {
  const { colorOf } = useStore();
  const online = s.status === 'online';
  const avgUtil = s.gpus.length ? s.gpus.reduce((a, g) => a + g.util, 0) / s.gpus.length : 0;
  const vram = s.gpus.length
    ? s.gpus.reduce((a, g) => a + g.memUsed, 0) / s.gpus.reduce((a, g) => a + g.memTotal, 0)
    : 0;
  const vramPct = vram * 100;
  const zombies = s.processes.filter((p) => p.state === 'Z').length;

  return (
    <div
      className="card"
      onClick={onOpen}
      title="单击进入 · 右键查看 GPU 历史曲线"
      onContextMenu={(e) => {
        e.preventDefault();
        onHistory(s);
      }}
    >
      <div className="card-head">
        <i className={`dot ${s.status}`} />
        <span className="name">{s.name}</span>
        <span className="host mono">{s.host}</span>
        <span className="badge">
          {online ? `${s.gpus.length} GPU` : s.status === 'timeout' ? '超时' : '离线'}
        </span>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="v num">{online ? s.processes.length : '—'}</div>
          <div className="k">进程数{zombies ? ` · ${zombies} 僵尸` : ''}</div>
        </div>
        <div className="kpi">
          <div className="v num" style={{ color: online ? colorOf(avgUtil) : 'var(--text-faint)' }}>
            {online ? Math.round(avgUtil) : '—'}
            <span style={{ fontSize: '0.45em', opacity: 0.7 }}>%</span>
          </div>
          <div className="k">平均利用率</div>
        </div>
        <div className="kpi">
          <div className="v num" style={{ color: online ? colorOf(vramPct) : 'var(--text-faint)' }}>
            {online ? Math.round(vramPct) : '—'}
            <span style={{ fontSize: '0.45em', opacity: 0.7 }}>%</span>
          </div>
          <div className="k">显存占用</div>
        </div>
      </div>

      <Sparkline values={s.history} color={online ? colorOf(avgUtil) : 'var(--text-faint)'} />

      <div className="gpu-grid">
        {s.gpus.map((g) => {
          const pct = (g.memUsed / g.memTotal) * 100;
          return (
            <div
              key={g.index}
              className="gpu-cell"
              style={{ background: online ? colorOf(g.util) : 'var(--border)', opacity: online ? 1 : 0.4 }}
              title={`GPU ${g.index} · 利用率 ${g.util}% · 显存 ${pct.toFixed(0)}% · ${g.temp == null ? '温度 N/A' : `${g.temp}°C`}`}
            >
              <span>{g.index}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Overview({ onOpen, onHistory }: { onOpen: (id: string) => void; onHistory: (s: Server) => void }) {
  const { servers } = useStore();
  const online = servers.filter((s) => s.status === 'online').length;
  return (
    <>
      <div className="dim" style={{ marginBottom: 'var(--gap)' }}>
        共 {servers.length} 台 · <span style={{ color: 'var(--ok)' }}>{online} 在线</span> · {servers.length - online} 异常
      </div>
      <div className="grid">
        {servers.map((s) => (
          <ServerCard key={s.id} s={s} onOpen={() => onOpen(s.id)} onHistory={() => onHistory(s)} />
        ))}
      </div>
    </>
  );
}
