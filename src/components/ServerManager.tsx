import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../state';
import type { ServerConfig } from '../types';
import { ImportSshConfig } from './ImportSshConfig';

type Draft = {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string;
  keyPath: string;
  passphrase: string;
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
};

export function ServerManager({ onClose }: { onClose: () => void }) {
  const { configs, addServer, removeServer, testServer, hasApi, pushToast, refresh } = useStore();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ServerConfig | null>(null);
  const [confirmDel, setConfirmDel] = useState<ServerConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // 密码/口令留空 = 保留已存凭据（payload 中直接省略该键，避免空串覆盖）
  const payload = () => {
    const base = {
      name: draft.name.trim() || draft.host.trim(),
      host: draft.host.trim(),
      port: Number(draft.port) || 22,
      username: draft.username.trim(),
      authType: draft.authType,
    };
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
    });
    setTestResult(`正在编辑：${c.name}（凭据留空则保持不变）`);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setTestResult('');
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult('连接中…');
    const res = await testServer(payload());
    setTesting(false);
    setTestResult(res.ok ? `连接成功：${res.gpus} 张 GPU，${res.processes} 个进程` : `连接失败：${res.error}`);
  };

  const save = async () => {
    if (!draft.host.trim() || !draft.username.trim()) {
      setTestResult('请至少填写主机和用户名');
      return;
    }
    setSaving(true);
    setTestResult(editing ? '保存中…' : '添加中…');
    try {
      if (editing) {
        const r = await api?.updateServer({ id: editing.id, ...payload() });
        if (!r?.ok) throw new Error(r?.error || '更新失败');
        pushToast({ level: 'info', title: '已更新服务器', detail: payload().host });
        await refresh();
        cancelEdit();
        setTestResult(`已更新：${draft.name || draft.host}`);
      } else {
        const res = await addServer(payload());
        if (!res || res.ok === false) throw new Error(res?.error || '主进程未返回结果');
        pushToast({ level: 'info', title: '已添加服务器', detail: payload().host });
        setDraft(emptyDraft);
        setTestResult(`已添加：${payload().name}（${payload().host}），等待首次采集…`);
      }
    } catch (e) {
      setTestResult(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const removeTarget = async (c: ServerConfig) => {
    setConfirmDel(null);
    await removeServer(c.id);
    if (editing?.id === c.id) cancelEdit();
    pushToast({ level: 'info', title: '已删除服务器', detail: `${c.name}（${c.username}@${c.host}）` });
  };

  return (
    <div className="mask" onClick={onClose}>
      <div className="dialog" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          服务器连接
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setImportOpen(true)}>
            从 ~/.ssh/config 一键导入
          </button>
        </h3>

        {!hasApi && (
          <div className="body" style={{ color: 'var(--warn)', marginBottom: 12 }}>
            当前运行在浏览器里（无 Electron 主进程），连接管理不可用。请用 <code>npm run electron:dev</code> 启动。
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>名称</label>
            <input className="mini" style={{ width: '100%' }} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="dgx-01" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>主机</label>
            <input className="mini" style={{ width: '100%' }} value={draft.host} onChange={(e) => set('host', e.target.value)} placeholder="10.20.1.11" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>端口</label>
            <input className="mini" style={{ width: '100%' }} type="number" value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>用户名</label>
            <input className="mini" style={{ width: '100%' }} value={draft.username} onChange={(e) => set('username', e.target.value)} placeholder="root" />
          </div>
        </div>

        <div className="field">
          <label>认证方式</label>
          <div className="seg" style={{ width: 'fit-content' }}>
            <button className={draft.authType === 'password' ? 'on' : ''} onClick={() => set('authType', 'password')}>
              密码
            </button>
            <button className={draft.authType === 'key' ? 'on' : ''} onClick={() => set('authType', 'key')}>
              私钥
            </button>
          </div>
        </div>

        {draft.authType === 'password' ? (
          <div className="field">
            <label>密码{editing ? '（留空保持不变）' : ''}</label>
            <input className="mini" style={{ width: '100%' }} type="password" value={draft.password} onChange={(e) => set('password', e.target.value)} />
          </div>
        ) : (
          <>
            <div className="field">
              <label>私钥文件绝对路径</label>
              <input className="mini mono" style={{ width: '100%' }} value={draft.keyPath} onChange={(e) => set('keyPath', e.target.value)} placeholder="/home/user/.ssh/id_rsa" />
            </div>
            <div className="field">
              <label>私钥口令（可留空{editing ? '，留空保持不变' : ''}）</label>
              <input className="mini" style={{ width: '100%' }} type="password" value={draft.passphrase} onChange={(e) => set('passphrase', e.target.value)} />
            </div>
          </>
        )}

        {testResult && (
          <div className="body" style={{ color: testResult.startsWith('连接成功') || testResult.startsWith('已添加') || testResult.startsWith('已更新') || testResult.startsWith('正在编辑') ? 'var(--ok)' : 'var(--crit)', marginBottom: 10 }}>
            {testResult}
          </div>
        )}

        <div className="foot">
          <button className="btn" disabled={!hasApi || testing} onClick={runTest}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {editing ? (
            <>
              <button className="btn primary" disabled={!hasApi || saving} onClick={save}>
                {saving ? '保存中…' : '保存修改'}
              </button>
              <button className="btn" onClick={cancelEdit}>
                取消编辑
              </button>
            </>
          ) : (
            <button className="btn primary" disabled={!hasApi || saving} onClick={save}>
              {saving ? '添加中…' : '添加'}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="dim" style={{ fontSize: 11.5, marginBottom: 8 }}>
            已保存的连接（凭据加密存于本机，不上传）
          </div>
          {configs.length === 0 && <div className="faint">暂无</div>}
          {configs.map((c: ServerConfig) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <span>{c.name}</span>
              <span className="mono faint">
                {c.username}@{c.host}:{c.port}
              </span>
              <span className="tag">{c.authType === 'key' ? '私钥' : '密码'}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn mini" onClick={() => startEdit(c)}>
                  编辑
                </button>
                <button className="btn danger mini" onClick={() => setConfirmDel(c)}>
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {confirmDel && (
        <div className="mask" onClick={() => setConfirmDel(null)}>
          <div className="dialog" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--warn)' }}>删除服务器连接 {confirmDel.name}？</h3>
            <div className="body">
              <code>
                {confirmDel.username}@{confirmDel.host}:{confirmDel.port}
              </code>
              <br />
              将移除该连接及本机保存的凭据；传输中心的互传任务若仍引用此服务器会失败。
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setConfirmDel(null)}>
                取消
              </button>
              <button className="btn danger" onClick={() => removeTarget(confirmDel)}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && <ImportSshConfig onClose={() => setImportOpen(false)} />}
    </div>
  );
}
