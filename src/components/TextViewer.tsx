import { useEffect, useState } from 'react';
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

  const editable = !tail && (size ?? 0) <= EDIT_MAX;

  const load = (t: boolean) => {
    if (!api) return;
    setLoading(true);
    setErr('');
    setDirty(false);
    api.sftpReadText(serverId, rp, t).then((r) => {
      setLoading(false);
      if (r.ok && r.data) {
        setText(r.data.text);
        setSaved(r.data.text);
      } else setErr(r.error || '读取失败');
    });
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp]);

  const save = async () => {
    if (!api) return;
    setSaving(true);
    const r = await api.sftpWriteText(serverId, rp, text);
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
    <div className="mask" onClick={() => (dirty ? setErr('内容已修改，请先保存或刷新放弃') : onClose())}>
      <div className="dialog viewer-dlg" style={{ width: 820 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {size != null && <span className="tag">{formatBytes(size)}</span>}
          {dirty && <span className="tag" style={{ color: 'var(--warn)' }}>未保存</span>}
          <span style={{ flex: 1 }} />
          <div className="seg">
            <button className={!tail ? 'on' : ''} onClick={() => { setTail(false); load(false); }}>
              {t('textViewer.head')}
            </button>
            <button className={tail ? 'on' : ''} onClick={() => { setTail(true); load(true); }}>
              {t('textViewer.last500')}
            </button>
          </div>
        </h3>
        <div className="viewer-body">
          {loading ? (
            <div className="empty">{t('textViewer.reading')}</div>
          ) : err ? (
            <div className="empty" style={{ color: 'var(--crit)' }}>{err}</div>
          ) : editable ? (
            <textarea
              className="mono viewer-edit"
              value={text}
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
        <div className="foot">
          {editable && (
            <button className="btn primary" disabled={!dirty || saving} onClick={save}>
              {saving ? t('textViewer.saving') : dirty ? t('textViewer.saveToServer') : t('textViewer.saved')}
            </button>
          )}
          <button className="btn" onClick={() => navigator.clipboard?.writeText(text)}>
            {t('textViewer.copyAll')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('textViewer.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
