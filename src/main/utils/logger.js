/**
 * 统一日志管理器
 * 提供统一、美观的日志输出格式
 * 支持注册流程和通用系统日志
 * 自动处理开发/生产环境
 */
class Logger {
  constructor(taskId = null) {
    this.taskId = taskId;
    this.startTime = Date.now();
    
    // 缓存开发模式状态，避免重复检查
    this._isDevelopment = this.checkDevelopmentMode();
  }

  /**
   * 检查是否为开发模式（只检查一次）
   */
  checkDevelopmentMode() {
    try {
      const { app } = require('electron');
      return process.env.NODE_ENV === 'development' || !app.isPackaged;
    } catch (e) {
      return process.env.NODE_ENV === 'development';
    }
  }

  /**
   * 获取开发模式状态
   */
  isDevelopment() {
    return this._isDevelopment;
  }

  /**
   * 设置任务ID
   */
  setTaskId(taskId) {
    this.taskId = taskId;
  }


  /**
   * 获取时间戳
   */
  getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 获取任务标识
   */
  getTaskPrefix() {
    return this.taskId ? `[任务${this.taskId}]` : '';
  }

  /**
   * 格式化日志消息
   */
  formatMessage(type, step, action, details = '') {
    const icons = {
      start: '🚀',
      progress: '🔄',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: '📋',
      step: '📝',
      browser: '🌐',
      email: '📧',
      password: '🔐',
      verify: '🛡️',
      code: '📬',
      complete: '🎉',
      system: '🔧',
      api: '🚀',
      account: '👤',
      file: '📁',
      database: '💾',
      network: '🌐'
    };

    const icon = icons[type] || '📋';
    const stepStr = step ? `步骤${step}: ` : '';
    const detailsStr = details ? ` - ${details}` : '';
    
    return `${icon} ${stepStr}${action}${detailsStr}`;
  }


  /**
   * 输出日志（统一入口）
   */
  log(type, step, action, details = '', tag = '') {
    const message = this.formatMessage(type, step, action, details);
    const timestamp = `[${this.getTimestamp()}] `;
    const taskPrefix = this.getTaskPrefix();
    const tagPrefix = tag ? `[${tag}]${taskPrefix} ` : (taskPrefix ? `${taskPrefix} ` : '');
    const fullMessage = `${timestamp}${tagPrefix}${message}`;
    
    // 开发模式：输出到控制台
    if (this.isDevelopment()) {
      console.log(fullMessage);
    }
    
    // 总是发送到前端显示（传递完整消息用于专用窗口）
    this.sendToRenderer(type, action, details, tag, fullMessage);
  }

  /**
   * 错误日志（统一入口）
   */
  logError(action, details = '', tag = '') {
    const message = this.formatMessage('error', null, action, details);
    const timestamp = `[${this.getTimestamp()}] `;
    const taskPrefix = this.getTaskPrefix();
    const tagPrefix = tag ? `[${tag}]${taskPrefix} ` : (taskPrefix ? `${taskPrefix} ` : '');
    const fullMessage = `${timestamp}${tagPrefix}${message}`;
    
    // 开发模式：输出到控制台
    if (this.isDevelopment()) {
      console.error(fullMessage);
    }
    
    // 发送到前端显示（传递完整消息用于专用窗口）
    this.sendToRenderer('error', action, details, tag, fullMessage);
  }

  /**
   * 发送日志到渲染进程显示
   */
  sendToRenderer(type, action, details = '', tag = '', fullMessage = '') {
    try {
      const { BrowserWindow } = require('electron');
      const mainWindow = BrowserWindow.getAllWindows()[0];
      
      if (mainWindow && mainWindow.webContents) {
        // 映射日志类型到前端类型
        const frontendType = this.mapLogType(type);
        
        // 系统日志使用完整消息(带标签)
        mainWindow.webContents.executeJavaScript(`
          if (typeof addLog === 'function') {
            addLog('${fullMessage.replace(/'/g, "\\'")}', '${frontendType}');
          }
        `).catch(() => {
          // 静默处理错误，避免在渲染进程未准备好时报错
        });
        
        // 根据标签发送到对应的专用窗口(不带标签,因为已经在专用窗口里了)
        if (tag) {
          const eventMap = {
            '批量绑卡': 'binding-log',
            '批量注册': 'registration-log',
            '切号': 'switch-log',
            '取消订阅': 'cancel-log'
          };
          
          const eventName = eventMap[tag];
          if (eventName) {
            // 直接发送完整消息，前端会处理显示格式
            mainWindow.webContents.send(eventName, {
              message: fullMessage
            });
          }
        }
      }
    } catch (e) {
      // 静默处理错误
    }
  }

  /**
   * 映射后端日志类型到前端类型
   */
  mapLogType(backendType) {
    const typeMap = {
      'success': 'success',
      'error': 'error', 
      'warning': 'error',
      'info': 'info',
      'system': 'success',
      'api': 'info',
      'account': 'success',
      'file': 'info',
      'database': 'info',
      'network': 'info'
    };
    return typeMap[backendType] || 'info';
  }

  // === 便捷方法 ===

  /**
   * 启动相关日志
   */
  start(action, details = '', tag = '') {
    this.log('start', null, action, details, tag);
  }

  /**
   * 进度相关日志
   */
  progress(action, details = '', tag = '') {
    this.log('progress', null, action, details, tag);
  }

  /**
   * 成功相关日志
   */
  success(action, details = '', tag = '') {
    this.log('success', null, action, details, tag);
  }

  /**
   * 错误相关日志（使用统一入口）
   */
  error(action, details = '', tag = '') {
    this.logError(action, details, tag);
  }

  /**
   * 警告相关日志
   */
  warning(action, details = '', tag = '') {
    this.log('warning', null, action, details, tag);
  }

  /**
   * 信息相关日志
   */
  info(action, details = '', tag = '') {
    this.log('info', null, action, details, tag);
  }

  /**
   * 步骤相关日志
   */
  step(stepNumber, action, details = '', tag = '') {
    this.log('step', stepNumber, action, details, tag);
  }

  /**
   * 浏览器相关日志
   */
  browser(action, details = '', tag = '') {
    this.log('browser', null, action, details, tag);
  }

  /**
   * 邮箱相关日志
   */
  email(action, details = '', tag = '') {
    this.log('email', null, action, details, tag);
  }

  /**
   * 密码相关日志
   */
  password(action, details = '', tag = '') {
    this.log('password', null, action, details, tag);
  }

  /**
   * 验证相关日志
   */
  verify(action, details = '', tag = '') {
    this.log('verify', null, action, details, tag);
  }

  /**
   * 验证码相关日志
   */
  code(action, details = '', tag = '') {
    this.log('code', null, action, details, tag);
  }

  /**
   * 验证码获取成功日志
   */
  codeReceived(code) {
    this.success('验证码获取成功', `验证码: ${code}`);
  }

  /**
   * 验证码输入日志
   */
  codeInput(code) {
    this.success('验证码输入完成', `已输入: ${code}`);
  }

  /**
   * 表单填写日志
   */
  formFill(field, value) {
    this.info(`填写${field}`, value);
  }

  /**
   * 简洁的步骤完成日志
   */
  stepComplete(stepNum, action, details = '') {
    const detailsStr = details ? ` (${details})` : '';
    this.success(`步骤${stepNum}完成`, `${action}${detailsStr}`);
  }

  /**
   * 验证码处理日志
   */
  codeProcess(code) {
    this.success('验证码', `${code} 已处理`);
  }

  /**
   * 按钮点击日志
   */
  buttonClick(buttonName, success = true) {
    if (success) {
      this.success(`${buttonName}点击成功`);
    } else {
      this.warning(`${buttonName}点击失败`);
    }
  }

  /**
   * 完成相关日志
   */
  complete(action, details = '', tag = '') {
    this.log('complete', null, action, details, tag);
  }

  /**
   * 用户信息日志（清爽格式）
   */
  userInfo(firstName, lastName, email, password) {
    this.success('账号信息', `${email} | ${password}`);
  }

  /**
   * 批量注册摘要日志
   */
  batchSummary(total, success, failed) {
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    const details = `总计${total}个 | 成功${success}个 | 失败${failed}个 | 成功率${successRate}%`;
    
    if (success === 0) {
      this.warning('批量注册完成，但没有成功的账号', details);
    } else if (successRate === 100) {
      this.complete('批量注册完成', details);
    } else {
      this.warning('批量注册完成，部分成功', details);
    }
  }

  /**
   * 耗时统计
   */
  duration() {
    const elapsed = Date.now() - this.startTime;
    const seconds = Math.round(elapsed / 1000);
    return `耗时${seconds}秒`;
  }

  /**
   * 任务完成日志
   */
  taskComplete(success, email = '', error = '') {
    if (success) {
      this.complete('注册成功', `${email} | ${this.duration()}`);
    } else {
      this.error('注册失败', `${error} | ${this.duration()}`);
    }
  }

  // === 通用系统日志方法 ===

  /**
   * 系统相关日志
   */
  system(action, details = '', tag = '') {
    this.log('system', null, action, details, tag);
  }

  /**
   * API相关日志
   */
  api(action, details = '', tag = '') {
    this.log('api', null, action, details, tag);
  }

  /**
   * 账号相关日志
   */
  account(action, details = '', tag = '') {
    this.log('account', null, action, details, tag);
  }

  /**
   * 文件相关日志
   */
  file(action, details = '', tag = '') {
    this.log('file', null, action, details, tag);
  }

  /**
   * 数据库相关日志
   */
  database(action, details = '', tag = '') {
    this.log('database', null, action, details, tag);
  }

  /**
   * 网络相关日志
   */
  network(action, details = '', tag = '') {
    this.log('network', null, action, details, tag);
  }

  /**
   * 简化的调试日志（仅在开发环境显示）
   */
  debug(action, details = '', tag = '') {
    if (process.env.NODE_ENV === 'development') {
      this.info(`[DEBUG] ${action}`, details, tag);
    }
  }
}

// 创建全局日志实例
const globalLogger = new Logger();

/**
 * 创建带标签的日志实例
 * @param {string} tag - 功能标签，如 '批量注册'、'批量绑卡'、'切号'
 * @returns {Object} 带标签的日志实例
 */
function createTaggedLogger(tag) {
  return {
    // 基础日志方法
    start: (action, details = '') => globalLogger.start(action, details, tag),
    progress: (action, details = '') => globalLogger.progress(action, details, tag),
    success: (action, details = '') => globalLogger.success(action, details, tag),
    error: (action, details = '') => globalLogger.error(action, details, tag),
    warning: (action, details = '') => globalLogger.warning(action, details, tag),
    info: (action, details = '') => globalLogger.info(action, details, tag),
    step: (stepNumber, action, details = '') => globalLogger.step(stepNumber, action, details, tag),
    
    // 专用日志方法（也使用标签，避免重复显示）
    browser: (action, details = '') => globalLogger.browser(action, details, tag),
    email: (action, details = '') => globalLogger.email(action, details, tag),
    password: (action, details = '') => globalLogger.password(action, details, tag),
    verify: (action, details = '') => globalLogger.verify(action, details, tag),
    code: (action, details = '') => globalLogger.code(action, details, tag),
    network: (action, details = '') => globalLogger.network(action, details, tag),
    system: (action, details = '') => globalLogger.system(action, details, tag),
    debug: (action, details = '') => globalLogger.debug(action, details, tag),
    
    // 便捷方法
    complete: (action, details = '') => globalLogger.complete(action, details, tag),
    setTaskId: (taskId) => globalLogger.setTaskId(taskId),
    
    // 特殊格式化方法
    codeReceived: (code) => globalLogger.success('验证码获取成功', `验证码: ${code}`, tag),
    codeInput: (code) => globalLogger.success('验证码输入完成', `已输入: ${code}`, tag),
    formFill: (field, value) => globalLogger.info(`填写${field}`, value, tag),
    codeProcess: (code) => globalLogger.success('验证码', `${code} 已处理`, tag),
    userInfo: (firstName, lastName, email, password) => globalLogger.success('账号信息', `${email} | ${password}`, tag),
    
    // 按钮点击
    buttonClick: (buttonName, success = true) => {
      if (success) {
        globalLogger.success(`${buttonName}点击成功`, '', tag);
      } else {
        globalLogger.warning(`${buttonName}点击失败`, '', tag);
      }
    },
    
    // 步骤完成
    stepComplete: (stepNum, action, details = '') => {
      const detailsStr = details ? ` (${details})` : '';
      globalLogger.success(`步骤${stepNum}完成`, `${action}${detailsStr}`, tag);
    },
    
    // 批量摘要
    batchSummary: (total, success, failed) => {
      const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
      const details = `总计${total}个 | 成功${success}个 | 失败${failed}个 | 成功率${successRate}%`;
      
      if (success === 0) {
        globalLogger.warning(`${tag}完成，但没有成功的账号`, details, tag);
      } else if (successRate === 100) {
        globalLogger.complete(`${tag}完成`, details, tag);
      } else {
        globalLogger.warning(`${tag}完成，部分成功`, details, tag);
      }
    },
    
    // 耗时统计
    duration: () => {
      const elapsed = Date.now() - globalLogger.startTime;
      const seconds = Math.round(elapsed / 1000);
      return `耗时${seconds}秒`;
    },
    
    // 任务完成
    taskComplete: (success, email = '', error = '') => {
      const elapsed = Date.now() - globalLogger.startTime;
      const seconds = Math.round(elapsed / 1000);
      const duration = `耗时${seconds}秒`;
      
      if (success) {
        globalLogger.complete('注册成功', `${email} | ${duration}`, tag);
      } else {
        globalLogger.error('注册失败', `${error} | ${duration}`, tag);
      }
    }
  };
}

// 导出类、全局实例和工厂方法
module.exports = { 
  Logger,
  logger: globalLogger,  // 全局日志实例
  createTaggedLogger    // 创建带标签的日志实例
};
