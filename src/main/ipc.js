/**
 * IPC处理注册中心
 * 按页面模块组织所有IPC处理
 */

const { ipcMain, dialog, shell, app } = require('electron');
const { registerHomeIPC } = require('./services/home-ipc');
const { initStripeHandlers } = require('./services/stripe-handler');
const { initTurnstileHandlers } = require('./services/turnstile-handler');
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
  
  // 动态获取路径的函数（路径可能在运行时改变）
  const getAccountsFile = () => path.join(windsurfPaths.getJsonDataDir(), 'accounts.json');
  const getCardsFile = () => path.join(windsurfPaths.getJsonDataDir(), 'virtual-cards.json');
  const getSettingsFile = () => path.join(windsurfPaths.getJsonDataDir(), 'settings.json');
  const getCurrentLoginFile = () => path.join(windsurfPaths.getDataDir(), 'current_login.json');
  
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
  
  // 注册验证码处理IPC
  initTurnstileHandlers(mainWindow);
  
  // 监听前端刷新数据请求，广播给所有渲染进程
  ipcMain.on('refresh-data', () => {
    if (mainWindow) {
      mainWindow.webContents.send('refresh-data');
    }
  });

  // 注册基础IPC处理器（虚拟卡管理在后面）

  // ==================== 统一设置管理 ====================

  // 读取设置文件
  async function getSettings() {
    try {
      const data = await fs.readFile(getSettingsFile(), 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // 返回默认设置
      return {
        language: 'zh-CN',
        windsurfPath: '',
        useCustomWindsurfPath: false,
        dataPath: windsurfPaths.getJsonDataDir(),
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
    await fs.writeFile(getSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8');
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
      const data = await fs.readFile(getAccountsFile(), 'utf-8');
      const accounts = JSON.parse(data);
      return accounts;
    } catch (error) {
      systemLogger.error(`读取账号文件失败: ${error.message}`);
      return [];
    }
  });

  ipcMain.handle('save-accounts', async (event, accounts) => {
    try {
      await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('add-account', async (event, account) => {
    try {
      let accounts = [];
      try {
        const data = await fs.readFile(getAccountsFile(), 'utf-8');
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
      account.createdAt = new Date().toISOString();  // 设置添加时间
      accounts.push(account);
      
      await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      return { success: true, account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-account', async (event, accountId) => {
    try {
      const data = await fs.readFile(getAccountsFile(), 'utf-8');
      let accounts = JSON.parse(data);
      accounts = accounts.filter(acc => acc.id !== accountId);
      await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 置顶账号
  ipcMain.handle('pin-account', async (event, accountId) => {
    try {
      const data = await fs.readFile(getAccountsFile(), 'utf-8');
      let accounts = JSON.parse(data);
      
      // 找到要置顶的账号
      const index = accounts.findIndex(acc => acc.id === accountId);
      if (index === -1) {
        return { success: false, error: '账号不存在' };
      }
      
      // 将账号移到第一位
      const [account] = accounts.splice(index, 1);
      accounts.unshift(account);
      
      await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ==================== Windsurf管理 ====================
  ipcMain.handle('clear-windsurf', async () => {
    try {
      const pathsToDelete = [windsurfPaths.getDataDir(), path.join(windsurfPaths.getCacheDir(), 'Cache')];
      
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
      
      // 构建 options 参数，支持多种切号方式
      const options = {
        refreshToken: account.refreshToken,  // RefreshToken（无需密码）
        apiKey: account.apiKey,              // 缓存的 API Key（最快）
        name: account.name                   // 缓存的用户名
      };
      
      // 执行自动切号（优先级：apiKey > refreshToken > password）
      // 只有当密码有效时才传入，避免用无效密码尝试登录
      const validPassword = account.password && account.password.trim() ? account.password : null;
      const switchResult = await switcher.switchAccountAdvanced(account.email, validPassword, options);
      
      // 如果切号成功且返回了新的 refreshToken，更新账号文件
      if (switchResult.success && switchResult.newRefreshToken) {
        try {
          const accountsData = await fs.readFile(getAccountsFile(), 'utf-8');
          const accounts = JSON.parse(accountsData);
          const idx = accounts.findIndex(a => a.email === account.email);
          if (idx !== -1) {
            accounts[idx].refreshToken = switchResult.newRefreshToken;
            if (switchResult.apiKey) accounts[idx].apiKey = switchResult.apiKey;
            if (switchResult.name) accounts[idx].name = switchResult.name;
            await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
          }
        } catch (e) {
          // 更新失败不影响切号结果
        }
      }
      
      // 保存当前登录信息到Windsurf数据目录
      await fs.writeFile(getCurrentLoginFile(), JSON.stringify(account, null, 2));
      
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
    
    // 获取完整设置配置
    const settings = await getSettings();
    config.referralLink = settings.referralLink || '';
    config.emailType = settings.emailType || 'domain';
    config.email126Config = settings.email126Config || { accounts: [], mailType: '126' };
    config.passwordStrength = settings.passwordStrength || 'same';
    
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
      const data = await fs.readFile(getCurrentLoginFile(), 'utf-8');
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

  // ==================== 配置读写（统一处理） ====================
  
  // 获取邮箱配置（前端用）
  ipcMain.handle('get-email-config', async () => {
    const settings = await getSettings();
    return JSON.stringify({
      emailDomains: settings.emailDomains || [],
      emailConfig: settings.emailConfig || { host: '', port: 993, user: '', password: '' },
      referralLink: settings.referralLink || '',
      emailType: settings.emailType || 'domain',
      email126Config: settings.email126Config || { filePath: '', mailType: '126', accounts: [] }
    });
  });

  // 保存邮箱配置
  ipcMain.handle('save-email-config', async (event, config) => {
    const settings = await getSettings();
    const cfg = typeof config === 'string' ? JSON.parse(config) : config;
    if (cfg.emailConfig) settings.emailConfig = cfg.emailConfig;
    if (cfg.emailDomains) settings.emailDomains = cfg.emailDomains;
    if (cfg.emailType !== undefined) settings.emailType = cfg.emailType;
    if (cfg.email126Config) settings.email126Config = cfg.email126Config;
    await saveSettings(settings);
    return { success: true };
  });

  // 选择 126 邮箱账号文件
  ipcMain.handle('select-email126-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 126/163 邮箱账号文件',
      filters: [{ name: '文本文件', extensions: ['txt'] }],
      properties: ['openFile']
    });
    
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    
    const filePath = result.filePaths[0];
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const accounts = [];
      
      for (const line of lines) {
        const parts = line.trim().split('----');
        if (parts.length >= 2) {
          accounts.push({
            email: parts[0].trim(),
            password: parts[1].trim()
          });
        }
      }
      
      return { filePath, accounts };
    } catch (error) {
      return { error: error.message };
    }
  });

  // 测试 126 邮箱连接
  ipcMain.handle('test-email126', async (event, config) => {
    try {
      const Email126Receiver = require('./services/email-126');
      const receiver = new Email126Receiver(config);
      return await receiver.testConnection();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 单个账号登录绑卡（打开浏览器登录后进入绑卡页面）
  ipcMain.handle('browser-bind-single', async (event, { email, password }) => {
    try {
      const { getPaymentLinkWithBrowser } = require('./services/turnstile-handler');
      const { createTaggedLogger } = require('./utils/logger');
      const logger = createTaggedLogger('登录绑卡');
      
      logger.info('打开浏览器登录', email);
      
      const result = await getPaymentLinkWithBrowser(email, password);
      
      if (result.success) {
        logger.success('绑卡页面已打开', email);
        return { success: true };
      } else {
        logger.error('登录失败', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 打开已用126邮箱文件
  ipcMain.handle('open-used-126-file', async () => {
    try {
      const usedFile = path.join(windsurfPaths.getJsonDataDir(), 'used-126-emails.txt');
      
      // 如果文件不存在，创建空文件
      try {
        await fs.access(usedFile);
      } catch {
        await fs.writeFile(usedFile, '', 'utf-8');
      }
      
      // 用系统默认程序打开文件
      shell.openPath(usedFile);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });


  // 邀请链接
  ipcMain.handle('get-referral-link', async () => (await getSettings()).referralLink || '');
  ipcMain.handle('save-referral-link', async (event, link) => {
    const settings = await getSettings();
    settings.referralLink = link;
    await saveSettings(settings);
    return { success: true };
  });

  // 获取完整设置
  ipcMain.handle('get-settings', async () => ({ success: true, settings: await getSettings() }));

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
      const data = await fs.readFile(getAccountsFile(), 'utf-8');
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
      
      await fs.writeFile(getAccountsFile(), JSON.stringify(updatedAccounts, null, 2));
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
      const data = await fs.readFile(getCardsFile(), 'utf-8');
      const cards = JSON.parse(data);
      return { success: true, cards: cards };
    } catch (error) {
      // 文件不存在，返回空数组
      return { success: true, cards: [] };
    }
  });

  ipcMain.handle('save-cards', async (event, cards) => {
    try {
      await fs.writeFile(getCardsFile(), JSON.stringify(cards, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 刷新单个账号的积分数据
  // 文件操作锁，防止并发写入
  let accountsFileLock = Promise.resolve();
  
  ipcMain.handle('refresh-account-credits', async (event, email) => {
    try {
      // 1. 先读取账号获取 refreshToken 和 password（不需要锁）
      let accountData = null;
      try {
        const fileData = await fs.readFile(getAccountsFile(), 'utf-8');
        const accounts = JSON.parse(fileData);
        accountData = accounts.find(acc => acc.email === email);
      } catch (e) {
        return { success: false, error: '读取账号列表失败' };
      }
      
      if (!accountData) {
        return { success: false, error: '账号不存在' };
      }
      
      // 2. 调用 API 获取最新数据（耗时操作，不需要锁）
      const { getAccountCredits, getAccountCreditsByRefreshToken } = require('../shared/lib/windsurf-api');
      let creditsResult;
      let newRefreshToken = null;
      
      if (accountData.refreshToken) {
        // 传入 email 和 password 用于 Token 刷新失败时回退
        creditsResult = await getAccountCreditsByRefreshToken(
          accountData.refreshToken,
          accountData.email,
          accountData.password || null
        );
        if (creditsResult.success && creditsResult.newRefreshToken) {
          newRefreshToken = creditsResult.newRefreshToken;
        }
      } else if (accountData.password) {
        creditsResult = await getAccountCredits(accountData.email, accountData.password);
        if (creditsResult.success && creditsResult.refreshToken) {
          newRefreshToken = creditsResult.refreshToken;
        }
      } else {
        return { success: false, error: '无密码或Token，无法刷新' };
      }
      
      if (!creditsResult.success) {
        return { success: false, error: creditsResult.error };
      }
      
      // 3. 使用锁来更新和保存文件（防止并发写入覆盖）
      await (accountsFileLock = accountsFileLock.then(async () => {
        // 重新读取最新的账号列表
        let accounts = [];
        try {
          const fileData = await fs.readFile(getAccountsFile(), 'utf-8');
          accounts = JSON.parse(fileData);
        } catch (e) {
          throw new Error('读取账号列表失败');
        }
        
        // 找到并更新账号
        const account = accounts.find(acc => acc.email === email);
        if (!account) {
          throw new Error('账号不存在');
        }
        
        // 更新账号数据
        const data = creditsResult.data;
        account.usedPromptCredits = data.usedPromptCredits;
        account.monthlyPromptCredits = data.monthlyPromptCredits;
        account.usedFlowCredits = data.usedFlowCredits;
        account.monthlyFlowCredits = data.monthlyFlowCredits;
        account.accountType = data.accountType;
        account.planType = data.planType;
        // 如果没有 createdAt，设置当前时间
        if (!account.createdAt) {
          account.createdAt = new Date().toISOString();
        }
        account.expiresAt = data.expiresAt || account.expiresAt;
        if (data.apiKey) {
          account.apiKey = data.apiKey;
        }
        if (newRefreshToken) {
          account.refreshToken = newRefreshToken;
        }
        
        // 根据积分情况更新绑卡状态
        // Free 未绑卡: 0 积分
        // Trial (Free 已绑卡): 100 积分
        // Pro/Teams/Enterprise: 500+ 积分
        account.cardBound = account.monthlyPromptCredits >= 100;
        account.needsManualBinding = false;
        
        // 保存到文件
        await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      }));
      
      // 返回结果使用 creditsResult.data
      const data = creditsResult.data;
      return { 
        success: true,
        credits: {
          usedPrompt: data.usedPromptCredits,
          monthlyPrompt: data.monthlyPromptCredits,
          usedFlow: data.usedFlowCredits,
          monthlyFlow: data.monthlyFlowCredits
        },
        createdAt: data.createdAt,
        expiresAt: data.expiresAt
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 通过 Refresh Token 导入账号
  ipcMain.handle('import-account-by-token', async (event, refreshToken) => {
    try {
      const { getAccountCreditsByRefreshToken } = require('../shared/lib/windsurf-api');
      const result = await getAccountCreditsByRefreshToken(refreshToken);
      
      if (!result.success) {
        return { success: false, error: result.error };
      }
      
      const data = result.data;
      
      // 检查账号是否已存在
      let accounts = [];
      try {
        const fileData = await fs.readFile(getAccountsFile(), 'utf-8');
        accounts = JSON.parse(fileData);
      } catch (e) {
        // 文件不存在，使用空数组
      }
      
      const existingAccount = accounts.find(acc => acc.email === data.email);
      if (existingAccount) {
        // 更新现有账号的 refreshToken
        existingAccount.refreshToken = result.newRefreshToken || refreshToken;
        existingAccount.usedPromptCredits = data.usedPromptCredits;
        existingAccount.monthlyPromptCredits = data.monthlyPromptCredits;
        existingAccount.usedFlowCredits = data.usedFlowCredits;
        existingAccount.monthlyFlowCredits = data.monthlyFlowCredits;
        existingAccount.accountType = data.accountType;
        existingAccount.planType = data.planType;  // 账号类型
        existingAccount.createdAt = data.createdAt || existingAccount.createdAt;
        existingAccount.expiresAt = data.expiresAt || existingAccount.expiresAt;
        
        await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
        
        return { 
          success: true, 
          message: '账号已更新',
          account: existingAccount,
          isNew: false
        };
      }
      
      // 创建新账号
      const newAccount = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        email: data.email,
        refreshToken: result.newRefreshToken || refreshToken,
        firstName: data.name?.split(' ')[0] || '',
        lastName: data.name?.split(' ')[1] || '',
        usedPromptCredits: data.usedPromptCredits,
        monthlyPromptCredits: data.monthlyPromptCredits,
        usedFlowCredits: data.usedFlowCredits,
        monthlyFlowCredits: data.monthlyFlowCredits,
        accountType: data.accountType,
        planType: data.planType,  // 账号类型
        isPro: data.isPro,
        cardBound: data.monthlyPromptCredits >= 100,
        createdAt: data.createdAt || new Date().toISOString(),
        expiresAt: data.expiresAt
      };
      
      accounts.push(newAccount);
      await fs.writeFile(getAccountsFile(), JSON.stringify(accounts, null, 2));
      
      systemLogger.success('账号导入成功', `${data.email} (${data.accountType})`);
      
      return { 
        success: true, 
        message: '账号导入成功',
        account: newAccount,
        isNew: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 标记绑卡状态
  ipcMain.handle('mark-card-bound', async (event, { email, success }) => {
    try {
      let accounts = [];
      
      if (fs.existsSync(getAccountsFile())) {
        const data = fs.readFileSync(getAccountsFile(), 'utf-8');
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
          fs.writeFileSync(getAccountsFile(), JSON.stringify(accounts, null, 2));
          
          return { success: false, error: `积分${account.monthlyPromptCredits} < 500，绑卡验证失败` };
        } else {
          account.cardBound = success;
          account.needsManualBinding = false;
          
          // 保存
          fs.writeFileSync(getAccountsFile(), JSON.stringify(accounts, null, 2));
          
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
