/**
 * 全局常量配置
 */
const CONSTANTS = {
  // Cloudflare Worker 中转地址（用于 Firebase 登录）
  WORKER_URL: 'https://windsurf.shuishani.cn',
  
  // Firebase API Key（Windsurf 官方）
  FIREBASE_API_KEY: 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY',
  
  // Windsurf API
  WINDSURF_API_BASE: 'https://web-backend.windsurf.com',
  
  // Stripe 订阅价格 ID（Pro 计划）
  STRIPE_PRICE_ID: 'price_1NuJObFKuRRGjKOFJVUbaIsJ',
  
  // 支付成功/取消回调 URL
  PAYMENT_SUCCESS_URL: 'https://windsurf.com/billing/payment-success?plan_tier=pro',
  PAYMENT_CANCEL_URL: 'https://windsurf.com/plan?plan_cancelled=true&plan_tier=pro',
  
  // 请求超时时间 (ms)
  REQUEST_TIMEOUT: 30000
};

module.exports = CONSTANTS;
