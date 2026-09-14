import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../state';
import { useTransfers } from '../transfers';
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

export function FileManager({ serverId }: { serverId: string }) {
  const { configs, pushToast } = useStore();
  const tf = useTransfers();
  const cfg = configs.find((c) => c.id === serverId);

  const [local, setLocal] = useState<PaneState>(emptyPane());
  const [remote, setRemote] = useState<PaneState>(emptyPane());
  const [localSort, setLocalSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'name', asc: true });
  const [remoteSort, setRemoteSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'name', asc: true });
  const [dragOver, setDragOver] = useState(false);

  const [ask, setAsk] = useState<{ title: string; label: string; value: string; onOk: (v: string) => void } | null>(null);
  const [askValue, setAskValue] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: string; onOk: () => void } | null>(null);

  const [searchKw, setSearchKw] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [viewer, setViewer] = useState<{ path: string; name: string; size: number } | null>(null);
  const [relay, setRelay] = useState<{ sel: FileEntry[] } | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number; side: 'local' | 'remote'; entry: FileEntry } | null>(null);

  // 初次进入：定位到本地家目录与远程家目录
  useEffect(() => {
    if (!api) return;
    (async () => {
      const home = await api.localHome();
      await loadLocal(home);
      const hr = await api.sftpHome(serverId);
      if (hr.ok && hr.data) await loadRemote(hr.data);
      else setRemote((p) => ({ ...p, err: hr.error || '无法连接 SFTP' }));
    })();
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
        : { ...p, loading: false, err: r.error || '读取失败' },
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
        : { ...p, loading: false, err: r.error || '读取失败' },
    );
  };

  // ---------- 选中 ----------
  const toggleSelect = (side: 'local' | 'remote', key: string, additive: boolean) => {
    const set = side === 'local' ? setLocal : setRemote;
    set((p) => {
      const next = additive ? { ...p.selected } : {};
      next[key] = additive ? !p.selected[key] : true;
      return { ...p, selected: next };
    });
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
      pushToast({ level: 'warn', title: '请先在左侧本地列表勾选要上传的文件/文件夹' });
      return;
    }
    try {
      const n = await tf.upload(serverId, localPaths, remote.cwd, cfg?.name);
      pushToast({ level: 'info', title: `已加入 ${n} 个上传任务`, detail: remote.cwd });
      showTransfers();
      setLocal((p) => ({ ...p, selected: {} }));
    } catch (e) {
      pushToast({ level: 'error', title: '上传失败', detail: msg(e) });
    }
  };
  const doDownload = async (sel: FileEntry[]) => {
    if (!sel.length) {
      pushToast({ level: 'warn', title: '请先在右侧远程列表勾选要下载的文件/文件夹' });
      return;
    }
    try {
      const n = await tf.download(serverId, sel, local.cwd, cfg?.name);
      pushToast({ level: 'info', title: `已加入 ${n} 个下载任务`, detail: local.cwd });
      showTransfers();
      setRemote((p) => ({ ...p, selected: {} }));
    } catch (e) {
      pushToast({ level: 'error', title: '下载失败', detail: msg(e) });
    }
  };

  // ---------- 远程整理 ----------
  const remoteMkdir = () =>
    setAsk({
      title: '新建远程文件夹', label: '名称', value: '',
      onOk: async (v) => {
        const r = await api?.sftpMkdir(serverId, joinPosix(remote.cwd, v));
        finishAction(r, () => loadRemote());
      },
    });
  const remoteRename = (e: FileEntry) =>
    setAsk({
      title: '重命名', label: '新名称', value: e.name,
      onOk: async (v) => {
        const r = await api?.sftpRename(serverId, remoteFull(e), joinPosix(remote.cwd, v));
        finishAction(r, () => loadRemote());
      },
    });
  const remoteDelete = (sel: FileEntry[]) =>
    setConfirm({
      title: `确认删除 ${sel.length} 项？`,
      body: sel.map((s) => s.name).join('、') + '\n服务器上删除不可恢复。',
      onOk: async () => {
        for (const s of sel) await api?.sftpDelete(serverId, s.path || remoteFull(s));
        loadRemote();
      },
    });
  const remoteArchive = (sel: FileEntry[]) =>
    setAsk({
      title: '压缩为 tar.gz', label: '压缩包名', value: 'archive.tar.gz',
      onOk: async (v) => {
        const name = v.endsWith('.tar.gz') ? v : v + '.tar.gz';
        const r = await api?.sftpArchive(serverId, remote.cwd, sel.map((s) => s.name), name);
        finishAction(r, () => loadRemote());
      },
    });
  const remoteExtract = (e: FileEntry) =>
    setConfirm({
      title: `解压 ${e.name}？`, body: '将在当前目录展开（tar/zip）。',
      onOk: async () => {
        const r = await api?.sftpExtract(serverId, remote.cwd, remoteFull(e));
        finishAction(r, () => loadRemote());
      },
    });

  // ---------- 本地整理 ----------
  const localMkdir = () =>
    setAsk({
      title: '新建本地文件夹', label: '名称', value: '',
      onOk: async (v) => {
        const r = await api?.localMkdir(joinLocal(local.cwd, v));
        finishAction(r, () => loadLocal());
      },
    });
  const localDelete = (sel: FileEntry[]) =>
    setConfirm({
      title: `本地删除 ${sel.length} 项？`, body: sel.map((s) => s.name).join('、'),
      onOk: async () => {
        for (const s of sel) if (s.path) await api?.localDelete(s.path);
        loadLocal();
      },
    });

  const finishAction = (r: { ok: boolean; error?: string } | undefined, reload: () => void) => {
    if (r && !r.ok) pushToast({ level: 'error', title: '操作失败', detail: r.error });
    else reload();
  };

  const runSearch = async () => {
    if (!searchKw.trim() || !api) return;
    setSearching(true);
    const r = await api.sftpSearch(serverId, remote.cwd, searchKw.trim());
    setSearching(false);
    if (r.ok && r.data) setResults(r.data.paths);
    else pushToast({ level: 'error', title: '搜索失败', detail: r.error });
  };

  // 拖拽上传（Electron 31 的 File 带 path）
  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDragOver(false);
    const paths = Array.from(ev.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path || '')
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
        else pushToast({ level: 'warn', title: '无法作为文本查看，可下载后打开', detail: r.error });
      });
    }
  };

  const sortedLocal = sortEntries(local.entries, localSort);
  const sortedRemote = sortEntries(remote.entries, remoteSort);

  return (
    <div className="fm">
      <div className="fm-toolbar">
        <input
          className="mini"
          placeholder="在当前远程目录搜索文件名，回车…"
          value={searchKw}
          onChange={(e) => setSearchKw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button className="btn" disabled={searching} onClick={runSearch}>
          搜索
        </button>
        {results && (
          <button
            className="btn"
            onClick={() => {
              setResults(null);
              loadRemote();
            }}
          >
            返回列表
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={remoteMkdir}>
          新建远程文件夹
        </button>
        <button
          className="btn"
          onClick={() => {
            const sel = selectedRemote();
            if (!sel.length) {
              pushToast({ level: 'warn', title: '请先在右侧远程列表勾选要互传的文件/文件夹' });
              return;
            }
            setRelay({ sel });
          }}
        >
          服务器互传 ⇄
        </button>
      </div>

      {results ? (
        <div className="fm-search">
          <div className="body" style={{ padding: 6 }}>
            找到 {results.length} 条（最多 200）
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
        <div className="fm-panes">
          <FilePane
            title="本机"
            state={local}
            sorted={sortedLocal}
            sort={localSort}
            setSort={setLocalSort}
            onUp={() => loadLocal(parentLocal(local.cwd))}
            onHome={() => api?.localHome().then(loadLocal)}
            onReload={() => loadLocal()}
            onAddress={(v) => loadLocal(v)}
            onOpen={(e) => openEntry('local', e)}
            onToggle={(k, add) => toggleSelect('local', k, add)}
            onMenu={(x, y, e) => setMenu({ x, y, side: 'local', entry: e })}
            onMkdir={localMkdir}
          />

          <div className="fm-arrows">
            <button className="btn primary" title="把左侧选中的本地文件上传到远程当前目录" onClick={() => doUpload(selectedLocal().map((e) => e.path || ''))}>
              上传 →
            </button>
            <button className="btn primary" title="把右侧选中的远程文件下载到本地当前目录" onClick={() => doDownload(selectedRemote())}>
              ← 下载
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
              title={`远程 · ${cfg?.name ?? ''}`}
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
              onToggle={(k, add) => toggleSelect('remote', k, add)}
              onMenu={(x, y, e) => setMenu({ x, y, side: 'remote', entry: e })}
              onMkdir={remoteMkdir}
              remote
            />
            {dragOver && <div className="fm-drop-hint">松开以上传到 {remote.cwd}</div>}
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.side === 'remote' ? (
            <>
              <div className="hdr">{menu.entry.name}</div>
              <button onClick={() => { doDownload([{ ...menu.entry, path: remoteFull(menu.entry) }]); setMenu(null); }}>
                {isDirLike(menu.entry) ? '下载整个文件夹到本地' : '下载到本地当前目录'}
              </button>
              {!isDirLike(menu.entry) && (
                <button onClick={() => { setViewer({ path: remoteFull(menu.entry), name: menu.entry.name, size: menu.entry.size }); setMenu(null); }}>
                  查看文本
                </button>
              )}
              <button onClick={() => { remoteRename(menu.entry); setMenu(null); }}>重命名</button>
              <button onClick={() => { remoteArchive([menu.entry]); setMenu(null); }}>压缩为 tar.gz</button>
              {/\.(tar|tgz|zip)/i.test(menu.entry.name) && (
                <button onClick={() => { remoteExtract(menu.entry); setMenu(null); }}>解压到当前目录</button>
              )}
              <button onClick={() => { setRelay({ sel: [{ ...menu.entry, path: remoteFull(menu.entry) }] }); setMenu(null); }}>
                传到另一台服务器
              </button>
              <div className="sep" />
              <button className="danger" onClick={() => { remoteDelete([{ ...menu.entry, path: remoteFull(menu.entry) }]); setMenu(null); }}>
                删除
              </button>
            </>
          ) : (
            <>
              <div className="hdr">{menu.entry.name}</div>
              <button onClick={() => { doUpload([menu.entry.path || '']); setMenu(null); }}>
                {isDirLike(menu.entry) ? '上传整个文件夹到远程' : '上传到远程当前目录'}
              </button>
              <div className="sep" />
              <button className="danger" onClick={() => { localDelete([menu.entry]); setMenu(null); }}>
                删除
              </button>
            </>
          )}
        </ContextMenu>
      )}

      {/* 输入对话框 */}
      {ask && (
        <div className="mask" onClick={() => setAsk(null)}>
          <div className="dialog" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>{ask.title}</h3>
            <div className="field">
              <label>{ask.label}</label>
              <input
                className="mini"
                style={{ width: '100%' }}
                autoFocus
                value={askValue || ask.value}
                onChange={(e) => setAskValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = (askValue || ask.value).trim();
                    if (v) {
                      ask.onOk(v);
                      setAsk(null);
                      setAskValue('');
                    }
                  }
                }}
              />
            </div>
            <div className="foot">
              <button
                className="btn primary"
                onClick={() => {
                  const v = (askValue || ask.value).trim();
                  if (v) {
                    ask.onOk(v);
                    setAsk(null);
                    setAskValue('');
                  }
                }}
              >
                确定
              </button>
              <button className="btn" onClick={() => setAsk(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认对话框 */}
      {confirm && (
        <div className="mask" onClick={() => setConfirm(null)}>
          <div className="dialog" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--warn)' }}>{confirm.title}</h3>
            <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
              {confirm.body}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  confirm.onOk();
                  setConfirm(null);
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {viewer && <TextViewer serverId={serverId} path={viewer.path} name={viewer.name} size={viewer.size} onClose={() => setViewer(null)} />}

      {relay && <RelayDialog selfId={serverId} selfName={cfg?.name || ''} sel={relay.sel} onClose={() => setRelay(null)} onDone={() => { setRelay(null); showTransfers(); }} />}
    </div>
  );
}

// ---------- 单个面板 ----------
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
  onToggle: (key: string, additive: boolean) => void;
  onMenu: (x: number, y: number, e: FileEntry) => void;
  onMkdir: () => void;
  remote?: boolean;
}) {
  const [addr, setAddr] = useState(state.cwd);
  useEffect(() => setAddr(state.cwd), [state.cwd]);
  const keyOf = (e: FileEntry) => (isRemote ? e.name : e.path || e.name);

  const th = (k: SortKey, label: string) => (
    <th onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : true })}>
      {label}
      {sort.k === k ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="fm-pane">
      <div className="fm-pane-head">
        <span className="fm-pane-title">{title}</span>
        <button className="btn mini" onClick={onHome} title="家目录">
          ⌂
        </button>
        <button className="btn mini" onClick={onUp} title="上一级">
          ↑
        </button>
        <button className="btn mini" onClick={onReload} title="刷新">
          ⟳
        </button>
        <button className="btn mini" onClick={onMkdir} title="新建文件夹">
          ＋
        </button>
      </div>
      <div className="fm-address">
        <input
          className="mini mono"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddress((e.target as HTMLInputElement).value)}
        />
      </div>
      <div className="fm-table-wrap">
        {state.loading && <div className="empty">加载中…</div>}
        {state.err && <div className="empty" style={{ color: 'var(--crit)' }}>{state.err}</div>}
        {!state.loading && !state.err && (
          <table className="fm-table">
            <thead>
              <tr>
                {th('name', '名称')}
                {th('size', '大小')}
                <th>权限</th>
                {th('mtime', '修改时间')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const key = keyOf(e);
                const sel = !!state.selected[key];
                return (
                  <tr
                    key={key}
                    className={sel ? 'sel' : ''}
                    onClick={(ev) => onToggle(key, ev.ctrlKey || ev.metaKey)}
                    onDoubleClick={() => onOpen(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      if (!sel) onToggle(key, false);
                      onMenu(ev.clientX, ev.clientY, e);
                    }}
                  >
                    <td>
                      <span className={`fm-ic ${isDirLike(e) ? 'dir' : 'file'}`}>{isDirLike(e) ? '📁' : '📄'}</span>
                      <span title={e.name}>{e.name}</span>
                    </td>
                    <td className="num">{isDirLike(e) ? '—' : formatBytes(e.size)}</td>
                    <td className="mono">{e.rights || ''}</td>
                    <td className="num">{fmtDate(e.mtime)}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    空目录
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
    if (s.k === 'name') r = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
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
