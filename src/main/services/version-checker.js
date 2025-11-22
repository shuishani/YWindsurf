const { dialog, shell } = require('electron');
const axios = require('axios');
const { logger } = require('../utils/logger');

class VersionChecker {
  constructor() {
    this.currentVersion = require('../../../package.json').version;
    
    // 默认配置（远程配置优先）
    this.contactQQ = '1815578857';
    this.updateMessage = '检测到新版本，必须更新后才能继续使用！';
  }

  /**
   * 检查是否有新版本（远程强制更新模式）
   */
  async checkForUpdates(showNoUpdateDialog = false) {
    try {
      logger.info('检查更新中...');
      
      // 远程检查 - 使用多个备用地址确保国内外都能访问
      const remoteCheckUrls = [
        'https://gitee.com/shuishangitee/windsurf-control/raw/master/version-control.json', // 尝试 master 分支
        'https://gitee.com/shuishangitee/windsurf-control/raw/main/version-control.json' // 备用 main 分支
      ];
      
      let remoteConfig = null;
      let lastError = null;
      
      // 依次尝试多个地址
      for (let i = 0; i < remoteCheckUrls.length; i++) {
        const url = remoteCheckUrls[i];
        try {
          const response = await axios.get(url, {
            timeout: 3000, // 减少到3秒超时
            headers: {
              'User-Agent': 'YWindsurf-UpdateChecker',
              'Cache-Control': 'no-cache'
            }
          });
          remoteConfig = response.data;
          break; // 成功获取，跳出循环
          
        } catch (error) {
          lastError = error;
          
          // 如果不是最后一个地址，继续尝试下一个
          if (i < remoteCheckUrls.length - 1) {
            continue;
          }
        }
      }
      
      // 如果所有地址都失败了
      if (!remoteConfig) {
        throw lastError || new Error('所有远程地址都无法访问');
      }
      
      // 检查是否强制停用
      if (remoteConfig.forceStop) {
        logger.warning('检测到远程强制停用');
        this.showForceStopDialog(remoteConfig.stopMessage || '软件已停用，请联系作者获取最新版本');
        return true;
      }
      
      // 检查版本更新
      if (this.isNewerVersion(remoteConfig.latestVersion, this.currentVersion)) {
        logger.warning(`发现新版本: ${remoteConfig.latestVersion} (当前: ${this.currentVersion})`);
        
        if (remoteConfig.forceUpdate) {
          logger.warning('需要强制更新');
          this.showForceUpdateDialog(remoteConfig.latestVersion);
          return true;
        } else {
          this.showUpdateDialog(remoteConfig.latestVersion);
          return true;
        }
      }
      
      logger.success('当前已是最新版本');
      if (showNoUpdateDialog) {
        this.showNoUpdateDialog();
      }
      return false;
      
    } catch (error) {
      logger.error('网络连接失败', `错误详情: ${error.message}`);
      logger.error('错误代码', error.code || '未知');
      
      // 网络失败时强制退出，不允许使用
      this.showNetworkFailAndExit(error);
      return true;
    }
  }

  /**
   * 比较版本号
   */
  isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    return false;
  }

  /**
   * 显示网络失败并直接退出
   */
  async showNetworkFailAndExit(error) {
    let errorDetail = '软件需要联网验证才能使用';
    
    // 根据错误类型提供更具体的信息
    if (error.code === 'ENOTFOUND') {
      errorDetail = '无法解析域名，请检查网络连接';
    } else if (error.code === 'ECONNREFUSED') {
      errorDetail = '连接被拒绝，请检查防火墙设置';
    } else if (error.code === 'ETIMEDOUT') {
      errorDetail = '连接超时，请检查网络连接';
    } else if (error.message.includes('certificate')) {
      errorDetail = 'SSL证书验证失败，请检查系统时间';
    }

    await this.showCustomDialog({
      title: '网络连接失败',
      content: `${errorDetail}\n\n软件需要联网验证才能使用\n\n请检查网络连接后重新启动软件`,
      confirmText: '确定',
      showCancel: false
    });
    
    // 直接退出程序
    setTimeout(() => {
      const { app } = require('electron');
      app.quit();
    }, 500);
  }

  /**
   * 使用现有的弹窗样式显示对话框
   */
  showCustomDialog(config) {
    const { BrowserWindow } = require('electron');
    const path = require('path');
    
    const dialogWindow = new BrowserWindow({
      width: 450,
      height: 300,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      center: true,
      frame: false,
      transparent: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // 使用与您软件中删除确认弹窗相同的样式
    const dialogHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
                background: rgba(0,0,0,0.5);
                height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .dialog {
                background: white;
                border-radius: 12px;
                padding: 24px;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            .dialog-header {
                margin-bottom: 20px;
            }
            .dialog-title {
                margin: 0 0 12px 0;
                color: #1d1d1f;
                font-size: 18px;
                font-weight: 600;
            }
            .dialog-message {
                margin: 0;
                color: #424245;
                line-height: 1.5;
                white-space: pre-line;
            }
            .dialog-buttons {
                display: flex;
                gap: 12px;
            }
            .dialog-btn {
                flex: 1;
                padding: 10px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
            }
            .btn-cancel {
                background: #f5f5f7;
                color: #1d1d1f;
            }
            .btn-confirm {
                background: #007aff;
                color: white;
            }
        </style>
    </head>
    <body>
        <div class="dialog">
            <div class="dialog-header">
                <h3 class="dialog-title">${config.title}</h3>
                <p class="dialog-message">${config.content}</p>
            </div>
            <div class="dialog-buttons">
                ${config.showCancel ? '<button class="dialog-btn btn-cancel" onclick="handleCancel()">取消</button>' : ''}
                <button class="dialog-btn btn-confirm" onclick="handleConfirm()">${config.confirmText}</button>
            </div>
        </div>
        
        <script>
            const { ipcRenderer } = require('electron');
            
            function handleConfirm() {
                ipcRenderer.send('dialog-result', 'confirm');
            }
            
            function handleCancel() {
                ipcRenderer.send('dialog-result', 'cancel');
            }
        </script>
    </body>
    </html>`;

    dialogWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(dialogHtml));
    
    return new Promise((resolve) => {
      const { ipcMain } = require('electron');
      ipcMain.once('dialog-result', (event, result) => {
        dialogWindow.close();
        resolve(result);
      });
    });
  }

  /**
   * 显示强制更新对话框
   */
  async showForceUpdateDialog(newVersion) {
    await this.showCustomDialog({
      title: '发现新版本',
      content: `检测到新版本，需要更新后才能继续使用。\n\n当前版本：v${this.currentVersion}\n最新版本：v${newVersion}\n\n获取更新请联系：QQ ${this.contactQQ}`,
      confirmText: '确定',
      showCancel: false
    });
    
    // 点击确定后退出程序
    setTimeout(() => {
      const { app } = require('electron');
      app.quit();
    }, 500);
  }

  /**
   * 显示强制停用对话框
   */
  showForceStopDialog(message) {
    const result = dialog.showMessageBoxSync(null, {
      type: 'error',
      title: '软件已停用',
      message: '软件已被远程停用',
      detail: `${message}\n\n请联系QQ: ${this.contactQQ} 获取最新版本`,
      buttons: ['联系QQ', '退出程序'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (result === 0) {
      this.openQQContact();
    }
    
    // 强制退出程序
    setTimeout(() => {
      const { app } = require('electron');
      app.quit();
    }, 1000);
  }


  /**
   * 显示普通更新对话框
   */
  showUpdateDialog(newVersion) {
    const result = dialog.showMessageBoxSync(null, {
      type: 'info',
      title: '发现新版本',
      message: `YWindsurf 账号管理工具有新版本可用！`,
      detail: `当前版本: ${this.currentVersion}\n最新版本: ${newVersion}\n\n请联系QQ: ${this.contactQQ} 获取最新版本`,
      buttons: ['联系QQ获取更新', '稍后提醒', '忽略此版本'],
      defaultId: 0,
      cancelId: 1,
      icon: null
    });

    switch (result) {
      case 0: // 联系QQ
        this.openQQContact();
        break;
      case 1: // 稍后提醒
        logger.info('用户选择稍后提醒');
        break;
      case 2: // 忽略版本
        logger.info(`用户选择忽略版本 ${newVersion}`);
        this.setIgnoredVersion(newVersion);
        break;
    }
  }

  /**
   * 显示无更新对话框
   */
  showNoUpdateDialog() {
    dialog.showMessageBoxSync(null, {
      type: 'info',
      title: '检查更新',
      message: '当前已是最新版本',
      detail: `当前版本: ${this.currentVersion}\n\n如有问题可联系QQ: ${this.contactQQ}`,
      buttons: ['确定', '联系作者'],
      defaultId: 0
    });
  }

  /**
   * 显示联系对话框（当API失败时）
   */
  showContactDialog() {
    const result = dialog.showMessageBoxSync(null, {
      type: 'warning',
      title: '无法检查更新',
      message: '无法连接到更新服务器',
      detail: `请联系QQ: ${this.contactQQ} 获取最新版本信息`,
      buttons: ['联系QQ', '确定'],
      defaultId: 0
    });

    if (result === 0) {
      this.openQQContact();
    }
  }

  /**
   * 打开QQ联系
   */
  openQQContact() {
    const qqUrl = `tencent://message/?uin=${this.contactQQ}&Site=&Menu=yes`;
    shell.openExternal(qqUrl).catch(() => {
      // 如果无法打开QQ，复制QQ号到剪贴板
      const { clipboard } = require('electron');
      clipboard.writeText(this.contactQQ);
      
      dialog.showMessageBoxSync(null, {
        type: 'info',
        title: 'QQ联系方式',
        message: 'QQ号已复制到剪贴板',
        detail: `QQ: ${this.contactQQ}\n\n请手动添加QQ好友获取更新`,
        buttons: ['确定']
      });
    });
  }

  /**
   * 设置忽略的版本
   */
  setIgnoredVersion(version) {
    // 可以保存到本地配置文件
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');
    
    try {
      const configPath = path.join(app.getPath('userData'), 'update-config.json');
      const config = { ignoredVersion: version };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.error('保存忽略版本失败', error.message);
    }
  }

  /**
   * 获取忽略的版本
   */
  getIgnoredVersion() {
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');
    
    try {
      const configPath = path.join(app.getPath('userData'), 'update-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return config.ignoredVersion;
      }
    } catch (error) {
      logger.error('读取忽略版本失败', error.message);
    }
    return null;
  }

  /**
   * 自动检查更新（应用启动时）
   */
  async autoCheckForUpdates() {
    // 立即开始检查，不延迟
    return await this.checkForUpdates(false);
  }
}

module.exports = VersionChecker;
