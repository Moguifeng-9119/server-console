// i18n 组件接线批次 3：剩余全部组件
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const R = (file, pairs) => {
  const fp = path.join(ROOT, file);
  let t = fs.readFileSync(fp, 'utf8');
  let hits = 0;
  for (const [from, to] of pairs) {
    if (!t.includes(from)) {
      console.log('MISS ' + file + ': ' + from.slice(0, 50).replace(/\n/g, '\\n'));
      continue;
    }
    t = t.split(from).join(to);
    hits += 1;
  }
  fs.writeFileSync(fp, t);
  console.log(file + ' applied ' + hits + '/' + pairs.length);
};

// ===== SettingsDrawer.tsx =====
R('src/components/SettingsDrawer.tsx', [
  ["import { useStore, type Density, type ThemeMode } from '../state';", "import { useStore, type Density, type ThemeMode } from '../state';\nimport { useTranslation } from 'react-i18next';\nimport { LANGUAGES } from '../i18n';"],
  ["  } = useStore();\n  const [tofu, setTofu]", "  } = useStore();\n  const { t, i18n } = useTranslation();\n  const [tofu, setTofu]"],
  ["        <h3>设置</h3>", "        <h3>{t('settings.title')}</h3>"],
  ["          <label>主题</label>", "          <label>{t('settings.theme')}</label>"],
  ["    ['system', '跟随系统'],", "    ['system', t('settings.themeSystem')],"],
  ["    ['light', '浅色'],", "    ['light', t('settings.themeLight')],"],
  ["    ['dark', '深色'],", "    ['dark', t('settings.themeDark')],"],
  ["          <label>信息密度</label>", "          <label>{t('settings.density')}</label>"],
  ["    ['compact', '紧凑'],", "    ['compact', t('settings.densCompact')],"],
  ["    ['default', '默认'],", "    ['default', t('settings.densDefault')],"],
  ["    ['comfy', '宽松'],", "    ['comfy', t('settings.densComfy')],"],
  ["          <label>语言 / Language</label>", "          <label>{t('settings.language')}</label>"],
]);

// 语言下拉（在主题后面插入）
let sd = fs.readFileSync('src/components/SettingsDrawer.tsx', 'utf8');
sd = sd.replace(
  "        <div className=\"field\">\n          <label>{t('settings.density')}</label>",
  `        <div className="field">
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
          <label>{t('settings.density')}</label>`
);
// 刷新间隔
sd = sd.replace("          <label>刷新间隔：{refreshMs / 1000}s</label>", "          <label>{t('settings.refresh', { s: refreshMs / 1000 })}</label>");
sd = sd.replace("                {v / 1000} 秒", "                {t('settings.secOption', { s: v / 1000 })}");
// 阈值
sd = sd.replace("          <label>告警阈值：{thresholds.warn}% / {thresholds.high}% / {thresholds.crit}%</label>",
  "          <label>{t('settings.thresholds', { warn: thresholds.warn, high: thresholds.high, crit: thresholds.crit })}</label>");
sd = sd.replace('            <span className="mono" style={{ width: 34, color: \'var(--warn)\' }}>\n              黄\n            </span>',
  '            <span className="mono" style={{ width: 34, color: \'var(--warn)\' }}>\n              {t(\'settings.yellow\')}\n            </span>');
sd = sd.replace('            <span className="mono" style={{ width: 34, color: \'var(--high)\' }}>\n              橙\n            </span>',
  '            <span className="mono" style={{ width: 34, color: \'var(--high)\' }}>\n              {t(\'settings.orange\')}\n            </span>');
sd = sd.replace('            <span className="mono" style={{ width: 34, color: \'var(--crit)\' }}>\n              红\n            </span>',
  '            <span className="mono" style={{ width: 34, color: \'var(--crit)\' }}>\n              {t(\'settings.red\')}\n            </span>');
// 温度
sd = sd.replace("            温度告警阈值：≥ {tempAlert}°C<span className=\"faint\">（GPU 逐卡判定，驱动未上报温度的卡不参与）</span>",
  "            {t('settings.tempAlert', { v: tempAlert })}<span className=\"faint\">{t('settings.tempAlertNote')}</span>");
// 告警开关
sd = sd.replace("            启用告警（新异常只通知一次）\n          </label>", "            {t('settings.alertsEnabled')}\n          </label>");
// 关窗行为
sd = sd.replace("          <label>关窗行为</label>", "          <label>{t('settings.closeAction')}</label>");
sd = sd.replace('            <option value="ask">有传输时询问，无传输直接退出</option>', '            <option value="ask">{t(\'settings.caAsk\')}</option>');
sd = sd.replace('            <option value="minimize">关闭 = 隐藏到托盘（传输继续）</option>', '            <option value="minimize">{t(\'settings.caMinimize\')}</option>');
sd = sd.replace('            <option value="exit">直接退出</option>', '            <option value="exit">{t(\'settings.caExit\')}</option>');
// Webhook
sd = sd.replace("          <label>告警 Webhook（钉钉 / 飞书 / 企微机器人，可选）</label>", "          <label>{t('settings.webhook')}</label>");
sd = sd.replace('              placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"', '              placeholder={t(\'settings.webhookPh\')}');
sd = sd.replace('            <button className="btn" onClick={() => api?.webhookSet({ url: webhookUrl.trim() }).then(() => pushToast({ level: \'info\', title: \'Webhook 已保存\' }))}>', '            <button className="btn" onClick={() => api?.webhookSet({ url: webhookUrl.trim() }).then(() => pushToast({ level: \'info\', title: t(\'settings.webhookSaved\') }))}>');
sd = sd.replace('              测试\n            </button>', '              {t(\'settings.webhookTest\')}\n            </button>');
// 快速命令
sd = sd.replace("          <label>快速命令片段（服务器页顶部可一键执行）</label>", "          <label>{t('settings.snippets')}</label>");
sd = sd.replace('                placeholder="名称"', '                placeholder={t(\'settings.snippetName\')}');
sd = sd.replace('                placeholder="命令"', '                placeholder={t(\'settings.snippetCmd\')}');
sd = sd.replace('                删\n              </button>', '                {t(\'settings.del\')}\n              </button>');
sd = sd.replace('              添加片段\n            </button>', '              {t(\'settings.addSnippet\')}\n            </button>');
sd = sd.replace("              保存片段\n            </button>", "              {t('settings.saveSnippets')}\n            </button>");
sd = sd.replace("title: '快速命令已保存'", "title: t('settings.snippetsSaved')");
// 端口转发
sd = sd.replace("          <label>本地端口转发（等价 ssh -L）</label>", "          <label>{t('settings.portForward')}</label>");
sd = sd.replace('              <option value="">服务器…</option>', '              <option value="">{t(\'settings.fwServer\')}</option>');
sd = sd.replace('placeholder="本地端口"', 'placeholder={t(\'settings.fwLocalPort\')}');
sd = sd.replace('placeholder="远程 host"', 'placeholder={t(\'settings.fwRemoteHost\')}');
sd = sd.replace('placeholder="远程端口"', 'placeholder={t(\'settings.fwRemotePort\')}');
sd = sd.replace('              添加\n            </button>', '              {t(\'settings.fwAdd\')}\n            </button>');
sd = sd.replace('                        启动\n                      </button>', '                        {t(\'settings.fwStart\')}\n                      </button>');
sd = sd.replace('                        停止\n                      </button>', '                        {t(\'settings.fwStop\')}\n                      </button>');
sd = sd.replace('                      删\n                    </button>', '                      {t(\'settings.fwDel\')}\n                    </button>');
sd = sd.replace("{r.status === 'listening' ? '监听中' : r.status === 'error' ? '错误' : '已停止'}",
  "{r.status === 'listening' ? t('settings.fwListening') : r.status === 'error' ? t('settings.fwError') : t('settings.fwStopped')}");
sd = sd.replace("title: '添加失败'", "title: t('settings.fwAddFail')");
// 安全
sd = sd.replace("          <label>安全 · 主机指纹校验</label>", "          <label>{t('settings.security')}</label>");
sd = sd.replace("            首次连接自动信任（TOFU）\n          </label>", "            {t('settings.tofu')}\n          </label>");
sd = sd.replace("            首次连接记录主机指纹；之后指纹不符将拒绝连接（防中间人）。关闭后，未记录指纹的主机一律拒绝。",
  "            {t('settings.tofuNote')}");
sd = sd.replace("                已信任主机（服务器重装/换钥后移除对应条目可重新连接）",
  "                {t('settings.trustedHosts')}");
sd = sd.replace('                    移除\n                  </button>', '                    {t(\'settings.remove\')}\n                  </button>');
// 审计
sd = sd.replace("          <label>操作审计日志</label>", "          <label>{t('settings.audit')}</label>");
sd = sd.replace("{audit.length === 0 && <div className=\"faint\">暂无操作记录</div>}",
  "{audit.length === 0 && <div className=\"faint\">{t('settings.auditEmpty')}</div>}");
// 帮助
sd = sd.replace("          <label>帮助 · 快捷键与操作</label>", "          <label>{t('settings.help')}</label>");
sd = sd.replace('<b>双击侧栏服务器</b><span>直达该机的文件管理</span>', '<b>{t(\'settings.helpDblClick\')}</b><span>{t(\'settings.helpDblClickV\')}</span>');
sd = sd.replace('<b>Ctrl/点击 · Shift/点击</b><span>文件列表多选 / 范围选择</span>', '<b>{t(\'settings.helpCtrlClick\')}</b><span>{t(\'settings.helpCtrlClickV\')}</span>');
sd = sd.replace('<b>Ctrl+A / Esc</b><span>全选当前面板 / 清空选择</span>', '<b>{t(\'settings.helpCtrlA\')}</b><span>{t(\'settings.helpCtrlAV\')}</span>');
sd = sd.replace('<b>右键文件或进程</b><span>更多操作（下载、互传、压缩、结束进程…）</span>', '<b>{t(\'settings.helpRightClick\')}</b><span>{t(\'settings.helpRightClickV\')}</span>');
sd = sd.replace('<b>拖拽文件到右侧面板</b><span>上传到远程当前目录</span>', '<b>{t(\'settings.helpDrag\')}</b><span>{t(\'settings.helpDragV\')}</span>');
sd = sd.replace('<b>Esc（传输中心）</b><span>无活跃传输时可关闭抽屉</span>', '<b>{t(\'settings.helpEsc\')}</b><span>{t(\'settings.helpEscV\')}</span>');
// 关于
sd = sd.replace("          <label>关于</label>", "          <label>{t('settings.about')}</label>");
sd = sd.replace("ServerConsole <b className=\"num\">v{__APP_VERSION__}</b> · 本地优先的多服务器 GPU 监控 / SFTP / 互传工具，数据只经你的本机与你的服务器。",
  "<b>ServerConsole</b> <span className=\"num\">v{__APP_VERSION__}</span> · {t('settings.aboutDesc')}");
sd = sd.replace('              GitHub 仓库\n', '              {t(\'settings.ghRepo\')}\n');
sd = sd.replace('              反馈问题\n', '              {t(\'settings.issues\')}\n');
sd = sd.replace('                检查更新\n              </button>', '                {t(\'settings.checkUpdate\')}\n              </button>');
sd = sd.replace("title: '已是最新版本（' + (r.data?.current || '') + '）'", "title: t('settings.upToDate', { v: r.data?.current || '' })");
sd = sd.replace("title: '发现新版本 ' + (r.data.latest || '')", "title: t('settings.newVersion', { v: r.data.latest || '' })");
sd = sd.replace("detail: '即将打开发布页'", "detail: t('settings.openingRelease')");
sd = sd.replace("title: '检查更新失败'", "title: t('settings.updateFail')");
sd = sd.replace('                placeholder="导出/导入口令（用于加密凭据）"', '                placeholder={t(\'settings.exportPassPh\')}');
sd = sd.replace('                导出\n              </button>', '                {t(\'settings.export\')}\n              </button>');
sd = sd.replace('                导入\n              </button>', '                {t(\'settings.import\')}\n              </button>');
sd = sd.replace("title: '已导出到'", "title: t('settings.exportedTo')");
sd = sd.replace("title: '导出失败'", "title: t('settings.exportFail')");
sd = sd.replace("title: '导入完成'", "title: t('settings.importDone')");
sd = sd.replace("detail: '新增 ' + r.data + ' 台服务器'", "detail: t('settings.importedN', { n: r.data })");
sd = sd.replace("title: '导入失败'", "title: t('settings.importFail')");
// 关闭按钮
sd = sd.replace('        <button className="btn" style={{ width: \'100%\' }} onClick={onClose}>\n          关闭\n        </button>',
  '        <button className="btn" style={{ width: \'100%\' }} onClick={onClose}>\n          {t(\'settings.close\')}\n        </button>');
fs.writeFileSync('src/components/SettingsDrawer.tsx', sd);
console.log('SettingsDrawer done');

// ===== TerminalPane.tsx (TerminalSessions) =====
R('src/components/TerminalPane.tsx', [
  ["import { useStore } from '../state';", "import { useStore } from '../state';\nimport { useTranslation } from 'react-i18next';"],
  ["export function TerminalSessions({ serverId }: { serverId: string }) {\n  const { pushToast } = useStore();",
   "export function TerminalSessions({ serverId }: { serverId: string }) {\n  const { pushToast } = useStore();\n  const { t } = useTranslation();"],
  ["            终端 {i + 1}\n", "            {t('terminal.termN', { n: i + 1 })}\n"],
  ["              title=\"结束此会话\"", "              title={t('terminal.closeSession')}"],
  ["        <button className=\"term-chip add\" title=\"新建终端会话（多开）\" onClick={create}>",
   "        <button className=\"term-chip add\" title={t('terminal.newSession')} onClick={create}>"],
  ["          {loaded ? '点击 ＋ 新建终端会话' : '加载会话…'}", "          {loaded ? t('terminal.clickPlus') : t('terminal.loadingSessions')}"],
  ["        <div className=\"term-status\">{status === 'attaching' ? '挂接会话中…' : '会话已结束'}</div>",
   "        <div className=\"term-status\">{status === 'attaching' ? t('terminal.attaching') : t('terminal.sessionEnded')}</div>"],
]);
R('src/components/TerminalPane.tsx', [
  ["export function TerminalPane({ serverId, termId, onClosed }", "export function TerminalPane({ serverId, termId, onClosed }"],
  ["    const dbg = { dataEvents: 0, wrote: 0 };", "    const dbg = { dataEvents: 0, wrote: 0 };\n    const { t } = useTranslation();"],
  ["        term?.write('\\r\\n\\x1b[33m连接已断开，点击上方「重连」。\\x1b[0m\\r\\n');",
   "        term?.write('\\r\\n\\x1b[33m' + t('terminal.disconnected') + '\\x1b[0m\\r\\n');"],
]);

// ===== TextViewer.tsx =====
R('src/components/TextViewer.tsx', [
  ["import { useStore } from '../state';", "import { useStore } from '../state';\nimport { useTranslation } from 'react-i18next';"],
  ["  const { pushToast } = useStore();", "  const { pushToast } = useStore();\n  const { t } = useTranslation();"],
  ["            <button className={!tail ? 'on' : ''} onClick={() => { setTail(false); load(false); }}>\n              开头\n            </button>",
   "            <button className={!tail ? 'on' : ''} onClick={() => { setTail(false); load(false); }}>\n              {t('textViewer.head')}\n            </button>"],
  ["            <button className={tail ? 'on' : ''} onClick={() => { setTail(true); load(true); }}>\n              最后 500 行\n            </button>",
   "            <button className={tail ? 'on' : ''} onClick={() => { setTail(true); load(true); }}>\n              {t('textViewer.last500')}\n            </button>"],
  ["            <div className=\"empty\">读取中…</div>", "            <div className=\"empty\">{t('textViewer.reading')}</div>"],
  ["            <div className=\"empty\" style={{ color: 'var(--crit)' }}>{err}</div>", "            <div className=\"empty\" style={{ color: 'var(--crit)' }}>{err}</div>"],
  ["          <span className=\"tag\" style={{ color: 'var(--warn)' }}>未保存</span>",
   "          <span className=\"tag\" style={{ color: 'var(--warn)' }}>{t('textViewer.unsaved')}</span>"],
  ["              {saving ? '保存中…' : dirty ? '保存到服务器' : '已保存'}", "              {saving ? t('textViewer.saving') : dirty ? t('textViewer.saveToServer') : t('textViewer.saved')}"],
  ["      pushToast({ level: 'info', title: '已保存到服务器', detail: rp });",
   "      pushToast({ level: 'info', title: t('textViewer.savedToast'), detail: rp });"],
  ["      pushToast({ level: 'error', title: '保存失败', detail: r.error });",
   "      pushToast({ level: 'error', title: t('textViewer.saveFail'), detail: r.error });"],
  ["          <button className=\"btn\" onClick={() => navigator.clipboard?.writeText(text)}>\n            复制全部\n          </button>",
   "          <button className=\"btn\" onClick={() => navigator.clipboard?.writeText(text)}>\n            {t('textViewer.copyAll')}\n          </button>"],
  ["          <button className=\"btn\" onClick={onClose}>\n            关闭\n          </button>", "          <button className=\"btn\" onClick={onClose}>\n            {t('textViewer.close')}\n          </button>"],
  ["    else setErr(r.error || '读取失败');", "    else setErr(r.error || t('textViewer.readFail'));"],
]);

// ===== HistoryDialog.tsx =====
R('src/components/HistoryDialog.tsx', [
  ["import { useStore } from '../state';", "import { useStore } from '../state';\nimport { useTranslation } from 'react-i18next';"],
  ["  const { histories, refreshMs } = useStore();", "  const { histories, refreshMs } = useStore();\n  const { t } = useTranslation();"],
  ["          GPU 利用率历史 · {s.name}", "          {t('history.title', { name: s.name })}"],
  ["    const spanText = n > 1 ? `近 ${seconds >= 3600 ? (seconds / 3600).toFixed(1) + ' 小时' : seconds >= 60 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒'}（${n} 个采样点）` : '';",
   "    const spanText = n > 1 ? t('history.span', { text: seconds >= 3600 ? t('history.hours', { v: (seconds / 3600).toFixed(1) }) : seconds >= 60 ? t('history.minutes', { v: Math.round(seconds / 60) }) : t('history.seconds', { s: seconds }), n });" + "'' : '';"],
  ["              <text x={W - padR} y={H - 8} textAnchor=\"end\" fontSize=\"10\" fill=\"var(--text-faint)\">现在</text>",
   "              <text x={W - padR} y={H - 8} textAnchor=\"end\" fontSize=\"10\" fill=\"var(--text-faint)\">{t('history.now')}</text>"],
  ["              <text x={padL} y={H - 8} fontSize=\"10\" fill=\"var(--text-faint)\">{n > 1 ? `${seconds} 秒前` : ''}</text>",
   "              <text x={padL} y={H - 8} fontSize=\"10\" fill=\"var(--text-faint)\">{n > 1 ? t('history.ago', { s: seconds }) : ''}</text>"],
  ["              <span>当前 <b className=\"num\" style={{ color: 'var(--accent)' }}>{cur}%</b></span>",
   "              <span>{t('history.current')} <b className=\"num\" style={{ color: 'var(--accent)' }}>{cur}%</b></span>"],
  ["              <span>平均 <b className=\"num\">{avg}%</b></span>", "              <span>{t('history.avg')} <b className=\"num\">{avg}%</b></span>"],
  ["              <span>最低 <b className=\"num\">{min}%</b></span>", "              <span>{t('history.min')} <b className=\"num\">{min}%</b></span>"],
  ["              <span>最高 <b className=\"num\" style={{ color: 'var(--high)' }}>{max}%</b></span>",
   "              <span>{t('history.max')} <b className=\"num\" style={{ color: 'var(--high)' }}>{max}%</b></span>"],
  ["            历史数据采集中，稍后再看（应用运行期间持续记录，重启不丢）。",
   "            {t('history.collecting')}"],
  ["            采样间隔随「设置 → 刷新间隔」；左键点击卡片为进入机器。",
   "            {t('history.sampleNote')}"],
  ["          <button className=\"btn primary\" onClick={onClose}>关闭</button>",
   "          <button className=\"btn primary\" onClick={onClose}>{t('history.close')}</button>"],
]);

console.log('i18n wire batch 3 complete');
