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
const CARDS_FILE = path.join(windsurfPaths.getDataDir(), 'virtual-cards.json');

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
      return {
        card: card,
        type: card.type
      };
    }
    
    return null;
  } catch (error) {
    logger.error('读取虚拟卡失败', error.message);
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
    
    return null;
  } catch (error) {
    logger.error('读取虚拟卡失败', error.message);
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
      bindLogger.info(`🔍 后台自动检测已启动...`);
      
      while (true) {
        try {
          const currentUrl = page.url();
          
          // 检测成功页面
          if (currentUrl.includes('payment-success') || currentUrl.includes('billing/payment-success')) {
            // 使用统一的带标签logger
            bindLogger.success('自动检测到绑卡成功页面');
            bindLogger.success(`🎉 绑卡成功，浏览器将自动关闭`);
            
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
            
            // 关闭浏览器
            try {
              await browser.close();
            } catch (e) {
              // 忽略关闭错误
            }
            
            // 从Map中移除
            failedAccountBrowsers.delete(email);
            
            // 更新账号绑卡状态
            await updateAccountBindStatus(email, true);
            
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
  
  // 批量绑卡
  ipcMain.handle('batch-bind-cards', async (event, { accounts, selectedCardId }) => {
    let successCount = 0;
    let failCount = 0;
    let pendingCount = 0;
    
    
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      
      // 发送进度
      mainWindow.webContents.send('binding-progress', {
        current: i + 1,
        total: accounts.length
      });
      
      // 发送到系统日志的函数（避免循环调用）
      const systemLog = (msg) => {
        bindLogger.info(msg);
      };
      
      let browser, context, page;
      
      try {
        systemLog(`开始绑卡 [${i + 1}/${accounts.length}] ${acc.email}`);
        
        // 第一步：从虚拟卡库选卡
        systemLog(`正在选择虚拟卡...`);
        const cardData = selectedCardId && selectedCardId !== 'auto' 
          ? await selectCardById(selectedCardId)
          : await selectAvailableCard();
        
        if (!cardData) {
          systemLog(`没有可用的虚拟卡，请先在"虚拟卡管理"中添加`);
          failCount++;
          continue;
        }
        
        const cardInfo = generateCardInfo(cardData);
        systemLog(`已选择${cardData.type === 'full' ? '完整卡' : 'BIN卡头'}`);
        
        // 第二步：登录到 Stripe 页面
        const loginResult = await loginToStripePage(acc.email, acc.password);
        page = loginResult.page;
        context = loginResult.context;
        browser = loginResult.browser;
        
        // 第三步：执行绑卡（统一管理，所有日志自动转发到专用窗口）
        const result = await bindCard(page, null, cardInfo);
        
        if (result.pending) {
          // 提交完成，等待用户确认
          pendingCount++;
          systemLog(`绑卡已提交，等待用户确认`);
          bindLogger.info(`💡 请在浏览器中查看结果，然后点击下方按钮`);
          
          // 保存浏览器实例、卡ID和卡信息
          failedAccountBrowsers.set(acc.email, { page, context, browser, cardId: cardInfo.cardId, cardInfo });
          
          // 监听浏览器关闭事件，自动标记为绑卡失败
          browser.on('disconnected', async () => {
            if (failedAccountBrowsers.has(acc.email)) {
              // 浏览器被关闭，标记为绑卡失败
              await updateAccountBindStatus(acc.email, false);
              failedAccountBrowsers.delete(acc.email);
              systemLog(`浏览器已关闭，自动标记为绑卡失败`);
            }
          });
          
          // 发送事件显示操作按钮
          mainWindow.webContents.send('show-binding-actions', {
            email: acc.email,
            password: acc.password
          });
          
          // 启动后台检测（不阻塞）
          startAutoDetection(acc.email, page, browser, cardInfo.cardId, cardInfo);
          
        } else if (result.error) {
          // 提交失败
          failCount++;
          systemLog(`绑卡失败: ${result.error}`);
          bindLogger.warning(`⚠️ 浏览器保持打开状态，可以重新绑卡`);
          
          // 保存浏览器实例
          failedAccountBrowsers.set(acc.email, { page, context, browser });
          
          // 更新按钮对应的账号
          mainWindow.webContents.send('show-binding-actions', {
            email: acc.email,
            password: acc.password
          });
          
          await updateAccountBindStatus(acc.email, false);
        }
        
      } catch (error) {
        failCount++;
        systemLog(`绑卡异常: ${error.message}`);
        
        // 如果浏览器已打开，保存实例供重试
        if (browser && page) {
          bindLogger.warning(`⚠️ 浏览器保持打开状态，可以重新绑卡`);
          failedAccountBrowsers.set(acc.email, { page, context, browser });
          
          // 更新按钮对应的账号
          mainWindow.webContents.send('show-binding-actions', {
            email: acc.email,
            password: acc.password
          });
        }
        
        await updateAccountBindStatus(acc.email, false);
      }
    }
    
    let summaryMsg = '';
    if (successCount > 0 || failCount > 0 || pendingCount > 0) {
      summaryMsg += `✅ 批量绑卡完成！成功 ${successCount} 个，失败 ${failCount} 个`;
      if (pendingCount > 0) {
        summaryMsg += `，待确认 ${pendingCount} 个`;
      }
    } else {
      summaryMsg += `⚠️ 批量绑卡完成，但没有成功的账号`;
    }
    
    mainWindow.webContents.send('binding-log', {
      message: summaryMsg
    });
    
    // 通知前端刷新数据
    if (successCount > 0 || pendingCount > 0) {
      mainWindow.webContents.send('refresh-data');
    }
    
    return { successCount, failCount, pendingCount };
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
  
  // 重试单个账号绑卡（使用保存的浏览器实例）
  ipcMain.handle('retry-bind-card', async (event, { email, password }) => {
    
    const systemLog = (msg) => {
      // 发送到系统日志
      bindLogger.info(msg);
    };
    
    try {
      // 检查是否有保存的浏览器实例
      const savedBrowser = failedAccountBrowsers.get(email);
      
      if (!savedBrowser) {
        systemLog('未找到浏览器实例，请重新开始绑卡流程');
        return { success: false, error: '未找到浏览器实例' };
      }
      
      const { page, context, browser } = savedBrowser;
      
      // 执行重新绑卡（使用统一日志管理）
      const result = await retryBind(page);
      
      if (result.success) {
        // 重新绑卡成功，关闭浏览器
        systemLog('重试绑卡成功');
        
        try {
          await browser.close();
        } catch (e) {
          // 忽略关闭错误
        }
        
        // 从Map中移除
        failedAccountBrowsers.delete(email);
        
        // 更新账号绑卡状态
        await updateAccountBindStatus(email, true);
        
        // 通知前端刷新数据（账号列表和虚拟卡列表）
        mainWindow.webContents.send('refresh-data');
        
        return { success: true };
      } else if (result.pending) {
        // 重新提交，等待确认
        bindLogger.info(`💡 请在浏览器中查看结果，然后点击下方按钮`);
        
        // 更新按钮对应的账号
        mainWindow.webContents.send('show-binding-actions', {
          email: email,
          password: password
        });
        
        // 监听浏览器关闭事件，自动标记为绑卡失败
        browser.on('disconnected', async () => {
          if (failedAccountBrowsers.has(email)) {
            // 浏览器被关闭，标记为绑卡失败
            await updateAccountBindStatus(email, false);
            failedAccountBrowsers.delete(email);
            systemLog(`浏览器已关闭，自动标记为绑卡失败`);
          }
        });
        
        // 启动后台检测
        startAutoDetection(email, page, browser);
        
        return { success: false, pending: true };
      } else {
        // 重新绑卡失败，保持浏览器打开
        systemLog(`重试绑卡失败: ${result.error || '未知错误'}`);
        bindLogger.warning(`⚠️ 浏览器保持打开状态，可以再次重试`);
        
        // 更新按钮对应的账号
        mainWindow.webContents.send('show-binding-actions', {
          email: email,
          password: password
        });
        
        await updateAccountBindStatus(email, false);
        
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      // 友好的错误提示
      let friendlyMessage = error.message;
      if (error.message.includes('has been closed')) {
        friendlyMessage = '浏览器窗口被关闭';
      } else if (error.message.includes('Timeout')) {
        friendlyMessage = '操作超时';
      } else if (error.message.includes('net::ERR')) {
        friendlyMessage = '网络连接失败';
      }
      
      systemLog(`重试绑卡异常: ${friendlyMessage}`);
      
      await updateAccountBindStatus(email, false);
      
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
