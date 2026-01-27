/**
 * 设置模块
 */

const { ipcRenderer } = require('electron');
const { showToast } = require('../utils/utils');

// 默认配置
const DEFAULT_CONFIG = {
  emailDomains: [],
  emailConfig: { host: '', port: 993, user: '', password: '' },
  referralLink: '',
  emailType: 'domain',  // 'domain' 或 '126'
  email126Config: {
    filePath: '',
    mailType: '126',
    accounts: []
  }
};

let currentConfig = { ...DEFAULT_CONFIG };

// 加载设置
async function loadSettings() {
  try {
    const saved = await ipcRenderer.invoke('get-email-config');
    if (saved) currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {
    // 使用默认配置
  }
  
  renderDomainList();
  loadLanguageSetting();
  loadEmailConfig();
  loadEmail126Config();
  await loadPathSettings();
  await loadReferralLink();
  await loadCaptchaRunKey();
}

// 加载语言设置
function loadLanguageSetting() {
  const el = document.getElementById('languageSelect');
  if (el) el.value = localStorage.getItem('language') || 'zh-CN';
}

// 加载邮箱配置到表单
function loadEmailConfig() {
  const cfg = currentConfig.emailConfig || {};
  const fields = { imapHost: cfg.host, imapPort: cfg.port || 993, imapUser: cfg.user, imapPassword: cfg.password };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  });
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

// 验证域名格式
function isValidDomain(domain) {
  // 去除可能的前缀
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/i, '');
  // 简单验证：至少包含一个点，只允许字母、数字、连字符和点
  // 支持子域名如 mail.example.com，也支持内部域名如 server.local
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
  return domain.includes('.') && domainRegex.test(domain) && !domain.includes('..');
}

// 添加域名
function addDomain() {
  const input = document.getElementById('newDomain');
  let domain = input.value.trim();
  
  if (!domain) {
    showToast('请输入域名', 'warning');
    return;
  }
  
  // 自动去除常见前缀
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/i, '');
  
  // 验证域名格式
  if (!isValidDomain(domain)) {
    showToast('域名格式不正确，请输入如: example.com', 'error');
    return;
  }
  
  if (currentConfig.emailDomains.includes(domain)) {
    showToast('该域名已存在', 'warning');
    return;
  }
  
  currentConfig.emailDomains.push(domain);
  input.value = '';
  renderDomainList();
  saveSettings();
  showToast('域名添加成功', 'success');
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
  // 路径变更后刷新整个页面，确保所有模块重新初始化
  location.reload();
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

// 保存邀请链接
async function saveReferralLink() {
  const link = document.getElementById('referralLink').value.trim();
  try {
    await ipcRenderer.invoke('save-referral-link', link);
    showToast('邀请链接已保存', 'success');
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

// 加载邀请链接
async function loadReferralLink() {
  try {
    const link = await ipcRenderer.invoke('get-referral-link');
    const input = document.getElementById('referralLink');
    if (input && link) {
      input.value = link;
    }
  } catch (error) {
    // 静默处理
  }
}


// 保存 CaptchaRun API Key
async function saveCaptchaRunKey() {
  const key = document.getElementById('captchaRunApiKey').value.trim();
  try {
    await ipcRenderer.invoke('save-captcharun-key', key);
    showCaptchaRunStatus('API Key 已保存', 'success');
  } catch (error) {
    showCaptchaRunStatus('保存失败: ' + error.message, 'error');
  }
}

// 测试 CaptchaRun API Key
async function testCaptchaRunKey() {
  const key = document.getElementById('captchaRunApiKey').value.trim();
  if (!key) {
    showCaptchaRunStatus('请先输入 API Key', 'warning');
    return;
  }
  
  showCaptchaRunStatus('正在测试...', 'info');
  try {
    const result = await ipcRenderer.invoke('test-captcharun-key', key);
    if (result.success) {
      showCaptchaRunStatus(`测试成功！余额: ¥${result.balance}`, 'success');
    } else {
      showCaptchaRunStatus('测试失败: ' + result.error, 'error');
    }
  } catch (error) {
    showCaptchaRunStatus('测试失败: ' + error.message, 'error');
  }
}

// 加载 CaptchaRun API Key
async function loadCaptchaRunKey() {
  try {
    const key = await ipcRenderer.invoke('get-captcharun-key');
    const input = document.getElementById('captchaRunApiKey');
    if (input && key) {
      input.value = key;
    }
  } catch (error) {
    // 静默处理
  }
}

// 显示 CaptchaRun 状态
function showCaptchaRunStatus(message, type) {
  const statusDiv = document.getElementById('captchaRunStatus');
  if (statusDiv) {
    const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    statusDiv.innerHTML = `<span style="color:${colors[type] || '#666'}; font-size:12px;">${message}</span>`;
    if (type !== 'info') {
      setTimeout(() => { statusDiv.innerHTML = ''; }, 5000);
    }
  }
}

// ============ 126/163 邮箱配置相关函数 ============

// 切换邮箱类型
function switchEmailType(type) {
  currentConfig.emailType = type;
  
  const domainSection = document.getElementById('domainEmailSection');
  const email126Section = document.getElementById('email126Section');
  
  if (type === 'domain') {
    domainSection.style.display = 'block';
    email126Section.style.display = 'none';
  } else {
    domainSection.style.display = 'none';
    email126Section.style.display = 'block';
  }
  
  // 保存配置
  saveSettingsQuiet();
}

// 加载 126 邮箱配置
async function loadEmail126Config() {
  const cfg = currentConfig.email126Config || {};
  
  // 设置邮箱类型选择
  const emailTypeRadios = document.querySelectorAll('input[name="emailType"]');
  emailTypeRadios.forEach(radio => {
    radio.checked = radio.value === (currentConfig.emailType || 'domain');
  });
  
  // 切换显示区域
  switchEmailType(currentConfig.emailType || 'domain');
  
  // 设置 126 邮箱配置
  const filePathInput = document.getElementById('email126FilePath');
  const typeSelect = document.getElementById('email126Type');
  const countInput = document.getElementById('email126Count');
  
  if (filePathInput) filePathInput.value = cfg.filePath || '';
  if (typeSelect) typeSelect.value = cfg.mailType || '126';
  
  // 显示可用账号数量
  const available = (cfg.accounts || []).length;
  if (countInput) countInput.value = `${available} 个`;
}

// 选择 126 邮箱账号文件
async function selectEmail126File() {
  try {
    const result = await ipcRenderer.invoke('select-email126-file');
    if (result && result.filePath) {
      currentConfig.email126Config = currentConfig.email126Config || {};
      currentConfig.email126Config.filePath = result.filePath;
      currentConfig.email126Config.accounts = result.accounts || [];
      
      document.getElementById('email126FilePath').value = result.filePath;
      document.getElementById('email126Count').value = result.accounts.length;
      
      showEmail126Status(`成功加载 ${result.accounts.length} 个账号`, 'success');
      saveSettingsQuiet();
    }
  } catch (error) {
    showEmail126Status('选择文件失败: ' + error.message, 'error');
  }
}

// 测试 126 邮箱连接
async function testEmail126() {
  const accounts = currentConfig.email126Config?.accounts || [];
  if (accounts.length === 0) {
    showEmail126Status('请先选择邮箱账号文件', 'warning');
    return;
  }
  
  const mailType = document.getElementById('email126Type').value;
  showEmail126Status('正在测试连接...', 'info');
  
  try {
    const result = await ipcRenderer.invoke('test-email126', {
      user: accounts[0].email,
      password: accounts[0].password,
      mailType: mailType
    });
    
    if (result.success) {
      showEmail126Status('连接成功！' + (result.message || ''), 'success');
    } else {
      showEmail126Status('连接失败: ' + result.error, 'error');
    }
  } catch (error) {
    showEmail126Status('测试失败: ' + error.message, 'error');
  }
}

// 保存 126 邮箱配置
async function saveEmail126Settings() {
  const mailType = document.getElementById('email126Type').value;
  currentConfig.email126Config = currentConfig.email126Config || {};
  currentConfig.email126Config.mailType = mailType;
  
  try {
    await ipcRenderer.invoke('save-email-config', currentConfig);
    showEmail126Status('配置已保存', 'success');
    showToast('126邮箱配置已保存', 'success');
  } catch (error) {
    showEmail126Status('保存失败: ' + error.message, 'error');
  }
}

// 显示 126 邮箱状态
function showEmail126Status(message, type) {
  const statusDiv = document.getElementById('email126Status');
  if (statusDiv) {
    const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    statusDiv.innerHTML = `<span style="color:${colors[type] || '#666'}; font-size:12px;">${message}</span>`;
    if (type !== 'info') {
      setTimeout(() => { statusDiv.innerHTML = ''; }, 5000);
    }
  }
}

// 打开已用126邮箱文件
async function openUsed126File() {
  try {
    const result = await ipcRenderer.invoke('open-used-126-file');
    if (!result.success) {
      showEmail126Status(result.error || '打开失败', 'warning');
    }
  } catch (error) {
    showEmail126Status('打开失败: ' + error.message, 'error');
  }
}

// 静默保存配置（不显示提示）
async function saveSettingsQuiet() {
  try {
    await ipcRenderer.invoke('save-email-config', currentConfig);
  } catch (e) {
    localStorage.setItem('windsurfConfig', JSON.stringify(currentConfig));
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
  switchEmailType,
  loadEmail126Config,
  selectEmail126File,
  testEmail126,
  saveEmail126Settings,
  openUsed126File,
  resetDataPath,
  showPathStatus,
  saveReferralLink,
  loadReferralLink,
  saveCaptchaRunKey,
  testCaptchaRunKey,
  loadCaptchaRunKey
};

Object.assign(window, settingsModule);
module.exports = settingsModule;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', loadSettings);
