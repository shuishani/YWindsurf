/**
 * 工具函数
 */

const { ipcRenderer } = require('electron');

// Toast 提示
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: slideIn 0.3s ease;
    border-left: 4px solid ${
      type === 'success' ? '#34c759' : 
      type === 'info' ? '#007aff' : 
      type === 'warning' ? '#ff9500' : 
      '#ff3b30'
    };
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, 2000);
}

// 计算到期时间
function calculateExpiry(createdAt, expiresAt = null) {
  // 如果有直接的到期时间，使用它
  if (expiresAt) {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiryDate - now;
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const isExpired = diffMs <= 0;  // 使用毫秒差判断是否过期
    
    
    return {
      expiryDate,
      daysLeft: isExpired ? 0 : daysLeft,
      isExpired,
      expiryText: isExpired ? '已到期' : (daysLeft < 1 ? '不到1天' : `剩余${daysLeft}天`),
      expiryColor: isExpired ? '#e74c3c' : (daysLeft <= 3 ? '#ff9500' : '#007aff')
    };
  }
  
  // 没有到期时间（免费账号或未刷新的账号）
  // 不再用 createdAt + 14天 计算，因为这可能是错误的
  return {
    expiryDate: null,
    daysLeft: null,
    isExpired: false,
    expiryText: '—',  // 显示横线表示无到期时间
    expiryColor: '#86868b'
  };
}

// 添加日志
function addLog(message, type = 'info') {
  const logContainer = document.getElementById('logContainer');
  if (!logContainer) return;
  
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  
  // 后端已经包含完整的时间戳和格式,直接显示
  logEntry.innerHTML = `<span class="log-message">${message}</span>`;
  
  // 确保新消息添加到底部
  logContainer.appendChild(logEntry);
  
  // 限制日志条数，删除最旧的
  if (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }

  // 多重保障确保滚动到底部
  const scrollToBottom = () => {
    logContainer.scrollTop = logContainer.scrollHeight;
  };
  
  // 立即滚动
  scrollToBottom();
  
  // 使用 requestAnimationFrame 再次确保滚动
  requestAnimationFrame(() => {
    scrollToBottom();
    // 双重保障，确保DOM完全更新后再滚动
    setTimeout(scrollToBottom, 10);
  });
}

/**
 * 统一的积分和PRO账号处理函数
 * @param {number} usedCredits - 已使用积分
 * @param {number} totalCredits - 总积分限额
 * @returns {Object} 包含账号类型、积分信息、颜色等的完整对象
 */
function processAccountCredits(usedCredits, totalCredits, usageUnknown = false) {
  const used = usedCredits || 0;
  const total = totalCredits || 0;
  
  // 1. 账号类型判断
  let accountType = 'Free';
  let typeClass = 'badge-type-free';
  let isPro = false;
  
  if (total >= 500) {
    accountType = 'PRO';
    typeClass = 'badge-type-pro';
    isPro = true;
  } else if (total === 100) {
    accountType = 'Trial';
    typeClass = 'badge-type-trial';
    isPro = true;
  } else if (total === 25) {
    accountType = 'Free';
    typeClass = 'badge-type-free';
    isPro = false;
  }
  
  // 2. 积分计算
  let hasCreditsData = total > 0;
  let percent = 0;
  let color = '#86868b'; // 默认灰色
  
  if (hasCreditsData && !usageUnknown) {
    percent = Math.round((used / total) * 100);
    
    // 3. 颜色计算
    if (percent >= 100) {
      color = '#ff3b30'; // 红色 - 已用完
    } else if (percent > 90) {
      color = '#ff9500'; // 橙色 - 即将用完
    } else {
      color = '#34c759'; // 绿色 - 正常
    }
  } else if (usageUnknown) {
    color = '#86868b'; // 灰色 - 使用量未知
  }
  
  return {
    // 账号类型信息
    accountType,
    typeClass,
    isPro,
    
    // 积分数据
    used,
    total,
    percent,
    hasCreditsData,
    
    // 显示信息
    color,
    usageUnknown,
    displayText: usageUnknown ? `— / ${total}` : (hasCreditsData ? `${used} / ${total}` : '- / -'),
    displayPercent: usageUnknown ? '(—)' : (hasCreditsData ? `(${percent}%)` : '(-)'),
    
    // 用于首页DOM更新的方法
    updateHomePage: function(pointsElement, percentElement, barElement) {
      if (pointsElement) {
        pointsElement.textContent = this.displayText;
        pointsElement.style.color = this.color;
      }
      if (percentElement) {
        percentElement.textContent = this.displayPercent;
      }
      if (barElement) {
        barElement.style.width = `${this.percent}%`;
        barElement.style.background = this.color;
      }
    },
    
    // 用于账号管理页面HTML生成的方法
    generateTableHTML: function() {
      if (!this.hasCreditsData) {
        return '<span style="color:#86868b">-</span>';
      }
      
      return `
        <div class="points-wrapper">
          <div class="points-text" style="color:${this.color}">${this.displayText}</div>
          <div class="points-bar-bg">
            <div class="points-bar-fill" style="width:${Math.min(this.percent, 100)}%; background:${this.color}"></div>
          </div>
        </div>
      `;
    }
  };
}

/**
 * 统一的时间格式化函数
 * @param {string|Date} date - 时间
 * @param {Object} options - 格式化选项
 * @returns {string} 格式化后的时间字符串
 */
function formatDateTime(date, options = {}) {
  if (!date) return '未知';
  
  const defaultOptions = {
    year: 'numeric', 
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options
  };
  
  return new Date(date).toLocaleString('zh-CN', defaultOptions).replace(/\//g, '-');
}

/**
 * 前端统一日志工具
 * 通过 IPC 发送到主进程统一处理
 */
const logger = {
  /**
   * 信息日志
   */
  info: (message) => {
    ipcRenderer.invoke('log-message', { message, type: 'info' });
  },
  
  /**
   * 成功日志
   */
  success: (message) => {
    ipcRenderer.invoke('log-message', { message, type: 'success' });
  },
  
  /**
   * 警告日志
   */
  warning: (message) => {
    ipcRenderer.invoke('log-message', { message, type: 'warning' });
  },
  
  /**
   * 错误日志
   */
  error: (message) => {
    ipcRenderer.invoke('log-message', { message, type: 'error' });
  },
  
  /**
   * 错误日志并显示 Toast
   */
  errorWithToast: (message, toastMsg = null) => {
    ipcRenderer.invoke('log-message', { message, type: 'error' });
    showToast(toastMsg || message, 'error');
  },
  
  /**
   * 成功日志并显示 Toast
   */
  successWithToast: (message, toastMsg = null) => {
    ipcRenderer.invoke('log-message', { message, type: 'success' });
    showToast(toastMsg || message, 'success');
  }
};

/**
 * 统一的错误处理函数
 * @param {Error} error - 错误对象
 * @param {string} context - 错误上下文
 * @param {boolean} showToastMsg - 是否显示Toast提示
 */
async function handleError(error, context, showToastMsg = false) {
  logger.error(`${context}失败: ${error.message}`);
  if (showToastMsg) {
    showToast(`${context}失败`, 'error');
  }
}

/**
 * 应用天数样式到元素
 * @param {HTMLElement} element - DOM元素
 * @param {number} days - 剩余天数
 */
function applyDaysLeftStyle(element, days) {
  if (!element) return;
  
  const style = getDaysLeftStyle(days);
  element.style.background = style.background;
  element.style.color = style.color;
  element.style.border = style.border;
}

/**
 * 生成天数样式的内联CSS字符串
 * @param {number} days - 剩余天数
 * @returns {string} CSS样式字符串
 */
function getDaysLeftStyleString(days) {
  const style = getDaysLeftStyle(days);
  return `background: ${style.background}; color: ${style.color}; border: ${style.border};`;
}

/**
 * 生成空状态HTML
 * @param {number} colspan - 列数
 * @param {string} title - 主标题
 * @param {string} subtitle - 副标题
 * @returns {string} 空状态HTML
 */
function generateEmptyStateHTML(colspan, title, subtitle) {
  return `
    <tr>
      <td colspan="${colspan}" style="text-align:center; padding:40px; color:#86868b;">
        <div style="font-size:14px; margin-bottom:8px;">${title}</div>
        <div style="font-size:12px;">${subtitle}</div>
      </td>
    </tr>
  `;
}

/**
 * 获取天数剩余的样式（内部函数）
 * @param {number} days - 剩余天数
 * @returns {Object} 样式对象
 */
function getDaysLeftStyle(days) {
  if (days >= 7) {
    return {
      background: '#d4edda',
      color: '#155724',
      border: '1px solid #c3e6cb'
    };
  } else if (days >= 3) {
    return {
      background: '#fff3cd',
      color: '#856404',
      border: '1px solid #ffeaa7'
    };
  } else if (days > 0) {
    return {
      background: '#f8d7da',
      color: '#721c24',
      border: '1px solid #f5c6cb'
    };
  } else {
    return {
      background: '#f5c6cb',
      color: '#721c24',
      border: '1px solid #dc3545'
    };
  }
}

module.exports = { 
  addLog, 
  showToast, 
  calculateExpiry, 
  processAccountCredits,
  formatDateTime,
  handleError,
  applyDaysLeftStyle,
  getDaysLeftStyleString,
  generateEmptyStateHTML,
  logger
};

// 导出到全局
const utilsModule = {
  showToast,
  calculateExpiry,
  addLog,
  processAccountCredits,
  formatDateTime,
  handleError,
  applyDaysLeftStyle,
  getDaysLeftStyleString,
  generateEmptyStateHTML,
  logger
};

Object.assign(window, utilsModule);
