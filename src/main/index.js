const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { registerAllIPC } = require('./ipc');
const VersionChecker = require('./services/version-checker');

// 统一使用 Windsurf userData 路径（账号数据已迁移）
const windsurfUserDataPath = path.join(process.env.APPDATA, 'Windsurf');
app.setPath('userData', windsurfUserDataPath);

// 标记IPC是否已注册
let ipcRegistered = false;

// 设置控制台编码为 UTF-8 (修复 Windows 中文乱码)
if (process.platform === 'win32') {
  if (process.stdout && process.stdout.setEncoding) {
    process.stdout.setEncoding('utf8');
  }
  if (process.stderr && process.stderr.setEncoding) {
    process.stderr.setEncoding('utf8');
  }
  process.env.PYTHONIOENCODING = 'utf-8';
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true,
      webviewTag: true
    },
    title: 'Windsurf-Tool',
    show: false // 先不显示，等加载完成
  });

  // 加载完成后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // 使用统一日志系统
    const { logger } = require('./utils/logger');
    logger.system('应用启动成功');
  });

  // 监听渲染进程崩溃
  mainWindow.webContents.on('crashed', () => {
    const { logger } = require('./utils/logger');
    logger.error('渲染进程崩溃');
    dialog.showErrorBox('应用崩溃', '渲染进程崩溃，请重启应用');
  });

  // 监听页面加载失败
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    const { logger } = require('./utils/logger');
    logger.error('页面加载失败', `${errorCode}: ${errorDescription}`);
  });

  // 直接加载主界面
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch(err => {
    const { logger } = require('./utils/logger');
    logger.error('加载HTML失败', err.message);
    dialog.showErrorBox('加载失败', '无法加载应用界面: ' + err.message);
  });
  
  // 开发模式或打包后都打开开发工具（方便调试）
  if (process.argv.includes('--dev') || !app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  // 先进行版本检查
  const versionChecker = new VersionChecker();
  const needsUpdate = await versionChecker.autoCheckForUpdates();
  
  // 如果需要强制更新，不创建主窗口
  if (needsUpdate) {
    return; // 版本检查器会显示更新对话框并退出应用
  }
  
  // 版本检查通过，创建主窗口
  createWindow();
  
  // 注册所有IPC处理器（只注册一次，在窗口创建后）
  if (!ipcRegistered) {
    registerAllIPC(app, mainWindow);
    ipcRegistered = true;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
