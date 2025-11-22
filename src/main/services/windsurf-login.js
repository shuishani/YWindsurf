/**
 * Windsurf 登录模块
 * 负责登录账号并导航到 Stripe 绑卡页面
 */

const { chromium } = require('playwright');
const { createTaggedLogger } = require('../utils/logger');

// 创建带标签的logger实例
const logger = createTaggedLogger('批量绑卡');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 登录 Windsurf 账号并导航到 Stripe 绑卡页面
 * @param {string} email - 账号邮箱
 * @param {string} password - 账号密码
 * @param {Function} logCallback - 日志回调函数
 * @returns {Promise<{page, context, browser}>}
 */
async function loginToStripePage(email, password) {
  let browser, context, page;
  
  try {
    logger.info('🚀 启动浏览器并登录...');
    
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });
    
    context = await browser.newContext({
      viewport: { width: 900, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    page = await context.newPage();
    
    // 登录
    await page.goto('https://windsurf.com/account/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Log in")');
    await page.waitForURL('**/profile', { timeout: 30000 });
    
    logger.success('✓ 登录成功');
    
    // 点击升级
    await sleep(2000);
    
    try {
      const pagePromise = context.waitForEvent('page');
      await page.click('button:has-text("Upgrade to Pro"), a:has-text("Upgrade to Pro")', { timeout: 10000 });
      
      // 等待 Stripe 页面
      const newPage = await Promise.race([
        pagePromise,
        sleep(10000).then(() => null)
      ]);
      
      if (newPage) {
        page = newPage;
      } else {
        const pages = context.pages();
        for (const p of pages) {
          if (p.url().includes('checkout.stripe.com')) {
            page = p;
            break;
          }
        }
      }
      
      await page.waitForLoadState('domcontentloaded');
      logger.success('✓ 已到达 Stripe 页面');
      
    } catch (clickError) {
      if (clickError.message.includes('Timeout')) {
        logger.warning('⚠️ 未找到"Upgrade to Pro"按钮');
        logger.info('💡 可能原因：');
        logger.info('   1. 账号已经是 Pro 版本');
        logger.info('   2. 页面结构发生变化');
        logger.info('   3. 网络加载较慢');
        logger.info('🔍 尝试查找其他入口...');
        
        // 尝试访问 billing 页面
        try {
          await page.goto('https://windsurf.com/billing', { waitUntil: 'networkidle', timeout: 15000 });
          await sleep(2000);
          
          // 查找可能的按钮
          const addPaymentBtn = await page.$('button:has-text("Add payment"), a:has-text("Add payment"), button:has-text("Update payment"), a:has-text("Update payment")');
          if (addPaymentBtn) {
            logger.success('✓ 找到支付设置入口');
            const pagePromise2 = context.waitForEvent('page');
            await addPaymentBtn.click();
            
            const newPage2 = await Promise.race([
              pagePromise2,
              sleep(10000).then(() => null)
            ]);
            
            if (newPage2) {
              page = newPage2;
              await page.waitForLoadState('domcontentloaded');
              logger.success('✓ 已到达 Stripe 页面');
            } else {
              throw new Error('无法打开 Stripe 页面，请手动检查账号状态');
            }
          } else {
            throw new Error('未找到支付设置入口，账号可能已绑卡或状态异常');
          }
        } catch (billingError) {
          logger.error('访问 billing 页面失败', billingError.message);
          throw new Error('无法访问绑卡页面，请检查账号状态或网络连接');
        }
      } else {
        throw clickError;
      }
    }
    
    return { page, context, browser };
    
  } catch (error) {
    // 友好的错误提示
    let friendlyMessage = error.message;
    
    if (error.message.includes('Timeout')) {
      if (error.message.includes('waitForURL')) {
        friendlyMessage = '登录超时，可能是账号密码错误或网络问题';
      } else if (error.message.includes('waitForLoadState')) {
        friendlyMessage = '页面加载超时，请检查网络连接';
      } else {
        friendlyMessage = '操作超时，请检查网络连接或页面状态';
      }
    } else if (error.message.includes('Target closed') || error.message.includes('has been closed')) {
      friendlyMessage = '浏览器窗口被意外关闭，可能是手动关闭或程序异常';
    } else if (error.message.includes('Navigation failed')) {
      friendlyMessage = '页面导航失败，请检查网络连接';
    } else if (error.message.includes('net::ERR')) {
      friendlyMessage = '网络连接失败，请检查网络设置';
    }
    
    logger.error('登录失败', friendlyMessage);
    
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    throw new Error(friendlyMessage);
  }
}

module.exports = { loginToStripePage };
