/**
 * Stripe 绑卡 IPC 处理器
 */

const { ipcMain, app } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { createTaggedLogger } = require('../utils/logger');
const { bindCard, retryBind } = require('./stripe-binder');
const { loginToStripePage } = require('./windsurf-login');

// 创建日志实例：空标签用于普通日志，批量绑卡标签用于实时日志
const logger = createTaggedLogger('');
const bindLogger = createTaggedLogger('批量绑卡');

let mainWindow;

// 保存失败账号的浏览器实例，用于重试
const failedAccountBrowsers = new Map(); // key: email, value: { page, context, browser }

// 虚拟卡文件路径（使用统一路径配置）
const windsurfPaths = require('../../shared/config/windsurf-paths');
const CARDS_FILE = path.join(windsurfPaths.getJsonDataDir(), 'virtual-cards.json');
const SETTINGS_FILE = path.join(windsurfPaths.getJsonDataDir(), 'settings.json');

// 读取设置
async function getSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * 根据ID选择指定的虚拟卡
 * @param {string} cardId - 卡ID
 * @returns {Promise<Object|null>} 返回卡信息或null
 */
async function selectCardById(cardId) {
  try {
    const data = await fs.readFile(CARDS_FILE, 'utf-8');
    const cards = JSON.parse(data);
    
    const card = cards.find(c => c.id === cardId);
    
    if (card) {
      // 完整卡字段是 number，不是 cardNumber
      const cardDisplay = card.type === 'bin' ? card.bin : (card.number || card.cardNumber || '完整卡');
      bindLogger.success(`找到卡: ${cardDisplay}`);
      return {
        card: card,
        type: card.type
      };
    }
    
    // 没找到，列出所有卡的ID
    bindLogger.warning(`未找到ID为 ${cardId} 的卡`);
    bindLogger.info(`可用卡ID: ${cards.map(c => c.id).join(', ')}`);
    return null;
  } catch (error) {
    bindLogger.error(`读取虚拟卡失败: ${error.message}`);
    return null;
  }
}

/**
 * 从虚拟卡库选择可用的卡（自动选择）
 * 优先级：BIN卡头 > 未绑定的完整卡 > 已绑定的完整卡
 * @returns {Promise<Object|null>} 返回卡信息或null
 */
async function selectAvailableCard() {
  try {
    const data = await fs.readFile(CARDS_FILE, 'utf-8');
    const cards = JSON.parse(data);
    
    // 1. 优先选择BIN卡头（推荐批量绑卡）
    const binCard = cards.find(c => c.type === 'bin');
    
    if (binCard) {
      return {
        card: binCard,
        type: 'bin'
      };
    }
    
    // 2. 如果没有BIN卡头，选择未绑定的完整卡（bindCount = 0）
    const unboundFullCard = cards.find(c => 
      c.type === 'full' && 
      (parseInt(c.bindCount) || 0) === 0
    );
    
    if (unboundFullCard) {
      return {
        card: unboundFullCard,
        type: 'full'
      };
    }
    
    // 3. 最后选择已绑定的完整卡（不推荐）
    const boundFullCard = cards.find(c => c.type === 'full');
    if (boundFullCard) {
      return {
        card: boundFullCard,
        type: 'full'
      };
    }
    
    bindLogger.warning('没有找到可用的卡（BIN或完整卡）');
    return null;
  } catch (error) {
    bindLogger.error(`读取虚拟卡失败: ${error.message}`);
    bindLogger.info(`文件路径: ${CARDS_FILE}`);
    return null;
  }
}

/**
 * 根据虚拟卡生成卡信息
 * @param {Object} cardData - 从selectAvailableCard返回的数据
 * @returns {Object} {cardNumber, expiry, cvv, cardId, cardType, binCard}
 */
function generateCardInfo(cardData) {
  const { card, type } = cardData;
  
  if (type === 'full') {
    // 完整卡：直接使用
    return {
      cardNumber: card.number,
      expiry: `${card.expMonth}/${card.expYear}`,
      cvv: card.cvv,
      cardId: card.id,
      cardType: 'full'
    };
  } else {
    // BIN卡：随机生成
    const { generateCardNumber, generateExpiry, generateCVV } = require('../services/stripe-binder');
    
    const expiry = generateExpiry();
    const [expMonth, expYear] = expiry.split('/');
    
    return {
      cardNumber: generateCardNumber(card.bin),
      expiry: expiry,
      cvv: generateCVV(),
      cardId: card.id,
      cardType: 'bin',
      binCard: card,  // 保存原始BIN卡信息
      generatedCard: {  // 保存生成的完整卡信息
        expMonth,
        expYear
      }
    };
  }
}

/**
 * 更新虚拟卡绑定次数
 * @param {string} cardId - 卡ID
 */
async function updateCardBindCount(cardId) {
  try {
    const data = await fs.readFile(CARDS_FILE, 'utf-8');
    const cards = JSON.parse(data);
    
    const card = cards.find(c => c.id === cardId);
    if (card) {
      card.bindCount = (parseInt(card.bindCount) || 0) + 1;
      await fs.writeFile(CARDS_FILE, JSON.stringify(cards, null, 2));
      logger.info(`虚拟卡绑定次数已更新: ${card.bindCount}`);
    }
  } catch (error) {
    logger.error('更新虚拟卡绑定次数失败', error.message);
  }
}

/**
 * 保存BIN卡生成的完整卡信息
 * @param {Object} cardInfo - 生成的卡信息
 */
async function saveBinGeneratedCard(cardInfo) {
  if (cardInfo.cardType !== 'bin') return;
  
  try {
    const data = await fs.readFile(CARDS_FILE, 'utf-8');
    const cards = JSON.parse(data);
    
    // 创建新的完整卡
    const newCard = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      type: 'full',
      number: cardInfo.cardNumber,
      expMonth: cardInfo.generatedCard.expMonth,
      expYear: cardInfo.generatedCard.expYear,
      cvv: cardInfo.cvv,
      balance: cardInfo.binCard.balance || 0,
      bindCount: 1,  // 已使用1次
      note: `从BIN生成: ${cardInfo.binCard.bin}`,
      createdAt: new Date().toISOString()
    };
    
    cards.push(newCard);
    await fs.writeFile(CARDS_FILE, JSON.stringify(cards, null, 2));
    bindLogger.info(`已保存BIN生成的完整卡: ${cardInfo.cardNumber}`);
    
    // 立即通知前端刷新虚拟卡列表
    if (mainWindow) {
      mainWindow.webContents.send('refresh-cards');
    }
  } catch (error) {
    bindLogger.error('保存BIN生成的卡失败', error.message);
  }
}

/**
 * 后台自动检测成功页面（不阻塞）
 */
async function startAutoDetection(email, page, browser, cardId = null, cardInfo = null) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 异步执行检测
  (async () => {
    try {
      bindLogger.info(`后台自动检测已启动...`);
      
      while (true) {
        try {
          const currentUrl = page.url();
          
          // 检测成功页面
          if (currentUrl.includes('payment-success') || currentUrl.includes('billing/payment-success')) {
            // 使用统一的带标签logger
            bindLogger.success('自动检测到绑卡成功页面');
            bindLogger.success('绑卡成功，浏览器将自动关闭');
            
            // 先从Map中移除，防止浏览器关闭事件重复触发
            failedAccountBrowsers.delete(email);
            
            // 如果是BIN卡，保存生成的完整卡信息
            if (cardInfo && cardInfo.cardType === 'bin') {
              await saveBinGeneratedCard(cardInfo);
              bindLogger.info('已保存随机生成的完整卡信息');
            }
            
            // 更新虚拟卡绑定次数
            if (cardId) {
              await updateCardBindCount(cardId);
              bindLogger.info('虚拟卡使用次数已更新');
            }
            
            // 更新账号绑卡状态
            await updateAccountBindStatus(email, true);
            
            // 关闭浏览器
            try {
              await browser.close();
            } catch (e) {
              // 忽略关闭错误
            }
            
            break;
          }
          
          // 等待2秒后继续检测
          await sleep(2000);
        } catch (error) {
          // 页面可能已关闭，停止检测
          break;
        }
      }
    } catch (error) {
      // 静默失败
    }
  })();
}

/**
 * 初始化 Stripe 处理器
 */
function initStripeHandlers(win) {
  mainWindow = win;
  
  // 获取支付链接（仅获取链接，不打开浏览器）
  ipcMain.handle('get-payment-link', async (event, { email, password }) => {
    const { getPaymentLink } = require('./stripe-api');
    return await getPaymentLink(email, password);
  });
  
  // API 绑卡：获取链接 + 打开浏览器 + 自动填写表单
  ipcMain.handle('api-bind-card', async (event, { email, password, selectedCardId }) => {
    try {
      bindLogger.info(`开始: ${email}`);
      
      // 选择虚拟卡
      const cardData = selectedCardId && selectedCardId !== 'auto' 
        ? await selectCardById(selectedCardId)
        : await selectAvailableCard();
      
      let cardInfo = null;
      if (cardData) {
        cardInfo = generateCardInfo(cardData);
        bindLogger.info(`已选择${cardData.type === 'full' ? '完整卡' : 'BIN卡头'}`);
      } else {
        bindLogger.warning('未选择虚拟卡，将打开页面手动填写');
      }
      
      // 执行 API 绑卡
      const { getPaymentLink } = require('./stripe-api');
      const { connect } = require('puppeteer-real-browser');
      const { bindCard } = require('./stripe-binder');
      
      // 1. 获取支付链接
      const linkResult = await getPaymentLink(email, password);
      if (!linkResult.success) {
        return { success: false, error: linkResult.error };
      }
      
      bindLogger.success('获取支付链接成功');
      
      // 2. 打开浏览器
      bindLogger.info('启动浏览器...');
      const settings = await getSettings();
      const browserArgs = ['--disable-blink-features=AutomationControlled', '--window-size=800,1000'];
      if (settings.incognitoMode !== false) browserArgs.push('--incognito');
      const response = await connect({
        headless: false,
        fingerprint: true,
        turnstile: false,
        tf: false,
        args: browserArgs,
        defaultViewport: null  // 禁用固定viewport，让页面可以滚动
      });
      
      const browser = response.browser;
      const page = response.page;
      
      // 不设置setViewport，让页面可以正常滚动
      await page.goto(linkResult.paymentLink, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      bindLogger.success('已到达 Stripe 页面');
      
      // 4. 自动填写表单
      if (cardInfo) {
        bindLogger.info('开始自动填写表单...');
        const bindResult = await bindCard(page, null, cardInfo);
        
        if (bindResult.pending) {
          // 保存浏览器实例
          failedAccountBrowsers.set(email, { page, browser, cardId: cardInfo.cardId, cardInfo });
          
          // 监听浏览器关闭
          browser.on('disconnected', async () => {
            if (failedAccountBrowsers.has(email)) {
              await updateAccountBindStatus(email, false);
              failedAccountBrowsers.delete(email);
            }
          });
          
          // 显示操作按钮
          mainWindow.webContents.send('show-binding-actions', { email, password });
          
          // 启动后台检测
          startAutoDetection(email, page, browser, cardInfo.cardId, cardInfo);
          
          return { success: false, pending: true };
        }
        
        return bindResult;
      }
      
      // 没有卡信息，保存浏览器实例让用户手动填写
      failedAccountBrowsers.set(email, { page, browser });
      mainWindow.webContents.send('show-binding-actions', { email, password });
      
      return { success: false, pending: true, paymentLink: linkResult.paymentLink };
      
    } catch (error) {
      bindLogger.error('异常', error.message);
      return { success: false, error: error.message };
    }
  });
  
  // 单个账号 API 绑卡（重试时复用批量绑卡逻辑）
  ipcMain.handle('api-bind-single-account', async (event, { email, password, selectedCardId }) => {
    // 先关闭之前的浏览器实例（如果有）
    const savedBrowser = failedAccountBrowsers.get(email);
    if (savedBrowser && savedBrowser.browser) {
      try {
        await savedBrowser.browser.close();
      } catch (e) {}
      failedAccountBrowsers.delete(email);
    }
    
    // 复用批量绑卡的逻辑，传入单个账号
    const result = await ipcRenderer_batchApiBindCards([{ email, password }], selectedCardId, 1);
    return result.successCount > 0 ? { success: true } : { success: false, pending: result.pendingCount > 0, error: '绑卡失败' };
  });
  
  // 内部绑卡函数（供批量绑卡和单个绑卡复用）
  async function ipcRenderer_batchApiBindCards(accounts, selectedCardId, concurrent) {
    const settings = await getSettings();
    const CONCURRENT_COUNT = concurrent || settings.concurrent || 5;
    let successCount = 0;
    let failCount = 0;
    let pendingCount = 0;
    let completedCount = 0;
    
    // 单个账号绑卡任务
    async function bindSingleAccount(acc, taskIndex) {
      const taskLog = (type, msg, detail = '') => {
        const prefix = `[任务${taskIndex}]`;
        if (type === 'info') bindLogger.info(`${prefix} ${msg}`, detail);
        else if (type === 'error') bindLogger.error(`${prefix} ${msg}`, detail);
        else if (type === 'success') bindLogger.success(`${prefix} ${msg}`);
        else if (type === 'progress') bindLogger.progress(`${prefix} ${msg}`);
      };
      
      try {
        taskLog('info', `开始绑卡 ${acc.email}`);
        
        // 选择虚拟卡
        const cardData = selectedCardId && selectedCardId !== 'auto' 
          ? await selectCardById(selectedCardId)
          : await selectAvailableCard();
        
        if (!cardData) {
          taskLog('error', '没有可用的虚拟卡');
          return { success: false, error: '没有可用的虚拟卡' };
        }
        
        const cardInfo = generateCardInfo(cardData);
        
        // 获取支付链接
        const { getPaymentLink } = require('./stripe-api');
        const linkResult = await getPaymentLink(acc.email, acc.password);
        
        if (!linkResult.success) {
          taskLog('error', '获取链接失败', linkResult.error);
          await updateAccountBindStatus(acc.email, false);
          return { success: false, error: linkResult.error };
        }
        
        // 打开浏览器
        const { connect } = require('puppeteer-real-browser');
        const settings = await getSettings();
        const browserArgs = ['--disable-blink-features=AutomationControlled', '--window-size=800,1000'];
        if (settings.incognitoMode !== false) browserArgs.push('--incognito');
        const response = await connect({
          headless: false,
          fingerprint: true,
          turnstile: false,
          tf: false,
          args: browserArgs,
          defaultViewport: null  // 禁用固定viewport，让页面可以滚动
        });
        
        const browser = response.browser;
        const page = response.page;
        
        // 不设置setViewport，让页面可以正常滚动
        await page.goto(linkResult.paymentLink, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 自动填写表单
        const { bindCard } = require('./stripe-binder');
        const bindResult = await bindCard(page, null, cardInfo, taskIndex);
        
        if (bindResult.pending) {
          failedAccountBrowsers.set(acc.email, { page, browser, cardId: cardInfo.cardId, cardInfo });
          
          browser.on('disconnected', async () => {
            if (failedAccountBrowsers.has(acc.email)) {
              await updateAccountBindStatus(acc.email, false);
              failedAccountBrowsers.delete(acc.email);
            }
          });
          
          mainWindow.webContents.send('show-binding-actions', { email: acc.email, password: acc.password });
          startAutoDetection(acc.email, page, browser, cardInfo.cardId, cardInfo);
          return { success: false, pending: true };
        } else if (bindResult.error) {
          failedAccountBrowsers.set(acc.email, { page, browser });
          mainWindow.webContents.send('show-binding-actions', { email: acc.email, password: acc.password });
          await updateAccountBindStatus(acc.email, false);
          return { success: false, error: bindResult.error };
        }
        
        return { success: true };
        
      } catch (error) {
        taskLog('error', '异常', error.message);
        await updateAccountBindStatus(acc.email, false);
        return { success: false, error: error.message };
      }
    }
    
    // 分批并行处理
    for (let i = 0; i < accounts.length; i += CONCURRENT_COUNT) {
      const batch = [];
      const batchSize = Math.min(CONCURRENT_COUNT, accounts.length - i);
      
      for (let j = 0; j < batchSize; j++) {
        const taskIndex = i + j + 1;
        const acc = accounts[i + j];
        
        const task = bindSingleAccount(acc, taskIndex).then(result => {
          completedCount++;
          if (result.success) successCount++;
          else if (result.pending) pendingCount++;
          else failCount++;
          
          mainWindow.webContents.send('binding-progress', {
            current: completedCount,
            total: accounts.length
          });
          
          return result;
        });
        
        batch.push(task);
      }
      
      await Promise.all(batch);
    }
    
    bindLogger.success(`批量绑卡完成！成功 ${successCount} 个，失败 ${failCount} 个，待确认 ${pendingCount} 个`);
    bindLogger.info('后台自动检测已启动...');
    
    mainWindow.webContents.send('refresh-data');
    
    return { successCount, failCount, pendingCount };
  }
  
  // 批量 API 绑卡（支持并行）- 复用内部函数
  ipcMain.handle('batch-api-bind-cards', async (event, { accounts, selectedCardId, concurrent }) => {
    return await ipcRenderer_batchApiBindCards(accounts, selectedCardId, concurrent);
  });

  // 用户确认绑卡成功
  ipcMain.handle('confirm-bind-success', async (event, { email }) => {
    
    const systemLog = (msg) => {
      // 发送到系统日志
      bindLogger.info(msg);
    };
    
    try {
      systemLog(`用户确认绑卡成功: ${email}`);
      
      // 获取保存的浏览器实例
      const savedBrowser = failedAccountBrowsers.get(email);
      
      if (savedBrowser) {
        const { browser, cardId, cardInfo } = savedBrowser;
        
        // 如果是BIN卡，保存生成的完整卡信息
        if (cardInfo && cardInfo.cardType === 'bin') {
          await saveBinGeneratedCard(cardInfo);
          systemLog('已保存随机生成的完整卡信息');
        }
        
        // 更新虚拟卡绑定次数
        if (cardId) {
          await updateCardBindCount(cardId);
          systemLog('虚拟卡使用次数已更新');
        }
        
        // 从Map中移除（在关闭浏览器之前，避免触发关闭监听器）
        failedAccountBrowsers.delete(email);
        
        // 关闭浏览器
        try {
          await browser.close();
          systemLog('浏览器已关闭');
        } catch (e) {
          // 忽略关闭错误
        }
      }
      
      // 更新账号绑卡状态
      await updateAccountBindStatus(email, true);
      
      systemLog('绑卡状态已更新');
      
      // 通知前端刷新数据（账号列表和虚拟卡列表）
      mainWindow.webContents.send('refresh-data');
      
      return { success: true };
      
    } catch (error) {
      systemLog(`确认绑卡异常: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  
}

/**
 * 更新账号绑卡状态
 */
async function updateAccountBindStatus(email, success) {
  try {
    const windsurfPaths = require('../../shared/config/windsurf-paths');
    const accountsPath = path.join(windsurfPaths.getJsonDataDir(), 'accounts.json');
    const data = await fs.readFile(accountsPath, 'utf-8');
    const accounts = JSON.parse(data);
    
    const accountIndex = accounts.findIndex(acc => acc.email === email);
    if (accountIndex !== -1) {
      accounts[accountIndex].cardBound = success;
      accounts[accountIndex].needsManualBinding = false;
      
      await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
    }
  } catch (error) {
    logger.error('更新虚拟卡绑定次数失败', error.message);
  }
}
module.exports = { initStripeHandlers };
