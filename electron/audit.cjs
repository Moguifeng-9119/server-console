// 操作审计日志：主进程持有，追加写 userData/audit.log（JSONL）。
// 渲染层的内存列表只是最近条目的视图；重启后仍可回溯（这正是它区别于 state 的意义）。
let dataDir = '';
function init(dir) {
  dataDir = dir;
  file = null;
}
const fs = require('node:fs');
const path = require('node:path');

const LOAD_LAST = 100; // 启动时回读最近条数
const FILE_MAX_LINES = 2000; // 文件最大行数，超出截断头部
let file = null;

function auditFile() {
  if (!file) file = path.join(dataDir || require('electron').app.getPath('userData'), 'audit.log');
  return file;
}

function loadRecent() {
  try {
    const lines = fs.readFileSync(auditFile(), 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-LOAD_LAST)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // 新的在前，与渲染层内存序一致
  } catch {
    return [];
  }
}

function append(entry) {
  try {
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true });
    fs.appendFileSync(auditFile(), JSON.stringify(entry) + '\n', 'utf8');
    trim();
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function trim() {
  try {
    const p = auditFile();
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    if (lines.length > FILE_MAX_LINES) {
      fs.writeFileSync(p, lines.slice(-FILE_MAX_LINES).join('\n') + '\n', 'utf8');
    }
  } catch {
    /* ignore */
  }
}

module.exports = { init, loadRecent, append };
