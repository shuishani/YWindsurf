/**
 * 首页模块
 */

const { ipcRenderer } = require('electron');
const { showToast, formatDateTime, handleError, applyDaysLeftStyle, getDaysLeftStyleString, processAccountCredits, addLog } = require('../utils/utils');

// 刷新系统信息
async function refreshSystemInfo(showNotification = false) {
  try {
    const info = await ipcRenderer.invoke('get-system-info');
    
    // 更新系统信息
    const windsurfPath = document.getElementById('windsurfPath');
    const extensionVersion = document.getElementById('extensionVersion');
    const softwareVersion = document.getElementById('softwareVersion');
    const machineId = document.getElementById('machineId');
    
    if (windsurfPath) windsurfPath.textContent = info.windsurfPath || '未检测到';
    if (extensionVersion) extensionVersion.textContent = info.extensionVersion || '-';
    if (softwareVersion) softwareVersion.textContent = info.softwareVersion || '-';
    if (machineId) machineId.textContent = info.machineId || '-';
    
    // 更新当前账号信息
    const accountName = document.getElementById('accountName');
    const accountEmail = document.getElementById('accountEmail');
    const accountType = document.getElementById('accountType');
    const accountPoints = document.getElementById('accountPoints');
    const pointsPercent = document.getElementById('pointsPercent');
    const pointsBar = document.getElementById('pointsBar');
    const daysLeft = document.getElementById('daysLeft');
    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');
    const apiKey = document.getElementById('apiKey');
    
    if (info.currentAccount) {
      // 缓存当前登录账号到 accounts.js，避免后续重复调用
      if (typeof window.setCurrentEmailCache === 'function' && info.currentAccount.email) {
        window.setCurrentEmailCache(info.currentAccount.email);
      }
      
      // 基本信息
      if (accountName) accountName.textContent = info.currentAccount.name || '未知';
      if (accountEmail) accountEmail.textContent = info.currentAccount.email || '未登录';
      
      // 使用统一的积分和PRO账号处理函数
      const creditsInfo = processAccountCredits(
        info.currentAccount.usedPromptCredits,
        info.currentAccount.monthlyPromptCredits
      );
      
      // 账号类型显示
      if (accountType) {
        accountType.textContent = creditsInfo.accountType;
        accountType.className = `badge ${creditsInfo.typeClass}`;
        if (creditsInfo.typeClass === 'badge-type-trial') {
          accountType.className += ' home-trial'; // 首页试用期使用特殊样式
        }
        accountType.style.display = 'inline-block';
        accountType.style.background = '';
      }
      
      // 积分显示 - 使用统一函数的方法
      creditsInfo.updateHomePage(accountPoints, pointsPercent, pointsBar);
      
      // 试用期信息
      let days = 0;
      let expiryDateStr = '';
      let createdDateStr = '';
      
      if (info.currentAccount.expiresAt) {
        // 优先使用真实的到期时间
        const expiry = new Date(info.currentAccount.expiresAt);
        const now = new Date();
        days = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
        expiryDateStr = formatDateTime(info.currentAccount.expiresAt);
      } else if (info.currentAccount.createdAt) {
        // 如果没有到期时间，根据创建时间计算
        const created = new Date(info.currentAccount.createdAt);
        const expiry = new Date(created);
        expiry.setDate(expiry.getDate() + 14); // 修正为14天
        const now = new Date();
        days = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
        expiryDateStr = formatDateTime(expiry);
      }
      
      // 格式化创建时间
      createdDateStr = formatDateTime(info.currentAccount.createdAt);
      
      // 设置剩余天数显示和样式
      if (daysLeft) {
        daysLeft.textContent = days > 0 ? `剩余${days}天` : '已过期';
        applyDaysLeftStyle(daysLeft, days);
      }
      
      // 设置开始时间
      if (startTime) {
        startTime.textContent = createdDateStr;
      }
      
      // 设置结束时间（包含样式徽章）
      if (endTime) {
        if (expiryDateStr) {
          const daysText = days > 0 ? `剩余${days}天` : '已过期';
          const badgeStyle = getDaysLeftStyleString(days);
          endTime.innerHTML = `${expiryDateStr} <span style="margin-left: 8px; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; ${badgeStyle}">${daysText}</span>`;
        } else {
          endTime.textContent = '未知';
        }
      }
      
      // API Key
      if (apiKey && info.currentAccount.apiKey) {
        apiKey.textContent = info.currentAccount.apiKey;
      }
      
      // 只在主动刷新时显示提示
      if (showNotification) {
        showToast('✅ 刷新成功', 'success');
        // 日志由后端统一管理，不在前端重复添加
      }
    } else {
      if (accountName) accountName.textContent = '未登录';
      if (accountEmail) accountEmail.textContent = '-';
      if (accountType) accountType.style.display = 'none';
      if (accountPoints) {
        accountPoints.textContent = '- / -';
        accountPoints.style.color = '#86868b';
      }
      if (pointsPercent) pointsPercent.textContent = '(-)';
      if (pointsBar) {
        pointsBar.style.width = '0%';
        pointsBar.style.background = '#86868b';
      }
      if (daysLeft) daysLeft.textContent = '-';
      if (startTime) startTime.textContent = '-';
      if (endTime) endTime.textContent = '-';
      if (apiKey) apiKey.textContent = '-';
      
      // 只在主动刷新时显示提示
      if (showNotification) {
        showToast('⚠️ 未检测到登录账号', 'error');
        await ipcRenderer.invoke('log-message', { message: '未检测到登录账号', type: 'warning' });
      }
    }
  } catch (error) {
    await handleError(error, '获取系统信息');
  }
}

// 清空日志
async function clearLogs() {
  const logContainer = document.getElementById('logContainer');
  if (logContainer) {
    logContainer.innerHTML = '';
    await ipcRenderer.invoke('log-message', { message: '日志已清空', type: 'info' });
  }
}


// 注册状态标记
let isRegistering = false;
let shouldCancelRegistration = false;

// 显示注册日志窗口
function showRegistrationLog() {
  const modal = document.getElementById('registrationLogModal');
  if (modal) {
    modal.style.display = 'flex';
    // 清空之前的日志
    const logContent = document.getElementById('registrationLogContent');
    if (logContent) {
      logContent.innerHTML = '<div style="color:#86868b;">开始注册...</div>';
    }
    // 重置进度
    const progressBar = document.getElementById('regProgressBar');
    const progressText = document.getElementById('regProgressText');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0/0';
    
    // 显示取消按钮，隐藏关闭按钮
    const cancelBtn = document.getElementById('cancelRegBtn');
    const closeBtn = document.getElementById('closeRegBtn');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    if (closeBtn) closeBtn.style.display = 'none';
    
    isRegistering = true;
    shouldCancelRegistration = false;
  }
}

// 隐藏注册日志窗口
function hideRegistrationLog() {
  const modal = document.getElementById('registrationLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
  isRegistering = false;
}

// 取消注册
async function cancelRegistration() {
  if (isRegistering) {
    showConfirmDialog(
      '取消注册',
      '确定要取消正在进行的注册吗？\n\n已完成的账号会保留，未完成的账号将被取消。',
      async () => {
        shouldCancelRegistration = true;
        addRegistrationLog('用户请求取消注册...', 'warning');
        
        // 通过 IPC 通知主进程取消注册
        try {
          const result = await ipcRenderer.invoke('cancel-registration');
          if (result.success) {
            addRegistrationLog('取消请求已发送到主进程', 'info');
          } else {
            addRegistrationLog(`取消失败: ${result.message}`, 'warning');
          }
        } catch (error) {
          addRegistrationLog(`取消请求发送失败: ${error.message}`, 'error');
        }
      }
    );
  } else {
    hideRegistrationLog();
  }
}

// 添加日志到注册窗口
function addRegistrationLog(message, type = 'info') {
  const logContent = document.getElementById('registrationLogContent');
  if (!logContent) return;
  
  // 如果 message 是对象，提取 message 字段
  if (typeof message === 'object' && message.message) {
    message = message.message;
  }
  
  // 确保 message 是字符串
  if (typeof message !== 'string') {
    message = String(message);
  }
  
  let color = '#1d1d1f';
  if (type === 'success' || message.includes('成功') || message.includes('完成') || message.includes('已')) {
    color = '#34c759';
  } else if (type === 'error' || message.includes('失败') || message.includes('错误') || message.includes('异常')) {
    color = '#ff3b30';
  } else if (type === 'warning' || message.includes('警告') || message.includes('注意') || message.includes('超时')) {
    color = '#ff9500';
  } else if (type === 'info' || message.includes('开始') || message.includes('正在')) {
    color = '#007aff';
  }
  
  const logLine = document.createElement('div');
  logLine.style.cssText = `color: ${color}; word-wrap: break-word; margin-bottom: 2px;`;
  logLine.textContent = message;
  
  logContent.appendChild(logLine);
  
  // 多重保障确保滚动到底部
  const scrollToBottom = () => {
    logContent.scrollTop = logContent.scrollHeight;
  };
  
  // 立即滚动
  scrollToBottom();
  
  // 使用 requestAnimationFrame 再次确保滚动
  requestAnimationFrame(() => {
    scrollToBottom();
    setTimeout(scrollToBottom, 10);
  });
}

// 批量注册
async function startBatchRegister() {
  const count = parseInt(document.getElementById('registerCount').value);
  const concurrent = parseInt(document.getElementById('concurrentCount').value);
  const autoBindCard = document.getElementById('autoBindCard').checked;
  
  if (!count || count < 1) {
    showAlertDialog('输入错误', '请输入有效的注册数量', 'warning');
    return;
  }
  
  if (!concurrent || concurrent < 1 || concurrent > 10) {
    showAlertDialog('输入错误', '请输入有效的并发线程数（1-10）', 'warning');
    return;
  }
  
  // 优先从 IPC 读取配置，降级到 localStorage
  let saved = null;
  try {
    saved = await ipcRenderer.invoke('get-email-config');
  } catch (e) {
    saved = localStorage.getItem('windsurfConfig');
  }
  
  if (!saved) {
    showAlertDialog('配置缺失', '请先在设置页面配置IMAP邮箱', 'warning');
    return;
  }
  
  const config = typeof saved === 'string' ? JSON.parse(saved) : saved;
  if (!config.emailConfig || !config.emailConfig.user || !config.emailConfig.password) {
    showAlertDialog('配置缺失', '请先在设置页面配置IMAP邮箱', 'warning');
    return;
  }
  
  // 显示注册日志窗口
  showRegistrationLog();
  
  const bindCardText = autoBindCard ? '，自动绑卡' : '，不绑卡';
  addRegistrationLog(`开始批量注册 ${count} 个账号，并发数：${concurrent}${bindCardText}...`, 'info');
  
  try {
    const result = await ipcRenderer.invoke('batch-register', {
      count,
      concurrent,
      emailDomains: config.emailDomains,
      emailConfig: config.emailConfig,
      autoBindCard: autoBindCard
    });
    
    // 注册完成后刷新账号列表
    if (result && result.successCount > 0) {
      addRegistrationLog(`✅ 批量注册完成！成功 ${result.successCount} 个，失败 ${result.failCount} 个`, 'success');
      
      // 刷新账号列表
      const accounts = require('./accounts');
      if (accounts && accounts.loadAccounts) {
        await accounts.loadAccounts();
      }
      
      // 如果启用了自动绑卡且有需要绑卡的账号，自动开始绑卡
      if (autoBindCard && result.savedAccounts && result.savedAccounts.length > 0) {
        addRegistrationLog(`\n🎴 开始自动绑卡 ${result.savedAccounts.length} 个账号...`, 'info');
        
        // 准备绑卡账号列表
        const bindAccounts = result.savedAccounts.map(acc => ({
          email: acc.email,
          password: acc.password
        }));
        
        // 设置自动绑卡标志
        isAutoBinding = true;
        
        // 调用批量绑卡，使用自动选卡
        try {
          const bindResult = await ipcRenderer.invoke('batch-bind-cards', { 
            accounts: bindAccounts, 
            selectedCardId: 'auto' 
          });
          
          // 不在这里显示总结，让后端的总结消息作为最终输出
          // 后端会发送 binding-log 事件显示总结
          
          // 如果有待确认的账号，提示用户切换到账号管理页面
          if (bindResult && bindResult.pendingCount > 0) {
            addRegistrationLog(`\n💡 有 ${bindResult.pendingCount} 个账号需要手动确认，请切换到"账号管理"页面操作`, 'info');
          }
          
          // 再次刷新账号列表，更新绑卡状态
          if (accounts && accounts.loadAccounts) {
            await accounts.loadAccounts();
          }
        } catch (bindError) {
          addRegistrationLog(`❌ 自动绑卡异常: ${bindError.message}`, 'error');
        } finally {
          // 重置自动绑卡标志
          isAutoBinding = false;
        }
      } else if (!autoBindCard) {
        addRegistrationLog(`✅ ${result.successCount} 个账号已注册成功（未绑卡）`, 'success');
      }
    } else {
      addRegistrationLog(`批量注册完成，但没有成功的账号`, 'warning');
    }
  } catch (error) {
    addRegistrationLog(`批量注册失败: ${error.message}`, 'error');
  } finally {
    // 注册完成，切换按钮状态
    isRegistering = false;
    shouldCancelRegistration = false;
    const cancelBtn = document.getElementById('cancelRegBtn');
    const closeBtn = document.getElementById('closeRegBtn');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
      cancelBtn.disabled = false;
      cancelBtn.textContent = '取消注册';
    }
    if (closeBtn) closeBtn.style.display = 'inline-block';
  }
}

// 监听注册日志
ipcRenderer.on('registration-log', (event, log) => {
  // 只在注册窗口显示，避免重复
  addRegistrationLog(log);
  
  // 提取消息文本用于判断
  const logText = typeof log === 'object' && log.message ? log.message : String(log);
  
  // 如果检测到批量注册完成的日志，刷新账号列表
  if (logText.includes('批量注册完成') || logText.includes('注册成功')) {
    setTimeout(async () => {
      const accounts = require('./accounts');
      if (accounts && accounts.loadAccounts) {
        await accounts.loadAccounts();
      }
    }, 1000);
  }
});

// 监听注册进度
ipcRenderer.on('registration-progress', (event, progress) => {
  // 只更新进度条，不重复记录日志
  const progressBar = document.getElementById('regProgressBar');
  const progressText = document.getElementById('regProgressText');
  if (progressBar && progressText) {
    const percent = Math.round((progress.current / progress.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${progress.current}/${progress.total}`;
  }
});


// 重置机器码
async function resetMachineId() {
  await ipcRenderer.invoke('log-message', { message: '正在重置机器码（自动备份旧机器码）...', type: 'info' });
  
  try {
    const result = await ipcRenderer.invoke('reset-machine-id');
    if (result.success) {
      await ipcRenderer.invoke('log-message', { message: '机器码已重置（旧机器码已备份）', type: 'success' });
      showToast('✅ 机器码已重置', 'success');
      // 刷新系统信息以显示新的机器码
      refreshSystemInfo();
    } else {
      await ipcRenderer.invoke('log-message', { message: `重置失败: ${result.error}`, type: 'error' });
    }
  } catch (error) {
    await ipcRenderer.invoke('log-message', { message: `重置异常: ${error.message}`, type: 'error' });
  }
}

// 恢复机器码
async function restoreMachineFile() {
  await ipcRenderer.invoke('log-message', { message: '正在恢复机器码（从备份恢复）...', type: 'info' });
  
  try {
    const result = await ipcRenderer.invoke('restore-machine-file');
    if (result.success) {
      await ipcRenderer.invoke('log-message', { message: '机器码已恢复到上次重置前的状态', type: 'success' });
      showToast('✅ 机器码已恢复', 'success');
      // 刷新系统信息以显示恢复的机器码
      refreshSystemInfo();
    } else {
      await ipcRenderer.invoke('log-message', { message: `恢复失败: ${result.error}（请先执行一次重置操作）`, type: 'error' });
    }
  } catch (error) {
    await ipcRenderer.invoke('log-message', { message: `恢复异常: ${error.message}`, type: 'error' });
  }
}

// 标记是否正在自动绑卡
let isAutoBinding = false;

// 监听绑卡日志事件，将绑卡日志也显示在注册日志窗口
ipcRenderer.on('binding-log', (event, data) => {
  // 只有在自动绑卡时才将日志输出到注册窗口
  if (isAutoBinding && data.message) {
    addRegistrationLog(data.message);
  }
});

// 手动选择Windsurf路径
async function changeWindsurfPath() {
  try {
    const selectedPath = await ipcRenderer.invoke('select-windsurf-path');
    if (selectedPath) {
      const result = await ipcRenderer.invoke('set-custom-windsurf-path', selectedPath);
      if (result.success) {
        showToast('Windsurf路径已设置', 'success');
        // 刷新系统信息显示新路径
        refreshSystemInfo();
      } else {
        showToast(`设置路径失败: ${result.error}`, 'error');
      }
    }
  } catch (error) {
    await handleError(error, '选择路径');
    showToast('选择路径失败', 'error');
  }
}

// 重置Windsurf路径（恢复自动检测）
async function resetWindsurfPath() {
  try {
    const result = await ipcRenderer.invoke('set-custom-windsurf-path', ''); // 传空字符串重置
    if (result.success) {
      showToast('已重置为自动检测', 'success');
      // 刷新系统信息显示检测到的路径
      refreshSystemInfo();
    } else {
      showToast(`重置失败: ${result.error}`, 'error');
    }
  } catch (error) {
    await handleError(error, '重置路径');
    showToast('重置路径失败', 'error');
  }
}

// 导出模块
const homeModule = {
  refreshSystemInfo,
  clearLogs,
  startBatchRegister,
  resetMachineId,
  restoreMachineFile,
  showRegistrationLog,
  hideRegistrationLog,
  cancelRegistration,
  changeWindsurfPath,
  resetWindsurfPath
};

// 批量暴露到全局
Object.assign(window, homeModule);

module.exports = homeModule;
