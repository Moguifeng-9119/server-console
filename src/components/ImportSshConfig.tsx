import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { api } from '../api';
import { useStore } from '../state';
import type { SshConfigInfo, SshHostEntry } from '../types';

type Row = SshHostEntry & { exists: boolean };

const fpKey = (host: string, port: number, user: string) => `${host}|${port}|${user}`;

export function ImportSshConfig({
  onClose,
  preferAliases,
}: {
  onClose: () => void;
  preferAliases?: string[];
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  const { configs, addServer, pushToast } = useStore();
  const [info, setInfo] = useState<SshConfigInfo | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [entries, setEntries] = useState<SshHostEntry[]>([]);
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState('');
  const [unifiedKey, setUnifiedKey] = useState('');
  const [perKey, setPerKey] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api?.sshConfigDefault().then((i) => {
      setInfo(i);
      setConfigPath(i.configPath);
      if (i.configExists) doRead(i.configPath);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRead = async (p: string) => {
    if (!api) return;
    setReading(true);
    setReadErr('');
    const r = await api.sshConfigRead(p);
    setReading(false);
    if (!r.ok || !r.data) {
      setEntries([]);
      setReadErr(r.error || t('import.readFail'));
      return;
    }
    setConfigPath(r.data.path);
    setEntries(r.data.entries);
    const exist = new Set(configs.map((c) => fpKey(c.host, c.port, c.username)));
    const prefer = preferAliases?.length ? new Set(preferAliases) : null;
    const init: Record<string, boolean> = {};
    for (const e of r.data.entries) {
      const isNew = !exist.has(fpKey(e.host, e.port, e.user));
      init[e.alias] = prefer ? prefer.has(e.alias) && isNew : isNew;
    }
    setPicked(init);
  };

  const rows: Row[] = useMemo(() => {
    const exist = new Set(configs.map((c) => fpKey(c.host, c.port, c.username)));
    return entries.map((e) => ({ ...e, exists: exist.has(fpKey(e.host, e.port, e.user)) }));
  }, [entries, configs]);

  const selectedCount = rows.filter((r) => picked[r.alias] && !r.exists).length;

  const browseConfig = async () => {
    const files = await api?.dlgOpenFiles();
    if (files && files[0]) doRead(files[0]);
  };

  const browseUnified = async () => {
    const k = await api?.dlgPickKey();
    if (k) setUnifiedKey(k);
  };

  const browseRowKey = async (alias: string) => {
    const k = await api?.dlgPickKey();
    if (k) setPerKey((m) => ({ ...m, [alias]: k }));
  };

  const finalKey = (e: SshHostEntry) => unifiedKey || perKey[e.alias] || e.keyPath;

  const toggleAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    for (const r of rows) if (!r.exists) next[r.alias] = v;
    setPicked(next);
  };

  const runImport = async () => {
    const targets = rows.filter((r) => picked[r.alias] && !r.exists);
    if (!targets.length) return;
    setImporting(true);
    let ok = 0;
    let fail = 0;
    for (const e of targets) {
      const keyPath = finalKey(e);
      const res = await addServer({
        name: e.alias,
        host: e.host,
        port: e.port,
        username: e.user,
        authType: 'key',
        keyPath,
        passphrase: '',
        ...(e.proxyJump ? { proxyJump: e.proxyJump } : {}),
      });
      if (res.ok) ok++;
      else fail++;
    }
    setImporting(false);
    pushToast({
      level: fail ? 'warn' : 'info',
      title: t('import.importDone', { ok, fail: fail ? t('import.importFailSuffix', { n: fail }) : '' }),
    });
    onClose();
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog import-dlg" ref={ref} role="dialog" aria-modal="true" aria-label="SSH config" tabIndex={-1} style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>{t('import.title')}</h3>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>{t('import.pathLabel')}</label>
          <div className="row" style={{ gap: 6 }}>
            <input className="mini mono" style={{ flex: 1 }} value={configPath} onChange={(e) => setConfigPath(e.target.value)} />
            <button className="btn" onClick={browseConfig}>
              {t('import.browse')}
            </button>
            <button className="btn" disabled={reading} onClick={() => doRead(configPath)}>
              {reading ? t('import.reading') : t('import.reread')}
            </button>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>{t('import.unifiedKey')}</label>
          <div className="row" style={{ gap: 6 }}>
            <select className="mini mono" style={{ flex: 1 }} value={unifiedKey} onChange={(e) => setUnifiedKey(e.target.value)}>
              <option value="">{t('import.ownIdentityFile')}</option>
              {info?.keys.map((k) => (
                <option key={k.path} value={k.path}>
                  {k.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={browseUnified}>
              {t('import.pickKey')}
            </button>
            {unifiedKey && (
              <button className="btn" onClick={() => setUnifiedKey('')}>
                {t('import.clear')}
              </button>
            )}
          </div>
        </div>

        <div className="import-bar">
          <span>
            {t('import.summary', { total: rows.length, exists: rows.filter((r) => r.exists).length, sel: selectedCount })}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={() => toggleAll(true)}>
            {t('import.selectNew')}
          </button>
          <button className="btn" onClick={() => toggleAll(false)}>
            {t('import.selectNone')}
          </button>
        </div>

        {readErr && <div className="body" style={{ color: 'var(--crit)', padding: '8px 0' }}>{readErr}</div>}
        {!readErr && rows.length === 0 && !reading && (
          <div className="empty" style={{ padding: 24 }}>
            {t('import.parseEmpty')}
          </div>
        )}

        <div className="import-list">
          {rows.map((e) => {
            const key = finalKey(e);
            const checked = !!picked[e.alias] && !e.exists;
            const options = Array.from(new Set([...(perKey[e.alias] ? [perKey[e.alias]] : []), e.keyPath, ...e.keyCandidates].filter(Boolean)));
            return (
              <div key={e.alias} className={`import-row ${e.exists ? 'exists' : ''}`}>
                <label className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    disabled={e.exists}
                    checked={checked}
                    onChange={(ev) => setPicked((m) => ({ ...m, [e.alias]: ev.target.checked }))}
                  />
                  <span className="imp-alias">{e.alias}</span>
                  <span className="mono imp-host">
                    {e.user}@{e.host}:{e.port}
                  </span>
                  {e.exists && <span className="tag">{t('import.existsTag')}</span>}
                </label>
                <div className="imp-key">
                  {unifiedKey ? (
                    <span className="mono" title={key}>
                      {t('import.unified')}
                    </span>
                  ) : (
                    <>
                      <select
                        className="mini mono"
                        value={perKey[e.alias] || e.keyPath}
                        onChange={(ev) => {
                          if (ev.target.value === '__browse__') browseRowKey(e.alias);
                          else setPerKey((m) => ({ ...m, [e.alias]: ev.target.value }));
                        }}
                      >
                        {options.length === 0 && <option value="">{t('import.noKey')}</option>}
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o.split(/[\\/]/).pop()}
                          </option>
                        ))}
                        <option value="__browse__">{t('import.browse')}</option>
                      </select>
                      <span className={`key-state ${key ? 'ok' : 'miss'}`}>{key ? t('import.keyReady') : t('import.keyMissing')}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="foot">
          <button className="btn primary" disabled={importing || selectedCount === 0} onClick={runImport}>
            {importing ? t('import.importing') : t('import.importSel', { n: selectedCount })}
          </button>
          <button className="btn" onClick={onClose}>{t('settings.close')}</button>
        </div>
      </div>
    </div>
  );
}
