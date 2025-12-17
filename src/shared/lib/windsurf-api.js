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
 * 调用 GetPlanStatus API 获取账号信息（JSON 格式）
 * 直接获取 planInfo.planName，比自己计算更准确
 * @param {string} authToken - Firebase ID Token
 * @returns {Promise<Object>}
 */
async function getPlanStatus(authToken) {
  try {
    const response = await axios({
      method: 'POST',
      url: 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus',
      data: {
        auth_token: authToken
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': authToken,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-client-version': 'Chrome/JsCore/11.0.0/FirebaseCore-web'
      },
      timeout: 10000
    });
    
    const planStatus = response.data.planStatus || response.data;
    
    return {
      success: true,
      planName: planStatus.planInfo?.planName || 'Free',
      expiresAt: planStatus.planEnd || planStatus.expiresAt || null,
      availablePromptCredits: planStatus.availablePromptCredits || 0,
      usedPromptCredits: planStatus.usedPromptCredits || 0,
      availableFlexCredits: planStatus.availableFlexCredits || 0,
      usedFlexCredits: planStatus.usedFlexCredits || 0
    };
  } catch (error) {
    logger.error('GetPlanStatus API 调用失败', error.message);
    return { success: false, error: error.message, planName: 'Free' };
  }
}

/**
 * 综合获取用户完整信息（简化版）
 * 只调用 RegisterUser + GetPlanStatus，不再使用复杂的 Protobuf
 * @param {string} authToken - Firebase ID Token
 * @returns {Promise<Object>}
 */
async function getUserFullInfo(authToken) {
  try {
    // 并行调用两个 API
    const [registerResult, planStatusResult] = await Promise.all([
      registerUser(authToken),
      getPlanStatus(authToken)
    ]);
    
    if (!planStatusResult.success) {
      return { success: false, error: planStatusResult.error || '获取账号信息失败' };
    }
    
    // 从 GetPlanStatus 获取所有积分信息（与参考项目一致）
    const planType = planStatusResult.planName || 'Free';
    
    // 计算总积分 = Prompt积分 + Flex附加积分
    const promptCredits = Math.floor((planStatusResult.availablePromptCredits || 0) / 100);
    const flexCredits = Math.floor((planStatusResult.availableFlexCredits || 0) / 100);
    const totalCredits = promptCredits + flexCredits;
    
    // 计算已使用积分 = 已使用Prompt积分 + 已使用Flex积分
    const usedPromptCredits = Math.floor((planStatusResult.usedPromptCredits || 0) / 100);
    const usedFlexCredits = Math.floor((planStatusResult.usedFlexCredits || 0) / 100);
    const usedCredits = usedPromptCredits + usedFlexCredits;
    
    return {
      success: true,
      // 基本信息（来自 RegisterUser）
      apiKey: registerResult.success ? registerResult.apiKey : null,
      serverUrl: registerResult.success ? registerResult.serverUrl : null,
      user: {
        name: registerResult.success ? registerResult.name : null
      },
      // 积分信息（来自 GetPlanStatus）- 与参考项目一致
      usage: {
        displayPromptUsed: usedCredits,      // 已使用总积分
        displayPromptLimit: totalCredits,     // 总积分
        displayFlowUsed: usedFlexCredits,     // 已使用Flex积分（保留）
        displayFlowLimit: flexCredits,        // Flex总积分（保留）
        planType: planType
      },
      isPro: ['Pro', 'Trial', 'Teams', 'Enterprise'].includes(planType),
      expiresAt: planStatusResult.expiresAt
    };
  } catch (error) {
    logger.error('获取用户完整信息失败', error.message);
    return { success: false, error: error.message };
  }
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
        usedPromptCredits: fullInfo.usage.displayPromptUsed ?? 0,
        monthlyPromptCredits: fullInfo.usage.displayPromptLimit ?? 0,
        usedFlowCredits: fullInfo.usage.displayFlowUsed ?? 0,
        monthlyFlowCredits: fullInfo.usage.displayFlowLimit ?? 0,
        isPro: fullInfo.isPro || false,
        accountType: fullInfo.isPro ? 'PRO' : 'Free',
        planType: fullInfo.usage.planType || 'Free',  // 账号类型 (Free/Trial/Pro/Teams/Enterprise)
        createdAt: fullInfo.createdAt,
        expiresAt: fullInfo.expiresAt,
        usageUnknown: fullInfo.usage.usageUnknown || false,
        apiKey: fullInfo.apiKey,
        serverUrl: fullInfo.serverUrl
      },
      // 返回 refreshToken 供后续使用（无需密码）
      refreshToken: loginResult.refreshToken
    };
  } catch (error) {
    logger.error('获取账号积分失败', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 通过 Refresh Token 获取完整账号信息
 * 如果 Token 刷新失败，会尝试用邮箱密码重新登录
 * @param {string} refreshToken - Firebase Refresh Token
 * @param {string} email - 邮箱（可选，用于回退登录）
 * @param {string} password - 密码（可选，用于回退登录）
 * @returns {Promise<Object>}
 */
async function getAccountCreditsByRefreshToken(refreshToken, email = null, password = null) {
  try {
    const { refreshIdToken, loginWithEmailPassword } = require('./firebase-auth');
    
    // 1. 尝试使用 Refresh Token 获取新的 ID Token
    let tokenResult = await refreshIdToken(refreshToken);
    let newRefreshToken = null;
    let usedFallback = false;
    
    // 2. 如果 Token 刷新失败，尝试用邮箱密码重新登录（仅当有密码时）
    if (!tokenResult.success) {
      if (email && password) {
        const loginResult = await loginWithEmailPassword(email, password);
        if (loginResult.success) {
          tokenResult = {
            success: true,
            idToken: loginResult.idToken,
            refreshToken: loginResult.refreshToken
          };
          newRefreshToken = loginResult.refreshToken;
          usedFallback = true;
        } else {
          return { success: false, error: 'Token刷新失败，密码登录也失败: ' + loginResult.error };
        }
      } else {
        // 没有密码，直接返回 Token 刷新失败
        return { success: false, error: 'Token刷新失败: ' + tokenResult.error };
      }
    } else {
      newRefreshToken = tokenResult.refreshToken;
    }
    
    // 3. 获取完整信息
    const fullInfo = await getUserFullInfo(tokenResult.idToken);
    
    if (!fullInfo.success || !fullInfo.usage) {
      return { success: false, error: 'API调用失败: ' + (fullInfo.error || '未知错误') };
    }
    
    // 4. 返回格式化的数据
    return {
      success: true,
      data: {
        email: fullInfo.user?.email || '',
        name: fullInfo.user?.name || fullInfo.user?.displayName || '',
        usedPromptCredits: fullInfo.usage.displayPromptUsed ?? 0,
        monthlyPromptCredits: fullInfo.usage.displayPromptLimit ?? 0,
        usedFlowCredits: fullInfo.usage.displayFlowUsed ?? 0,
        monthlyFlowCredits: fullInfo.usage.displayFlowLimit ?? 0,
        isPro: fullInfo.isPro || false,
        accountType: fullInfo.isPro ? 'PRO' : 'Free',
        planType: fullInfo.usage.planType || 'Free',
        createdAt: fullInfo.createdAt,
        expiresAt: fullInfo.expiresAt,
        usageUnknown: fullInfo.usage.usageUnknown || false,
        apiKey: fullInfo.apiKey,
        serverUrl: fullInfo.serverUrl
      },
      // 返回新的 token 供调用方更新本地存储
      newRefreshToken: newRefreshToken,
      usedFallback: usedFallback
    };
  } catch (error) {
    logger.error('通过RefreshToken获取账号积分失败', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  registerUser,        // 获取 API Key 和用户名
  getPlanStatus,       // 获取积分和账号类型
  getUserFullInfo,     // 推荐方式：获取所有信息（并行调用）
  getAccountCredits,   // 公共函数：通过邮箱密码获取积分
  getAccountCreditsByRefreshToken  // 通过 Refresh Token 获取积分
};
