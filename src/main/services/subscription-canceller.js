/**
 * 订阅取消模块
 * 负责批量取消 Windsurf Pro 订阅
 * 使用 puppeteer-real-browser 绕过 Cloudflare 检测
 */

const { connect } = require('puppeteer-real-browser');
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
      const response = await connect({
        headless: false,
        fingerprint: true,
        turnstile: true,
        tf: true,
        args: ['--disable-blink-features=AutomationControlled']
      });
      
      browser = response.browser;
      page = response.page;
      
      // 设置浏览器窗口大小为 800x900
      await page.setViewport({ width: 800, height: 900 });
      
      taggedTaskLogger.info('浏览器已启动');
      
      // 2. 登录账号
      taggedTaskLogger.info('登录账号');
      await page.goto('https://windsurf.com/account/login', { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(1000);
      
      // 填写邮箱
      const emailInput = await page.$('input[type="email"]');
      if (emailInput) {
        await emailInput.click();
        await emailInput.type(account.email, { delay: 50 });
      }
      
      // 填写密码
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click();
        await passwordInput.type(account.password, { delay: 50 });
      }
      
      // 点击登录
      const loginBtn = await page.$('button[type="submit"]');
      if (loginBtn) {
        await loginBtn.click();
      }
      
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        taggedTaskLogger.success('登录成功');
      } catch (error) {
        throw new Error('登录超时，可能是账号密码错误');
      }
      
      await sleep(2000);
      
      // 3. 导航到订阅管理页面
      taggedTaskLogger.step(3, '访问订阅管理页面');
      await page.goto('https://windsurf.com/subscription/manage-plan', { 
        waitUntil: 'networkidle2',
        timeout: 15000 
      });
      await sleep(2000);
      taggedTaskLogger.success('已到达订阅管理页面');
      
      // 4. 检查订阅状态
      taggedTaskLogger.step(4, '检查订阅状态');
      
      // 通过文本查找按钮
      const findButtonByText = async (texts) => {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          for (const t of texts) {
            if (text && text.includes(t)) return btn;
          }
        }
        return null;
      };
      
      // 先检查是否已经取消
      const renewButton = await findButtonByText(['Renew plan']);
      if (renewButton) {
        taggedTaskLogger.success('订阅已经取消，无需重复操作');
        return { success: true, message: '订阅已经取消', alreadyCancelled: true };
      }
      
      // 查找 Cancel plan 按钮
      const cancelButton = await findButtonByText(['Cancel plan']);
      if (!cancelButton) {
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
      
      // 6. 选择取消原因
      taggedTaskLogger.step(6, '选择取消原因');
      await sleep(2000);
      
      const firstReason = await page.$('input[type="radio"]');
      if (firstReason) {
        await firstReason.click();
        await sleep(500);
        taggedTaskLogger.success('已选择取消原因');
      }
      
      // 7. 确认取消
      taggedTaskLogger.step(7, '确认取消订阅');
      
      const confirmButton = await findButtonByText(['Cancel subscription', 'Cancel plan', 'Confirm', 'Continue']);
      if (!confirmButton) {
        throw new Error('未找到确认取消按钮');
      }
      
      await confirmButton.click();
      taggedTaskLogger.progress('等待处理...');
      
      // 8. 等待跳转
      taggedTaskLogger.step(8, '验证取消结果');
      await sleep(5000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('/subscription/usage')) {
        taggedTaskLogger.success('取消订阅成功！');
        return { success: true };
      }
      
      // 再等待一下
      await sleep(5000);
      const finalUrl = page.url();
      if (finalUrl.includes('/subscription/usage')) {
        taggedTaskLogger.success('取消订阅成功！');
        return { success: true };
      }
      
      throw new Error('未能跳转到 usage 页面，取消可能失败');
      
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
