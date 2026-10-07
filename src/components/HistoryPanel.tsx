import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useStoreControls } from '../state';
import type { HistoryResult, Server } from '../types';

const ranges = [1800000, 3600000, 43200000, 86400000, 604800000];
const rangeKeys = ['halfHour', 'hour', 'halfDay', 'day', 'week'];
function demoHistory(s: Server, rangeMs: number, metric: string): HistoryResult {
  const end = Date.now(), start = end - rangeMs, stepMs = rangeMs <= 1800000 ? 5000 : rangeMs <= 3600000 ? 10000 : rangeMs <= 43200000 ? 60000 : rangeMs <= 86400000 ? 120000 : 900000;
  const devices = [{ device: 'all', label: 'All GPUs', metric: 'util' }, { device: 'system', label: 'System', metric: 'cpu' }, { device: 'system', label: 'System', metric: 'memory' },
    ...s.gpus.flatMap((g) => ['util', 'memory', 'temp', 'power'].map((m) => ({ device: 'gpu:' + (g.uuid || g.index), label: `GPU ${g.index} · ${g.name}`, metric: m })))];
  const base = metric === 'power' ? 150 : metric === 'temp' ? 55 : 45;
  return { start, end, stepMs, retentionDays: 30, rawHours: 24, devices,
    points: Array.from({ length: Math.ceil(rangeMs / stepMs) }, (_, i) => {
      const value = base + Math.sin(i / 23) * 12 + Math.cos(i / 7) * 5;
      return { at: start + i * stepMs, value, min: value - 3, max: value + 4, coveredMs: stepMs, gap: false };
    }) };
}

export function HistoryPanel({ s }: { s: Server }) {
  const { demo } = useStoreControls();
  const { t, i18n } = useTranslation();
  const [rangeMs, setRange] = useState(() => {
    try { const saved = Number(localStorage.getItem('sc.history.range')); return ranges.includes(saved) ? saved : ranges[0]; } catch { return ranges[0]; }
  });
  const [device, setDevice] = useState('all'), [metric, setMetric] = useState('util');
  const [data, setData] = useState<HistoryResult | null>(null);
  const [catalog, setCatalog] = useState<HistoryResult['devices']>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false, pending = false;
    setData(null); setError('');
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        const result = demo ? demoHistory(s, rangeMs, metric) : await api!.historyQuery({ serverId: s.id, device, metric, rangeMs });
        if (!disposed) { setData(result); setCatalog(result.devices); setError(''); }
      } catch (e) { if (!disposed) setError(String(e)); }
      finally { pending = false; if (!disposed) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { disposed = true; clearInterval(timer); };
    // History refresh is independent of live monitoring snapshot updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id, device, metric, rangeMs, demo, revision]);
  const devices = useMemo(() => {
    const unique = new Map(catalog.map((d) => [d.device, d.label]));
    if (!unique.has('all')) unique.set('all', '');
    return [...unique].map(([id, label]) => ({ id, label: id === 'all' ? t('monitor.allGpus') : id === 'system' ? t('monitor.system') : label }));
  }, [catalog, t]);
  const metrics = device === 'all' ? ['util'] : device === 'system' ? ['cpu', 'memory'] : ['util', 'memory', 'temp', 'power'];
  const unit = metric === 'temp' ? '°C' : metric === 'power' ? 'W' : '%';
  const format = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(1)}${unit}`;
  const chart = useMemo(() => {
    const points = data?.points || [], values = points.flatMap((p) => p.value == null ? [] : [p.min ?? p.value, p.max ?? p.value]);
    const top = metric === 'temp' || metric === 'power' ? Math.max(metric === 'temp' ? 100 : 200, ...values) * 1.05 : 100;
    const x = (at: number) => 54 + (at - (data?.start || 0)) / rangeMs * 884;
    const y = (v: number) => 18 + (1 - v / top) * 234;
    const paths: string[] = [], bands: string[] = [];
    let path = '', previousGap = true;
    for (const p of points) {
      if (p.value == null) { if (path) paths.push(path); path = ''; previousGap = true; continue; }
      if (previousGap || p.gap) { if (path) paths.push(path); path = ''; }
      path += `${path ? ' L' : 'M'} ${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`;
      if (p.min != null && p.max != null) bands.push(`M ${x(p.at).toFixed(1)},${y(p.min).toFixed(1)} L ${x(p.at).toFixed(1)},${y(p.max).toFixed(1)}`);
      previousGap = p.gap;
    }
    if (path) paths.push(path);
    const coverage = points.reduce((n, p) => n + p.coveredMs, 0);
    return { points, top, x, y, paths, bands, coverage,
      average: coverage ? points.reduce((n, p) => n + (p.value ?? 0) * p.coveredMs, 0) / coverage : null,
      min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
  }, [data, metric, rangeMs]);
  const timestamp = (at: number, full = false) => new Date(at).toLocaleString(i18n.language, full ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : rangeMs >= 43200000 ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  return <section className="monitor-panel" aria-label={t('monitor.title')}>
    <div className="monitor-heading"><div><h2>{t('monitor.title')}</h2><p>{s.name} · {demo ? t('workbench.demo') : t('monitor.recording')}</p></div><button className="btn" disabled={loading} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={14} />{t('monitor.refresh')}</button></div>
    <div className="monitor-toolbar"><div className="monitor-ranges" aria-label={t('monitor.range')}>{ranges.map((range, i) => <button key={range} className={rangeMs === range ? 'on' : ''} aria-pressed={rangeMs === range} onClick={() => { setRange(range); localStorage.setItem('sc.history.range', String(range)); }}>{t('monitor.' + rangeKeys[i])}</button>)}</div>
      <label>{t('monitor.device')}<select value={device} onChange={(e) => { const next = e.target.value; setDevice(next); setMetric(next === 'system' ? 'cpu' : 'util'); }}>{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label>{t('monitor.metric')}<select value={metric} onChange={(e) => setMetric(e.target.value)}>{metrics.map((m) => <option key={m} value={m}>{t('monitor.' + m)}</option>)}</select></label></div>
    {error && <p className="monitor-error" role="alert">{t('monitor.loadError')} · {error}</p>}
    <div className="monitor-stats"><span>{t('workbench.timeAverage')}<b>{format(chart.average)}</b></span><span>{t('history.min')}<b>{format(chart.min)}</b></span><span>{t('history.max')}<b>{format(chart.max)}</b></span><span>{t('monitor.coverage')}<b>{(chart.coverage / rangeMs * 100).toFixed(1)}%</b></span></div>
    {data ? <div className="monitor-chart-wrap"><svg className="monitor-chart" viewBox="0 0 960 300" role="img" aria-label={`${t('monitor.' + metric)} · ${t('monitor.' + rangeKeys[ranges.indexOf(rangeMs)])}`}>
      {[0, 1, 2, 3, 4].map((i) => { const value = chart.top * i / 4; return <g key={i}><line x1="54" y1={chart.y(value)} x2="938" y2={chart.y(value)} stroke="var(--border)" strokeDasharray="3 5" /><text x="46" y={chart.y(value) + 4} textAnchor="end" fill="var(--text-dim)" fontSize="11">{Math.round(value)}{unit}</text></g>; })}
      {chart.bands.map((path, i) => <path key={i} d={path} fill="none" stroke="var(--accent)" strokeWidth="3" opacity=".22" />)}
      {chart.paths.map((path, i) => <path key={i} d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />)}
      {[0, 1, 2, 3, 4].map((i) => { const at = data.start + rangeMs * i / 4; return <text key={i} x={chart.x(at)} y="286" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fill="var(--text-dim)" fontSize="11">{timestamp(at)}</text>; })}
      {chart.points.map((p) => <rect key={p.at} x={chart.x(p.at)} y="18" width={Math.max(1, data.stepMs / rangeMs * 884)} height="234" fill="transparent"><title>{timestamp(p.at, true)} · {format(p.value)} · {t('history.min')} {format(p.min)} · {t('history.max')} {format(p.max)}{p.gap ? ' · ' + t('monitor.gap') : ''}</title></rect>)}
    </svg>{!chart.points.some((p) => p.value != null) && <div className="monitor-empty">{t(loading ? 'monitor.loading' : 'monitor.empty')}</div>}</div> : <div className="empty" role="status">{t(loading ? 'monitor.loading' : 'monitor.empty')}</div>}
    {data && <p className="monitor-window mono">{timestamp(data.start, true)} — {timestamp(data.end, true)}</p>}
    <p className="note">{t('monitor.note')}</p>
  </section>;
}
