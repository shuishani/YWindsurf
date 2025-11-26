/**
 * 账号管理模块
 */

const { ipcRenderer } = require('electron');
const { showToast, calculateExpiry, addLog, processAccountCredits, formatDateTime, handleError, generateEmptyStateHTML } = require('../utils/utils');

// ==================== 全局变量 ====================
let accountsCache = [];
let availableCards = [];
let currentEmailCache = null; // 缓存当前登录账号，避免重复获取
let selectedCardId = 'auto';

// 设置当前登录账号缓存
function setCurrentEmailCache(email) {
  currentEmailCache = email;
  addLog(`当前登录账号：${email}`);
}

// ==================== 账号数据管理 ====================
async function loadAccounts() {
  try {
    const accounts = await ipcRenderer.invoke('get-accounts');
    accountsCache = accounts || [];
    await renderAccounts();
    updateAccountStats();
  } catch (error) {
    await handleError(error, '加载账号', true);
  }
}

// ==================== 虚拟卡选择器 ====================
async function toggleCardSelector() {
  const dropdown = document.getElementById('cardSelectorDropdown');
  if (!dropdown) return;
  
  if (dropdown.style.display === 'none' || !dropdown.style.display) {
    // 显示下拉框
    try {
      // 加载虚拟卡列表
      const result = await ipcRenderer.invoke('get-cards');
      availableCards = result.success ? result.cards || [] : [];
      
      // 渲染卡片选项
      renderCardOptions();
      
      // 显示下拉框
      dropdown.style.display = 'block';
      
      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
          if (!e.target.closest('.card-selector-wrapper')) {
            dropdown.style.display = 'none';
            document.removeEventListener('click', closeDropdown);
          }
        });
      }, 0);
    } catch (error) {
      showToast('加载虚拟卡失败', 'error');
    }
  } else {
    // 隐藏下拉框
    dropdown.style.display = 'none';
  }
}

// 渲染卡片选项
function renderCardOptions() {
  const container = document.getElementById('cardSelectorDropdown');
  if (!container) return;
  
  container.innerHTML = '';
  
  // 添加自动选择选项
  const autoOption = document.createElement('div');
  autoOption.className = `card-option ${selectedCardId === 'auto' ? 'selected' : ''}`;
  autoOption.setAttribute('data-value', 'auto');
  autoOption.innerHTML = `
    <div class="card-icon">🔄</div>
    <div class="card-info">
      <div class="card-number">自动选择</div>
      <div class="card-details">系统自动选择最适合的虚拟卡</div>
    </div>
    <div class="card-check">✓</div>
  `;
  autoOption.addEventListener('click', () => selectCard('auto'));
  container.appendChild(autoOption);
  
  if (availableCards.length === 0) {
    const emptyOption = document.createElement('div');
    emptyOption.style.cssText = 'text-align:center; padding:20px; color:#86868b; font-size:12px;';
    emptyOption.textContent = '暂无其他虚拟卡';
    container.appendChild(emptyOption);
    return;
  }
  
  // 分类：BIN卡头和完整卡
  const binCards = availableCards.filter(c => c.type === 'bin');
  const fullCards = availableCards.filter(c => c.type === 'full');
  
  // 渲染BIN卡头
  if (binCards.length > 0) {
    binCards.forEach(card => {
      const option = createCardOption(card, 'bin');
      container.appendChild(option);
    });
  }
  
  // 渲染完整卡
  if (fullCards.length > 0) {
    fullCards.forEach(card => {
      const option = createCardOption(card, 'full');
      container.appendChild(option);
    });
  }
}

// 创建卡片选项元素
function createCardOption(card, type) {
  const option = document.createElement('div');
  option.className = `card-option ${selectedCardId === card.id ? 'selected' : ''}`;
  option.setAttribute('data-value', card.id);
  option.setAttribute('data-type', type);
  
  let icon, mainInfo, subInfo;
  
  if (type === 'bin') {
    icon = '🎲';
    mainInfo = `<div class="card-number">${card.bin ? card.bin.substring(0, 6) + 'xxxxxx' : '未知BIN'}</div>`;
    subInfo = `<div class="card-details">
      <span>随机生成卡号</span>
      <span>${card.bindCount > 0 ? `已绑${card.bindCount}次` : '未使用'}</span>
    </div>`;
  } else {
    icon = '💳';
    // 格式化卡号：每4位加空格
    const rawNum = card.number || '';
    const formattedNum = rawNum.replace(/(.{4})/g, '$1 ').trim();
    
    mainInfo = `<div class="card-number">${formattedNum}</div>`;
    
    // 显示有效期和CVV
    const expiry = `${card.expMonth || 'MM'}/${card.expYear || 'YY'}`;
    const cvv = card.cvv || 'CVV';
    
    subInfo = `<div class="card-details">
      <span>EXP: ${expiry}</span>
      <span>CVV: ${cvv}</span>
      <span style="margin-left:auto; color:#666;">${card.bindCount > 0 ? `${card.bindCount}次` : '未使用'}</span>
    </div>`;
  }
  
  option.innerHTML = `
    <div class="card-icon">${icon}</div>
    <div class="card-info">
      ${mainInfo}
      ${subInfo}
    </div>
    <div class="card-check">✓</div>
  `;
  
  option.addEventListener('click', () => selectCard(card.id));
  
  return option;
}

// 选择卡片
function selectCard(cardId) {
  selectedCardId = cardId;
  
  // 更新按钮文本
  updateSelectedCardButton();
  
  // 关闭下拉框
  const dropdown = document.getElementById('cardSelectorDropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
}

// 更新选中卡片按钮的显示
function updateSelectedCardButton() {
  const button = document.getElementById('selectedCardButton');
  if (!button) return;
  
  if (selectedCardId === 'auto') {
    button.textContent = '选择虚拟卡 ▾';
  } else {
    const selectedCard = availableCards.find(c => c.id === selectedCardId);
    if (selectedCard) {
      const cardNumber = selectedCard.type === 'bin' 
        ? (selectedCard.bin ? selectedCard.bin.substring(0, 6) + 'xxxxxx' : '未知')
        : (selectedCard.number ? selectedCard.number.substring(0, 4) + ' ' + selectedCard.number.substring(4, 8) + '...' : '未知');
      const icon = selectedCard.type === 'bin' ? '🎲' : '💳';
      button.textContent = `${icon} ${cardNumber} ▾`;
    }
  }
}

// 获取当前选中的卡片ID（用于绑卡功能）
function getSelectedCardId() {
  return selectedCardId;
}

// ==================== 账号数据处理函数 ====================

/**
 * 格式化账号数据
 */
function formatAccountData(acc) {
  const expiry = calculateExpiry(acc.createdAt, acc.expiresAt);
  
  // 使用统一的时间格式化函数
  const expiryDate = expiry.expiryDate ? formatDateTime(expiry.expiryDate) : '未知';
  
  return {
    ...acc,
    expiry,
    expiryDate
  };
}

/**
 * 计算账号样式和状态
 */
function calculateAccountStyles(acc) {
  // 使用统一的积分和PRO账号处理函数
  const creditsInfo = processAccountCredits(acc.usedPromptCredits, acc.monthlyPromptCredits, acc.usageUnknown);
  
  // 绑卡状态
  let cardBoundHtml;
  if (acc.monthlyPromptCredits >= 500) {
    cardBoundHtml = '<span class="badge badge-card-bound">已绑卡</span>';
  } else if (acc.needsManualBinding === true) {
    cardBoundHtml = `
      <div style="display:flex; gap:4px;">
        <button onclick="markCardBound('${acc.email}', true); event.stopPropagation();" class="badge badge-card-bound" style="border:none; cursor:pointer;">✓</button>
        <button onclick="markCardBound('${acc.email}', false); event.stopPropagation();" class="badge badge-card-error" style="border:none; cursor:pointer;">✕</button>
      </div>
    `;
  } else if (acc.cardBound === true) {
    cardBoundHtml = '<span class="badge badge-card-bound">已绑卡</span>';
  } else if (acc.cardBound === false) {
    cardBoundHtml = '<span class="badge badge-card-error">失败</span>';
  } else {
    cardBoundHtml = '<span class="badge badge-card-none">未绑</span>';
  }
  
  // Token 状态
  const tokenHtml = acc.accountType 
    ? '<span style="color:#34c759; font-size:12px;">● 已获取</span>'
    : '<span style="color:#86868b; font-size:12px;">○ 未获取</span>';
      
  // 到期时间样式
  let expiryClass = 'expiry-cell';
  if (acc.expiry.isExpired) expiryClass += ' expiry-expired';
  else if (acc.expiry.daysLeft <= 3) expiryClass += ' expiry-warning';

  return {
    // 使用统一函数的结果
    accountType: creditsInfo.accountType,
    typeBadgeClass: creditsInfo.typeClass,
    typeLabel: creditsInfo.accountType,
    pointsHtml: creditsInfo.generateTableHTML(),
    
    // 其他样式
    cardBoundHtml,
    tokenHtml,
    expiryClass
  };
}

/**
 * 生成账号行HTML
 */
function generateAccountRowHTML(acc, styles, isCurrentAccount = false) {
  const rowClass = isCurrentAccount ? 'current-account-row' : '';

  return `
    <tr data-id="${acc.id}" class="${rowClass}">
      <td style="width: 40px; text-align: center;" onclick="event.stopPropagation()">
        <input type="checkbox" class="account-checkbox" data-email="${acc.email}" data-password="${acc.password}" onchange="updateSelectedBindCount()">
      </td>
      <td ondblclick="copyAccountRow('${acc.email}', '${acc.password}'); event.stopPropagation();" style="cursor: pointer;" title="双击复制账号密码">
        <div class="account-email-cell">${acc.email}</div>
      </td>
      <td>
        <span class="badge ${styles.typeBadgeClass}">${styles.typeLabel}</span>
      </td>
      <td>${styles.pointsHtml}</td>
      <td>${styles.cardBoundHtml}</td>
      <td>
        <div class="${styles.expiryClass}">${acc.expiryDate}</div>
      </td>
      <td>${styles.tokenHtml}</td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <button class="action-btn primary" onclick="getAccountDetails('${acc.email}', '${acc.password}'); event.stopPropagation();" title="刷新信息">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 4v6h-6"></path>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <div style="position:relative;">
            <button class="action-btn" onclick="toggleActionMenu(event, '${acc.id}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            </button>
            <div class="action-menu" id="menu-${acc.id}">
              <div class="action-menu-item" onclick="switchAccount('${acc.email}', '${acc.password}')">🔄 切号</div>
              <div class="action-menu-item" onclick="viewAccount('${acc.email}', '${acc.password}')">📋 查看详情</div>
              <div class="action-menu-item" onclick="editAccount('${acc.id}', '${acc.email}', '${acc.password}')">✏️ 编辑账号</div>
              <div class="action-menu-item danger" onclick="deleteAccountFromTable('${acc.id}', '${acc.email}')">🗑️ 删除账号</div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

// ==================== 账号列表渲染 ====================
async function renderAccounts() {
  const tbody = document.getElementById('accountsList');
  if (!tbody) return;

  // 获取当前登录账号（使用缓存避免重复调用）
  let currentEmail = currentEmailCache;
  if (!currentEmail) {
    try {
      const systemInfo = await ipcRenderer.invoke('get-system-info');
      if (systemInfo.success && systemInfo.currentAccount?.email) {
        currentEmail = systemInfo.currentAccount.email;
        currentEmailCache = currentEmail; // 缓存结果
      }
    } catch (error) {
      // 忽略错误，继续渲染
    }
  }

  // 检查是否有账号数据
  if (!accountsCache || accountsCache.length === 0) {
    tbody.innerHTML = generateEmptyStateHTML(9, '暂无账号数据', '点击上方"添加账号"或"批量注册"开始使用');
    return;
  }

  // 渲染账号列表
  tbody.innerHTML = accountsCache.map(acc => {
    const formattedAcc = formatAccountData(acc);
    const styles = calculateAccountStyles(formattedAcc);
    const isCurrentAccount = currentEmail && acc.email === currentEmail;
    
    return generateAccountRowHTML(formattedAcc, styles, isCurrentAccount);
  }).join('');
}

// ==================== 统计数据 ====================
function updateAccountStats() {
  const total = accountsCache.length;
  let available = 0;    // 可用账号
  let warning = 0;      // 即将耗尽
  let unavailable = 0;  // 不可用

  accountsCache.forEach(acc => {
    const expiry = calculateExpiry(acc.createdAt);
    const isExpired = expiry.isExpired;
    
    // 计算用量百分比
    let usageRate = 0;
    if (acc.usedPromptCredits !== undefined && acc.monthlyPromptCredits !== undefined && acc.monthlyPromptCredits > 0) {
      usageRate = (acc.usedPromptCredits / acc.monthlyPromptCredits) * 100;
    }
    
    // 简单分类判断
    if (isExpired || usageRate >= 100) {
      // 不可用：已过期 或 用量用完
      unavailable++;
    } else if (usageRate > 90 || expiry.daysLeft <= 3) {
      // 即将耗尽：用量>90% 或 3天内过期
      warning++;
    } else {
      // 可用：其他情况
      available++;
    }
  });

  // 更新统计显示
  document.getElementById('totalCount').textContent = total;
  document.getElementById('activeCount').textContent = available;
  document.getElementById('warningCount').textContent = warning;
  document.getElementById('expiredCount').textContent = unavailable;
  
  // 始终显示统计区域
  const statsElement = document.getElementById('accountStats');
  if (statsElement) {
    statsElement.style.display = 'block';
  }
}

// 显示手动添加表单
function showAddAccountForm() {
  document.getElementById('manualEmail').value = '';
  document.getElementById('manualPassword').value = '';
  document.getElementById('addAccountModal').style.display = 'flex';
}

// 隐藏手动添加表单
function hideAddAccountForm() {
  document.getElementById('addAccountModal').style.display = 'none';
}

// 手动添加账号
async function addManualAccount() {
  const email = document.getElementById('manualEmail').value.trim();
  const password = document.getElementById('manualPassword').value.trim();

  if (!email || !password) {
    alert('请输入邮箱和密码');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('add-account', { email, password });
    if (result.success) {
      showToast('账号添加成功', 'success');
      hideAddAccountForm();
      await loadAccounts();
    } else {
      alert('添加失败: ' + result.error);
    }
  } catch (error) {
    alert('添加失败: ' + error.message);
  }
}

// 切换三点菜单
function toggleActionMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById(`menu-${id}`);
  
  // 关闭所有其他菜单
  document.querySelectorAll('.action-menu').forEach(m => {
    if (m.id !== `menu-${id}`) {
      m.classList.remove('show');
      m.style.bottom = '';
      m.style.top = '';
    }
  });
  
  const isShowing = menu.classList.contains('show');
  menu.classList.toggle('show');
  
  // 如果菜单被打开，检查是否需要向上展开
  if (!isShowing) {
    setTimeout(() => {
      const menuRect = menu.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - menuRect.bottom;
      
      if (spaceBelow < 150) {
        menu.style.bottom = '100%';
        menu.style.top = 'auto';
        menu.style.marginTop = '0';
        menu.style.marginBottom = '4px';
      } else {
        menu.style.bottom = '';
        menu.style.top = '100%';
        menu.style.marginTop = '4px';
        menu.style.marginBottom = '';
      }
    }, 10);
  }
}

// 双击行复制账号
async function copyAccountRow(email, password) {
  navigator.clipboard.writeText(email);
  showToast('账号已复制', 'success');
  logger.success(`复制账号: ${email}`);
}

// 查看账号详细信息
function viewAccount(email, password) {
  // 从缓存中找到完整的账号信息
  const account = accountsCache.find(acc => acc.email === email);
  if (!account) {
    showAlertDialog('查看失败', '未找到账号信息', 'error');
    return;
  }

  // 创建详细信息弹窗
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  `;

  // 格式化账号类型
  let accountTypeText = account.accountType || 'Unknown';
  // 如果已经包含PRO就不再重复添加
  if (account.isPro && !accountTypeText.includes('PRO')) {
    accountTypeText += ' (PRO)';
  }

  // 格式化绑卡状态
  let cardBoundText = '未知';
  if (account.cardBound === true) {
    cardBoundText = '已绑卡';
  } else if (account.cardBound === false) {
    cardBoundText = '未绑卡';
  }

  // 格式化创建时间
  let createdTime = '未知';
  if (account.createdAt) {
    createdTime = new Date(account.createdAt).toLocaleString('zh-CN');
  }

  // 格式化最后刷新时间
  let lastRefreshedTime = '从未刷新';
  if (account.lastRefreshed) {
    lastRefreshedTime = new Date(account.lastRefreshed).toLocaleString('zh-CN');
  }

  // 格式化积分信息
  let promptCredits = '未知';
  if (account.usedPromptCredits !== undefined && account.monthlyPromptCredits !== undefined) {
    promptCredits = `${account.usedPromptCredits} / ${account.monthlyPromptCredits}`;
  }

  // 计算到期时间 - 使用系统的calculateExpiry函数
  let expiryInfo = '未知';
  if (account.expiresAt || account.createdAt) {
    const expiry = calculateExpiry(account.createdAt, account.expiresAt);
    if (expiry.expiryDate) {
      expiryInfo = expiry.expiryText;
    }
  }

  dialog.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #e5e5ea; padding-bottom: 16px;">
      <h2 style="margin: 0; color: #1d1d1f; font-size: 18px;">账号详细信息</h2>
      <button onclick="this.closest('.account-detail-modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #86868b;">&times;</button>
    </div>
    
    <div style="line-height: 1.6; font-size: 14px;">
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">📧 邮箱地址: </span>
        <span style="color: #1d1d1f; font-family: monospace;">${account.email}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">🔑 密码: </span>
        <span style="color: #1d1d1f; font-family: monospace;">${account.password}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">👤 用户名: </span>
        <span style="color: #1d1d1f;">${account.name || '未知'}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">🏷️ 账号类型: </span>
        <span style="color: #1d1d1f;">${accountTypeText}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">💳 绑卡状态: </span>
        <span style="color: #1d1d1f;">${cardBoundText}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">⚡ 积分: </span>
        <span style="color: #1d1d1f;">${promptCredits}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">📅 创建时间: </span>
        <span style="color: #1d1d1f;">${createdTime}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">🔄 最后刷新: </span>
        <span style="color: #1d1d1f;">${lastRefreshedTime}</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">⏰ 到期时间: </span>
        <span style="color: #1d1d1f;">${expiryInfo}</span>
      </div>
      
      ${account.userId ? `
      <div style="margin-bottom: 8px;">
        <span style="color: #86868b;">🆔 用户ID: </span>
        <span style="color: #1d1d1f; font-family: monospace;">${account.userId}</span>
      </div>
      ` : ''}
    </div>
    
    <div style="display: flex; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5ea;">
      <button onclick="navigator.clipboard.writeText('${account.email} ${account.password}'); showToast('账号密码已复制', 'success');" 
              style="flex: 1; padding: 10px; background: #007aff; color: white; border: none; border-radius: 6px; cursor: pointer;">
        📋 复制账号密码
      </button>
      <button onclick="getAccountDetails('${account.email}', '${account.password}')" 
              style="flex: 1; padding: 10px; background: #34c759; color: white; border: none; border-radius: 6px; cursor: pointer;">
        🔄 刷新信息
      </button>
    </div>
  `;

  modal.className = 'account-detail-modal';
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // 点击背景关闭弹窗
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// 编辑账号信息
function editAccount(id, email, password) {
  // 从缓存中找到账号信息
  const account = accountsCache.find(acc => acc.id === id);
  if (!account) {
    showAlertDialog('编辑失败', '未找到账号信息', 'error');
    return;
  }

  // 创建编辑弹窗
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  `;

  dialog.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #e5e5ea; padding-bottom: 16px;">
      <h2 style="margin: 0; color: #1d1d1f; font-size: 18px;">编辑账号</h2>
      <button onclick="this.closest('.edit-account-modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #86868b;">&times;</button>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 6px; color: #1d1d1f; font-weight: 500;">📧 邮箱地址</label>
      <input type="email" id="editEmail" value="${account.email}" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
    </div>
    
    <div style="margin-bottom: 24px;">
      <label style="display: block; margin-bottom: 6px; color: #1d1d1f; font-weight: 500;">🔑 密码</label>
      <input type="text" id="editPassword" value="${account.password}" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
    </div>
    
    <div style="display: flex; gap: 12px;">
      <button onclick="this.closest('.edit-account-modal').remove()" 
              style="flex: 1; padding: 10px; background: #f5f5f7; color: #1d1d1f; border: none; border-radius: 6px; cursor: pointer;">
        取消
      </button>
      <button onclick="saveAccountEdit('${id}')" 
              style="flex: 1; padding: 10px; background: #007aff; color: white; border: none; border-radius: 6px; cursor: pointer;">
        保存
      </button>
    </div>
  `;

  modal.className = 'edit-account-modal';
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // 点击背景关闭弹窗
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // 聚焦到邮箱输入框
  setTimeout(() => {
    document.getElementById('editEmail').focus();
  }, 100);
}

// 保存账号编辑
async function saveAccountEdit(id) {
  const emailInput = document.getElementById('editEmail');
  const passwordInput = document.getElementById('editPassword');
  
  const newEmail = emailInput.value.trim();
  const newPassword = passwordInput.value.trim();
  
  if (!newEmail || !newPassword) {
    showAlertDialog('输入错误', '邮箱和密码不能为空', 'warning');
    return;
  }
  
  if (!newEmail.includes('@')) {
    showAlertDialog('输入错误', '请输入有效的邮箱地址', 'warning');
    return;
  }
  
  try {
    // 更新本地缓存
    const accountIndex = accountsCache.findIndex(acc => acc.id === id);
    if (accountIndex !== -1) {
      accountsCache[accountIndex].email = newEmail;
      accountsCache[accountIndex].password = newPassword;
    }
    
    // 保存到文件
    const result = await ipcRenderer.invoke('save-accounts', accountsCache);
    if (result.success) {
      logger.successWithToast(`账号编辑成功: ${newEmail}`, '账号信息已更新');
      
      // 关闭弹窗
      document.querySelector('.edit-account-modal').remove();
      
      // 刷新账号列表
      await loadAccounts();
    } else {
      showAlertDialog('保存失败', result.error, 'error');
    }
  } catch (error) {
    logger.error(`账号编辑失败: ${error.message}`);
    showAlertDialog('保存失败', error.message, 'error');
  }
}

// 获取账号积分详情
async function getAccountDetails(email, password) {
  logger.info(`正在刷新账号信息: ${email}`);
  
  try {
    // 注意：IPC调用传递两个独立参数，不是对象
    const result = await ipcRenderer.invoke('get-account-details', email, password);
    
    if (result.success) {
      const data = result.data;
      
      // 检查数据是否存在
      if (!data) {
        logger.warning(`刷新账号信息失败: 返回数据为空`);
        showToast(`❌ 刷新账号信息失败: 返回数据为空`, 'error');
        return;
      }
      
      // 更新账号数据并保存
      try {
        const accounts = await ipcRenderer.invoke('get-accounts');
        const accountIndex = accounts.findIndex(acc => acc.email === email);
        
        if (accountIndex !== -1) {
          // 根据积分限额判断账号类型和绑卡状态
          let accountType = 'Free';
          let cardBound = false;  // 默认未绑卡
          
          if (data.monthlyPromptCredits >= 500) {
            accountType = 'PRO';  // 绑卡的付费PRO
            cardBound = true;  // 500积分肯定是已绑卡
          } else if (data.monthlyPromptCredits === 100) {
            accountType = 'Trial';  // 试用PRO
            cardBound = false;  // 100积分未绑卡
          } else {
            accountType = 'Free';  // 免费账号（25积分或其他）
            cardBound = false;  // 免费账号未绑卡
          }
          
          // 更新账号信息
          const updatedAccount = {
            ...accounts[accountIndex],
            accountType: accountType,
            isPro: data.isPro,
            usedPromptCredits: data.usedPromptCredits,
            monthlyPromptCredits: data.monthlyPromptCredits,
            usedFlowCredits: data.usedFlowCredits,
            monthlyFlowCredits: data.monthlyFlowCredits,
            usedPoints: data.usedPoints,
            maxPoints: data.maxPoints,
            userId: data.userId,
            name: data.name,
            lastRefreshed: new Date().toISOString(), // 添加最后刷新时间
            createdAt: data.createdAt || accounts[accountIndex].createdAt, // 更新创建时间
            expiresAt: data.expiresAt || accounts[accountIndex].expiresAt, // 更新到期时间
            usageUnknown: data.usageUnknown || false // 使用量未知标记（100积分试用账号）
          };
          
          // 总是更新绑卡状态（根据积分判断）
          updatedAccount.cardBound = cardBound;
          // 清除待标记状态
          updatedAccount.needsManualBinding = false;
          
          accounts[accountIndex] = updatedAccount;
          
          // 保存到文件
          await ipcRenderer.invoke('save-accounts', accounts);
          logger.success(`账号刷新成功: ${email}`);
        } else {
          logger.warning(`未找到账号记录: ${email}`);
        }
      } catch (error) {
        logger.error(`更新账号数据失败: ${error.message}`);
      }
      
      // 重新加载账号列表
      await loadAccounts();
      
      showToast(`账号刷新成功: ${email}`, 'success');
    } else {
      const errorMsg = result.error || '未知错误';
      
      // 判断是否是超时错误
      if (errorMsg.includes('timeout')) {
        logger.warning(`账号刷新超时: ${email}`);
        showToast(`账号刷新超时，请重试`, 'error');
      } else {
        logger.warning(`账号刷新失败: ${email}`);
        showToast(`账号刷新失败: ${email}`, 'error');
      }
    }
  } catch (error) {
    logger.warning(`账号刷新异常: ${email}`);
    showToast(`账号刷新异常: ${email}`, 'error');
  }
}

// 通用确认弹窗
function showConfirmDialog(title, message, onConfirm, onCancel = null) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  `;

  dialog.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #1d1d1f; font-size: 18px;">${title}</h3>
      <p style="margin: 0; color: #424245; line-height: 1.5; white-space: pre-line;">${message}</p>
    </div>
    
    <div style="display: flex; gap: 12px;">
      <button onclick="this.closest('.confirm-dialog').remove(); ${onCancel ? 'window.tempCancelCallback && window.tempCancelCallback();' : ''}" 
              style="flex: 1; padding: 10px; background: #f5f5f7; color: #1d1d1f; border: none; border-radius: 6px; cursor: pointer;">
        取消
      </button>
      <button onclick="this.closest('.confirm-dialog').remove(); window.tempConfirmCallback && window.tempConfirmCallback();" 
              style="flex: 1; padding: 10px; background: #ff3b30; color: white; border: none; border-radius: 6px; cursor: pointer;">
        确定
      </button>
    </div>
  `;

  modal.className = 'confirm-dialog';
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // 设置临时回调
  window.tempConfirmCallback = onConfirm;
  window.tempCancelCallback = onCancel;

  // 点击背景关闭弹窗
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      if (onCancel) onCancel();
    }
  });
}

// 通用提示弹窗
function showAlertDialog(title, message, type = 'info') {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  `;

  const typeColors = {
    info: '#007aff',
    success: '#34c759',
    warning: '#ff9500',
    error: '#ff3b30'
  };

  const typeIcons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  };

  dialog.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: ${typeColors[type]}; font-size: 18px;">
        ${typeIcons[type]} ${title}
      </h3>
      <p style="margin: 0; color: #424245; line-height: 1.5;">${message}</p>
    </div>
    
    <div style="text-align: right;">
      <button onclick="this.closest('.alert-dialog').remove()" 
              style="padding: 10px 20px; background: ${typeColors[type]}; color: white; border: none; border-radius: 6px; cursor: pointer;">
        确定
      </button>
    </div>
  `;

  modal.className = 'alert-dialog';
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // 点击背景关闭弹窗
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// 从表格删除账号
async function deleteAccountFromTable(id, email) {
  showConfirmDialog(
    '删除账号',
    `确定要删除账号 ${email} 吗？\n\n删除后无法恢复，请谨慎操作。`,
    async () => {
      try {
        const result = await ipcRenderer.invoke('delete-account', id);
        if (result.success) {
          logger.successWithToast(`删除账号: ${email}`, '账号已删除');
          await loadAccounts();
        } else {
          showAlertDialog('删除失败', result.error, 'error');
        }
      } catch (error) {
        showAlertDialog('删除失败', error.message, 'error');
      }
    }
  );
}


// 导入账号
function showImportAccountForm() {
  document.getElementById('importFile').value = '';
  document.getElementById('importPreview').value = '';
  document.getElementById('importResult').innerHTML = '';
  document.getElementById('importAccountModal').style.display = 'flex';
}

function hideImportAccountForm() {
  document.getElementById('importAccountModal').style.display = 'none';
}

async function importAccounts() {
  const text = document.getElementById('importPreview').value.trim();
  const resultEl = document.getElementById('importResult');

  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请选择文件</div>';
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let duplicateCount = 0;

  try {
    // 解析JSON格式 - 只支持直接数组格式
    const accounts = JSON.parse(text);
    
    if (!Array.isArray(accounts)) {
      throw new Error('JSON格式错误：应为账号数组格式 [{"email": "xxx", "password": "xxx"}]');
    }

    for (const acc of accounts) {
      if (!acc.email || !acc.password) {
        failCount++;
        continue;
      }

      // 检查是否已存在
      const exists = accountsCache.find(existing => existing.email === acc.email);
      if (exists) {
        duplicateCount++;
        continue;
      }

      try {
        const result = await ipcRenderer.invoke('add-account', {
          email: acc.email,
          password: acc.password
          // 不设置 createdAt，让它保持未知状态，等刷新后获取真实数据
        });
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }
  } catch (jsonError) {
    resultEl.innerHTML = '<div class="status-message status-error">文件格式错误，请选择正确的JSON文件</div>';
    return;
  }

  if (successCount > 0) {
    await loadAccounts();
    
    let message = `成功导入 ${successCount} 个账号`;
    if (duplicateCount > 0) {
      message += `，${duplicateCount} 个重复账号已跳过`;
    }
    if (failCount > 0) {
      message += `，${failCount} 个失败`;
    }
    
    resultEl.innerHTML = `
      <div class="status-message status-success">
        ${message}
      </div>
    `;
    setTimeout(() => {
      hideImportAccountForm();
    }, 2000);
  } else {
    let message = '没有成功导入任何账号';
    if (duplicateCount > 0) {
      message = `所有账号都已存在（${duplicateCount} 个重复）`;
    }
    resultEl.innerHTML = `<div class="status-message status-error">${message}</div>`;
  }
}

// 导出选中账号
async function exportAccounts() {
  logger.info('开始导出选中账号...');

  // 获取选中的账号
  const selectedAccounts = getSelectedAccounts();
  
  if (selectedAccounts.length === 0) {
    showAlertDialog('导出失败', '请先选择要导出的账号', 'warning');
    return;
  }

  // 导出为直接的数组格式
  const exportData = selectedAccounts.map(acc => ({
    email: acc.email,
    password: acc.password
  }));

  const content = JSON.stringify(exportData, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `selected-accounts-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);

  logger.successWithToast(`成功导出 ${selectedAccounts.length} 个选中账号`, `已导出 ${selectedAccounts.length} 个账号`);
}


// 初始化事件监听
function initAccountEvents() {
  // 导入文件监听
  const importInput = document.getElementById('importFile');
  if (importInput) {
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById('importPreview').value = text;
    });
  }
}

// 点击页面其他地方关闭菜单
document.addEventListener('click', () => {
  document.querySelectorAll('.action-menu').forEach(m => {
    m.classList.remove('show');
  });
});

// 切换密码显示/隐藏
function togglePassword(accountId, password) {
  const pwdElement = document.getElementById(`pwd-${accountId}`);
  const eyeButton = document.getElementById(`eye-${accountId}`);
  if (!pwdElement || !eyeButton) return;
  
  if (pwdElement.textContent === '••••••••') {
    // 显示密码
    pwdElement.textContent = password;
    // 切换为"眼睛斜杠"图标（表示可以隐藏）
    eyeButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
  } else {
    // 隐藏密码
    pwdElement.textContent = '••••••••';
    // 切换为"眼睛"图标（表示可以显示）
    eyeButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }
}

// 标记绑卡状态
async function markCardBound(email, success) {
  try {
    const result = await ipcRenderer.invoke('mark-card-bound', { email, success });
    if (result.success) {
      showToast(success ? '✅ 已标记绑卡成功' : '❌ 已标记绑卡失败', 'success');
      await loadAccounts(); // 刷新列表
    } else {
      showToast('标记失败: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('标记失败: ' + error.message, 'error');
  }
}

// 切换添加账号菜单
function toggleAddAccountMenu() {
  const menu = document.getElementById('addAccountMenu');
  if (!menu) return;
  
  const isVisible = menu.style.display === 'block';
  menu.style.display = isVisible ? 'none' : 'block';
}

// 点击页面其他地方关闭添加账号菜单
document.addEventListener('click', (e) => {
  const menu = document.getElementById('addAccountMenu');
  const button = e.target.closest('button[onclick*="toggleAddAccountMenu"]');
  
  if (menu && !button && !menu.contains(e.target)) {
    menu.style.display = 'none';
  }
});

// ==================== 批量绑卡功能 ====================

// 全选/取消全选
function toggleSelectAllAccounts() {
  const selectAll = document.getElementById('selectAllAccounts');
  const checkboxes = document.querySelectorAll('.account-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAll.checked;
  });
  
  updateSelectedBindCount();
}

// 更新已选择账号数量
function updateSelectedBindCount() {
  const checkboxes = document.querySelectorAll('.account-checkbox:checked');
  const count = checkboxes.length;
  const countEl = document.getElementById('selectedBindCount');
  if (countEl) {
    countEl.textContent = `已选择 ${count} 个账号`;
  }
}

// 选择未绑卡账号
async function selectUnboundAccounts() {
  let count = 0;
  
  // 获取当前登录账号的邮箱，避免选中它（使用缓存）
  let currentEmail = currentEmailCache;
  
  accountsCache.forEach((account, index) => {
    const checkbox = document.querySelector(`#accountsList tr:nth-child(${index + 1}) .account-checkbox`);
    if (!checkbox) return;
    
    // 跳过当前登录的账号
    if (currentEmail && account.email === currentEmail) {
      checkbox.checked = false;
      return;
    }
    
    // 判断是否未绑卡（cardBound 为 false 或 undefined）
    if (!account.cardBound) {
      checkbox.checked = true;
      count++;
    } else {
      checkbox.checked = false;
    }
  });
  
  updateSelectedBindCount();
  showToast(`已选择 ${count} 个未绑卡账号`, 'success');
}

// 切换快速筛选菜单
function toggleQuickFilterMenu() {
  const menu = document.getElementById('quickFilterMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
  
  // 点击外部关闭菜单
  if (menu && menu.style.display === 'block') {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('#quickFilterMenu') && !e.target.closest('button[onclick*="toggleQuickFilterMenu"]')) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }
}

// 选择可清理的账号（已过期 或 积分完全耗尽）
function selectAccountsForCleanup() {
  let count = 0;
  
  accountsCache.forEach((account, index) => {
    const checkbox = document.querySelector(`#accountsList tr:nth-child(${index + 1}) .account-checkbox`);
    if (!checkbox) return;
    
    let canCleanup = false;
    
    // 检查是否已过期
    if (account.createdAt) {
      const expiry = calculateExpiry(account.createdAt);
      if (expiry.isExpired) {
        canCleanup = true;
      }
    }
    
    // 检查积分是否完全耗尽（使用率100%）
    const used = account.usedPromptCredits || 0;
    const total = account.monthlyPromptCredits || 500;
    if (total > 0 && used >= total) {
      canCleanup = true;
    }
    
    if (canCleanup) {
      checkbox.checked = true;
      count++;
    } else {
      checkbox.checked = false;
    }
  });
  
  updateSelectedBindCount();
  showToast(`已选择 ${count} 个可清理的账号`, 'warning');
}

// 全选所有账号
function selectAllAccountsCheckbox() {
  const checkboxes = document.querySelectorAll('#accountsList .account-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
  });
  updateSelectedBindCount();
  showToast(`已全选 ${checkboxes.length} 个账号`, 'success');
}

// 反选
function invertSelection() {
  const checkboxes = document.querySelectorAll('#accountsList .account-checkbox');
  let count = 0;
  checkboxes.forEach(checkbox => {
    checkbox.checked = !checkbox.checked;
    if (checkbox.checked) count++;
  });
  updateSelectedBindCount();
  showToast(`反选完成，当前选中 ${count} 个账号`, 'success');
}

// 取消选择所有账号
function deselectAllAccounts() {
  const checkboxes = document.querySelectorAll('#accountsList .account-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  updateSelectedBindCount();
  showToast('已取消所有选择', 'success');
}

// 切换更多操作菜单
function toggleMoreActionsMenu() {
  const menu = document.getElementById('moreActionsMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
  
  // 点击外部关闭菜单
  if (menu && menu.style.display === 'block') {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('#moreActionsMenu') && !e.target.closest('button[onclick*="toggleMoreActionsMenu"]')) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }
}

// 刷新选中账号的积分数据
async function refreshSelectedAccounts() {
  const selectedAccounts = getSelectedAccounts();
  
  if (selectedAccounts.length === 0) {
    showToast('请先选择要刷新的账号', 'warning');
    return;
  }
  
  logger.info(`开始刷新 ${selectedAccounts.length} 个账号的积分数据...`);
  showToast(`正在刷新 ${selectedAccounts.length} 个账号...`, 'info');
  
  let successCount = 0;
  let failCount = 0;
  
  // 获取最新的账号列表
  let accounts = await ipcRenderer.invoke('get-accounts');
  let dataChanged = false;
  
  for (const account of selectedAccounts) {
    try {
      // 使用与单独刷新相同的IPC调用
      const result = await ipcRenderer.invoke('get-account-details', account.email, account.password);
      if (result.success && result.data) {
        const data = result.data;
        const accountIndex = accounts.findIndex(acc => acc.email === account.email);
        
        if (accountIndex !== -1) {
          // 根据积分限额判断账号类型
          let accountType = 'Free';
          let cardBound = undefined;
          
          if (data.monthlyPromptCredits >= 500) {
            accountType = 'PRO';
            cardBound = true;
          } else if (data.monthlyPromptCredits === 100) {
            accountType = 'Trial';
          } else if (data.monthlyPromptCredits === 25) {
            accountType = 'Free';
          }
          
          // 更新账号信息
          const updatedAccount = {
            ...accounts[accountIndex],
            accountType: accountType,
            isPro: data.isPro,
            usedPromptCredits: data.usedPromptCredits,
            monthlyPromptCredits: data.monthlyPromptCredits,
            usedFlowCredits: data.usedFlowCredits,
            monthlyFlowCredits: data.monthlyFlowCredits,
            usedPoints: data.usedPoints,
            maxPoints: data.maxPoints,
            userId: data.userId,
            name: data.name
          };
          
          // 只在500积分时更新绑卡状态
          if (cardBound !== undefined) {
            updatedAccount.cardBound = cardBound;
            updatedAccount.needsManualBinding = false;
          }
          
          accounts[accountIndex] = updatedAccount;
          dataChanged = true;
        }
        
        successCount++;
        logger.success(`${account.email} 刷新成功`);
      } else {
        failCount++;
        logger.error(`${account.email} 刷新失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      failCount++;
      logger.error(`${account.email} 刷新异常: ${error.message}`);
    }
  }
  
  // 如果有数据变化，保存到文件
  if (dataChanged) {
    try {
      await ipcRenderer.invoke('save-accounts', accounts);
      logger.success('账号数据已保存');
    } catch (error) {
      logger.error(`保存账号数据失败: ${error.message}`);
    }
  }
  
  // 刷新完成后重新加载账号列表
  await loadAccounts();
  showToast(`刷新完成！成功 ${successCount} 个，失败 ${failCount} 个`, successCount > 0 ? 'success' : 'warning');
  logger.info(`批量刷新完成：成功 ${successCount} 个，失败 ${failCount} 个`);
}

// 导出选中的账号
async function exportSelectedAccounts() {
  const selectedAccounts = getSelectedAccounts();
  
  if (selectedAccounts.length === 0) {
    showToast('请先选择要导出的账号', 'warning');
    return;
  }
  
  // 格式化账号数据
  const exportData = selectedAccounts.map(acc => `${acc.email} ${acc.password || ''}`).join('\n');
  
  // 创建下载
  const blob = new Blob([exportData], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `windsurf_accounts_selected_${new Date().getTime()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  logger.successWithToast(`导出选中账号：${selectedAccounts.length} 个`, `已导出 ${selectedAccounts.length} 个账号`);
}

// 删除选中的账号
async function deleteSelectedAccounts() {
  const selectedAccounts = getSelectedAccounts();
  
  if (selectedAccounts.length === 0) {
    showToast('请先选择要删除的账号', 'warning');
    return;
  }
  
  // 使用优化的确认弹窗
  showConfirmDialog(
    '批量删除账号',
    `确定要删除选中的 ${selectedAccounts.length} 个账号吗？\n\n此操作不可恢复，请谨慎操作！`,
    async () => {
      logger.warning(`开始批量删除 ${selectedAccounts.length} 个账号...`);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const account of selectedAccounts) {
        try {
          const result = await ipcRenderer.invoke('delete-account', account.email);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
            logger.error(`删除 ${account.email} 失败: ${result.error}`);
          }
        } catch (error) {
          failCount++;
          logger.error(`删除 ${account.email} 异常: ${error.message}`);
        }
      }
      
      // 删除完成后重新加载账号列表
      await loadAccounts();
      showToast(`删除完成！成功 ${successCount} 个，失败 ${failCount} 个`, 'success');
      logger.success(`批量删除完成：成功 ${successCount} 个，失败 ${failCount} 个`);
    }
  );
}

// 获取选中的账号列表
function getSelectedAccounts() {
  const selected = [];
  const checkboxes = document.querySelectorAll('#accountsList .account-checkbox:checked');
  
  checkboxes.forEach((checkbox, index) => {
    // 通过复选框找到对应的账号索引
    const row = checkbox.closest('tr');
    const rowIndex = Array.from(row.parentElement.children).indexOf(row);
    if (accountsCache[rowIndex]) {
      selected.push(accountsCache[rowIndex]);
    }
  });
  
  return selected;
}

// 显示绑卡日志窗口
function showBindingLog() {
  const modal = document.getElementById('bindingLogModal');
  if (modal) {
    modal.style.display = 'flex';
    // 重置日志内容
    const logContent = document.getElementById('bindingLogContent');
    if (logContent) {
      logContent.innerHTML = '<div style="color:#86868b;">准备开始绑卡...</div>';
    }
    // 重置进度条
    const progressBar = document.getElementById('bindProgressBar');
    const progressText = document.getElementById('bindProgressText');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0/0';
  }
}

// 隐藏绑卡日志窗口
function hideBindingLog() {
  const modal = document.getElementById('bindingLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 添加绑卡日志
function addBindingLog(message, email = null) {
  const logContent = document.getElementById('bindingLogContent');
  if (!logContent) return;
  
  const logEntry = document.createElement('div');
  
  // 根据消息内容设置颜色
  let color = '#1d1d1f';
  if (message.includes('成功') || message.includes('完成') || message.includes('已')) {
    color = '#34c759';
  } else if (message.includes('失败') || message.includes('错误') || message.includes('异常')) {
    color = '#ff3b30';
  } else if (message.includes('警告') || message.includes('注意') || message.includes('超时')) {
    color = '#ff9500';
  } else if (message.includes('📧') || message.includes('🚀') || message.includes('💳')) {
    color = '#007aff';
  }
  
  logEntry.style.color = color;
  // 后端已包含完整的时间戳,直接显示
  logEntry.innerHTML = message;
  
  logContent.appendChild(logEntry);
  
  // 自动滚动到底部
  logContent.scrollTop = logContent.scrollHeight;
}

// 全局变量：当前正在处理的账号
let currentBindingAccount = { email: '', password: '' };

// 更新当前绑卡账号
function updateCurrentBindingAccount(email, password) {
  currentBindingAccount = { email, password };
}

// 确认当前账号绑卡成功
function confirmCurrentBindSuccess() {
  if (!currentBindingAccount.email) {
    showAlertDialog('提示', '没有正在处理的账号', 'warning');
    return;
  }
  confirmBindSuccess(currentBindingAccount.email);
}

// 重试当前账号绑卡
function retryCurrentBinding() {
  if (!currentBindingAccount.email) {
    showAlertDialog('提示', '没有正在处理的账号', 'warning');
    return;
  }
  retryBinding(currentBindingAccount.email, currentBindingAccount.password);
}

// 开始批量绑卡
async function startBatchBinding() {
  const selectedAccounts = getSelectedAccounts();
  
  if (selectedAccounts.length === 0) {
    showAlertDialog('提示', '请先选择需要绑卡的账号', 'warning');
    return;
  }
  
  const accounts = selectedAccounts.map(acc => ({
    email: acc.email,
    password: acc.password
  }));
  
  // 获取选中的虚拟卡
  const selectedCardId = getSelectedCardId();
  
  // 检查是否选择了完整卡且批量绑卡
  if (selectedCardId !== 'auto' && accounts.length > 1) {
    try {
      const result = await ipcRenderer.invoke('get-cards');
      if (result.success && result.cards) {
        const selectedCard = result.cards.find(c => c.id === selectedCardId);
        if (selectedCard && selectedCard.type === 'full') {
          showConfirmDialog(
            '⚠️ 风险提示',
            `你选择了完整卡进行批量绑卡（${accounts.length}个账号）。\n\n使用同一张完整卡绑定多个账号可能导致：\n• 被Stripe风控系统检测\n• 所有账号被封禁\n• 虚拟卡被拉黑\n\n建议：\n• 使用BIN卡头（每次自动生成不同卡号）\n• 或者每次只绑定1个账号\n\n确定要继续使用完整卡批量绑卡吗？`,
            () => {
              // 确认后继续执行绑卡
              executeBatchBinding(accounts, selectedCardId);
            },
            async () => {
              logger.warning('用户取消了批量绑卡操作');
            }
          );
          return; // 等待用户确认
        }
      }
    } catch (error) {
      // 检查虚拟卡类型失败，静默处理
    }
  }
  
  // 直接执行绑卡
  executeBatchBinding(accounts, selectedCardId);
}

// 执行批量绑卡
async function executeBatchBinding(accounts, selectedCardId) {
  // 显示绑卡日志窗口
  showBindingLog();
  
  try {
    const result = await ipcRenderer.invoke('batch-bind-cards', { accounts, selectedCardId });
    
    if (result && result.successCount > 0) {
      
      // 刷新账号列表
      await loadAccounts();
    }
  } catch (error) {
    showToast('批量绑卡异常: ' + error.message, 'error');
  }
}

// 用户确认绑卡成功
async function confirmBindSuccess(email) {
  try {
    const result = await ipcRenderer.invoke('confirm-bind-success', { email });
    
    if (result && result.success) {
      // 后端已经有日志，前端不需要重复发送
      
      // 刷新账号列表
      await loadAccounts();
    }
  } catch (error) {
    showToast('确认绑卡异常: ' + error.message, 'error');
  }
}

// 重新绑卡（单个账号）
async function retryBinding(email, password) {
  
  try {
    const result = await ipcRenderer.invoke('retry-bind-card', { email, password });
    
    if (result && result.success) {
      
      // 刷新账号列表
      await loadAccounts();
    }
  } catch (error) {
    showToast('重新绑卡异常: ' + error.message, 'error');
  }
}

// 监听绑卡日志
ipcRenderer.on('binding-log', (event, data) => {
  addBindingLog(data.message, data.email);
});

// 监听更新当前账号事件
ipcRenderer.on('show-binding-actions', (event, data) => {
  updateCurrentBindingAccount(data.email, data.password);
});

// 监听绑卡进度
ipcRenderer.on('binding-progress', (event, progress) => {
  const progressBar = document.getElementById('bindProgressBar');
  const progressText = document.getElementById('bindProgressText');
  if (progressBar && progressText) {
    const percent = Math.round((progress.current / progress.total) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${progress.current}/${progress.total}`;
  }
});

// 监听刷新数据事件
ipcRenderer.on('refresh-data', async () => {
  // 刷新账号列表
  await loadAccounts();
  // 刷新虚拟卡列表（如果在虚拟卡管理页面）
  if (typeof window.loadCards === 'function') {
    await window.loadCards();
  }
});

// 显示切号日志窗口
function showSwitchLog() {
  const modal = document.getElementById('switchLogModal');
  if (modal) {
    modal.style.display = 'flex';
    // 清空之前的日志
    const logContent = document.getElementById('switchLogContent');
    if (logContent) {
      logContent.innerHTML = '<div style="color:#86868b;">准备开始切换...</div>';
    }
    // 重置进度条
    const progressBar = document.getElementById('switchProgressBar');
    const statusText = document.getElementById('switchStatusText');
    if (progressBar) progressBar.style.width = '0%';
    if (statusText) statusText.textContent = '准备中...';
  }
}

// 隐藏切号日志窗口
function hideSwitchLog() {
  const modal = document.getElementById('switchLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 添加日志到切号窗口
function addSwitchLog(message, type = 'info') {
  const logContent = document.getElementById('switchLogContent');
  if (!logContent) return;
  
  const typeColors = {
    info: '#007aff',
    success: '#34c759', 
    warning: '#ff9500',
    error: '#ff3b30'
  };
  
  const color = typeColors[type] || '#1d1d1f';
  // 后端已包含完整的时间戳,直接显示
  const logEntry = `<div style="color:${color}; margin-bottom:4px;">${message}</div>`;
  
  logContent.innerHTML += logEntry;
  
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

// 更新切号进度
function updateSwitchProgress(current, total, status) {
  const progressBar = document.getElementById('switchProgressBar');
  const statusText = document.getElementById('switchStatusText');
  
  if (progressBar && total > 0) {
    const percentage = Math.round((current / total) * 100);
    progressBar.style.width = `${percentage}%`;
  }
  
  if (statusText) {
    statusText.textContent = status || `${current}/${total}`;
  }
}

// 自动切号功能
async function switchAccount(email, password) {
  // 显示切号日志窗口
  showSwitchLog();
  
  try {
    const result = await ipcRenderer.invoke('switch-account', { email, password });
    
    if (result.success) {
      if (result.windsurfStarted) {
        showToast(`切号成功: ${result.account.email}`, 'success');
        
        // 等待一下让 Windsurf 完全启动
        setTimeout(() => {
          // 清除当前登录账号缓存
          currentEmailCache = null;
          
          // 刷新首页信息
          if (typeof window.refreshSystemInfo === 'function') {
            window.refreshSystemInfo();
          }
          
          // 切换到首页显示新账号信息
          if (typeof window.switchTab === 'function') {
            window.switchTab('home');
          }
        }, 3000);
      } else if (result.needsRestart) {
        showToast('切号成功！请重新启动 Windsurf 使用新账号', 'success');
      } else {
        showToast('切号成功', 'success');
      }
    } else {
      const errorMsg = result.error || '未知错误';
      showToast(`切号失败: ${errorMsg}`, 'error');
    }
  } catch (error) {
    showToast(`切号异常: ${error.message}`, 'error');
  }
}

// 监听切号日志（由后端 logger 统一发送）
ipcRenderer.on('switch-log', (event, log) => {
  // 提取消息内容（后端发送的是对象 {message: ...}）
  const message = typeof log === 'object' && log.message ? log.message : log;
  addSwitchLog(message, 'info');
});

// 监听切号进度（专门的进度事件）
ipcRenderer.on('switch-progress', (event, progress) => {
  updateSwitchProgress(progress.current, progress.total, progress.status);
});

// ==================== 批量取消订阅 ====================

// 显示取消订阅日志窗口
function showCancelLog() {
  const modal = document.getElementById('cancelLogModal');
  if (modal) {
    modal.style.display = 'flex';
    // 清空之前的日志
    const logContent = document.getElementById('cancelLogContent');
    if (logContent) {
      logContent.innerHTML = '<div style="color:#86868b;">准备开始取消订阅...</div>';
    }
    // 重置进度
    updateCancelProgress(0, 0, 0, 0);
    // 显示取消按钮
    const cancelBtn = document.getElementById('cancelCancelBtn');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
  }
}

// 隐藏取消订阅日志窗口
function hideCancelLog() {
  const modal = document.getElementById('cancelLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
  // 隐藏取消按钮
  const cancelBtn = document.getElementById('cancelCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// 添加取消订阅日志
function addCancelLog(message, type = 'info') {
  const logContent = document.getElementById('cancelLogContent');
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
  if (type === 'success' || message.includes('成功') || message.includes('完成') || message.includes('✅')) {
    color = '#34c759';
  } else if (type === 'error' || message.includes('失败') || message.includes('错误') || message.includes('异常') || message.includes('❌')) {
    color = '#ff3b30';
  } else if (type === 'warning' || message.includes('警告') || message.includes('注意') || message.includes('⚠️')) {
    color = '#ff9500';
  } else if (type === 'info' || message.includes('开始') || message.includes('正在') || message.includes('🚀') || message.includes('📋')) {
    color = '#007aff';
  }
  
  const logLine = document.createElement('div');
  logLine.style.cssText = `color: ${color}; word-wrap: break-word; margin-bottom: 2px;`;
  logLine.textContent = message;
  
  logContent.appendChild(logLine);
  
  // 自动滚动到底部
  logContent.scrollTop = logContent.scrollHeight;
}

// 更新取消订阅进度
function updateCancelProgress(completed, total, succeeded, failed) {
  const progressText = document.getElementById('cancelProgressText');
  const progressBar = document.getElementById('cancelProgressBar');
  
  if (progressText) {
    progressText.textContent = `${completed}/${total} (成功: ${succeeded}, 失败: ${failed})`;
  }
  
  if (progressBar && total > 0) {
    const percentage = (completed / total) * 100;
    progressBar.style.width = `${percentage}%`;
  }
}

// 开始批量取消订阅
async function startBatchCancel() {
  try {
    // 1. 获取选中的账号
    const selectedAccounts = getSelectedAccounts();
    
    // 2. 验证
    if (selectedAccounts.length === 0) {
      showToast('请先选择要取消订阅的账号', 'warning');
      return;
    }
    
    // 验证账号是否有密码
    const accountsWithoutPassword = selectedAccounts.filter(acc => !acc.password);
    if (accountsWithoutPassword.length > 0) {
      showToast(`有 ${accountsWithoutPassword.length} 个账号没有保存密码，无法取消订阅`, 'error');
      return;
    }
    
    // 3. 确认操作
    const confirmMsg = `确定要取消 ${selectedAccounts.length} 个账号的订阅吗？

此操作将：
• 取消自动续费
• 订阅到期后不再续订`;
    
    showConfirmDialog(
      '批量取消订阅',
      confirmMsg,
      async () => {
        // 4. 显示日志窗口
        showCancelLog();
        
        // 5. 根据选中账号数量设置并发数（最大5）
        const concurrent = Math.min(selectedAccounts.length, 5);
        
        // 6. 调用 IPC（后端 logger 会自动发送日志到窗口）
        const result = await ipcRenderer.invoke('batch-cancel-subscription', {
          accounts: selectedAccounts,
          concurrent: concurrent
        });
        
        // 7. 处理结果
        if (result.success) {
          showToast(`取消完成：成功 ${result.succeeded} 个，失败 ${result.failed} 个`, 'success');
          
          // 刷新账号列表
          setTimeout(() => {
            loadAccounts();
          }, 2000);
        } else {
          showToast('批量取消失败', 'error');
        }
        
        // 隐藏取消按钮
        const cancelBtn = document.getElementById('cancelCancelBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    );
    
  } catch (error) {
    showToast(`取消订阅异常: ${error.message}`, 'error');
  }
}

// 取消当前取消订阅操作
async function cancelCancelOperation() {
  try {
    const result = await ipcRenderer.invoke('cancel-subscription-operation');
    if (result.success) {
      showToast('取消请求已发送', 'info');
    } else {
      showToast(result.message || '取消失败', 'error');
    }
  } catch (error) {
    showToast('取消操作失败', 'error');
  }
}

// 监听取消订阅日志
ipcRenderer.on('cancel-log', (event, log) => {
  const message = typeof log === 'object' && log.message ? log.message : log;
  addCancelLog(message, 'info');
});

// 监听取消订阅进度
ipcRenderer.on('cancel-progress', (event, progress) => {
  updateCancelProgress(
    progress.completed || 0,
    progress.total || 0,
    progress.succeeded || 0,
    progress.failed || 0
  );
  
});

// 导出模块并暴露到全局
const accountsModule = {
  loadAccounts,
  setCurrentEmailCache,
  renderAccounts,
  deleteAccountFromTable,
  updateAccountStats,
  exportAccounts,
  showAddAccountForm,
  hideAddAccountForm,
  addManualAccount,
  showImportAccountForm,
  hideImportAccountForm,
  importAccounts,
  toggleSelectAllAccounts,
  updateSelectedBindCount,
  switchAccount,
  markCardBound,
  toggleAddAccountMenu,
  selectUnboundAccounts,
  startBatchBinding,
  retryBinding,
  getAccountDetails,
  toggleActionMenu,
  copyAccountRow,
  viewAccount,
  editAccount,
  saveAccountEdit,
  togglePassword,
  showConfirmDialog,
  showAlertDialog,
  showSwitchLog,
  hideSwitchLog,
  addSwitchLog,
  updateSwitchProgress,
  toggleQuickFilterMenu,
  selectAccountsForCleanup,
  selectAllAccountsCheckbox,
  invertSelection,
  deselectAllAccounts,
  toggleMoreActionsMenu,
  refreshSelectedAccounts,
  exportSelectedAccounts,
  deleteSelectedAccounts,
  toggleCardSelector,
  getSelectedCardId,
  hideBindingLog,
  confirmCurrentBindSuccess,
  retryCurrentBinding,
  startBatchCancel,
  showCancelLog,
  hideCancelLog,
  addCancelLog,
  updateCancelProgress,
  cancelCancelOperation
};

Object.assign(window, accountsModule);
module.exports = accountsModule;

// DOM加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccountEvents);
} else {
  initAccountEvents();
}
