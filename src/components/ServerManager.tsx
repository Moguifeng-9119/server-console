import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CredentialStatus } from './CredentialStatus';
import { api } from '../api';
import { useStore } from '../state';
import type { ServerConfig } from '../types';
import { ImportSshConfig } from './ImportSshConfig';

type Draft = {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  password: string;
  keyPath: string;
  passphrase: string;
  agentPath: string;
  group: string;
  proxyJump: string;
  compress: boolean;
};

const emptyDraft: Draft = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  keyPath: '',
  passphrase: '',
  agentPath: '',
  group: '',
  proxyJump: '',
  compress: false,
};

export function ServerManager({ onClose }: { onClose: () => void }) {
  const { configs, addServer, removeServer, testServer, hasApi, pushToast, refresh } = useStore();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const delRef = useRef<HTMLDivElement>(null);
  const dupRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, onClose);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ServerConfig | null>(null);
  const [confirmDel, setConfirmDel] = useState<ServerConfig | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [saving, setSaving] = useState(false);
  useDialogFocus(!!confirmDel, delRef, () => setConfirmDel(null));
  useDialogFocus(confirmDup, dupRef, () => setConfirmDup(false));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // 密码/口令留空 = 保留已存凭据（payload 中直接省略该键，避免空串覆盖）
  const payload = () => {
    const base = {
      name: draft.name.trim() || draft.host.trim(),
      host: draft.host.trim(),
      port: Number(draft.port) || 22,
      username: draft.username.trim(),
      authType: draft.authType,
      group: draft.group.trim(),
      proxyJump: draft.proxyJump.trim(),
      compress: draft.compress,
    };
    if (draft.authType === 'agent') {
      const agentPart = draft.agentPath.trim() ? { agentPath: draft.agentPath.trim() } : {};
      return { ...base, keyPath: '', ...agentPart };
    }
    if (draft.authType === 'password') {
      return draft.password ? { ...base, password: draft.password, keyPath: '' } : { ...base, keyPath: '' };
    }
    const keyPart = { ...base, keyPath: draft.keyPath.trim() };
    return draft.passphrase ? { ...keyPart, passphrase: draft.passphrase } : keyPart;
  };

  const startEdit = (c: ServerConfig) => {
    setEditing(c);
    setDraft({
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      authType: c.authType,
      password: '',
      keyPath: c.keyPath || '',
      passphrase: '',
      agentPath: c.agentPath || '',
      group: c.group || '',
      proxyJump: c.proxyJump || '',
      compress: !!c.compress,
    });
    setTestResult(t('serverManager.editingMsg', { name: c.name }));
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setTestResult('');
  };

  const runTest = async () => {
    setTesting(true); setTestResult(t('serverManager.testing'));
    try {
      const res = await testServer(payload());
      setTestResult(res.ok ? t('serverManager.testOk', {gpus: res.gpus, procs: res.processes}) : t('serverManager.testFail', {error: res.error}));
    } catch (error) { setTestResult(t('serverManager.testFail', {error: String(error)})); }
    finally { setTesting(false); }
  };

  const doSave = async () => {
    setConfirmDup(false);
    setSaving(true);
    setTestResult(t(editing ? 'serverManager.saving' : 'serverManager.adding'));
    try {
      if (editing) {
        const r = await api?.updateServer({ id: editing.id, ...payload() });
        if (!r?.ok) throw new Error(r?.error || t('serverManager.saveFail', {error: ''}));
        pushToast({ level: 'info', title: t('serverManager.updatedToast'), detail: payload().host });
        await refresh();
        cancelEdit();
        setTestResult(t('serverManager.updatedMsg', { name: draft.name || draft.host }));
      } else {
        const res = await addServer(payload());
        if (!res || res.ok === false) throw new Error(res?.error || t('state.desktopOnly'));
        pushToast({ level: 'info', title: t('serverManager.addedToast'), detail: payload().host });
        setDraft(emptyDraft);
        setTestResult(t('serverManager.addedMsg', { name: payload().name, host: payload().host }));
      }
    } catch (e) {
      setTestResult(t('serverManager.saveFail', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!draft.host.trim() || !draft.username.trim()) {
      setTestResult(t('serverManager.needHostUser'));
      return;
    }
    if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) { setTestResult(t('workbench.invalidPort')); return; }
    // 添加时同名同主机已存在 → 二次确认（分组/跳板机场景下允许故意重名）
    if (!editing && configs.some((c) => c.name === payload().name && c.host === payload().host)) {
      setConfirmDup(true);
      return;
    }
    await doSave();
  };

  const removeTarget = async (c: ServerConfig) => {
    setConfirmDel(null);
    try { await removeServer(c.id); } catch (error) { setTestResult(t('serverManager.saveFail', {error: String(error)})); return; }
    if (editing?.id === c.id) cancelEdit();
    pushToast({ level: 'info', title: t('serverManager.deletedToast'), detail: `${c.name}（${c.username}@${c.host}）` });
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="manager-title" tabIndex={-1} style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3 id="manager-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t('serverManager.title')}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setImportOpen(true)}>
            {t('serverManager.importBtn')}
          </button>
        </h3>

        <CredentialStatus />
        {!hasApi && (
          <div className="body" style={{ color: 'var(--warn)', marginBottom: 12 }}>
            {t('serverManager.browserOnly')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.name')}</label>
            <input className="mini" style={{ width: '100%' }} aria-label={t('serverManager.name')} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="dgx-01" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.host')}</label>
            <input className="mini" style={{ width: '100%' }} aria-label={t('serverManager.host')} value={draft.host} onChange={(e) => set('host', e.target.value)} placeholder="10.20.1.11" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.port')}</label>
            <input className="mini" style={{ width: '100%' }} type="number" aria-label={t('serverManager.port')} value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.username')}</label>
            <input className="mini" style={{ width: '100%' }} aria-label={t('serverManager.username')} value={draft.username} onChange={(e) => set('username', e.target.value)} placeholder="root" />
          </div>
        </div>

        <div className="field">
          <label>{t('serverManager.authType')}</label>
          <div className="seg" style={{ width: 'fit-content' }}>
            <button className={draft.authType === 'password' ? 'on' : ''} onClick={() => set('authType', 'password')}>
              {t('serverManager.password')}
            </button>
            <button className={draft.authType === 'key' ? 'on' : ''} onClick={() => set('authType', 'key')}>
              {t('serverManager.key')}
            </button>
            <button className={draft.authType === 'agent' ? 'on' : ''} onClick={() => set('authType', 'agent')} title={t('serverManager.agentNote')}>
              agent
            </button>
          </div>
        </div>

        {draft.authType === 'agent' ? (
          <>
            <div className="body" style={{ color: 'var(--text-dim)', marginBottom: 10 }}>
              {t('serverManager.agentNote')}
            </div>
            <div className="field">
              <label>{t('serverManager.agentPath')}</label>
              <input className="mini mono" style={{ width: '100%' }} aria-label={t('serverManager.agentPath')} value={draft.agentPath} onChange={(e) => set('agentPath', e.target.value)} placeholder="SSH_AUTH_SOCK" />
            </div>
          </>
        ) : draft.authType === 'password' ? (
          <div className="field">
            <label>{t('serverManager.password')}{editing ? t('serverManager.keepHint') : ''}</label>
            <input className="mini" style={{ width: '100%' }} type="password" aria-label={t('serverManager.password')} value={draft.password} onChange={(e) => set('password', e.target.value)} />
          </div>
        ) : (
          <>
            <div className="field">
              <label>{t('serverManager.keyPath')}</label>
              <input className="mini mono" style={{ width: '100%' }} aria-label={t('serverManager.keyPath')} value={draft.keyPath} onChange={(e) => set('keyPath', e.target.value)} placeholder="/home/user/.ssh/id_rsa" />
            </div>
            <div className="field">
              <label>{t('serverManager.passphrase', { keep: editing ? t('serverManager.keepHint') : '' })}</label>
              <input className="mini" style={{ width: '100%' }} type="password" aria-label={t('serverManager.passphrase')} value={draft.passphrase} onChange={(e) => set('passphrase', e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.group')}</label>
            <input
              className="mini"
              style={{ width: '100%' }}
              list="group-options"
              aria-label={t('serverManager.group')} value={draft.group}
              onChange={(e) => set('group', e.target.value)}
              placeholder={t('workbench.groupExample')}
            />
            <datalist id="group-options">
              {Array.from(new Set(configs.map((c) => (c.group || '').trim()).filter(Boolean))).map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>{t('serverManager.proxyJump')}</label>
            <input className="mini mono" style={{ width: '100%' }} aria-label={t('serverManager.proxyJump')} value={draft.proxyJump} onChange={(e) => set('proxyJump', e.target.value)} placeholder="user@bastion:22" />
          </div>
        </div>

        <div className="field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={draft.compress} onChange={(e) => set('compress', e.target.checked)} />
            {t('serverManager.compress')}
          </label>
        </div>

        {testResult && (
          <div className="body" style={{ color: 'var(--text-dim)', marginBottom: 10 }}>
            {testResult}
          </div>
        )}

        <div className="foot">
          <button className="btn" disabled={!hasApi || testing} onClick={runTest}>
            {t(testing ? 'serverManager.testing' : 'serverManager.testConn')}
          </button>
          {editing ? (
            <>
              <button className="btn primary" disabled={!hasApi || saving} onClick={save}>
                {t(saving ? 'serverManager.saving' : 'serverManager.save')}
              </button>
              <button className="btn" onClick={cancelEdit}>
                {t('serverManager.cancelEdit')}
              </button>
            </>
          ) : (
            <button className="btn primary" disabled={!hasApi || saving} onClick={save}>
              {t(saving ? 'serverManager.adding' : 'serverManager.add')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>

        <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="dim" style={{ fontSize: 11.5, marginBottom: 8 }}>
            {t('workbench.savedConnections')}
          </div>
          {configs.length === 0 && <div className="faint">{t('serverManager.none')}</div>}
          {configs.map((c: ServerConfig) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <span>{c.name}</span>
              <span className="mono faint">
                {c.username}@{c.host}:{c.port}
              </span>
              <span className="tag">{t('serverManager.' + c.authType)}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn mini" onClick={() => startEdit(c)}>
                  {t('serverManager.edit')}
                </button>
                <button className="btn danger mini" onClick={() => setConfirmDel(c)}>
                  {t('serverManager.delete')}
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {confirmDel && (
        <div className="mask" onClick={() => setConfirmDel(null)}>
          <div className="dialog" ref={delRef} role="dialog" aria-modal="true" aria-label={t('serverManager.confirmDel')} tabIndex={-1} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--warn)' }}>{t('serverManager.delConfirmTitle', {name: confirmDel.name})}</h3>
            <div className="body">
              <code>
                {confirmDel.username}@{confirmDel.host}:{confirmDel.port}
              </code>
              <br />
              {t('workbench.deleteNote')}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirmDel(null)}>
                {t('serverManager.dupCancel')}
              </button>
              <button className="btn danger" onClick={() => removeTarget(confirmDel)}>
                {t('serverManager.confirmDel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDup && (
        <div className="mask" onClick={() => setConfirmDup(false)}>
          <div className="dialog" ref={dupRef} role="dialog" aria-modal="true" aria-label={t('serverManager.dupTitle')} tabIndex={-1} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--warn)' }}>{t('serverManager.dupTitle')}</h3>
            <div className="body">
              <code>{payload().name}（{payload().host}:{payload().port}）</code>
              <br />
              {t('workbench.duplicateNote')}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirmDup(false)}>
                {t('serverManager.dupCancel')}
              </button>
              <button className="btn primary" onClick={doSave}>
                {t('serverManager.dupOk')}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && <ImportSshConfig onClose={() => setImportOpen(false)} />}
    </div>
  );
}
