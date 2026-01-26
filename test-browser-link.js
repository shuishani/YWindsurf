/**
 * 测试浏览器方式获取支付链接
 */

const { connect } = require('puppeteer-real-browser');

async function testGetPaymentLink(email, password) {
  let browser, page;
  
  try {
    console.log('打开浏览器登录...');
    
    const response = await connect({
      headless: false,
      fingerprint: true,
      turnstile: true,
      tf: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--window-size=700,800',
        '--window-position=200,50'
      ]
    });
    
    browser = response.browser;
    page = response.page;
    
    await page.setViewport({ width: 680, height: 750 });
    
    // 1. 登录
    console.log('访问登录页面...');
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
    
    console.log('等待登录...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    console.log('登录成功');
    
    // 2. 访问 pricing 页面
    console.log('访问 pricing 页面...');
    await page.goto('https://windsurf.com/pricing', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. 监听页面跳转
    let stripeLink = null;
    
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        console.log('页面跳转:', url);
        if (url.includes('checkout.stripe.com')) {
          stripeLink = url;
        }
      }
    });
    
    // 4. 点击 "Start Free Trial"
    console.log('点击 Start Free Trial...');
    const clicked = await page.evaluate(() => {
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
    
    if (!clicked) {
      console.log('未找到 Start Free Trial 按钮');
    }
    
    // 5. 等待验证完成并获取 Stripe 链接
    console.log('请完成验证...');
    
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 检查当前页面 URL
      const currentUrl = page.url();
      if (currentUrl.includes('checkout.stripe.com')) {
        stripeLink = currentUrl;
        break;
      }
      
      // 检查所有页面
      const pages = await browser.pages();
      for (const p of pages) {
        const url = p.url();
        if (url.includes('checkout.stripe.com')) {
          stripeLink = url;
          break;
        }
      }
      
      if (stripeLink) break;
      
      if (i > 0 && i % 10 === 0) {
        console.log(`等待验证中... (${i}秒)`);
      }
    }
    
    if (stripeLink) {
      console.log('\n✅ 获取支付链接成功:');
      console.log(stripeLink);
    } else {
      console.log('\n❌ 获取链接超时');
    }
    
    // 不关闭浏览器，让用户看到结果
    console.log('\n按 Ctrl+C 退出...');
    await new Promise(() => {});
    
  } catch (error) {
    console.error('错误:', error.message);
    if (browser) {
      await browser.close();
    }
  }
}

// 使用测试账号
const email = process.argv[2] || 'd319xk6dc@shuishani.cn';
const password = process.argv[3] || 'Test123456';

testGetPaymentLink(email, password);
