import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useStore, type Density, type ThemeMode } from '../state';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CredentialStatus } from './CredentialStatus';
import { LANGUAGES, changeLanguage } from '../i18n';
import type { ForwardingRule, TrustedHost } from '../types';

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const {
    theme,
    setTheme,
    density,
    setDensity,
    thresholds,
    setThresholds,
    refreshMs,
    setRefreshMs,
    alertsEnabled,
    setAlertsEnabled,
    tempAlert,
    setTempAlert,
    audit,
    configs,
    pushToast,
    refresh,
  } = useStore();
  const { t, i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const languageRequest = useRef(0);
  const languagePending = useRef(false);
  useEffect(() => {
    if (!languagePending.current) setSelectedLanguage(i18n.language);
  }, [i18n.language]);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  const [section, setSection] = useState('appearance');
  const [status, setStatus] = useState('');
  const run = (promise: Promise<unknown> | undefined) => {
    if (!promise) { setStatus(t('state.desktopOnly')); return; }
    setStatus(t('serverManager.saving'));
    void promise.then((value) => {
      if (value && typeof value === 'object' && 'ok' in value && (value as {ok?: boolean}).ok === false) throw new Error((value as {error?: string}).error || t('settings.updateFail'));
      setStatus(t('workbench.saved'));
    }).catch(fail);
  };
  const fail = (error: unknown) => setStatus(error instanceof Error ? error.message : String(error));
  const [tofu, setTofu] = useState<boolean | null>(null);
  const [hosts, setHosts] = useState<TrustedHost[]>([]);
  const [closeAction, setCloseAction] = useState<'ask' | 'minimize' | 'exit'>('ask');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [snippets, setSnippets] = useState<Array<{ id: string; name: string; cmd: string }>>([]);
  const [rules, setRules] = useState<ForwardingRule[]>([]);
  const [exportPass, setExportPass] = useState('');
  const [newRule, setNewRule] = useState({ serverId: '', localPort: '', remoteHost: '127.0.0.1', remotePort: '' });

  useEffect(() => {
    if (!api) return;
    const a = api;
    a.securityGet().then((o) => setTofu(o.tofu)).catch(fail);
    a.hostKeysList().then(setHosts).catch(fail);
    a.getAppSettings().then((o) => setCloseAction(o.closeAction)).catch(fail);
    a.webhookGet().then((o) => setWebhookUrl(o.url || '')).catch(fail);
    a.snippetsList().then(setSnippets).catch(fail);
    a.forwardingsList().then(setRules).catch(fail);
    return a.onForwardingsChanged(setRules);
  }, []);

  const themes: Array<[ThemeMode, string]> = [
    ['system', t('settings.themeSystem')],
    ['light', t('settings.themeLight')],
    ['dark', t('settings.themeDark')],
  ];
  const densities: Array<[Density, string]> = [
    ['compact', t('settings.densCompact')],
    ['default', t('settings.densDefault')],
    ['comfy', t('settings.densComfy')],
  ];

  return (
    <>
      <div className="mask" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose} />
      <div className="drawer settings-drawer" ref={ref} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}>
        <h3 id="settings-title">{t('settings.title')}<button className="btn mini" onClick={onClose}>{t('settings.close')}</button></h3>
        <div className="settings-tabs" role="group" aria-label={t('settings.title')}>{['appearance','monitoring','security','workflow','activity'].map((key) => <button aria-pressed={section === key} aria-controls={'settings-' + key} id={'settings-tab-' + key} className={section === key ? 'on' : ''} key={key} onClick={() => setSection(key)}>{t('workbench.section_' + key)}</button>)}</div>
        {status && <div className="inline-status" role="status">{status}</div>}

        {section === 'appearance' && <section className="settings-pane" id="settings-appearance"  aria-labelledby="settings-tab-appearance">
        <div className="field">
          <label>{t('settings.theme')}</label>
          <div className="seg">
            {themes.map(([v, l]) => (
              <button key={v} aria-pressed={theme === v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('settings.language')}</label>
          <select className="mini" aria-label={t('settings.language')} value={selectedLanguage} onChange={(e) => {
            const code = e.target.value;
            const request = ++languageRequest.current;
            languagePending.current = true;
            setSelectedLanguage(code);
            void changeLanguage(code).then(() => {
              if (request !== languageRequest.current) return;
              languagePending.current = false;
              setSelectedLanguage(i18n.language);
            }).catch((error: unknown) => {
              if (request !== languageRequest.current) return;
              languagePending.current = false;
              setSelectedLanguage(i18n.language);
              fail(error);
            });
          }}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('settings.density')}</label>
          <div className="seg">
            {densities.map(([v, l]) => (
              <button key={v} aria-pressed={density === v} className={density === v ? 'on' : ''} onClick={() => setDensity(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('settings.closeAction')}</label>
          <select
            className="mini"
            aria-label={t('settings.closeAction')} value={closeAction}
            onChange={(e) => {
              const v = e.target.value as 'ask' | 'minimize' | 'exit';
              setCloseAction(v);
              run(api?.setAppSettings({ closeAction: v }));
            }}
          >
            <option value="ask">{t('settings.caAsk')}</option>
            <option value="minimize">{t('settings.caMinimize')}</option>
            <option value="exit">{t('settings.caExit')}</option>
          </select>
        </div>

        </section>}
        {section === 'monitoring' && <section className="settings-pane" id="settings-monitoring" aria-labelledby="settings-tab-monitoring">
        <div className="field">
          <label>{t('settings.refresh', { s: refreshMs / 1000 })}</label>
          <select className="mini" aria-label={t('settings.refresh')} value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
            {[1000, 2000, 5000, 10000].map((v) => (
              <option key={v} value={v}>
                {t('settings.secOption', { s: v / 1000 })}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            {t('settings.thresholds', {...thresholds})}
          </label>
          <div className="row">
            <span className="mono threshold-label" style={{ color: 'var(--warn)' }}>
              {t('settings.yellow')}
            </span>
            <input
              type="range"
              min={10}
              max={thresholds.high - 1}
              aria-label={t('settings.yellow')} value={thresholds.warn}
              onChange={(e) => setThresholds({ ...thresholds, warn: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <span className="mono threshold-label" style={{ color: 'var(--high)' }}>
              {t('settings.orange')}
            </span>
            <input
              type="range"
              min={thresholds.warn + 1}
              max={thresholds.crit - 1}
              aria-label={t('settings.orange')} value={thresholds.high}
              onChange={(e) => setThresholds({ ...thresholds, high: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <span className="mono threshold-label" style={{ color: 'var(--crit)' }}>
              {t('settings.red')}
            </span>
            <input
              type="range"
              min={thresholds.high + 1}
              max={100}
              aria-label={t('settings.red')} value={thresholds.crit}
              onChange={(e) => setThresholds({ ...thresholds, crit: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={alertsEnabled} onChange={(e) => setAlertsEnabled(e.target.checked)} />
            {t('settings.alertsEnabled')}
          </label>
        </div>

        <div className="field">
          <label>
            {t('settings.tempAlert', { v: tempAlert })}<span className="faint">{t('settings.tempAlertNote')}</span>
          </label>
          <div className="row">
            <input
              type="range"
              min={50}
              max={110}
              aria-label={t('settings.tempAlert', {v: tempAlert})} value={tempAlert}
              style={{ flex: 1 }}
              onChange={(e) => setTempAlert(Number(e.target.value))}
            />
            <b className="num" style={{ width: 46, textAlign: 'right' }}>
              {tempAlert}°C
            </b>
          </div>
        </div>

        <div className="field">
          <label>{t('settings.webhook')}</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="mini mono"
              style={{ flex: 1 }}
              aria-label={t('settings.webhook')} value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={t('settings.webhookPh')}
            />
            <button
              className="btn"
              onClick={() => run(api?.webhookSet({ url: webhookUrl.trim() }))}
            >
              {t('workbench.save')}
            </button>
            <button
              className="btn"
              title={t('settings.webhookTest')}
              onClick={() => run(api?.webhookSend({ title: 'ServerConsole', body: t('workbench.testAlert') }))}
            >
              {t('settings.webhookTest')}
            </button>
          </div>
        </div>

        </section>}
        {section === 'security' && <section className="settings-pane" id="settings-security" aria-labelledby="settings-tab-security">
        <div className="field">
          <label>{t('settings.security')}</label><CredentialStatus />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={tofu ?? true}
              disabled={!api || tofu === null}
              onChange={(e) => api?.securitySet({ tofu: e.target.checked }).then((o) => { setTofu(o.tofu); setStatus(t('workbench.saved')); }).catch(fail)}
            />
            {t('settings.tofu')}
          </label>
          <div className="note" style={{ marginTop: 4 }}>
            {t('settings.tofuNote')}
          </div>
          {hosts.length > 0 && (
            <div className="audit" style={{ marginTop: 8 }}>
              <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                {t('settings.trustedHosts')}
              </div>
              {hosts.map((h) => (
                <div className="e" key={h.keyId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="mono">
                    {h.host}:{h.port}
                  </span>
                  <span
                    className="mono faint ellipsis"
                    style={{ flex: 1 }}
                    title={`${h.type} · ${h.fp}`}
                  >
                    {h.fp}
                  </span>
                  <button
                    className="btn mini"
                    onClick={() => {
                      const a = api;
                      if (!a) return;
                      a.hostKeysRemove(h.keyId).then(() => a.hostKeysList().then(setHosts)).catch(fail);
                    }}
                  >
                    {t('settings.remove')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        </section>}
        {section === 'workflow' && <section className="settings-pane" id="settings-workflow" aria-labelledby="settings-tab-workflow">
        <div className="field">
          <label>{t('settings.snippets')}</label>
          {snippets.map((sn, i) => (
            <div className="row" style={{ gap: 6, marginBottom: 6 }} key={sn.id}>
              <input
                className="mini"
                style={{ width: 130 }}
                value={sn.name}
                placeholder={t('settings.snippetName')}
                onChange={(e) =>
                  setSnippets((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                className="mini mono"
                style={{ flex: 1 }}
                value={sn.cmd}
                placeholder={t('settings.snippetCmd')}
                onChange={(e) =>
                  setSnippets((prev) => prev.map((x, j) => (j === i ? { ...x, cmd: e.target.value } : x)))
                }
              />
              <button className="btn mini danger" onClick={() => setSnippets((prev) => prev.filter((_, j) => j !== i))}>
                {t('settings.del')}
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn mini"
              onClick={() => setSnippets((prev) => [...prev, { id: `sn_${Date.now().toString(36)}`, name: '', cmd: '' }])}
            >
              {t('settings.addSnippet')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn mini primary"
              onClick={() => run(api?.snippetsSet(snippets.filter((s) => s.name.trim() && s.cmd.trim())))}
            >
              {t('settings.saveSnippets')}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t('settings.portForward')}</label>
          {rules.length > 0 && (
            <div className="audit">
              {rules.map((r) => {
                const srv = configs.find((c) => c.id === r.serverId);
                return (
                  <div className="e" key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="mono" style={{ flex: 1 }}>
                      :{r.localPort} → {r.remoteHost}:{r.remotePort} <span style={{ color: 'var(--text-faint)' }}>@{srv?.name || '?'}</span>
                    </span>
                    <span
                      style={{ color: r.status === 'listening' ? 'var(--ok)' : r.status === 'error' ? 'var(--crit)' : 'var(--text-faint)' }}
                      title={r.error}
                    >
                      {r.status === 'listening' ? t('settings.fwListening') : r.status === 'error' ? t('settings.fwError') : t('settings.fwStopped')}
                    </span>
                    {r.status === 'listening' ? (
                      <button className="btn mini" onClick={() => run(api?.forwardingsStop(r.id))}>
                        {t('settings.fwStop')}
                      </button>
                    ) : (
                      <button className="btn mini" onClick={() => run(api?.forwardingsStart(r.id).then((x) => { if (x && !x.ok) throw new Error(x.error); }))}>
                        {t('settings.fwStart')}
                      </button>
                    )}
                    <button
                      className="btn mini danger"
                      onClick={() => run(api?.forwardingsRemove(r.id))}
                    >
                      {t('settings.fwDel')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <select className="mini" value={newRule.serverId} onChange={(e) => setNewRule((p) => ({ ...p, serverId: e.target.value }))}>
              <option value="">{t('settings.fwServer')}</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="mini num" style={{ width: 76 }} placeholder={t('settings.fwLocalPort')} value={newRule.localPort} onChange={(e) => setNewRule((p) => ({ ...p, localPort: e.target.value }))} />
            <input className="mini mono" style={{ width: 110 }} placeholder={t('settings.fwRemoteHost')} value={newRule.remoteHost} onChange={(e) => setNewRule((p) => ({ ...p, remoteHost: e.target.value }))} />
            <input className="mini num" style={{ width: 76 }} placeholder={t('settings.fwRemotePort')} value={newRule.remotePort} onChange={(e) => setNewRule((p) => ({ ...p, remotePort: e.target.value }))} />
            <button
              className="btn mini primary"
              onClick={() => {
                const a = api;
                if (!a) return;
                run(a.forwardingsUpsert({
                  serverId: newRule.serverId,
                  localPort: Number(newRule.localPort),
                  remoteHost: newRule.remoteHost.trim() || '127.0.0.1',
                  remotePort: Number(newRule.remotePort),
                  enabled: true,
                }).then((r) => {
                  if (r && !r.ok) throw new Error(r.error);
                  else {
                    setNewRule({ serverId: '', localPort: '', remoteHost: '127.0.0.1', remotePort: '' });
                    void a.forwardingsList().then(setRules).catch(fail);
                  }
                }));
              }}
            >
              {t('settings.fwAdd')}
            </button>
          </div>
        </div>

        </section>}
        {section === 'activity' && <section className="settings-pane" id="settings-activity" aria-labelledby="settings-tab-activity">
        <div className="field">
          <label>{t('settings.audit')}</label>
          <div className="audit">
            {audit.length === 0 && <div className="faint">{t('settings.auditEmpty')}</div>}
            {audit.map((e) => (
              <div className="e" key={e.id}>
                {e.time} · {e.server} · {e.action} · {e.target}
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('settings.help')}</label>
          <div className="help-list">
            <div className="e"><b>{t('settings.helpDblClick')}</b><span>{t('settings.helpDblClickV')}</span></div>
            <div className="e"><b>{t('settings.helpCtrlClick')}</b><span>{t('settings.helpCtrlClickV')}</span></div>
            <div className="e"><b>{t('settings.helpCtrlA')}</b><span>{t('settings.helpCtrlAV')}</span></div>
            <div className="e"><b>{t('settings.helpRightClick')}</b><span>{t('settings.helpRightClickV')}</span></div>
            <div className="e"><b>{t('settings.helpDrag')}</b><span>{t('settings.helpDragV')}</span></div>
            <div className="e"><b>{t('settings.helpEsc')}</b><span>{t('settings.helpEscV')}</span></div>
          </div>
        </div>

        <div className="field">
          <label>{t('settings.about')}</label>
          <div className="body" style={{ color: 'var(--text-dim)' }}>
            <b>ServerConsole</b> <span className="num">v{__APP_VERSION__}</span> · {t('settings.aboutDesc')}
            <div className="row" style={{ marginTop: 6, gap: 12 }}>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console" target="_blank" rel="noreferrer">{t('workbench.repository')}</a>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console/issues" target="_blank" rel="noreferrer">{t('workbench.feedback')}</a>
              <button
                className="link"
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                onClick={() =>
                  api?.checkUpdate().then((r) => {
                    if (r?.ok && r.data?.isNew) pushToast({ level: 'info', title: t('settings.newVersion', { v: r.data.latest || '' }), detail: t('settings.openingRelease') });
                    else if (r?.ok) pushToast({ level: 'info', title: t('settings.upToDate', { v: r.data?.current || '' }) });
                    else pushToast({ level: 'error', title: t('settings.updateFail'), detail: r?.error });
                    if (r?.ok && r.data?.isNew && r.data.url) window.open(r.data.url, '_blank');
                  }).catch(fail)
                }
              >
                {t('settings.checkUpdate')}
              </button>
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <input
                className="mini"
                style={{ flex: 1 }}
                type="password"
                placeholder={t('settings.exportPassPh')}
                aria-label={t('settings.exportPassPh')} value={exportPass}
                onChange={(e) => setExportPass(e.target.value)}
              />
              <button
                className="btn mini"
                disabled={!api || !exportPass}
                onClick={() =>
                  api?.configExport(exportPass).then((r) => {
                    if (r?.ok && r.data) setStatus(t('settings.exportedTo') + ': ' + r.data);
                    else if (r && !r.ok) setStatus(r.error || t('settings.exportFail')); else setStatus(t('workbench.saved'));
                  }).catch(fail)
                }
              >
                {t('settings.export')}
              </button>
              <button
                className="btn mini"
                disabled={!exportPass}
                onClick={() =>
                  api?.configImport(exportPass).then((r) => {
                    if (r?.ok && Number(r.data) >= 0) {
                      setStatus(t('settings.importedN', {n: r.data}));
                      void refresh().catch(fail);
                    } else if (r && !r.ok) setStatus(r.error || t('settings.importFail'));
                  }).catch(fail)
                }
              >
                {t('settings.import')}
              </button>
            </div>
          </div>
        </div>

        </section>}
        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </>
  );
}
