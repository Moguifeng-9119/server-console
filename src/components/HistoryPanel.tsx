import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useStoreControls } from '../state';
import type { HistoryResult, Server } from '../types';
import type { WorkbenchEvent } from '../workbench-types';
import { historyCsv, summarizeHistory, downloadText, seriesColors } from '../telemetry/history-view';
import './workcenter.css';

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
  const [rangeMs, setRange] = useState(() => { try { const saved = Number(localStorage.getItem('sc.history.range')); return ranges.includes(saved) ? saved : ranges[0]; } catch { return ranges[0]; } });
  const [device, setDevice] = useState('all'), [metric, setMetric] = useState('util');
  const [comparisons, setComparisons] = useState<string[]>([]), [endValue, setEndValue] = useState('');
  const [series, setSeries] = useState<Array<{ id: string; label: string; data: HistoryResult }>>([]);
  const [catalog, setCatalog] = useState<HistoryResult['devices']>([]), [events, setEvents] = useState<WorkbenchEvent[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [hover, setHover] = useState<number | null>(null), [dragStart, setDragStart] = useState<number | null>(null);
  const label = (key: string, fallback: string) => t('features.' + key, { defaultValue: fallback });
  const end = endValue ? new Date(endValue).getTime() : undefined;
  const data = series[0]?.data;
  useEffect(() => {
    let disposed = false, pending = false;
    setSeries([]); setError(''); setEvents([]); setHover(null);
    const load = async () => {
      if (pending) return; pending = true; setLoading(true);
      try {
        const queryEnd = end ?? Date.now();
        const results = await Promise.all([device, ...comparisons.filter((id) => id !== device)].slice(0, 8).map(async (id) => {
          const result = demo ? demoHistory(s, rangeMs, metric) : await api!.historyQuery({ serverId: s.id, device: id, metric, rangeMs, end: queryEnd });
          return { id, label: result.devices.find((d) => d.device === id)?.label || id, data: result };
        }));
        if (disposed) return;
        setSeries(results); setCatalog(results[0].data.devices); setError('');
        if (!demo && api?.workbenchRequest) {
          try { const response = await api.workbenchRequest<WorkbenchEvent[]>({ operation: 'eventList', serverId: s.id }); if (!disposed && response.ok && response.data) setEvents(response.data); } catch { /* history remains available if events cannot be loaded */ }
        }
      } catch (e) { if (!disposed) setError(String(e)); }
      finally { pending = false; if (!disposed) setLoading(false); }
    };
    void load(); const timer = setInterval(() => { if (end == null) void load(); }, 15000);
    return () => { disposed = true; clearInterval(timer); };
    // Snapshot identity changes do not restart historical queries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id, device, metric, rangeMs, demo, revision, end, comparisons]);
  const devices = useMemo(() => {
    const unique = new Map(catalog.map((d) => [d.device, d.label]));
    if (!unique.has('all')) unique.set('all', '');
    return [...unique].map(([id, name]) => ({ id, label: id === 'all' ? t('monitor.allGpus') : id === 'system' ? t('monitor.system') : name }));
  }, [catalog, t]);
  const metrics = [...new Set(catalog.filter((d) => d.device === device).map((d) => d.metric))];
  if (!metrics.length) metrics.push(...(device === 'all' ? ['util'] : device === 'system' ? ['cpu', 'memory'] : ['util', 'memory', 'temp', 'power']));
  const compatible = devices.filter((d) => d.id !== device && catalog.some((entry) => entry.device === d.id && entry.metric === metric));
  const mibMetric = metric === 'memoryUsed' || metric === 'memoryTotal';
  const bytesMetric = /Bytes|availableBytes/.test(metric);
  const perSecond = /PerSecond/.test(metric);
  const allValues = series.flatMap((item) => item.data.points.flatMap((p) => p.value == null ? [] : [p.min ?? p.value, p.max ?? p.value]));
  const maxValue = allValues.length ? Math.max(...allValues) : 0;
  const scale = mibMetric ? 1024 : bytesMetric ? maxValue >= 1073741824 ? 1073741824 : maxValue >= 1048576 ? 1048576 : 1024 : 1;
  const unit = mibMetric ? 'GiB' : bytesMetric ? (scale === 1073741824 ? 'GiB' : scale === 1048576 ? 'MiB' : 'KiB') + (perSecond ? '/s' : '') : metric === 'temp' ? '°C' : metric === 'power' ? 'W' : '%';
  const format = (v: number | null | undefined) => v == null ? '—' : `${(v / scale).toFixed(1)} ${unit}`;
  const top = mibMetric || bytesMetric ? Math.max(scale, maxValue * 1.08) : metric === 'power' || metric === 'temp' ? Math.max(metric === 'power' ? 200 : 100, maxValue) * 1.05 : 100;
  const startAt = data?.start ?? 0, endAt = data?.end ?? startAt + rangeMs, windowMs = Math.max(1, endAt - startAt);
  const x = (at: number) => 70 + (at - startAt) / windowMs * 868;
  const y = (value: number) => 18 + (1 - value / top) * 234;
  const paths = (points: HistoryResult['points']) => {
    const lines: string[] = [], bands: string[] = []; let line = '', previousGap = true;
    for (const point of points) {
      if (point.value == null) { if (line) lines.push(line); line = ''; previousGap = true; continue; }
      if (previousGap || point.gap) { if (line) lines.push(line); line = ''; }
      line += `${line ? ' L' : 'M'} ${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`;
      if (point.min != null && point.max != null) bands.push(`M ${x(point.at).toFixed(1)},${y(point.min).toFixed(1)} L ${x(point.at).toFixed(1)},${y(point.max).toFixed(1)}`);
      previousGap = point.gap;
    }
    if (line) lines.push(line); return { lines, bands };
  };
  const stats = data ? summarizeHistory(data, startAt, endAt) : null;
  const timestamp = (at: number, full = false) => new Date(at).toLocaleString(i18n.language, full ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } : rangeMs >= 43200000 ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const localDate = (at: number) => { const date = new Date(at); return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
  const rangeTitle = ranges.includes(rangeMs) ? t('monitor.' + rangeKeys[ranges.indexOf(rangeMs)]) : label('customRange', 'Custom range');
  const setWindow = (value: number) => { setRange(value); setHover(null); try { localStorage.setItem('sc.history.range', String(value)); } catch { /* keep current range in memory */ } };
  const chartAt = (event: React.PointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return startAt + Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 960 - 70) / 868)) * windowMs; };
  const metricTitle = (m: string) => t('monitor.' + m, { defaultValue: label(m, m) });
  const visibleEvents = events.filter((event) => event.at >= startAt && event.at <= endAt).slice(0, 100);
  return <section className="monitor-panel" aria-label={t('monitor.title')}>
    <div className="monitor-heading"><div><h2>{t('monitor.title')}</h2><p>{s.name} · {demo ? t('workbench.demo') : t('monitor.recording')}</p></div><div className="workcenter-actions"><button className="btn" disabled={loading} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={14} />{t('monitor.refresh')}</button><button className="btn" disabled={!data} onClick={() => data && downloadText('server-console-history.csv', historyCsv(series, metric, startAt, endAt))}><Download size={13} />CSV</button><button className="btn" disabled={!data} onClick={() => data && downloadText('server-console-history.json', JSON.stringify({ server: s.name, metric, start: startAt, end: endAt, series: series.map((item) => ({ device: item.id, label: item.label, ...summarizeHistory(item.data, startAt, endAt) })), events: visibleEvents }, null, 2), 'application/json')}>JSON</button></div></div>
    <div className="monitor-toolbar"><div className="monitor-ranges" aria-label={t('monitor.range')}>{ranges.map((range, i) => <button key={range} className={rangeMs === range ? 'on' : ''} aria-pressed={rangeMs === range} onClick={() => setWindow(range)}>{t('monitor.' + rangeKeys[i])}</button>)}</div>
      <label>{t('monitor.device')}<select value={device} onChange={(e) => { const next = e.target.value; setDevice(next); setMetric(catalog.find((entry) => entry.device === next)?.metric || (next === 'system' ? 'cpu' : 'util')); setComparisons([]); }}>{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label>{t('monitor.metric')}<select value={metric} onChange={(e) => { setMetric(e.target.value); setComparisons([]); }}>{metrics.map((m) => <option key={m} value={m}>{metricTitle(m)}</option>)}</select></label>
      <label>{label('historyEnd', 'End time')}<input type="datetime-local" step="1" value={endValue} onChange={(e) => setEndValue(e.target.value)} max={localDate(Date.now())} /></label>{endValue && <button className="btn mini" onClick={() => setEndValue('')}>{label('live', 'Live')}</button>}<button className="btn mini" disabled={!data || rangeMs <= 60000} onClick={() => { setEndValue(localDate(endAt)); setWindow(Math.max(60000, Math.floor(rangeMs / 2))); }}><ZoomIn size={13} />{label('zoom', 'Zoom')}</button></div>
    {compatible.length > 0 && <fieldset className="history-comparison"><legend>{label('compareDevices', 'Compare devices (up to 8)')}</legend>{compatible.map((item) => <label key={item.id}><input type="checkbox" checked={comparisons.includes(item.id)} disabled={!comparisons.includes(item.id) && comparisons.length >= 7} onChange={(e) => setComparisons((old) => e.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))} />{item.label}</label>)}</fieldset>}
    {error && <p className="monitor-error" role="alert">{t('monitor.loadError')} · {error}</p>}
    <div className="monitor-stats"><span>{t('workbench.timeAverage')}<b>{format(stats?.average)}</b></span><span>{t('history.min')}<b>{format(stats?.min)}</b></span><span>{t('history.max')}<b>{format(stats?.max)}</b></span><span>{t('monitor.coverage')}<b>{((stats?.coverage ?? 0) * 100).toFixed(1)}%</b></span></div>
    {data ? <div className="monitor-chart-wrap"><svg className="monitor-chart" viewBox="0 0 960 300" role="img" aria-label={`${metricTitle(metric)} · ${rangeTitle}`} onPointerMove={(e) => setHover(chartAt(e))} onPointerLeave={() => { setHover(null); setDragStart(null); }} onPointerDown={(e) => { if (e.button === 0) { setDragStart(chartAt(e)); e.currentTarget.setPointerCapture(e.pointerId); } }} onPointerUp={(e) => { const finish = chartAt(e); if (dragStart != null && Math.abs(finish - dragStart) > Math.max(60000, rangeMs / 40)) { setEndValue(localDate(Math.max(dragStart, finish))); setWindow(Math.max(60000, Math.round(Math.abs(finish - dragStart)))); } setDragStart(null); }}>
      {[0, 1, 2, 3, 4].map((i) => { const value = top * i / 4; return <g key={i}><line x1="70" y1={y(value)} x2="938" y2={y(value)} stroke="var(--border)" strokeDasharray="3 5" /><text x="62" y={y(value) + 4} textAnchor="end" fill="var(--text-dim)" fontSize="11">{(value / scale).toFixed(bytesMetric ? 1 : 0)}</text></g>; })}
      <text x="70" y="12" fill="var(--text-dim)" fontSize="10">{unit}</text>
      {series.map((item, index) => { const drawing = paths(item.data.points); return <g key={item.id}>{drawing.bands.map((path, i) => <path key={'b' + i} d={path} fill="none" stroke={seriesColors[index]} strokeWidth="3" opacity=".18" />)}{drawing.lines.map((path, i) => <path key={i} d={path} fill="none" stroke={seriesColors[index]} strokeWidth="2" />)}</g>; })}
      {visibleEvents.map((event) => <g key={event.id}><line x1={x(event.at)} y1="18" x2={x(event.at)} y2="252" stroke="var(--warn)" opacity=".5" strokeDasharray="2 4" /><circle cx={x(event.at)} cy="20" r="4" fill="var(--warn)"><title>{timestamp(event.at, true)} · {event.title} · {event.body}</title></circle></g>)}
      {hover != null && <line x1={x(hover)} y1="18" x2={x(hover)} y2="252" stroke="var(--text-dim)" strokeDasharray="3 3" />}
      {dragStart != null && hover != null && <rect x={x(Math.min(dragStart, hover))} y="18" width={Math.abs(x(hover) - x(dragStart))} height="234" fill="var(--accent)" opacity=".12" />}
      {[0, 1, 2, 3, 4].map((i) => { const at = startAt + windowMs * i / 4; return <text key={i} x={x(at)} y="286" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fill="var(--text-dim)" fontSize="11">{timestamp(at)}</text>; })}
      {data.points.map((p) => <rect key={p.at} x={x(p.at)} y="18" width={Math.max(1, data.stepMs / windowMs * 868)} height="234" fill="transparent"><title>{timestamp(p.at, true)} · {format(p.value)} · {t('history.min')} {format(p.min)} · {t('history.max')} {format(p.max)}{p.gap ? ' · ' + t('monitor.gap') : ''}</title></rect>)}
    </svg>{!series.some((item) => item.data.points.some((point) => point.value != null)) && <div className="monitor-empty">{t(loading ? 'monitor.loading' : 'monitor.empty')}</div>}</div> : <div className="empty" role="status">{t(loading ? 'monitor.loading' : 'monitor.empty')}</div>}
    <div className="history-legend" aria-live="polite">{series.map((item, index) => { const nearest = hover == null ? null : item.data.points.reduce<HistoryResult['points'][number] | null>((best, point) => !best || Math.abs(point.at - hover) < Math.abs(best.at - hover) ? point : best, null); return <span key={item.id}><i style={{ background: seriesColors[index] }} />{devices.find((d) => d.id === item.id)?.label || item.label}{nearest && <> · {timestamp(nearest.at)} · <b>{format(nearest.value)}</b></>}</span>; })}</div>
    {data && <p className="monitor-window mono">{timestamp(startAt, true)} — {timestamp(endAt, true)}</p>}
    {visibleEvents.length > 0 && <details className="history-events"><summary>{label('events', 'Events')} ({visibleEvents.length})</summary>{visibleEvents.map((event) => <p key={event.id}><time>{timestamp(event.at, true)}</time> · {event.title} {event.body}</p>)}</details>}
    <p className="note">{t('monitor.note')} · {label('dragZoom', 'Drag across the chart to zoom into a time window.')}</p>
  </section>;
}
