import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../state';
import type { ConfigChange, SshHostEntry } from '../types';
import { ImportSshConfig } from './ImportSshConfig';

type ChangeItem = ConfigChange['changed'][number];
type RemovedItem = ConfigChange['removed'][number];

// 监听 ~/.ssh/config：新增给入口去导入；同名主机端口/密钥变更可一键更新；被移除只提醒、不自动删
export function ConfigWatchBanner() {
  const { t } = useTranslation();
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
    if (r?.ok) {
      pushToast({ level: 'info', title: t('cfgBanner.updated', { name: cfg.name }) });
      setChanged((prev) => prev.filter((x) => x.alias !== item.alias));
      refresh();
    } else {
      pushToast({ level: 'error', title: t('cfgBanner.updateFail', { name: cfg.name }), detail: r?.error });
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
            {t('cfgBanner.added', { n: added.length })}
          </span>
        )}
        {changed.length > 0 && <span>{added.length > 0 ? ' · ' : ''}{t('cfgBanner.changed', { n: changed.length })}</span>}
        {removed.length > 0 && (
          <span title={t('cfgBanner.removedTip')}>
            {added.length + changed.length > 0 ? ' · ' : ''}
            {t('cfgBanner.removed', { n: removed.length })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {changed.map((c) => (
          <button key={c.alias} className="btn mini" title={t('cfgBanner.portTip', { from: c.fromPort, to: c.toPort })} onClick={() => applyChanged(c)}>
            {t('cfgBanner.update', { alias: c.alias })}
          </button>
        ))}
        {added.length > 0 && (
          <button className="btn primary mini" onClick={() => setShowImport(true)}>
            {t('cfgBanner.goImport')}
          </button>
        )}
        <button className="btn mini" onClick={dismissAll}>
          {t('cfgBanner.ignore')}
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
