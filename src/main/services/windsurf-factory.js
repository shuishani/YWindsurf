/**
 * Windsurf 管理器工厂
 * Windows 专用版本
 */

const WindsurfManagerWindows = require('./windsurf');

class WindsurfManagerFactory {
  /**
   * 创建 WindsurfManager 实例
   * @param {Function} logCallback - 日志回调函数
   * @param {string} tag - 日志标签,默认'系统管理'
   * @returns {WindsurfManagerWindows}
   */
  static create(logCallback = null, tag = '系统管理') {
    // 使用统一日志系统
    const { createTaggedLogger } = require('../utils/logger');
    const logger = createTaggedLogger(tag);
    logger.debug('使用 Windows 版本管理器');
    return new WindsurfManagerWindows(logCallback, tag);
  }

  /**
   * 获取当前平台信息
   */
  static getPlatformInfo() {
    const platform = process.platform;
    const arch = process.arch;
    
    return {
      platform,
      platformName: 'Windows',
      arch,
      isSupported: platform === 'win32'
    };
  }
}

module.exports = WindsurfManagerFactory;
