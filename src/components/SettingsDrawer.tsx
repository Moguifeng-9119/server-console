import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, type Density, type ThemeMode } from '../state';
import type { TrustedHost } from '../types';

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
  } = useStore();
  const [tofu, setTofu] = useState<boolean | null>(null);
  const [hosts, setHosts] = useState<TrustedHost[]>([]);

  useEffect(() => {
    if (!api) return;
    api.securityGet().then((o) => setTofu(o.tofu)).catch(() => {});
    api.hostKeysList().then(setHosts).catch(() => {});
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

        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          关闭
        </button>
      </div>
    </>
  );
}
