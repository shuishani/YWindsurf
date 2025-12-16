/**
 * Firebase认证模块
 * 用于通过邮箱密码登录获取Firebase ID Token
 * 使用中转服务解决国内访问问题
 */

const axios = require('axios');
const CONSTANTS = require('../config/constants');

// Firebase Web API Key (从 Windsurf中提取)
// 这个key是公开的，用于客户端认证
const FIREBASE_API_KEY = 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY';

// 中转服务地址
const WORKER_URL = CONSTANTS.WORKER_URL;

/**
 * 使用邮箱和密码登录Firebase
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<Object>}
 */
async function loginWithEmailPassword(email, password) {
  try {
    // 使用中转服务登录 Firebase
    const response = await axios.post(
      `${WORKER_URL}/login`,
      {
        email: email,
        password: password,
        api_key: FIREBASE_API_KEY,
        returnSecureToken: true
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    // 官方 API（需要梯子）
    // const response = await axios.post(
    //   `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    //   {
    //     email: email,
    //     password: password,
    //     returnSecureToken: true
    //   },
    //   {
    //     headers: {
    //       'Content-Type': 'application/json'
    //     },
    //     timeout: 10000
    //   }
    // );
    
    return {
      success: true,
      idToken: response.data.idToken,        // 这就是我们需要的token
      refreshToken: response.data.refreshToken,
      expiresIn: response.data.expiresIn,    // token有效期（秒）
      localId: response.data.localId,        // 用户ID
      email: response.data.email,
      displayName: response.data.displayName || email.split('@')[0]
    };
  } catch (error) {
    if (error.response && error.response.data) {
      const errorData = error.response.data.error;
      let message = '登录失败';
      
      switch (errorData.message) {
        case 'EMAIL_NOT_FOUND':
          message = '邮箱不存在';
          break;
        case 'INVALID_PASSWORD':
          message = '密码错误';
          break;
        case 'USER_DISABLED':
          message = '账号已被禁用';
          break;
        case 'INVALID_EMAIL':
          message = '邮箱格式错误';
          break;
        default:
          message = errorData.message;
      }
      
      return {
        success: false,
        error: message
      };
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 使用refresh token刷新ID token
 * @param {string} refreshToken 
 * @returns {Promise<Object>}
 */
async function refreshIdToken(refreshToken) {
  try {
    // 使用中转服务刷新 Token
    const response = await axios.post(
      `${WORKER_URL}/refresh`,
      {
        refresh_token: refreshToken,
        api_key: FIREBASE_API_KEY
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    // 官方 API（需要梯子）
    // const response = await axios.post(
    //   `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    //   {
    //     grant_type: 'refresh_token',
    //     refresh_token: refreshToken
    //   },
    //   {
    //     headers: {
    //       'Content-Type': 'application/json'
    //     },
    //     timeout: 10000
    //   }
    // );
    
    return {
      success: true,
      idToken: response.data.id_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  loginWithEmailPassword,
  refreshIdToken
};
