const { chromium } = require('playwright');
const { createTaggedLogger } = require('../utils/logger');

/**
 * 浏览器自动化 - 自动登录Windsurf
 */
class BrowserAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLaunched = false; // 标记浏览器是否是通过 launch() 启动的
    // 使用带标签的logger实例
    this.logger = createTaggedLogger('浏览器自动化');
  }

  // 移除重复的开发模式检查，使用统一日志系统

  /**
   * 获取系统 Chrome 路径
   */
  getSystemChromePath() {
    const fs = require('fs');
    const path = require('path');
    
    const programFiles = process.env['PROGRAMFILES'];
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env['LOCALAPPDATA'];
    
    const possiblePaths = [
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];
    
    for (const chromePath of possiblePaths) {
      try {
        if (fs.existsSync(chromePath)) {
          return chromePath;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * 启动浏览器 - 优先使用系统 Chrome
   */
  async launch(headless = false) {
    try {
      this.logger.browser('启动浏览器');
      
      const launchOptions = {
        headless: headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--remote-debugging-port=9222' // 启用调试端口，方便后续连接
        ],
        defaultViewport: {
          width: 1280,
          height: 800
        },
        ignoreHTTPSErrors: true
      };
      
      // 如果需要无痕模式，使用 Puppeteer 的原生方式
      if (!headless) {
        // 对于可见浏览器，添加无痕模式参数
        launchOptions.args.push('--incognito');
      }
      
      // 尝试使用系统 Chrome
      const systemChromePath = this.getSystemChromePath();
      if (systemChromePath) {
        this.logger.browser('使用系统 Chrome', systemChromePath);
        launchOptions.executablePath = systemChromePath;
        // 使用系统 Chrome 的用户数据目录（可选，但可能导致冲突）
        // Windows: %LOCALAPPDATA%\Google\Chrome\User Data
      } else {
        this.logger.warning('未找到系统 Chrome，使用 Puppeteer 自带的 Chromium');
      }
      
      this.browser = await chromium.launch({
        headless: headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
      this.isLaunched = true; // 标记为通过 launch() 启动
      
      // 创建浏览器上下文
      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      this.page = await context.newPage();
      
      // 设置额外的标志来避免检测
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      });
      
      this.logger.success('浏览器已启动');
      return true;
    } catch (error) {
      this.logger.error('启动浏览器失败', error.message);
      return false;
    }
  }

  /**
   * 连接到系统默认浏览器（通过 CDP）
   */
  async connectToSystemBrowser() {
    try {
      this.logger.network('尝试连接到系统默认浏览器');
      
      // 尝试连接到 Chrome/Edge 的调试端口
      const possiblePorts = [9222, 9223, 9224];
      
      for (const port of possiblePorts) {
        try {
          const browserURL = `http://127.0.0.1:${port}`;
          this.browser = await puppeteer.connect({
            browserURL: browserURL,
            defaultViewport: null
          });
          
          const pages = await this.browser.pages();
          this.logger.success('成功连接到浏览器', `端口 ${port}，找到 ${pages.length} 个标签页`);
          
          // 查找登录页面
          for (const page of pages) {
            const url = page.url();
            if (url && (
              url.includes('windsurf.com') || 
              url.includes('codeium.com') ||
              url.includes('auth') ||
              url.includes('signin') ||
              url.includes('login')
            )) {
              this.page = page;
              this.logger.success('找到登录页面', url);
              return true;
            }
          }
          
          // 如果没有找到，监听新标签页
          this.browser.on('targetcreated', async (target) => {
            const page = await target.page();
            if (page) {
              const url = page.url();
              if (url && (
                url.includes('windsurf.com') || 
                url.includes('codeium.com') ||
                url.includes('auth') ||
                url.includes('signin') ||
                url.includes('login')
              )) {
                this.page = page;
                this.logger.success('检测到新的登录页面', url);
              }
            }
          });
          
          return true;
        } catch (err) {
          // 继续尝试下一个端口
          continue;
        }
      }
      
      this.logger.warning('无法连接到系统浏览器，将启动新的浏览器实例');
      return false;
    } catch (error) {
      this.logger.error('连接系统浏览器失败', error.message);
      return false;
    }
  }

  /**
   * 等待登录URL出现 - 改进版（支持监听新标签页）
   */
  async waitForLoginUrl(timeout = 90000) {
    try {
      this.logger.browser('等待登录URL');
      this.logger.info('正在监听浏览器窗口');
      
      // 检查浏览器是否已启动
      if (!this.browser) {
        this.logger.error('浏览器未启动，无法等待登录URL');
        throw new Error('浏览器未启动');
      }
      
      const startTime = Date.now();
      let lastPageCount = 0;
      
      // 监听新标签页
      const pagePromise = new Promise((resolve) => {
        const listener = async (target) => {
          try {
            const page = await target.page();
            if (page) {
              const url = page.url();
              if (url && (
                url.includes('windsurf.com') || 
                url.includes('codeium.com') ||
                url.includes('auth') ||
                url.includes('signin') ||
                url.includes('login')
              )) {
                this.page = page;
                this.logger.success('检测到新的登录页面', url);
                this.browser.removeListener('targetcreated', listener);
                resolve(url);
              }
            }
          } catch (err) {
            // 忽略错误
          }
        };
        this.browser.on('targetcreated', listener);
      });
      
      // 同时检查现有页面
      while (Date.now() - startTime < timeout) {
        try {
          const pages = await this.browser.pages();
          
          // 显示进度
          if (pages.length !== lastPageCount) {
            this.logger.info('当前浏览器页面数', `${pages.length} 个页面`);
            lastPageCount = pages.length;
          }
          
          for (const page of pages) {
            try {
              const url = page.url();
              
              // 更宽松的URL匹配
              if (url && (
                  url.includes('windsurf.com') || 
                  url.includes('codeium.com') ||
                  url.includes('auth') ||
                  url.includes('signin') ||
                  url.includes('login')
              )) {
                this.logger.success('检测到登录URL', url);
                this.page = page;
                
                // 等待页面加载
                await this.sleep(2000);
                return url;
              }
            } catch (err) {
              // 忽略单个页面错误
            }
          }
          
          // 检查是否有新标签页
          const raceResult = await Promise.race([
            pagePromise,
            new Promise(resolve => setTimeout(() => resolve(null), 1000))
          ]);
          
          if (raceResult) {
            await this.sleep(2000);
            return raceResult;
          }
        } catch (err) {
          this.logger.error('获取页面列表失败', err.message);
        }
        
        await this.sleep(1000);
      }
      
      this.logger.error('等待登录URL超时');
      return null;
    } catch (error) {
      this.logger.error('等待登录URL失败', error.message);
      return null;
    }
  }

  /**
   * 自动填写登录表单 - 改进版
   */
  async fillLoginForm(email, password) {
    try {
      this.logger.step(1, '填写登录表单', `邮箱: ${email}`);
      
      // 等待页面稳定
      await this.sleep(3000);
      
      // 先获取页面上所有的输入框,分析结构
      const inputs = await this.page.$$('input');
      this.logger.info('页面输入框数量', `${inputs.length} 个`);
      
      // 查找Email输入框 - 优先级从高到低
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[autocomplete="email"]',
        'input[placeholder*="Email" i]',
        'input[placeholder*="邮箱" i]'
      ];
      
      let emailInput = null;
      for (const selector of emailSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            // 检查元素是否可见
            const isVisible = await element.isIntersectingViewport();
            if (isVisible) {
              this.logger.success('找到邮箱输入框', selector);
              emailInput = element;
              break;
            }
          }
        } catch (err) {
          continue;
        }
      }
      
      // 如果还没找到,尝试通过文本标签查找
      if (!emailInput) {
        this.logger.progress('尝试通过页面结构查找邮箱输入框');
        emailInput = await this.page.evaluateHandle(() => {
          const labels = Array.from(document.querySelectorAll('label, div, span'));
          for (const label of labels) {
            if (label.textContent.match(/email/i)) {
              // 查找关联的input
              const input = label.querySelector('input') || 
                           document.querySelector(`input[id="${label.getAttribute('for')}"]`) ||
                           label.nextElementSibling?.querySelector('input');
              if (input && input.type !== 'password') {
                return input;
              }
            }
          }
          return null;
        });
        
        if (emailInput && await emailInput.evaluate(el => el !== null)) {
          this.logger.success('通过标签找到邮箱输入框');
        } else {
          emailInput = null;
        }
      }
      
      if (!emailInput) {
        this.logger.error('未找到邮箱输入框');
        // 截图帮助调试
        await this.page.screenshot({ path: '/tmp/login-form-debug.png' });
        this.logger.debug('已保存截图到 /tmp/login-form-debug.png');
        return false;
      }
      
      // 填写邮箱
      await emailInput.click({ clickCount: 3 });
      await this.sleep(500);
      await emailInput.type(email, { delay: 100 });
      this.logger.success('已输入邮箱');
      
      await this.sleep(1000);
      
      // 查找Password输入框
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id="password"]',
        'input[autocomplete="current-password"]',
        'input[placeholder*="Password" i]',
        'input[placeholder*="密码" i]'
      ];
      
      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isIntersectingViewport();
            if (isVisible) {
              this.logger.success('找到密码输入框', selector);
              passwordInput = element;
              break;
            }
          }
        } catch (err) {
          continue;
        }
      }
      
      if (!passwordInput) {
        this.logger.error('未找到密码输入框');
        await this.page.screenshot({ path: '/tmp/login-form-debug.png' });
        this.logger.debug('已保存截图到 /tmp/login-form-debug.png');
        return false;
      }
      
      // 填写密码
      await passwordInput.click({ clickCount: 3 });
      await this.sleep(500);
      await passwordInput.type(password, { delay: 100 });
      this.logger.success('已输入密码');
      
      await this.sleep(1000);
      
      // 查找并点击"Log in"按钮
      this.logger.progress('查找登录按钮');
      
      // 方法1: 通过文本内容查找按钮
      let loginButton = await this.page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        for (const btn of buttons) {
          const text = btn.textContent || btn.value || '';
          if (text.match(/log\s*in|sign\s*in|登录|继续/i)) {
            return btn;
          }
        }
        return null;
      });
      
      if (loginButton && await loginButton.evaluate(el => el !== null)) {
        const buttonText = await loginButton.evaluate(el => el.textContent || el.value);
        this.logger.success('找到登录按钮', buttonText);
        await loginButton.click();
        this.logger.success('已点击登录按钮');
      } else {
        // 方法2: 尝试其他选择器
        const buttonSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[class*="submit"]',
          'button[class*="login"]',
          'button[class*="primary"]'
        ];
        
        let clicked = false;
        for (const selector of buttonSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              this.logger.success('找到提交按钮', selector);
              await button.click();
              this.logger.success('已点击提交按钮');
              clicked = true;
              break;
            }
          } catch (err) {
            continue;
          }
        }
        
        // 方法3: 按Enter键
        if (!clicked) {
          this.logger.info('未找到按钮，尝试按Enter键');
          await this.page.keyboard.press('Enter');
          this.logger.success('已按Enter提交');
        }
      }
      
      await this.sleep(2000);
      return true;
      
    } catch (error) {
      this.logger.error('填写登录表单失败', error.message);
      return false;
    }
  }

  /**
   * 检测验证码是否存在
   */
  async detectCaptcha() {
    try {
      if (!this.page) {
        return false;
      }

      // 检测常见的验证码元素和特征（与注册流程保持一致）
      const captchaIndicators = [
        // Cloudflare Turnstile (优先检测，因为注册流程主要处理这个)
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="cloudflare"]',
        '[data-sitekey][data-callback*="turnstile"]',
        // reCAPTCHA
        'iframe[src*="recaptcha"]',
        'iframe[src*="google.com/recaptcha"]',
        '.g-recaptcha',
        '[data-sitekey]', // reCAPTCHA site key
        // hCaptcha
        'iframe[src*="hcaptcha"]',
        '.h-captcha',
        // 通用验证码
        'div[class*="captcha" i]',
        'div[id*="captcha" i]',
        '#captcha',
        '.captcha',
        // 验证码文本提示
        '*:contains("验证码")',
        '*:contains("captcha")',
        '*:contains("人机验证")',
        '*:contains("Verify")',
        '*:contains("Cloudflare")'
      ];

      // 方法1: 检查 iframe 和元素
      for (const selector of captchaIndicators) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            // 检查元素是否可见
            const isVisible = await element.isIntersectingViewport().catch(() => false);
            if (isVisible) {
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // 方法2: 检查页面文本内容
      try {
        const pageText = await this.page.evaluate(() => {
          return document.body.innerText.toLowerCase();
        });
        
        const captchaKeywords = [
          'captcha',
          'recaptcha',
          'hcaptcha',
          'verify you are human',
          'verify you\'re not a robot',
          '人机验证',
          '验证码',
          '我不是机器人'
        ];
        
        for (const keyword of captchaKeywords) {
          if (pageText.includes(keyword.toLowerCase())) {
            // 进一步检查是否有实际的验证码元素（包括 Cloudflare Turnstile）
            const hasCaptchaElement = document.querySelector(
              'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="cloudflare"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha'
            );
            if (hasCaptchaElement) {
              return true;
            }
          }
        }
      } catch (e) {
        // 忽略错误
      }

      // 方法3: 检查是否有验证码相关的类名或ID
      try {
        const hasCaptchaClass = await this.page.evaluate(() => {
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const className = el.className || '';
            const id = el.id || '';
            if (typeof className === 'string' && (className.toLowerCase().includes('captcha') || 
                id.toLowerCase().includes('captcha'))) {
              return true;
            }
          }
          return false;
        });
        
        if (hasCaptchaClass) {
          return true;
        }
      } catch (e) {
        // 忽略错误
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检测验证码是否已完成
   */
  async isCaptchaCompleted() {
    try {
      if (!this.page) {
        return false;
      }

      // 检查验证码是否已通过（通过检查常见的成功标志）
      const successIndicators = [
        // reCAPTCHA 成功标志
        '.recaptcha-success',
        '[aria-label*="verified"]',
        // 检查验证码元素是否消失或隐藏
      ];

      // 检查验证码元素是否还存在且可见
      const captchaExists = await this.detectCaptcha();
      if (!captchaExists) {
        // 验证码不存在，可能已经完成
        return true;
      }

      // 检查是否有成功标志
      for (const selector of successIndicators) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isIntersectingViewport().catch(() => false);
            if (isVisible) {
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检测并处理验证码
   */
  async handleCaptcha(logCallback = null) {
    const log = (message) => {
      if (logCallback) {
        logCallback(message);
      } else {
        this.logger.debug(message);
      }
    };

    try {
      log('\n🤖 检测验证码...');
      
      // 等待页面加载，看是否出现验证码
      await this.sleep(3000);
      
      // 检测是否有验证码
      const hasCaptcha = await this.detectCaptcha();
      
      if (!hasCaptcha) {
        log('✓ 未检测到验证码，继续登录流程');
        return true;
      }

      // 检测是否是 Cloudflare Turnstile（类似注册流程的处理）
      const isCloudflare = await this.page.evaluate(() => {
        return !!document.querySelector('iframe[src*="cloudflare"], iframe[src*="turnstile"]');
      }).catch(() => false);

      if (isCloudflare) {
        log('🛡️  检测到 Cloudflare Turnstile 验证');
        log('💡 等待 Cloudflare 验证完成（类似注册流程）...');
        // 类似注册流程，先等待一段时间让自动验证完成
        await this.sleep(10000); // 等待10秒，类似注册流程
      } else {
        log('⚠️  检测到验证码，需要手动完成');
        log('💡 请在浏览器中完成验证码验证...');
      }
      
      log('💡 系统将等待您完成验证码（最多等待3分钟）');
      
      // 等待用户完成验证码（最多等待3分钟）
      const maxWaitTime = 180000; // 3分钟
      const checkInterval = 2000; // 每2秒检查一次
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        await this.sleep(checkInterval);
        
        // 检查验证码是否已完成
        const isCompleted = await this.isCaptchaCompleted();
        if (isCompleted) {
          log('✓ 验证码已完成，继续登录流程');
          await this.sleep(1000); // 等待一下确保状态更新
          return true;
        }
        
        // 显示剩余时间
        const remainingTime = Math.ceil((maxWaitTime - (Date.now() - startTime)) / 1000);
        if (remainingTime % 10 === 0) {
          log(`⏳ 等待验证码完成... (剩余 ${remainingTime} 秒)`);
        }
      }
      
      // 超时后再次检查
      const finalCheck = await this.isCaptchaCompleted();
      if (finalCheck) {
        log('✓ 验证码已完成，继续登录流程');
        return true;
      }
      
      log('⚠️  等待验证码超时，但继续执行登录流程');
      log('💡 如果验证码未完成，登录可能会失败');
      return true; // 继续执行，不阻塞流程
      
    } catch (error) {
      log(`⚠️  处理验证码时出错: ${error.message}`);
      log('💡 继续执行登录流程');
      return true; // 即使出错也继续执行
    }
  }

  /**
   * 等待登录成功 - 改进版
   */
  async waitForLoginSuccess(timeout = 60000) {
    try {
      this.logger.info('等待登录成功');
      
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        try {
          const url = this.page.url();
          const text = await this.page.evaluate(() => document.body.innerText).catch(() => '');
          
          // 检查多种成功标志
          if (
            text.includes('Sign in successful') || 
            text.includes('Redirecting') ||
            text.includes('登录成功') ||
            text.includes('Success') ||
            url.includes('success') ||
            url.includes('dashboard') ||
            url.includes('editor')
          ) {
            this.logger.success('检测到登录成功标志', `当前URL: ${url}`);
            
            // 等待重定向完成
            await this.sleep(5000);
            return true;
          }
          
          // 检查是否有错误
          if (
            text.includes('Invalid') ||
            text.includes('incorrect') ||
            text.includes('failed') ||
            text.includes('错误') ||
            text.includes('失败')
          ) {
            this.logger.error('检测到登录错误');
            return false;
          }
          
        } catch (err) {
          // 继续等待
        }
        
        await this.sleep(2000);
      }
      
      this.logger.warning('等待登录成功超时，但可能已经成功');
      return true; // 宽松处理，让流程继续
      
    } catch (error) {
      this.logger.error('等待登录成功出错', error.message);
      return true; // 宽松处理
    }
  }

  /**
   * 从系统浏览器获取登录 URL（Windows 暂不支持）
   */
  async getLoginUrlFromSystemBrowser() {
    // Windows 平台暂不支持此功能
    // 可以使用 Puppeteer 的 CDP 协议连接到浏览器
    this.logger.warning('Windows 平台暂不支持从系统浏览器获取 URL');
    return null;
  }

  /**
   * 等待系统浏览器打开登录页面并获取 URL
   */
  async waitForSystemBrowserLoginUrl(timeout = 60000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const url = await this.getLoginUrlFromSystemBrowser();
      if (url) {
        return url;
      }
      await this.sleep(2000); // 每2秒检查一次
    }
    
    return null;
  }

  /**
   * 关闭浏览器（如果已打开）
   */
  async close() {
    try {
      if (this.browser) {
        try {
          // 使用 isLaunched 标记来判断是 launch 还是 connect
          if (this.isLaunched) {
            // 通过 launch() 启动的浏览器，需要完全关闭进程
            this.logger.debug('关闭 Puppeteer 启动的浏览器进程');
            await this.browser.close();
            this.logger.debug('浏览器进程已关闭');
          } else {
            // 通过 connect() 连接的浏览器，只需要断开连接
            this.logger.debug('断开与系统浏览器的连接');
            await this.browser.disconnect();
            this.logger.debug('已断开连接');
          }
        } catch (e) {
          this.logger.error('关闭浏览器时出错', e.message);
          // 如果关闭失败，尝试强制关闭
          try {
            if (this.isLaunched) {
              await this.browser.close();
            } else {
              await this.browser.disconnect();
            }
          } catch (e2) {
            // 忽略错误
          }
        }
      }
    } catch (error) {
      this.logger.error('关闭浏览器异常', error.message);
    } finally {
      this.browser = null;
      this.page = null;
      this.isLaunched = false;
    }
  }

  /**
   * 关闭所有可能存在的 Puppeteer 浏览器进程
   * 通过检查调试端口来关闭（只关闭 Puppeteer 启动的，不影响系统浏览器）
   */
  async closeAllPuppeteerBrowsers(logCallback = null) {
    const log = (message) => {
      if (logCallback) {
        logCallback(message);
      } else {
        this.logger.debug(message);
      }
    };

    try {
      log('检查并关闭之前启动的 Puppeteer 浏览器...');
      
      // 尝试连接到可能的调试端口
      const possiblePorts = [9222, 9223, 9224];
      let closedCount = 0;

      for (const port of possiblePorts) {
        try {
          const browserURL = `http://127.0.0.1:${port}`;
          const tempBrowser = await puppeteer.connect({
            browserURL: browserURL,
            defaultViewport: null
          });

          // 检查是否是 Puppeteer 启动的浏览器
          // 通过检查是否有特定的 Puppeteer 特征来判断
          const pages = await tempBrowser.pages();
          let isPuppeteerBrowser = false;
          
          // 方法1: 检查是否有空白页（Puppeteer 启动的浏览器通常会保留 about:blank 或新标签页）
          // 方法2: 检查浏览器版本信息（用于日志辅助排查）
          try {
            const version = await tempBrowser.version();
            // 统计“空白/新标签页”数量
            const blankPages = pages.filter(p => {
              try {
                const url = p.url();
                return (
                  url === 'about:blank' ||
                  url === '' ||
                  url.startsWith('chrome://newtab') ||
                  url.startsWith('edge://newtab') ||
                  url.startsWith('brave://newtab')
                );
              } catch {
                return false;
              }
            });
            
            // 改进的判断策略:
            // 1. 如果有 about:blank 且总页面数 <= 2,很可能是 Puppeteer 残留
            // 2. 如果只有空白页和系统页面,也是 Puppeteer 残留
            const nonSystemPages = pages.filter(p => {
              try {
                const url = p.url();
                return url && !(
                  url === 'about:blank' ||
                  url.startsWith('chrome://') ||
                  url.startsWith('edge://') ||
                  url.startsWith('brave://')
                );
              } catch {
                return false;
              }
            });

            // 判断逻辑:
            // - 有空白页且总页面数<=2: Puppeteer 残留
            // - 只有空白页和系统页面: Puppeteer 残留
            if (blankPages.length >= 1 && (pages.length <= 2 || nonSystemPages.length === 0)) {
              isPuppeteerBrowser = true;
            }

            // 辅助日志：输出页面 URL，便于判断为何被跳过
            try {
              const urls = await Promise.all(pages.map(async p => {
                try { return p.url(); } catch { return 'unknown'; }
              }));
              log(`端口 ${port} 浏览器版本: ${version}`);
              log(`端口 ${port} 标签页: ${urls.join(', ')}`);
            } catch {}
          } catch (e) {
            // 如果无法判断，保守处理：不关闭
            await tempBrowser.disconnect();
            continue;
          }

          if (isPuppeteerBrowser) {
            try {
              // 尝试通过 close() 方法关闭浏览器进程
              // 注意：通过 connect 连接的浏览器调用 close() 会关闭整个浏览器进程
              log(`正在关闭端口 ${port} 上的 Puppeteer 浏览器进程...`);
              await tempBrowser.close();
              closedCount++;
              log(`✓ 已关闭端口 ${port} 上的 Puppeteer 浏览器进程`);
            } catch (e) {
              // 如果 close 失败，尝试断开连接并使用系统命令杀死进程
              log(`⚠️ 无法通过 close() 关闭，尝试强制杀死进程...`);
              try {
                await tempBrowser.disconnect();
                // 使用系统命令强制杀死 Chrome 进程（只杀死使用该调试端口的进程）
                const { exec } = require('child_process');
                const util = require('util');
                const execPromise = util.promisify(exec);
                try {
                  // 查找并杀死使用该端口的 Chrome 进程
                  await execPromise(`lsof -ti:${port} | xargs kill -9`);
                  log(`✓ 已强制关闭端口 ${port} 上的进程`);
                  closedCount++;
                } catch (killErr) {
                  log(`⚠️ 无法强制关闭进程: ${killErr.message}`);
                }
              } catch (e2) {
                log(`⚠️ 关闭失败: ${e2.message}`);
              }
            }
          } else {
            // 可能是系统浏览器，只断开连接
            await tempBrowser.disconnect();
            log(`⚠️ 端口 ${port} 上的浏览器可能是系统浏览器，已跳过`);
          }
        } catch (err) {
          // 端口不可用或无法连接，继续下一个
          continue;
        }
      }

      if (closedCount > 0) {
        log(`✓ 已关闭 ${closedCount} 个之前的 Puppeteer 浏览器实例`);
      } else {
        log('✓ 未发现需要关闭的 Puppeteer 浏览器实例');
      }

      return true;
    } catch (error) {
      log(`⚠️ 关闭浏览器时出错: ${error.message}`);
      return false;
    }
  }

  /**
   * 完整的自动登录流程 - 使用 Puppeteer
   */
  async autoLogin(email, password, logCallback = null) {
    const log = (message) => {
      if (logCallback) {
        logCallback(message);
      } else {
        this.logger.debug(message);
      }
    };
    
    try {
      log('\n🚀 开始浏览器自动登录流程（使用 Puppeteer）...');
      
      // 0. 先清理之前的状态（如果有）
      if (this.browser) {
        log('清理之前的浏览器连接...');
        await this.close();
      }
      
      // 0.1. 关闭所有可能存在的 Puppeteer 浏览器实例
      await this.closeAllPuppeteerBrowsers(logCallback);
      
      // 1. 先等待 Windsurf 在系统浏览器中打开登录页面
      log('等待 Windsurf 在系统浏览器中打开登录页面...');
      log('💡 请确保 Windsurf 已点击登录按钮，系统浏览器将自动打开登录页面');
      
      const loginUrl = await this.waitForSystemBrowserLoginUrl(60000);
      
      if (!loginUrl) {
        throw new Error('未检测到系统浏览器中的登录页面，请确保 Windsurf 已点击登录按钮并打开了浏览器');
      }
      
      log(`✓ 从系统浏览器获取到登录 URL: ${loginUrl}`);
      
      // 2. 强制启动新的 Puppeteer 浏览器实例（每次都使用新浏览器）
      log('启动新的浏览器实例...');
      const launched = await this.launch(false);
      if (!launched) {
        throw new Error('启动浏览器失败');
      }
      this.isLaunched = true; // 标记为通过 launch() 启动
      log('✓ Puppeteer 浏览器已启动');
      
      // 3. 导航到登录 URL
      log('在 Puppeteer 浏览器中导航到登录页面...');
      try {
        await this.page.goto(loginUrl, { 
          waitUntil: 'networkidle2', 
          timeout: 30000 
        });
        log('✓ 已导航到登录页面');
      } catch (error) {
        log(`⚠️ 导航失败: ${error.message}，尝试重新加载...`);
        await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      }
      
      // 4. 等待页面完全加载
      await this.sleep(3000);
      
      // 5. 填写登录表单
      log('开始填写登录表单...');
      const filled = await this.fillLoginForm(email, password);
      if (!filled) {
        throw new Error('填写登录表单失败');
      }
      
      // 6. 检测并处理验证码
      await this.handleCaptcha(logCallback);
      
      // 7. 等待登录成功
      const success = await this.waitForLoginSuccess(30000);
      if (!success) {
        log('⚠️  登录可能需要手动完成');
      }
      
      // 8. 保持浏览器打开一段时间,确保重定向完成
      log('💡 等待重定向完成...');
      await this.sleep(5000);
      
      // 9. 关闭浏览器（每次都启动新浏览器，所以每次都需要关闭）
      if (this.browser) {
        log('关闭 Puppeteer 浏览器...');
        try {
          await this.close();
          log('✓ 浏览器已关闭');
          // 等待浏览器进程完全关闭
          await this.sleep(2000);
        } catch (e) {
          log(`⚠️ 关闭浏览器时出错: ${e.message}`);
        }
      }
      
      log('✅ 浏览器自动登录流程完成!');
      
      return { success: true, message: '浏览器自动登录完成' };
      
    } catch (error) {
      log(`❌ 浏览器自动登录失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }


  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BrowserAutomation;
