import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, File as FileIcon, Folder, FolderPlus, Home, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useStoreControls } from '../state';
import { useTransferCommands } from '../transfers';
import { fmtDate, formatBytes, joinPosix, parentPosix } from '../format';
import type { DirListing, FileEntry, IpcResult } from '../types';
import { ContextMenu } from './ContextMenu';
import { TextViewer } from './TextViewer';
import { RelayDialog } from './ServerRelay';

interface PaneState {
  cwd: string;
  entries: FileEntry[];
  loading: boolean;
  err: string;
  selected: Record<string, boolean>;
}

const emptyPane = (cwd = ''): PaneState => ({ cwd, entries: [], loading: false, err: '', selected: {} });
const isDirLike = (e: FileEntry) => e.type === 'dir' || e.linkToDir;

type SortKey = 'name' | 'size' | 'mtime';
const fileNames = new Intl.Collator('zh-Hans-CN', { numeric: true });

function FileManagerImpl({ serverId, active = true }: { serverId: string; active?: boolean }) {
  const { t } = useTranslation();
  const { configs, pushToast } = useStoreControls();
  const tf = useTransferCommands();
  const cfg = configs.find((c) => c.id === serverId);

  const [local, setLocal] = useState<PaneState>(emptyPane());
  const [remote, setRemote] = useState<PaneState>(emptyPane());
  const [localSort, setLocalSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'name', asc: true });
  const [remoteSort, setRemoteSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'name', asc: true });
  const [dragOver, setDragOver] = useState(false);

  // 双面板拖拽分割（范围 20% - 80%，默认 50%）
  const panesRef = useRef<HTMLDivElement | null>(null);
  const [paneSplit, setPaneSplit] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('sc.fm.split'));
      return Number.isFinite(saved) && saved >= 20 && saved <= 80 ? saved : 50;
    } catch {
      return 50;
    }
  });

  const onPaneSplitResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = panesRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const pct = Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100));
      setPaneSplit(pct);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalPct = Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100));
      localStorage.setItem('sc.fm.split', String(Math.round(finalPct)));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [ask, setAsk] = useState<{ title: string; label: string; value: string; onOk: (v: string) => void } | null>(null);
  const [askValue, setAskValue] = useState('');
  const openAsk = (a: { title: string; label: string; value: string; onOk: (v: string) => void }) => {
    setAskValue(a.value); // 受控初值；避免 value={askValue || a.value} 导致清空输入时弹回原值
    setAsk(a);
  };
  const submitAsk = () => {
    if (!ask) return;
    const v = askValue.trim();
    if (!v) return;
    ask.onOk(v);
    setAsk(null);
    setAskValue('');
  };
  const [confirm, setConfirm] = useState<{ title: string; body: string; onOk: () => void } | null>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  useDialogFocus(active && !!ask, askRef, () => setAsk(null));
  useDialogFocus(active && !!confirm, confirmRef, () => setConfirm(null));

  const [searchKw, setSearchKw] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [viewer, setViewer] = useState<{ path: string; name: string; size: number } | null>(null);
  const [relay, setRelay] = useState<{ sel: FileEntry[] } | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number; side: 'local' | 'remote'; entry: FileEntry } | null>(null);

  // 初次进入：定位到本地家目录与远程家目录
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    // The remote connection must not delay showing the local directory.
    void api.localHome().then((home) => { if (!disposed) return loadLocal(home); })
      .catch((e) => { if (!disposed) setLocal((p) => ({ ...p, loading: false, err: msg(e) })); });
    void api.sftpHome(serverId).then((hr) => {
      if (disposed) return;
      if (hr.ok && hr.data) return loadRemote(hr.data);
      setRemote((p) => ({ ...p, loading: false, err: hr.error || t('files.sftpUnavailable') }));
    }).catch((e) => { if (!disposed) setRemote((p) => ({ ...p, loading: false, err: msg(e) })); });
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  // ---------- 加载 ----------
  const loadLocal = async (dir?: string) => {
    if (!api) return;
    const target = dir ?? local.cwd;
    setLocal((p) => ({ ...p, loading: true, err: '' }));
    const r: IpcResult<DirListing> = await api.localList(target);
    setLocal((p) =>
      r.ok && r.data
        ? { cwd: r.data.path, entries: r.data.entries, loading: false, err: '', selected: {} }
        : { ...p, loading: false, err: r.error || t('files.readFail') },
    );
  };

  const loadRemote = async (dir?: string) => {
    if (!api) return;
    const target = dir ?? remote.cwd;
    setRemote((p) => ({ ...p, loading: true, err: '' }));
    setResults(null);
    const r = await api.sftpList(serverId, target);
    setRemote((p) =>
      r.ok && r.data
        ? { cwd: r.data.path, entries: r.data.entries, loading: false, err: '', selected: {} }
        : { ...p, loading: false, err: r.error || t('files.readFail') },
    );
  };

  // ---------- 选中 ----------
  // 单击=单选、Ctrl/Cmd=加减选、Shift=从锚点范围选；Esc 清空、Ctrl+A 全选（见下方全局键盘）
  const [anchor, setAnchor] = useState<{ local: string | null; remote: string | null }>({ local: null, remote: null });
  const [lastPane, setLastPane] = useState<'local' | 'remote'>('remote');

  const keyOfSide = (side: 'local' | 'remote', e: FileEntry) => (side === 'local' ? e.path || e.name : e.name);

  const toggleSelect = (side: 'local' | 'remote', key: string, ev: Pick<React.MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    const set = side === 'local' ? setLocal : setRemote;
    setLastPane(side);
    const sorted = side === 'local' ? sortedLocal : sortedRemote;
    if (ev.shiftKey && anchor[side]) {
      const keys = sorted.map((e) => keyOfSide(side, e));
      const i1 = keys.indexOf(anchor[side] as string);
      const i2 = keys.indexOf(key);
      if (i1 >= 0 && i2 >= 0) {
        const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
        set((p) => {
          const next = { ...p.selected };
          for (let i = lo; i <= hi; i++) next[keys[i]] = true;
          return { ...p, selected: next };
        });
        return;
      }
    }
    if (!ev.ctrlKey && !ev.metaKey) {
      set((p) => ({ ...p, selected: { [key]: true } }));
      setAnchor((a) => ({ ...a, [side]: key }));
      return;
    }
    set((p) => {
      const next = { ...p.selected };
      if (next[key]) delete next[key];
      else next[key] = true;
      return { ...p, selected: next };
    });
    setAnchor((a) => ({ ...a, [side]: key }));
  };

  const selectAll = (side: 'local' | 'remote') => {
    const set = side === 'local' ? setLocal : setRemote;
    const sorted = side === 'local' ? sortedLocal : sortedRemote;
    set((p) => ({ ...p, selected: Object.fromEntries(sorted.map((e) => [keyOfSide(side, e), true])) }));
  };
  const clearSelection = (side: 'local' | 'remote') => {
    (side === 'local' ? setLocal : setRemote)((p) => ({ ...p, selected: {} }));
  };

  const remoteFull = (e: FileEntry) => joinPosix(remote.cwd, e.name);
  // 注意：远程选中态的 key 与 FilePane 的 keyOf 保持一致，都用文件名 e.name
  // （历史 bug：这里曾用完整路径 cwd/name 去查，导致勾选永远匹配不上、下载/互传拿到 0 项）
  const selectedRemote = (): FileEntry[] =>
    remote.entries.filter((e) => remote.selected[e.name]).map((e) => ({ ...e, path: remoteFull(e) }));
  const selectedLocal = () => local.entries.filter((e) => e.path && local.selected[e.path]);

  const showTransfers = () => window.dispatchEvent(new CustomEvent('sc:show-transfers'));

  // ---------- 传输 ----------
  const doUpload = async (localPaths: string[]) => {
    if (!localPaths.length) {
      pushToast({ level: 'warn', title: t('files.selectUploadWarn') });
      return;
    }
    try {
      const n = await tf.upload(serverId, localPaths, remote.cwd, cfg?.name);
      pushToast({ level: 'info', title: t('files.uploadQueued', { n }), detail: remote.cwd });
      showTransfers();
      setLocal((p) => ({ ...p, selected: {} }));
    } catch (e) {
      pushToast({ level: 'error', title: t('files.uploadFail'), detail: msg(e) });
    }
  };
  const doDownload = async (sel: FileEntry[]) => {
    if (!sel.length) {
      pushToast({ level: 'warn', title: t('files.selectDownloadWarn') });
      return;
    }
    try {
      const n = await tf.download(serverId, sel, local.cwd, cfg?.name);
      pushToast({ level: 'info', title: t('files.downloadQueued', { n }), detail: local.cwd });
      showTransfers();
      setRemote((p) => ({ ...p, selected: {} }));
    } catch (e) {
      pushToast({ level: 'error', title: t('files.downloadFail'), detail: msg(e) });
    }
  };

  // ---------- 远程整理 ----------
  const remoteMkdir = () =>
    openAsk({
      title: t('files.newRemoteDir'), label: t('files.name'), value: '',
      onOk: async (v) => {
        const r = await api?.sftpMkdir(serverId, joinPosix(remote.cwd, v));
        finishAction(r, () => loadRemote());
      },
    });
  const remoteRename = (e: FileEntry) =>
    openAsk({
      title: t('files.rename'), label: t('files.newName'), value: e.name,
      onOk: async (v) => {
        const r = await api?.sftpRename(serverId, remoteFull(e), joinPosix(remote.cwd, v));
        finishAction(r, () => loadRemote());
      },
    });
  const remoteDelete = (sel: FileEntry[]) =>
    setConfirm({
      title: t('files.confirmDeleteTitle', { n: sel.length }),
      body: t('files.confirmDeleteBody', { names: sel.map((s) => s.name).join(', ') }),
      onOk: async () => {
        const fails: string[] = [];
        for (const s of sel) {
          const r = await api?.sftpDelete(serverId, s.path || remoteFull(s));
          if (r && !r.ok) fails.push(`${s.name}${r.error ? '：' + r.error : ''}`);
        }
        loadRemote();
        if (fails.length)
          pushToast({ level: 'error', title: t('files.deleteFail', { n: fails.length }), detail: fails.slice(0, 3).join('\n') });
      },
    });
  const remoteArchive = (sel: FileEntry[]) =>
    openAsk({
      title: t('files.compressTitle'), label: t('files.archiveName'), value: 'archive.tar.gz',
      onOk: async (v) => {
        const name = v.endsWith('.tar.gz') ? v : v + '.tar.gz';
        const r = await api?.sftpArchive(serverId, remote.cwd, sel.map((s) => s.name), name);
        finishAction(r, () => loadRemote());
      },
    });
  const remoteExtract = (e: FileEntry) =>
    setConfirm({
      title: t('files.extractTitle', { name: e.name }), body: t('files.extractBody'),
      onOk: async () => {
        const r = await api?.sftpExtract(serverId, remote.cwd, remoteFull(e));
        finishAction(r, () => loadRemote());
      },
    });

  // ---------- 本地整理 ----------
  const localMkdir = () =>
    openAsk({
      title: t('files.newLocalDir'), label: t('files.name'), value: '',
      onOk: async (v) => {
        const r = await api?.localMkdir(joinLocal(local.cwd, v));
        finishAction(r, () => loadLocal());
      },
    });
  const localDelete = (sel: FileEntry[]) =>
    setConfirm({
      title: t('files.localDeleteTitle', { n: sel.length }), body: sel.map((s) => s.name).join('、'),
      onOk: async () => {
        const fails: string[] = [];
        for (const s of sel) {
          if (!s.path) continue;
          const r = await api?.localDelete(s.path);
          if (r && !r.ok) fails.push(`${s.name}${r.error ? '：' + r.error : ''}`);
        }
        loadLocal();
        if (fails.length)
          pushToast({ level: 'error', title: t('files.deleteFail', { n: fails.length }), detail: fails.slice(0, 3).join('\n') });
      },
    });

  const finishAction = (r: { ok: boolean; error?: string } | undefined, reload: () => void) => {
    if (r && !r.ok) pushToast({ level: 'error', title: t('files.opFail'), detail: r.error });
    else reload();
  };

  const runSearch = async () => {
    if (!searchKw.trim() || !api) return;
    setSearching(true);
    const r = await api.sftpSearch(serverId, remote.cwd, searchKw.trim());
    setSearching(false);
    if (r.ok && r.data) setResults(r.data.paths);
    else pushToast({ level: 'error', title: t('files.searchFail'), detail: r.error });
  };

  const remoteChmod = (e: FileEntry) => {
    const curOctal = e.mode ? (e.mode & 0o777).toString(8) : isDirLike(e) ? '755' : '644';
    openAsk({
      title: t('files.chmodTitle', { name: e.name }),
      label: t('files.chmodLabel'),
      value: curOctal,
      onOk: async (v) => {
        const mode = parseInt(v.trim(), 8);
        if (Number.isNaN(mode)) {
          pushToast({ level: 'error', title: t('files.invalidMode'), detail: t('files.invalidModeDetail') });
          return;
        }
        const r = await api?.sftpChmod(serverId, remoteFull(e), mode);
        finishAction(r, () => loadRemote());
      },
    });
  };

  // 全局文件面板快捷键：Ctrl+A 全选、Esc 清空、Delete 删除、F2 重命名、F5 刷新
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (results || ask || confirm || viewer || relay || menu) return;
      if (!(e.target instanceof HTMLElement) || !e.target.closest('.fm') || e.target.closest('[role="dialog"], [aria-modal="true"]')) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll(lastPane);
      } else if (e.key === 'Escape') {
        clearSelection(lastPane);
      } else if (e.key === 'F5') {
        e.preventDefault();
        if (lastPane === 'remote') loadRemote();
        else loadLocal();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (lastPane === 'remote') {
          const sel = selectedRemote();
          if (sel.length) remoteDelete(sel);
        } else {
          const sel = selectedLocal();
          if (sel.length) localDelete(sel);
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (lastPane === 'remote') {
          const sel = selectedRemote();
          if (sel.length === 1) remoteRename(sel[0]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 拖拽上传（Electron 32+ 经 webUtils.getPathForFile 取本地路径）
  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDragOver(false);
    const paths = Array.from(ev.dataTransfer.files)
      .map((f) => (api?.pathForFile ? api.pathForFile(f) : (f as File & { path?: string }).path) || '')
      .filter(Boolean);
    if (paths.length) doUpload(paths);
  };

  const openEntry = (side: 'local' | 'remote', e: FileEntry) => {
    if (isDirLike(e)) {
      if (side === 'local' && e.path) loadLocal(e.path);
      else loadRemote(joinPosix(remote.cwd, e.name));
      return;
    }
    if (side === 'remote') {
      // 双击文件：文本尝试在线查看
      api?.sftpReadText(serverId, remoteFull(e), false).then((r) => {
        if (r.ok) setViewer({ path: remoteFull(e), name: e.name, size: e.size });
        else pushToast({ level: 'warn', title: t('files.textUnavailable'), detail: r.error });
      });
    }
  };

  const sortedLocal = useMemo(() => sortEntries(local.entries, localSort), [local.entries, localSort]);
  const sortedRemote = useMemo(() => sortEntries(remote.entries, remoteSort), [remote.entries, remoteSort]);

  return (
    <div className="fm">
      <div className="fm-toolbar">
        <input
          className="mini"
          placeholder={t('files.searchPh')}
          value={searchKw}
          onChange={(e) => setSearchKw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button className="btn" disabled={searching} onClick={runSearch}>
          {t('files.searchBtn')}
        </button>
        {results && (
          <button
            className="btn"
            onClick={() => {
              setResults(null);
              loadRemote();
            }}
          >
            {t('files.backToList')}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={remoteMkdir}>
          {t('files.newRemoteDir')}
        </button>
        <button
          className="btn"
          onClick={() => {
            const sel = selectedRemote();
            if (!sel.length) {
              pushToast({ level: 'warn', title: t('files.selectRelayWarn') });
              return;
            }
            setRelay({ sel });
          }}
        >
          {t('files.relayBtn')} <ArrowLeftRight size={13} style={{ verticalAlign: '-2px' }} />
        </button>
      </div>

      {results ? (
        <div className="fm-search">
          <div className="body" style={{ padding: 6 }}>
            {t('files.found', { n: results.length })}
          </div>
          {results.map((p) => (
            <div
              key={p}
              className="fm-search-row mono"
              onClick={() => {
                setResults(null);
                loadRemote(parentPosix(p));
              }}
            >
              {p}
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={panesRef}
          className="fm-panes"
          style={{ gridTemplateColumns: `${paneSplit}fr 96px ${100 - paneSplit}fr` }}
        >
          <FilePane
            title={t('files.local')}
            state={local}
            sorted={sortedLocal}
            sort={localSort}
            setSort={setLocalSort}
            onUp={() => loadLocal(parentLocal(local.cwd))}
            onHome={() => api?.localHome().then(loadLocal)}
            onReload={() => loadLocal()}
            onAddress={(v) => loadLocal(v)}
            onOpen={(e) => openEntry('local', e)}
            onToggle={(k, ev) => toggleSelect('local', k, ev)}
            onMenu={(x, y, e) => setMenu({ x, y, side: 'local', entry: e })}
            onMkdir={localMkdir}
          />

          <div className="fm-arrows">
            <div
              className="fm-split-handle"
              role="separator" tabIndex={0} aria-orientation="vertical"
              aria-label={t('files.splitHint')} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(paneSplit)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 50 : Math.max(20, Math.min(80, paneSplit + (event.key === 'ArrowRight' ? 5 : -5)));
                setPaneSplit(next); localStorage.setItem('sc.fm.split', String(next));
              }}
              title={t('files.splitHint')}
              onMouseDown={onPaneSplitResize}
              onDoubleClick={() => {
                setPaneSplit(50);
                localStorage.setItem('sc.fm.split', '50');
              }}
            />
            <button className="btn primary" title={t('files.uploadTitle')} onClick={() => doUpload(selectedLocal().map((e) => e.path || ''))}>
              {t('files.upload')} <ArrowRight size={13} />
            </button>
            <button className="btn primary" title={t('files.downloadTitle')} onClick={() => doDownload(selectedRemote())}>
              <ArrowLeft size={13} /> {t('files.download')}
            </button>
          </div>

          <div
            className={`fm-pane-wrap ${dragOver ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <FilePane
              title={t('files.remote', { name: cfg?.name ?? '' })}
              state={remote}
              sorted={sortedRemote}
              sort={remoteSort}
              setSort={setRemoteSort}
              onUp={() => loadRemote(parentPosix(remote.cwd))}
              onHome={() => {
                api?.sftpHome(serverId).then((r) => {
                  if (r.ok && r.data) loadRemote(r.data);
                });
              }}
              onReload={() => loadRemote()}
              onAddress={(v) => loadRemote(v)}
              onOpen={(e) => openEntry('remote', e)}
              onToggle={(k, ev) => toggleSelect('remote', k, ev)}
              onMenu={(x, y, e) => setMenu({ x, y, side: 'remote', entry: e })}
              onMkdir={remoteMkdir}
              remote
            />
            {dragOver && <div className="fm-drop-hint">{t('files.dragHint', { dir: remote.cwd })}</div>}
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {active && menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.side === 'remote' ? (
            <>
              <div className="hdr">{menu.entry.name}</div>
              <button onClick={() => { doDownload([{ ...menu.entry, path: remoteFull(menu.entry) }]); setMenu(null); }}>
                {isDirLike(menu.entry) ? t('files.downloadFolder') : t('files.downloadHere')}
              </button>
              {!isDirLike(menu.entry) && (
                <button onClick={() => { setViewer({ path: remoteFull(menu.entry), name: menu.entry.name, size: menu.entry.size }); setMenu(null); }}>
                  {t('files.viewText')}
                </button>
              )}
              <button onClick={() => { remoteRename(menu.entry); setMenu(null); }}>{t('files.rename')}</button>
              <button onClick={() => { remoteChmod(menu.entry); setMenu(null); }}>{t('files.chmod')}</button>
              <button onClick={() => { remoteArchive([menu.entry]); setMenu(null); }}>{t('files.compressTitle')}</button>
              {/\.(tar|tgz|zip)/i.test(menu.entry.name) && (
                <button onClick={() => { remoteExtract(menu.entry); setMenu(null); }}>{t('files.extract')}</button>
              )}
              <button onClick={() => { setRelay({ sel: [{ ...menu.entry, path: remoteFull(menu.entry) }] }); setMenu(null); }}>
                {t('files.sendToServer')}
              </button>
              <div className="sep" />
              <button className="danger" onClick={() => { remoteDelete([{ ...menu.entry, path: remoteFull(menu.entry) }]); setMenu(null); }}>{t('files.delete')}</button>
            </>
          ) : (
            <>
              <div className="hdr">{menu.entry.name}</div>
              <button onClick={() => { doUpload([menu.entry.path || '']); setMenu(null); }}>
                {isDirLike(menu.entry) ? t('files.uploadFolder') : t('files.uploadHere')}
              </button>
              <div className="sep" />
              <button className="danger" onClick={() => { localDelete([menu.entry]); setMenu(null); }}>{t('files.delete')}</button>
            </>
          )}
        </ContextMenu>
      )}

      {/* 输入对话框 */}
      {active && ask && (
        <div className="mask" onClick={() => setAsk(null)}>
          <div className="dialog" ref={askRef} role="dialog" aria-modal="true" aria-labelledby="fm-ask-title" tabIndex={-1} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="fm-ask-title">{ask.title}</h3>
            <div className="field">
              <label htmlFor="fm-ask-input">{ask.label}</label>
              <input
                className="mini"
                id="fm-ask-input"
                style={{ width: '100%' }}
                autoFocus
                value={askValue}
                onChange={(e) => setAskValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAsk()}
              />
            </div>
            <div className="foot">
              <button className="btn primary" onClick={submitAsk}>
                {t('files.ok')}
              </button>
              <button className="btn" onClick={() => setAsk(null)}>
                {t('files.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认对话框 */}
      {active && confirm && (
        <div className="mask" onClick={() => setConfirm(null)}>
          <div className="dialog" ref={confirmRef} role="dialog" aria-modal="true" aria-labelledby="fm-confirm-title" tabIndex={-1} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="fm-confirm-title" style={{ color: 'var(--warn)' }}>{confirm.title}</h3>
            <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
              {confirm.body}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirm(null)}>
                {t('files.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  confirm.onOk();
                  setConfirm(null);
                }}
              >{t('files.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {active && viewer && <TextViewer serverId={serverId} path={viewer.path} name={viewer.name} size={viewer.size} onClose={() => setViewer(null)} />}

      {active && relay && <RelayDialog selfId={serverId} selfName={cfg?.name || ''} sel={relay.sel} onClose={() => setRelay(null)} onDone={() => { setRelay(null); showTransfers(); }} />}
    </div>
  );
}

// ---------- 单个面板 ----------
export const FileManager = memo(FileManagerImpl);

// Retain visited file panes and directory state across server/tab navigation.
export function FileWorkspace({ serverIds, activeServerId }: { serverIds: string[]; activeServerId: string | null }) {
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    setVisited((previous) => {
      const next = previous.filter((id) => serverIds.includes(id));
      if (activeServerId && serverIds.includes(activeServerId) && !next.includes(activeServerId)) next.push(activeServerId);
      return next.length === previous.length && next.every((id, i) => id === previous[i]) ? previous : next;
    });
  }, [serverIds, activeServerId]);
  const mounted = activeServerId && !visited.includes(activeServerId) ? [...visited, activeServerId] : visited;
  return <>{mounted.filter((id) => serverIds.includes(id)).map((id) => <div key={id} hidden={id !== activeServerId}><FileManager serverId={id} active={id === activeServerId} /></div>)}</>;
}

function FilePane({
  title, state, sorted, sort, setSort, onUp, onHome, onReload, onAddress, onOpen, onToggle, onMenu, onMkdir, remote: isRemote,
}: {
  title: string;
  state: PaneState;
  sorted: FileEntry[];
  sort: { k: SortKey; asc: boolean };
  setSort: (s: { k: SortKey; asc: boolean }) => void;
  onUp: () => void;
  onHome: () => void;
  onReload: () => void;
  onAddress: (v: string) => void;
  onOpen: (e: FileEntry) => void;
  onToggle: (key: string, ev: Pick<React.MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => void;
  onMenu: (x: number, y: number, e: FileEntry) => void;
  onMkdir: () => void;
  remote?: boolean;
}) {
  const { t } = useTranslation();
  const [addr, setAddr] = useState(state.cwd);
  useEffect(() => setAddr(state.cwd), [state.cwd]);
  const keyOf = (e: FileEntry) => (isRemote ? e.name : e.path || e.name);

  // 大目录渐进渲染：几万行的 DOM 会冻结界面；数据仍是全量（排序/全选不受影响），只截断渲染
  const [renderLimit, setRenderLimit] = useState(500);
  useEffect(() => setRenderLimit(500), [state.cwd]);
  const shown = sorted.slice(0, renderLimit);

  const th = (k: SortKey, label: string) => (
    <th aria-sort={sort.k === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="fm-inline" onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : true })}>{label}{sort.k === k ? (sort.asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );

  return (
    <div className="fm-pane">
      <div className="fm-pane-head">
        <span className="fm-pane-title">{title}</span>
        <button className="btn mini" onClick={onHome} title={t('files.home')}>
          <Home size={13} />
        </button>
        <button className="btn mini" onClick={onUp} title={t('files.up')}>
          <ArrowUp size={13} />
        </button>
        <button className="btn mini" onClick={onReload} title={t('files.reload')}>
          <RefreshCw size={13} />
        </button>
        <button className="btn mini" onClick={onMkdir} title={t('files.mkdir')}>
          <FolderPlus size={13} />
        </button>
      </div>
      <div className="fm-address">
        <input
          className="mini mono"
          aria-label={title}
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddress((e.target as HTMLInputElement).value)}
        />
      </div>
      <div className="fm-table-wrap">
        {state.loading && <div className="empty">{t('files.loading')}</div>}
        {state.err && <div className="empty" style={{ color: 'var(--crit)' }}>{state.err}</div>}
        {!state.loading && !state.err && (
          <table className="fm-table">
            <thead>
              <tr>
                {th('name', t('files.name'))}
                {th('size', t('files.size'))}
                <th>{t('files.perm')}</th>
                {th('mtime', t('files.mtime'))}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const key = keyOf(e);
                const sel = !!state.selected[key];
                return (
                  <tr
                    key={key}
                    className={sel ? 'sel' : ''}
                    onKeyDown={(event) => {
                      if (event.shiftKey && event.key === 'F10') {
                        event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onMenu(rect.left + 24, rect.top + 24, e);
                      }
                    }}
                    onClick={(ev) => onToggle(key, ev)}
                    onDoubleClick={() => onOpen(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      if (!sel) onToggle(key, { ctrlKey: false, metaKey: false, shiftKey: false });
                      onMenu(ev.clientX, ev.clientY, e);
                    }}
                  >
                    <td>
                      <input type="checkbox" checked={sel} aria-label={`${t('transfer.pickTip')} · ${e.name}`} onClick={(event) => event.stopPropagation()} onChange={() => onToggle(key, { ctrlKey: true, metaKey: false, shiftKey: false })} />
                      <span className={`fm-ic ${isDirLike(e) ? 'dir' : 'file'}`}>
                        {isDirLike(e) ? <Folder size={14} strokeWidth={1.8} /> : <FileIcon size={14} strokeWidth={1.8} />}
                      </span>
                      <button className="fm-inline" title={e.name} onClick={(event) => { event.stopPropagation(); onOpen(e); }}>{e.name}</button>
                    </td>
                    <td className="num">{isDirLike(e) ? '—' : formatBytes(e.size)}</td>
                    <td className="mono">{e.rights || ''}</td>
                    <td className="num">{fmtDate(e.mtime)} <button className="fm-inline" aria-label={`${t('workbench.actions')} · ${e.name}`} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); if (!sel) onToggle(key, { ctrlKey: false, metaKey: false, shiftKey: false }); onMenu(rect.left, rect.bottom, e); }}>⋯</button></td>
                  </tr>
                );
              })}
              {sorted.length > renderLimit && (
                <tr className="fm-more">
                  <td colSpan={4}><button className="fm-inline" onClick={() => setRenderLimit((v) => v + 2000)}>{t('files.more', { n: sorted.length - renderLimit })}</button></td>
                </tr>
              )}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    {t('files.emptyDir')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------- 工具 ----------
function sortEntries(entries: FileEntry[], s: { k: SortKey; asc: boolean }): FileEntry[] {
  const arr = [...entries];
  arr.sort((a, b) => {
    const ad = isDirLike(a);
    const bd = isDirLike(b);
    if (ad !== bd) return ad ? -1 : 1;
    let r = 0;
    if (s.k === 'name') r = fileNames.compare(a.name, b.name);
    else if (s.k === 'size') r = a.size - b.size;
    else r = a.mtime - b.mtime;
    return s.asc ? r : -r;
  });
  return arr;
}
function joinLocal(dir: string, name: string): string {
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
  return dir.replace(/[\\/]$/, '') + sep + name;
}
function parentLocal(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  if (parts.length <= 1) return parts[0] ? parts[0] + '\\' : p;
  return parts.join(p.includes('\\') ? '\\' : '/');
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
