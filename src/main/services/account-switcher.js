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
    
    // 使用统一的路径配置
    const windsurfPaths = require('../../shared/config/windsurf-paths');
    this.windsurfUserDataPath = windsurfPaths.getDataDir();
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

    this.logger.info(`获取数据 - 用户名: ${accountDetails.name}, API Key: ${accountDetails.apiKey ? '已获取' : '未获取'}`);
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
        
        this.logger.success('账号配置更新完成');
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

      if (clearedCount > 0) {
        this.logger.info(`已清理 ${clearedCount} 项账号缓存`);
      } else {
        this.logger.info('无需清理账号缓存');
      }
      
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
   */
  async switchAccountAdvanced(email, password) {
    try {
      this.logger.start('开始切换账号');
      this.logger.info(`目标账号: ${email}`);
      const { ipcMain } = require('electron');
      
      // 模拟调用 get-account-details
      // 使用公共函数获取账号详情
      const { getAccountCredits } = require('../../shared/lib/windsurf-api');
      const accountDetailsResult = await getAccountCredits(email, password);

      if (!accountDetailsResult.success) {
        throw new Error('获取账号详情失败: ' + accountDetailsResult.error);
      }

      const accountDetails = accountDetailsResult.data;
      
      // 步骤2-3: 构建和加密数据（内部完成）
      const sessionsData = this.buildSessionsData(accountDetails);
      const encryptedBuffer = await this.encryptSessionsData(sessionsData);
      
      this.sendProgress(2, 6, '数据准备完成');
      this.logger.success('账号数据准备完成: ' + accountDetails.email);

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
      this.logger.success('账号配置保存成功');
      await this.verifyAccountSwitch(); // 静默验证，不影响主流程

      // 等待配置生效
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 启动 Windsurf
      this.sendProgress(5, 6, '启动 Windsurf...');
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
