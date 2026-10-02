import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Hourglass,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTransfers } from '../transfers';
import { formatBytes, formatDuration, formatSpeed, etaSeconds, pctOf } from '../format';
import type { TransferItem, TransferKind, TransferStatus } from '../types';

const STATUS_TEXT: Record<TransferStatus, string> = {
  queued: '排队中',
  running: '传输中',
  paused: '已暂停',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
};

const KIND_META: Record<TransferKind, { icon: LucideIcon; label: string; cls: string }> = {
  upload: { icon: ArrowUp, label: '上传', cls: 'up' },
  download: { icon: ArrowDown, label: '下载', cls: 'down' },
  relay: { icon: ArrowLeftRight, label: '互传', cls: 'relay' },
};

// 瞬时速度曲线（按自身最大值自适应，不做百分比裁剪）
function SpeedChart({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  const w = 100;
  const h = 36;
  if (values.length < 2) return <div className="td-chart-empty">速度采样中…</div>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 3) - 1}`);
  return (
    <svg className="td-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} fillOpacity="0.12" stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="td-copy"
      title="复制路径"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          })
          .catch(() => {});
      }}
    >
      {ok ? '已复制' : '复制'}
    </button>
  );
}

function TaskRow({ t, tf, picked, togglePick }: {
  t: TransferItem;
  tf: ReturnType<typeof useTransfers>;
  picked: Set<string>;
  togglePick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileQ, setFileQ] = useState('');
  const pct = pctOf(t);
  const eta = etaSeconds(t);
  const hist = tf.getSpeedHistory(t.id);
  const km = KIND_META[t.kind];
  const peer =
    t.kind === 'upload'
      ? `→ ${t.serverName || ''}`
      : t.kind === 'download'
        ? `← ${t.serverName || ''}`
        : `${t.serverName} → ${t.peerName}`;
  const elapsed = t.startedAt ? ((t.finishedAt || Date.now()) - t.startedAt) / 1000 : 0;
  const files = useMemo(() => {
    const arr = [...(t.recentFiles || [])].reverse();
    const q = fileQ.trim().toLowerCase();
    return q ? arr.filter((f) => f.name.toLowerCase().includes(q)) : arr;
  }, [t.recentFiles, fileQ]);

  return (
    <div className={`td-task ${t.status} ${open ? 'expanded' : ''}`}>
      <div className="td-task-head">
        <input
          className="td-pick"
          type="checkbox"
          checked={picked.has(t.id)}
          onChange={() => togglePick(t.id)}
          title="选择以批量取消"
        />
        <span className={`td-kind ${km.cls}`}><km.icon size={13} strokeWidth={2.2} /></span>
        <button className="td-expand" onClick={() => setOpen((v) => !v)} title={open ? '收起' : '展开详情'}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="td-name mono" title={t.name}>
          {t.name}
        </span>
        {t.kind === 'relay' && (
          <span
            className={`td-badge ${t.direct ? 'direct' : 'relayx'}`}
            title={t.direct ? `服务器直传${t.directMode ? ' · ' + t.directMode : ''}${t.directNote ? '\n' + t.directNote : ''}` : '经本机中继转发'}
          >
            {t.direct ? `直传${t.directMode ? '·' + t.directMode : ''}` : '中继'}
          </span>
        )}
        {t.status === 'queued' && t.waitConflict && (
          <span className="td-badge wait" title="同一目标有任务正在传输，为避免交错写入损坏文件，本任务暂缓启动">
            <Hourglass size={11} /> 等待同目标
          </span>
        )}
        <span className="td-peer">{peer}</span>
        <span className="td-spacer" />
        {t.status === 'running' && <span className="td-now num">{formatSpeed(t.speed)}</span>}
        {t.status === 'running' && (eta != null ? <span className="td-eta num">剩 {formatDuration(eta)}</span> : t.size === 0 ? <span className="td-eta">总量统计中</span> : null)}
        <span className={`td-status ${t.status}`}>{STATUS_TEXT[t.status]}</span>
        <span className="td-row-actions">
          {t.status === 'queued' && (
            <>
              <button className="btn mini" onClick={() => tf.move(t.id, 'up')} title="提前"><ArrowUp size={12} /></button>
              <button className="btn mini" onClick={() => tf.move(t.id, 'down')} title="置后"><ArrowDown size={12} /></button>
            </>
          )}
          {t.status === 'running' && <button className="btn mini" onClick={() => tf.pause(t.id)}>暂停</button>}
          {t.status === 'paused' && <button className="btn mini primary" onClick={() => tf.resume(t.id)}>续传</button>}
          {t.status === 'error' && <button className="btn mini primary" onClick={() => tf.retry(t.id)}>重试</button>}
          {['queued', 'running'].includes(t.status) && <button className="btn mini danger" onClick={() => tf.cancel(t.id)}>取消</button>}
          {['done', 'canceled', 'error', 'paused'].includes(t.status) && <button className="btn mini" onClick={() => tf.remove(t.id)}>移除</button>}
        </span>
      </div>

      <div className="td-bar">
        <i style={{ width: `${pct}%` }} className={t.status === 'error' ? 'err' : t.status === 'paused' ? 'pause' : ''} />
      </div>

      {open && (
        <div className="td-detail">
          <div className="td-detail-grid">
            <div className="td-meter">
              <div className="td-meter-top">
                <span>瞬时速度</span>
                <span className="num td-big">{t.status === 'running' ? formatSpeed(t.speed) || '0 B/s' : '—'}</span>
              </div>
              <SpeedChart values={hist} />
            </div>
            <div className="td-stats">
              <div><span>进度</span><b className="num">{t.size ? `${formatBytes(t.transferred)} / ${formatBytes(t.size)} (${Math.round(pct)}%)` : `${formatBytes(t.transferred)} · 总量统计中`}</b></div>
              <div><span>剩余</span><b className="num">{eta != null ? formatDuration(eta) : (t.size ? '—' : '总量统计中')}</b></div>
              <div><span>已用</span><b className="num">{formatDuration(elapsed)}</b></div>
              <div><span>文件</span><b className="num">{t.filesTotal ? `${t.filesDone ?? 0} / ${t.filesTotal}` : `${t.filesDone ?? 0} 个已完成`}</b></div>
              {t.kind === 'relay' && <div><span>方式</span><b>{t.direct ? `服务器直传 · ${t.directMode || '探测中'}` : '本机中继'}</b></div>}
            </div>
          </div>

          <div className="td-path">
            <div className="td-path-line"><span className="td-path-tag">源</span><span className="mono">{t.srcPath || '—'}</span><CopyBtn text={t.srcPath || ''} /></div>
            <div className="td-path-line"><span className="td-path-tag dst">目标</span><span className="mono">{t.dstPath || '—'}</span><CopyBtn text={t.dstPath || ''} /></div>
          </div>

          {t.kind === 'relay' && t.directNote && (
            <div className="td-note mono" title="能力探测与回退诊断">诊断：{t.directNote}</div>
          )}
          {t.status === 'error' && <div className="td-err">失败原因：{t.error || '未知错误'}</div>}

          <div className="td-files">
            <div className="td-files-head">
              <span>最近传输文件（{t.filesDone ?? 0}{t.filesTotal ? ` / ${t.filesTotal}` : ''}）</span>
              <input
                className="td-files-search"
                placeholder="过滤本任务最近文件…"
                value={fileQ}
                onChange={(e) => setFileQ(e.target.value)}
              />
            </div>
            <div className="td-files-list">
              {files.length === 0 && <div className="td-files-empty">暂无逐文件记录（rsync 直传与本机中继会实时回传，scp 兜底模式仅显示字节进度）</div>}
              {files.map((f, i) => (
                <div key={`${f.at}-${i}`} className="td-file-line mono" title={f.name}>
                  <span className="td-file-ok"><Check size={12} strokeWidth={2.4} /></span>{f.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type KindFilter = 'all' | TransferKind;
type StatusFilter = 'all' | 'active' | 'done' | 'error';

export function TransferDrawer() {
  const tf = useTransfers();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [st, setSt] = useState<StatusFilter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('sc:show-transfers', show);
    return () => window.removeEventListener('sc:show-transfers', show);
  }, []);

  // Esc 收起；有任务传输中时钉住，避免误关（关闭按钮始终可用）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tf.runningCount === 0) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, tf.runningCount]);

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    return tf.items.filter((t) => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (st === 'active') return ['running', 'queued', 'paused'].includes(t.status);
      if (st === 'done') return ['done', 'canceled'].includes(t.status);
      if (st === 'error') return t.status === 'error';
      return true;
    });
  }, [tf.items, kind, st]);

  const speedOf = (k: TransferKind) =>
    tf.items.filter((t) => t.status === 'running' && t.kind === k).reduce((a, t) => a + (t.speed || 0), 0);
  const upSpeed = speedOf('upload');
  const downSpeed = speedOf('download');
  const relaySpeed = speedOf('relay');
  const active = tf.items.filter((t) => ['running', 'queued'].includes(t.status));
  const overall = active.length ? Math.round(active.reduce((a, t) => a + pctOf(t), 0) / active.length) : 0;

  if (!open) return null;

  const kindTabs: Array<[KindFilter, string]> = [
    ['all', '全部'],
    ['upload', '上传'],
    ['download', '下载'],
    ['relay', '互传'],
  ];
  const stTabs: Array<[StatusFilter, string, number]> = [
    ['all', '全部', tf.items.length],
    ['active', '进行中', tf.runningCount + tf.queuedCount],
    ['done', '已完成', tf.doneCount],
    ['error', '失败', tf.errorCount],
  ];

  return (
    <div className="td-root" onMouseDown={(e) => { if (e.target === e.currentTarget && tf.runningCount === 0) setOpen(false); }}>
      <aside className={`td-drawer ${full ? 'full' : ''}`}>
        <header className="td-header">
          <div className="td-title">
            <h2>传输中心</h2>
            {tf.runningCount > 0 && <span className="td-live"><i className="td-live-dot" />{tf.runningCount} 个传输中 · 总进度 {overall}%</span>}
          </div>
          <div className="td-head-speed num">
            <span className="up"><ArrowUp size={12} strokeWidth={2.2} /> {formatSpeed(upSpeed) || '0 B/s'}</span>
            <span className="down"><ArrowDown size={12} strokeWidth={2.2} /> {formatSpeed(downSpeed) || '0 B/s'}</span>
            <span className="relay"><ArrowLeftRight size={12} strokeWidth={2.2} /> {formatSpeed(relaySpeed) || '0 B/s'}</span>
          </div>
          <div className="td-head-btns">
            <button className="btn icon-btn" title={full ? '还原' : '全屏'} onClick={() => setFull((v) => !v)}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
            <button className="btn icon-btn" title="关闭" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
        </header>

        {active.length > 0 && (
          <div className="td-overall"><i style={{ width: `${overall}%` }} /></div>
        )}

        <div className="td-toolbar">
          <div className="td-seg">
            {kindTabs.map(([k, label]) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <div className="td-seg slim">
            {stTabs.map(([s, label, n]) => (
              <button key={s} className={st === s ? 'on' : ''} onClick={() => setSt(s)}>{label} {n}</button>
            ))}
          </div>
          <span className="td-spacer" />
          <button className="btn mini" onClick={tf.pauseAll}>全部暂停</button>
          <button className="btn mini primary" onClick={tf.resumeAll}>全部继续</button>
          {tf.errorCount > 0 && <button className="btn mini warn" onClick={tf.retryFailed}>失败全重试</button>}
          {picked.size > 0 && (
            <button className="btn mini danger" onClick={() => { tf.cancelMany([...picked]); setPicked(new Set()); }}>
              取消所选({picked.size})
            </button>
          )}
          <button className="btn mini" onClick={tf.clearFinished}>清除已完成</button>
        </div>

        <div className="td-settings-line">
          <label className="td-conc">
            全局并发
            <input
              type="range"
              min={1}
              max={15}
              value={tf.concurrency}
              onChange={(e) => tf.setConcurrency(Number(e.target.value))}
            />
            <b className="num">{tf.concurrency}</b>
          </label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.notifyDone} onChange={(e) => tf.setNotifyOpts({ notifyDone: e.target.checked })} />完成通知</label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.notifyFail} onChange={(e) => tf.setNotifyOpts({ notifyFail: e.target.checked })} />失败通知</label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.sound} onChange={(e) => tf.setNotifyOpts({ sound: e.target.checked })} />失败提示音</label>
          <span className="td-spacer" />
          {tf.runningCount > 0 && <span className="td-pin">传输中已钉住，不会被误关</span>}
        </div>

        <div className="td-list">
          {filtered.length === 0 && <div className="td-empty">暂无传输任务</div>}
          {filtered.map((t) => (
            <TaskRow key={t.id} t={t} tf={tf} picked={picked} togglePick={togglePick} />
          ))}
        </div>
      </aside>
    </div>
  );
}
