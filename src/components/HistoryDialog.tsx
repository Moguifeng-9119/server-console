import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Server } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { HistoryPanel } from './HistoryPanel';

export function HistoryDialog({ s, onClose }: { s: Server | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(!!s, ref, onClose);
  if (!s) return null;
  return <div className="mask" onClick={onClose}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="history-title" className="dialog history-dialog" onClick={(e) => e.stopPropagation()}>
    <h3 id="history-title">{t('history.title', { name: s.name })}<button className="btn mini" onClick={onClose}>{t('history.close')}</button></h3>
    <HistoryPanel key={s.id} s={s} />
  </div></div>;
}
