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
    border-left: 4px solid ${type === 'success' ? '#34c759' : '#ff3b30'};
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

// 计算到期时间（Pro试用期为13天）
function calculateExpiry(createdAt) {
  const created = new Date(createdAt);
  const now = new Date();
  const expiryDate = new Date(created);
  expiryDate.setDate(expiryDate.getDate() + 13); // 13天后到期
  
  const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
  const isExpired = daysLeft <= 0;
  
  return {
    expiryDate,
    daysLeft,
    isExpired,
    expiryText: isExpired ? '已到期' : `剩余${daysLeft}天`,
    expiryColor: isExpired ? '#e74c3c' : (daysLeft <= 3 ? '#ff9500' : '#007aff')
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

// 导出模块并暴露到全局
const utilsModule = {
  showToast,
  calculateExpiry,
  addLog
};

Object.assign(window, utilsModule);
module.exports = utilsModule;
