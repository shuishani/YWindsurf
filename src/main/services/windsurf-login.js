/**
 * Windsurf 登录模块
 * 负责登录账号并导航到 Stripe 绑卡页面
 * 使用 puppeteer-real-browser 绕过 Cloudflare 检测
 */

const { connect } = require('puppeteer-real-browser');
const { createTaggedLogger } = require('../utils/logger');

const logger = createTaggedLogger('批量绑卡');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 登录 Windsurf 账号并导航到 Stripe 绑卡页面
 */
async function loginToStripePage(email, password) {
  let browser, page;
  
  try {
    logger.info('启动浏览器并登录');
    
    // 使用 puppeteer-real-browser
    // 注意：禁用 turnstile 和 tf，避免干扰表单输入
    const response = await connect({
      headless: false,
      fingerprint: true,
      turnstile: false,  // 禁用自动处理验证码，避免干扰输入
      tf: false,         // 禁用 tf，避免干扰输入
      args: ['--disable-blink-features=AutomationControlled']
    });
    
    browser = response.browser;
    page = response.page;
    
    // 设置浏览器窗口大小为 800x900
    await page.setViewport({ width: 800, height: 900 });
    
    // 登录
    await page.goto('https://windsurf.com/account/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1000);
    
    // 填写邮箱
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.click();
      await emailInput.type(email, { delay: 50 });
    }
    
    // 填写密码
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await passwordInput.type(password, { delay: 50 });
    }
    
    // 点击登录按钮 - 简单查找 "Log in"
    const buttons = await page.$$('button');
    let loginClicked = false;
    
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.trim() === 'Log in') {
        await btn.click();
        loginClicked = true;
        logger.info('点击 Log in 按钮');
        break;
      }
    }
    
    if (!loginClicked) {
      throw new Error('未找到 Log in 按钮');
    }
    
    // 等待登录成功
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    logger.success('登录成功');
    
    // 点击升级
    await sleep(2000);
    
    try {
      // 监听新页面
      const newPagePromise = new Promise(resolve => {
        browser.once('targetcreated', async target => {
          const newPage = await target.page();
          resolve(newPage);
        });
      });
      
      // 点击 Upgrade to Pro
      let upgradeClicked = false;
      const buttons = await page.$$('button, a');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('Upgrade to Pro')) {
          await btn.click();
          upgradeClicked = true;
          logger.info('点击 Upgrade to Pro');
          break;
        }
      }
      
      if (!upgradeClicked) {
        throw new Error('未找到 Upgrade to Pro 按钮');
      }
      
      // 等待页面跳转或内嵌表单出现
      await sleep(3000);
      
      // 检查是否打开了新页面（Stripe独立页面）
      const stripePage = await Promise.race([
        newPagePromise,
        sleep(5000).then(() => null)
      ]);
      
      if (stripePage) {
        const stripeUrl = stripePage.url();
        if (stripeUrl.includes('checkout.stripe.com')) {
          page = stripePage;
          await page.bringToFront();
          await sleep(2000);
          logger.success('已到达 Stripe 页面');
        }
      }
      
      // 如果没有新页面，检查当前页面是否有绑卡表单（内嵌模式）
      const hasPaymentForm = await page.evaluate(() => {
        return !!document.querySelector('input[name="number"], input[autocomplete="cc-number"], [data-testid="card-accordion-item-button"]');
      }).catch(() => false);
      
      if (hasPaymentForm) {
        logger.success('检测到内嵌绑卡表单');
      } else {
        // 检查所有页面
        const pages = await browser.pages();
        for (const p of pages) {
          const url = p.url();
          if (url.includes('checkout.stripe.com')) {
            page = p;
            await page.bringToFront();
            logger.success('已到达 Stripe 页面');
            break;
          }
        }
      }
      
    } catch (clickError) {
      logger.warning('点击升级按钮失败，尝试 billing 页面');
      
      await page.goto('https://windsurf.com/billing', { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(2000);
    }
    
    return { page, browser };
    
  } catch (error) {
    let friendlyMessage = error.message;
    
    if (error.message.includes('Timeout') || error.message.includes('timeout')) {
      friendlyMessage = '操作超时，可能是账号密码错误或网络问题';
    } else if (error.message.includes('closed')) {
      friendlyMessage = '浏览器窗口被关闭';
    } else if (error.message.includes('net::ERR')) {
      friendlyMessage = '网络连接失败';
    }
    
    logger.error('登录失败', friendlyMessage);
    
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    throw new Error(friendlyMessage);
  }
}

module.exports = { loginToStripePage };
