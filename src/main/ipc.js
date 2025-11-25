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
  const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
  
  // 创建带标签的日志实例
  const systemLogger = createTaggedLogger('系统管理');
  
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

  // ==================== 语言设置 ====================
  ipcMain.handle('save-language', async (event, language) => {
    try {
      const userDataPath = app.getPath('userData');
      const languageFile = path.join(userDataPath, 'language.json');
      await fs.writeFile(languageFile, JSON.stringify({ language }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-language', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const languageFile = path.join(userDataPath, 'language.json');
      const data = await fs.readFile(languageFile, 'utf-8');
      const config = JSON.parse(data);
      return { success: true, language: config.language };
    } catch (error) {
      return { success: false, language: 'zh-CN' };
    }
  });

  // ==================== 账号管理 ====================
  ipcMain.handle('get-accounts', async () => {
    try {
      systemLogger.info(`📧 账号数据获取地址: ${ACCOUNTS_FILE}`);
      systemLogger.info(`正在读取账号文件: ${ACCOUNTS_FILE}`);
      const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
      const accounts = JSON.parse(data);
      systemLogger.info(`成功读取 ${accounts.length} 个账号`);
      
      // 显示前5个邮箱地址作为示例
      if (accounts.length > 0) {
        const emailSample = accounts.slice(0, 5).map(acc => acc.email).join(', ');
        systemLogger.info(`📧 邮箱地址示例: ${emailSample}${accounts.length > 5 ? '...' : ''}`);
      }
      
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
      const WINDSURF_CONFIG = path.join(process.env.APPDATA, 'Windsurf');
      const WINDSURF_CACHE = path.join(process.env.LOCALAPPDATA, 'Windsurf', 'Cache');
      const pathsToDelete = [WINDSURF_CONFIG, WINDSURF_CACHE];
      
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
      
      // 保存当前登录信息
      const loginFile = path.join(app.getPath('userData'), 'current_login.json');
      await fs.writeFile(loginFile, JSON.stringify(account, null, 2));
      
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
      const loginFile = path.join(app.getPath('userData'), 'current_login.json');
      const data = await fs.readFile(loginFile, 'utf-8');
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

  // 从原始路径读取邮箱配置
  ipcMain.handle('get-email-config', async () => {
    try {
      const originalUserData = path.join(process.env.APPDATA, 'windsurf-account-switcher');
      const configFile = path.join(originalUserData, 'email-config.json');
      
      const data = await fs.readFile(configFile, 'utf-8');
      return data;
    } catch (error) {
      return null; // 文件不存在或读取失败
    }
  });

  // 保存邮箱配置到原始路径
  ipcMain.handle('save-email-config', async (event, config) => {
    try {
      const originalUserData = path.join(process.env.APPDATA, 'windsurf-account-switcher');
      await fs.mkdir(originalUserData, { recursive: true });
      
      const configFile = path.join(originalUserData, 'email-config.json');
      await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
      
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 更新所有账号的绑卡状态
  ipcMain.handle('update-all-binding-status', async () => {
    try {
      const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
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

  // 旧的半自动切号已删除，使用新的完全自动切号 (switch-account)

  // ==================== 外部链接 ====================
  ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
  });

  // ==================== 虚拟卡管理 ====================
  const CARDS_FILE = path.join(process.env.APPDATA, 'Windsurf', 'virtual-cards.json');

  ipcMain.handle('get-cards', async () => {
    try {
      systemLogger.info(`💳 虚拟卡获取地址: ${CARDS_FILE}`);
      const data = await fs.readFile(CARDS_FILE, 'utf-8');
      const cards = JSON.parse(data);
      systemLogger.info(`成功读取 ${cards.length} 张虚拟卡`);
      return { success: true, cards: cards };
    } catch (error) {
      systemLogger.info(`虚拟卡文件不存在或为空，返回空数组: ${error.message}`);
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
      const accountsPath = path.join(app.getPath('userData'), 'accounts.json');
      let accounts = [];
      try {
        const data = await fs.readFile(accountsPath, 'utf-8');
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
      await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
      
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
      const accountsPath = path.join(app.getPath('userData'), 'accounts.json');
      let accounts = [];
      
      if (fs.existsSync(accountsPath)) {
        const data = fs.readFileSync(accountsPath, 'utf-8');
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
          fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
          
          return { success: false, error: `积分${account.monthlyPromptCredits} < 500，绑卡验证失败` };
        } else {
          account.cardBound = success;
          account.needsManualBinding = false;
          
          // 保存
          fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
          
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
