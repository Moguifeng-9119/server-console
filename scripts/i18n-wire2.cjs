// i18n 组件接线批次 2：TransferDrawer / TextViewer
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

// ===== TransferDrawer.tsx =====
R('src/components/TransferDrawer.tsx', [
  ["import { useTransfers } from '../transfers';", "import { useTransfers } from '../transfers';\nimport { useTranslation } from 'react-i18next';"],
  ["export function TransferDrawer() {\n  const tf = useTransfers();", "export function TransferDrawer() {\n  const tf = useTransfers();\n  const { t } = useTranslation();"],
  ["const STATUS_TEXT: Record<TransferStatus, string> = {\n  queued: '排队中',\n  running: '传输中',\n  paused: '已暂停',\n  done: '已完成',\n  error: '失败',\n  canceled: '已取消',\n};\n\n", ""],
  ["          <h2>传输中心</h2>", "          <h2>{t('transfer.center')}</h2>"],
  ["{tf.runningCount} 个传输中 · 总进度 {overall}%", "{t('transfer.live', { n: tf.runningCount, p: overall })}"],
  ["          {STATUS_TEXT[t.status] || t.status}", "          {t('transfer.' + t.status)}"],
  [" title=\"提前\"><ArrowUp size={12} /></button>", " title={t('transfer.moveUp')}><ArrowUp size={12} /></button>"],
  [" title=\"置后\"><ArrowDown size={12} /></button>", " title={t('transfer.moveDown')}><ArrowDown size={12} /></button>"],
  ["onClick={() => tf.pause(t.id)}>暂停</button>", "onClick={() => tf.pause(t.id)}>{t('transfer.pauseBtn')}</button>"],
  ["onClick={() => tf.resume(t.id)}>续传</button>", "onClick={() => tf.resume(t.id)}>{t('transfer.resumeBtn')}</button>"],
  ["onClick={() => tf.retry(t.id)}>重试</button>", "onClick={() => tf.retry(t.id)}>{t('transfer.retryBtn')}</button>"],
  ["onClick={() => tf.cancel(t.id)}>取消</button>", "onClick={() => tf.cancel(t.id)}>{t('transfer.cancel')}</button>"],
  ["onClick={() => tf.remove(t.id)}>移除</button>", "onClick={() => tf.remove(t.id)}>{t('transfer.removeBtn')}</button>"],
  ["            {t.direct ? `直传${t.directMode ? '·' + t.directMode : ''}` : '中继'}",
   "            {t.direct ? t('transfer.direct', { mode: t.directMode ? '·' + t.directMode : '' }) : t('transfer.relay')}"],
  ["            title={t.direct ? `服务器直传${t.directMode ? ' · ' + t.directMode : ''}${t.directNote ? '\\n' + t.directNote : ''}` : '经本机中继转发'}",
   "            title={t.direct ? t('transfer.directTip', { mode: t.directMode ? ' · ' + t.directMode : '', note: t.directNote ? '\\n' + t.directNote : '' }) : t('transfer.relayTip')}"],
  ["            <Hourglass size={11} /> 等待同目标", "            <Hourglass size={11} /> {t('transfer.waitConflict')}"],
  ["          <span className=\"td-now num\">{formatSpeed(t.speed)}</span>", "          <span className=\"td-now num\">{formatSpeed(t.speed)}</span>"],
  ["{status === 'live' ? '已连接' : '连接中…'}", "{status === 'live' ? '已连接' : '连接中…'}"],
  ["          <span className=\"td-badge wait\" title=\"同一目标有任务正在传输，为避免交错写入损坏文件，本任务暂缓启动\">",
   "          <span className=\"td-badge wait\" title={t('transfer.waitConflictTip')}>"],
  ["            <button className=\"btn icon-btn\" title={full ? '还原' : '全屏'} onClick={() => setFull((v) => !v)}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>",
   "            <button className=\"btn icon-btn\" title={full ? t('transfer.restore') : t('transfer.fullscreen')} onClick={() => setFull((v) => !v)}>{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>"],
  ["            <button className=\"btn icon-btn\" title=\"关闭\" onClick={() => setOpen(false)}><X size={13} /></button>",
   "            <button className=\"btn icon-btn\" title={t('transfer.close')} onClick={() => setOpen(false)}><X size={13} /></button>"],
  ["              {t('transfer.all')}\n            </button>", "              {t('transfer.all')}\n            </button>"],
]);

console.log('wire2 part A complete');
