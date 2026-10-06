import { useEffect, useMemo, useState, useRef } from 'react';
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
import { useDialogFocus } from '../hooks/useDialogFocus';
import { api } from '../api';
import { useTransfers } from '../transfers';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatDuration, formatSpeed, etaSeconds, pctOf } from '../format';
import type { TransferItem, TransferKind } from '../types';

const KIND_META: Record<TransferKind, { icon: LucideIcon; cls: string }> = {
  upload: { icon: ArrowUp, cls: 'up' },
  download: { icon: ArrowDown, cls: 'down' },
  relay: { icon: ArrowLeftRight, cls: 'relay' },
};

// 瞬时速度曲线（按自身最大值自适应，不做百分比裁剪）
function SpeedChart({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  const tt = useTranslation().t;
  const w = 100;
  const h = 36;
  if (values.length < 2) return <div className="td-chart-empty">{tt('workbench.speedSampling')}</div>;
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
  const tt = useTranslation().t;
  const [ok, setOk] = useState(false);
  return (
    <button
      className="td-copy"
      title={tt('transfer.copy')}
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
      {tt(ok ? 'transfer.copied' : 'transfer.copy')}
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
  const tt = useTranslation().t;
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
          title={tt('transfer.pickTip') || ''}
        />
        <span className={`td-kind ${km.cls}`}><km.icon size={13} strokeWidth={2.2} /></span>
        <button className="td-expand" onClick={() => setOpen((v) => !v)} title={open ? tt('transfer.collapse') : tt('transfer.expand')}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="td-name mono" title={t.name}>
          {t.name}
        </span>
        {t.kind === 'relay' && (
          <span
            className={`td-badge ${t.direct ? 'direct' : 'relayx'}`}
            title={t.direct ? tt('transfer.directTip', { mode: t.directMode ? ' · ' + t.directMode : '', note: t.directNote ? '\n' + t.directNote : '' }) : tt('transfer.relayTip')}
          >
            {t.direct ? tt('transfer.direct', { mode: t.directMode ? '·' + t.directMode : '' }) : tt('transfer.relay')}
          </span>
        )}
        {t.status === 'queued' && t.waitConflict && (
          <span className="td-badge wait" title={tt('transfer.waitConflictTip')}>
            <Hourglass size={11} /> {tt('transfer.waitConflict')}
          </span>
        )}
        <span className="td-peer">{peer}</span>
        <span className="td-spacer" />
        {t.status === 'running' && (t.resumeCheck ? <span className="td-now">{tt('transfer.checkingPrefix')}</span> : <span className="td-now num">{formatSpeed(t.speed)}</span>)}
        {t.status === 'running' && !t.resumeCheck && (eta != null ? <span className="td-eta num">{formatDuration(eta)}</span> : t.size === 0 ? <span className="td-eta">{tt('transfer.totalUnknown')}</span> : null)}
        <span className={`td-status ${t.status}`}>{tt('transfer.' + t.status)}</span>
        <span className="td-row-actions">
          {t.status === 'queued' && (
            <>
              <button className="btn mini" onClick={() => tf.move(t.id, 'up')} title={tt('transfer.moveUp')}><ArrowUp size={12} /></button>
              <button className="btn mini" onClick={() => tf.move(t.id, 'down')} title={tt('transfer.moveDown')}><ArrowDown size={12} /></button>
            </>
          )}
          {t.status === 'running' && <button className="btn mini" onClick={() => tf.pause(t.id)}>{tt('transfer.pauseBtn')}</button>}
          {t.status === 'paused' && t.resumable !== false && <button className="btn mini primary" onClick={() => tf.resume(t.id)}>{tt('transfer.resumeBtn')}</button>}
          {t.status === 'error' && t.resumable !== false && <button className="btn mini primary" onClick={() => tf.retry(t.id)}>{tt('transfer.retryBtn')}</button>}
          {['queued', 'running', 'paused', 'error'].includes(t.status) && <button className="btn mini danger" onClick={() => tf.cancel(t.id)}>{tt('transfer.cancel')}</button>}
          {['done', 'canceled', 'error', 'paused'].includes(t.status) && <button className="btn mini" title={t.stagedCount ? tt('transfer.removeStaged') : tt('transfer.removeBtn')} onClick={() => tf.remove(t.id)}>{tt('transfer.removeBtn')}</button>}
          {t.legacyStaging && !['running', 'queued'].includes(t.status) && <button className="btn mini" onClick={async () => { if (window.confirm(tt('transfer.forgetLegacyConfirm'))) { await api?.transferForgetLegacy(t.id); tf.refresh(); } }}>{tt('transfer.forgetLegacy')}</button>}
        </span>
      </div>

      <div className="td-bar">
        <i style={{ width: `${pct}%` }} className={t.status === 'error' ? 'err' : t.status === 'paused' ? 'pause' : ''} />
      </div>

      {t.resumeCheck && <div className="td-note" role="status">
        {tt('transfer.prefixProgress', { checked: formatBytes(t.resumeCheck.bytes), total: formatBytes(t.resumeCheck.total), n: t.resumeCheck.files })}
        <progress aria-label={tt('transfer.checkingPrefix')} value={t.resumeCheck.bytes} max={t.resumeCheck.total || 1} style={{ width: '100%' }} />
      </div>}
      {t.recoveryReason && <div className="td-note">{tt('transfer.legacyRecovery')}</div>}
      {!!t.stagedCount && ['paused', 'error', 'canceled'].includes(t.status) && <div className="td-note">{tt(t.status === 'canceled' ? 'transfer.cleanupPending' : 'transfer.stagingRetained', { n: t.stagedCount })}</div>}

      {open && (
        <div className="td-detail">
          <div className="td-detail-grid">
            <div className="td-meter">
              <div className="td-meter-top">
                <span>{tt('transfer.speed')}</span>
                <span className="num td-big">{t.status === 'running' ? formatSpeed(t.speed) || '0 B/s' : '—'}</span>
              </div>
              <SpeedChart values={hist} />
            </div>
            <div className="td-stats">
              <div><span>{tt('transfer.progress')}</span><b className="num">{t.size ? `${formatBytes(t.transferred)} / ${formatBytes(t.size)} (${Math.round(pct)}%)` : `${formatBytes(t.transferred)} · ${tt('transfer.totalUnknown')}`}</b></div>
              <div><span>{tt('transfer.eta')}</span><b className="num">{eta != null ? formatDuration(eta) : (t.size ? '—' : tt('transfer.totalUnknown'))}</b></div>
              <div><span>{tt('transfer.elapsed')}</span><b className="num">{formatDuration(elapsed)}</b></div>
              <div><span>{tt('transfer.filesCount')}</span><b className="num">{t.filesTotal ? `${t.filesDone ?? 0} / ${t.filesTotal}` : tt('workbench.filesCompleted', {n: t.filesDone ?? 0})}</b></div>
              {t.kind === 'relay' && <div><span>{tt('transfer.method')}</span><b>{t.direct ? tt('transfer.direct', {mode: t.directMode ? ' · ' + t.directMode : ''}) : tt('transfer.relayTip')}</b></div>}
            </div>
          </div>

          <div className="td-path">
            <div className="td-path-line"><span className="td-path-tag">{tt('transfer.src')}</span><span className="mono">{t.srcPath || '—'}</span><CopyBtn text={t.srcPath || ''} /></div>
            <div className="td-path-line"><span className="td-path-tag dst">{tt('transfer.dst')}</span><span className="mono">{t.dstPath || '—'}</span><CopyBtn text={t.dstPath || ''} /></div>
          </div>

          {t.kind === 'relay' && t.directNote && (
            <div className="td-note mono">{tt('workbench.diagnostic', {note: t.directNote})}</div>
          )}
          {t.error && <div className="td-err">{tt('workbench.transferError', {error: t.error})}</div>}
          {t.persistenceError && <div className="td-err">{tt('workbench.persistenceError', {error: t.persistenceError})}</div>}
          <div className="td-note">{tt('workbench.verification')}: {tt('workbench.verification_' + (t.verification || 'not-requested').replace(/-/g, '_'))}</div>

          <div className="td-files">
            <div className="td-files-head">
              <span>{tt('transfer.recentFiles', {done: t.filesDone ?? 0, sep: t.filesTotal ? ' / ' : '', total: t.filesTotal || ''})}</span>
              <input
                className="td-files-search"
                placeholder={tt('transfer.recentFilesFilter')}
                value={fileQ}
                onChange={(e) => setFileQ(e.target.value)}
              />
            </div>
            <div className="td-files-list">
              {files.length === 0 && <div className="td-files-empty">{tt('transfer.noPerFile')}</div>}
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
  const { t } = useTranslation();
  const tt = t;
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [st, setSt] = useState<StatusFilter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [finishedOpen, setFinishedOpen] = useState(false); // 「全部」视图下完成区默认折叠
  const [renderCap, setRenderCap] = useState(200); // 任务过多时渐进渲染
  const [verifyOn, setVerifyOn] = useState(() => localStorage.getItem('sc.tf.verify') === '1');

  useEffect(() => {
    api?.transferOptions({ verify: verifyOn });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setVerify = (v: boolean) => {
    setVerifyOn(v);
    localStorage.setItem('sc.tf.verify', v ? '1' : '0');
    api?.transferOptions({ verify: v });
  };

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('sc:show-transfers', show);
    return () => window.removeEventListener('sc:show-transfers', show);
  }, []);

  const ref = useRef<HTMLElement>(null);
  useDialogFocus(open, ref, () => { if (tf.runningCount === 0) setOpen(false); });

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

  const activeList = useMemo(
    () => filtered.filter((t) => !['done', 'canceled'].includes(t.status)),
    [filtered],
  );
  const finishedList = useMemo(
    () => filtered.filter((t) => ['done', 'canceled'].includes(t.status)),
    [filtered],
  );
  const showFinished = st === 'done' || finishedOpen;

  const speedOf = (k: TransferKind) =>
    tf.items.filter((t) => t.status === 'running' && t.kind === k).reduce((a, t) => a + (t.speed || 0), 0);
  const upSpeed = speedOf('upload');
  const downSpeed = speedOf('download');
  const relaySpeed = speedOf('relay');
  const active = tf.items.filter((t) => ['running', 'queued'].includes(t.status));
  const overall = active.length ? Math.round(active.reduce((a, t) => a + pctOf(t), 0) / active.length) : 0;

  if (!open) return null;

  const kindTabs: Array<[KindFilter, string]> = [
    ['all', tt('transfer.all')],
    ['upload', tt('transfer.upload')],
    ['download', tt('transfer.download')],
    ['relay', tt('transfer.relay')],
  ];
  const stTabs: Array<[StatusFilter, string, number]> = [
    ['all', tt('transfer.all'), tf.items.length],
    ['active', tt('transfer.active'), tf.runningCount + tf.queuedCount],
    ['done', tt('transfer.doneFilter'), tf.doneCount],
    ['error', tt('transfer.errorFilter'), tf.errorCount],
  ];

  return (
    <div className="td-root" onMouseDown={(e) => { if (e.target === e.currentTarget && tf.runningCount === 0) setOpen(false); }}>
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={tt('transfer.center')} tabIndex={-1} className={`td-drawer ${full ? 'full' : ''}`}>
        <header className="td-header">
          <div className="td-title">
            <h2>{tt('transfer.center')}</h2>
            {tf.runningCount > 0 && <span className="td-live"><i className="td-live-dot" />{tt('transfer.live', { n: tf.runningCount, p: overall })}</span>}
          </div>
          <div className="td-head-speed num">
            <span className="up"><ArrowUp size={12} strokeWidth={2.2} /> {formatSpeed(upSpeed) || '0 B/s'}</span>
            <span className="down"><ArrowDown size={12} strokeWidth={2.2} /> {formatSpeed(downSpeed) || '0 B/s'}</span>
            <span className="relay"><ArrowLeftRight size={12} strokeWidth={2.2} /> {formatSpeed(relaySpeed) || '0 B/s'}</span>
          </div>
          <div className="td-head-btns">
            <button className="btn icon-btn" title={full ? tt('transfer.restore') : tt('transfer.fullscreen')} onClick={() => setFull((v) => !v)}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
            <button className="btn icon-btn" title={tt('transfer.close')} onClick={() => setOpen(false)}><X size={13} /></button>
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
          <button className="btn mini" onClick={tf.pauseAll}>{tt('transfer.pauseAll')}</button>
          <button className="btn mini primary" onClick={tf.resumeAll}>{tt('transfer.resumeAll')}</button>
          {tf.errorCount > 0 && <button className="btn mini warn" onClick={tf.retryFailed}>{tt('transfer.retryFailed')}</button>}
          {picked.size > 0 && (
            <button className="btn mini danger" onClick={() => { tf.cancelMany([...picked]); setPicked(new Set()); }}>
              {tt('transfer.cancelSelected', {n: picked.size})}
            </button>
          )}
          <button className="btn mini" onClick={tf.clearFinished}>{tt('transfer.clearFinished')}</button>
        </div>

        <div className="td-settings-line">
          <label className="td-conc">
            {tt('transfer.concurrency')}
            <input
              type="range"
              min={1}
              max={15}
              value={tf.concurrency}
              onChange={(e) => tf.setConcurrency(Number(e.target.value))}
            />
            <b className="num">{tf.concurrency}</b>
          </label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.notifyDone} onChange={(e) => tf.setNotifyOpts({ notifyDone: e.target.checked })} />{tt('transfer.notifyDone')}</label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.notifyFail} onChange={(e) => tf.setNotifyOpts({ notifyFail: e.target.checked })} />{tt('transfer.notifyFail')}</label>
          <label className="td-chk"><input type="checkbox" checked={tf.notifyOpts.sound} onChange={(e) => tf.setNotifyOpts({ sound: e.target.checked })} />{tt('transfer.sound')}</label>
          <label className="td-chk">
            {tt('transfer.limit')}
            <input
              className="mini num"
              style={{ width: 52, marginLeft: 4 }}
              type="number"
              min={0}
              value={tf.limitMB || ''}
              placeholder={tt('transfer.unlimited')}
              onChange={(e) => tf.setLimitMB(Number(e.target.value) || 0)}
            />
            MB/s
          </label>
          <label className="td-chk" title={tt('transfer.verifyTip')}>
            <input type="checkbox" checked={verifyOn} onChange={(e) => setVerify(e.target.checked)} />{tt('transfer.verify')}
          </label>
          <span className="td-spacer" />
          {tf.runningCount > 0 && <span className="td-pin">{tt('transfer.pinned')}</span>}
        </div>

        <div className="td-list">
          {filtered.length === 0 && <div className="td-empty">{tt('transfer.empty')}</div>}
          {activeList.slice(0, renderCap).map((t) => (
            <TaskRow key={t.id} t={t} tf={tf} picked={picked} togglePick={togglePick} />
          ))}
          {st === 'all' && finishedList.length > 0 && (
            <button className="td-fold" onClick={() => setFinishedOpen((v) => !v)}>
              {tt('transfer.foldFinished', {n: finishedList.length})} {finishedOpen ? '▾' : '▸'}
            </button>
          )}
          {(st === 'done' || finishedOpen) &&
            finishedList.slice(0, renderCap).map((t) => <TaskRow key={t.id} t={t} tf={tf} picked={picked} togglePick={togglePick} />)}
          {(activeList.length > renderCap || (showFinished && finishedList.length > renderCap)) && (
            <button className="td-fold" onClick={() => setRenderCap((v) => v + 300)}>
              {tt('transfer.loadMore', {n: Math.max(0, activeList.length - renderCap) + (showFinished ? Math.max(0, finishedList.length - renderCap) : 0)})}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
