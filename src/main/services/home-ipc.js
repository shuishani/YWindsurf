const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const util = require('util');
const exec = require('child_process').exec;
const execPromise = util.promisify(exec);
const { createTaggedLogger } = require('../utils/logger');

// 创建空标签的日志实例
const logger = createTaggedLogger('');

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
      // 使用统一的路径配置获取Windsurf安装路径
      let windsurfPath = '';
      try {
        const windsurfPaths = require('../../shared/config/windsurf-paths');
        const installDir = windsurfPaths.getInstallDir();
        
        if (installDir) {
          // 显示路径，并标注是否为自定义路径
          if (windsurfPaths.isUsingCustomPath()) {
            windsurfPath = `${installDir} (自定义)`;
          } else {
            windsurfPath = `${installDir} (自动检测)`;
          }
        } else {
          windsurfPath = '未检测到 - 请点击"手动选择"指定路径';
        }
      } catch (error) {
        windsurfPath = '检测失败';
      }
      
      // 读取storage.json获取机器码
      let machineId = '-';
      try {
        const windsurfPaths = require('../../shared/config/windsurf-paths');
        const storagePath = path.join(windsurfPaths.getDataDir(), 'User', 'globalStorage', 'storage.json');
        const storageData = await fs.readFile(storagePath, 'utf-8');
        const storage = JSON.parse(storageData);
        machineId = storage['telemetry.machineId'] || '-';
      } catch (e) {
        // 静默处理机器码读取失败
      }
      
      // 获取当前登录账号信息
      let currentAccount = null;
      try {
        const windsurfPaths = require('../../shared/config/windsurf-paths');
        const stateDbPath = path.join(windsurfPaths.getDataDir(), 'User', 'globalStorage', 'state.vscdb');
        logger.info('获取账号信息');
        const stateData = await fs.readFile(stateDbPath, 'utf-8');
        
        // 从加密的 sessions 数据中获取真实账号信息
        let email = null;
        let userName = null;
        let apiKey = null;
        
        // 从 windsurfAuthStatus 获取当前账户信息
        let planName = 'Free';
        try {
          const Database = require('better-sqlite3');
          const db = new Database(stateDbPath);
          
          try {
            const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
            const result = stmt.get('windsurfAuthStatus');
            if (result && result.value) {
              const authStatus = JSON.parse(result.value);
              // 添加空值检查，防止 authStatus 为 null 时报错
              if (authStatus && authStatus.email) {
                email = authStatus.email;
                userName = authStatus.name;
                apiKey = authStatus.apiKey;
                planName = authStatus.planName || 'Free'; // 直接获取计划名称
                logger.success('已登录账号: ' + email + ' (' + planName + ')');
              } else {
                logger.warning('未检测到登录账号');
              }
            }
          } finally {
            db.close();
          }
        } catch (dbError) {
          logger.warning('无法读取账户信息:', dbError.message);
        }
        
        // 如果没有获取到邮箱，可以添加备用的 sessions 解析逻辑
        if (!email || !email.includes('@')) {
          // TODO: 可在此处添加 sessions 解析作为备用方案
        }
        
        if (email) {
          
          // 获取完整积分信息
          let usedPromptCredits = 0;
          let monthlyPromptCredits = planName === 'Pro' ? 750 : 500;
          let usedFlowCredits = 0;
          let monthlyFlowCredits = planName === 'Pro' ? 1500 : 500;
          let createdAt = null;
          let expiresAt = null;
          
          try {
            // 从本地账号文件获取密码
            const windsurfPaths = require('../../shared/config/windsurf-paths');
            const ACCOUNTS_FILE = path.join(windsurfPaths.getJsonDataDir(), 'accounts.json');
            const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
            const accounts = JSON.parse(accountsData);
            const localAccount = accounts.find(acc => acc.email === email);
            
            if (localAccount?.password) {
              // 使用公共函数获取积分信息
              const { getAccountCredits } = require('../../shared/lib/windsurf-api');
              const creditsResult = await getAccountCredits(email, localAccount.password);
              
              if (creditsResult.success) {
                const data = creditsResult.data;
                usedPromptCredits = data.usedPromptCredits;
                monthlyPromptCredits = data.monthlyPromptCredits;
                usedFlowCredits = data.usedFlowCredits;
                monthlyFlowCredits = data.monthlyFlowCredits;
                createdAt = data.createdAt;
                expiresAt = data.expiresAt;
                
                logger.success(`API获取成功: ${usedPromptCredits}/${monthlyPromptCredits}`);
              } else {
                logger.warning('积分获取失败，使用默认值:', creditsResult.error);
              }
            } else {
              logger.warning(`账号 ${email} 未保存密码，使用默认值`);
              logger.info('请在账户管理页面添加密码以获取准确积分');
            }
          } catch (e) {
            logger.warning('积分获取失败，使用默认值:', e.message);
          }
          
          // 直接使用 planName 判断账号类型
          const accountType = planName;
          const isPro = planName === 'Pro';
          
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
            createdAt: createdAt,
            expiresAt: expiresAt
          };
          
          logger.success(`${accountType} 账号已就绪`);
        }
      } catch (e) {
        logger.error('读取账号信息失败', e.message);
      }
      
      // Windsurf 版本
      const windsurfVersion = '1.12.35';
      
      return {
        success: true,
        windsurfPath: windsurfPath || '未检测到',
        extensionVersion: '1.48.2',
        softwareVersion: windsurfVersion, // Windsurf 软件版本
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
      const windsurfPaths = require('../../shared/config/windsurf-paths');
      const storagePath = path.join(windsurfPaths.getDataDir(), 'User', 'globalStorage', 'storage.json');
      const backupPath = path.join(windsurfPaths.getDataDir(), 'storage_backup.json');
      
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
      const windsurfPaths = require('../../shared/config/windsurf-paths');
      const storagePath = path.join(windsurfPaths.getDataDir(), 'User', 'globalStorage', 'storage.json');
      const backupPath = path.join(windsurfPaths.getDataDir(), 'storage_backup.json');
      
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

  // 获取指定账号的详细信息（直接使用公共函数）
  ipcMain.handle('get-account-details', async (event, email, password) => {
    const { getAccountCredits } = require('../../shared/lib/windsurf-api');
    return await getAccountCredits(email, password);
  });
}

module.exports = { registerHomeIPC };
