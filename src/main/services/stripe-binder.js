/**
 * Stripe 绑卡模块（完整）
 * 包含所有绑卡相关功能：工具函数、绑卡逻辑、重试逻辑
 * 从检测到在 Stripe 页面开始，执行绑卡操作
 * 适用于所有场景：登录绑卡、注册绑卡、重试绑卡
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
async function bindCard(page, logCallback = null, customCardInfo = null) {
  // 使用全局logger实例（logCallback参数保留以兼容旧代码，但不再使用）
  
  try {
    // 检测是否在 Stripe 页面
    const url = page.url();
    if (!url.includes('checkout.stripe.com')) {
      throw new Error('当前不在绑卡页面');
    }
    
    logger.browser('检测到绑卡页面');
    
    // 使用传入的卡信息或生成新的
    let cardInfo;
    if (customCardInfo) {
      cardInfo = customCardInfo;
      logger.info('使用指定的卡信息');
    } else {
      // 使用默认BIN生成（后备方案）
      logger.warning('未传入卡信息，使用默认BIN生成', '建议在虚拟卡管理中添加卡片');
      cardInfo = {
        cardNumber: generateCardNumber(CARD_BIN),
        expiry: generateExpiry(),
        cvv: generateCVV()
      };
      logger.info('使用默认BIN生成卡信息');
    }
    
    const addressInfo = generateUSAddress();
    
    logger.info('卡信息准备完成', `${cardInfo.cardNumber} | ${cardInfo.expiry} | ${cardInfo.cvv}`);
    
    // 执行绑卡
    return await fillAndSubmitCard(page, cardInfo, addressInfo, logger);
    
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
    
    logger.error('绑卡异常', friendlyMessage);
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
      logger.error('输入框未出现', e.message);
      throw e;
    }
    
    // 填写卡信息
    logger.step(3, '填写卡信息');
    
    // 填写卡号
    const cardInput = await page.$('input[name="number"], input[placeholder*="卡号"], input[autocomplete="cc-number"]');
    if (cardInput) {
      await cardInput.click();
      await sleep(100);
      await cardInput.fill(cardInfo.cardNumber);
      await sleep(400);
    }
    
    // 填写到期日
    const expiryInput = await page.$('input[name="expiry"], input[placeholder*="到期"], input[autocomplete="cc-exp"]');
    if (expiryInput) {
      await expiryInput.click();
      await sleep(100);
      const expiryFormatted = cardInfo.expiry.replace('/', '');
      await expiryInput.fill(expiryFormatted);
      await sleep(400);
    }
    
    // 填写 CVV
    const cvvInput = await page.$('input[name="cvc"], input[placeholder*="CVC"], input[placeholder*="安全码"], input[autocomplete="cc-csc"]');
    if (cvvInput) {
      await cvvInput.click();
      await sleep(100);
      await cvvInput.fill(cardInfo.cvv);
      await sleep(400);
    }
    
    // 填写持卡人姓名
    const nameInput = await page.$('input[name="name"], input[placeholder*="姓名"], input[autocomplete="cc-name"]');
    if (nameInput) {
      await nameInput.click();
      await sleep(100);
      await nameInput.fill(addressInfo.name);
      await sleep(400);
    }
    
    logger.success('卡信息填写完成');
    
    // 填写账单地址
    logger.step(4, '填写账单信息');
    
    // 点击"手动输入地址"按钮
    const manualAddressBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button')).find(btn => 
        btn.textContent.includes('手动输入地址') || 
        btn.textContent.includes('Enter address manually')
      );
    });
    
    if (manualAddressBtn) {
      await manualAddressBtn.asElement().click();
      await sleep(500);
    }
    
    // 选择国家 - 美国
    const countrySelect = await page.$('select[name="billingCountry"], select');
    if (countrySelect) {
      await countrySelect.selectOption('US');
      await sleep(1500);
    }
    
    // 填写地址
    const addressInput = await page.$('input[name="line1"], input[placeholder*="地址"]');
    if (addressInput) {
      await addressInput.click();
      await sleep(100);
      await addressInput.fill(addressInfo.address);
      await sleep(400);
    }
    
    // 填写城市
    const cityInput = await page.$('input[name="city"], input[placeholder*="城市"]');
    if (cityInput) {
      await cityInput.click();
      await sleep(100);
      await cityInput.fill(addressInfo.city);
      await sleep(400);
    }
    
    // 填写邮编
    const zipInput = await page.$('input[name="zip"], input[placeholder*="邮编"]');
    if (zipInput) {
      await zipInput.click();
      await sleep(100);
      await zipInput.fill(addressInfo.zip);
      await sleep(400);
    }
    
    await sleep(800);
    logger.success('账单信息填写完成');
    
    // 等待提交按钮就绪
    logger.step(5, '检查提交按钮');
    
    let buttonReady = false;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (!buttonReady && attempts < maxAttempts) {
      attempts++;
      
      const isReady = await page.evaluate(() => {
        const submitButton = document.querySelector('button[type="submit"]');
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
    
    logger.info('暂停 3 秒，请检查信息');
    await sleep(3000);
    
    // 提交
    logger.step(6, '点击提交按钮');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      logger.success('已点击提交');
      logger.progress('等待支付处理');
      
      // 立即返回pending状态，让主流程显示按钮
      // 后台检测会在stripe-handler中进行
      return { success: false, pending: true };
      
    } else {
      logger.error('未找到提交按钮');
      return { success: false, error: '未找到提交按钮' };
    }
    
  } catch (error) {
    logger.error('填写失败', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 重新绑卡（返回账号页面重新开始）
 * 前置条件：page 必须已经在 Stripe 绑卡页面或账号页面
 * @param {Page} page - Playwright页面对象
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function retryBind(page) {
  // 使用统一的带标签logger
  // 所有日志都通过统一系统管理
  
  try {
    logger.start('开始重新绑卡');
    logger.info('返回账号页面，重新开始绑卡流程');
    
    // 返回账号页面
    logger.step(1, '返回账号页面');
    await page.goto('https://windsurf.com/account/profile', { waitUntil: 'networkidle' });
    await sleep(2000);
    logger.success('已返回账号页面');
    
    // 先尝试点击汉堡菜单（移动端布局）
    logger.step(2, '检查页面布局');
    const menuButton = await page.$('button[aria-label*="menu"], button:has-text("Open mobile menu")');
    if (menuButton) {
      logger.info('检测到移动端布局，点击菜单按钮');
      await menuButton.click();
      await sleep(1000);
      logger.success('菜单已打开');
    }
    
    // 重新点击升级
    logger.step(3, '重新点击升级到 Pro');
    const context = page.context();
    let stripePage = page;
    
    try {
      // 第一步：点击 Upgrade to Pro
      await page.click('button:has-text("Upgrade to Pro"), a:has-text("Upgrade to Pro")', { timeout: 10000 });
      await sleep(2000);
      logger.success('已点击 Upgrade to Pro');
      
      // 第二步：点击 Select plan 按钮
      logger.progress('查找并点击 Select plan 按钮');
      const selectPlanBtn = await page.$('button:has-text("Select plan"), a:has-text("Select plan")');
      if (selectPlanBtn) {
        logger.success('找到 Select plan 按钮');
        const pagePromise = context.waitForEvent('page');
        await selectPlanBtn.click();
        
        // 等待新的 Stripe 页面
        const newPage = await Promise.race([
          pagePromise,
          sleep(10000).then(() => null)
        ]);
        
        if (newPage) {
          stripePage = newPage;
          logger.success('新的绑卡页面已打开');
        } else {
          // 如果没有新页面，检查当前页面
          const pages = context.pages();
          for (const p of pages) {
            if (p.url().includes('checkout.stripe.com')) {
              stripePage = p;
              break;
            }
          }
        }
        
        await stripePage.bringToFront();
        await sleep(2000);
        logger.success('已到达新的绑卡页面');
      } else {
        logger.warning('未找到 Select plan 按钮，尝试直接查找绑卡页面');
        // 可能直接打开了 Stripe 页面
        const pages = context.pages();
        for (const p of pages) {
          if (p.url().includes('checkout.stripe.com')) {
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
        await page.goto('https://windsurf.com/billing', { waitUntil: 'networkidle', timeout: 15000 });
        await sleep(2000);
        
        const addPaymentBtn = await page.$('button:has-text("Add payment"), a:has-text("Add payment"), button:has-text("Update payment"), a:has-text("Update payment")');
        if (addPaymentBtn) {
          logger.success('找到支付设置入口');
          const pagePromise2 = context.waitForEvent('page');
          await addPaymentBtn.click();
          
          const newPage2 = await Promise.race([
            pagePromise2,
            sleep(10000).then(() => null)
          ]);
          
          if (newPage2) {
            stripePage = newPage2;
            await stripePage.bringToFront();
            await sleep(2000);
            logger.success('已到达绑卡页面');
          } else {
            throw new Error('无法打开绑卡页面');
          }
        } else {
          throw new Error('未找到支付设置入口');
        }
      } else {
        throw clickError;
      }
    }
    
    // 在新页面上重新绑卡（使用统一日志管理）
    return await bindCard(stripePage, null);
    
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
    
    logger.error('重试异常', friendlyMessage);
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
