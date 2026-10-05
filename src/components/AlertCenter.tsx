import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state';
import { useDialogFocus } from '../hooks/useDialogFocus';

export function AlertCenter({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { alertRecords, demo } = useStore();
  const { t } = useTranslation();
  const [activeOnly, setActiveOnly] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  const records = alertRecords.filter((item) => !activeOnly || !item.resolvedAt);
  return <div className="mask" onClick={onClose}><div className="dialog alert-center" role="dialog" aria-modal="true" aria-labelledby="alerts-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
    <h3 id="alerts-title">{t('workbench.alerts')}<button className="btn mini" onClick={onClose}>{t('settings.close')}</button></h3>
    <p className="dim">{t(demo ? 'workbench.demoAlerts' : 'workbench.alertSession')}</p>
    <div className="seg"><button className={activeOnly ? 'on' : ''} onClick={() => setActiveOnly(true)}>{t('workbench.active')}</button><button className={!activeOnly ? 'on' : ''} onClick={() => setActiveOnly(false)}>{t('workbench.allAlerts')}</button></div>
    {!records.length && <div className="empty">{t('workbench.noAlerts')}</div>}
    <div className="alert-list">{records.map((item) => <article className="alert-record" key={item.id}><span className={`dot ${item.resolvedAt ? 'online' : 'timeout'}`} /><div><strong>{t(`workbench.alert_${item.type}`)} · {item.serverName}</strong><p>{new Date(item.createdAt).toLocaleString()} · {t(item.resolvedAt ? 'workbench.resolved' : 'workbench.active')}</p></div><button className="btn mini" onClick={() => { onClose(); onOpen(item.serverId); }}>{t('workbench.inspect')}</button></article>)}</div>
  </div></div>;
}
