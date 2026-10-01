// 主进程：SSH 采集、凭据存储、系统通知都跑在这里（renderer 只负责展示）
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ipc = require('./ipc.cjs');

// 把主进程异常/子进程崩溃落到 userData/error.log，便于排查；不让单点异常直接拖垮整个应用
function logCrash(tag, detail) {
  try {
    const body = typeof detail === 'string' ? detail : JSON.stringify(detail);
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${tag}: ${body}\n`);
  } catch {
    /* noop */
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  // 开发态没有 exe 资源可取，显式给窗口/任务栏一个图标；打包态回退到 exe 内嵌图标
  const windowIcon = path.join(__dirname, '../build/icon_512.png');
  const win = new BrowserWindow({
    width: Math.min(1440, Math.round(width * 0.9)),
    height: Math.min(900, Math.round(height * 0.9)),
    minWidth: 900,
    minHeight: 600,
    title: 'Server Console',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 渲染进程崩溃（最常见是内存压力）后自动重载，而不是停在黑屏；传输在主进程继续，重载后会重新拉取队列
  win.webContents.on('render-process-gone', (_e, details) => {
    logCrash('render-process-gone', details);
    if (details && details.reason !== 'clean-exit') {
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.reload();
        } catch {
          /* noop */
        }
      }, 600);
    }
  });

  // 开发态连 vite dev server；打包态加载 dist
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  return win;
}

app.on('child-process-gone', (_e, details) => logCrash('child-process-gone', details));
process.on('uncaughtException', (e) => logCrash('uncaughtException', (e && e.stack) || String(e)));
process.on('unhandledRejection', (e) => logCrash('unhandledRejection', (e instanceof Error && e.stack) || String(e)));

// 单实例锁：双开会互相覆盖 servers.json，第二个实例直接退出并唤起已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ipc.init();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
