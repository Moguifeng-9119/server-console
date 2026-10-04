// i18n 组件接线脚本：把各组件的中文硬编码替换为 t() 调用（一次性迁移工具，可用 node scripts/i18n-wire.cjs 重跑，幂等）
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const R = (file, pairs) => {
  const fp = path.join(ROOT, file);
  let t = fs.readFileSync(fp, 'utf8');
  let hits = 0;
  for (const [from, to] of pairs) {
    if (!t.includes(from)) {
      console.log('MISS ' + file + ': ' + from.slice(0, 60).replace(/\n/g, '\\n'));
      continue;
    }
    t = t.split(from).join(to);
    hits += 1;
  }
  fs.writeFileSync(fp, t);
  console.log(file + ' applied ' + hits + '/' + pairs.length);
};

// ===== App.tsx =====
R('src/App.tsx', [
  ["import { useStore } from './state';", "import { useStore } from './state';\nimport { useTranslation } from 'react-i18next';"],
  ["  const { servers, theme, setTheme, toasts, demo, configs } = useStore();",
   "  const { servers, theme, setTheme, toasts, demo, configs } = useStore();\n  const { t } = useTranslation();"],
  ["    <span>总览</span>", "    <span>{t('nav.overview')}</span>"],
  ["            <span>并行命令</span>", "            <span>{t('nav.parallel')}</span>"],
  ["          {!hasGroups && <div className=\"note\" style={{ padding: '10px 10px 4px' }}>服务器</div>}",
   "          {!hasGroups && <div className=\"note\" style={{ padding: '10px 10px 4px' }}>{t('nav.servers')}</div>}"],
  ["                  文件\n", "                  {t('nav.files')}\n"],
  ["            导入\n          </button>", "            {t('nav.import')}\n          </button>"],
  ["            服务器\n          </button>", "            {t('nav.servers')}\n          </button>"],
  ["            设置\n          </button>", "            {t('nav.settings')}\n          </button>"],
  ["            传输\n", "            {t('topbar.transfers')}\n"],
  ["            <span>搜索服务器 / 命令</span>", "            <span>{t('topbar.search')}</span>"],
  ["              演示数据 · 点此连接真实服务器\n", "              {t('topbar.demoBanner')}\n"],
  ["          <span className=\"title\">{view.kind === 'overview' ? '总览' : view.kind === 'parallel' ? '并行命令' : current?.name}</span>",
   "          <span className=\"title\">{view.kind === 'overview' ? t('nav.overview') : view.kind === 'parallel' ? t('nav.parallel') : current?.name}</span>"],
  ["              最小化到任务栏后传输继续跑；强制退出会中断所有传输（已传部分保留断点，下次可续传）。",
   "              {t('quit.body')}"],
  ["                取消\n              </button>", "                {t('quit.cancel')}\n              </button>"],
  ["                强制退出\n              </button>", "                {t('quit.forceQuit')}\n              </button>"],
  ["                最小化并继续\n              </button>", "                {t('quit.minimize')}\n              </button>"],
  ["        placeholder=\"输入服务器名或动作…\"", "        placeholder={t('palette.placeholder')}"],
  ["          {items.length === 0 && <div className=\"empty\">无匹配项</div>}",
   "          {items.length === 0 && <div className=\"empty\">{t('palette.noMatch')}</div>}"],
  ["label: '连接 ' + s.name,", "label: t('palette.connect', { name: s.name }),"],
  ["      { id: 'overview', label: '打开总览',", "      { id: 'overview', label: t('palette.openOverview'),"],
  ["      { id: 'parallel', label: '打开并行命令',", "      { id: 'parallel', label: t('palette.openParallel'),"],
  ["      { id: 'transfers', label: '打开传输中心',", "      { id: 'transfers', label: t('palette.openTransfers'),"],
  ["      { id: 'settings', label: '打开设置',", "      { id: 'settings', label: t('palette.openSettings'),"],
  ["      { id: 'manager', label: '管理服务器',", "      { id: 'manager', label: t('palette.manageServers'),"],
  ["      { id: 'theme', label: '切换深/浅主题',", "      { id: 'theme', label: t('palette.toggleTheme'),"],
  ["    [servers, openServer, setTheme, theme]", "    [servers, openServer, setTheme, theme, t]"],
]);

// ===== Overview.tsx =====
R('src/components/Overview.tsx', [
  ["import { useStore } from '../state';", "import { useStore } from '../state';\nimport { useTranslation } from 'react-i18next';"],
  ["export function Overview({ onOpen, onHistory }: { onOpen: (id: string) => void; onHistory: (s: Server) => void }) {\n  const { servers } = useStore();",
   "export function Overview({ onOpen, onHistory }: { onOpen: (id: string) => void; onHistory: (s: Server) => void }) {\n  const { servers } = useStore();\n  const { t } = useTranslation();"],
  ["        共 {servers.length} 台 · <span style={{ color: 'var(--ok)' }}>{online} 在线</span> · {servers.length - online} 异常",
   "        {t('overview.total', { total: servers.length, online, bad: servers.length - online })}"],
  ["          <div className=\"k\">进程数{zombies ? ` · ${zombies} 僵尸` : ''}</div>",
   "          <div className=\"k\">{t('overview.processes')}{zombies ? ` · ${zombies} ${t('overview.zombies')}` : ''}</div>"],
  ["          <div className=\"k\">平均利用率</div>", "          <div className=\"k\">{t('overview.avgUtil')}</div>"],
  ["          <div className=\"k\">显存占用</div>", "          <div className=\"k\">{t('overview.vram')}</div>"],
  ["          {online ? `${s.gpus.length} GPU` : s.status === 'timeout' ? '超时' : '离线'}",
   "          {online ? t('overview.ngpu', { n: s.gpus.length }) : s.status === 'timeout' ? t('overview.timeout') : t('overview.offline')}"],
  ["      title=\"单击进入 · 右键查看 GPU 历史曲线\"", "      title={t('overview.cardTitle')}"],
]);

// ===== state.tsx =====
R('src/state.tsx', [
  ["import { api, isElectron } from './api';", "import { api, isElectron } from './api';\nimport i18n from './i18n';"],
  ["      const label: Record<string, string> = {\n        temp: `GPU 温度过高（${s.name}）`,\n        vram: `显存接近占满（${s.name}）`,\n        zombie: `出现僵尸进程（${s.name}）`,\n      };",
   "      const label: Record<string, string> = {\n        temp: i18n.t('state.tempAlert', { name: s.name }),\n        vram: i18n.t('state.vramAlert', { name: s.name }),\n        zombie: i18n.t('state.zombieAlert', { name: s.name }),\n      };"],
  ["          pushToast({ level: 'info', title: `已发送 SIG${signal} → ${pid}`, detail: s?.name ?? '' });",
   "          pushToast({ level: 'info', title: i18n.t('state.sigSent', { signal, pid }), detail: s?.name ?? '' });"],
  ["            pushToast({ level: 'error', title: `结束进程 ${pid} 失败`, detail: res.error });",
   "            pushToast({ level: 'error', title: i18n.t('state.killFail', { pid }), detail: res.error });"],
  ["        if (result === 'ok') pushToast({ level: 'info', title: `正在重启 ${service}`, detail: s?.name });",
   "        if (result === 'ok') pushToast({ level: 'info', title: i18n.t('state.restarting', { service }), detail: s?.name });"],
  ["        else pushToast({ level: 'error', title: `重启 ${service} 失败`, detail });",
   "        else pushToast({ level: 'error', title: i18n.t('state.restartFail', { service }), detail });"],
  ["      pushToast({ level: 'error', title: `进程 ${pid} 不存在`, detail: '可能已自行退出' });",
   "      pushToast({ level: 'error', title: i18n.t('state.procGone', { pid }), detail: i18n.t('state.procGoneDetail') });"],
  ["    if (!api) return { ok: false, error: '当前不在桌面端（无 Electron 主进程）' };",
   "    if (!api) return { ok: false, error: i18n.t('state.desktopOnly') };"],
]);

// ===== ServerPanel.tsx =====
R('src/components/ServerPanel.tsx', [
  ["import { useStore } from '../state';", "import { useStore } from '../state';\nimport { useTranslation } from 'react-i18next';"],
  ["  const { kill, restartService } = useStore();", "  const { kill, restartService } = useStore();\n  const { t } = useTranslation();"],
  ["    { k: '进程总数', v: String(s.processes.length) },", "    { k: t('kpi.processes'), v: String(s.processes.length) },"],
  ["    { k: '僵尸进程', v: String(zombies), color: zombies ? 'var(--crit)' : undefined },", "    { k: t('kpi.zombies'), v: String(zombies), color: zombies ? 'var(--crit)' : undefined },"],
  ["    { k: '平均 GPU 利用率', v: `${Math.round(avg)}%`, color: colorOf(avg) },", "    { k: t('kpi.avgGpu'), v: `${Math.round(avg)}%`, color: colorOf(avg) },"],
  ["    { k: '显存占用', v: `${Math.round(vram)}%`, color: colorOf(vram) },", "    { k: t('kpi.vram'), v: `${Math.round(vram)}%`, color: colorOf(vram) },"],
  ["    { k: '负载 1m', v: s.loadAvg[0].toFixed(1) },", "    { k: t('kpi.load'), v: s.loadAvg[0].toFixed(1) },"],
  ["    { k: `CPU（${s.cpuCores} 核）`, v: `${s.cpuUsage}%`, color: colorOf(s.cpuUsage) },", "    { k: t('kpi.cpu', { cores: s.cpuCores }), v: `${s.cpuUsage}%`, color: colorOf(s.cpuUsage) },"],
  ["    { k: '内存', v: `${Math.round(s.memUsed)}/${Math.round(s.memTotal)}G`, color: colorOf((s.memUsed / s.memTotal) * 100) },", "    { k: t('kpi.mem'), v: `${Math.round(s.memUsed)}/${Math.round(s.memTotal)}G`, color: colorOf((s.memUsed / s.memTotal) * 100) },"],
  ["    { k: 'Swap', v: `${s.swapUsed}/${s.swapTotal}G` },", "    { k: t('kpi.swap'), v: `${s.swapUsed}/${s.swapTotal}G` },"],
  ["              GPU（{s.gpus.length}）", "              {t('server.gpuTab', { n: s.gpus.length })}"],
  ["              进程（{s.processes.length}）", "              {t('server.procTab', { n: s.processes.length })}"],
  ["              文件\n            </button>", "              {t('server.filesTab')}\n            </button>"],
  ["              终端\n            </button>", "              {t('server.termTab')}\n            </button>"],
  ["              右键任意进程行可执行操作", "              {t('server.procHint')}"],
  ["          该节点当前不可达（{s.status === 'timeout' ? '超时' : '离线'}），无法采集数据。",
   "          {t('server.offline', { status: s.status === 'timeout' ? t('server.timeout') : t('server.offlineWord') })}"],
  ["                {p.pid}", "                {p.pid}"],
  ["                {p.user}", "                {p.user}"],
  ["                {p.state}", "                {p.state}"],
  ["                {p.command}", "                {p.command}"],
  ["            placeholder=\"搜索 PID / 用户 / 命令行…\"", "            placeholder={t('proc.searchPh')}"],
  ["            <option value=\"all\">全部用户</option>", "            <option value=\"all\">{t('proc.allUsers')}</option>"],
  ["          只看 GPU 进程\n        </label>", "          {t('proc.onlyGpu')}\n        </label>"],
  ["          {rows.length} / {s.processes.length} 条", "          {t('proc.count', { a: rows.length, b: s.processes.length })}"],
  ["          <div className=\"hdr\">进程 {menu.pid}</div>", "          <div className=\"hdr\">{t('ctx.proc', { pid: menu.pid })}</div>"],
  ["            结束进程（SIGTERM）\n          </button>", "            {t('ctx.termSig')}\n          </button>"],
  ["            强制结束（SIGKILL）\n          </button>", "            {t('ctx.forceKill')}\n          </button>"],
  ["            复制 PID\n          </button>", "            {t('ctx.copyPid')}\n          </button>"],
  ["            复制命令行\n          </button>", "            {t('ctx.copyCmd')}\n          </button>"],
  ["            重启服务…\n          </button>", "            {t('ctx.restartSvc')}\n          </button>"],
  ["              确认{confirm.signal === 'KILL' ? '强制' : ''}结束进程 {confirm.pid}？",
   "              {t('ctx.confirmKillTitle', { force: confirm.signal === 'KILL' ? t('ctx.forceWord') : '', pid: confirm.pid })}"],
  ["              目标机器：<code>{s.name}</code>（{s.host}）", "              {t('ctx.targetMachine')} <code>{s.name}</code>（{s.host}）"],
  ["              命令行：<code>{target?.command ?? '（进程已退出）'}</code>",
   "              {t('ctx.cmdline')} <code>{target?.command ?? ''}</code>"],
  ["              将执行：<code>kill -{confirm.signal === 'KILL' ? '9' : '15'} {confirm.pid}</code>",
   "              {t('ctx.willExec')} <code>kill -{confirm.signal === 'KILL' ? '9' : '15'} {confirm.pid}</code>"],
  ["              <span style={{ color: 'var(--warn)' }}>此操作不可撤销，已记录到本地审计日志。</span>",
   "              <span style={{ color: 'var(--warn)' }}>{t('ctx.irreversible')}</span>"],
  ["              <button className=\"btn\" onClick={() => setConfirm(null)}>\n                取消\n              </button>",
   "              <button className=\"btn\" onClick={() => setConfirm(null)}>\n                {t('ctx.cancel')}\n              </button>"],
  ["                确认执行\n              </button>", "                {t('ctx.confirmExec')}\n              </button>"],
  ["            <h3>重启 systemd 服务</h3>", "            <h3>{t('restart.title')}</h3>"],
  ["              <label>服务名</label>", "              <label>{t('restart.svcName')}</label>"],
  ["              将在 <code>{s.name}</code> 上执行：<code>systemctl restart {svcName.trim() || '…'}</code>",
   "              {t('restart.willExecOn', { name: s.name })} <code>systemctl restart {svcName.trim() || '…'}</code>"],
  ["              <button className=\"btn\" onClick={() => setRestartAsk(false)}>\n                取消\n              </button>",
   "              <button className=\"btn\" onClick={() => setRestartAsk(false)}>\n                {t('ctx.cancel')}\n              </button>"],
  ["              <button className=\"btn primary\" disabled={!svcName.trim()} onClick={doRestart}>\n                确认重启\n              </button>",
   "              <button className=\"btn primary\" disabled={!svcName.trim()} onClick={doRestart}>\n                {t('restart.confirmRestart')}\n              </button>"],
]);

// ===== gpu 标签（ServerPanel GpuList）=====
R('src/components/ServerPanel.tsx', [
  ["              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>利用率</span>",
   "              <span className=\"note\">{t('gpu.util')}</span>"],
  ["              <span className=\"note\">显存 {memPct.toFixed(0)}%</span>",
   "              <span className=\"note\">{t('gpu.vramPct', { v: memPct.toFixed(0) })}</span>"],
  ["                温度<b style={g.temp == null ? undefined : { color: colorOf(g.temp) }}>{g.temp == null ? 'N/A' : `${g.temp}°C`}</b>",
   "                {t('gpu.temp')}<b style={g.temp == null ? undefined : { color: colorOf(g.temp) }}>{g.temp == null ? t('gpu.na') : `${g.temp}°C`}</b>"],
  ["                功耗<b>{g.power == null ? 'N/A' : `${g.power} W`}</b>",
   "                {t('gpu.power')}<b>{g.power == null ? t('gpu.na') : `${g.power} W`}</b>"],
  ["                风扇<b>{g.fan == null ? 'N/A' : `${g.fan}%`}</b>",
   "                {t('gpu.fan')}<b>{g.fan == null ? t('gpu.na') : `${g.fan}%`}</b>"],
  ["                  {g.procs.length === 0 && <span className=\"faint\">无进程占用</span>}",
   "                  {g.procs.length === 0 && <span className=\"faint\">{t('gpu.noProcs')}</span>}"],
  ["                  {g.procs.map((p) => (\n                    <div\n                      key={p.pid}\n                      onContextMenu={(e) => {\n                        e.preventDefault();\n                        onMenu(p.pid, e.clientX, e.clientY);\n                      }}\n                      className=\"gpu-proc-line\"\n                    >",
   "                  {g.procs.map((p) => (\n                    <div\n                      key={p.pid}\n                      onContextMenu={(e) => {\n                        e.preventDefault();\n                        onMenu(p.pid, e.clientX, e.clientY);\n                      }}\n                      className=\"gpu-proc-line\"\n                    >"],
]);

console.log('i18n wire batch 1 complete');
