import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { api } from '../api';
import { useStore } from '../state';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../format';

const EDIT_MAX = 1024 * 1024; // 超过 1MB 的文件只读

// 远程文本查看/编辑：默认读开头，大文件可切换“最后 500 行”；小文件可编辑保存回传
export function TextViewer({
  serverId,
  path: rp,
  name,
  size,
  onClose,
}: {
  serverId: string;
  path: string;
  name: string;
  size?: number;
  onClose: () => void;
}) {
  const { pushToast } = useStore();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [tail, setTail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const requestClose = () => { if (dirty || saving) setErr(t('textViewer.unsavedNote')); else onClose(); };
  useDialogFocus(true, ref, requestClose);
  useEffect(() => {
    const blocked = () => setErr(t('textViewer.unsavedNote'));
    window.addEventListener('sc:blocked-navigation', blocked);
    return () => window.removeEventListener('sc:blocked-navigation', blocked);
  }, [t]);

  const editable = !tail && (size ?? 0) <= EDIT_MAX;

  const load = (readTail: boolean) => {
    if (!api) return;
    const request = ++revision.current;
    setLoading(true);
    setErr('');
    setDirty(false);
    api.sftpReadText(serverId, rp, readTail).then((r) => {
      if (request !== revision.current) return;
      setLoading(false);
      if (r.ok && r.data) {
        setText(r.data.text);
        setSaved(r.data.text);
      } else setErr(r.error || t('textViewer.readFail'));
    });
  };

  useEffect(() => {
    const requests = revision;
    load(false);
    return () => { requests.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp, serverId]);

  const save = async () => {
    if (!api) return;
    const request = revision.current;
    setSaving(true);
    const r = await api.sftpWriteText(serverId, rp, text);
    if (request !== revision.current) return;
    setSaving(false);
    if (r.ok) {
      setSaved(text);
      setDirty(false);
      pushToast({ level: 'info', title: t('textViewer.savedToast'), detail: rp });
    } else {
      pushToast({ level: 'error', title: t('textViewer.saveFail'), detail: r.error });
    }
  };

  return (
    <div className="mask" onClick={requestClose}>
      <div className="dialog viewer-dlg" ref={ref} data-unsaved={dirty || saving ? 'true' : undefined} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} style={{ width: 820 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {size != null && <span className="tag">{formatBytes(size)}</span>}
          {dirty && <span className="tag" style={{ color: 'var(--warn)' }}>{t('textViewer.unsaved')}</span>}
          <span style={{ flex: 1 }} />
          <div className="seg">
            <button className={!tail ? 'on' : ''} disabled={saving} onClick={() => { if (dirty && !window.confirm(t('textViewer.discardConfirm'))) return; setTail(false); load(false); }}>
              {t('textViewer.head')}
            </button>
            <button className={tail ? 'on' : ''} disabled={saving} onClick={() => { if (dirty && !window.confirm(t('textViewer.discardConfirm'))) return; setTail(true); load(true); }}>
              {t('textViewer.last500')}
            </button>
          </div>
        </h3>
        <div className="viewer-body">
          {loading ? (
            <div className="empty">{t('textViewer.reading')}</div>
          ) : err && !dirty ? (
            <div className="empty" style={{ color: 'var(--crit)' }}>{err}</div>
          ) : editable ? (
            <textarea
              className="mono viewer-edit"
              aria-label={name}
              value={text}
              readOnly={saving}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(e.target.value !== saved);
              }}
              spellCheck={false}
            />
          ) : (
            <pre className="mono">{text}</pre>
          )}
        </div>
        {err && dirty && <div role="alert" className="body" style={{ color: 'var(--warn)' }}>{err}</div>}
        <div className="foot">
          {editable && (
            <button className="btn primary" disabled={!dirty || saving} onClick={save}>
              {saving ? t('textViewer.saving') : dirty ? t('textViewer.saveToServer') : t('textViewer.saved')}
            </button>
          )}
          <button className="btn" onClick={() => navigator.clipboard?.writeText(text)}>
            {t('textViewer.copyAll')}
          </button>
          <button className="btn" onClick={requestClose}>
            {t('textViewer.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
