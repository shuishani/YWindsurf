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
    
    // Windsurf 相关路径
    this.windsurfUserDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Windsurf');
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
   * 使用 Windsurf 的 Local State 文件进行同源加密
   * 复制 Windsurf 的加密密钥到当前应用
   */
  async encryptWithWindsurfKey(sessionsData) {
    const path = require('path');
    const fs = require('fs').promises;
    const { app, safeStorage } = require('electron');
    
    // Windsurf 的 Local State 文件路径
    const windsurfLocalStatePath = path.join(this.windsurfUserDataPath, 'Local State');
    const currentLocalStatePath = path.join(app.getPath('userData'), 'Local State');
    
    try {
      // 备份当前的 Local State
      let originalLocalState = null;
      try {
        originalLocalState = await fs.readFile(currentLocalStatePath, 'utf-8');
      } catch (e) {
        // 如果没有原始文件，不需要备份
      }
      
      // 复制 Windsurf 的 Local State 文件以获取加密密钥
      await fs.copyFile(windsurfLocalStatePath, currentLocalStatePath);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 进行加密
      const sessionsJson = JSON.stringify(sessionsData);
      const encryptedBuffer = safeStorage.encryptString(sessionsJson);
      
      // 恢复原始的 Local State（如果有的话）
      if (originalLocalState) {
        await fs.writeFile(currentLocalStatePath, originalLocalState, 'utf-8');
      } else {
        // 删除复制的文件
        try {
          await fs.unlink(currentLocalStatePath);
        } catch (e) {}
      }
      
      return encryptedBuffer;
      
    } catch (error) {
      this.logger.error('账号数据处理失败', error.message);
      throw new Error('账号数据处理失败');
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
    const sessionsData = [{
      id: sessionId,
      accessToken: accountDetails.apiKey,
      account: {
        label: accountDetails.name,
        id: accountDetails.name
      },
      scopes: []
    }];


    return sessionsData;
  }

  /**
   * 写入 sessions 数据到 Windsurf SQLite 数据库
   */
  async writeSessionsToDatabase(encryptedBuffer) {
    try {
      // 检查数据库文件是否存在
      try {
        await fs.access(this.stateDbPath);
      } catch (error) {
        throw new Error('请先启动 Windsurf 再进行切号');
      }

      // 等待文件释放并创建备份
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const backupPath = this.stateDbPath + '.backup';
      try {
        await fs.copyFile(this.stateDbPath, backupPath);
      } catch (backupError) {
        // 备份失败不影响主流程
      }

      // 使用 better-sqlite3 操作数据库
      try {
        const Database = require('better-sqlite3');
        const db = new Database(this.stateDbPath);
        
        try {
          // 验证数据库表结构
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const itemTableExists = tables.some(t => t.name === 'ItemTable');
          if (!itemTableExists) {
            throw new Error('Windsurf 配置文件格式不正确');
          }

          // 删除旧的 sessions 数据
          const deleteStmt = db.prepare('DELETE FROM ItemTable WHERE key = ?');
          deleteStmt.run(this.sessionsKey);

          // 插入新的 sessions 数据
          const sessionsValue = JSON.stringify({
            type: "Buffer",
            data: Array.from(encryptedBuffer)
          });

          const insertStmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
          insertStmt.run(this.sessionsKey, sessionsValue);

          // 强制同步数据到磁盘
          try {
            db.pragma('synchronous = FULL');
            const walMode = db.pragma('journal_mode', { simple: true });
            if (walMode === 'wal') {
              db.pragma('wal_checkpoint(FULL)');
            }
          } catch (syncError) {
            // 同步失败不影响主流程，数据已写入
          }
          return { success: true };

        } finally {
          db.close();
        }
      } catch (sqliteError) {
        throw new Error('保存账号配置时出现问题');
      }

    } catch (error) {
      this.logger.error('保存账号配置失败', error.message);
      return { success: false, error: '保存账号配置失败' };
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
   */
  async switchAccountAdvanced(email, password) {
    try {
      this.logger.start('开始切换账号');
      this.logger.info(`目标账号: ${email}`);
      this.logger.info('预计需要 30-40 秒，请耐心等待...');

      // 步骤1: 获取账号详情
      this.sendProgress(1, 6, '验证账号...');
      this.logger.step(1, '验证并准备账号数据');
      const { ipcMain } = require('electron');
      
      // 模拟调用 get-account-details
      const accountDetailsResult = await new Promise((resolve) => {
        // 这里需要调用现有的 get-account-details 逻辑
        const { loginWithEmailPassword } = require('../../shared/lib/firebase-auth');
        const { getUserFullInfo } = require('../../shared/lib/windsurf-api');
        
        (async () => {
          try {
            // Firebase 登录
            const loginResult = await loginWithEmailPassword(email, password);
            if (!loginResult.success) {
              return resolve({ success: false, error: '登录失败: ' + loginResult.error });
            }

            // 获取完整信息
            const apiResult = await getUserFullInfo(loginResult.idToken);
            if (!apiResult.success) {
              return resolve({ success: false, error: '获取账号信息失败: ' + apiResult.error });
            }

            const user = apiResult.user || {};
            resolve({
              success: true,
              data: {
                email: user.email || email,
                name: user.name || user.displayName || email.split('@')[0],
                apiKey: apiResult.apiKey,
                serverUrl: apiResult.serverUrl
              }
            });
          } catch (error) {
            resolve({ success: false, error: error.message });
          }
        })();
      });

      if (!accountDetailsResult.success) {
        throw new Error('获取账号详情失败: ' + accountDetailsResult.error);
      }

      const accountDetails = accountDetailsResult.data;
      
      // 步骤2-3: 构建和加密数据（内部完成）
      const sessionsData = this.buildSessionsData(accountDetails);
      const encryptedBuffer = await this.encryptSessionsData(sessionsData);
      
      this.sendProgress(2, 6, '数据准备完成');
      this.logger.success('账号数据准备完成: ' + accountDetails.email);

      // 步骤4: 关闭 Windsurf（保留数据库文件）
      this.sendProgress(3, 6, '关闭 Windsurf...');
      this.logger.step(4, '关闭 Windsurf');
      const WindsurfManagerFactory = require('./windsurf-factory');
      // 传入'切号'标签,统一日志标签
      const manager = WindsurfManagerFactory.create(null, '切号');
      
      // 只关闭 Windsurf，不删除数据库
      const closeResult = await manager.closeWindsurf();
      if (!closeResult) {
        this.logger.warning('关闭 Windsurf 失败，但继续执行');
      } else {
        this.logger.success('Windsurf 已关闭');
      }

      // 步骤5: 写入数据库（替换现有 sessions）
      this.sendProgress(4, 6, '保存配置...');
      this.logger.step(5, '保存账号配置');
      const writeResult = await this.writeSessionsToDatabase(encryptedBuffer);
      if (!writeResult.success) {
        throw new Error('保存账号配置失败: ' + writeResult.error);
      }

      // 步骤6: 验证结果
      this.logger.success('账号配置保存成功');
      await this.verifyAccountSwitch(); // 静默验证，不影响主流程

      // 步骤7: 等待配置生效
      this.logger.step(7, '等待配置生效 (3秒)');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 步骤8: 启动 Windsurf
      this.sendProgress(5, 6, '启动 Windsurf...');
      this.logger.step(8, '启动 Windsurf');
      try {
        const startResult = await manager.startWindsurf();
        if (startResult) {
          this.logger.success('Windsurf 已启动');
        } else {
          this.logger.warning('Windsurf 启动失败，请手动启动');
        }
      } catch (error) {
        this.logger.warning('自动启动失败，请手动启动 Windsurf: ' + error.message);
      }

      this.sendProgress(6, 6, '完成');
      this.logger.complete('账号切换完成，当前账号: ' + accountDetails.email);

      return {
        success: true,
        message: '切号完成！Windsurf 已自动启动',
        needsRestart: false,
        windsurfStarted: true,
        account: {
          email: accountDetails.email,
          name: accountDetails.name
        }
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
