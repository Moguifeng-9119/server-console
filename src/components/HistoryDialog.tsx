import { useRef } from 'react';
import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import type { Server } from '../types';
import { historySummary } from '../history';
import { useDialogFocus } from '../hooks/useDialogFocus';

export function HistoryDialog({ s, onClose }: { s: Server | null; onClose: () => void }) {
  const { histories, demo } = useStore();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(!!s, ref, onClose);
  if (!s) return null;
  const data = histories[s.id] || [];
  const summary = historySummary(data);
  const W = 780, H = 240, left = 42, bottom = 32;
  const start = data[0]?.at || Date.now();
  const end = data[data.length - 1]?.at || start;
  const x = (at: number) => left + (at - start) / Math.max(1, end - start) * (W - left - 16);
  const y = (v: number) => 16 + (1 - v / 100) * (H - bottom - 16);
  const segments: string[] = [];
  let current = '';
  data.forEach((point, i) => {
    if (point.value == null || i > 0 && point.at - data[i - 1].at > 60000) {
      if (current) segments.push(current);
      current = '';
    }
    if (point.value != null) current += `${current ? ' L' : 'M'} ${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const pct = (value: number | null | undefined) => value == null ? 'N/A' : `${Math.round(value)}%`;

  return <div className="mask" onClick={onClose}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="history-title" className="dialog history-dialog" onClick={(e) => e.stopPropagation()}>
      <h3 id="history-title">{t('history.title', { name: s.name })}<button className="btn mini" onClick={onClose}>{t('history.close')}</button></h3>
      <p className="dim">{demo ? t('workbench.demo') : t('workbench.timestampHistory')} · {data.length} {t('workbench.samples')}</p>
      {data.length < 2 ? <div className="empty">{t('history.collecting')}</div> : <div className="hist-body">
        <div className="hist-stats"><span>{t('history.current')} <b>{pct(data[data.length - 1]?.value)}</b></span><span>{t('workbench.timeAverage')} <b>{pct(summary.average)}</b></span><span>{t('history.min')} <b>{pct(summary.min)}</b></span><span>{t('history.max')} <b>{pct(summary.max)}</b></span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="hist-chart" role="img" aria-label={t('history.title', { name: s.name })}>
          {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={left} y1={y(v)} x2={W - 16} y2={y(v)} stroke="var(--border)" strokeDasharray="3 4" /><text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-dim)">{v}%</text></g>)}
          {segments.map((path, i) => <path key={i} d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />)}
          <text x={left} y={H - 8} fontSize="11" fill="var(--text-dim)">{new Date(start).toLocaleString()}</text><text x={W - 16} y={H - 8} textAnchor="end" fontSize="11" fill="var(--text-dim)">{new Date(end).toLocaleTimeString()}</text>
        </svg>
      </div>}
      <p className="note">{t('workbench.historyNote')}</p>
    </div>
  </div>;
}
