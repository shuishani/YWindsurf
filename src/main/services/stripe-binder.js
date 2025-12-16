/**
 * Stripe 绑卡模块（完整）
 * 包含所有绑卡相关功能：工具函数、绑卡逻辑、重试逻辑
 * 从检测到在 Stripe 页面开始，执行绑卡操作
 * 适用于所有场景：登录绑卡、注册绑卡、重试绑卡
 * 
 * 注意：此模块使用 Playwright API，但实际页面对象可能来自 puppeteer-real-browser
 * 两者的 API 基本兼容，可以混用
 */

const { createTaggedLogger } = require('../utils/logger');

// 创建带标签的日志实例 - 简洁明了
const logger = createTaggedLogger('批量绑卡');

// ==================== 工具函数 ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 生成随机卡号（Luhn 算法）
// 支持 BIN 中的 'x' 占位符，每次随机生成不同的卡号
function generateCardNumber(bin) {
  const binStr = bin.toString();
  
  // 替换 BIN 中的 'x' 为随机数字
  let cardNumber = '';
  for (let char of binStr) {
    if (char.toLowerCase() === 'x') {
      cardNumber += Math.floor(Math.random() * 10);
    } else {
      cardNumber += char;
    }
  }
  
  // 如果长度不足15位，继续补充随机数字
  while (cardNumber.length < 15) {
    cardNumber += Math.floor(Math.random() * 10);
  }
  
  // 去掉最后一位（用于计算校验位）
  cardNumber = cardNumber.slice(0, 15);
  
  // 使用 Luhn 算法计算校验位
  let sum = 0;
  let shouldDouble = true;
  
  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber[i]);
    
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  cardNumber += checkDigit;
  
  return cardNumber;
}

// 生成随机到期日
function generateExpiry() {
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const year = String(new Date().getFullYear() + Math.floor(Math.random() * 3) + 1).slice(-2);
  return `${month}/${year}`;
}

// 生成随机 CVV（3位数字）
function generateCVV() {
  return String(Math.floor(Math.random() * 900) + 100);  // 100-999
}

// 生成随机美国地址
function generateUSAddress() {
  const firstNames = ['John', 'Robert', 'Michael', 'William', 'David'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'];
  const streets = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine Rd'];
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'];
  const states = ['NY', 'CA', 'IL', 'TX', 'AZ'];
  const zips = ['10001', '90001', '60601', '77001', '85001'];
  
  const idx = Math.floor(Math.random() * cities.length);
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const streetNumber = Math.floor(Math.random() * 9000) + 1000;
  const street = streets[Math.floor(Math.random() * streets.length)];
  
  return {
    name: `${firstName} ${lastName}`,
    address: `${streetNumber} ${street}`,
    city: cities[idx],
    state: states[idx],
    zip: zips[idx]
  };
}

// ==================== 配置 ====================

// BIN 配置：使用 'x' 作为占位符，每次随机生成不同的卡号
// BIN（Bank Identification Number）前6位是固定的银行识别码
const CARD_BIN = '538841xxxxxxxxxx';  // 559888 是固定BIN（前6位），后10位随机

// ==================== 绑卡逻辑 ====================

/**
 * 在 Stripe 页面上执行绑卡（公共函数）
 * 前置条件：page 必须已经在 Stripe 绑卡页面
 * @param {Page} page - Playwright页面对象（已在Stripe页面）
 * @param {Function} logCallback - 日志回调函数
 * @param {Object} customCardInfo - 可选的自定义卡信息 {cardNumber, expiry, cvv}
 * @returns {Promise<{success: boolean, error?: string, pending?: boolean}>}
 */
async function bindCard(page, logCallback = null, customCardInfo = null, taskIndex = null) {
  // taskIndex: 任务编号，用于批量绑卡时区分不同任务的日志
  const taskPrefix = taskIndex ? `[任务${taskIndex}] ` : '';
  
  // 创建带任务前缀的日志函数
  const taskLogger = {
    browser: (msg, detail) => logger.browser(`${taskPrefix}${msg}`, detail),
    info: (msg, detail) => logger.info(`${taskPrefix}${msg}`, detail),
    warning: (msg, detail) => logger.warning(`${taskPrefix}${msg}`, detail),
    error: (msg, detail) => logger.error(`${taskPrefix}${msg}`, detail),
    success: (msg, detail) => logger.success(`${taskPrefix}${msg}`, detail),
    step: (num, msg) => logger.step(num, `${taskPrefix}${msg}`),
    progress: (msg, detail) => logger.progress(`${taskPrefix}${msg}`, detail),
    start: (msg) => logger.start(`${taskPrefix}${msg}`)
  };
  
  try {
    // 检测是否在绑卡页面（支持 Stripe 独立页面和 Windsurf 内嵌页面）
    const url = page.url();
    const hasPaymentForm = await page.evaluate(() => {
      return !!document.querySelector('input[name="number"], input[autocomplete="cc-number"], [data-testid="card-accordion-item-button"]');
    }).catch(() => false);
    
    if (!url.includes('checkout.stripe.com') && !url.includes('windsurf.com') && !hasPaymentForm) {
      throw new Error('当前不在绑卡页面');
    }
    
    taskLogger.browser('检测到绑卡页面');
    
    // 使用传入的卡信息或生成新的
    let cardInfo;
    if (customCardInfo) {
      cardInfo = customCardInfo;
      taskLogger.info('使用指定的卡信息');
    } else {
      // 使用默认BIN生成（后备方案）
      taskLogger.warning('未传入卡信息，使用默认BIN生成', '建议在虚拟卡管理中添加卡片');
      cardInfo = {
        cardNumber: generateCardNumber(CARD_BIN),
        expiry: generateExpiry(),
        cvv: generateCVV()
      };
      taskLogger.info('使用默认BIN生成卡信息');
    }
    
    const addressInfo = generateUSAddress();
    
    taskLogger.info('卡信息准备完成', `${cardInfo.cardNumber} | ${cardInfo.expiry} | ${cardInfo.cvv}`);
    
    // 执行绑卡
    return await fillAndSubmitCard(page, cardInfo, addressInfo, taskLogger);
    
  } catch (error) {
    // 友好的错误提示
    let friendlyMessage = error.message;
    
    if (error.message.includes('Timeout')) {
      friendlyMessage = '操作超时，可能是网络问题或页面加载缓慢';
    } else if (error.message.includes('has been closed')) {
      friendlyMessage = '浏览器窗口被关闭';
    } else if (error.message.includes('detached Frame') || error.message.includes('detached')) {
      friendlyMessage = '浏览器窗口被关闭';
    } else if (error.message.includes('net::ERR')) {
      friendlyMessage = '网络连接失败，请检查网络设置';
    } else if (error.message.includes('Element not found')) {
      friendlyMessage = '页面元素未找到，可能是页面结构变化';
    }
    
    taskLogger.error('绑卡异常', friendlyMessage);
    return { success: false, error: friendlyMessage };
  }
}

/**
 * 核心绑卡函数：填写卡信息并提交（内部函数）
 * 前置条件：page 必须已经在 Stripe 绑卡页面
 * @param {Page} page - Playwright页面对象（已在Stripe页面）
 * @param {Object} cardInfo - 卡信息 {cardNumber, expiry, cvv}
 * @param {Object} addressInfo - 地址信息 {name, address, city, state, zip}
 * @param {Function} logCallback - 日志回调
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function fillAndSubmitCard(page, cardInfo, addressInfo, logger) {
  try {
    await sleep(3000);
    
    // 展开银行卡区域
    logger.step(1, '检查银行卡区域状态');
    const isExpanded = await page.evaluate(() => {
      const cardRadio = document.querySelector('input[type="radio"][value="card"]');
      return cardRadio && cardRadio.checked;
    });
    
    if (!isExpanded) {
      logger.progress('点击展开银行卡区域');
      const clicked = await page.evaluate(() => {
        const cardButton = document.querySelector('[data-testid="card-accordion-item-button"]');
        if (cardButton) { cardButton.click(); return true; }
        return false;
      });
      if (!clicked) throw new Error('未找到银行卡展开按钮');
      await sleep(800);
      logger.success('银行卡区域已展开');
    } else {
      logger.success('银行卡区域已展开');
    }
    
    // 等待输入框
    logger.step(2, '等待输入框渲染');
    try {
      await page.waitForSelector('input[name="number"], input[placeholder*="卡号"], input[autocomplete="cc-number"]', { timeout: 5000 });
      logger.success('输入框已就绪');
    } catch (e) {
      throw new Error('输入框未出现');
    }
    
    // 填写卡信息 - 使用稳定的输入方式
    logger.step(3, '填写卡信息');
    
    // 辅助函数：稳定输入
    async function stableType(selector, value, description) {
      const input = await page.$(selector);
      if (input) {
        await input.click({ clickCount: 3 }); // 三击选中全部
        await sleep(200);
        await page.keyboard.type(value, { delay: 50 });
        await sleep(500);
        logger.progress(`${description}: ${value}`);
      }
    }
    
    // 填写卡号
    await stableType('input[name="number"], input[autocomplete="cc-number"]', cardInfo.cardNumber, '卡号');
    
    // 填写到期日
    const expiryFormatted = cardInfo.expiry.replace('/', '');
    await stableType('input[name="expiry"], input[autocomplete="cc-exp"]', expiryFormatted, '到期日');
    
    // 填写 CVV
    await stableType('input[name="cvc"], input[autocomplete="cc-csc"]', cardInfo.cvv, 'CVV');
    
    // 填写持卡人姓名
    await stableType('input[name="name"], input[autocomplete="cc-name"]', addressInfo.name, '姓名');
    
    logger.success('卡信息填写完成');
    
    // 填写账单地址
    logger.step(4, '填写账单信息');
    
    // 点击"手动输入地址"按钮（如果存在）
    try {
      const manualAddressBtn = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button')).find(btn => 
          btn.textContent.includes('手动输入地址') || 
          btn.textContent.includes('Enter address manually')
        );
      });
      
      if (manualAddressBtn && manualAddressBtn.asElement && manualAddressBtn.asElement()) {
        await manualAddressBtn.asElement().click();
        await sleep(500);
      }
    } catch (e) {
      // 忽略，可能不需要点击手动输入按钮
    }
    
    // 按照表单顺序填写：国家 → 地址第1行 → 城市 → 邮编 → 州
    
    // 1. 选择国家 - 美国（第一个下拉框）
    const allSelects = await page.$$('select');
    if (allSelects.length > 0) {
      await allSelects[0].select('US');
      await sleep(1500);
      logger.progress('国家: 美国');
    }
    
    // 2. 获取所有文本输入框（按DOM顺序）
    const allInputs = await page.$$('input[type="text"], input:not([type]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
    
    // 填写地址第1行（通常是第一个或第二个输入框，在卡信息之后）
    // 查找 placeholder 包含"地址"或"Address"的输入框
    let addressFilled = false;
    for (const input of allInputs) {
      const placeholder = await page.evaluate(el => el.placeholder || '', input);
      const name = await page.evaluate(el => el.name || '', input);
      if (placeholder.includes('地址') || placeholder.includes('Address') || 
          name === 'line1' || name === 'addressLine1') {
        await input.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.address, { delay: 50 });
        await sleep(500);
        logger.progress(`地址: ${addressInfo.address}`);
        addressFilled = true;
        break;
      }
    }
    
    // 如果没找到，尝试按位置填写（账单地址区域的第一个输入框）
    if (!addressFilled) {
      const line1Input = await page.$('input[name="line1"], input[name="addressLine1"]');
      if (line1Input) {
        await line1Input.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.address, { delay: 50 });
        await sleep(500);
        logger.progress(`地址: ${addressInfo.address}`);
      } else {
        logger.warning('未找到地址输入框');
      }
    }
    
    // 3. 填写城市 - 通过 placeholder 查找
    let cityFilled = false;
    for (const input of allInputs) {
      const placeholder = await page.evaluate(el => el.placeholder || '', input);
      if (placeholder.includes('城市') || placeholder.includes('City')) {
        await input.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.city, { delay: 50 });
        await sleep(500);
        logger.progress(`城市: ${addressInfo.city}`);
        cityFilled = true;
        break;
      }
    }
    if (!cityFilled) {
      const cityInput = await page.$('input[name="city"], input[name="locality"]');
      if (cityInput) {
        await cityInput.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.city, { delay: 50 });
        await sleep(500);
        logger.progress(`城市: ${addressInfo.city}`);
      } else {
        logger.warning('未找到城市输入框');
      }
    }
    
    // 4. 填写邮编 - 通过 placeholder 查找
    let zipFilled = false;
    for (const input of allInputs) {
      const placeholder = await page.evaluate(el => el.placeholder || '', input);
      if (placeholder.includes('邮编') || placeholder.includes('ZIP') || placeholder.includes('Postal')) {
        await input.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.zip, { delay: 50 });
        await sleep(500);
        logger.progress(`邮编: ${addressInfo.zip}`);
        zipFilled = true;
        break;
      }
    }
    if (!zipFilled) {
      const zipInput = await page.$('input[name="zip"], input[name="postalCode"]');
      if (zipInput) {
        await zipInput.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.type(addressInfo.zip, { delay: 50 });
        await sleep(500);
        logger.progress(`邮编: ${addressInfo.zip}`);
      } else {
        logger.warning('未找到邮编输入框');
      }
    }
    
    // 5. 州会自动填写，无需手动选择
    logger.info('州将自动填写');
    
    await sleep(800);
    logger.success('账单信息填写完成');
    
    // 不操作"保存我的信息"复选框，避免触发电话输入框的循环问题
    logger.step(5, '跳过保存信息选项');
    
    // 等待提交按钮就绪
    logger.step(6, '检查提交按钮');
    
    let buttonReady = false;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (!buttonReady && attempts < maxAttempts) {
      attempts++;
      
      const isReady = await page.evaluate(() => {
        // 查找"开始试用"按钮
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], [class*="button"]'));
        const submitButton = buttons.find(btn => 
          btn.textContent.includes('开始试用') || 
          btn.textContent.includes('Start trial') ||
          btn.textContent.includes('Submit')
        ) || document.querySelector('button[type="submit"]');
        
        if (!submitButton) return false;
        
        const isBasicReady = !submitButton.disabled && 
                            !submitButton.hasAttribute('disabled') &&
                            submitButton.offsetParent !== null;
        
        const processingText = submitButton.querySelector('[class*="processing"]');
        const isProcessing = processingText && processingText.offsetParent !== null;
        
        const classList = submitButton.className;
        const hasDisabledClass = classList.includes('disabled') || classList.includes('Disabled');
        
        return isBasicReady && !isProcessing && !hasDisabledClass;
      });
      
      if (isReady) {
        buttonReady = true;
        logger.success('提交按钮已就绪', `用时 ${attempts}秒`);
      } else {
        if (attempts % 5 === 0) {
          logger.progress('仍在等待', `${attempts}/${maxAttempts}秒`);
        }
        await sleep(1000);
      }
    }
    
    if (!buttonReady) {
      logger.warning('等待超时，按钮可能仍不可用');
    }
    
    // 跳过人机验证检测（用户手动处理）
    await sleep(500);
    
    // 提交 - 查找"开始试用"按钮
    logger.step(8, '点击开始试用按钮');
    
    // 尝试多种方式查找按钮
    let submitBtn = null;
    let clicked = false;
    
    // 1. 通过 Stripe 特定的 class 查找（SubmitButton）
    submitBtn = await page.$('.SubmitButton, [class*="SubmitButton"]');
    if (submitBtn) {
      await submitBtn.click();
      clicked = true;
      logger.success('已点击提交按钮');
    }
    
    // 2. 如果没找到，通过文本查找
    if (!clicked) {
      submitBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], [class*="button"], [class*="Button"]'));
        return buttons.find(btn => 
          btn.textContent.includes('开始试用') || 
          btn.textContent.includes('Start trial') ||
          btn.textContent.includes('Submit') ||
          btn.textContent.includes('试用')
        );
      });
      
      if (submitBtn && submitBtn.asElement) {
        await submitBtn.asElement().click();
        clicked = true;
        logger.success('已点击提交按钮');
      }
    }
    
    // 3. 如果还没找到，尝试 button[type="submit"]
    if (!clicked) {
      submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
        clicked = true;
        logger.success('已点击提交按钮');
      }
    }
    
    if (clicked) {
      logger.progress('等待支付处理');
      
      // 立即返回pending状态，让主流程显示按钮
      // 后台检测会在stripe-handler中进行
      return { success: false, pending: true };
      
    } else {
      logger.error('未找到开始试用按钮');
      return { success: false, error: '未找到开始试用按钮' };
    }
    
  } catch (error) {
    // 不输出日志，让调用者统一处理
    return { success: false, error: error.message };
  }
}

/**
 * 重新绑卡（返回账号页面重新开始）
 * 前置条件：page 必须已经在 Stripe 绑卡页面或账号页面
 * @param {Page} page - Playwright页面对象
 * @param {Object} customCardInfo - 可选的自定义卡信息
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function retryBind(page, customCardInfo = null) {
  // 使用统一的带标签logger
  // 所有日志都通过统一系统管理
  
  try {
    logger.start('开始重新绑卡');
    logger.info('返回账号页面，重新开始绑卡流程');
    
    // 返回账号页面
    logger.step(1, '返回账号页面');
    await page.goto('https://windsurf.com/account/profile', { waitUntil: 'networkidle2' });
    await sleep(2000);
    logger.success('已返回账号页面');
    
    // 先尝试点击汉堡菜单（移动端布局）
    logger.step(2, '检查页面布局');
    const menuButton = await page.evaluateHandle(() => {
      // 查找菜单按钮
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(btn => 
        btn.getAttribute('aria-label')?.includes('menu') ||
        btn.textContent.includes('Open mobile menu') ||
        btn.textContent.includes('菜单')
      );
    });
    
    if (menuButton && menuButton.asElement) {
      logger.info('检测到移动端布局，点击菜单按钮');
      await menuButton.asElement().click();
      await sleep(1000);
      logger.success('菜单已打开');
    }
    
    // 重新点击升级
    logger.step(3, '重新点击升级到 Pro');
    const browser = page.browser();
    let stripePage = page;
    
    try {
      // 第一步：点击 Upgrade to Pro
      const upgradeBtnHandle = await page.evaluateHandle(() => {
        const elements = Array.from(document.querySelectorAll('button, a'));
        return elements.find(el => el.textContent && el.textContent.includes('Upgrade to Pro')) || null;
      });
      const upgradeBtn = upgradeBtnHandle.asElement();
      
      if (upgradeBtn) {
        await upgradeBtn.click();
        await sleep(2000);
        logger.success('已点击 Upgrade to Pro');
      } else {
        throw new Error('未找到 Upgrade to Pro 按钮');
      }
      
      // 第二步：点击 Start Free Trial 或 Select plan 按钮
      logger.progress('查找并点击试用按钮');
      const trialBtnHandle = await page.evaluateHandle(() => {
        const elements = Array.from(document.querySelectorAll('button, a'));
        return elements.find(el => 
          el.textContent && (
            el.textContent.includes('Start Free Trial') ||
            el.textContent.includes('Select plan') ||
            el.textContent.includes('开始试用')
          )
        ) || null;
      });
      const trialBtn = trialBtnHandle.asElement();
      
      if (trialBtn) {
        logger.success('找到试用按钮');
        
        // 监听新页面
        const newPagePromise = new Promise(resolve => {
          browser.once('targetcreated', async target => {
            const newPage = await target.page();
            resolve(newPage);
          });
        });
        
        await trialBtn.click();
        
        // 等待新的 Stripe 页面
        const newPage = await Promise.race([
          newPagePromise,
          sleep(10000).then(() => null)
        ]);
        
        if (newPage) {
          stripePage = newPage;
          logger.success('新的绑卡页面已打开');
        } else {
          // 如果没有新页面，检查当前页面是否有绑卡表单
          const hasPaymentForm = await page.evaluate(() => {
            return !!document.querySelector('input[name="number"], input[autocomplete="cc-number"]');
          }).catch(() => false);
          
          if (hasPaymentForm) {
            stripePage = page;
            logger.success('检测到内嵌绑卡表单');
          } else {
            // 检查所有页面
            const pages = await browser.pages();
            for (const p of pages) {
              const url = p.url();
              if (url.includes('checkout.stripe.com') || url.includes('billing')) {
                stripePage = p;
                break;
              }
            }
          }
        }
        
        await stripePage.bringToFront();
        await sleep(2000);
        logger.success('已到达绑卡页面');
      } else {
        logger.warning('未找到试用按钮，尝试直接查找绑卡页面');
        // 可能直接打开了 Stripe 页面
        const pages = await browser.pages();
        for (const p of pages) {
          const url = p.url();
          if (url.includes('checkout.stripe.com') || url.includes('billing')) {
            stripePage = p;
            await stripePage.bringToFront();
            logger.success('找到绑卡页面');
            break;
          }
        }
      }
      
    } catch (clickError) {
      if (clickError.message.includes('Timeout')) {
        logger.warning('未找到"Upgrade to Pro"按钮');
        logger.info('尝试访问 billing 页面');
        
        // 尝试访问 billing 页面
        await page.goto('https://windsurf.com/billing', { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(2000);
        
        const addPaymentBtn = await page.evaluateHandle(() => {
          const elements = Array.from(document.querySelectorAll('button, a'));
          return elements.find(el => 
            el.textContent.includes('Add payment') || 
            el.textContent.includes('Update payment')
          );
        });
        
        if (addPaymentBtn && addPaymentBtn.asElement) {
          logger.success('找到支付设置入口');
          
          // 监听新页面
          const newPagePromise2 = new Promise(resolve => {
            browser.once('targetcreated', async target => {
              const newPage = await target.page();
              resolve(newPage);
            });
          });
          
          await addPaymentBtn.asElement().click();
          
          const newPage2 = await Promise.race([
            newPagePromise2,
            sleep(10000).then(() => null)
          ]);
          
          if (newPage2) {
            stripePage = newPage2;
            await stripePage.bringToFront();
            await sleep(2000);
            logger.success('已到达绑卡页面');
          } else {
            // 检查是否有内嵌表单
            const hasPaymentForm = await page.evaluate(() => {
              return !!document.querySelector('input[name="number"], input[autocomplete="cc-number"]');
            }).catch(() => false);
            
            if (hasPaymentForm) {
              stripePage = page;
              logger.success('检测到内嵌绑卡表单');
            } else {
              throw new Error('无法打开绑卡页面');
            }
          }
        } else {
          throw new Error('未找到支付设置入口');
        }
      } else {
        throw clickError;
      }
    }
    
    // 在新页面上重新绑卡（使用统一日志管理，传入自定义卡信息）
    return await bindCard(stripePage, null, customCardInfo);
    
  } catch (error) {
    // 友好的错误提示
    let friendlyMessage = error.message;
    
    if (error.message.includes('Timeout')) {
      friendlyMessage = '重试超时，可能是网络问题';
    } else if (error.message.includes('has been closed')) {
      friendlyMessage = '浏览器窗口被关闭';
    } else if (error.message.includes('net::ERR')) {
      friendlyMessage = '网络连接失败';
    }
    
    logger.error('绑卡失败', friendlyMessage);
    return { success: false, error: friendlyMessage };
  }
}

module.exports = { 
  bindCard,          // 主要绑卡函数（公共）
  retryBind,         // 重试绑卡（公共）
  fillAndSubmitCard, // 内部函数（如需直接调用）
  generateCardNumber, // 卡号生成（工具函数）
  generateExpiry,    // 到期日生成（工具函数）
  generateCVV        // CVV生成（工具函数）
};
