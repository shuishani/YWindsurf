/**
 * 订阅取消模块
 * 负责批量取消 Windsurf Pro 订阅
 */

const { chromium } = require('playwright');
const { createTaggedLogger, Logger } = require('../utils/logger');

// 创建带标签的logger实例
const logger = createTaggedLogger('取消订阅');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 取消订阅处理类
 */
class SubscriptionCanceller {
  constructor() {
    this.shouldCancel = false;
  }

  /**
   * 设置取消检查函数
   */
  setCancelChecker(checker) {
    this.cancelChecker = checker;
  }

  /**
   * 检查是否应该取消操作
   */
  shouldCancelOperation() {
    return this.cancelChecker ? this.cancelChecker() : false;
  }

  /**
   * 批量取消订阅
   * @param {Array} accounts - 账号列表
   * @param {Function} progressCallback - 进度回调
   * @param {Function} logCallback - 日志回调
   * @param {number} concurrent - 并发数
   */
  async batchCancel(accounts, progressCallback, logCallback, concurrent = 3) {
    logger.start(`开始批量取消订阅，共 ${accounts.length} 个账号`);
    
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const results = [];

    // 并发控制队列
    const queue = [...accounts];
    const running = new Map();
    let taskCounter = 1; // 任务计数器

    while (queue.length > 0 || running.size > 0) {
      // 检查是否需要取消
      if (this.shouldCancelOperation()) {
        logger.warning('用户取消操作');
        // 等待正在运行的任务完成
        if (running.size > 0) {
          await Promise.all(Array.from(running.values()));
        }
        break;
      }

      // 启动新任务直到达到并发限制
      while (running.size < concurrent && queue.length > 0) {
        const account = queue.shift();
        const taskIndex = taskCounter++; // 使用递增的任务计数器
        
        const task = this.cancelOne(account, logCallback, taskIndex)
          .then(result => {
            completed++;
            if (result.success) {
              succeeded++;
              if (result.alreadyCancelled) {
                logger.success(`${account.email} 订阅已取消`);
              } else {
                logger.success(`${account.email} 取消成功`);
              }
            } else {
              failed++;
              logger.error(`${account.email} 取消失败`, result.error);
            }
            
            results.push({ account, result });
            
            // 更新进度
            if (progressCallback) {
              progressCallback({
                total: accounts.length,
                completed,
                succeeded,
                failed,
                current: account.email
              });
            }
            
            return result;
          })
          .catch(error => {
            completed++;
            failed++;
            logger.error(`${account.email} 异常`, error.message);
            
            results.push({ 
              account, 
              result: { success: false, error: error.message } 
            });
            
            if (progressCallback) {
              progressCallback({
                total: accounts.length,
                completed,
                succeeded,
                failed,
                current: account.email
              });
            }
          })
          .finally(() => {
            running.delete(account.email);
          });

        running.set(account.email, task);
      }

      // 等待任意一个任务完成
      if (running.size > 0) {
        await Promise.race(Array.from(running.values()));
      }
    }

    logger.complete(`批量取消完成: 成功 ${succeeded}，失败 ${failed}`);
    
    return {
      success: true,
      total: accounts.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * 取消单个账号的订阅
   * @param {Object} account - 账号信息
   * @param {Function} logCallback - 日志回调
   * @param {number} taskId - 任务ID，用于日志标识
   */
  async cancelOne(account, logCallback, taskId = null) {
    let browser, context, page;
    
    // 为每个任务创建独立的 Logger 实例
    const taskLogger = new Logger(taskId);
    const taggedTaskLogger = {
      info: (action, details = '') => taskLogger.log('info', null, action, details, '取消订阅'),
      success: (action, details = '') => taskLogger.log('success', null, action, details, '取消订阅'),
      error: (action, details = '') => taskLogger.logError(action, details, '取消订阅'),
      warning: (action, details = '') => taskLogger.log('warning', null, action, details, '取消订阅'),
      step: (stepNumber, action, details = '') => taskLogger.log('step', stepNumber, action, details, '取消订阅'),
      progress: (action, details = '') => taskLogger.log('progress', null, action, details, '取消订阅')
    };
    
    try {
      taggedTaskLogger.info(`开始处理: ${account.email}`);
      
      // 1. 启动浏览器
      taggedTaskLogger.info('启动浏览器');
      browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled']
      });
      
      context = await browser.newContext({
        viewport: { width: 900, height: 1000 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      
      page = await context.newPage();
      taggedTaskLogger.info('浏览器已启动');
      
      // 2. 登录账号
      taggedTaskLogger.info('登录账号');
      await page.goto('https://windsurf.com/account/login', { waitUntil: 'networkidle' });
      await sleep(1000);
      
      await page.fill('input[type="email"]', account.email);
      await page.fill('input[type="password"]', account.password);
      await page.click('button:has-text("Log in")');
      
      try {
        await page.waitForURL('**/profile', { timeout: 30000 });
        taggedTaskLogger.success('登录成功');
      } catch (error) {
        throw new Error('登录超时，可能是账号密码错误');
      }
      
      await sleep(2000);
      
      // 3. 导航到订阅管理页面
      taggedTaskLogger.step(3, '访问订阅管理页面');
      await page.goto('https://windsurf.com/subscription/manage-plan', { 
        waitUntil: 'networkidle',
        timeout: 15000 
      });
      await sleep(2000);
      taggedTaskLogger.success('已到达订阅管理页面');
      
      // 4. 检查订阅状态
      taggedTaskLogger.step(4, '检查订阅状态');
      
      // 先检查是否已经取消（显示 Renew plan 按钮）
      const renewButton = await page.$('button:has-text("Renew plan")');
      if (renewButton) {
        taggedTaskLogger.success('订阅已经取消，无需重复操作');
        return { success: true, message: '订阅已经取消', alreadyCancelled: true };
      }
      
      // 查找 Cancel plan 按钮
      const cancelButton = await page.$('button:has-text("Cancel plan")');
      if (!cancelButton) {
        // 可能是免费版用户
        const pageContent = await page.content();
        if (pageContent.includes('Free plan')) {
          taggedTaskLogger.warning('账号是免费版，没有订阅');
          return { success: false, error: '账号是免费版，没有订阅' };
        }
        throw new Error('未找到取消订阅按钮');
      }
      
      taggedTaskLogger.step(5, '点击取消订阅按钮');
      
      await cancelButton.click();
      await sleep(2000);
      taggedTaskLogger.success('已点击取消按钮');
      
      // 6. 选择取消原因（第一个）
      taggedTaskLogger.step(6, '选择取消原因');
      
      // 等待原因选择界面出现
      await page.waitForSelector('input[type="radio"], [role="radio"]', { timeout: 5000 });
      
      // 选择第一个原因
      const firstReason = await page.$('input[type="radio"]:first-of-type, [role="radio"]:first-of-type');
      if (firstReason) {
        await firstReason.click();
        await sleep(500);
        taggedTaskLogger.success('已选择取消原因');
      } else {
        taggedTaskLogger.warning('未找到原因选项，尝试继续');
      }
      
      // 7. 确认取消
      taggedTaskLogger.step(7, '确认取消订阅');
      
      // 查找确认按钮（可能的文本：Cancel subscription, Confirm, Continue 等）
      const confirmButton = await page.$(
        'button:has-text("Cancel subscription"), ' +
        'button:has-text("Cancel plan"), ' +
        'button:has-text("Confirm"), ' +
        'button:has-text("Continue")'
      );
      
      if (!confirmButton) {
        throw new Error('未找到确认取消按钮');
      }
      
      await confirmButton.click();
      taggedTaskLogger.progress('等待处理...');
      
      // 8. 等待跳转到 usage 页面
      taggedTaskLogger.step(8, '验证取消结果');
      try {
        await page.waitForURL('**/subscription/usage', { timeout: 15000 });
        taggedTaskLogger.success('取消订阅成功！已跳转到 usage 页面');
        
        await sleep(2000);
        return { success: true };
        
      } catch (error) {
        // 检查是否有错误提示
        const errorMsg = await page.$eval('.error, [role="alert"]', el => el.textContent).catch(() => null);
        if (errorMsg) {
          throw new Error(`取消失败: ${errorMsg}`);
        }
        
        // 检查当前URL
        const currentUrl = page.url();
        if (currentUrl.includes('/subscription/usage')) {
          taggedTaskLogger.success('取消订阅成功！');
          return { success: true };
        }
        
        throw new Error('未能跳转到 usage 页面，取消可能失败');
      }
      
    } catch (error) {
      // 友好的错误提示
      let friendlyMessage = error.message;
      
      if (error.message.includes('Timeout')) {
        friendlyMessage = '操作超时，可能是网络问题或页面加载缓慢';
      } else if (error.message.includes('has been closed')) {
        friendlyMessage = '浏览器窗口被关闭，请不要手动关闭浏览器';
      } else if (error.message.includes('net::ERR')) {
        friendlyMessage = '网络连接失败，请检查网络设置';
      } else if (error.message.includes('Element not found')) {
        friendlyMessage = '页面元素未找到，可能是页面结构变化';
      }
      
      taggedTaskLogger.error('取消失败', friendlyMessage);
      return { success: false, error: friendlyMessage };
      
    } finally {
      // 关闭浏览器
      if (browser) {
        try {
          await sleep(1000);
          await browser.close();
          taggedTaskLogger.info('浏览器已关闭');
        } catch (e) {
          // 忽略关闭错误
        }
      }
    }
  }
}

module.exports = SubscriptionCanceller;
