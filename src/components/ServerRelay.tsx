import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { ArrowRight, ArrowUp, File as FileIcon, Folder, FolderPlus, Home, RefreshCw } from 'lucide-react';
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
  const { t } = useTranslation();
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
      setErr(r.error || t('relay.readFail'));
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
      pushToast({ level: 'error', title: t('relay.mkdirFail'), detail: r.error });
    }
  };

  if (!serverId) {
    return <div className="rb-empty">{t('relay.offline')}</div>;
  }

  return (
    <div className="rb">
      <div className="rb-bar">
        <button className="btn mini" title={t('relay.goHome')} onClick={goHome}><Home size={13} /></button>
        <button className="btn mini" title={t('relay.goUp')} onClick={goUp}><ArrowUp size={13} /></button>
        <button className="btn mini" title={t('relay.reload')} onClick={() => load()}><RefreshCw size={13} /></button>
        <button className="btn mini" title={t('relay.mkdirHere')} onClick={() => setMkName((v) => (v ? '' : t('relay.newFolderName')))}><FolderPlus size={13} /></button>
        <input
          className="mini mono rb-addr"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(addr)}
          title={t('relay.enterAddress')}
        />
      </div>
      {mkName && (
        <div className="rb-mk">
          <input
            className="mini mono"
            autoFocus
            value={mkName}
            data-escape-local
            onChange={(e) => setMkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doMkdir();
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMkName(''); }
            }}
            placeholder={t('relay.mkPh')}
          />
          <button className="btn mini primary" onClick={doMkdir}>{t('relay.ok')}</button>
          <button className="btn mini" onClick={() => setMkName('')}>{t('relay.cancelMk')}</button>
        </div>
      )}
      <div className="rb-list">
        {loading && <div className="empty">{t('relay.dstLoading')}</div>}
        {!loading && err && <div className="empty" style={{ color: 'var(--crit)' }}>{err}</div>}
        {!loading && !err && entries.length === 0 && <div className="empty">{t('relay.emptyDir')}</div>}
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
                title={dir ? t('relay.dblEnter') : mode === 'source' ? t('relay.clickSelect') : t('relay.dstIsTarget')}
              >
                {mode === 'source' && (
                  <input type="checkbox" checked={isSel} aria-label={e.name} onClick={(event) => event.stopPropagation()} onChange={() => onToggle(e, abs)} />
                )}
                <span className={`rb-ic ${dir ? 'dir' : 'file'}`}>
                  {dir ? <Folder size={14} strokeWidth={1.8} /> : <FileIcon size={14} strokeWidth={1.8} />}
                </span>
                <button className="rb-name fm-inline" onClick={(event) => { event.stopPropagation(); if (dir) enter(e); else if (mode === 'source') onToggle(e, abs); }} disabled={!dir && mode === 'dest'}>{e.name}</button>
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
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
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
  const [ignoreExisting, setIgnoreExisting] = useState(false);

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
      pushToast({ level: 'warn', title: t('relay.selectSourceWarn') });
      return;
    }
    if (!dstId) {
      pushToast({ level: 'warn', title: t('relay.needDst') });
      return;
    }
    if (dstOffline) {
      pushToast({ level: 'warn', title: t('relay.dstOffline', { name: dst?.name }) });
      return;
    }
    if (!dstCwd) {
      pushToast({ level: 'warn', title: t('relay.dstNotLoaded') });
      return;
    }
    setBusy(true);
    try {
      await tf.relay(selfId, dstId, items, dstCwd, selfName, dst?.name, ignoreExisting);
      pushToast({ level: 'info', title: t('relay.queuedToast', { dst: dst?.name }), detail: t('relay.queuedDetail', { n: items.length, dir: dstCwd }) });
      onDone();
    } catch (e) {
      pushToast({ level: 'error', title: t('relay.relayFail'), detail: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog relay-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={t('relay.title')} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>{t('relay.title')}</h3>
        <div className="body dim" style={{ marginBottom: 8, fontSize: 12 }}>
          {t('relay.body')}
        </div>
        <div className="relay-dual">
          <div className="relay-col">
            <div className="relay-col-head">
              <span className="relay-tag">{t('relay.src')}</span>
              <b>{selfName}</b>
              <span className="relay-count">{t('relay.selected', { n: items.length })}</span>
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
              <span className="relay-tag">{t('relay.dst')}</span>
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
                    {c.name}（{c.username}@{c.host}）{statusOf(c.id) === 'online' ? '' : ' · ' + t('overview.offline')}
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
            <div className="relay-dest">{t('relay.destIs')}<b className="mono">{dstCwd || t('relay.dstLoading')}</b></div>
          </div>
        </div>
        <div className="foot">
          <label className="td-chk" style={{ marginRight: 'auto' }} title={t('relay.syncModeTitle')}>
            <input type="checkbox" checked={ignoreExisting} onChange={(e) => setIgnoreExisting(e.target.checked)} />
            {t('relay.syncMode')}
          </label>
          <button
            className="btn primary"
            disabled={busy || !dstId || dstOffline || items.length === 0 || !dstCwd}
            onClick={start}
          >
            {busy ? t('relay.adding') : t('relay.start', { n: items.length })}
          </button>
          <button className="btn" onClick={onClose}>{t('relay.cancelMk')}</button>
        </div>
      </div>
    </div>
  );
}
