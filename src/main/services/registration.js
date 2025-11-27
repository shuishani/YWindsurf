const { connect } = require('puppeteer-real-browser');
const { createTaggedLogger } = require('../utils/logger');

class RegistrationBot {
  constructor(config) {
    this.config = config;
    // 自定义域名邮箱列表
    this.emailDomains = config.emailDomains || ['example.com'];
    // 邮箱编号计数器(随机起始)
    this.emailCounter = Math.floor(Math.random() * 999) + 1;
    // 取消检查函数
    this.cancelChecker = null;
    // 创建带标签的日志实例 - 简洁明了
    this.logger = createTaggedLogger('批量注册');
    // 是否自动绑卡（默认true保持向后兼容）
    this.autoBindCard = config.autoBindCard !== undefined ? config.autoBindCard : true;
    // 邀请链接（可选）
    this.referralLink = config.referralLink || '';
  }

  /**
   * 设置取消检查函数
   */
  setCancelChecker(checker) {
    this.cancelChecker = checker;
  }

  /**
   * 检查是否应该取消注册
   */
  shouldCancel() {
    return this.cancelChecker && this.cancelChecker();
  }

  /**
   * 生成域名邮箱
   * 格式: 随机字母 + 编号 + 随机字母数字组合
   */
  async generateTempEmail() {
    // 生成随机前缀字母(1-3位)
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const prefixLength = Math.floor(Math.random() * 3) + 1;
    let prefix = '';
    for (let i = 0; i < prefixLength; i++) {
      prefix += letters[Math.floor(Math.random() * letters.length)];
    }
    
    // 获取当前编号
    const number = this.emailCounter;
    
    // 生成随机字母数字组合(5-8位)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const suffixLength = Math.floor(Math.random() * 4) + 5;
    let suffix = '';
    for (let i = 0; i < suffixLength; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // 组合用户名: 前缀 + 编号 + 后缀
    const username = `${prefix}${number}${suffix}`;
    
    // 随机选择配置的域名
    const randomIndex = Math.floor(Math.random() * this.emailDomains.length);
    const domain = this.emailDomains[randomIndex];
    
    // 递增计数器(1-999循环)
    this.emailCounter = this.emailCounter >= 999 ? 1 : this.emailCounter + 1;
    
    return `${username}@${domain}`;
  }

  /**
   * 获取邮箱验证码（使用本地EmailReceiver）
   * 支持重试机制：最多重试3次，每次间隔30秒
   */
  async getVerificationCode(email, maxWaitTime = 120000) {
    const emailConfig = this.config.emailConfig;
    
    if (!emailConfig || !emailConfig.host) {
      throw new Error('邮箱配置不完整，请检查 emailConfig');
    }

    const EmailReceiver = require('./email');
    const receiver = new EmailReceiver(emailConfig);
    
    const maxRetries = 3;
    const retryInterval = 30000; // 30秒
    
    for (let retry = 0; retry < maxRetries; retry++) {
      // 检查是否被取消
      if (this.shouldCancel()) {
        throw new Error('注册已被用户取消');
      }
      
      try {
        this.logger.progress('获取验证码', `第${retry + 1}次尝试`);
        
        // 计算本次尝试的等待时间
        const waitTime = retry === 0 ? maxWaitTime : retryInterval;
        
        const code = await this.getVerificationCodeWithCancel(receiver, email, waitTime);
        
        if (code) {
          this.logger.codeReceived(code);
          return code;
        }
        
        if (retry < maxRetries - 1) {
          this.logger.warning('未收到验证码', `${retryInterval/1000}秒后重试`);
          await this.sleep(retryInterval);
        }
        
      } catch (error) {
        // 如果是取消错误，直接抛出
        if (error.message === '注册已被用户取消' || error.message === '用户取消操作') {
          throw error;
        }
        
        // 简化错误信息显示
        let errorMsg = error.message;
        if (errorMsg.includes('Login fail. Account is abnormal')) {
          errorMsg = 'QQ邮箱登录失败 (账号异常/密码错误/频率限制)';
        } else if (errorMsg.includes('IMAP连接失败')) {
          errorMsg = 'IMAP连接失败';
        } else if (errorMsg.length > 50) {
          errorMsg = errorMsg.substring(0, 50) + '...';
        }
        
        this.logger.error('获取验证码失败', `第${retry + 1}次: ${errorMsg}`);
        
        if (retry < maxRetries - 1) {
          this.logger.warning('重试等待', `${retryInterval/1000}秒后重试`);
          await this.sleep(retryInterval);
        }
      }
    }
    
    this.logger.error('验证码获取彻底失败', `已重试${maxRetries}次，建议检查邮箱配置`);
    throw new Error(`经过 ${maxRetries} 次重试仍未收到验证码`);
  }

  /**
   * 支持取消的验证码获取方法
   */
  async getVerificationCodeWithCancel(receiver, email, maxWaitTime) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let checkInterval;
      let isResolved = false;

      // 每秒检查取消状态
      const cancelCheckInterval = setInterval(() => {
        if (this.shouldCancel()) {
          clearInterval(cancelCheckInterval);
          clearInterval(checkInterval);
          if (!isResolved) {
            isResolved = true;
            reject(new Error('注册已被用户取消'));
          }
        }
      }, 1000);

      // 调用原始的获取验证码方法
      receiver.getVerificationCode(email, maxWaitTime)
        .then(code => {
          clearInterval(cancelCheckInterval);
          if (!isResolved) {
            isResolved = true;
            resolve(code);
          }
        })
        .catch(error => {
          clearInterval(cancelCheckInterval);
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        });
    });
  }

  /**
   * 生成随机英文名
   */
  generateRandomName() {
    const firstNames = [
      'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
      'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
      'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
      'Nancy', 'Lisa', 'Betty', 'Helen', 'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Michelle'
    ];
    
    const lastNames = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
      'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'
    ];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    return { firstName, lastName };
  }


  /**
   * 注册单个账号
   */
  async registerAccount(logCallback, taskId = null) {
    // 设置任务ID用于日志标识
    if (taskId) {
      this.logger.setTaskId(taskId);
    }
    let browser, page;
    
    try {
      // 记录开始时间
      const startTime = Date.now();
      
      // 生成用户信息
      const email = await this.generateTempEmail();
      const { firstName, lastName } = this.generateRandomName();
      const password = email; // 邮箱就是密码

      this.logger.start('启动浏览器');
      
      // 使用 puppeteer-real-browser，自动绕过 Cloudflare
      const response = await connect({
        headless: false,
        fingerprint: true,  // 启用指纹伪装
        turnstile: true,    // 自动处理 Cloudflare Turnstile
        tf: true,
        args: ['--disable-blink-features=AutomationControlled']
      });
      
      browser = response.browser;
      page = response.page;
      
      // 设置浏览器窗口大小为 800x900
      await page.setViewport({ width: 800, height: 900 });
      
      this.logger.userInfo(firstName, lastName, email, password);

      // 访问注册页面
      this.logger.browser('访问注册页面');
      // 使用配置的邀请链接，如果没有则使用默认注册页面
      const registerUrl = this.referralLink || 'https://windsurf.com/account/register';
      await page.goto(registerUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // 如果是邀请链接，先检查是否需要点击"接受邀请"按钮
      if (this.referralLink) {
        try {
          // 查找包含"accept referral"文本的按钮
          const acceptButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => 
              btn.textContent.toLowerCase().includes('accept referral') ||
              btn.textContent.toLowerCase().includes('sign up to accept')
            );
          });
          
          if (acceptButton.asElement()) {
            this.logger.browser('点击接受邀请按钮');
            await acceptButton.asElement().click();
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
          } else {
            this.logger.browser('未找到邀请按钮，直接进入注册流程');
          }
        } catch (e) {
          // 如果没有找到接受邀请按钮，可能直接是注册页面，继续执行
          this.logger.browser('未找到邀请按钮，直接进入注册流程');
        }
      }

      // ========== 第一步: 填写基本信息 ==========
      await page.waitForSelector('input', { timeout: 15000 });
      await this.sleep(1000);
      
      // 填写First name
      const firstNameInput = await page.$('input[name="firstName"], input[placeholder*="First"]');
      if (firstNameInput) {
        await firstNameInput.click();
        await firstNameInput.type(firstName, { delay: 50 });
      }
      
      // 填写Last name
      const lastNameInput = await page.$('input[name="lastName"], input[placeholder*="Last"]');
      if (lastNameInput) {
        await lastNameInput.click();
        await lastNameInput.type(lastName, { delay: 50 });
      }
      
      // 填写Email
      const emailInput = await page.$('input[type="email"], input[name="email"]');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await emailInput.type(email, { delay: 50 });
      }
      
      this.logger.success('信息填写完成');
      
      // 同意条款复选框
      const checkbox = await page.$('input[type="checkbox"]');
      if (checkbox) {
        const isChecked = await page.evaluate(el => el.checked, checkbox);
        if (!isChecked) await checkbox.click();
      }
      
      await this.sleep(1000);
      
      // 点击Continue按钮
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        // 备用：通过文本查找
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text && text.includes('Continue')) {
            await btn.click();
            break;
          }
        }
      }
      
      await this.sleep(3000);

      // ========== 第二步: 填写密码 ==========
      await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      await this.sleep(1000);
      
      // 再次填写Email（如果需要）
      const emailInput2 = await page.$('input[type="email"], input[name="email"]');
      if (emailInput2) {
        const emailValue = await page.evaluate(el => el.value, emailInput2);
        if (!emailValue) {
          await emailInput2.type(email, { delay: 50 });
        }
      }
      
      // 填写密码
      const passwordInputs = await page.$$('input[type="password"]');
      if (passwordInputs.length >= 1) {
        await passwordInputs[0].click();
        await passwordInputs[0].type(password, { delay: 50 });
      }
      if (passwordInputs.length >= 2) {
        await passwordInputs[1].click();
        await passwordInputs[1].type(password, { delay: 50 });
      }
      
      this.logger.success('密码设置完成');
      await this.sleep(1000);
      
      // 点击Continue按钮 - 多种方式尝试
      let clicked2 = false;
      try {
        const submitBtn2 = await page.$('button[type="submit"]');
        if (submitBtn2) {
          await submitBtn2.click();
          clicked2 = true;
          this.logger.info('点击Continue按钮');
        }
      } catch (e) {}
      
      if (!clicked2) {
        // 备用：通过文本查找
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text && (text.includes('Continue') || text.includes('继续'))) {
            await btn.click();
            clicked2 = true;
            this.logger.info('通过文本点击Continue');
            break;
          }
        }
      }
      
      await this.sleep(3000);
      
      // ========== 第三步: Cloudflare人机验证 ==========
      this.logger.verify('等待Cloudflare验证');
      
      // puppeteer-real-browser 会自动处理 Turnstile
      await this.sleep(10000);
      
      // 点击Continue按钮（验证后）
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const submitBtn3 = await page.$('button[type="submit"]');
          if (submitBtn3) {
            await submitBtn3.click();
            this.logger.info('验证后点击Continue');
            break;
          }
        } catch (e) {}
        
        // 备用方式
        try {
          const buttons = await page.$$('button');
          for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text && (text.includes('Continue') || text.includes('Next'))) {
              await btn.click();
              break;
            }
          }
        } catch (e) {}
        
        await this.sleep(2000);
      }
      
      await this.sleep(3000);
      
      // ========== 第四步: 邮箱验证码 ==========
      this.logger.step(4, '等待邮箱验证码');
      await page.waitForSelector('input[type="text"], input[name="code"]', { timeout: 60000 });
      
      if (this.shouldCancel()) {
        throw new Error('注册已被用户取消');
      }
      
      // 延迟获取验证码，避免混淆
      this.logger.info('延迟15秒获取验证码');
      await this.sleep(15000);
      
      this.logger.code('正在获取邮箱验证码');
      const verificationCode = await this.getVerificationCode(email);
      
      // 输入验证码
      const codeInputs = await page.$$('input[type="text"], input[name="code"]');
      if (codeInputs.length === 6) {
        // 6个独立输入框
        for (let i = 0; i < 6; i++) {
          await codeInputs[i].click();
          await codeInputs[i].type(verificationCode[i], { delay: 50 });
        }
      } else if (codeInputs.length >= 1) {
        // 单个输入框
        await codeInputs[0].click();
        await codeInputs[0].type(verificationCode, { delay: 50 });
      }
      
      this.logger.codeProcess(verificationCode);
      await this.sleep(1000);
      
      // 点击验证按钮
      const createBtn = await page.$('button[type="submit"]');
      if (createBtn) {
        await createBtn.click();
      }
      
      if (false) {
        // 可能已自动提交
      }
      
      // 等待注册完成
      await this.sleep(5000);
      
      // 计算耗时
      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logger.complete('注册完成', `${email} | 耗时${duration}秒`);
      
      return {
        success: true,
        email,
        password,
        firstName,
        lastName
      };

    } catch (error) {
      this.logger.error('注册失败', error.message);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // 确保浏览器关闭，避免卡住
      if (browser) {
        try {
          await browser.close();
          this.logger.info('浏览器已关闭');
        } catch (e) {
          // 强制关闭
          try {
            const pages = await browser.pages();
            for (const p of pages) {
              await p.close().catch(() => {});
            }
            await browser.close().catch(() => {});
          } catch (e2) {}
        }
      }
    }
  }

  /**
   * 批量注册(控制并发数量)
   * 根据传入的并发数控制同时运行的窗口数量
   */
  async batchRegister(count, progressCallback, logCallback, maxConcurrent = 5) {
    const MAX_CONCURRENT = maxConcurrent; // 使用传入的并发数
    
    const results = [];
    let completed = 0;
    let failed = 0;
    
    // 分批处理
    for (let i = 0; i < count; i += MAX_CONCURRENT) {
      const batch = [];
      const batchSize = Math.min(MAX_CONCURRENT, count - i);
      
      // 创建当前批次的任务
      for (let j = 0; j < batchSize; j++) {
        const taskIndex = i + j + 1;
        
        // 创建独立的任务函数，避免闭包问题
        const task = ((index) => {
          // 为每个任务创建独立的RegistrationBot实例
          const taskBot = new RegistrationBot(this.config);
          taskBot.setCancelChecker(this.cancelChecker);
          
          // 创建带任务ID的日志回调
          const taskLogCallback = (message) => {
            if (logCallback) {
              // 如果消息已经有任务标识，直接使用
              if (message.includes(`[任务${index}]`)) {
                logCallback(message);
              } else {
                // 否则添加任务标识
                logCallback(`[任务${index}] ${message}`);
              }
            }
          };
          
          return taskBot.registerAccount(taskLogCallback, index).then(result => {
            // 更新计数器（registerAccount方法已经输出了完成日志，这里不需要重复输出）
            if (result.success) {
              completed++;
            } else {
              failed++;
            }
            
            // 更新进度
            if (progressCallback) {
              progressCallback({
                total: count,
                completed: completed + failed,
                success: completed,
                failed: failed,
                progress: Math.round(((completed + failed) / count) * 100)
              });
            }
            
            return result;
          });
        })(taskIndex);
        
        batch.push(task);
      }
      
      // 等待当前批次完成
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
      // 如果不是最后一批，等待一段时间再开始下一批
      if (i + MAX_CONCURRENT < count) {
        this.logger.info('批次完成，等待5秒后开始下一批');
        await this.sleep(5000);
      }
    }
    
    // 输出批量注册摘要（不使用任务标识，因为这是整体摘要）
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;
    
    // 使用统一的logger系统输出摘要
    this.logger.batchSummary(results.length, successCount, failedCount);
    
    // 自动保存成功的账号
    const savedAccounts = [];
    if (successCount > 0) {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const { app } = require('electron');
        
        const windsurfPaths = require('../../shared/config/windsurf-paths');
        const ACCOUNTS_FILE = path.join(windsurfPaths.getJsonDataDir(), 'accounts.json');
        
        // 读取现有账号
        let accounts = [];
        try {
          const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
          accounts = JSON.parse(data);
        } catch (error) {
          // 文件不存在，使用空数组
        }
        
        // 保存成功的账号
        for (const result of results) {
          if (result.success) {
            const account = {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              email: result.email,
              password: result.password,
              firstName: result.firstName,
              lastName: result.lastName,
              cardBound: false, // 默认未绑卡
              createdAt: new Date().toISOString()
            };
            
            accounts.push(account);
            savedAccounts.push(account);
          }
        }
        
        // 一次性写入所有账号
        if (savedAccounts.length > 0) {
          await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
          
          this.logger.success('账号批量保存完成', `成功保存 ${savedAccounts.length} 个账号`);
        }
        
      } catch (error) {
        this.logger.error('账号保存失败', error.message);
      }
    }
    
    // 返回前端期望的格式
    return {
      results,
      successCount,
      failCount: failedCount,
      needsBindingCount: this.autoBindCard ? successCount : 0, // 只有启用自动绑卡时才提示需要绑卡
      savedAccounts
    };
  }

  /**
   * 可取消的延迟函数 - 更快响应取消
   */
  async sleep(ms) {
    const interval = 1000;
    const times = Math.ceil(ms / interval);
    
    for (let i = 0; i < times; i++) {
      if (this.shouldCancel()) {
        throw new Error('用户取消操作');
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(interval, ms - i * interval)));
    }
  }
}

module.exports = RegistrationBot;
