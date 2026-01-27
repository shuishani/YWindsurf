/**
 * Cloudflare Turnstile 验证处理器
 * 支持多种方式获取 token：
 * 1. CaptchaRun API（推荐，需要 API Key）
 * 2. puppeteer-real-browser 自动处理（备用）
 */

const { ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createTaggedLogger } = require('../utils/logger');
const windsurfPaths = require('../../shared/config/windsurf-paths');

const SETTINGS_FILE = path.join(windsurfPaths.getJsonDataDir(), 'settings.json');

// 读取设置
async function getSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

const logger = createTaggedLogger('批量绑卡');

const SITEKEY = '0x4AAAAAAA447Bur1xJStKg5';
const WEBSITE_URL = 'https://windsurf.com/plan';

/**
 * 使用 CaptchaRun API 获取 Turnstile token
 * API 文档: https://docs.captcha.run/guide/rz7to05q/
 * @param {string} apiKey - CaptchaRun API Key
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
async function solveTurnstileWithCaptchaRun(apiKey) {
  try {
    logger.info('使用 CaptchaRun 解决验证码...');
    
    // 1. 创建任务
    const createTaskResponse = await axios.post('https://api.captcha.run/v2/tasks', {
      captchaType: 'Turnstile',
      siteKey: SITEKEY,
      siteReferer: WEBSITE_URL
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 30000
    });
    
    if (!createTaskResponse.data.taskId) {
      return { success: false, error: createTaskResponse.data.message || '创建任务失败' };
    }
    
    const taskId = createTaskResponse.data.taskId;
    logger.info(`任务已创建: ${taskId}，等待结果...`);
    
    // 2. 轮询获取结果（最多等待 120 秒）
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const resultResponse = await axios.get(`https://api.captcha.run/v2/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });
      
      const data = resultResponse.data;
      
      if (data.status === 'Success' && data.response?.token) {
        logger.success('CaptchaRun 验证成功');
        return { success: true, token: data.response.token };
      } else if (data.status === 'Failed' || data.status === 'Error') {
        return { success: false, error: data.message || '验证失败' };
      }
      
      // 每10秒输出一次等待日志
      if (i > 0 && i % 5 === 0) {
        logger.info(`等待验证结果... (${i * 2}秒)`);
      }
    }
    
    return { success: false, error: '验证超时' };
    
  } catch (error) {
    logger.error('CaptchaRun 请求失败', error.message);
    return { success: false, error: error.message };
  }
}


/**
 * 登录账号后打开 pricing 页面，完成验证后直接在 Stripe 页面绑卡
 * @param {string} email - 账号邮箱
 * @param {string} password - 账号密码
 * @param {object} cardInfo - 虚拟卡信息（可选）
 * @returns {Promise<{success: boolean, paymentLink?: string, page?: object, browser?: object, error?: string}>}
 */
async function getPaymentLinkWithBrowser(email, password, cardInfo = null) {
  const { connect } = require('puppeteer-real-browser');
  let browser, page;
  
  try {
    logger.info('打开浏览器登录...');
    
    const response = await connect({
      headless: false,
      fingerprint: true,
      turnstile: false,  // 禁用自动处理，避免窗口乱跳
      tf: false,
      args: ['--disable-blink-features=AutomationControlled']
    });
    
    browser = response.browser;
    page = response.page;
    
    await page.setViewport({ width: 780, height: 850 });
    
    // 1. 登录
    logger.info('访问登录页面...');
    await page.goto('https://windsurf.com/account/login', { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 填写邮箱
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.click();
      await emailInput.type(email, { delay: 30 });
    }
    
    // 填写密码
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await passwordInput.type(password, { delay: 30 });
    }
    
    // 点击登录按钮
    await new Promise(resolve => setTimeout(resolve, 500));
    const loginClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim();
        if (text === 'Log in' || text === 'Sign in') {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (!loginClicked) {
      throw new Error('未找到登录按钮');
    }
    
    logger.info('等待登录...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    logger.success('登录成功');
    
    // 2. 访问 pricing 页面
    logger.info('访问 pricing 页面...');
    await page.goto('https://windsurf.com/pricing', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. 监听页面跳转
    let stripePage = null;
    
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (url.includes('checkout.stripe.com')) {
          stripePage = page;
        }
      }
    });
    
    // 4. 点击 "Start Free Trial"
    logger.info('点击 Start Free Trial...');
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a');
      for (const btn of buttons) {
        const text = btn.textContent?.trim();
        if (text && (text.includes('Start Free Trial') || text.includes('Start free trial'))) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    // 5. 等待验证或直接跳转到 Stripe 页面
    logger.info('等待验证或跳转...');
    
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 先检查是否已经在 Stripe 页面
      const currentUrl = page.url();
      if (currentUrl.includes('checkout.stripe.com')) {
        stripePage = page;
        logger.success('已到达 Stripe 页面');
        break;
      }
      
      // 检查所有页面
      const pages = await browser.pages();
      for (const p of pages) {
        const url = p.url();
        if (url.includes('checkout.stripe.com')) {
          stripePage = p;
          await p.bringToFront();
          break;
        }
      }
      
      if (stripePage) {
        break;
      }
      
      // 尝试点击 Continue 按钮（使用 Puppeteer 方式）
      let clicked = false;
      
      // 方式1: 通过 button[type="submit"]
      try {
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
          clicked = true;
          logger.success('已点击 Continue (submit)');
        }
      } catch (e) {}
      
      // 方式2: 通过文本匹配
      if (!clicked) {
        try {
          const buttons = await page.$$('button');
          for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text && (text.includes('Continue') || text.includes('继续'))) {
              await btn.click();
              clicked = true;
              logger.success('已点击 Continue (text)');
              break;
            }
          }
        } catch (e) {}
      }
      
      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      if (i > 0 && i % 15 === 0) {
        logger.info(`等待中... (${i}秒)`);
      }
    }
    
    if (!stripePage) {
      await browser.close();
      return { success: false, error: '获取链接超时' };
    }
    
    const stripeLink = stripePage.url();
    
    // 返回浏览器和页面，让调用方继续绑卡操作
    return { 
      success: true, 
      paymentLink: stripeLink,
      page: stripePage,
      browser: browser
    };
    
  } catch (error) {
    logger.error('获取链接失败', error.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    return { success: false, error: error.message };
  }
}

/**
 * 不登录直接获取 token（备用方案）
 */
async function solveTurnstileWithBrowser() {
  // 这个函数现在不再使用，改用 getPaymentLinkWithBrowser
  return { success: false, error: '请使用浏览器方式获取链接' };
}

/**
 * 获取 Turnstile token（自动选择最佳方式）
 * 优先级：CaptchaRun > CapSolver > 浏览器方式
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
async function getTurnstileToken() {
  try {
    const settings = await getSettings();
    
    // 1. 优先使用 CaptchaRun API Key
    const captchaRunKey = settings.captchaRunApiKey;
    if (captchaRunKey) {
      const result = await solveTurnstileWithCaptchaRun(captchaRunKey);
      if (result.success) {
        return result;
      }
      logger.warning('CaptchaRun 失败，尝试其他方式...');
    }
    
    // 2. 默认使用免费的浏览器方式
    return await solveTurnstileWithBrowser();
    
  } catch (error) {
    logger.error('获取验证码失败', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 显示 Turnstile 验证弹窗（使用 puppeteer）
 */
async function showTurnstileWindow(parentWindow) {
  return await getTurnstileToken();
}

// 保存设置
async function saveSettings(settings) {
  const currentSettings = await getSettings();
  const newSettings = { ...currentSettings, ...settings };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
}

/**
 * 初始化 Turnstile 处理器
 */
function initTurnstileHandlers(mainWindow) {
  // 显示验证弹窗
  ipcMain.handle('show-turnstile', async () => {
    return await showTurnstileWindow(mainWindow);
  });
  
  // 保存 CaptchaRun API Key
  ipcMain.handle('save-captcharun-key', async (event, key) => {
    await saveSettings({ captchaRunApiKey: key });
    return { success: true };
  });
  
  // 获取 CaptchaRun API Key
  ipcMain.handle('get-captcharun-key', async () => {
    const settings = await getSettings();
    return settings.captchaRunApiKey || '';
  });
  
  // 测试 CaptchaRun API Key（查询余额）
  ipcMain.handle('test-captcharun-key', async (event, key) => {
    try {
      const response = await axios.get('https://api.captcha.run/v2/users/self/wallet', {
        headers: {
          'Authorization': `Bearer ${key}`
        },
        timeout: 10000
      });
      
      if (response.data && response.data.balance !== undefined) {
        return { success: true, balance: response.data.balance };
      } else {
        return { success: false, error: 'API Key 无效' };
      }
    } catch (error) {
      if (error.response?.status === 401) {
        return { success: false, error: 'API Key 无效或已过期' };
      }
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  getTurnstileToken,
  getPaymentLinkWithBrowser,
  showTurnstileWindow,
  initTurnstileHandlers
};
