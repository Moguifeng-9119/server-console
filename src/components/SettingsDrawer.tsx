import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, type Density, type ThemeMode } from '../state';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
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
    a.securityGet().then((o) => setTofu(o.tofu)).catch(() => {});
    a.hostKeysList().then(setHosts).catch(() => {});
    a.getAppSettings().then((o) => setCloseAction(o.closeAction)).catch(() => {});
    a.webhookGet().then((o) => setWebhookUrl(o.url || '')).catch(() => {});
    a.snippetsList().then(setSnippets).catch(() => {});
    a.forwardingsList().then(setRules).catch(() => {});
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
      <div className="drawer">
        <h3>{t('settings.title')}</h3>

        <div className="field">
          <label>{t('settings.theme')}</label>
          <div className="seg">
            {themes.map(([v, l]) => (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('settings.language')}</label>
          <select className="mini" value={i18n.language} onChange={(e) => {
            i18n.changeLanguage(e.target.value);
            try { localStorage.setItem('sc.lang', e.target.value); } catch { /* noop */ }
            document.documentElement.lang = e.target.value;
            void api?.setAppLanguage(e.target.value);
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
              <button key={v} className={density === v ? 'on' : ''} onClick={() => setDensity(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('settings.refresh', { s: refreshMs / 1000 })}</label>
          <select className="mini" value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
            {[1000, 2000, 5000, 10000].map((v) => (
              <option key={v} value={v}>
                {t('settings.secOption', { s: v / 1000 })}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            告警阈值：{thresholds.warn}% / {thresholds.high}% / {thresholds.crit}%
          </label>
          <div className="row">
            <span className="mono" style={{ width: 34, color: 'var(--warn)' }}>
              {t('settings.yellow')}
            </span>
            <input
              type="range"
              min={10}
              max={thresholds.high - 1}
              value={thresholds.warn}
              onChange={(e) => setThresholds({ ...thresholds, warn: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <span className="mono" style={{ width: 34, color: 'var(--high)' }}>
              {t('settings.orange')}
            </span>
            <input
              type="range"
              min={thresholds.warn + 1}
              max={thresholds.crit - 1}
              value={thresholds.high}
              onChange={(e) => setThresholds({ ...thresholds, high: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <span className="mono" style={{ width: 34, color: 'var(--crit)' }}>
              {t('settings.red')}
            </span>
            <input
              type="range"
              min={thresholds.high + 1}
              max={100}
              value={thresholds.crit}
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
              value={tempAlert}
              style={{ flex: 1 }}
              onChange={(e) => setTempAlert(Number(e.target.value))}
            />
            <b className="num" style={{ width: 46, textAlign: 'right' }}>
              {tempAlert}°C
            </b>
          </div>
        </div>

        <div className="field">
          <label>{t('settings.security')}</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={tofu ?? true}
              disabled={!api || tofu === null}
              onChange={(e) => api?.securitySet({ tofu: e.target.checked }).then((o) => setTofu(o.tofu))}
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
                      a.hostKeysRemove(h.keyId).then(() => a.hostKeysList().then(setHosts));
                    }}
                  >
                    {t('settings.remove')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label>{t('settings.closeAction')}</label>
          <select
            className="mini"
            value={closeAction}
            onChange={(e) => {
              const v = e.target.value as 'ask' | 'minimize' | 'exit';
              setCloseAction(v);
              api?.setAppSettings({ closeAction: v });
            }}
          >
            <option value="ask">{t('settings.caAsk')}</option>
            <option value="minimize">{t('settings.caMinimize')}</option>
            <option value="exit">{t('settings.caExit')}</option>
          </select>
        </div>

        <div className="field">
          <label>{t('settings.webhook')}</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="mini mono"
              style={{ flex: 1 }}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={t('settings.webhookPh')}
            />
            <button
              className="btn"
              onClick={() => api?.webhookSet({ url: webhookUrl.trim() }).then(() => pushToast({ level: 'info', title: 'Webhook 已保存' }))}
            >
              保存
            </button>
            <button
              className="btn"
              title="发送一条测试消息"
              onClick={() => api?.webhookSend({ title: 'ServerConsole', body: '这是一条测试告警' })}
            >
              {t('settings.webhookTest')}
            </button>
          </div>
        </div>

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
              onClick={() => api?.snippetsSet(snippets.filter((s) => s.name.trim() && s.cmd.trim())).then(() => pushToast({ level: 'info', title: t('settings.snippetsSaved') }))}
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
                      <button className="btn mini" onClick={() => api?.forwardingsStop(r.id)}>
                        {t('settings.fwStop')}
                      </button>
                    ) : (
                      <button className="btn mini" onClick={() => api?.forwardingsStart(r.id).then((x) => x && !x.ok && pushToast({ level: 'error', title: '启动失败', detail: x.error }))}>
                        {t('settings.fwStart')}
                      </button>
                    )}
                    <button
                      className="btn mini danger"
                      onClick={() => api?.forwardingsRemove(r.id)}
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
                a.forwardingsUpsert({
                  serverId: newRule.serverId,
                  localPort: Number(newRule.localPort),
                  remoteHost: newRule.remoteHost.trim() || '127.0.0.1',
                  remotePort: Number(newRule.remotePort),
                  enabled: true,
                }).then((r) => {
                  if (r && !r.ok) pushToast({ level: 'error', title: t('settings.fwAddFail'), detail: r.error });
                  else {
                    setNewRule({ serverId: '', localPort: '', remoteHost: '127.0.0.1', remotePort: '' });
                    a.forwardingsList().then(setRules);
                  }
                });
              }}
            >
              {t('settings.fwAdd')}
            </button>
          </div>
        </div>

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
            <div style={{ marginTop: 6, display: 'flex', gap: 12 }}>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console" target="_blank" rel="noreferrer">GitHub 仓库</a>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console/issues" target="_blank" rel="noreferrer">反馈问题</a>
              <button
                className="link"
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                onClick={() =>
                  api?.checkUpdate().then((r) => {
                    if (r?.ok && r.data?.isNew) pushToast({ level: 'info', title: t('settings.newVersion', { v: r.data.latest || '' }), detail: t('settings.openingRelease') });
                    else if (r?.ok) pushToast({ level: 'info', title: t('settings.upToDate', { v: r.data?.current || '' }) });
                    else pushToast({ level: 'error', title: t('settings.updateFail'), detail: r?.error });
                    if (r?.ok && r.data?.isNew && r.data.url) window.open(r.data.url, '_blank');
                  })
                }
              >
                {t('settings.checkUpdate')}
              </button>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="mini"
                style={{ flex: 1 }}
                type="password"
                placeholder={t('settings.exportPassPh')}
                value={exportPass}
                onChange={(e) => setExportPass(e.target.value)}
              />
              <button
                className="btn mini"
                disabled={!exportPass}
                onClick={() =>
                  api?.configExport(exportPass).then((r) => {
                    if (r?.ok && r.data) pushToast({ level: 'info', title: t('settings.exportedTo'), detail: r.data });
                    else if (r && !r.ok) pushToast({ level: 'error', title: t('settings.exportFail'), detail: r.error });
                  })
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
                      pushToast({ level: 'info', title: t('settings.importDone'), detail: t('settings.importedN', { n: r.data }) });
                      refresh();
                    } else if (r && !r.ok) pushToast({ level: 'error', title: t('settings.importFail'), detail: r.error });
                  })
                }
              >
                {t('settings.import')}
              </button>
            </div>
          </div>
        </div>

        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </>
  );
}
