/**
 * Windsurf API 调用模块（精简版）
 * 结合使用 RegisterUser API (简单获取 API Key) 和 GetCurrentUser API (完整获取积分)
 */

const axios = require('axios');
const { createTaggedLogger } = require('../../main/utils/logger');

// 创建空标签的日志实例
const logger = createTaggedLogger('');

/**
 * 调用 RegisterUser API 获取基本信息
 * 优点：简单的 JSON 格式，快速获取 API Key
 * @param {string} firebaseIdToken - Firebase ID Token
 * @returns {Promise<Object>}
 */
async function registerUser(firebaseIdToken) {
  try {
    const response = await axios({
      method: 'POST',
      url: 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
      data: {
        firebase_id_token: firebaseIdToken
      },
      headers: {
        'Content-Type': 'application/json',
        'x-client-version': 'Chrome/JsCore/11.0.0/FirebaseCore-web',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    return {
      success: true,
      apiKey: response.data.api_key,
      name: response.data.name,
      serverUrl: response.data.api_server_url
    };
  } catch (error) {
    logger.error('RegisterUser API 调用失败', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 调用 GetCurrentUser API 获取完整积分信息
 * 使用手动 Protobuf 编码/解码
 * @param {string} authToken - Firebase ID Token
 * @returns {Promise<Object>}
 */
async function getCurrentUser(authToken) {
  try {
    // 1. 构造 Protobuf 请求
    const requestData = encodeGetCurrentUserRequest(authToken);
    
    // 2. 发送请求
    const response = await axios({
      method: 'POST',
      url: 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetCurrentUser',
      data: requestData,
      headers: {
        'Content-Type': 'application/proto',
        'X-Auth-Token': authToken,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    // 3. 解析 Protobuf 响应
    const responseBuffer = Buffer.from(response.data);
    return parseGetCurrentUserResponse(responseBuffer);
    
  } catch (error) {
    logger.error('GetCurrentUser API 调用失败', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 综合获取用户完整信息（推荐使用）
 * 并行调用 RegisterUser 和 GetCurrentUser，同时获取 API Key 和积分
 * @param {string} authToken - Firebase ID Token
 * @returns {Promise<Object>}
 */
async function getUserFullInfo(authToken) {
  try {
    // 并行调用两个 API
    const [registerResult, currentUserResult] = await Promise.all([
      registerUser(authToken),
      getCurrentUser(authToken)
    ]);
    
    // 合并结果
    return {
      success: currentUserResult.success,
      // 基本信息（来自 RegisterUser）
      apiKey: registerResult.success ? registerResult.apiKey : null,
      serverUrl: registerResult.success ? registerResult.serverUrl : null,
      // 用户信息（来自 GetCurrentUser）
      user: currentUserResult.user,
      subscription: currentUserResult.subscription,
      usage: currentUserResult.usage,
      team: currentUserResult.team,
      isPro: currentUserResult.isPro,
      createdAt: currentUserResult.createdAt, // 传递创建时间
      expiresAt: currentUserResult.expiresAt, // 传递到期时间
      // 错误信息
      registerError: registerResult.success ? null : registerResult.error,
      currentUserError: currentUserResult.success ? null : currentUserResult.error
    };
  } catch (error) {
    logger.error('获取用户完整信息失败', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Protobuf 编码/解码工具函数
// ============================================================================

/**
 * 编码 GetCurrentUserRequest
 */
function encodeGetCurrentUserRequest(authToken) {
  const parts = [
    encodeString(1, authToken),  // auth_token
    encodeBool(2, true),         // generate_profile_picture_url
    encodeBool(3, true),         // create_if_not_exist
    encodeBool(4, true),         // include_subscription
    encodeString(5, ''),         // sso_token
    encodeString(6, '')          // saml_provider_id
  ];
  
  return Buffer.concat(parts);
}

/**
 * 解析 GetCurrentUserResponse
 */
function parseGetCurrentUserResponse(buffer) {
  try {
    // 提取用户邮箱
    const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 5000));
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const email = emailMatch?.[1] || null;
    
    // 提取用户ID
    const uuidMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    const userId = uuidMatch?.[1] || null;
    
    // 提取用户名
    const nameMatch = text.match(/[\x20-\x7E]{2,30}(?=[\x00-\x1F])/g);
    let displayName = email ? email.split('@')[0] : 'Unknown';
    if (nameMatch && nameMatch.length > 0) {
      for (const name of nameMatch) {
        if (!name.includes('@') && !name.match(/[a-f0-9]{8}-[a-f0-9]{4}/i) && name.length > 2 && name.length < 30) {
          displayName = name.trim();
          break;
        }
      }
    }
    
    // 解析 Protobuf 结构获取积分
    const decoded = decodeProtobufMessage(buffer);
    const credits = extractCreditsInfo(decoded);
    
    // 提取创建时间和到期时间
    let createdAt = null;
    let expiresAt = null;
    try {
      // 查找时间戳的辅助函数
      const extractTimestamp = (obj) => {
        if (obj && obj['1'] && typeof obj['1'] === 'number' && obj['1'] > 1600000000) {
          const seconds = obj['1'];
          const nanos = obj['2'] || 0;
          return new Date(seconds * 1000 + Math.floor(nanos / 1000000)).toISOString();
        }
        return null;
      };

      const timestamps = [];
      
      // 直接从已知的关键路径提取时间戳
      const knownPaths = [
        decoded.nested_4?.nested_3,
        decoded.nested_4?.nested_9, 
        decoded.nested_4?.nested_18,
        decoded.nested_4?.nested_20,
        decoded.nested_4?.nested_21,
        decoded.nested_1?.nested_2,
        decoded.nested_1?.nested_3
      ];
      
      // 提取有效时间戳
      for (const obj of knownPaths) {
        const ts = extractTimestamp(obj);
        if (ts) timestamps.push(ts);
      }
      
      if (timestamps.length > 0) {
        // 按时间排序
        timestamps.sort((a, b) => new Date(a) - new Date(b));
        
        // 简单逻辑：最早的是创建时间，最晚的是到期时间
        createdAt = timestamps[0];
        if (timestamps.length > 1) {
          // 寻找未来的时间戳作为到期时间
          const now = new Date();
          const futureTimestamps = timestamps.filter(ts => new Date(ts) > now);
          expiresAt = futureTimestamps.length > 0 ? futureTimestamps[0] : timestamps[timestamps.length - 1];
        }
      }
    } catch (e) {
      // 忽略提取错误
    }

    // 判断账号类型
    const subscriptionType = determineSubscriptionType(credits);
    
    return {
      success: true,
      createdAt: createdAt, // 返回创建时间
      expiresAt: expiresAt, // 返回到期时间
      user: {
        email: email,
        name: displayName,
        displayName: displayName,
        localId: userId,
        uid: userId
      },
      subscription: {
        type: subscriptionType
      },
      usage: {
        // 原始值（API 返回的值 × 100）
        used: credits.usedTotal,
        limit: credits.maxTotal,
        remaining: credits.maxTotal - credits.usedTotal,
        promptUsed: credits.usedPrompt,
        promptLimit: credits.maxPrompt,
        flowUsed: credits.usedFlow,
        flowLimit: credits.maxFlow,
        // 官网显示值（除以 100）
        displayUsed: credits.displayUsedTotal,
        displayLimit: credits.displayMaxTotal,
        displayRemaining: credits.displayMaxTotal - credits.displayUsedTotal,
        displayPromptUsed: credits.displayPromptUsed,
        displayPromptLimit: credits.displayPromptLimit,
        displayFlowUsed: credits.displayFlowUsed,
        displayFlowLimit: credits.displayFlowLimit,
        displayPromptText: credits.displayPromptText,
        promptUsageUnknown: credits.promptUsageUnknown
      },
      team: credits.hasTeam ? { name: null } : null,
      isPro: subscriptionType === 'PRO'
    };
  } catch (e) {
    logger.error('解析响应失败', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * 从解码的 Protobuf 消息中提取积分信息
 */
function extractCreditsInfo(decoded) {
  let usedPrompt = null;
  let usedFlow = null;
  let maxPrompt = null;
  let maxFlow = null;
  let referralCredits = 0;  // 邀请积分
  let isNewTrialAccount = false;
  let isTrial = false;
  let creditsUnknown = false;
  
  // 提取 User 消息 (field 1)
  const userMessage = decoded.nested_1;
  if (userMessage) {
    usedPrompt = userMessage[28] || null;
    usedFlow = userMessage[29] || null;
    isNewTrialAccount = userMessage[8] === 2;
  }
  
  // 提取 PlanInfo 消息 (field 6)
  const planInfoMessage = decoded.nested_6;
  if (planInfoMessage) {
    maxPrompt = planInfoMessage[12] || null;
    maxFlow = planInfoMessage[13] || null;
    isTrial = planInfoMessage[1] === 2 && planInfoMessage[3] === 1;
  }
  
  // 提取 Team 消息 (field 4) - 包含邀请积分
  const teamMessage = decoded.nested_4;
  if (teamMessage) {
    referralCredits = teamMessage[15] || 0;  // 邀请积分
  }
  
  // 搜索 Team 消息中的已使用积分 (field 16/17)
  const teamCredits = searchTeamCredits(decoded);
  if (teamCredits.usedPrompt !== null) usedPrompt = teamCredits.usedPrompt;
  if (teamCredits.usedFlow !== null) usedFlow = teamCredits.usedFlow;
  
  // 处理旧版试用账号无法获取已使用量的情况
  if (usedPrompt === null && usedFlow === null && isTrial && !isNewTrialAccount) {
    creditsUnknown = true;
  }
  
  usedPrompt = usedPrompt || 0;
  usedFlow = usedFlow || 0;
  
  // 处理试用账号限额
  if (isTrial && !isNewTrialAccount) {
    maxPrompt = 10000;  // 100 * 100
    maxFlow = 1000;     // 10 * 100
  }
  
  maxPrompt = maxPrompt || 0;
  maxFlow = maxFlow || 0;
  
  // 将邀请积分加到 Prompt 限额中
  maxPrompt = maxPrompt + referralCredits;
  
  // 转换为官网显示单位（÷ 100）
  const displayPromptUsed = Math.floor(usedPrompt / 100);
  const displayFlowUsed = Math.floor(usedFlow / 100);
  const displayPromptLimit = Math.floor(maxPrompt / 100);  // 已包含邀请积分
  const displayFlowLimit = Math.floor(maxFlow / 100);
  const displayReferralCredits = Math.floor(referralCredits / 100);
  
  return {
    usedPrompt,
    usedFlow,
    maxPrompt,  // 已包含邀请积分
    maxFlow,
    referralCredits,  // 邀请积分
    usedTotal: usedPrompt + usedFlow,
    maxTotal: maxPrompt + maxFlow,
    displayPromptUsed,
    displayFlowUsed,
    displayPromptLimit,  // 已包含邀请积分
    displayFlowLimit,
    displayReferralCredits,  // 邀请积分显示值
    displayUsedTotal: displayPromptUsed + displayFlowUsed,
    displayMaxTotal: displayPromptLimit + displayFlowLimit,
    displayPromptText: creditsUnknown ? `— / ${displayPromptLimit}` : `${displayPromptUsed}/${displayPromptLimit}`,
    promptUsageUnknown: creditsUnknown,
    hasTeam: teamCredits.found
  };
}

/**
 * 搜索 Team 消息中的积分数据
 */
function searchTeamCredits(obj) {
  if (!obj || typeof obj !== 'object') {
    return { found: false, usedPrompt: null, usedFlow: null };
  }
  
  // 检查当前对象是否包含 field 16 或 17
  if (obj['16'] !== undefined || obj['17'] !== undefined) {
    return {
      found: true,
      usedFlow: obj['16'] || null,
      usedPrompt: obj['17'] || null
    };
  }
  
  // 递归搜索嵌套对象
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      const result = searchTeamCredits(value);
      if (result.found) return result;
    }
  }
  
  return { found: false, usedPrompt: null, usedFlow: null };
}

/**
 * 根据积分限额判断订阅类型
 */
function determineSubscriptionType(credits) {
  if (credits.displayPromptLimit >= 500 || credits.displayFlowLimit >= 1500) {
    return 'PRO';
  } else if (credits.displayPromptLimit >= 100) {
    return 'PRO';  // 试用 PRO
  }
  return 'FREE';
}

/**
 * 解码 Protobuf 消息
 */
function decodeProtobufMessage(buffer, depth = 0) {
  const fields = {};
  let pos = 0;
  
  function readVarint() {
    let value = 0;
    let shift = 0;
    let byte;
    
    do {
      if (pos >= buffer.length) return null;
      byte = buffer[pos++];
      value |= (byte & 0x7F) << shift;
      shift += 7;
    } while (byte & 0x80);
    
    return value;
  }
  
  function readLengthDelimited() {
    const length = readVarint();
    if (length === null || pos + length > buffer.length) return null;
    const data = buffer.slice(pos, pos + length);
    pos += length;
    return data;
  }
  
  function skipField(wireType) {
    switch (wireType) {
      case 0: readVarint(); break;
      case 1: pos += 8; break;
      case 2: readLengthDelimited(); break;
      case 5: pos += 4; break;
    }
  }
  
  while (pos < buffer.length) {
    const tag = readVarint();
    if (tag === null) break;
    
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    
    if (wireType === 0) {
      const value = readVarint();
      if (value !== null) fields[fieldNumber] = value;
    } else if (wireType === 2) {
      const data = readLengthDelimited();
      if (data !== null && depth < 3) {
        const nestedFields = decodeProtobufMessage(data, depth + 1);
        if (Object.keys(nestedFields).length > 0) {
          fields[`nested_${fieldNumber}`] = nestedFields;
        }
      }
    } else {
      skipField(wireType);
    }
  }
  
  return fields;
}

/**
 * 编码 varint
 */
function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7F) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);
  return Buffer.from(bytes);
}

/**
 * 编码字符串字段
 */
function encodeString(fieldNumber, value) {
  const valueBytes = Buffer.from(value, 'utf-8');
  const tag = (fieldNumber << 3) | 2;
  const tagBytes = encodeVarint(tag);
  const lengthBytes = encodeVarint(valueBytes.length);
  return Buffer.concat([tagBytes, lengthBytes, valueBytes]);
}

/**
 * 编码布尔字段
 */
function encodeBool(fieldNumber, value) {
  const tag = (fieldNumber << 3) | 0;
  const tagBytes = encodeVarint(tag);
  const valueBytes = Buffer.from([value ? 1 : 0]);
  return Buffer.concat([tagBytes, valueBytes]);
}

/**
 * 通过邮箱和密码获取完整账号信息（公共函数）
 * @param {string} email - 邮箱
 * @param {string} password - 密码
 * @returns {Promise<Object>}
 */
async function getAccountCredits(email, password) {
  try {
    // 1. Firebase 登录
    const { loginWithEmailPassword } = require('./firebase-auth');
    const loginResult = await loginWithEmailPassword(email, password);
    
    if (!loginResult.success) {
      return { success: false, error: '登录失败: ' + loginResult.error };
    }
    
    // 2. 获取完整信息
    const fullInfo = await getUserFullInfo(loginResult.idToken);
    
    if (!fullInfo.success || !fullInfo.usage) {
      return { success: false, error: 'API调用失败: ' + (fullInfo.error || '未知错误') };
    }
    
    // 3. 返回格式化的数据
    return {
      success: true,
      data: {
        email: fullInfo.user?.email || email,
        name: fullInfo.user?.name || fullInfo.user?.displayName || email.split('@')[0],
        usedPromptCredits: fullInfo.usage.displayPromptUsed || 0,
        monthlyPromptCredits: fullInfo.usage.displayPromptLimit || 500,
        usedFlowCredits: fullInfo.usage.displayFlowUsed || 0,
        monthlyFlowCredits: fullInfo.usage.displayFlowLimit || 500,
        isPro: fullInfo.isPro || false,
        accountType: fullInfo.isPro ? 'PRO' : 'Free',
        createdAt: fullInfo.createdAt,
        expiresAt: fullInfo.expiresAt,
        apiKey: fullInfo.apiKey,
        serverUrl: fullInfo.serverUrl
      }
    };
  } catch (error) {
    logger.error('获取账号积分失败', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  registerUser,        // 简单方式：只获取 API Key 和用户名
  getCurrentUser,      // 完整方式：获取积分详情
  getUserFullInfo,     // 推荐方式：获取所有信息（并行调用）
  getAccountCredits    // 公共函数：通过邮箱密码获取积分
};
