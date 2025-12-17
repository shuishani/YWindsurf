const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { createTaggedLogger } = require('../utils/logger');

/**
 * Windsurf 账号切换器
 * 实现完全自动的账号切换功能，无需浏览器操作
 */
class AccountSwitcher {
  constructor(logCallback = null, ipcCallback = null, progressCallback = null) {
    this.logCallback = logCallback;
    this.ipcCallback = ipcCallback; // 用于发送实时日志到前端
    this.progressCallback = progressCallback; // 用于发送进度更新
    this.appData = process.env.APPDATA;
    
    // 创建带标签的日志实例 - 简洁明了
    this.logger = createTaggedLogger('切号');
    
    // Windsurf 用户数据路径 - 始终使用 %APPDATA%\Windsurf
    // 注意：这是 Windsurf 的用户数据目录，与自定义安装路径无关
    this.windsurfUserDataPath = path.join(process.env.APPDATA, 'Windsurf');
    this.stateDbPath = path.join(this.windsurfUserDataPath, 'User', 'globalStorage', 'state.vscdb');
    this.sessionsKey = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.sessions"}';
  }


  /**
   * 发送进度更新到前端
   */
  sendProgress(current, total, status) {
    if (this.progressCallback) {
      this.progressCallback({ current, total, status });
    }
  }

  /**
   * 生成 UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 使用 Windsurf 的 Local State 密钥进行加密
   * 注意：应用启动时已经同步了 Local State 文件，所以直接使用 safeStorage 即可
   */
  async encryptWithWindsurfKey(sessionsData) {
    const { safeStorage } = require('electron');
    
    try {
      // 直接使用 safeStorage 加密（启动时已同步密钥）
      const sessionsJson = JSON.stringify(sessionsData);
      const encryptedBuffer = safeStorage.encryptString(sessionsJson);
      
      return encryptedBuffer;
      
    } catch (error) {
      this.logger.error('账号数据加密失败', error.message);
      throw new Error('账号数据加密失败: ' + error.message);
    }
  }

  /**
   * 加密 sessions 数据
   */
  async encryptSessionsData(sessionsData) {
    
    const encryptedBuffer = await this.encryptWithWindsurfKey(sessionsData);
    
    return encryptedBuffer;
  }

  /**
   * 构建 sessions 数据
   */
  buildSessionsData(accountDetails) {
    const sessionId = this.generateUUID();
    
    // 按照 demo 的正确格式构建 sessions 数据
    const sessionsData = [{
      id: sessionId,
      accessToken: accountDetails.apiKey,  // API Key
      account: {
        label: accountDetails.name,  // 用户名，不是邮箱
        id: accountDetails.name      // 用户名，不是邮箱
      },
      scopes: []
    }];

    return sessionsData;
  }

  /**
   * 写入 sessions 数据到数据库 - 简单替换方式
   */
  async writeSessionsToDatabase(encryptedBuffer) {
    try {
      // 检查数据库文件是否存在
      try {
        await fs.access(this.stateDbPath);
      } catch (error) {
        throw new Error('请先启动 Windsurf 再进行切号');
      }

      // 等待文件释放（减少等待时间）
      await new Promise(resolve => setTimeout(resolve, 500)); // 从1秒减少到0.5秒

      // 直接修改数据库中的 sessions 数据
      const Database = require('better-sqlite3');
      const db = new Database(this.stateDbPath);
      
      try {
        // 设置更快的同步模式
        db.pragma('synchronous = NORMAL'); // 从FULL改为NORMAL，提高速度
        db.pragma('journal_mode = WAL'); // 使用WAL模式提高并发性能
        
        // 使用事务提高性能
        const transaction = db.transaction(() => {
          // 删除旧的 sessions 数据
          const deleteStmt = db.prepare('DELETE FROM ItemTable WHERE key = ?');
          deleteStmt.run(this.sessionsKey);

          // 插入新的 sessions 数据 - 按照 demo 的 JSON 格式存储
          const sessionsValue = JSON.stringify({
            type: "Buffer",
            data: Array.from(encryptedBuffer)
          });

          const insertStmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
          insertStmt.run(this.sessionsKey, sessionsValue);
        });
        
        transaction(); // 执行事务
        
        return { success: true };

      } finally {
        db.close();
      }

    } catch (error) {
      this.logger.error('保存账号配置失败', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 清理 Windsurf 账号相关缓存
   */
  async clearWindsurfCache() {
    try {
      // 只清理账号相关的缓存文件
      const accountCacheFiles = [
        // 账号会话缓存
        path.join(this.windsurfUserDataPath, 'User', 'globalStorage', 'storage.json.backup'),
        // 用户认证缓存
        path.join(this.windsurfUserDataPath, 'User', 'globalStorage', 'state.vscdb.backup'),
      ];

      let clearedCount = 0;
      
      for (const cachePath of accountCacheFiles) {
        try {
          await fs.unlink(cachePath);
          clearedCount++;
        } catch (error) {
          // 文件不存在，忽略
        }
      }

      // 清理 localStorage 中的账号相关数据
      try {
        const localStoragePath = path.join(this.windsurfUserDataPath, 'Local Storage');
        const levelDbPath = path.join(localStoragePath, 'leveldb');
        
        if (await fs.access(levelDbPath).then(() => true).catch(() => false)) {
          // 只删除 leveldb 中的账号相关缓存，保留其他设置
          const files = await fs.readdir(levelDbPath);
          for (const file of files) {
            if (file.includes('auth') || file.includes('session') || file.includes('user')) {
              await fs.unlink(path.join(levelDbPath, file));
              clearedCount++;
            }
          }
        }
      } catch (error) {
        // 忽略错误
      }

      // 静默清理，不输出日志
      
    } catch (error) {
      this.logger.warning('清理账号缓存时出错，但不影响切号: ' + error.message);
    }
  }

  /**
   * 验证切号结果
   */
  async verifyAccountSwitch() {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(this.stateDbPath);
      
      try {
        const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
        const result = stmt.get(this.sessionsKey);
        return { success: !!(result && result.value) };
      } finally {
        db.close();
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 主切号函数 - 完全自动切号
   * 支持三种方式（按优先级）：
   * 1. 使用缓存的 apiKey（最快）
   * 2. 使用 refreshToken 获取（无需密码）
   * 3. 使用密码登录获取（兜底）
   * 
   * @param {string} email - 邮箱
   * @param {string} password - 密码（可选）
   * @param {Object} options - 可选参数
   * @param {string} options.refreshToken - RefreshToken
   * @param {string} options.apiKey - 缓存的 API Key
   * @param {string} options.name - 缓存的用户名
   */
  async switchAccountAdvanced(email, password, options = {}) {
    try {
      this.logger.start('开始切换账号');
      
      const { getAccountCredits, getAccountCreditsByRefreshToken } = require('../../shared/lib/windsurf-api');
      let accountDetails = null;
      let newRefreshToken = null;
      
      // 方式1: 使用 refreshToken 获取（优先，可验证账号有效性）
      if (options.refreshToken) {
        const tokenResult = await getAccountCreditsByRefreshToken(
          options.refreshToken,
          email,
          password || null
        );
        if (tokenResult.success) {
          accountDetails = tokenResult.data;
          if (!accountDetails.email) {
            accountDetails.email = email;
          }
          newRefreshToken = tokenResult.newRefreshToken;
        }
      }
      
      // 方式2: 使用密码登录（当 refreshToken 失效时）
      if (!accountDetails && password) {
        const creditsResult = await getAccountCredits(email, password);
        if (creditsResult.success) {
          accountDetails = creditsResult.data;
          if (!accountDetails.email) {
            accountDetails.email = email;
          }
          newRefreshToken = creditsResult.refreshToken;
        } else {
          throw new Error('账号验证失败');
        }
      }
      
      // 方式3: 使用缓存的 apiKey（仅当没有 refreshToken 和密码时的兜底）
      if (!accountDetails && options.apiKey && options.name) {
        accountDetails = {
          email: email,
          name: options.name,
          apiKey: options.apiKey
        };
      }
      
      // 检查是否获取到账号信息
      if (!accountDetails || !accountDetails.apiKey) {
        throw new Error('账号已失效，请刷新账号');
      }
      
      // 步骤2-3: 构建和加密数据（内部完成）
      const sessionsData = this.buildSessionsData(accountDetails);
      const encryptedBuffer = await this.encryptSessionsData(sessionsData);
      
      this.sendProgress(2, 6, '获取账号信息');
      this.logger.success('获取账号信息: ' + email);

      // 关闭 Windsurf
      this.sendProgress(3, 6, '关闭 Windsurf...');
      const WindsurfManagerFactory = require('./windsurf-factory');
      // 传入'切号'标签,统一日志标签
      const manager = WindsurfManagerFactory.create(null, '切号');
      
      // 只关闭 Windsurf，不删除数据库
      const closeResult = await manager.closeWindsurf();
      if (!closeResult) {
        this.logger.warning('关闭 Windsurf 失败，但继续执行');
      }

      // 等待进程完全关闭
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 保存账号配置
      this.sendProgress(4, 6, '保存配置...');
      const writeResult = await this.writeSessionsToDatabase(encryptedBuffer);
      if (!writeResult.success) {
        throw new Error('保存账号配置失败: ' + writeResult.error);
      }

      // 清理缓存文件
      await this.clearWindsurfCache();
      await this.verifyAccountSwitch(); // 静默验证，不影响主流程

      // 等待配置生效
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 启动 Windsurf
      this.sendProgress(5, 6, '启动 Windsurf...');
      try {
        const startResult = await manager.startWindsurf();
        if (!startResult) {
          this.logger.warning('Windsurf 启动失败，请手动启动');
        }
      } catch (error) {
        this.logger.warning('Windsurf 启动失败，请手动启动');
      }

      this.sendProgress(6, 6, '完成');
      this.logger.complete('切号完成: ' + accountDetails.email);

      return {
        success: true,
        message: '切号完成！Windsurf 已自动启动',
        needsRestart: false,
        windsurfStarted: true,
        account: {
          email: accountDetails.email,
          name: accountDetails.name
        },
        newRefreshToken: newRefreshToken,
        apiKey: accountDetails.apiKey,
        name: accountDetails.name
      };

    } catch (error) {
      this.sendProgress(0, 6, '失败');
      this.logger.error('切号失败: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = AccountSwitcher;
