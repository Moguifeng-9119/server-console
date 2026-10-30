import { lazy, Suspense, useState } from 'react';
import { Activity, Cpu, FolderOpen, History, Search, Terminal } from 'lucide-react';
import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import type { Server } from '../types';
import { freeGiB, gpuOwners, matchingGpus, isFreshSample, isFreshGpu, gpuMetricAvailable } from '../resources';
import { useLiveServer } from '../telemetry/store';
import { GpuGauge } from './GpuGauge';
import { Sparkline } from './Sparkline';
import { queueTerminalCommand, queueFilesPath } from '../workbench-navigation';

const ResearchPane = lazy(() => import('./ResearchPane'));

type OpenServer = (id: string, tab?: 'gpu' | 'files' | 'term', gpuIndex?: number) => void;

export function Overview({ onOpen, onHistory }: { onOpen: OpenServer; onHistory: (s: Server) => void }) {
  const { servers, demo, refreshMs, sampleNow } = useStore();
  const { t } = useTranslation();
  const [homeView, setHomeView] = useState<'resources' | 'experiments'>(() => { try { return localStorage.getItem('sc.homeView') === 'experiments' ? 'experiments' : 'resources'; } catch { return 'resources'; } });
  const [query, setQuery] = useState('');
  const [minimum, setMinimum] = useState('');
  const [model, setModel] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState('free');
  const min = Math.max(0, Number(minimum) || 0);
  const models = [...new Set(servers.flatMap((s) => s.gpus.map((g) => g.name)))].sort();
  const isFresh = (s: Server) => isFreshSample(s, demo, refreshMs, sampleNow);
  const eligible = (s: Server) => isFresh(s) ? matchingGpus(s, min, model, query, sampleNow, refreshMs) : [];
  const allOnline = servers.filter((s) => s.status === 'online' && isFresh(s));
  const gpuCount = allOnline.reduce((sum, s) => sum + s.gpus.length, 0);
  const candidates = allOnline.flatMap(eligible);
  const q = query.trim().toLowerCase();
  const rows = servers.filter((s) => {
    if (onlineOnly && s.status !== 'online') return false;
    if (min > 0 || model) return eligible(s).length > 0;
    return !q || [s.name, s.host, s.group, ...s.gpus.map((g) => g.name), ...s.gpus.flatMap((g) => gpuOwners(s, g))].join(' ').toLowerCase().includes(q);
  });
  const maxFree = (s: Server) => s.status === 'online' && isFresh(s) ? Math.max(0, ...s.gpus.filter((g) => isFreshGpu(g, refreshMs, sampleNow)).map(freeGiB).filter(Number.isFinite)) : -1;
  rows.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : maxFree(b) - maxFree(a));
  const reset = () => { setQuery(''); setMinimum(''); setModel(''); setOnlineOnly(false); };
  const metrics = [
    { icon: Activity, value: `${allOnline.length}/${servers.length}`, label: t('workbench.servers') },
    { icon: Cpu, value: String(gpuCount), label: t('workbench.gpus') },
    { icon: Search, value: String(candidates.length), label: t('workbench.matches') },
    { icon: Cpu, value: `${Math.max(0, ...candidates.map(freeGiB)).toFixed(1)} GiB`, label: t('workbench.largest') },
  ];

  return <>
    <div className="workbench-heading">
      <div><div className="eyebrow">{t('workbench.eyebrow')}</div><h1>{t('workbench.title')}</h1><p>{t('workbench.subtitle')}</p></div>
      <span className={`mode-badge ${demo ? 'demo' : ''}`}>{t(demo ? 'workbench.demo' : 'workbench.ssh')}</span>
    </div>
    <div className="home-view-switch">{(['resources', 'experiments'] as const).map((view) => <button className={'btn ' + (homeView === view ? 'on' : '')} aria-pressed={homeView === view} key={view} onClick={() => { setHomeView(view); try { localStorage.setItem('sc.homeView', view); } catch { /* Keep the selected view in this session. */ } }}>{t('research.views.' + view)}</button>)}</div>
    {homeView === 'experiments' ? <Suspense fallback={<p>{t('research.loading')}</p>}><ResearchPane servers={servers} onTerminal={(id, command) => { if (command) queueTerminalCommand(id, command); onOpen(id, 'term'); }} onFiles={(id, directory) => { if (directory) queueFilesPath(id, directory); onOpen(id, 'files'); }} /></Suspense> : <>
    <div className="fleet-summary">{metrics.map(({ icon: Icon, value, label }) => <div className="summary-cell" key={label}><Icon size={17} /><div><strong className="num">{value}</strong><span>{label}</span></div></div>)}</div>
    <div className="resource-toolbar">
      <label className="resource-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('workbench.search')} aria-label={t('workbench.search')} /></label>
      <label>{t('workbench.minFree')}<input type="number" min="0" max="10000" className="mini" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="0" /> <span className="faint">GiB</span></label>
      <select className="mini" value={model} onChange={(e) => setModel(e.target.value)} aria-label={t('workbench.model')}><option value="">{t('workbench.allModels')}</option>{models.map((m) => <option key={m}>{m}</option>)}</select>
      <select className="mini" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('workbench.sort')}><option value="free">{t('workbench.sortFree')}</option><option value="name">{t('workbench.sortName')}</option></select>
      <label><input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />{t('workbench.onlineOnly')}</label>
    </div>
    <p className="resource-note">{t('workbench.permissionNote')}</p>
    <div className="grid resource-grid">
      {rows.map((s) => <LiveServerCard key={s.id} base={s} min={min} model={model} query={query} onOpen={onOpen} onHistory={onHistory} />)}
    </div>
    {!rows.length && <div className="empty resource-empty"><Search size={28} /><h3>{t('workbench.noMatch')}</h3><p>{t('workbench.noMatchHint')}</p><button className="btn" onClick={reset}>{t('workbench.reset')}</button></div>}
    </>}
  </>;
}

function LiveServerCard({ base, min, model, query, onOpen, onHistory }: { base: Server; min: number; model: string; query: string; onOpen: OpenServer; onHistory: (s: Server) => void }) {
  const s = useLiveServer(base)!;
  const { demo, refreshMs, sampleNow, colorOf } = useStore();
  const { t } = useTranslation();
  const online = s.status === 'online';
  const fresh = isFreshSample(s, demo, refreshMs, sampleNow);
  const matches = fresh ? matchingGpus(s, min, model, query, sampleNow, refreshMs) : [];
  const known = s.gpus.filter((g) => isFreshGpu(g, refreshMs, sampleNow) && gpuMetricAvailable(g, 'util'));
  const avg = known.length ? known.reduce((sum, g) => sum + g.util, 0) / known.length : null;
  const available = s.gpus.filter((g) => isFreshGpu(g, refreshMs, sampleNow)).map(freeGiB).filter(Number.isFinite);
  const name = [...new Set(s.gpus.map((g) => g.name.replace(/^NVIDIA /, '')))].join(' / ');
  const health = s.monitoring?.laneHealth as Record<string, { healthy?: boolean }> | undefined;
  const degraded = Object.values(health || {}).some((lane) => lane.healthy === false) || s.gpus.length > 0 && s.gpuProcessesAvailable === false;
  return <article className={`card resource-card ${online ? '' : 'unreachable'}`}>
    <div className="card-head"><i className={`dot ${s.status}`} /><button className="server-name" onClick={() => onOpen(s.id)}>{s.name}</button><span className="badge">{online ? `${s.gpus.length} GPU` : t('overview.offline')}</span></div>
    <div className="resource-host mono">{s.host}</div><div className="resource-model" title={name}>{name || t('workbench.noGpu')}</div>
    {online && degraded && <div role="status" className="monitor-error">{t('features.partialMetrics')}</div>}
    <div className="resource-kpis"><div><strong className="num">{online && fresh && available.length ? Math.max(...available).toFixed(1) : '—'}<small> GiB</small></strong><span>{t('workbench.largest')}</span></div><div><strong className="num" style={{ color: online && avg != null ? colorOf(avg) : undefined }}>{online && fresh && avg != null ? Math.round(avg) + '%' : '—'}</strong><span>{t('overview.avgUtil')}</span></div><div><strong className="num">{matches.length}</strong><span>{t('workbench.matches')}</span></div></div>
    <Sparkline values={s.history} color={online ? 'var(--accent)' : 'var(--text-faint)'} />
    <div className="resource-gpus">{s.gpus.map((g) => <GpuGauge key={g.uuid || g.index} id={s.id + ':' + (g.uuid || g.index)} gpu={g} online={online} fresh={fresh && (demo || isFreshGpu(g, refreshMs, sampleNow))} color={colorOf(g.util)} owners={gpuOwners(s, g)} isMatch={matches.some((m) => m.index === g.index)} freeGiBVal={freeGiB(g)} onClick={() => onOpen(s.id, 'gpu', g.index)} />)}</div>
    <div className="resource-footer"><span>{demo ? t('workbench.demo') : s.collectedAt ? t('workbench.updated', { time: new Date(s.laneTimestamps?.gpu ?? s.collectedAt).toLocaleTimeString() }) : t('workbench.waiting')}{online && !fresh && !demo && ` · ${t('workbench.stale')}`}{s.monitoring && ` · ${s.monitoring.effectiveIntervalMs}ms`}</span><button className="btn mini" onClick={() => onHistory(s)} aria-label={t('history.title', { name: s.name })}><History size={13} />{t('monitor.title')}</button></div>
    <div className="resource-actions"><button className="btn primary" onClick={() => onOpen(s.id, 'gpu')}><Activity size={14} />{t('workbench.inspect')}</button><button className="btn" onClick={() => onOpen(s.id, 'term')}><Terminal size={14} />{t('workbench.terminal')}</button><button className="btn" onClick={() => onOpen(s.id, 'files')}><FolderOpen size={14} />{t('nav.files')}</button></div>
  </article>;
}
