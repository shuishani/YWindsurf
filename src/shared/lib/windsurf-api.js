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
    
    // 解析 Protobuf 结构
    const decoded = decodeProtobufMessage(buffer);
    
    // 提取积分信息
    const credits = extractCreditsInfo(decoded);
    
    // 提取时间信息
    const { createdAt, expiresAt } = extractTimeInfo(decoded);

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
        usageUnknown: credits.usageUnknown
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
 * 从 Protobuf 时间戳对象提取 ISO 时间字符串
 */
function extractTimestamp(obj) {
  if (obj && obj['1'] && typeof obj['1'] === 'number' && obj['1'] > 1600000000 && obj['1'] < 2000000000) {
    const seconds = obj['1'];
    const nanos = obj['2'] || 0;
    return new Date(seconds * 1000 + Math.floor(nanos / 1000000)).toISOString();
  }
  return null;
}

/**
 * 从解码的 Protobuf 消息中提取时间信息
 * 优先级：
 * 1. nested_4.nested_18 (Team 到期时间 - 500/750积分账号)
 * 2. nested_4.nested_21 (Team 备用到期时间)
 * 3. nested_1.nested_27 (User 到期时间 - 100积分试用账号)
 * 4. nested_1.nested_26 + 30天 (免费账号计算)
 */
function extractTimeInfo(decoded) {
  let createdAt = null;
  let expiresAt = null;
  
  try {
    const userMessage = decoded.nested_1;
    const teamMessage = decoded.nested_4;
    
    // 创建时间: nested_1.nested_4
    if (userMessage?.nested_4) {
      createdAt = extractTimestamp(userMessage.nested_4);
    }
    
    // 到期时间优先级处理
    // 1. 优先从 Team 消息获取 (500/750积分账号)
    if (teamMessage) {
      expiresAt = extractTimestamp(teamMessage.nested_18) || 
                  extractTimestamp(teamMessage.nested_21);
    }
    
    // 2. 如果没有 Team 到期时间，使用 User 消息 (100积分试用账号)
    if (!expiresAt && userMessage?.nested_27) {
      expiresAt = extractTimestamp(userMessage.nested_27);
    }
    
    // 3. 如果都没有，使用创建时间 + 30天（25积分免费账号）
    if (!expiresAt && createdAt) {
      const baseDate = new Date(createdAt);
      baseDate.setDate(baseDate.getDate() + 30);
      expiresAt = baseDate.toISOString();
    }
  } catch (e) {
    logger.error('时间戳提取失败', e.message);
  }
  
  return { createdAt, expiresAt };
}

/**
 * 从解码的 Protobuf 消息中提取积分信息
 * 
 * 数据来源：
 * - User (nested_1): 字段28=已用Prompt, 字段29=已用Flow
 * - PlanInfo (nested_6): 字段12=Prompt限额, 字段13=Flow限额
 * - Team (nested_4): 字段15=邀请积分, 字段16/17=Team使用量
 */
function extractCreditsInfo(decoded) {
  const userMessage = decoded.nested_1;
  const planInfoMessage = decoded.nested_6;
  const teamMessage = decoded.nested_4;
  
  // 从 User 消息提取使用量
  let usedPrompt = userMessage?.[28] || null;
  let usedFlow = userMessage?.[29] || null;
  
  // 从 PlanInfo 消息提取限额
  let maxPrompt = planInfoMessage?.[12] || null;
  let maxFlow = planInfoMessage?.[13] || null;
  
  // 从 Team 消息提取邀请积分
  const referralCredits = teamMessage?.[15] || 0;
  
  // 从 Team 消息搜索使用量 (500/750积分账号)
  const teamCredits = searchTeamCredits(decoded);
  if (teamCredits.usedPrompt !== null) usedPrompt = teamCredits.usedPrompt;
  if (teamCredits.usedFlow !== null) usedFlow = teamCredits.usedFlow;
  
  // 判断是否为试用账号 (100积分)
  // 特征：nested_6.1=2, nested_6.3=1, 没有 Team 消息
  const isTrial = planInfoMessage?.[1] === 2 && planInfoMessage?.[3] === 1 && !teamMessage;
  let usageUnknown = false;
  
  if (isTrial) {
    // 试用账号限额固定为 100 积分
    maxPrompt = 10000;  // 100 * 100
    maxFlow = 0;
    // 如果无法获取使用量，标记为未知
    if (usedPrompt === null && usedFlow === null) {
      usageUnknown = true;
    }
  }
  
  // 确保数值有效
  usedPrompt = usedPrompt || 0;
  usedFlow = usedFlow || 0;
  maxPrompt = (maxPrompt || 0) + referralCredits;  // 加上邀请积分
  maxFlow = maxFlow || 0;
  
  // 转换为官网显示单位（÷ 100）
  const displayPromptUsed = Math.floor(usedPrompt / 100);
  const displayFlowUsed = Math.floor(usedFlow / 100);
  const displayPromptLimit = Math.floor(maxPrompt / 100);
  const displayFlowLimit = Math.floor(maxFlow / 100);
  const displayReferralCredits = Math.floor(referralCredits / 100);
  
  return {
    usedPrompt,
    usedFlow,
    maxPrompt,
    maxFlow,
    referralCredits,
    usedTotal: usedPrompt + usedFlow,
    maxTotal: maxPrompt + maxFlow,
    displayPromptUsed,
    displayFlowUsed,
    displayPromptLimit,
    displayFlowLimit,
    displayReferralCredits,
    displayUsedTotal: displayPromptUsed + displayFlowUsed,
    displayMaxTotal: displayPromptLimit + displayFlowLimit,
    displayPromptText: usageUnknown ? `—/${displayPromptLimit}` : `${displayPromptUsed}/${displayPromptLimit}`,
    usageUnknown,
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
        usageUnknown: fullInfo.usage.usageUnknown || false,
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
