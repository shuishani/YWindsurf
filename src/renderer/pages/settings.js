/**
 * 设置模块
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const { showToast, addLog } = require('../utils/utils');

let currentConfig = {
  emailDomains: [''],
  emailConfig: {
    host: 'imap.qq.com',
    port: 993,
    user: '',
    password: ''
  }
};

// 加载设置
async function loadSettings() {
  // 使用原始路径保存邮箱配置
  let saved = null;
  
  try {
    // 从原始路径读取配置
    saved = await ipcRenderer.invoke('get-email-config');
  } catch (e) {
    saved = localStorage.getItem('windsurfConfig');
  }
  
  if (saved) {
    try {
      currentConfig = JSON.parse(saved);
    } catch (e) {
      // 配置解析失败，使用默认配置
    }
  }
  
  renderDomainList();
  
  // 加载语言设置
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) {
    const savedLang = localStorage.getItem('language') || 'zh-CN';
    languageSelect.value = savedLang;
  }
  
  // 加载路径设置
  await loadPathSettings();
  
  if (currentConfig.emailConfig) {
    const imapHost = document.getElementById('imapHost');
    const imapPort = document.getElementById('imapPort');
    const imapUser = document.getElementById('imapUser');
    const imapPassword = document.getElementById('imapPassword');
    
    if (imapHost) imapHost.value = currentConfig.emailConfig.host || '';
    if (imapPort) imapPort.value = currentConfig.emailConfig.port || 993;
    if (imapUser) imapUser.value = currentConfig.emailConfig.user || '';
    if (imapPassword) imapPassword.value = currentConfig.emailConfig.password || '';
  }
}

// 渲染域名列表
function renderDomainList() {
  const container = document.getElementById('domainList');
  if (!container) return;
  
  if (!currentConfig.emailDomains || currentConfig.emailDomains.length === 0) {
    container.innerHTML = '<div style="color:#86868b; font-size:12px; padding:12px;">暂无域名</div>';
    return;
  }
  
  container.innerHTML = currentConfig.emailDomains.map(domain => `
    <div class="domain-tag">
      <span>${domain}</span>
      <button onclick="removeDomain('${domain}')">×</button>
    </div>
  `).join('');
}

// 添加域名
function addDomain() {
  const input = document.getElementById('newDomain');
  const domain = input.value.trim();
  
  if (!domain) {
    alert('请输入域名');
    return;
  }
  
  if (currentConfig.emailDomains.includes(domain)) {
    alert('该域名已存在');
    return;
  }
  
  currentConfig.emailDomains.push(domain);
  input.value = '';
  renderDomainList();
  saveSettings();
}

// 删除域名
function removeDomain(domain) {
  currentConfig.emailDomains = currentConfig.emailDomains.filter(d => d !== domain);
  renderDomainList();
  saveSettings();
}

// 测试IMAP连接
async function testImap() {
  const host = document.getElementById('imapHost').value.trim();
  const port = parseInt(document.getElementById('imapPort').value);
  const user = document.getElementById('imapUser').value.trim();
  const password = document.getElementById('imapPassword').value.trim();
  
  if (!host || !user || !password) {
    alert('请填写完整的IMAP配置');
    return;
  }
  
  const statusEl = document.getElementById('settingsStatus');
  statusEl.innerHTML = '<div class="status-message status-info">正在测试连接...</div>';
  
  try {
    const result = await ipcRenderer.invoke('test-imap', { host, port, user, password });
    if (result.success) {
      // 测试成功后自动保存配置
      currentConfig.emailConfig = { host, port, user, password };
      
      // 同时保存到原始路径和 localStorage
      try {
        await ipcRenderer.invoke('save-email-config', currentConfig);
      } catch (e) {
        localStorage.setItem('windsurfConfig', JSON.stringify(currentConfig));
      }
      
      statusEl.innerHTML = '<div class="status-message status-success">✓ 连接成功！配置已自动保存</div>';
      showToast('邮箱配置测试成功并已保存', 'success');
      
      setTimeout(() => {
        statusEl.innerHTML = '';
      }, 3000);
    } else {
      statusEl.innerHTML = `<div class="status-message status-error">✗ 连接失败: ${result.error}</div>`;
    }
  } catch (error) {
    statusEl.innerHTML = `<div class="status-message status-error">✗ 连接失败: ${error.message}</div>`;
  }
}

// 保存设置
async function saveSettings() {
  const host = document.getElementById('imapHost').value.trim();
  const port = parseInt(document.getElementById('imapPort').value);
  const user = document.getElementById('imapUser').value.trim();
  const password = document.getElementById('imapPassword').value.trim();
  
  if (host && user && password) {
    currentConfig.emailConfig = { host, port, user, password };
  }
  
  try {
    // 保存到原始路径
    await ipcRenderer.invoke('save-email-config', currentConfig);
  } catch (e) {
    localStorage.setItem('windsurfConfig', JSON.stringify(currentConfig));
  }
  
  const statusEl = document.getElementById('settingsStatus');
  statusEl.innerHTML = '<div class="status-message status-success">✓ 配置已保存</div>';
  setTimeout(() => {
    statusEl.innerHTML = '';
  }, 3000);
  
  showToast('配置已保存', 'success');
}

// 切换语言
function changeLanguage() {
  const lang = document.getElementById('languageSelect').value;
  localStorage.setItem('language', lang);
  location.reload();
}

// YWindsurf数据路径设置相关函数
async function loadPathSettings() {
  try {
    // 加载Data路径
    const dataPath = await ipcRenderer.invoke('get-custom-data-path');
    const dataPathInput = document.getElementById('dataPathInput');
    if (dataPathInput) {
      dataPathInput.value = dataPath || '';
      dataPathInput.placeholder = dataPath ? '' : '自动检测';
    }
  } catch (error) {
    // 加载路径设置失败，使用默认值
  }
}


async function selectDataPath() {
  try {
    const selectedPath = await ipcRenderer.invoke('select-data-path');
    if (selectedPath) {
      const result = await ipcRenderer.invoke('set-custom-data-path', selectedPath);
      if (result.success) {
        document.getElementById('dataPathInput').value = selectedPath;
        document.getElementById('dataPathInput').placeholder = '';
        showPathStatus('Data 路径设置成功，数据已重新加载', 'success');
      } else {
        showPathStatus('设置失败: ' + result.error, 'error');
      }
    }
  } catch (error) {
    showPathStatus('选择路径失败: ' + error.message, 'error');
  }
}

async function resetDataPath() {
  try {
    const result = await ipcRenderer.invoke('set-custom-data-path', '');
    if (result.success) {
      document.getElementById('dataPathInput').value = '';
      document.getElementById('dataPathInput').placeholder = '自动检测';
      showPathStatus('Data 路径已重置，数据已重新加载', 'success');
    } else {
      showPathStatus('重置失败: ' + result.error, 'error');
    }
  } catch (error) {
    showPathStatus('重置失败: ' + error.message, 'error');
  }
}

// 监听路径变更事件
ipcRenderer.on('data-path-changed', async () => {
  try {
    // 重新加载路径显示
    await loadPathSettings();
    
    // 重新加载其他页面的数据
    if (typeof loadAccounts === 'function') {
      await loadAccounts();
    }
    if (typeof loadVirtualCards === 'function') {
      await loadVirtualCards();
    }
    
    // 数据路径变更，已重新加载
  } catch (error) {
    // 重新加载数据失败，静默处理
  }
});

function showPathStatus(message, type) {
  const statusDiv = document.getElementById('pathStatus');
  if (statusDiv) {
    statusDiv.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
    setTimeout(() => {
      statusDiv.innerHTML = '';
    }, 3000);
  }
}

// 导出模块并暴露到全局
const settingsModule = {
  loadSettings,
  addDomain,
  removeDomain,
  testImap,
  saveSettings,
  changeLanguage,
  loadPathSettings,
  selectDataPath,
  resetDataPath,
  showPathStatus
};

Object.assign(window, settingsModule);
module.exports = settingsModule;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', loadSettings);
