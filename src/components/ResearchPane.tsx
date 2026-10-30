import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { Server } from '../types';
import type { ExperimentWorkspace, LogWatcher, WorkspaceTask } from '../workbench-types';
import { runFormSchema, type RunDraft, type Run, type MetricSeries } from '../research/schema';
import { csvCell, downloadText } from '../telemetry/history-view';
import './research.css';
const TrainingChart = lazy(() => import('./TrainingChart'));
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
async function request<T>(operation: string, extra: Record<string, unknown> = {}): Promise<T> {
  if (!api) throw new Error('Desktop API unavailable');
  const result = await api.workbenchRequest<T>({ operation, ...extra });
  if (!result.ok || result.data === undefined) throw new Error(result.error || 'Operation failed');
  return result.data;
}

export default function ResearchPane({ servers, serverId, workspaceId, onTerminal, onFiles }: {
  servers: Server[]; serverId?: string; workspaceId?: string;
  onTerminal?: (id: string, command?: string) => void; onFiles?: (id: string, path?: string) => void;
}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<Run[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [actionError, setActionError] = useState('');
  const [createServer, setCreateServer] = useState(serverId || servers[0]?.id || '');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const mounted = useRef(true);
  const editedDefaults = useRef({ cwd: false, gpu: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { register, handleSubmit, setValue, getValues, setError: fieldError, reset, formState: { errors, isSubmitting } } = useForm<RunDraft>({ resolver: zodResolver(runFormSchema), defaultValues: { name: '', command: '', cwd: '', gpu: '', totalSteps: '', parameters: '{}' } });
  useEffect(() => {
    if (!api || !createServer) return;
    let disposed = false;
    const defaults = async () => {
      if (workspaceId) {
        const values = await request<ExperimentWorkspace[]>('workspaceList', { serverId: createServer });
        const workspace = values.find((item) => item.id === workspaceId && item.serverId === createServer);
        if (!workspace) throw new Error(t('research.workspaceUnavailable'));
        if (!disposed) { if (!editedDefaults.current.cwd && !getValues('cwd')) setValue('cwd', workspace.cwd); if (!editedDefaults.current.gpu && !getValues('gpu')) setValue('gpu', workspace.gpu || ''); }
      } else {
        const result = await api!.sftpHome(createServer);
        if (!disposed && !editedDefaults.current.cwd && !getValues('cwd') && result.ok && result.data?.startsWith('/')) setValue('cwd', result.data);
      }
    };
    void defaults().catch((e) => { if (!disposed) setActionError(String(e)); });
    return () => { disposed = true; };
  }, [createServer, workspaceId, getValues, setValue, t]);
  useEffect(() => {
    let disposed = false, pending = false;
    const load = async () => {
      if (!api || pending) return; pending = true;
      try { const result = await request<Run[]>('runList', { serverId, workspaceId, limit: 100 }), values = Array.isArray(result) ? result : []; if (!disposed) { setRuns(values); setSelected((old) => values.some((r) => r.id === old) ? old : values[0]?.id || ''); setError(''); } }
      catch (e) { if (!disposed) setError(String(e)); } finally { pending = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [serverId, workspaceId, revision]);
  const markEdited = (field: keyof RunDraft) => { if (field === 'cwd' || field === 'gpu') editedDefaults.current[field] = true; };
  const create = async (draft: RunDraft) => {
    setActionError('');
    const totalSteps = draft.totalSteps ? Number(draft.totalSteps) : undefined;
    if (totalSteps !== undefined && !Number.isSafeInteger(totalSteps)) { fieldError('totalSteps', { message: t('research.invalidField') }); return; }
    try {
      const task = await request<WorkspaceTask>('taskSave', { ...draft, totalSteps, parameters: JSON.parse(draft.parameters), serverId: createServer, workspaceId });
      const started = await request<WorkspaceTask>('taskStart', { serverId: createServer, id: task.id });
      if (mounted.current) { reset({ name: '', command: '', cwd: draft.cwd, gpu: draft.gpu, parameters: '{}', totalSteps: '' }); setSelected(started.remoteId || ''); setRevision((r) => r + 1); }
    } catch (e) { if (mounted.current) { setActionError(String(e)); setRevision((r) => r + 1); } }
  };
  const visible = runs.filter((run) => (filter === 'all' || filter === 'active' && ['starting', 'running', 'unknown'].includes(run.status) || filter === run.status) && [run.name, run.command, run.gpu, run.id].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section className="research-pane" aria-label={t('research.title')}>
    <div className="workcenter-heading"><div><h2>{t('research.title')}</h2><p className="note">{t('research.note')}</p></div><button className="btn" onClick={() => setRevision((r) => r + 1)}>{t('research.refresh')}</button></div>
    {error && <p role="alert" className="monitor-error">{error}</p>}
    {actionError && <p role="alert" className="monitor-error">{actionError}</p>}
    <details className="card research-create"><summary>{t('research.newRun')}</summary><form className="workcenter-form" onSubmit={handleSubmit(create)}>
      <label>{t('research.server')}<select value={createServer} disabled={Boolean(serverId) || isSubmitting} onChange={(e) => { setCreateServer(e.target.value); editedDefaults.current = { cwd: false, gpu: false }; setValue('cwd', ''); setValue('gpu', ''); }}><option value="">—</option>{servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {(['name', 'cwd', 'gpu', 'totalSteps', 'parameters', 'command'] as const).map((field) => <label className={field === 'command' || field === 'parameters' ? 'wide' : ''} key={field}>{t('research.' + field)}{field === 'command' || field === 'parameters' ? <textarea aria-label={t('research.' + field)} disabled={isSubmitting} {...register(field, { onChange: () => markEdited(field) })} aria-invalid={Boolean(errors[field])} aria-describedby={field + '-error'} /> : <input aria-label={t('research.' + field)} disabled={isSubmitting} {...register(field, { onChange: () => markEdited(field) })} aria-invalid={Boolean(errors[field])} aria-describedby={field + '-error'} />}{errors[field] && <span role="alert" id={field + '-error'} className="monitor-error">{t('research.invalidField')}</span>}</label>)}
      <p className="note wide">{t('research.parametersNote')}</p><button className="btn primary" disabled={isSubmitting || !api || !createServer}>{isSubmitting ? t('research.starting') : t('research.start')}</button>
    </form></details>
    <div className="research-filters"><input aria-label={t('research.search')} placeholder={t('research.search')} value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label={t('research.status')} value={filter} onChange={(e) => setFilter(e.target.value)}>{['all', 'active', 'succeeded', 'failed', 'stopped'].map((s) => <option value={s} key={s}>{t('research.statuses.' + s)}</option>)}</select></div>
    <div className="research-layout"><div className="research-list">{visible.map((run) => <button className={'card research-run ' + (selected === run.id ? 'on' : '')} aria-pressed={selected === run.id} key={run.id} onClick={() => setSelected(run.id)}><strong>{run.name}</strong><span className={'badge run-' + run.status}>{t('research.statuses.' + run.status)}</span><small>{servers.find((s) => s.id === run.serverId)?.name || run.serverId} · GPU {run.gpu || '—'}</small><time>{new Date(run.startedAt || run.createdAt).toLocaleString()}</time></button>)}{!visible.length && <p className="empty">{api ? t('research.empty') : t('features.desktopRequired')}</p>}</div>
      {selected && visible.some((run) => run.id === selected) ? <RunDetail key={selected} id={selected} serverId={serverId} onTerminal={onTerminal} onFiles={onFiles} onDeleted={(warning) => { setRuns((old) => old.filter((run) => run.id !== selected)); setSelected(''); setRevision((r) => r + 1); setActionError(warning || ''); }} /> : <div className="card research-placeholder">{t('research.selectRun')}</div>}
    </div>
  </section>;
}

function RunDetail({ id, serverId, onTerminal, onFiles, onDeleted }: { id: string; serverId?: string; onTerminal?: (id: string, command?: string) => void; onFiles?: (id: string, path?: string) => void; onDeleted: (warning?: string) => void }) {
  const { t } = useTranslation();
  const [run, setRun] = useState<Run | null>(null), [error, setError] = useState(''), [tab, setTab] = useState<'curves' | 'logs' | 'parameters'>('curves');
  const [metric, setMetric] = useState('loss'), [axis, setAxis] = useState<'step' | 'time'>('step');
  const seriesKey = [id, serverId || '', metric, axis].join(':');
  const [loadedSeries, setLoadedSeries] = useState<{ key: string; data: MetricSeries } | null>(null);
  const series = loadedSeries?.key === seriesKey ? loadedSeries.data : null;
  const manualAxis = useRef(false);
  const [progressSeries, setProgressSeries] = useState<MetricSeries | null>(null);
  const [logs, setLogs] = useState<LogWatcher[]>([]), [logPath, setLogPath] = useState(''), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => request<Run>('runGet', { id, serverId }), [id, serverId]);
  useEffect(() => {
    let disposed = false, pending = false;
    const refresh = async () => { if (pending) return; pending = true; try { const value = await load(); if (!disposed) { setRun(value); setError(''); } if (tab === 'logs') { const values = await request<LogWatcher[]>('logList'); if (!disposed) setLogs(values.filter((l) => l.runId === id)); } } catch (e) { if (!disposed) setError(String(e)); } finally { pending = false; } };
    void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => { disposed = true; clearInterval(timer); };
  }, [load, tab, id, revision]);
  useEffect(() => {
    if (!run || tab !== 'curves') return;
    let disposed = false;
    void request<MetricSeries>('runMetrics', { runId: id, serverId, name: metric, axis, limit: 4000 }).then((value) => { if (!disposed) setLoadedSeries({ key: seriesKey, data: value }); }).catch((e) => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [run, tab, id, serverId, metric, axis, seriesKey]);
  useEffect(() => {
    if (!run) return;
    if (!manualAxis.current) setAxis(run.summary?.some((p) => p.name === 'step' && p.value !== null) ? 'step' : 'time');
    if (run.totalSteps == null && !run.summary?.some((p) => p.name === 'total_steps')) { setProgressSeries(null); return; }
    let disposed = false;
    void request<MetricSeries>('runMetrics', { runId: id, serverId, name: 'step', axis: 'time', limit: 200 }).then((value) => { if (!disposed) setProgressSeries(value); }).catch(() => { if (!disposed) setProgressSeries(null); });
    return () => { disposed = true; };
  }, [run, id, serverId]);
  if (!run) return <div className="card" role={error ? 'alert' : 'status'}>{error || t('research.loading')}</div>;
  const summary = Object.fromEntries((run.summary || []).map((p) => [p.name, p]));
  const total = run.totalSteps ?? summary.total_steps?.value, step = summary.step?.value;
  const recent = new Map<number, { at: number; step: number }>();
  for (const p of progressSeries?.points || []) if (typeof p.step === 'number') recent.set(p.at, { at: p.at, step: p.step });
  const etaPoints = [...recent.values()].slice(-20);
  const first = etaPoints[0], last = etaPoints[etaPoints.length - 1];
  const eta = total != null && step != null && total >= step && first && last && last.at > first.at && Number(last.step) > Number(first.step) ? (total - step) * (last.at - first.at) / (Number(last.step) - Number(first.step)) / 1000 : null;
  const metrics = (run.summary || []).filter((p) => !['step', 'epoch', 'total_steps'].includes(p.name));
  return <article className="card research-detail">
    <header><div><h2>{run.name}</h2><span className={'badge run-' + run.status}>{t('research.statuses.' + run.status)}</span></div><span className="mono">GPU {run.gpu || '—'}</span><p className="mono">{run.cwd}</p><div className="workcenter-actions"><button className="btn" disabled={!onTerminal} onClick={() => onTerminal?.(run.serverId, run.cwd.startsWith('/') ? 'cd -- ' + quote(run.cwd) : undefined)}>{t('research.terminal')}</button><button className="btn" disabled={!onFiles} onClick={() => onFiles?.(run.serverId, run.cwd.startsWith('/') ? run.cwd : undefined)}>{t('research.files')}</button><span>{t('research.exitCode')}: {run.exitCode ?? '—'}</span></div></header>
    {error && <p role="alert" className="monitor-error">{error}</p>}{run.lastError && <p role="alert" className="monitor-error">{run.lastError}</p>}
    <div className="workcenter-actions"><button className="btn" disabled={deleting || saving || ['starting', 'running', 'unknown'].includes(run.status)} onClick={() => { if (!window.confirm(t('research.confirmDelete'))) return; setDeleting(true); void request<{ deleted: boolean; trackingCleanupPending: boolean }>('runDelete', { id, serverId }).then((result) => { if (result.deleted) onDeleted(result.trackingCleanupPending ? t('research.cleanupPending') : undefined); }).catch((e) => setError(String(e))).finally(() => setDeleting(false)); }}>{t('features.remove')}</button></div>
    <div className="research-summary">{['loss', 'val_loss', 'lr', 'throughput', 'samples_per_second', 'tokens_per_second'].filter((key) => summary[key]).map((key) => <div key={key}><small>{key}</small><strong>{summary[key].value ?? '—'}</strong></div>)}<div><small>step / epoch</small><strong>{step ?? '—'}{total != null ? ' / ' + total : ''} · {summary.epoch?.value ?? '—'}</strong></div><div><small>ETA</small><strong>{eta === null || !['running', 'starting'].includes(run.status) ? '—' : Math.ceil(eta / 60) + ' min'}</strong></div></div>
    <div className="workcenter-tabs">{(['curves', 'logs', 'parameters'] as const).map((key) => <button className={tab === key ? 'on' : ''} aria-pressed={tab === key} key={key} onClick={() => setTab(key)}>{t('research.' + key)}</button>)}</div>
    {tab === 'curves' && <><div className="research-filters"><select aria-label={t('research.metric')} value={metric} onChange={(e) => setMetric(e.target.value)}>{[...new Set(['loss', ...metrics.map((p) => p.name)])].map((name) => <option key={name}>{name}</option>)}</select><select aria-label={t('research.axis')} value={axis} onChange={(e) => { manualAxis.current = true; setAxis(e.target.value === 'time' ? 'time' : 'step'); }}><option value="step">step</option><option value="time">{t('research.time')}</option></select><button className="btn" disabled={!series?.points.length} onClick={() => { const rows: unknown[][] = [['timestamp_utc', 'step', metric, 'min', 'max', 'missing_count'], ...(series?.points || []).map((p) => [new Date(p.at).toISOString(), p.step, p.value, p.min, p.max, p.missing || (p.value === null ? 1 : 0)])]; downloadText('training-' + id + '-' + metric + '.csv', '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv'); }}>CSV</button></div>{series?.points.length ? <Suspense fallback={<p>{t('research.loading')}</p>}><TrainingChart series={series} name={metric} axis={axis} /></Suspense> : <p className="empty">{t('research.noMetrics')}</p>}<p className="note">{t('research.retention')}{series?.downsampled ? ' · ' + t('research.downsampled') : ''}</p></>}
    {tab === 'logs' && <><form className="research-filters" onSubmit={(e) => { e.preventDefault(); if (saving) return; setSaving(true); void request('logSave', { serverId: run.serverId, runId: run.id, name: run.name, path: logPath, patterns: [], patternMode: 'literal', trackLoss: true }).then(() => { setLogPath(''); setRevision((r) => r + 1); }).catch((e) => setError(String(e))).finally(() => setSaving(false)); }}><input aria-label={t('research.logPath')} value={logPath} onChange={(e) => setLogPath(e.target.value)} placeholder="/absolute/train.jsonl" required pattern="/.*" /><button className="btn" disabled={saving}>{t('research.attachLog')}</button></form>{logs.map((log) => <div key={log.id}><p className="mono">{log.path}</p>{log.lastError && <p role="alert" className="monitor-error">{log.lastError}</p>}<pre>{(log.lastLines || []).join('\n') || t('research.noMetrics')}</pre></div>)}</>}
    {tab === 'parameters' && <><h3>{t('research.command')}</h3><pre>{run.command}</pre><h3>{t('research.parameters')}</h3><pre>{JSON.stringify(run.parameters, null, 2)}</pre><p className="note">{new Date(run.startedAt || run.createdAt).toLocaleString()} · {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'}</p></>}
    {Boolean(run.events?.length) && <section className="research-evidence"><h3>{t('research.evidence')}</h3>{run.events?.map((event) => <details key={event.id}><summary>{t('research.diagnostics.' + event.kind)} · {new Date(event.at).toLocaleString()}</summary><pre>{event.evidence}</pre></details>)}</section>}
  </article>;
}
