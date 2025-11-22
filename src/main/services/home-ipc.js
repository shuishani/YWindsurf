const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const util = require('util');
const exec = require('child_process').exec;
const execPromise = util.promisify(exec);
const { logger } = require('../utils/logger');

// 移除重复的开发模式检查，统一使用logger的内置检查

/**
 * 从状态文件中提取积分信息的通用函数
 */
function extractCreditsFromState(stateData) {
  const promptMatch = stateData.match(/"usedPromptCredits":(\d+)|"used_prompt_credits":(\d+)/);
  const promptLimitMatch = stateData.match(/"monthlyPromptCredits":(\d+)|"monthly_prompt_credits":(\d+)/);
  const flowMatch = stateData.match(/"usedFlowCredits":(\d+)|"used_flow_credits":(\d+)/);
  const flowLimitMatch = stateData.match(/"monthlyFlowCredits":(\d+)|"monthly_flow_credits":(\d+)/);
  
  return {
    usedPrompt: promptMatch ? parseInt(promptMatch[1] || promptMatch[2]) || 0 : 0,
    monthlyPrompt: promptLimitMatch ? parseInt(promptLimitMatch[1] || promptLimitMatch[2]) || 500 : 500,
    usedFlow: flowMatch ? parseInt(flowMatch[1] || flowMatch[2]) || 0 : 0,
    monthlyFlow: flowLimitMatch ? parseInt(flowLimitMatch[1] || flowLimitMatch[2]) || 1500 : 1500
  };
}

/**
 * 根据积分限额判断账号类型
 */
function getAccountType(monthlyPromptCredits) {
  if (monthlyPromptCredits >= 500) {
    return { type: 'PRO', isPro: true };
  } else if (monthlyPromptCredits === 100) {
    return { type: 'Trial', isPro: true };
  } else {
    return { type: 'Free', isPro: false };
  }
}

/**
 * 注册首页相关的IPC处理
 */
function registerHomeIPC(app) {
  // 获取系统信息
  ipcMain.handle('get-system-info', async () => {
    try {
      // 检测Windsurf安装路径
      let windsurfPath = '';
      const possiblePaths = [
        path.join(process.env.LOCALAPPDATA, 'Programs', 'Windsurf'),
        path.join(process.env.APPDATA, 'Windsurf'),
        'C:\\Program Files\\Windsurf'
      ];
      
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          windsurfPath = p;
          break;
        } catch (e) {
          // 路径不存在，继续
        }
      }
      
      // 读取storage.json获取机器码
      let machineId = '-';
      try {
        const storagePath = path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'storage.json');
        const storageData = await fs.readFile(storagePath, 'utf-8');
        const storage = JSON.parse(storageData);
        machineId = storage['telemetry.machineId'] || '-';
      } catch (e) {
        // 静默处理机器码读取失败
      }
      
      // 获取当前登录账号信息
      let currentAccount = null;
      try {
        const stateDbPath = path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
        logger.info('获取账号信息');
        const stateData = await fs.readFile(stateDbPath, 'utf-8');
        
        // 从加密的 sessions 数据中获取真实账号信息
        let email = null;
        let userName = null;
        let apiKey = null;
        
        // 查找加密的 sessions 数据
        const sessionsKeyPattern = /secret:\/\/\{"extensionId":"codeium\.windsurf","key":"windsurf_auth\.sessions"\}/;
        const sessionsMatch = stateData.match(sessionsKeyPattern);
        
        if (sessionsMatch) {
          // 查找对应的加密数据（Buffer格式）
          const sessionsKeyIndex = stateData.indexOf('secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.sessions"}');
          let bufferMatch = null;
          
          if (sessionsKeyIndex !== -1) {
            // 从找到的位置开始查找后面的 Buffer 数据
            const afterKey = stateData.substring(sessionsKeyIndex + 200);
            const bufferPattern = /\{"type":"Buffer","data":\[([0-9,]+)\]\}/;
            bufferMatch = afterKey.match(bufferPattern);
          }
          
          if (bufferMatch) {
            try {
              // 解析 Buffer 数据
              const bufferData = JSON.parse(`{"type":"Buffer","data":[${bufferMatch[1]}]}`);
              const buffer = Buffer.from(bufferData.data);
              
              // 使用 Windsurf userData 路径，可以直接解密
              const { safeStorage } = require('electron');
              const decryptedData = safeStorage.decryptString(buffer);
              const sessions = JSON.parse(decryptedData);
              
              if (sessions && sessions.length > 0) {
                const session = sessions[0];
                apiKey = session.accessToken;
                userName = session.account?.label || session.account?.id;
                
                // 尝试从不同字段获取邮箱
                email = session.account?.email || session.email || userName;
                
                // 如果获取到的是用户名而不是邮箱，尝试从其他地方找邮箱
                if (email && !email.includes('@')) {
                  // 优先查找临时邮箱域名
                  const tempEmailMatch = stateData.match(/([a-zA-Z0-9._%+-]+@181557\.xyz)/);
                  if (tempEmailMatch) {
                    email = tempEmailMatch[1];
                  } else {
                    // 查找所有邮箱，过滤示例邮箱
                    const allEmails = stateData.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
                    if (allEmails) {
                      // 过滤掉示例邮箱
                      const realEmails = allEmails.filter(e => 
                        !e.includes('example.com') && 
                        !e.includes('test.com') && 
                        !e.includes('demo.com') &&
                        !e.includes('sample.com') &&
                        !e.includes('localhost')
                      );
                      
                      // 优先选择临时邮箱域名
                      const tempEmails = realEmails.filter(e => 
                        e.includes('181557.xyz') || 
                        e.includes('tempmail') || 
                        e.includes('10minutemail') ||
                        e.includes('guerrillamail') ||
                        e.includes('mailinator')
                      );
                      
                      email = tempEmails[0] || realEmails[0];
                    }
                  }
                }
                
                if (email) {
                  logger.success(`已登录账号: ${email}`);
                }
              }
            } catch (decryptError) {
              // 降级到正则表达式方法
              const emailMatch = stateData.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
              email = emailMatch ? emailMatch[1] : null;
            }
          }
        }
        
        if (email) {
          // 如果没有从 sessions 获取到用户名，尝试从其他地方提取
          if (!userName) {
            const nameMatch = stateData.match(/"displayName":"([^"]+)"|"name":"([^"]+)"/);
            userName = nameMatch ? (nameMatch[1] || nameMatch[2]) : null;
          }
          
          // 如果没有从 sessions 获取到 API Key，尝试从其他地方提取
          if (!apiKey) {
            const apiKeyMatch = stateData.match(/"apiKey":"([^"]+)"|"api_key":"([^"]+)"/);
            apiKey = apiKeyMatch ? (apiKeyMatch[1] || apiKeyMatch[2]) : null;
          }
          
          // 获取积分信息
          let usedPromptCredits = 0;
          let monthlyPromptCredits = 500;
          let usedFlowCredits = 0;
          let monthlyFlowCredits = 1500;
          let accountType = 'Free';
          let isPro = false;
          
          // 尝试获取最新积分信息
          let firebaseTokenObtained = false;
          try {
            // 读取保存的账号信息
            const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
            logger.info('获取最新积分');
            
            const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
            const accounts = JSON.parse(accountsData);
            
            // 找到当前登录的账号（匹配邮箱）
            const currentAccount = accounts.find(acc => acc.email === email);
            
            if (currentAccount && currentAccount.password) {
              const { loginWithEmailPassword } = require('../../shared/lib/firebase-auth');
              const loginResult = await loginWithEmailPassword(currentAccount.email, currentAccount.password);
              
              if (loginResult.success) {
                const firebaseToken = loginResult.idToken;
                
                // 使用Firebase ID Token调用Windsurf API
                const { getCurrentUser } = require('../../shared/lib/windsurf-api');
                const apiResult = await getCurrentUser(firebaseToken);
                
                if (apiResult.success && apiResult.usage) {
                  usedPromptCredits = apiResult.usage.displayPromptUsed || 0;
                  monthlyPromptCredits = apiResult.usage.displayPromptLimit || 500;
                  usedFlowCredits = apiResult.usage.displayFlowUsed || 0;
                  monthlyFlowCredits = apiResult.usage.displayFlowLimit || 1500;
                  isPro = apiResult.isPro || false;
                  firebaseTokenObtained = true;
                  
                  logger.success(`积分: ${usedPromptCredits}/${monthlyPromptCredits}`);
                } else {
                  throw new Error(apiResult.error || '解析响应失败');
                }
              } else {
                throw new Error('登录失败: ' + loginResult.error);
              }
            } else {
              throw new Error('未找到账号信息');
            }
          } catch (e) {
            // 降级：尝试使用其他方法
            if (apiKey && !firebaseTokenObtained) {
              try {
                const { getCurrentUser } = require('../../shared/lib/windsurf-api');
                const apiResult = await getCurrentUser(apiKey);
                
                if (apiResult.success && apiResult.usage) {
                  usedPromptCredits = apiResult.usage.displayPromptUsed || 0;
                  monthlyPromptCredits = apiResult.usage.displayPromptLimit || 500;
                  usedFlowCredits = apiResult.usage.displayFlowUsed || 0;
                  monthlyFlowCredits = apiResult.usage.displayFlowLimit || 1500;
                  isPro = apiResult.isPro || false;
                  
                  logger.success(`积分: ${usedPromptCredits}/${monthlyPromptCredits}`);
                } else {
                  throw new Error(apiResult.error || '解析响应失败');
                }
              } catch (e2) {
                throw e2;
              }
            } else {
              throw e;
            }
          }
          
          // 如果API调用失败，使用缓存数据
          if (!firebaseTokenObtained && usedPromptCredits === 0 && monthlyPromptCredits === 500) {
            const credits = extractCreditsFromState(stateData);
            usedPromptCredits = credits.usedPrompt;
            monthlyPromptCredits = credits.monthlyPrompt;
            usedFlowCredits = credits.usedFlow;
            monthlyFlowCredits = credits.monthlyFlow;
            logger.info('使用缓存数据');
          }
          
          // 判断账号类型
          const accountInfo = getAccountType(monthlyPromptCredits);
          accountType = accountInfo.type;
          isPro = accountInfo.isPro;
          
          // 获取账号创建时间
          let createdAt = null;
          try {
            const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
            const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
            const accounts = JSON.parse(accountsData);
            const localAccount = accounts.find(acc => acc.email === email);
            if (localAccount?.createdAt) {
              createdAt = localAccount.createdAt;
              // 静默获取创建时间
            }
          } catch (e) {
            // 静默处理，创建时间不是必需的
          }
          
          // 创建账号信息
          currentAccount = {
            email: email,
            name: userName || email.split('@')[0],
            isPro: isPro,
            accountType: accountType,
            apiKey: apiKey,
            usedPromptCredits: usedPromptCredits,
            monthlyPromptCredits: monthlyPromptCredits,
            usedFlowCredits: usedFlowCredits,
            monthlyFlowCredits: monthlyFlowCredits,
            createdAt: createdAt
          };
          
          logger.success(`${accountType} 账号已就绪`);
        }
      } catch (e) {
        logger.error('读取账号信息失败', e.message);
      }
      
      return {
        success: true,
        windsurfPath: windsurfPath || '未检测到',
        extensionVersion: '1.48.2',
        softwareVersion: '1.12.28',
        machineId: machineId,
        currentAccount: currentAccount
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

  // 注意：get-current-account-info 功能已合并到 get-windsurf-info 中

  // 重置机器码
  ipcMain.handle('reset-machine-id', async () => {
    try {
      const storagePath = path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'storage.json');
      const backupPath = path.join(app.getPath('userData'), 'storage_backup.json');
      
      // 先备份当前的 storage.json
      try {
        await fs.access(storagePath);
        await fs.copyFile(storagePath, backupPath);
        // 静默备份
      } catch (e) {
        // 静默处理备份失败
      }
      
      // 生成新的机器码
      const machineId = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
      const macMachineId = crypto.createHash('sha512').update(crypto.randomBytes(64)).digest('hex');
      const devDeviceId = uuidv4();
      const sqmId = '{' + uuidv4().toUpperCase() + '}';
      
      // 读取并更新storage.json
      let storage = {};
      
      try {
        const data = await fs.readFile(storagePath, 'utf-8');
        storage = JSON.parse(data);
      } catch (e) {
        // 文件不存在，创建新的
      }
      
      storage['telemetry.machineId'] = machineId;
      storage['telemetry.macMachineId'] = macMachineId;
      storage['telemetry.devDeviceId'] = devDeviceId;
      storage['telemetry.sqmId'] = sqmId;
      
      await fs.writeFile(storagePath, JSON.stringify(storage, null, 2));
      
      // 同时修改注册表（需要管理员权限）
      try {
        const newGuid = uuidv4();
        // 使用chcp 65001设置UTF-8编码，避免中文乱码
        await execPromise(`chcp 65001 > nul && reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid /t REG_SZ /d "${newGuid}" /f`);
      } catch (e) {
        // 忽略注册表错误（需要管理员权限）
        // 静默处理注册表修改失败
      }
      
      return {
        success: true,
        machineId: machineId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

  // 恢复机器码文件
  ipcMain.handle('restore-machine-file', async () => {
    try {
      const storagePath = path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'storage.json');
      const backupPath = path.join(app.getPath('userData'), 'storage_backup.json');
      
      try {
        await fs.access(backupPath);
        await fs.copyFile(backupPath, storagePath);
        return { success: true };
      } catch (e) {
        return {
          success: false,
          error: '未找到备份文件'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });

  // 获取指定账号的详细信息（通过Firebase登录）
  ipcMain.handle('get-account-details', async (event, email, password) => {
    try {
      if (!password) {
        return {
          success: false,
          error: '密码未保存，无法获取详情'
        };
      }
      
      // 1. Firebase登录
      const { loginWithEmailPassword } = require('../../shared/lib/firebase-auth');
      const loginResult = await loginWithEmailPassword(email, password);
      
      if (!loginResult.success) {
        return {
          success: false,
          error: '登录失败: ' + loginResult.error
        };
      }
      
      // 2. 调用Windsurf API获取用户完整信息（包含API Key和积分）
      const { getUserFullInfo } = require('../../shared/lib/windsurf-api');
      const apiResult = await getUserFullInfo(loginResult.idToken);
      
      if (!apiResult.success) {
        console.error('❌ API调用失败:', apiResult.error);
        return {
          success: false,
          error: `API调用失败: ${apiResult.error || '未知错误'}`
        };
      }
      
      // 3. 解析并返回数据
      const user = apiResult.user || {};
      const subscription = apiResult.subscription || {};
      const usage = apiResult.usage || {};
      const team = apiResult.team || {};
      
      // 使用官网显示格式的积分值（已经除以100）
      // usage对象包含原始值和显示值两种格式
      const displayUsedPrompt = usage?.displayPromptUsed ?? 0;
      const displayUsedFlow = usage?.displayFlowUsed ?? 0;
      const displayLimitPrompt = usage?.displayPromptLimit ?? 500;
      const displayLimitFlow = usage?.displayFlowLimit ?? 1500;
      const displayUsedTotal = usage?.displayUsed ?? (displayUsedPrompt + displayUsedFlow);
      const displayLimitTotal = usage?.displayLimit ?? (displayLimitPrompt + displayLimitFlow);
      
      return {
        success: true,
        data: {
          email: user.email || email,
          name: user.name || user.displayName || email.split('@')[0],
          userId: user.localId || user.uid,
          isPro: apiResult.isPro || false,
          subscriptionType: subscription.type || 'FREE',
          teamName: team?.name,
          // API Key（来自 RegisterUser API）
          apiKey: apiResult.apiKey || null,
          serverUrl: apiResult.serverUrl || null,
          // 使用官网显示格式的积分值
          usedPoints: displayUsedTotal,
          maxPoints: displayLimitTotal,
          remainingPoints: displayLimitTotal - displayUsedTotal,
          usedPromptCredits: displayUsedPrompt,
          usedFlowCredits: displayUsedFlow,
          monthlyPromptCredits: displayLimitPrompt,
          monthlyFlowCredits: displayLimitFlow,
          // 原始API值（用于调试）
          rawUsedPromptCredits: usage?.promptUsed,
          rawUsedFlowCredits: usage?.flowUsed,
          rawMonthlyPromptCredits: usage?.promptLimit,
          rawMonthlyFlowCredits: usage?.flowLimit
        }
      };
    } catch (error) {
      console.error('获取账号详情失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });
}

module.exports = { registerHomeIPC };
