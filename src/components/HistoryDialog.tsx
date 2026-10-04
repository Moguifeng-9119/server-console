import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import type { Server } from '../types';

// 详细历史占用曲线：数据来自持久化的 GPU 平均利用率（720 点上限）
export function HistoryDialog({ s, onClose }: { s: Server | null; onClose: () => void }) {
  const { histories, refreshMs } = useStore();
  const { t } = useTranslation();
  if (!s) return null;
  const data = histories[s.id] || [];
  const n = data.length;

  const W = 780;
  const H = 240;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - padT - padB);

  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = n > 0 ? `M ${x(0).toFixed(1)},${y(data[0]).toFixed(1)} ` + data.slice(1).map((v, i) => `L ${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L ${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L ${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z` : '';
  const avg = n ? Math.round(data.reduce((a, b) => a + b, 0) / n) : 0;
  const max = n ? Math.round(Math.max(...data)) : 0;
  const min = n ? Math.round(Math.min(...data)) : 0;
  const cur = n ? Math.round(data[n - 1]) : 0;
  const seconds = Math.round((n * refreshMs) / 1000);
  const spanText = n > 1 ? `近 ${seconds >= 3600 ? (seconds / 3600).toFixed(1) + ' 小时' : seconds >= 60 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒'}（${n} 个采样点）` : '';

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog" style={{ width: 840 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t('history.title', { name: s.name })}
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{s.host}</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{spanText}</span>
        </h3>
        {n < 2 ? (
          <div className="body" style={{ color: 'var(--text-faint)', padding: '24px 0', textAlign: 'center' }}>
            {t('history.collecting')}
          </div>
        ) : (
          <div className="body hist-body">
            <div className="hist-stats">
              <span>{t('history.current')} <b className="num" style={{ color: 'var(--accent)' }}>{cur}%</b></span>
              <span>{t('history.avg')} <b className="num">{avg}%</b></span>
              <span>{t('history.min')} <b className="num">{min}%</b></span>
              <span>{t('history.max')} <b className="num" style={{ color: 'var(--high)' }}>{max}%</b></span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="hist-chart">
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--border)" strokeDasharray="3 4" />
                  <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">{v}</text>
                </g>
              ))}
              <line x1={x(n - 1)} y1={padT} x2={x(n - 1)} y2={H - padB} stroke="var(--accent)" strokeOpacity="0.35" />
              <path d={area} fill="var(--accent)" fillOpacity="0.14" stroke="none" />
              <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
              <text x={padL} y={H - 8} fontSize="10" fill="var(--text-faint)">{n > 1 ? t('history.ago', { s: seconds }) : ''}</text>
              <text x={W - padR} y={H - 8} textAnchor="end" fontSize="10" fill="var(--text-faint)">{t('history.now')}</text>
            </svg>
          </div>
        )}
        <div className="foot">
          <span style={{ color: 'var(--text-faint)', fontSize: 11, marginRight: 'auto' }}>
            {t('history.sampleNote')}
          </span>
          <button className="btn primary" onClick={onClose}>{t('history.close')}</button>
        </div>
      </div>
    </div>
  );
}
