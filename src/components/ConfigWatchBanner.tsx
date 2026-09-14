import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../state';
import type { ConfigChange, SshHostEntry } from '../types';
import { ImportSshConfig } from './ImportSshConfig';

type ChangeItem = ConfigChange['changed'][number];
type RemovedItem = ConfigChange['removed'][number];

// 监听 ~/.ssh/config：新增给入口去导入；同名主机端口/密钥变更可一键更新；被移除只提醒、不自动删
export function ConfigWatchBanner() {
  const { configs, refresh, pushToast } = useStore();
  const [added, setAdded] = useState<SshHostEntry[]>([]);
  const [changed, setChanged] = useState<ChangeItem[]>([]);
  const [removed, setRemoved] = useState<RemovedItem[]>([]);
  const [showImport, setShowImport] = useState(false);
  const known = useRef(false);

  useEffect(() => {
    if (!api) return;
    // 启动时主动比对一次
    api.sshConfigRefresh().then((r) => {
      if (r?.added?.length) setAdded((prev) => mergeAlias(prev, r.added));
      if (r?.changed?.length) setChanged((prev) => mergeChanged(prev, r.changed));
    });
    const off = api.onConfigChanged((c) => {
      // 首次回调多为 watch 绑定瞬间，忽略以免打扰
      if (!known.current) {
        known.current = true;
        return;
      }
      if (c.added.length) setAdded((prev) => mergeAlias(prev, c.added));
      if (c.changed.length) setChanged((prev) => mergeChanged(prev, c.changed));
      if (c.removed?.length) setRemoved((prev) => mergeRemoved(prev, c.removed));
    });
    return off;
  }, []);

  if (!added.length && !changed.length && !removed.length) {
    return showImport ? <ImportSshConfig preferAliases={[]} onClose={() => setShowImport(false)} /> : null;
  }

  const applyChanged = async (item: ChangeItem) => {
    const cfg = configs.find((c) => c.id === item.targetId);
    if (!cfg || !api) return;
    const r = await api.updateServer({
      id: cfg.id,
      port: item.toPort,
      username: item.entry.user,
      authType: 'key',
      ...(item.keyPath ? { keyPath: item.keyPath } : {}), // config 未写密钥则保留原密钥
    });
    if (r) {
      pushToast({ level: 'info', title: `已更新 ${cfg.name} 的连接信息` });
      setChanged((prev) => prev.filter((x) => x.alias !== item.alias));
      refresh();
    }
  };

  const dismissAll = () => {
    setAdded([]);
    setChanged([]);
    setRemoved([]);
  };

  return (
    <>
      <div className="cfg-banner">
        {added.length > 0 && (
          <span>
            <b>~/.ssh/config</b> 新增 {added.length} 台主机
          </span>
        )}
        {changed.length > 0 && <span>{added.length > 0 ? '，' : ''}{changed.length} 台连接配置变更</span>}
        {removed.length > 0 && (
          <span title="不会自动删除程序里的服务器">
            {added.length + changed.length > 0 ? '，' : ''}
            {removed.length} 台已从 config 移除（本地保留）
          </span>
        )}
        <span style={{ flex: 1 }} />
        {changed.map((c) => (
          <button key={c.alias} className="btn mini" title={`端口 ${c.fromPort}→${c.toPort}`} onClick={() => applyChanged(c)}>
            更新 {c.alias}
          </button>
        ))}
        {added.length > 0 && (
          <button className="btn primary mini" onClick={() => setShowImport(true)}>
            去导入
          </button>
        )}
        <button className="btn mini" onClick={dismissAll}>
          忽略
        </button>
      </div>
      {showImport && <ImportSshConfig preferAliases={added.map((a) => a.alias)} onClose={() => setShowImport(false)} />}
    </>
  );
}

function mergeAlias(prev: SshHostEntry[], next: SshHostEntry[]): SshHostEntry[] {
  const map = new Map(prev.map((x) => [x.alias, x]));
  for (const e of next) map.set(e.alias, e);
  return [...map.values()];
}
function mergeChanged(prev: ChangeItem[], next: ChangeItem[]): ChangeItem[] {
  const map = new Map(prev.map((x) => [x.alias, x]));
  for (const e of next) map.set(e.alias, e);
  return [...map.values()];
}
function mergeRemoved(prev: RemovedItem[], next: RemovedItem[]): RemovedItem[] {
  const map = new Map(prev.map((x) => [x.alias, x]));
  for (const e of next) map.set(e.alias, e);
  return [...map.values()];
}
