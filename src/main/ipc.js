/**
 * IPC处理注册中心
 * 按页面模块组织所有IPC处理
 */

const { ipcMain, dialog, shell, app } = require('electron');
const { registerHomeIPC } = require('./services/home-ipc');
const { initStripeHandlers } = require('./services/stripe-handler');
const path = require('path');
const fs = require('fs').promises;
const VersionChecker = require('./services/version-checker');
const { createTaggedLogger } = require('./utils/logger');

/**
 * 注册所有IPC处理器
 * @param {Electron.App} app 
 * @param {Electron.BrowserWindow} mainWindow 
 */
function registerAllIPC(app, mainWindow) {
  // 统一路径配置 - 避免重复引用
  const windsurfPaths = require('../shared/config/windsurf-paths');
  const JSON_DATA_DIR = windsurfPaths.getJsonDataDir();
  const WINDSURF_DATA_DIR = windsurfPaths.getDataDir();
  const WINDSURF_CACHE_DIR = windsurfPaths.getCacheDir();
  
  // 常用文件路径
  const ACCOUNTS_FILE = path.join(JSON_DATA_DIR, 'accounts.json');
  const CARDS_FILE = path.join(JSON_DATA_DIR, 'virtual-cards.json');
  const SETTINGS_FILE = path.join(JSON_DATA_DIR, 'settings.json');
  const CURRENT_LOGIN_FILE = path.join(WINDSURF_DATA_DIR, 'current_login.json');
  
  // 创建空标签的日志实例
  const systemLogger = createTaggedLogger('');
  
  // 注册状态管理
  let currentRegistrationBot = null;
  let shouldCancelRegistration = false;
  
  // 取消订阅状态管理
  let currentCanceller = null;
  let shouldCancelSubscription = false;

  // 注册首页IPC
  registerHomeIPC(app);
  
  // 注册Stripe绑卡IPC
  initStripeHandlers(mainWindow);

  // 注册基础IPC处理器（虚拟卡管理在后面）

  // ==================== 统一设置管理 ====================

  // 读取设置文件
  async function getSettings() {
    try {
      const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // 返回默认设置
      return {
        language: 'zh-CN',
        windsurfPath: '',
        useCustomWindsurfPath: false,
        dataPath: JSON_DATA_DIR,
        useCustomDataPath: false,
        emailDomains: [],
        emailConfig: {
          host: '',
          port: 993,
          user: '',
          password: ''
        }
      };
    }
  }

  // 保存设置文件
  async function saveSettings(settings) {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  }

  // 语言设置
  ipcMain.handle('save-language', async (event, language) => {
    try {
      const settings = await getSettings();
      settings.language = language;
      await saveSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-language', async () => {
    try {
      const settings = await getSettings();
      return { success: true, language: settings.language };
    } catch (error) {
      return { success: false, language: 'zh-CN' };
    }
  });

  // ==================== 账号管理 ====================
  ipcMain.handle('get-accounts', async () => {
    try {
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      const accounts = JSON.parse(data);
      return accounts;
    } catch (error) {
      systemLogger.error(`读取账号文件失败: ${error.message}`);
      return [];
    }
  });

  ipcMain.handle('save-accounts', async (event, accounts) => {
    try {
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('add-account', async (event, account) => {
    try {
      let accounts = [];
      try {
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        accounts = JSON.parse(data);
      } catch (error) {
        // 文件不存在，使用空数组
      }
      
      // 判重：检查邮箱是否已存在
      const exists = accounts.find(acc => acc.email === account.email);
      if (exists) {
        return { success: false, error: '该邮箱已存在' };
      }
      
      account.id = Date.now().toString();
      // 不自动设置 createdAt，让账号保持未知状态，等刷新后获取真实数据
      // 只有通过刷新操作才会设置真实的创建时间
      accounts.push(account);
      
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      return { success: true, account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-account', async (event, accountId) => {
    try {
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      let accounts = JSON.parse(data);
      accounts = accounts.filter(acc => acc.id !== accountId);
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ==================== Windsurf管理 ====================
  ipcMain.handle('clear-windsurf', async () => {
    try {
      const pathsToDelete = [WINDSURF_DATA_DIR, path.join(WINDSURF_CACHE_DIR, 'Cache')];
      
      for (const dirPath of pathsToDelete) {
        try {
          await fs.access(dirPath);
          await fs.rm(dirPath, { recursive: true, force: true });
          systemLogger.info(`已删除: ${dirPath}`);
        } catch (error) {
          systemLogger.debug(`跳过: ${dirPath} (${error.message})`);
        }
      }
      
      return { success: true, message: 'Windsurf配置已清除' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('switch-account', async (event, account) => {
    try {
      const AccountSwitcher = require('./services/account-switcher');
      
      // 进度回调 - 发送专门的进度事件
      const progressCallback = (progress) => {
        mainWindow.webContents.send('switch-progress', progress);
      };
      
      const switcher = new AccountSwitcher(null, null, progressCallback);
      
      // 执行自动切号
      const switchResult = await switcher.switchAccountAdvanced(account.email, account.password);
      
      // 保存当前登录信息到Windsurf数据目录
      await fs.writeFile(CURRENT_LOGIN_FILE, JSON.stringify(account, null, 2));
      
      return { 
        success: true, 
        message: switchResult.message,
        needsRestart: switchResult.needsRestart,
        windsurfStarted: switchResult.windsurfStarted,
        account: switchResult.account
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('batch-register', async (event, config) => {
    const RegistrationBot = require('./services/registration');
    const bot = new RegistrationBot(config);
    
    // 保存当前注册实例
    currentRegistrationBot = bot;
    shouldCancelRegistration = false;
    
    // 设置取消检查函数
    bot.setCancelChecker(() => shouldCancelRegistration);
    
    try {
      const result = await bot.batchRegister(config.count, (progress) => {
        mainWindow.webContents.send('registration-progress', progress);
      }, (log) => {
        // 发送到注册日志窗口（系统日志已经在 registration.js 中自动处理）
        mainWindow.webContents.send('registration-log', log);
      }, config.concurrent);
      
      return result;
    } finally {
      // 清理状态
      currentRegistrationBot = null;
      shouldCancelRegistration = false;
    }
  });

  // 取消注册
  ipcMain.handle('cancel-registration', async () => {
    if (currentRegistrationBot) {
      shouldCancelRegistration = true;
      mainWindow.webContents.send('registration-log', '⚠️ 正在取消注册...');
      return { success: true, message: '取消请求已发送' };
    } else {
      return { success: false, message: '没有正在进行的注册' };
    }
  });

  // 批量取消订阅
  ipcMain.handle('batch-cancel-subscription', async (event, config) => {
    const SubscriptionCanceller = require('./services/subscription-canceller');
    const canceller = new SubscriptionCanceller();
    
    // 保存当前实例
    currentCanceller = canceller;
    shouldCancelSubscription = false;
    
    // 设置取消检查函数
    canceller.setCancelChecker(() => shouldCancelSubscription);
    
    try {
      const result = await canceller.batchCancel(
        config.accounts,
        (progress) => {
          mainWindow.webContents.send('cancel-progress', progress);
        },
        null, // logCallback 不再需要，logger 会自动发送
        config.concurrent || 3
      );
      
      return result;
    } finally {
      // 清理状态
      currentCanceller = null;
      shouldCancelSubscription = false;
    }
  });

  // 取消订阅操作
  ipcMain.handle('cancel-subscription-operation', async () => {
    if (currentCanceller) {
      shouldCancelSubscription = true;
      mainWindow.webContents.send('cancel-log', '⚠️ 正在取消操作...');
      return { success: true, message: '取消请求已发送' };
    } else {
      return { success: false, message: '没有正在进行的取消订阅操作' };
    }
  });

  ipcMain.handle('get-current-login', async () => {
    try {
      const data = await fs.readFile(CURRENT_LOGIN_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('test-imap', async (event, config) => {
    try {
      const EmailReceiver = require('./services/email');
      const receiver = new EmailReceiver(config);
      return await receiver.testConnection();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 邮箱配置
  ipcMain.handle('get-email-config', async () => {
    try {
      const settings = await getSettings();
      
      // 返回前端期望的完整配置格式
      const config = {
        emailDomains: settings.emailDomains || [],
        emailConfig: settings.emailConfig || {
          host: '',
          port: 993,
          user: '',
          password: ''
        }
      };
      
      return JSON.stringify(config);
    } catch (error) {
      systemLogger.error(`📧 邮箱配置读取失败: ${error.message}`);
      return null; // 文件不存在或读取失败
    }
  });

  ipcMain.handle('save-email-config', async (event, config) => {
    try {
      const settings = await getSettings();
      const configObj = typeof config === 'string' ? JSON.parse(config) : config;
      
      // 更新邮箱配置和域名
      if (configObj.emailConfig) {
        settings.emailConfig = configObj.emailConfig;
      }
      if (configObj.emailDomains) {
        settings.emailDomains = configObj.emailDomains;
      }
      
      await saveSettings(settings);
      
      return { success: true };
    } catch (error) {
      systemLogger.error(`📧 邮箱配置保存失败: ${error.message}`);
      return { success: false, message: error.message };
    }
  });

  // 获取完整设置
  ipcMain.handle('get-settings', async () => {
    try {
      const settings = await getSettings();
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 保存完整设置
  ipcMain.handle('save-settings', async (event, newSettings) => {
    try {
      await saveSettings(newSettings);
      
      // 同时更新 windsurfPaths 的配置
      if (newSettings.windsurfPath !== undefined) {
        windsurfPaths.setCustomInstallDir(newSettings.windsurfPath || null);
      }
      if (newSettings.dataPath !== undefined) {
        windsurfPaths.setCustomDataDir(newSettings.dataPath || null);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 更新所有账号的绑卡状态
  ipcMain.handle('update-all-binding-status', async () => {
    try {
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      const accounts = JSON.parse(data);
      
      // 将所有 needsManualBinding 的账号标记为已绑卡（但需要验证积分）
      const updatedAccounts = accounts.map(acc => {
        if (acc.needsManualBinding) {
          // 验证积分，只有积分>=500的账号才能标记为绑卡成功
          const cardBound = (acc.monthlyPromptCredits || 0) >= 500;
          return {
            ...acc,
            cardBound: cardBound,
            needsManualBinding: false
          };
        }
        return acc;
      });
      
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(updatedAccounts, null, 2));
      return { success: true };
    } catch (error) {
      systemLogger.error('更新绑卡状态失败', error.message);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('detect-windsurf-paths', async () => {
    try {
      const WindsurfManagerFactory = require('./services/windsurf-factory');
      const manager = WindsurfManagerFactory.create();
      return await manager.detectConfigPaths();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('full-reset-windsurf', async () => {
    try {
      const WindsurfManagerFactory = require('./services/windsurf-factory');
      const manager = WindsurfManagerFactory.create();
      return await manager.fullReset();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('launch-windsurf', async () => {
    try {
      const WindsurfManagerFactory = require('./services/windsurf-factory');
      const manager = WindsurfManagerFactory.create();
      const success = await manager.launchWindsurf();
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auto-login-windsurf', async (event, credentials) => {
    try {
      const WindsurfManagerFactory = require('./services/windsurf-factory');
      const manager = WindsurfManagerFactory.create();
      return await manager.autoLogin(credentials.email, credentials.password);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('browser-auto-login', async (event, credentials) => {
    try {
      const BrowserAutomation = require('./services/browser');
      const browser = new BrowserAutomation();
      
      const result = await browser.autoLogin(credentials.email, credentials.password);
      
      setTimeout(async () => {
        await browser.close();
      }, 10000);
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });


  // ==================== Windsurf路径管理 ====================
  ipcMain.handle('get-windsurf-path', async () => {
    try {
      return windsurfPaths.getExecutablePath();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('get-custom-windsurf-path', async () => {
    try {
      return windsurfPaths.customInstallDir;
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('set-custom-windsurf-path', async (event, customPath) => {
    try {
      
      // 如果是重置（空字符串），直接设置
      if (!customPath) {
        windsurfPaths.setCustomInstallDir(customPath);
        return { success: true };
      }
      
      // 验证自定义路径是否存在
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(customPath)) {
        return { success: false, error: '路径不存在' };
      }
      
      // 检查是否包含 Windsurf.exe
      const exePath = path.join(customPath, 'Windsurf.exe');
      if (!fs.existsSync(exePath)) {
        return { success: false, error: '请选择有效的Windsurf安装目录' };
      }
      
      windsurfPaths.setCustomInstallDir(customPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-windsurf-path', async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择Windsurf安装目录',
        properties: ['openDirectory'],
        defaultPath: process.env.LOCALAPPDATA
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    } catch (error) {
      return null;
    }
  });

  // ==================== Data路径管理 ====================
  ipcMain.handle('get-custom-data-path', async () => {
    try {
      // 返回实际解析后的路径，而不是包含环境变量的路径
      return windsurfPaths.getJsonDataDir();
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('set-custom-data-path', async (event, customPath) => {
    try {
      // 如果是重置（空字符串），直接设置
      if (!customPath) {
        windsurfPaths.setCustomDataDir(customPath);
        
        // 重新加载配置
        windsurfPaths.loadConfig();
        
        // 通知前端刷新数据
        if (mainWindow) {
          mainWindow.webContents.send('data-path-changed');
        }
        
        return { success: true };
      }
      
      // 验证自定义路径是否存在
      const fs = require('fs');
      
      if (!fs.existsSync(customPath)) {
        return { success: false, error: '路径不存在' };
      }
      
      // 检查是否为目录
      const stat = fs.statSync(customPath);
      if (!stat.isDirectory()) {
        return { success: false, error: '请选择一个有效的目录' };
      }
      
      windsurfPaths.setCustomDataDir(customPath);
      
      // 重新加载配置
      windsurfPaths.loadConfig();
      
      // 通知前端刷新数据
      if (mainWindow) {
        mainWindow.webContents.send('data-path-changed');
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-data-path', async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择Data存储目录',
        properties: ['openDirectory'],
        defaultPath: process.env.USERPROFILE
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    } catch (error) {
      return null;
    }
  });

  // ==================== 外部链接 ====================
  ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
  });

  // ==================== 虚拟卡管理 ====================

  ipcMain.handle('get-cards', async () => {
    try {
      const data = await fs.readFile(CARDS_FILE, 'utf-8');
      const cards = JSON.parse(data);
      return { success: true, cards: cards };
    } catch (error) {
      // 文件不存在，返回空数组
      return { success: true, cards: [] };
    }
  });

  ipcMain.handle('save-cards', async (event, cards) => {
    try {
      await fs.writeFile(CARDS_FILE, JSON.stringify(cards, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 刷新单个账号的积分数据
  ipcMain.handle('refresh-account-credits', async (event, email) => {
    try {
      // 1. 读取账号列表
      let accounts = [];
      try {
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        accounts = JSON.parse(data);
      } catch (e) {
        return { success: false, error: '读取账号列表失败' };
      }
      
      // 2. 找到目标账号
      const account = accounts.find(acc => acc.email === email);
      if (!account) {
        return { success: false, error: '账号不存在' };
      }
      
      if (!account.password) {
        return { success: false, error: '密码未保存，无法刷新' };
      }
      
      // 3. 使用公共函数获取积分信息
      const { getAccountCredits } = require('../shared/lib/windsurf-api');
      const creditsResult = await getAccountCredits(account.email, account.password);
      
      if (!creditsResult.success) {
        return { success: false, error: creditsResult.error };
      }
      
      // 4. 更新账号数据
      const data = creditsResult.data;
      account.usedPromptCredits = data.usedPromptCredits;
      account.monthlyPromptCredits = data.monthlyPromptCredits;
      account.usedFlowCredits = data.usedFlowCredits;
      account.monthlyFlowCredits = data.monthlyFlowCredits;
      account.accountType = data.accountType;
      
      // 6. 根据积分情况更新绑卡状态
      // 如果积分小于500，说明没有成功绑卡（PRO账号应该有500积分）
      if (account.monthlyPromptCredits < 500) {
        account.cardBound = false;
        account.needsManualBinding = false; // 清除手动绑定标记
      }
      
      // 7. 保存到文件
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      
      return { 
        success: true,
        credits: {
          usedPrompt: account.usedPromptCredits,
          monthlyPrompt: account.monthlyPromptCredits,
          usedFlow: account.usedFlowCredits,
          monthlyFlow: account.monthlyFlowCredits
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 标记绑卡状态
  ipcMain.handle('mark-card-bound', async (event, { email, success }) => {
    try {
      let accounts = [];
      
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        accounts = JSON.parse(data);
      }
      
      // 查找并更新账号
      const account = accounts.find(acc => acc.email === email);
      if (account) {
        // 如果标记为成功，但积分不是500，则强制标记为失败
        if (success && account.monthlyPromptCredits < 500) {
          systemLogger.warning('绑卡验证失败', `${email} 积分${account.monthlyPromptCredits} < 500，自动标记为失败`);
          account.cardBound = false;
          account.needsManualBinding = false;
          
          // 保存
          fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          
          return { success: false, error: `积分${account.monthlyPromptCredits} < 500，绑卡验证失败` };
        } else {
          account.cardBound = success;
          account.needsManualBinding = false;
          
          // 保存
          fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          
          return { success: true };
        }
      } else {
        return { success: false, error: '账号不存在' };
      }
    } catch (error) {
      systemLogger.error('标记绑卡状态失败', error.message);
      return { success: false, error: error.message };
    }
  });

  // ==================== 统一日志管理 ====================
  ipcMain.handle('log-message', async (event, { message, type, tag }) => {
    // 创建临时带标签的logger实例,默认不显示标签
    const taggedLogger = createTaggedLogger(tag || '');
    
    // 根据类型调用对应的日志方法
    switch (type) {
      case 'success':
        taggedLogger.success(message);
        break;
      case 'error':
        taggedLogger.error(message);
        break;
      case 'warning':
        taggedLogger.warning(message);
        break;
      case 'info':
      default:
        taggedLogger.info(message);
        break;
    }
  });

  // ==================== 版本检查 ====================
  ipcMain.handle('check-for-updates', async () => {
    try {
      const versionChecker = new VersionChecker();
      const hasUpdate = await versionChecker.checkForUpdates(true);
      return { success: true, hasUpdate };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerAllIPC };
