import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, type Density, type ThemeMode } from '../state';
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
    ['system', '跟随系统'],
    ['light', '浅色'],
    ['dark', '深色'],
  ];
  const densities: Array<[Density, string]> = [
    ['compact', '紧凑'],
    ['default', '默认'],
    ['comfy', '宽松'],
  ];

  return (
    <>
      <div className="mask" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose} />
      <div className="drawer">
        <h3>设置</h3>

        <div className="field">
          <label>主题</label>
          <div className="seg">
            {themes.map(([v, l]) => (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>信息密度</label>
          <div className="seg">
            {densities.map(([v, l]) => (
              <button key={v} className={density === v ? 'on' : ''} onClick={() => setDensity(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>刷新间隔：{refreshMs / 1000}s</label>
          <select className="mini" value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
            {[1000, 2000, 5000, 10000].map((v) => (
              <option key={v} value={v}>
                {v / 1000} 秒
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
              黄
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
              橙
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
              红
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
            启用告警（新异常只通知一次）
          </label>
        </div>

        <div className="field">
          <label>
            温度告警阈值：≥ {tempAlert}°C<span className="faint">（GPU 逐卡判定，驱动未上报温度的卡不参与）</span>
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
          <label>安全 · 主机指纹校验</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={tofu ?? true}
              disabled={!api || tofu === null}
              onChange={(e) => api?.securitySet({ tofu: e.target.checked }).then((o) => setTofu(o.tofu))}
            />
            首次连接自动信任（TOFU）
          </label>
          <div className="note" style={{ marginTop: 4 }}>
            首次连接记录主机指纹；之后指纹不符将拒绝连接（防中间人）。关闭后，未记录指纹的主机一律拒绝。
          </div>
          {hosts.length > 0 && (
            <div className="audit" style={{ marginTop: 8 }}>
              <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                已信任主机（服务器重装/换钥后移除对应条目可重新连接）
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
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label>关窗行为</label>
          <select
            className="mini"
            value={closeAction}
            onChange={(e) => {
              const v = e.target.value as 'ask' | 'minimize' | 'exit';
              setCloseAction(v);
              api?.setAppSettings({ closeAction: v });
            }}
          >
            <option value="ask">有传输时询问，无传输直接退出</option>
            <option value="minimize">关闭 = 隐藏到托盘（传输继续）</option>
            <option value="exit">直接退出</option>
          </select>
        </div>

        <div className="field">
          <label>告警 Webhook（钉钉 / 飞书 / 企微机器人，可选）</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="mini mono"
              style={{ flex: 1 }}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
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
              测试
            </button>
          </div>
        </div>

        <div className="field">
          <label>快速命令片段（服务器页顶部可一键执行）</label>
          {snippets.map((sn, i) => (
            <div className="row" style={{ gap: 6, marginBottom: 6 }} key={sn.id}>
              <input
                className="mini"
                style={{ width: 130 }}
                value={sn.name}
                placeholder="名称"
                onChange={(e) =>
                  setSnippets((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                className="mini mono"
                style={{ flex: 1 }}
                value={sn.cmd}
                placeholder="命令"
                onChange={(e) =>
                  setSnippets((prev) => prev.map((x, j) => (j === i ? { ...x, cmd: e.target.value } : x)))
                }
              />
              <button className="btn mini danger" onClick={() => setSnippets((prev) => prev.filter((_, j) => j !== i))}>
                删
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn mini"
              onClick={() => setSnippets((prev) => [...prev, { id: `sn_${Date.now().toString(36)}`, name: '', cmd: '' }])}
            >
              添加片段
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn mini primary"
              onClick={() => api?.snippetsSet(snippets.filter((s) => s.name.trim() && s.cmd.trim())).then(() => pushToast({ level: 'info', title: '快速命令已保存' }))}
            >
              保存片段
            </button>
          </div>
        </div>

        <div className="field">
          <label>本地端口转发（等价 ssh -L）</label>
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
                      {r.status === 'listening' ? '监听中' : r.status === 'error' ? '错误' : '已停止'}
                    </span>
                    {r.status === 'listening' ? (
                      <button className="btn mini" onClick={() => api?.forwardingsStop(r.id)}>
                        停止
                      </button>
                    ) : (
                      <button className="btn mini" onClick={() => api?.forwardingsStart(r.id).then((x) => x && !x.ok && pushToast({ level: 'error', title: '启动失败', detail: x.error }))}>
                        启动
                      </button>
                    )}
                    <button
                      className="btn mini danger"
                      onClick={() => api?.forwardingsRemove(r.id)}
                    >
                      删
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <select className="mini" value={newRule.serverId} onChange={(e) => setNewRule((p) => ({ ...p, serverId: e.target.value }))}>
              <option value="">服务器…</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="mini num" style={{ width: 76 }} placeholder="本地端口" value={newRule.localPort} onChange={(e) => setNewRule((p) => ({ ...p, localPort: e.target.value }))} />
            <input className="mini mono" style={{ width: 110 }} placeholder="远程 host" value={newRule.remoteHost} onChange={(e) => setNewRule((p) => ({ ...p, remoteHost: e.target.value }))} />
            <input className="mini num" style={{ width: 76 }} placeholder="远程端口" value={newRule.remotePort} onChange={(e) => setNewRule((p) => ({ ...p, remotePort: e.target.value }))} />
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
                  if (r && !r.ok) pushToast({ level: 'error', title: '添加失败', detail: r.error });
                  else {
                    setNewRule({ serverId: '', localPort: '', remoteHost: '127.0.0.1', remotePort: '' });
                    a.forwardingsList().then(setRules);
                  }
                });
              }}
            >
              添加
            </button>
          </div>
        </div>

        <div className="field">
          <label>操作审计日志</label>
          <div className="audit">
            {audit.length === 0 && <div className="faint">暂无操作记录</div>}
            {audit.map((e) => (
              <div className="e" key={e.id}>
                {e.time} · {e.server} · {e.action} · {e.target}
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label>帮助 · 快捷键与操作</label>
          <div className="help-list">
            <div className="e"><b>双击侧栏服务器</b><span>直达该机的文件管理</span></div>
            <div className="e"><b>Ctrl/点击 · Shift/点击</b><span>文件列表多选 / 范围选择</span></div>
            <div className="e"><b>Ctrl+A / Esc</b><span>全选当前面板 / 清空选择</span></div>
            <div className="e"><b>右键文件或进程</b><span>更多操作（下载、互传、压缩、结束进程…）</span></div>
            <div className="e"><b>拖拽文件到右侧面板</b><span>上传到远程当前目录</span></div>
            <div className="e"><b>Esc（传输中心）</b><span>无活跃传输时可关闭抽屉</span></div>
          </div>
        </div>

        <div className="field">
          <label>关于</label>
          <div className="body" style={{ color: 'var(--text-dim)' }}>
            ServerConsole <b className="num">v{__APP_VERSION__}</b> · 本地优先的多服务器 GPU 监控 / SFTP / 互传工具，数据只经你的本机与你的服务器。
            <div style={{ marginTop: 6, display: 'flex', gap: 12 }}>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console" target="_blank" rel="noreferrer">GitHub 仓库</a>
              <a className="link" href="https://github.com/Moguifeng-9119/server-console/issues" target="_blank" rel="noreferrer">反馈问题</a>
              <button
                className="link"
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
                onClick={() =>
                  api?.checkUpdate().then((r) => {
                    if (r?.ok && r.data?.isNew) pushToast({ level: 'info', title: '发现新版本 ' + (r.data.latest || ''), detail: '即将打开发布页' });
                    else if (r?.ok) pushToast({ level: 'info', title: '已是最新版本（' + (r.data?.current || '') + '）' });
                    else pushToast({ level: 'error', title: '检查更新失败', detail: r?.error });
                    if (r?.ok && r.data?.isNew && r.data.url) window.open(r.data.url, '_blank');
                  })
                }
              >
                检查更新
              </button>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="mini"
                style={{ flex: 1 }}
                type="password"
                placeholder="导出/导入口令（用于加密凭据）"
                value={exportPass}
                onChange={(e) => setExportPass(e.target.value)}
              />
              <button
                className="btn mini"
                disabled={!exportPass}
                onClick={() =>
                  api?.configExport(exportPass).then((r) => {
                    if (r?.ok && r.data) pushToast({ level: 'info', title: '已导出到', detail: r.data });
                    else if (r && !r.ok) pushToast({ level: 'error', title: '导出失败', detail: r.error });
                  })
                }
              >
                导出
              </button>
              <button
                className="btn mini"
                disabled={!exportPass}
                onClick={() =>
                  api?.configImport(exportPass).then((r) => {
                    if (r?.ok && Number(r.data) >= 0) {
                      pushToast({ level: 'info', title: '导入完成', detail: '新增 ' + r.data + ' 台服务器' });
                      refresh();
                    } else if (r && !r.ok) pushToast({ level: 'error', title: '导入失败', detail: r.error });
                  })
                }
              >
                导入
              </button>
            </div>
          </div>
        </div>

        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          关闭
        </button>
      </div>
    </>
  );
}
