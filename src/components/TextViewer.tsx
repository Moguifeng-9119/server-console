import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatBytes } from '../format';

// 远程文本只读查看：默认读开头，大文件可切换“最后 500 行”
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
  const [text, setText] = useState('');
  const [tail, setTail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = (t: boolean) => {
    if (!api) return;
    setLoading(true);
    setErr('');
    api.sftpReadText(serverId, rp, t).then((r) => {
      setLoading(false);
      if (r.ok && r.data) setText(r.data.text);
      else setErr(r.error || '读取失败');
    });
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp]);

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog viewer-dlg" style={{ width: 820 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {size != null && <span className="tag">{formatBytes(size)}</span>}
          <span style={{ flex: 1 }} />
          <div className="seg">
            <button className={!tail ? 'on' : ''} onClick={() => { setTail(false); load(false); }}>
              开头
            </button>
            <button className={tail ? 'on' : ''} onClick={() => { setTail(true); load(true); }}>
              最后 500 行
            </button>
          </div>
        </h3>
        <div className="viewer-body">
          {loading ? <div className="empty">读取中…</div> : err ? <div className="empty" style={{ color: 'var(--crit)' }}>{err}</div> : <pre className="mono">{text}</pre>}
        </div>
        <div className="foot">
          <button className="btn" onClick={() => navigator.clipboard?.writeText(text)}>
            复制全部
          </button>
          <button className="btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
