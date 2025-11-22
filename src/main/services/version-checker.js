const { dialog, shell } = require('electron');
const axios = require('axios');
const { createTaggedLogger } = require('../utils/logger');

// 创建带标签的logger实例
const logger = createTaggedLogger('版本检查');

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
      
      // 远程检查 - 您可以控制这个链接的内容
      const remoteCheckUrl = 'https://raw.githubusercontent.com/1815578857/windsurf-tool/main/version-control.json';
      
      try {
        const response = await axios.get(remoteCheckUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'YWindsurf-UpdateChecker',
            'Cache-Control': 'no-cache'
          }
        });
        
        const remoteConfig = response.data;
        
        // 检查是否强制停用
        if (remoteConfig.forceStop) {
          logger.info('检测到远程强制停用');
          this.showForceStopDialog(remoteConfig.stopMessage || '软件已停用，请联系作者获取最新版本');
          return true;
        }
        
        // 检查版本更新
        if (this.isNewerVersion(remoteConfig.latestVersion, this.currentVersion)) {
          logger.info(`发现新版本: ${remoteConfig.latestVersion} (当前: ${this.currentVersion})`);
          
          if (remoteConfig.forceUpdate) {
            this.showForceUpdateDialog(remoteConfig.latestVersion);
            return true;
          } else {
            this.showUpdateDialog(remoteConfig.latestVersion);
            return true;
          }
        }
        
        logger.info('当前已是最新版本');
        if (showNoUpdateDialog) {
          this.showNoUpdateDialog();
        }
        return false;
        
      } catch (networkError) {
        logger.error('无法连接到更新服务器，软件无法使用');
        
        // 网络失败时强制联系作者，不允许离线使用
        this.showNetworkFailDialog();
        return true;
      }
      
    } catch (error) {
      logger.error('检查更新失败', error.message);
      return false;
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
   * 显示网络失败对话框
   */
  showNetworkFailDialog() {
    const result = dialog.showMessageBoxSync(null, {
      type: 'error',
      title: '网络连接失败',
      message: '软件无法使用',
      detail: `软件需要联网验证才能使用\n\n请检查您的网络连接后重试`,
      buttons: ['重试连接', '退出程序'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (result === 0) {
      // 重试连接
      setTimeout(() => {
        this.checkForUpdates(false);
      }, 3000);
      return; // 不退出，给用户重试机会
    }
    
    // 退出程序
    setTimeout(() => {
      const { app } = require('electron');
      app.quit();
    }, 1000);
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
   * 显示强制更新对话框
   */
  showForceUpdateDialog(newVersion) {
    const result = dialog.showMessageBoxSync(null, {
      type: 'warning',
      title: '必须更新',
      message: this.updateMessage,
      detail: `当前版本: ${this.currentVersion}\n最新版本: ${newVersion}\n\n请联系QQ: ${this.contactQQ} 获取最新版本\n更新后才能继续使用本软件`,
      buttons: ['联系QQ获取更新', '退出程序'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (result === 0) {
      // 联系QQ
      this.openQQContact();
    }
    
    // 无论选择什么都退出程序（强制更新）
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
    // 强制更新模式下立即检查，不延迟
    if (this.forceUpdate) {
      setTimeout(async () => {
        await this.checkForUpdates(false);
      }, 2000); // 只延迟2秒，让用户看到应用界面
    } else {
      // 普通模式延迟5秒
      setTimeout(async () => {
        await this.checkForUpdates(false);
      }, 5000);
    }
  }
}

module.exports = VersionChecker;
