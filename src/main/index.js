const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { registerAllIPC } = require('./ipc');
const VersionChecker = require('./services/version-checker');
const { createTaggedLogger } = require('./utils/logger');

// 创建空标签的日志实例
const logger = createTaggedLogger('');

// 添加命令行参数解决GPU和缓存问题
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');
app.commandLine.appendSwitch('--disable-http-cache');
app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-compositor-resources');
app.commandLine.appendSwitch('--disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('--disable-background-timer-throttling');
app.commandLine.appendSwitch('--disable-renderer-backgrounding');
app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
// 更彻底的GPU禁用
app.commandLine.appendSwitch('--use-gl', 'swiftshader');
app.commandLine.appendSwitch('--disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('--disable-accelerated-jpeg-decoding');
app.commandLine.appendSwitch('--disable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('--disable-accelerated-video-decode');
app.commandLine.appendSwitch('--disable-gpu-compositing');
app.commandLine.appendSwitch('--disable-gpu-rasterization');
app.commandLine.appendSwitch('--disable-gpu-driver-bug-workarounds');

// 统一使用 Windsurf userData 路径（账号数据已迁移）
const windsurfPaths = require('../shared/config/windsurf-paths');

// 同步加密密钥，确保切号功能正常
const fsSync = require('fs');
try {
  const srcPath = path.join(process.env.APPDATA, 'Windsurf', 'Local State');
  const destPath = path.join(app.getPath('userData'), 'Local State');
  if (fsSync.existsSync(srcPath)) {
    fsSync.copyFileSync(srcPath, destPath);
  }
} catch (e) {
  logger.error('初始化失败', e.message);
}

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
    logger.system('应用启动成功');
  });

  // 监听渲染进程崩溃
  mainWindow.webContents.on('crashed', () => {
    logger.error('渲染进程崩溃');
    dialog.showErrorBox('应用崩溃', '渲染进程崩溃，请重启应用');
  });

  // 监听页面加载失败
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error('页面加载失败', `${errorCode}: ${errorDescription}`);
  });

  // 直接加载主界面
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html')).catch(err => {
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
