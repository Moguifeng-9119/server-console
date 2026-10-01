import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUp, CheckSquare, File as FileIcon, Folder, FolderPlus, Home, RefreshCw, Square } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../state';
import { useTransfers } from '../transfers';
import { formatBytes, fmtDate, joinPosix, parentPosix } from '../format';
import type { FileEntry } from '../types';

const isDirLike = (e: FileEntry) => e.type === 'dir' || e.linkToDir;

// 目录在前、名称升序
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    const ad = isDirLike(a) ? 1 : 0;
    const bd = isDirLike(b) ? 1 : 0;
    if (bd !== ad) return bd - ad;
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
}

/**
 * 远程目录浏览器：source 模式可勾选（文件/文件夹都行），dest 模式只浏览、
 * 当前所在目录即落点，并支持新建文件夹。
 */
function RemoteBrowser({
  serverId,
  initialCwd,
  mode,
  checked,
  onToggle,
  onCwdChange,
}: {
  serverId: string;
  initialCwd?: string;
  mode: 'source' | 'dest';
  checked: Record<string, FileEntry>;
  onToggle: (e: FileEntry, abs: string) => void;
  onCwdChange: (cwd: string) => void;
}) {
  const { pushToast } = useStore();
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [addr, setAddr] = useState('');
  const [mkName, setMkName] = useState('');

  const load = async (dir?: string) => {
    if (!serverId || !api) return;
    setLoading(true);
    setErr('');
    const target = dir ?? cwd;
    const r = await api.sftpList(serverId, target || undefined);
    setLoading(false);
    if (r.ok && r.data) {
      setCwd(r.data.path);
      setAddr(r.data.path);
      setEntries(sortEntries(r.data.entries));
      if (mode === 'dest') onCwdChange(r.data.path);
    } else {
      setErr(r.error || '读取目录失败');
    }
  };

  // 首次 / 切换服务器：优先 initialCwd，否则家目录
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!serverId || !api) return;
      let start = initialCwd;
      if (!start) {
        const h = await api.sftpHome(serverId);
        if (alive && h.ok && h.data) start = h.data;
      }
      if (alive) load(start);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => setAddr(cwd), [cwd]);

  const goHome = () => api && api.sftpHome(serverId).then((r) => { if (r.ok && r.data) load(r.data); });
  const goUp = () => cwd && cwd !== '/' && load(parentPosix(cwd));
  const enter = (e: FileEntry) => {
    if (isDirLike(e)) load(joinPosix(cwd, e.name));
  };

  const doMkdir = async () => {
    const name = mkName.trim();
    if (!name || !api) return;
    const r = await api.sftpMkdir(serverId, joinPosix(cwd, name));
    if (r.ok) {
      setMkName('');
      load();
    } else {
      pushToast({ level: 'error', title: '新建文件夹失败', detail: r.error });
    }
  };

  if (!serverId) {
    return <div className="rb-empty">请先在右侧选择目标服务器</div>;
  }

  return (
    <div className="rb">
      <div className="rb-bar">
        <button className="btn mini" title="家目录" onClick={goHome}><Home size={13} /></button>
        <button className="btn mini" title="上一级" onClick={goUp}><ArrowUp size={13} /></button>
        <button className="btn mini" title="刷新" onClick={() => load()}><RefreshCw size={13} /></button>
        <button className="btn mini" title="在当前目录新建文件夹" onClick={() => setMkName((v) => (v ? '' : '新建文件夹'))}><FolderPlus size={13} /></button>
        <input
          className="mini mono rb-addr"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(addr)}
          title="回车跳转"
        />
      </div>
      {mkName && (
        <div className="rb-mk">
          <input
            className="mini mono"
            autoFocus
            value={mkName}
            onChange={(e) => setMkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doMkdir();
              if (e.key === 'Escape') setMkName('');
            }}
            placeholder="新文件夹名，回车确认"
          />
          <button className="btn mini primary" onClick={doMkdir}>确定</button>
          <button className="btn mini" onClick={() => setMkName('')}>取消</button>
        </div>
      )}
      <div className="rb-list">
        {loading && <div className="empty">加载中…</div>}
        {!loading && err && <div className="empty" style={{ color: 'var(--crit)' }}>{err}</div>}
        {!loading && !err && entries.length === 0 && <div className="empty">（空目录）</div>}
        {!loading &&
          !err &&
          entries.map((e) => {
            const abs = joinPosix(cwd, e.name);
            const isSel = !!checked[abs];
            const dir = isDirLike(e);
            return (
              <div
                key={abs}
                className={`rb-row ${mode === 'source' && isSel ? 'sel' : ''} ${mode === 'dest' ? 'dest' : ''}`}
                onClick={() => {
                  if (mode === 'source') onToggle(e, abs);
                  else enter(e);
                }}
                onDoubleClick={() => enter(e)}
                title={dir ? '双击进入目录' : mode === 'source' ? '勾选以传输' : '目标为当前所在目录'}
              >
                {mode === 'source' && (
                  <span className="rb-check">
                    {isSel ? <CheckSquare size={13} strokeWidth={1.8} /> : <Square size={13} strokeWidth={1.8} />}
                  </span>
                )}
                <span className={`rb-ic ${dir ? 'dir' : 'file'}`}>
                  {dir ? <Folder size={14} strokeWidth={1.8} /> : <FileIcon size={14} strokeWidth={1.8} />}
                </span>
                <span className="rb-name">{e.name}</span>
                <span className="rb-size">{dir ? '—' : formatBytes(e.size)}</span>
                <span className="rb-time mono">{fmtDate(e.mtime)}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function RelayDialog({
  selfId,
  selfName,
  sel,
  onClose,
  onDone,
}: {
  selfId: string;
  selfName: string;
  sel: FileEntry[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { configs, servers, pushToast } = useStore();
  const tf = useTransfers();
  const statusOf = (id: string) => servers.find((s) => s.id === id)?.status ?? 'offline';
  const targets = configs.filter((c) => c.id !== selfId);
  const firstOnline = targets.find((c) => statusOf(c.id) === 'online')?.id;
  const [dstId, setDstId] = useState(firstOnline || targets[0]?.id || '');
  const [checked, setChecked] = useState<Record<string, FileEntry>>(() =>
    Object.fromEntries(sel.filter((e) => e.path).map((e) => [e.path as string, e])),
  );
  const [dstCwd, setDstCwd] = useState('');
  const [busy, setBusy] = useState(false);

  const dst = configs.find((c) => c.id === dstId);
  const dstOffline = !!dstId && statusOf(dstId) !== 'online';
  const items = Object.values(checked);
  const srcInitial = parentPosix(sel.find((e) => e.path)?.path || '') || undefined;

  const toggle = (e: FileEntry, abs: string) =>
    setChecked((p) => {
      const n = { ...p };
      if (n[abs]) delete n[abs];
      else n[abs] = { ...e, path: abs };
      return n;
    });

  const start = async () => {
    if (!items.length) {
      pushToast({ level: 'warn', title: '请先在左侧勾选要传输的文件/文件夹' });
      return;
    }
    if (!dstId) {
      pushToast({ level: 'warn', title: '请选择目标服务器' });
      return;
    }
    if (dstOffline) {
      pushToast({ level: 'warn', title: `目标「${dst?.name}」当前不在线` });
      return;
    }
    if (!dstCwd) {
      pushToast({ level: 'warn', title: '目标目录尚未加载完成，请稍候' });
      return;
    }
    setBusy(true);
    try {
      await tf.relay(selfId, dstId, items, dstCwd, selfName, dst?.name);
      pushToast({ level: 'info', title: `已加入互传队列：→ ${dst?.name}`, detail: `${items.length} 项 → ${dstCwd}` });
      onDone();
    } catch (e) {
      pushToast({ level: 'error', title: '互传失败', detail: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog relay-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>服务器互传（左侧勾选内容，右侧选择落到哪个目录）</h3>
        <div className="body dim" style={{ marginBottom: 8, fontSize: 12 }}>
          数据经本机内存中继、不在本机落盘；两台服务器都需在线。单击勾选/选择，双击目录进入。
        </div>
        <div className="relay-dual">
          <div className="relay-col">
            <div className="relay-col-head">
              <span className="relay-tag">源</span>
              <b>{selfName}</b>
              <span className="relay-count">已选 {items.length} 项</span>
            </div>
            <RemoteBrowser
              serverId={selfId}
              initialCwd={srcInitial}
              mode="source"
              checked={checked}
              onToggle={toggle}
              onCwdChange={() => {}}
            />
          </div>
          <div className="relay-mid"><ArrowRight size={18} strokeWidth={2} /></div>
          <div className="relay-col">
            <div className="relay-col-head">
              <span className="relay-tag">目标</span>
              <select
                className="mini"
                value={dstId}
                onChange={(e) => {
                  setDstId(e.target.value);
                  setDstCwd('');
                }}
              >
                {targets.map((c) => (
                  <option key={c.id} value={c.id} disabled={statusOf(c.id) !== 'online'}>
                    {c.name}（{c.username}@{c.host}）{statusOf(c.id) === 'online' ? '' : '· 离线'}
                  </option>
                ))}
              </select>
            </div>
            <RemoteBrowser
              key={dstId}
              serverId={dstOffline ? '' : dstId}
              mode="dest"
              checked={{}}
              onToggle={() => {}}
              onCwdChange={setDstCwd}
            />
            <div className="relay-dest">将传到：<b className="mono">{dstCwd || '加载中…'}</b></div>
          </div>
        </div>
        <div className="foot">
          <button
            className="btn primary"
            disabled={busy || !dstId || dstOffline || items.length === 0 || !dstCwd}
            onClick={start}
          >
            {busy ? '加入中…' : `开始互传（${items.length} 项）`}
          </button>
          <button className="btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
