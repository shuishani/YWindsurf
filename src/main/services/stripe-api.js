/**
 * Stripe API 绑卡模块
 * 通过 API 获取 Stripe 支付链接，无需浏览器登录
 * 然后直接打开链接并自动填写表单
 */

const axios = require('axios');
const { createTaggedLogger } = require('../utils/logger');
const CONSTANTS = require('../../shared/config/constants');

const logger = createTaggedLogger('批量绑卡');

// Protobuf 编码函数
function encodeVarint(value) {
  const result = [];
  while (value > 0x7f) {
    result.push((value & 0x7f) | 0x80);
    value = value >>> 7;
  }
  result.push(value & 0x7f);
  return Buffer.from(result);
}

function encodeStringField(fieldNumber, value) {
  const tag = (fieldNumber << 3) | 2;
  const data = Buffer.from(value, 'utf-8');
  return Buffer.concat([Buffer.from([tag]), encodeVarint(data.length), data]);
}

function encodeVarintField(fieldNumber, value) {
  const tag = (fieldNumber << 3) | 0;
  return Buffer.concat([Buffer.from([tag]), encodeVarint(value)]);
}

/**
 * 通过 API 获取 Stripe 支付链接
 * @param {string} email - 账号邮箱
 * @param {string} password - 账号密码
 * @returns {Promise<{success: boolean, paymentLink?: string, error?: string}>}
 */
async function getPaymentLink(email, password) {
  try {
    // 日志已在调用处输出，这里不再重复
    const loginUrl = CONSTANTS.WORKER_URL + '/login';
    
    const loginResponse = await axios.post(loginUrl, {
      email,
      password,
      api_key: CONSTANTS.FIREBASE_API_KEY,
      returnSecureToken: true
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: CONSTANTS.REQUEST_TIMEOUT
    });
    
    if (loginResponse.status !== 200 || !loginResponse.data.idToken) {
      logger.error('登录失败', '请检查账号密码');
      return { success: false, error: '登录失败，请检查账号密码' };
    }
    
    const idToken = loginResponse.data.idToken;
    const protobufData = encodeStringField(1, idToken);
    
    await axios.post(
      `${CONSTANTS.WINDSURF_API_BASE}/exa.seat_management_pb.SeatManagementService/GetCurrentUser`,
      protobufData,
      {
        headers: {
          'Content-Type': 'application/proto',
          'connect-protocol-version': '1',
          'Origin': 'https://windsurf.com'
        },
        timeout: CONSTANTS.REQUEST_TIMEOUT
      }
    );
    
    // 3. 获取预批准
    await axios.post(
      `${CONSTANTS.WINDSURF_API_BASE}/exa.seat_management_pb.SeatManagementService/GetPreapprovalForUser`,
      protobufData,
      {
        headers: {
          'Content-Type': 'application/proto',
          'connect-protocol-version': '1',
          'Origin': 'https://windsurf.com'
        },
        timeout: CONSTANTS.REQUEST_TIMEOUT
      }
    );
    
    // 4. 创建订阅，获取支付链接
    const subscribeData = Buffer.concat([
      encodeStringField(1, idToken),
      encodeStringField(2, CONSTANTS.STRIPE_PRICE_ID),
      encodeStringField(4, CONSTANTS.PAYMENT_SUCCESS_URL),
      encodeStringField(5, CONSTANTS.PAYMENT_CANCEL_URL),
      encodeVarintField(8, 2),
      encodeVarintField(9, 1)
    ]);
    
    const subscribeResponse = await axios.post(
      `${CONSTANTS.WINDSURF_API_BASE}/exa.seat_management_pb.SeatManagementService/SubscribeToPlan`,
      subscribeData,
      {
        headers: {
          'Content-Type': 'application/proto',
          'connect-protocol-version': '1',
          'Origin': 'https://windsurf.com'
        },
        timeout: CONSTANTS.REQUEST_TIMEOUT,
        responseType: 'arraybuffer'
      }
    );
    
    if (subscribeResponse.status !== 200) {
      logger.error('获取支付链接失败', '可能已是 Pro 账号');
      return { success: false, error: '获取支付链接失败（可能已是Pro账号）' };
    }
    
    // 5. 解析响应，提取 Stripe 链接
    const rawText = Buffer.from(subscribeResponse.data).toString('utf-8');
    
    if (rawText.includes('https://checkout.stripe.com')) {
      const start = rawText.indexOf('https://checkout.stripe.com');
      let end = start;
      while (end < rawText.length && rawText.charCodeAt(end) >= 32 && !' \n\r\t'.includes(rawText[end])) {
        end++;
      }
      const paymentLink = rawText.substring(start, end);
      // 日志已在调用处输出
      return { success: true, paymentLink };
    }
    
    logger.error('未找到支付链接', '可能已是 Pro 账号');
    return { success: false, error: '未找到支付链接（可能已是Pro账号）' };
    
  } catch (error) {
    // HTTP 409 表示冲突，通常是账号已绑卡
    if (error.response?.status === 409) {
      logger.error('获取支付链接失败', '账号已绑卡或已是Pro');
      return { success: false, error: '账号已绑卡或已是Pro账号' };
    }
    
    logger.error('获取支付链接失败', error.message);
    
    // 网络连接错误处理
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || 
        error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
      return { 
        success: false, 
        error: '网络连接失败，请检查网络或代理设置' 
      };
    }
    
    // Firebase 错误处理
    if (error.response?.data?.error?.message) {
      const msg = error.response.data.error.message;
      if (msg.includes('INVALID_PASSWORD') || msg.includes('EMAIL_NOT_FOUND')) {
        return { success: false, error: '邮箱或密码错误' };
      }
      if (msg.includes('USER_DISABLED')) {
        return { success: false, error: '账号已被禁用' };
      }
    }
    
    return { success: false, error: error.message };
  }
}

module.exports = { getPaymentLink };
