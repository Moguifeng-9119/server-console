import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SyncPlan, type SyncRun } from '../api';
import { useDialogFocus } from '../hooks/useDialogFocus';

export function SyncDialog({ serverId, localDir, remoteDir, onClose }: { serverId: string; localDir: string; remoteDir: string; onClose: () => void }) {
  const { t } = useTranslation(); const root = useRef<HTMLDivElement>(null);
  const label = (key: string, fallback: string) => t('features.' + key, { defaultValue: fallback });
  const [local, setLocal] = useState(localDir), [remote, setRemote] = useState(remoteDir), [direction, setDirection] = useState<'upload' | 'download'>('upload');
  const [exclude, setExclude] = useState('.git\nnode_modules\n__pycache__\n*.pyc'), [remove, setRemove] = useState(false);
  const [plan, setPlan] = useState<SyncPlan | null>(null), [run, setRun] = useState<SyncRun | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false);
  useDialogFocus(true, root, () => { if (!pending.current) onClose(); });
  useEffect(() => { generation.current += 1; pending.current = false; setBusy(false); setPlan(null); setRun(null); }, [serverId, local, remote, direction, exclude, remove]);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (!run || ['done', 'error'].includes(run.status) || !api) return;
    const desktop = api;
    let disposed = false;
    const timer = setInterval(() => { void desktop.syncList().then((runs) => { const next = runs.find((item) => item.id === run.id); if (!disposed && next) setRun(next); }).catch((e) => { if (!disposed) setError(String(e)); }); }, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [run]);
  const preview = async () => {
    if (!api || pending.current) return; pending.current = true; const token = ++generation.current; setBusy(true); setError(''); setPlan(null); setRun(null);
    try { const result = await api.syncPreview({ serverId, localDir: local, remoteDir: remote, direction, exclude: exclude.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), deleteExtraneous: remove }); if (token !== generation.current) return; if (!result.ok || !result.data) throw new Error(result.error); setPlan(result.data); }
    catch (e) { if (token === generation.current) setError(String(e)); } finally { if (token === generation.current) { pending.current = false; setBusy(false); } }
  };
  const apply = async () => {
    if (!api || !plan || pending.current) return; pending.current = true; const token = ++generation.current; const planId = plan.id; setBusy(true); setError(''); setPlan(null);
    try { const result = await api.syncApply(planId); if (token !== generation.current) return; if (!result.ok || !result.data) throw new Error(result.error); setRun(result.data); window.dispatchEvent(new Event('sc:show-transfers')); }
    catch (e) { if (token === generation.current) setError(String(e)); } finally { if (token === generation.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="mask" onClick={() => { if (!busy) onClose(); }}><div className="dialog sync-dialog" ref={root} role="dialog" aria-modal="true" aria-labelledby="sync-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ width: 780, maxWidth: 'calc(100vw - 32px)' }}><h3 id="sync-title">{label('syncPreview', 'Sync preview')}</h3><div className="body"><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}><div className="workcenter-form"><label>{label('localDirectory', 'Local directory')}<input value={local} onChange={(e) => setLocal(e.target.value)} /></label><label>{label('remoteDirectory', 'Remote directory')}<input value={remote} onChange={(e) => setRemote(e.target.value)} /></label><label>{label('direction', 'Direction')}<select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}><option value="upload">{label('localToRemote', 'Local → remote')}</option><option value="download">{label('remoteToLocal', 'Remote → local')}</option></select></label><label>{label('excludePatterns', 'Exclude patterns (one per line)')}<textarea value={exclude} onChange={(e) => setExclude(e.target.value)} /></label></div><label className="sync-delete"><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />{label('deleteExtra', 'Delete extra destination files after copies succeed')}</label></fieldset><p className="note">{label('syncNote', 'Preview compares file size and modification time. Symbolic links are skipped. If files change, a new preview is required. Directories are not recursively deleted.')}</p>{error && <p role="alert" className="monitor-error">{error}</p>}{plan && <><p>{plan.changes.length} {label('changes', 'changes')} · {plan.unchanged} {label('unchanged', 'unchanged')} · {plan.skipped.length} {label('skipped', 'skipped')}</p><div className="workcenter-table" style={{ maxHeight: 260, overflowY: 'auto' }}><table><thead><tr><th>{label('action', 'Action')}</th><th>{label('path', 'Path')}</th><th>{label('size', 'Size')}</th></tr></thead><tbody>{plan.changes.map((change: import('../types').SyncChange) => <tr key={change.path}><td style={{ color: change.action === 'delete' ? 'var(--crit)' : undefined }}>{label(change.action, change.action)}</td><td className="mono">{change.path}</td><td>{change.size}</td></tr>)}</tbody></table></div>{plan.skipped.length > 0 && <details><summary>{label('skipped', 'Skipped')}</summary><pre>{plan.skipped.join('\n')}</pre></details>}</>}{run && <p role="status">{label('syncStatus', 'Sync status')}: {label(run.status, run.status)} · {run.taskIds.length} {label('transfers', 'transfers')} · {run.deleted} {label('deleted', 'deleted')} {run.error}</p>}</div><div className="foot"><button className="btn" onClick={onClose} disabled={busy}>{t('settings.close')}</button><button className="btn" disabled={busy} onClick={() => void preview()}>{label('preview', 'Preview')}</button><button className="btn primary" disabled={busy || !plan || !plan.changes.length} onClick={() => void apply()}>{label('applySync', 'Apply this preview')}</button></div></div></div>;
}
