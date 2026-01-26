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
 * @param {string} turnstileToken - Cloudflare Turnstile 验证 token（可选）
 * @returns {Promise<{success: boolean, paymentLink?: string, error?: string, needsCaptcha?: boolean}>}
 */
async function getPaymentLink(email, password, turnstileToken = null) {
  try {
    // 检查密码是否存在
    if (!password) {
      logger.error('获取支付链接失败', '该账号没有密码，无法登录');
      return { success: false, error: '该账号没有密码，无法获取支付链接（通过Token导入的账号需要密码）' };
    }
    
    // 1. Firebase 登录获取 ID Token
    const loginUrl = CONSTANTS.WORKER_URL + '/login';
    logger.info('正在登录...', email);
    
    let loginResponse;
    try {
      loginResponse = await axios.post(loginUrl, {
        email,
        password,
        api_key: CONSTANTS.FIREBASE_API_KEY,
        returnSecureToken: true
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: CONSTANTS.REQUEST_TIMEOUT
      });
    } catch (loginError) {
      // 登录阶段的错误单独处理
      if (loginError.response?.status === 400) {
        const errorData = loginError.response?.data;
        let errorMsg = '登录失败';
        if (errorData?.error?.message) {
          const msg = errorData.error.message;
          if (msg.includes('INVALID_PASSWORD')) errorMsg = '密码错误';
          else if (msg.includes('EMAIL_NOT_FOUND')) errorMsg = '邮箱不存在';
          else if (msg.includes('USER_DISABLED')) errorMsg = '账号已被禁用';
          else if (msg.includes('INVALID_LOGIN_CREDENTIALS')) errorMsg = '邮箱或密码错误';
          else errorMsg = msg;
        }
        logger.error('登录失败', errorMsg);
        return { success: false, error: `登录失败: ${errorMsg}` };
      }
      throw loginError;  // 其他错误继续抛出
    }
    
    if (loginResponse.status !== 200 || !loginResponse.data.idToken) {
      logger.error('登录失败', '请检查账号密码');
      return { success: false, error: '登录失败，请检查账号密码' };
    }
    
    logger.success('登录成功');
    
    const idToken = loginResponse.data.idToken;
    const protobufData = encodeStringField(1, idToken);
    
    // 2. 获取当前用户信息
    logger.info('获取用户信息...');
    try {
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
    } catch (e) {
      logger.warning('GetCurrentUser 失败(可忽略)', e.response?.status || e.message);
    }
    
    // 3. 获取预批准
    logger.info('获取预批准...');
    try {
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
    } catch (e) {
      logger.warning('GetPreapprovalForUser 失败(可忽略)', e.response?.status || e.message);
    }
    
    // 4. 创建订阅，获取支付链接
    logger.info('创建订阅...');
    
    // 构建请求数据
    const fields = [
      encodeStringField(1, idToken),
      encodeStringField(2, CONSTANTS.STRIPE_PRICE_ID),
      encodeStringField(4, CONSTANTS.PAYMENT_SUCCESS_URL),
      encodeStringField(5, CONSTANTS.PAYMENT_CANCEL_URL),
      encodeVarintField(8, 2),
      encodeVarintField(9, 1)
    ];
    
    // 如果有 turnstile token，添加到字段 10
    if (turnstileToken) {
      fields.push(encodeStringField(10, turnstileToken));
      logger.info('已添加验证码 token');
    }
    
    const subscribeData = Buffer.concat(fields);
    
    let subscribeResponse;
    try {
      subscribeResponse = await axios.post(
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
    } catch (subscribeError) {
      // 检查是否需要验证码
      if (subscribeError.response?.status === 400) {
        const errorBody = subscribeError.response?.data 
          ? Buffer.from(subscribeError.response.data).toString('utf-8') 
          : '';
        
        if (errorBody.includes('captcha required')) {
          logger.warning('需要验证码');
          return { success: false, needsCaptcha: true, error: '需要完成人机验证' };
        }
        
        if (errorBody.includes('captcha validation failed')) {
          logger.error('验证码无效');
          return { success: false, error: '验证码无效，请重新验证' };
        }
        
        // 其他 400 错误
        logger.error('创建订阅失败', errorBody);
        return { success: false, error: '账号已绑卡或已是Pro/Trial账号' };
      }
      throw subscribeError;
    }
    
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
    
    // HTTP 400 错误处理
    if (error.response?.status === 400) {
      const errorData = error.response?.data;
      let errorMsg = '请求参数错误';
      if (errorData?.error?.message) {
        errorMsg = errorData.error.message;
      } else if (typeof errorData === 'string') {
        errorMsg = errorData;
      }
      logger.error('HTTP 400 错误', errorMsg);
      return { success: false, error: `请求失败(400): ${errorMsg}` };
    }
    
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
