// 主进程：SSH 采集、凭据存储、系统通知都跑在这里（renderer 只负责展示）
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const ipc = require('./ipc.cjs');

let mainWindow = null;
let forceQuit = false; // 用户在确认框里选了强制退出后置位，绕过关窗拦截
let tray = null;
let closeAction = 'ask'; // ask=每次询问 | minimize=隐藏到托盘 | exit=直接退出

const appSettingsFile = () => path.join(app.getPath('userData'), 'appsettings.json');
function loadAppSettings() {
  try {
    const o = JSON.parse(fs.readFileSync(appSettingsFile(), 'utf8'));
    if (['ask', 'minimize', 'exit'].includes(o.closeAction)) closeAction = o.closeAction;
  } catch {
    /* 默认 ask */
  }
}

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
    title: 'ServerConsole',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
    // Windows 自绘标题栏：系统按钮覆盖在应用上，侧栏品牌区自然衔接
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f4f7fb', symbolColor: '#0f1b2d', height: 34 } } : {}),
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

  // 关窗行为：exit=直接关；minimize=隐藏到托盘；ask=有活跃传输时询问渲染层
  win.on('close', (e) => {
    if (forceQuit) return;
    if (closeAction === 'minimize' && tray) {
      e.preventDefault();
      win.hide();
      return;
    }
    if (closeAction === 'ask' && ipc.hasActiveTransfers()) {
      e.preventDefault();
      try {
        win.webContents.send('app:confirm-quit');
      } catch {
        /* 渲染层不可达（已崩溃等）：放行关闭，避免关不掉 */
        forceQuit = true;
        win.destroy();
      }
    }
  });

  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow = win;

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

// 关窗确认框的两个去向：后台继续（有托盘时隐藏，否则最小化）与强制退出
ipcMain.on('app:background-continue', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (tray) mainWindow.hide();
  else mainWindow.minimize();
});
ipcMain.on('app:force-quit', () => {
  forceQuit = true;
  app.quit();
});
ipcMain.on('app:show-main', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
});
ipcMain.handle('app:get-settings', () => ({ closeAction }));
ipcMain.handle('app:check-update', async () => {
  try {
    const res = await fetch('https://api.github.com/repos/Moguifeng-9119/server-console/releases/latest', {
      headers: { 'user-agent': 'server-console' },
      signal: AbortSignal.timeout(8000),
    });
    const j = /** @type {Record<string, unknown>} */ (await res.json());
    const latest = String(j.tag_name || '');
    const current = 'v' + app.getVersion();
    const pa = latest.replace(/^v/, '').split('.').map(Number);
    const pb = current.replace(/^v/, '').split('.').map(Number);
    const isNew = pa[0] > pb[0] || (pa[0] === pb[0] && (pa[1] > pb[1] || (pa[1] === pb[1] && (pa[2] || 0) > (pb[2] || 0))));
    return { ok: true, data: { latest, current, isNew, url: typeof j.html_url === 'string' ? j.html_url : '' } };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('app:set-settings', (_e, o) => {
  if (['ask', 'minimize', 'exit'].includes(o?.closeAction)) closeAction = o.closeAction;
  fs.mkdirSync(path.dirname(appSettingsFile()), { recursive: true });
  fs.writeFileSync(appSettingsFile(), JSON.stringify({ closeAction }, null, 2), { mode: 0o600 });
  return true;
});

function createTray() {
  const iconPath = path.join(__dirname, '../build/icon_512.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : undefined;
  tray = new Tray(img || nativeImage.createEmpty());
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => mainWindow && !mainWindow.isDestroyed() ? (mainWindow.show(), mainWindow.focus()) : createWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('ServerConsole');
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else createWindow();
  });
}

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
    if (process.env.SC_USER_DATA) app.setPath('userData', process.env.SC_USER_DATA); // e2e 测试隔离
    loadAppSettings();
    ipc.init();
    createWindow();
    try {
      createTray();
    } catch (e) {
      logCrash('tray-create-failed', e);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
