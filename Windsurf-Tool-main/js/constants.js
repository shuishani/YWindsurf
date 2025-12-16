/**
 * 全局常量配置
 */
const CONSTANTS = {
  // Cloudflare Worker 中转地址
  WORKER_URL: 'https://windsurf.shuishani.cn',
  
  // Cloudflare Worker 访问密钥（用于验证请求来源，防止滥用）
  // 必须与 Cloudflare Workers 中的 SECRET_KEY 一致
  WORKER_SECRET_KEY: 'djisoaksBHIKSOI87126221',
  
  // Firebase API Key
  FIREBASE_API_KEY: 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY',
  
  // Windsurf 注册 API
  WINDSURF_REGISTER_API: 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
  
  // 请求超时时间 (ms)
  REQUEST_TIMEOUT: 30000
};

module.exports = CONSTANTS;
