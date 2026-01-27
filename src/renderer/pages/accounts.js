/**
 * 账号管理模块
 */

const { ipcRenderer } = require('electron');
const { showToast, calculateExpiry, processAccountCredits, formatDateTime, handleError, generateEmptyStateHTML, createModal } = require('../utils/utils');

// ==================== 全局变量 ====================
let accountsCache = [];
let availableCards = [];
let currentEmailCache = null; // 缓存当前登录账号，避免重复获取
let selectedCardId = 'auto';

// 设置当前登录账号缓存
function setCurrentEmailCache(email) {
  currentEmailCache = email;
}


// ==================== 账号数据管理 ====================
async function loadAccounts() {
  try {
    const accounts = await ipcRenderer.invoke('get-accounts');
    accountsCache = accounts || [];
    await renderAccounts();
    updateAccountStats();
    updateSelectedBindCount(); // 重置选中计数
  } catch (error) {
    await handleError(error, '加载账号', true);
  }
}

// ==================== 虚拟卡选择器（通用） ====================

// 选择器配置
const cardSelectors = {
  main: { 
    dropdownId: 'cardSelectorDropdown', 
    buttonId: 'selectedCardButton',
    selectedId: 'auto'
  },
  retry: { 
    dropdownId: 'retryCardSelectorDropdown', 
    buttonId: 'retryCardButton',
    selectedId: 'auto'
  }
};

// 当前打开的选择器key
let currentSelectorKey = null;

// 通用：显示虚拟卡选择弹窗
async function showCardSelectorModal(selectorKey) {
  currentSelectorKey = selectorKey;
  
  // 移除已存在的弹窗
  const existingModal = document.getElementById('cardSelectorModal');
  if (existingModal) existingModal.remove();
  
  try {
    const result = await ipcRenderer.invoke('get-cards');
    availableCards = result.success ? result.cards || [] : [];
    
    // 创建弹窗
    const modal = document.createElement('div');
    modal.id = 'cardSelectorModal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.3); z-index:10000; justify-content:center; align-items:center;';
    
    modal.innerHTML = `
      <div style="background:white; border-radius:12px; width:380px; max-height:70vh; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.2);">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #e5e5ea;">
          <h3 style="margin:0; font-size:16px; font-weight:600; color:#1d1d1f;">选择虚拟卡</h3>
          <button id="cardSelectorModalClose" style="background:none; border:none; font-size:24px; cursor:pointer; color:#86868b;">&times;</button>
        </div>
        <div id="cardSelectorModalContent" style="max-height:calc(70vh - 60px); overflow-y:auto; padding:8px 0;"></div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 绑定关闭按钮事件
    document.getElementById('cardSelectorModalClose').addEventListener('click', closeCardSelectorModal);
    
    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCardSelectorModal();
    });
    
    // 渲染卡片选项
    renderCardOptionsInModal();
  } catch (error) {
    showToast('加载虚拟卡失败', 'error');
  }
}

// 关闭虚拟卡选择弹窗
function closeCardSelectorModal() {
  const modal = document.getElementById('cardSelectorModal');
  if (modal) modal.remove();
  currentSelectorKey = null;
}

// 在弹窗中渲染卡片选项
function renderCardOptionsInModal() {
  const container = document.getElementById('cardSelectorModalContent');
  if (!container || !currentSelectorKey) return;
  
  const config = cardSelectors[currentSelectorKey];
  container.innerHTML = '';
  
  // 自动选择选项
  const autoOption = createModalCardOption('auto', '自动选择', '系统自动选择最适合的虚拟卡', getIcon('refresh', 16), config.selectedId === 'auto');
  container.appendChild(autoOption);
  
  if (availableCards.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'text-align:center; padding:20px; color:#86868b; font-size:12px;';
    emptyDiv.textContent = '暂无其他虚拟卡';
    container.appendChild(emptyDiv);
    return;
  }
  
  const binCards = availableCards.filter(c => c.type === 'bin');
  const fullCards = availableCards.filter(c => c.type === 'full');
  
  let binIndex = 1;
  let fullIndex = 1;
  
  binCards.forEach(card => {
    const mainInfo = `${binIndex}. ${card.bin ? card.bin.substring(0, 6) + 'xxxxxx' : '未知BIN'}`;
    const subInfo = `随机生成卡号 · ${card.bindCount > 0 ? `已绑${card.bindCount}次` : '未使用'}`;
    container.appendChild(createModalCardOption(card.id, mainInfo, subInfo, getIcon('cardBin', 16), config.selectedId === card.id));
    binIndex++;
  });
  
  fullCards.forEach(card => {
    const formattedNum = (card.number || '').replace(/(.{4})/g, '$1 ').trim();
    const mainInfo = `${fullIndex}. ${formattedNum}`;
    const subInfo = `EXP: ${card.expMonth || 'MM'}/${card.expYear || 'YY'} · CVV: ${card.cvv || '***'} · ${card.bindCount > 0 ? `${card.bindCount}次` : '未使用'}`;
    container.appendChild(createModalCardOption(card.id, mainInfo, subInfo, getIcon('creditCard', 16), config.selectedId === card.id));
    fullIndex++;
  });
}

// 创建弹窗中的卡片选项
function createModalCardOption(cardId, mainText, subText, icon, isSelected) {
  const option = document.createElement('div');
  option.style.cssText = `display:flex; align-items:center; padding:12px 20px; cursor:pointer; gap:12px; transition:background 0.2s; ${isSelected ? 'background:#f0f7ff;' : ''}`;
  option.onmouseenter = () => { if (!isSelected) option.style.background = '#f5f5f7'; };
  option.onmouseleave = () => { if (!isSelected) option.style.background = 'transparent'; };
  
  option.innerHTML = `
    <div style="width:32px; height:32px; background:#f5f5f7; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#007aff;">${icon}</div>
    <div style="flex:1; min-width:0;">
      <div style="font-size:13px; font-weight:500; color:#1d1d1f;">${mainText}</div>
      <div style="font-size:11px; color:#86868b; margin-top:2px;">${subText}</div>
    </div>
    ${isSelected ? '<div style="color:#007aff; font-size:16px;">✓</div>' : ''}
  `;
  
  option.addEventListener('click', () => selectCardFromModal(cardId));
  return option;
}

// 从弹窗选择卡片
function selectCardFromModal(cardId) {
  if (!currentSelectorKey) return;
  
  const config = cardSelectors[currentSelectorKey];
  config.selectedId = cardId;
  
  // 更新全局变量（兼容旧代码）
  if (currentSelectorKey === 'main') selectedCardId = cardId;
  
  // 更新待确认列表中的选择
  if (currentSelectorKey.startsWith('pending_')) {
    const email = currentSelectorKey.replace('pending_', '').replace(/_/g, '.');
    // 找到对应账号并更新
    const acc = pendingBindingAccounts.find(a => a.email.replace(/[^a-zA-Z0-9]/g, '_') === currentSelectorKey.replace('pending_', ''));
    if (acc) acc.selectedCardId = cardId;
  }
  
  updateCardButtonGeneric(currentSelectorKey);
  closeCardSelectorModal();
}

// 更新按钮显示
function updateCardButtonGeneric(selectorKey) {
  const config = cardSelectors[selectorKey];
  const button = document.getElementById(config.buttonId);
  if (!button) return;
  
  if (config.selectedId === 'auto') {
    button.textContent = '选择虚拟卡';
  } else {
    const card = availableCards.find(c => c.id === config.selectedId);
    if (card) {
      const icon = card.type === 'bin' ? '🎲' : '💳';
      const num = card.type === 'bin' 
        ? (card.bin ? card.bin.substring(0, 6) + 'xx' : '未知')
        : (card.number ? card.number.substring(0, 4) + ' ' + card.number.substring(4, 8) + '...' : '未知');
      button.textContent = `${icon} ${num}`;
    }
  }
}

// 统一接口
function toggleCardSelector() { showCardSelectorModal('main'); }
function toggleRetryCardSelector() { showCardSelectorModal('retry'); }
function toggleCardSelectorGeneric(selectorKey) { showCardSelectorModal(selectorKey); }
function getSelectedCardId() { return cardSelectors.main.selectedId; }
function getRetrySelectedCardId() { return cardSelectors.retry.selectedId; }

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
  // 使用统一的积分和PRO账号处理函数，传入 planType
  const creditsInfo = processAccountCredits(acc.usedPromptCredits, acc.monthlyPromptCredits, acc.usageUnknown, acc.planType);
  
  // 绑卡状态 - 后端已根据积分判断，前端只负责显示
  let cardBoundHtml;
  if (acc.needsManualBinding === true) {
    // 需要手动确认绑卡结果
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
  
  // Refresh Token 状态（有 Token 可以无密码刷新）- 紫色区分
  const tokenHtml = acc.refreshToken 
    ? '<span style="color:#af52de; font-size:12px;">● 已获取</span>'
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
function generateAccountRowHTML(acc, styles, isCurrentAccount = false, index = 0) {
  const rowClass = isCurrentAccount ? 'current-account-row' : '';
  const indexStr = index > 0 ? `${index}. ` : '';

  return `
    <tr data-id="${acc.id}" class="${rowClass}" onclick="toggleAccountCheckbox('${acc.id}')" style="cursor: pointer;">
      <td style="width: 40px; text-align: center;" onclick="event.stopPropagation()">
        <input type="checkbox" class="account-checkbox" data-email="${acc.email}" data-password="${acc.password}" data-id="${acc.id}" onchange="updateSelectedBindCount()">
      </td>
      <td ondblclick="copyAccountRow('${acc.email}', '${acc.password}'); event.stopPropagation();" title="双击复制账号密码">
        <div class="account-email-cell">${indexStr}${acc.email}</div>
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
          <button class="action-btn primary" onclick="getAccountDetails('${acc.email}'); event.stopPropagation();" title="刷新信息">
            ${getIcon('refreshCw', 16)}
          </button>
          <button class="action-btn" onclick="toggleActionMenu(event, '${acc.id}')">
            ${getIcon('moreVertical', 16)}
          </button>
        </div>
      </td>
    </tr>
  `;
}

// ==================== 账号列表渲染 ====================
let currentSearchKeyword = ''; // 当前搜索关键词
let currentFilterType = 'all'; // 当前筛选类型

// 根据邮箱过滤账号
function filterAccountsByEmail(keyword) {
  currentSearchKeyword = keyword.trim().toLowerCase();
  renderAccounts();
}

async function renderAccounts() {
  const tbody = document.getElementById('accountsList');
  if (!tbody) return;

  // 获取当前登录账号（优先使用缓存，但确保数据是最新的）
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

  // 根据搜索关键词过滤账号
  let filteredAccounts = accountsCache;
  if (currentSearchKeyword) {
    filteredAccounts = filteredAccounts.filter(acc => 
      acc.email && acc.email.toLowerCase().includes(currentSearchKeyword)
    );
  }
  
  // 根据类型筛选
  if (currentFilterType && currentFilterType !== 'all') {
    filteredAccounts = filteredAccounts.filter(acc => {
      if (currentFilterType === 'unbound') {
        return !acc.cardBound;
      } else if (currentFilterType === 'cleanup') {
        // 可清理：已过期或积分耗尽
        if (acc.createdAt) {
          const expiry = calculateExpiry(acc.createdAt);
          if (expiry.isExpired) return true;
        }
        const used = acc.usedPromptCredits || 0;
        const total = acc.monthlyPromptCredits || 500;
        if (total <= 100 && used >= total * 0.95) return true;
        return false;
      } else {
        // 按账号类型筛选
        return (acc.planType || 'Free') === currentFilterType;
      }
    });
  }

  // 如果过滤后没有结果
  if (filteredAccounts.length === 0) {
    let emptyMsg = '未找到匹配的账号';
    let emptyDesc = '';
    if (currentSearchKeyword) {
      emptyDesc = `没有包含 "${currentSearchKeyword}" 的邮箱`;
    } else if (currentFilterType && currentFilterType !== 'all') {
      const filterLabels = { 'unbound': '未绑卡', 'cleanup': '可清理' };
      emptyDesc = `没有 ${filterLabels[currentFilterType] || currentFilterType} 类型的账号`;
    }
    tbody.innerHTML = generateEmptyStateHTML(9, emptyMsg, emptyDesc);
    return;
  }

  // 渲染账号列表（带序号）
  tbody.innerHTML = filteredAccounts.map((acc, index) => {
    const formattedAcc = formatAccountData(acc);
    const styles = calculateAccountStyles(formattedAcc);
    const isCurrentAccount = currentEmail && acc.email === currentEmail;
    
    return generateAccountRowHTML(formattedAcc, styles, isCurrentAccount, index + 1);
  }).join('');
}

// ==================== 统计数据 ====================
function updateAccountStats() {
  const total = accountsCache.length;
  let available = 0;    // 可用账号：未过期且未用完
  let warning = 0;      // 即将耗尽：剩余<=3天 或 剩余积分<=10%
  let unavailable = 0;  // 不可用：已过期 或 已用完

  accountsCache.forEach(acc => {
    // 使用 expiresAt 计算到期时间
    const expiry = calculateExpiry(acc.createdAt, acc.expiresAt);
    const isExpired = expiry.isExpired;
    const daysLeft = expiry.daysLeft; // 可能是 null（无到期时间）
    
    // 积分计算逻辑：使用取模运算
    const rawUsed = acc.usedPromptCredits || 0;
    const totalCredits = acc.monthlyPromptCredits || 0;
    const displayUsed = totalCredits > 0 ? (rawUsed % totalCredits) : rawUsed;
    
    // 计算用量百分比
    let usagePercent = 0;
    if (totalCredits > 0) {
      usagePercent = (displayUsed / totalCredits) * 100;
    }
    
    // 判断是否不可用
    // Free/Trial：过期或使用量>=95% → 不可用（可被快速选择删除）
    // Pro/Teams/Enterprise：只有过期才算不可用（只能手动删除）
    const planType = acc.planType || 'Free';
    const isFreeOrTrial = planType === 'Free' || planType === 'Trial';
    const isUsedUp = isFreeOrTrial && totalCredits > 0 && usagePercent >= 95;
    
    // 分类判断
    if (isExpired || isUsedUp) {
      unavailable++;
    } else if (isFreeOrTrial && (usagePercent >= 90 || (daysLeft !== null && daysLeft <= 3))) {
      // 即将耗尽：只有 Free/Trial 才显示警告
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

// 切换三点菜单（动态创建菜单插入到 body）
function toggleActionMenu(event, id) {
  event.stopPropagation();
  
  // 移除已存在的菜单
  const existingMenu = document.getElementById('accountActionMenu');
  if (existingMenu) existingMenu.remove();
  
  // 获取账号信息
  const acc = accountsCache.find(a => a.id === id);
  if (!acc) return;
  
  // 获取按钮位置
  const button = event.currentTarget;
  const buttonRect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 菜单固定宽度 140px，计算位置
  const menuWidth = 140;
  const menuHeight = 160;
  
  // 默认显示在按钮下方，右对齐按钮（向左展开）
  let left = buttonRect.right - menuWidth;
  let top = buttonRect.bottom + 4;
  
  // 检查左侧是否超出屏幕
  if (left < 10) {
    left = 10;
  }
  
  // 检查底部是否超出屏幕，改为向上展开
  if (top + menuHeight > viewportHeight) {
    top = buttonRect.top - menuHeight - 4;
  }
  
  // 确保不超出顶部
  if (top < 10) top = 10;
  
  // 创建菜单 HTML，直接设置位置
  const menuHTML = `
    <div id="accountActionMenu" class="action-menu show" style="position:fixed; left:${left}px; top:${top}px;">
      <div class="action-menu-item" onclick="pinAccount('${acc.id}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('arrowUp')}置顶账号</div>
      <div class="action-menu-item" onclick="switchAccount('${acc.email}', '${acc.password || ''}', '${acc.refreshToken || ''}', '${acc.apiKey || ''}', '${acc.name || ''}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('repeat')}切换账号</div>
      <div class="action-menu-item" onclick="viewAccount('${acc.email}', '${acc.password}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('eye')}查看详情</div>
      <div class="action-menu-item" onclick="loginBindAccount('${acc.email}', '${acc.password}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('creditCard')}登录绑卡</div>
      <div class="action-menu-item" onclick="getPaymentLinkForAccount('${acc.email}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('link')}获取链接</div>
      <div class="action-menu-item" onclick="editAccount('${acc.id}', '${acc.email}', '${acc.password}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('edit')}编辑账号</div>
      <div class="action-menu-item danger" onclick="deleteAccountFromTable('${acc.id}', '${acc.email}'); document.getElementById('accountActionMenu')?.remove();">${getMenuIcon('trash')}删除账号</div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', menuHTML);
  
  // 点击其他地方关闭菜单
  setTimeout(() => {
    const closeMenu = (e) => {
      const menu = document.getElementById('accountActionMenu');
      if (menu && !menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.querySelector('.main-content')?.removeEventListener('scroll', scrollClose);
      }
    };
    const scrollClose = () => {
      const menu = document.getElementById('accountActionMenu');
      if (menu) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.querySelector('.main-content')?.removeEventListener('scroll', scrollClose);
      }
    };
    document.addEventListener('click', closeMenu);
    document.querySelector('.main-content')?.addEventListener('scroll', scrollClose);
  }, 100);
}

// 双击行复制账号
async function copyAccountRow(email, password) {
  navigator.clipboard.writeText(email);
  showToast('账号已复制', 'success');
  logger.success(`复制账号: ${email}`);
}

// 查看账号详细信息
function viewAccount(email, password) {
  const account = accountsCache.find(acc => acc.email === email);
  if (!account) {
    showAlertDialog('查看失败', '未找到账号信息', 'error');
    return;
  }

  // 格式化数据
  const accountTypeText = account.planType || account.accountType || 'Unknown';
  const cardBoundText = account.cardBound === true ? '已绑卡' : account.cardBound === false ? '未绑卡' : '未知';
  const createdTime = account.createdAt ? new Date(account.createdAt).toLocaleString('zh-CN') : '未知';
  const lastRefreshedTime = account.lastRefreshed ? new Date(account.lastRefreshed).toLocaleString('zh-CN') : '从未刷新';
  const promptCredits = (account.usedPromptCredits !== undefined && account.monthlyPromptCredits !== undefined) 
    ? `${account.usedPromptCredits} / ${account.monthlyPromptCredits}` : '未知';
  const expiry = calculateExpiry(account.createdAt, account.expiresAt);
  const expiryInfo = expiry.expiryDate ? expiry.expiryText : '未知';

  createModal('account-detail-modal', `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e5e5ea; padding-bottom: 10px;">
      <h2 style="margin: 0; color: #1d1d1f; font-size: 16px; font-weight: 600;">账号详细信息</h2>
      <button onclick="this.closest('.account-detail-modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #86868b;">&times;</button>
    </div>
    <div style="font-size: 13px;">
      <!-- 邮箱 -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
        <div style="flex: 1; min-width: 0;"><span style="color: #86868b;">邮箱: </span><span style="color: #1d1d1f; font-family: monospace; font-size: 12px;">${account.email}</span></div>
        <button onclick="navigator.clipboard.writeText('${account.email}'); showToast('邮箱已复制', 'success'); event.stopPropagation();" style="padding: 2px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 8px;">复制</button>
      </div>
      <!-- 密码 -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
        <div style="flex: 1; min-width: 0;"><span style="color: #86868b;">密码: </span><span style="color: #1d1d1f; font-family: monospace; font-size: 12px;">${account.password || '无'}</span></div>
        ${account.password ? `<button onclick="navigator.clipboard.writeText('${account.password}'); showToast('密码已复制', 'success'); event.stopPropagation();" style="padding: 2px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 8px;">复制</button>` : ''}
      </div>
      <!-- 详细信息列表 -->
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">用户名</span><span style="color: #1d1d1f;">${account.name || '未知'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">账号类型</span><span style="color: #1d1d1f;">${accountTypeText}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">绑卡状态</span><span style="color: #1d1d1f;">${cardBoundText}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">积分</span><span style="color: #1d1d1f;">${promptCredits}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">创建时间</span><span style="color: #1d1d1f;">${createdTime}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0;"><span style="color: #86868b;">最后刷新</span><span style="color: #1d1d1f;">${lastRefreshedTime}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 4px 0;"><span style="color: #86868b;">到期时间</span><span style="color: #1d1d1f;">${expiryInfo}</span></div>
      </div>
      ${account.userId ? `<div style="margin-bottom: 6px; font-size: 12px;"><span style="color: #86868b;">用户ID: </span><span style="color: #1d1d1f; font-family: monospace;">${account.userId}</span></div>` : ''}
      ${account.apiKey ? `
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="color: #86868b; font-size: 12px;">API Key</span>
          <button onclick="navigator.clipboard.writeText('${account.apiKey}'); showToast('API Key已复制', 'success'); event.stopPropagation();" style="padding: 2px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer;">复制</button>
        </div>
        <div style="background: #f5f5f7; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #1d1d1f; word-break: break-all; line-height: 1.3;">${account.apiKey}</div>
      </div>` : ''}
      ${account.refreshToken ? `
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="color: #86868b; font-size: 12px;">Refresh Token</span>
          <button onclick="navigator.clipboard.writeText('${account.refreshToken}'); showToast('Token已复制', 'success'); event.stopPropagation();" style="padding: 2px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer;">复制</button>
        </div>
        <div style="background: #f5f5f7; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #1d1d1f; word-break: break-all; line-height: 1.3;">${account.refreshToken}</div>
      </div>` : ''}
    </div>
    <div style="display: flex; gap: 10px; margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e5ea;">
      <button onclick="navigator.clipboard.writeText('${account.email} ${account.password || ''}'); showToast('账号密码已复制', 'success');" style="flex: 1; padding: 8px; background: #007aff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">复制账号密码</button>
      <button onclick="refreshAndReloadDetail('${account.email}', '${account.password}')" style="flex: 1; padding: 8px; background: #34c759; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">刷新信息</button>
    </div>
  `, { maxWidth: '420px' });
}

// 刷新账号信息并重新加载详情弹窗
async function refreshAndReloadDetail(email, password) {
  // 关闭当前弹窗
  document.querySelector('.account-detail-modal')?.remove();
  
  showToast('正在刷新...', 'info');
  
  try {
    // 调用后端刷新接口
    const result = await ipcRenderer.invoke('refresh-account-credits', email);
    
    if (result.success) {
      // 重新加载账号列表以更新缓存
      await loadAccounts();
      showToast('刷新成功', 'success');
    } else {
      showToast(`刷新失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast(`刷新异常: ${error.message}`, 'error');
  }
  
  // 重新打开详情弹窗（使用最新的缓存数据）
  viewAccount(email, password);
}

// 编辑账号信息
function editAccount(id, email, password) {
  const account = accountsCache.find(acc => acc.id === id);
  if (!account) {
    showAlertDialog('编辑失败', '未找到账号信息', 'error');
    return;
  }

  createModal('edit-account-modal', `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #e5e5ea; padding-bottom: 16px;">
      <h2 style="margin: 0; color: #1d1d1f; font-size: 18px;">编辑账号</h2>
      <button onclick="this.closest('.edit-account-modal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #86868b;">&times;</button>
    </div>
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 6px; color: #1d1d1f; font-weight: 500;">邮箱地址</label>
      <input type="email" id="editEmail" value="${account.email}" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
    </div>
    <div style="margin-bottom: 24px;">
      <label style="display: block; margin-bottom: 6px; color: #1d1d1f; font-weight: 500;">密码</label>
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
  `);

  setTimeout(() => document.getElementById('editEmail').focus(), 100);
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

// 刷新状态管理
let refreshingAccounts = new Set();  // 正在刷新的账号
let pendingLoadAccounts = false;     // 是否有待执行的 loadAccounts
let loadAccountsTimer = null;        // 防抖定时器

// 防抖加载账号列表
function debouncedLoadAccounts() {
  pendingLoadAccounts = true;
  if (loadAccountsTimer) clearTimeout(loadAccountsTimer);
  loadAccountsTimer = setTimeout(async () => {
    if (pendingLoadAccounts && refreshingAccounts.size === 0) {
      pendingLoadAccounts = false;
      await loadAccounts();
    }
  }, 300);
}

// 刷新单个账号积分（调用后端统一接口）
async function getAccountDetails(email) {
  // 防止重复刷新同一账号
  if (refreshingAccounts.has(email)) {
    showToast(`${email} 正在刷新中...`, 'info');
    return;
  }
  
  refreshingAccounts.add(email);
  logger.info(`正在刷新账号信息: ${email}`);
  
  try {
    // 调用后端统一刷新接口，后端会自动处理 Token/密码优先级和保存
    const result = await ipcRenderer.invoke('refresh-account-credits', email);
    
    if (result.success) {
      logger.success(`账号刷新成功: ${email}`);
      showToast(`账号刷新成功: ${email}`, 'success');
    } else {
      const errorMsg = result.error || '未知错误';
      if (errorMsg.includes('timeout')) {
        logger.warning(`账号刷新超时: ${email}`);
        showToast(`账号刷新超时，请重试`, 'error');
      } else {
        logger.warning(`账号刷新失败: ${email} - ${errorMsg}`);
        showToast(`刷新失败: ${errorMsg}`, 'error');
      }
    }
  } catch (error) {
    logger.warning(`账号刷新异常: ${email}`);
    showToast(`账号刷新异常: ${error.message}`, 'error');
  } finally {
    refreshingAccounts.delete(email);
    // 所有刷新完成后再加载列表
    debouncedLoadAccounts();
  }
}

// 通用确认弹窗
function showConfirmDialog(title, message, onConfirm, onCancel = null) {
  // 设置临时回调
  window.tempConfirmCallback = onConfirm;
  window.tempCancelCallback = onCancel;

  const modal = createModal('confirm-dialog', `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #1d1d1f; font-size: 18px;">${title}</h3>
      <p style="margin: 0; color: #424245; line-height: 1.5; white-space: pre-line;">${message}</p>
    </div>
    <div style="display: flex; gap: 12px;">
      <button onclick="this.closest('.confirm-dialog').remove(); window.tempCancelCallback && window.tempCancelCallback();" 
              style="flex: 1; padding: 10px; background: #f5f5f7; color: #1d1d1f; border: none; border-radius: 6px; cursor: pointer;">
        取消
      </button>
      <button onclick="this.closest('.confirm-dialog').remove(); window.tempConfirmCallback && window.tempConfirmCallback();" 
              style="flex: 1; padding: 10px; background: #ff3b30; color: white; border: none; border-radius: 6px; cursor: pointer;">
        确定
      </button>
    </div>
  `, { closeOnBackdrop: false });

  // 点击背景关闭并触发取消回调
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      if (onCancel) onCancel();
    }
  });
}

// 通用提示弹窗
function showAlertDialog(title, message, type = 'info') {
  const typeColors = { info: '#007aff', success: '#34c759', warning: '#ff9500', error: '#ff3b30' };
  const typeIcons = { info: 'ℹ', success: '✓', warning: '!', error: '✕' };

  createModal('alert-dialog', `
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
  `);
}

// 置顶账号
async function pinAccount(id) {
  try {
    const result = await ipcRenderer.invoke('pin-account', id);
    if (result.success) {
      showToast('账号已置顶', 'success');
      await loadAccounts();
    } else {
      showToast(`置顶失败: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast(`置顶失败: ${error.message}`, 'error');
  }
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


// Token导入账号
function showImportByTokenForm() {
  document.getElementById('importTokenInput').value = '';
  document.getElementById('importTokenResult').innerHTML = '';
  document.getElementById('importByTokenModal').style.display = 'flex';
}

function hideImportByTokenForm() {
  document.getElementById('importByTokenModal').style.display = 'none';
}

async function importAccountsByToken() {
  const text = document.getElementById('importTokenInput').value.trim();
  const resultEl = document.getElementById('importTokenResult');
  
  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请输入 Refresh Token</div>';
    return;
  }
  
  // 按行分割，支持批量导入
  const tokens = text.split('\n').map(t => t.trim()).filter(t => t.length > 0);
  
  if (tokens.length === 0) {
    resultEl.innerHTML = '<div class="status-message status-error">请输入有效的 Token</div>';
    return;
  }
  
  resultEl.innerHTML = '<div class="status-message status-info">正在导入...</div>';
  
  let successCount = 0;
  let failCount = 0;
  let updateCount = 0;
  const errors = [];
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    resultEl.innerHTML = `<div class="status-message status-info">正在导入 ${i + 1}/${tokens.length}...</div>`;
    
    try {
      const result = await ipcRenderer.invoke('import-account-by-token', token);
      
      if (result.success) {
        if (result.isNew) {
          successCount++;
        } else {
          updateCount++;
        }
      } else {
        failCount++;
        errors.push(`Token ${i + 1}: ${result.error}`);
      }
    } catch (error) {
      failCount++;
      errors.push(`Token ${i + 1}: ${error.message}`);
    }
  }
  
  // 显示结果
  let html = '<div class="status-message status-success">';
  html += `导入完成：新增 ${successCount} 个，更新 ${updateCount} 个`;
  if (failCount > 0) {
    html += `，失败 ${failCount} 个`;
  }
  html += '</div>';
  
  if (errors.length > 0) {
    html += '<div class="status-message status-error" style="margin-top:8px; font-size:11px;">';
    html += errors.slice(0, 5).join('<br>');
    if (errors.length > 5) {
      html += `<br>... 还有 ${errors.length - 5} 个错误`;
    }
    html += '</div>';
  }
  
  resultEl.innerHTML = html;
  
  // 刷新账号列表
  if (successCount > 0 || updateCount > 0) {
    await loadAccounts();
  }
}

// 添加账号弹窗
let addAccountType = 'password';

function showAddAccountModal() {
  addAccountType = 'password';
  document.querySelector('input[name="addAccountType"][value="password"]').checked = true;
  document.getElementById('addAccountPasswordSection').style.display = 'block';
  document.getElementById('addAccountTokenSection').style.display = 'none';
  document.getElementById('addAccountInput').value = '';
  document.getElementById('addAccountTokenInput').value = '';
  document.getElementById('addAccountResult').innerHTML = '';
  document.getElementById('addAccountModal').style.display = 'flex';
}

function hideAddAccountModal() {
  document.getElementById('addAccountModal').style.display = 'none';
}

function switchAddAccountType(type) {
  addAccountType = type;
  if (type === 'password') {
    document.getElementById('addAccountPasswordSection').style.display = 'block';
    document.getElementById('addAccountTokenSection').style.display = 'none';
  } else {
    document.getElementById('addAccountPasswordSection').style.display = 'none';
    document.getElementById('addAccountTokenSection').style.display = 'block';
  }
  document.getElementById('addAccountResult').innerHTML = '';
}

async function doAddAccounts() {
  if (addAccountType === 'password') {
    await importAccountsByPassword();
  } else {
    await importAccountsByTokenNew();
  }
}

async function importAccountsByPassword() {
  const text = document.getElementById('addAccountInput').value.trim();
  const resultEl = document.getElementById('addAccountResult');

  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请输入账号信息</div>';
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let duplicateCount = 0;
  let accounts = [];

  // TXT 格式（每行：邮箱 密码）
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines) {
    let email, password;
    
    // 优先检测 ---- 分隔符
    if (line.includes('----')) {
      const parts = line.split('----');
      email = parts[0].trim();
      password = parts.slice(1).join('----').trim();  // 密码可能包含----
    } else {
      // 支持空格或制表符分隔
      const parts = line.split(/[\s\t]+/);
      if (parts.length >= 2) {
        email = parts[0];
        password = parts.slice(1).join(' ');  // 密码可能包含空格
      }
    }
    
    if (email && password) {
      accounts.push({ email, password });
    }
  }
  
  if (accounts.length === 0) {
    resultEl.innerHTML = '<div class="status-message status-error">格式错误，请检查格式：邮箱----密码 或 邮箱 密码</div>';
    return;
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
      hideAddAccountModal();
    }, 2000);
  } else {
    let message = '没有成功导入任何账号';
    if (duplicateCount > 0) {
      message = `所有账号都已存在（${duplicateCount} 个重复）`;
    }
    resultEl.innerHTML = `<div class="status-message status-error">${message}</div>`;
  }
}

// Token导入（新版）
async function importAccountsByTokenNew() {
  const text = document.getElementById('addAccountTokenInput').value.trim();
  const resultEl = document.getElementById('addAccountResult');

  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请输入 Token</div>';
    return;
  }

  const tokens = text.split('\n').map(t => t.trim()).filter(t => t.length > 0);
  
  if (tokens.length === 0) {
    resultEl.innerHTML = '<div class="status-message status-error">请输入有效的 Token</div>';
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let updateCount = 0;

  resultEl.innerHTML = `<div class="status-message status-info">正在导入 ${tokens.length} 个账号...</div>`;

  for (const token of tokens) {
    try {
      const result = await ipcRenderer.invoke('import-account-by-token', token);
      if (result.success) {
        if (result.updated) {
          updateCount++;
        } else {
          successCount++;
        }
      } else {
        failCount++;
      }
    } catch (error) {
      failCount++;
    }
  }

  let html = '';
  if (successCount > 0 || updateCount > 0) {
    let message = '';
    if (successCount > 0) message += `成功导入 ${successCount} 个账号`;
    if (updateCount > 0) message += (message ? '，' : '') + `更新 ${updateCount} 个账号`;
    if (failCount > 0) message += `，${failCount} 个失败`;
    html = `<div class="status-message status-success">${message}</div>`;
    await loadAccounts();
    setTimeout(() => {
      hideAddAccountModal();
    }, 2000);
  } else {
    html = `<div class="status-message status-error">导入失败${failCount > 0 ? `（${failCount} 个）` : ''}</div>`;
  }
  
  resultEl.innerHTML = html;
}

// 初始化事件监听
function initAccountEvents() {
  // 无需文件监听
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
    eyeButton.innerHTML = getIcon('eyeOff', 16);
  } else {
    // 隐藏密码
    pwdElement.textContent = '••••••••';
    // 切换为"眼睛"图标（表示可以显示）
    eyeButton.innerHTML = getIcon('eye', 16);
  }
}

// 标记绑卡状态
async function markCardBound(email, success) {
  try {
    const result = await ipcRenderer.invoke('mark-card-bound', { email, success });
    if (result.success) {
      showToast(success ? '已标记绑卡成功' : '已标记绑卡失败', 'success');
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

// 点击行切换复选框状态
function toggleAccountCheckbox(accountId) {
  const checkbox = document.querySelector(`.account-checkbox[data-id="${accountId}"]`);
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
    updateSelectedBindCount();
  }
}

// 选择未绑卡账号
async function selectUnboundAccounts() {
  let count = 0;
  
  // 获取当前登录账号的邮箱，避免选中它（使用缓存）
  let currentEmail = currentEmailCache;
  
  accountsCache.forEach(account => {
    // 通过 data-email 属性查找复选框
    const checkbox = document.querySelector(`#accountsList .account-checkbox[data-email="${account.email}"]`);
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

// 根据账号类型筛选
function filterAccountsByType(type) {
  currentFilterType = type;
  // 更新筛选按钮显示
  const filterLabel = document.getElementById('filterLabel');
  if (filterLabel) {
    const labels = {
      'all': '筛选',
      'unbound': '未绑卡',
      'cleanup': '可清理'
    };
    filterLabel.textContent = labels[type] || type;
  }
  renderAccounts();
}

// 切换筛选菜单
function toggleFilterMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('filterMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
  
  if (menu && menu.style.display === 'block') {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('#filterMenu')) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }
}

function hideFilterMenu() {
  const menu = document.getElementById('filterMenu');
  if (menu) {
    menu.style.display = 'none';
  }
}

// 统一选择操作
function toggleSelection(mode) {
  const checkboxes = document.querySelectorAll('#accountsList .account-checkbox');
  let count = 0;
  
  checkboxes.forEach(checkbox => {
    switch (mode) {
      case 'all':
        checkbox.checked = true;
        count++;
        break;
      case 'none':
        checkbox.checked = false;
        break;
      case 'invert':
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) count++;
        break;
    }
  });
  
  updateSelectedBindCount();
  
  const messages = {
    all: `已全选 ${count} 个账号`,
    none: '已取消所有选择',
    invert: `反选完成，当前选中 ${count} 个账号`
  };
  showToast(messages[mode], mode === 'none' ? 'success' : 'success');
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
  
  for (const account of selectedAccounts) {
    try {
      // 使用统一的刷新接口，后端会处理所有逻辑
      const result = await ipcRenderer.invoke('refresh-account-credits', account.email);
      if (result.success) {
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
  
  showExportFormatDialog(selectedAccounts);
}

// 显示导出格式选择弹窗
function showExportFormatDialog(accounts) {
  const dialog = document.createElement('div');
  dialog.className = 'modal-overlay';
  dialog.id = 'exportFormatDialog';
  dialog.style.display = 'flex';
  dialog.innerHTML = `
    <div class="modal-dialog" style="max-width:350px;">
      <div class="modal-header">选择导出格式</div>
      <div style="padding:16px;">
        <div style="margin-bottom:12px;">
          <label style="display:flex; align-items:center; cursor:pointer; padding:10px; border:1px solid #e5e5ea; border-radius:8px; margin-bottom:8px;">
            <input type="radio" name="exportFormat" value="txt" checked style="margin-right:10px;" onchange="document.getElementById('txtSeparatorOptions').style.display='block'">
            <div>
              <div style="font-weight:500;">TXT 格式</div>
              <div style="font-size:12px; color:#86868b;">每行：邮箱+分隔符+密码</div>
            </div>
          </label>
          <div id="txtSeparatorOptions" style="margin-left:30px; margin-bottom:8px; padding:8px 12px; background:#f5f5f7; border-radius:6px;">
            <div style="display:flex; align-items:center; gap:20px;">
              <span style="font-size:12px; color:#666; white-space:nowrap;">分隔符：</span>
              <label style="display:flex; align-items:center; cursor:pointer; gap:4px;">
                <input type="radio" name="txtSeparator" value="----" checked>
                <span style="font-size:13px;">----</span>
              </label>
              <label style="display:flex; align-items:center; cursor:pointer; gap:4px;">
                <input type="radio" name="txtSeparator" value=" ">
                <span style="font-size:13px;">空格</span>
              </label>
            </div>
          </div>
          <label style="display:flex; align-items:center; cursor:pointer; padding:10px; border:1px solid #e5e5ea; border-radius:8px;">
            <input type="radio" name="exportFormat" value="json" style="margin-right:10px;" onchange="document.getElementById('txtSeparatorOptions').style.display='none'">
            <div>
              <div style="font-weight:500;">JSON 格式</div>
              <div style="font-size:12px; color:#86868b;">[{"email": "...", "password": "..."}]</div>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="document.getElementById('exportFormatDialog').remove()">取消</button>
        <button class="btn btn-primary" onclick="doExportAccounts()">导出</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  
  // 保存账号数据供导出使用
  window._exportAccounts = accounts;
}

// 执行导出
function doExportAccounts() {
  const accounts = window._exportAccounts;
  const format = document.querySelector('input[name="exportFormat"]:checked').value;
  
  let content, filename, type;
  const dateStr = new Date().toISOString().split('T')[0];
  
  if (format === 'txt') {
    // 获取用户选择的分隔符
    const separator = document.querySelector('input[name="txtSeparator"]:checked')?.value || '----';
    content = accounts.map(acc => `${acc.email}${separator}${acc.password || ''}`).join('\n');
    filename = `windsurf_accounts_${dateStr}.txt`;
    type = 'text/plain';
  } else {
    // JSON 格式
    const exportData = accounts.map(acc => ({
      email: acc.email,
      password: acc.password
    }));
    content = JSON.stringify(exportData, null, 2);
    filename = `windsurf_accounts_${dateStr}.json`;
    type = 'application/json';
  }
  
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // 关闭弹窗
  document.getElementById('exportFormatDialog').remove();
  delete window._exportAccounts;
  
  logger.successWithToast(`导出选中账号：${accounts.length} 个`, `已导出 ${accounts.length} 个账号`);
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
          // 使用 id 删除，如果没有 id 则使用 email
          const deleteId = account.id || account.email;
          const result = await ipcRenderer.invoke('delete-account', deleteId);
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
  
  checkboxes.forEach(checkbox => {
    // 通过 data 属性获取账号信息
    const email = checkbox.getAttribute('data-email');
    const password = checkbox.getAttribute('data-password');
    
    if (email) {
      // 从缓存中查找完整的账号信息
      const account = accountsCache.find(acc => acc.email === email);
      if (account) {
        selected.push(account);
      } else {
        // 如果缓存中没有，使用基本信息
        selected.push({ email, password });
      }
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
  } else if (message.includes('邮箱') || message.includes('开始') || message.includes('卡')) {
    color = '#007aff';
  }
  
  logEntry.style.color = color;
  // 后端已包含完整的时间戳,直接显示
  logEntry.innerHTML = message;
  
  logContent.appendChild(logEntry);
  
  // 强制滚动到底部 - 使用 scrollIntoView 更可靠
  logEntry.scrollIntoView({ behavior: 'auto', block: 'end' });
}

// 全局变量：待确认的账号列表（支持批量绑卡）
let pendingBindingAccounts = [];

// 更新当前绑卡账号（添加到待确认列表）
function updateCurrentBindingAccount(email, password) {
  // 检查是否已存在
  const exists = pendingBindingAccounts.find(acc => acc.email === email);
  if (!exists) {
    pendingBindingAccounts.push({ email, password, selectedCardId: 'auto' });
  }
  // 刷新待确认列表UI
  renderPendingAccounts();
}

// 渲染待确认账号列表
function renderPendingAccounts() {
  const section = document.getElementById('pendingAccountsSection');
  const list = document.getElementById('pendingAccountsList');
  const countSpan = document.getElementById('pendingAccountsCount');
  
  if (!section || !list) return;
  
  if (pendingBindingAccounts.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  countSpan.textContent = pendingBindingAccounts.length;
  
  // 为每个账号注册选择器配置
  pendingBindingAccounts.forEach(acc => {
    const key = `pending_${acc.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    cardSelectors[key] = {
      dropdownId: `pendingDrop_${key}`,
      buttonId: `pendingBtn_${key}`,
      selectedId: acc.selectedCardId || 'auto'
    };
  });
  
  list.innerHTML = pendingBindingAccounts.map((acc) => {
    const key = `pending_${acc.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const selectedText = acc.selectedCardId && acc.selectedCardId !== 'auto' ? acc.selectedCardId.substring(0, 8) + '...' : '选择虚拟卡';
    return `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #e5e5ea; gap:8px;" data-email="${acc.email}">
      <span style="font-size:12px; color:#1d1d1f; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${acc.email}">${acc.email}</span>
      <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
        <button id="pendingBtn_${key}" onclick="toggleCardSelectorGeneric('${key}')" style="background:#f5f5f7; color:#1d1d1f; border:1px solid #d2d2d7; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">${selectedText}</button>
        <button onclick="confirmBindSuccessForAccount('${acc.email}')" style="background:#34c759; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">成功</button>
        <button onclick="retryBindingForAccount('${acc.email}', '${acc.password}')" style="background:#007aff; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">重试</button>
      </div>
    </div>`;
  }).join('');
}

// 获取待确认账号选择的卡ID
function getPendingCardId(email) {
  const key = `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return cardSelectors[key] ? cardSelectors[key].selectedId : 'auto';
}

// 确认指定账号绑卡成功
async function confirmBindSuccessForAccount(email) {
  await confirmBindSuccess(email);
  // 从待确认列表中移除
  pendingBindingAccounts = pendingBindingAccounts.filter(acc => acc.email !== email);
  renderPendingAccounts();
}

// 重试指定账号绑卡（重新生成绑卡链接）
async function retryBindingForAccount(email, password) {
  const cardId = getPendingCardId(email);
  
  try {
    showToast('正在重新获取绑卡链接...', 'info');
    
    // 使用 API 绑卡方式重新绑卡（会重新获取支付链接）
    const result = await ipcRenderer.invoke('api-bind-single-account', { 
      email, 
      password, 
      selectedCardId: cardId 
    });
    
    if (result && result.success) {
      // 重试成功，从列表移除
      pendingBindingAccounts = pendingBindingAccounts.filter(a => a.email !== email);
      renderPendingAccounts();
      await loadAccounts();
      showToast('绑卡成功', 'success');
    } else if (result && result.pending) {
      showToast('已提交，等待确认', 'info');
    } else {
      showToast('绑卡失败: ' + (result?.error || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('重新绑卡异常: ' + error.message, 'error');
  }
}

// 开始批量绑卡（显示方式选择弹窗）
async function startApiBatchBinding() {
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
  
  // 显示绑卡方式选择弹窗
  showBindingMethodDialog(accounts, selectedCardId);
}

// 显示绑卡方式选择弹窗
function showBindingMethodDialog(accounts, selectedCardId) {
  const modalHTML = `
    <div id="bindingMethodModal" class="modal-overlay" style="display:flex;">
      <div class="modal-dialog" style="max-width:400px;">
        <div class="modal-header">
          <span>选择绑卡方式</span>
          <button onclick="document.getElementById('bindingMethodModal').remove()" style="background:none; border:none; cursor:pointer; font-size:20px; color:#6e6e73;">×</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <p style="margin-bottom:16px; color:#1d1d1f;">共选择 <strong>${accounts.length}</strong> 个账号进行绑卡</p>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <button class="btn btn-primary" style="padding:12px; font-size:14px;" onclick="executeBindingWithMethod('api', ${JSON.stringify(accounts).replace(/"/g, '&quot;')}, '${selectedCardId}')">
              API绑卡（推荐）
              <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-top:4px;">通过API获取链接，自动填写卡信息</div>
            </button>
            <button class="btn btn-secondary" style="padding:12px; font-size:14px;" onclick="executeBindingWithMethod('browser', ${JSON.stringify(accounts).replace(/"/g, '&quot;')}, '${selectedCardId}')">
              登录绑卡
              <div style="font-size:12px; color:#86868b; margin-top:4px;">打开浏览器登录后进入绑卡页面</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// 根据选择的方式执行绑卡
async function executeBindingWithMethod(method, accounts, selectedCardId) {
  // 关闭弹窗
  document.getElementById('bindingMethodModal')?.remove();
  
  if (method === 'browser') {
    // 登录绑卡方式：使用浏览器登录获取链接
    await executeBrowserBatchBinding(accounts, selectedCardId);
  } else {
    // API绑卡方式
    executeApiBatchBinding(accounts, selectedCardId);
  }
}

// 执行浏览器登录批量绑卡（和API绑卡逻辑一样，只是获取链接方式不同）
async function executeBrowserBatchBinding(accounts, selectedCardId) {
  showBindingLog();
  
  // 清空待确认列表
  pendingBindingAccounts = [];
  renderPendingAccounts();
  
  try {
    // 使用浏览器方式获取链接，其他逻辑和API绑卡一样
    const result = await ipcRenderer.invoke('batch-api-bind-cards', { 
      accounts, 
      selectedCardId,
      useBrowser: true  // 标记使用浏览器方式获取链接
    });
    
    if (result && (result.successCount > 0 || result.pendingCount > 0)) {
      await loadAccounts();
    }
  } catch (error) {
    showToast('批量绑卡异常: ' + error.message, 'error');
  }
}

// 执行 API 批量绑卡
async function executeApiBatchBinding(accounts, selectedCardId) {
  showBindingLog();
  
  // 清空待确认列表，重新开始
  pendingBindingAccounts = [];
  renderPendingAccounts();
  
  try {
    const result = await ipcRenderer.invoke('batch-api-bind-cards', { 
      accounts, 
      selectedCardId
    });
    
    if (result && (result.successCount > 0 || result.pendingCount > 0)) {
      await loadAccounts();
    }
  } catch (error) {
    showToast('API批量绑卡异常: ' + error.message, 'error');
  }
}

// 单个账号 API 绑卡
async function apiBindSingleAccount(email, password) {
  showBindingLog();
  
  const selectedCardId = getSelectedCardId();
  
  try {
    const result = await ipcRenderer.invoke('api-bind-card', { email, password, selectedCardId });
    
    if (result && result.success) {
      await loadAccounts();
    }
  } catch (error) {
    showToast('API绑卡异常: ' + error.message, 'error');
  }
}

// 登录绑卡（打开浏览器登录后进入绑卡页面）
async function loginBindAccount(email, password) {
  showToast('正在打开浏览器登录...', 'info', 0);
  
  try {
    const result = await ipcRenderer.invoke('browser-bind-single', { email, password });
    
    if (result && result.success) {
      showToast('绑卡页面已打开，请在浏览器中完成绑卡', 'success');
    } else {
      showToast('登录绑卡失败: ' + (result?.error || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('登录绑卡异常: ' + error.message, 'error');
  }
}

// 获取单个账号的绑卡链接（复制到剪贴板）
async function getPaymentLinkForAccount(email) {
  // 从缓存中找到账号
  const account = accountsCache.find(acc => acc.email === email);
  if (!account) {
    showToast('账号不存在', 'error');
    return;
  }
  
  await getPaymentLinkOnly(email, account.password);
}

// 仅获取支付链接（不打开浏览器）
async function getPaymentLinkOnly(email, password) {
  try {
    // 显示获取中状态
    showToast('正在获取支付链接...', 'info', 0); // 0 = 不自动消失
    
    const result = await ipcRenderer.invoke('get-payment-link', { email, password });
    
    if (result && result.success && result.paymentLink) {
      // 复制到剪贴板
      await navigator.clipboard.writeText(result.paymentLink);
      showToast('支付链接已复制到剪贴板', 'success');
      return result.paymentLink;
    } else {
      showToast('获取支付链接失败: ' + (result.error || '未知错误'), 'error');
      return null;
    }
  } catch (error) {
    showToast('获取支付链接异常: ' + error.message, 'error');
    return null;
  }
}

// 批量获取绑卡链接并复制到剪贴板
async function batchGetPaymentLinks() {
  const checkboxes = document.querySelectorAll('.account-checkbox:checked');
  if (checkboxes.length === 0) {
    showToast('请先选择要获取链接的账号', 'warning');
    return;
  }
  
  const accounts = [];
  checkboxes.forEach(cb => {
    accounts.push({
      email: cb.dataset.email,
      password: cb.dataset.password
    });
  });
  
  showToast(`正在获取 ${accounts.length} 个账号的绑卡链接...`, 'info', 0);
  
  const links = [];
  let successCount = 0;
  
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    showToast(`正在获取 (${i + 1}/${accounts.length}): ${acc.email}...`, 'info', 0);
    
    try {
      const result = await ipcRenderer.invoke('get-payment-link', { 
        email: acc.email, 
        password: acc.password 
      });
      
      if (result && result.success && result.paymentLink) {
        links.push(`${acc.email}\n${result.paymentLink}`);
        successCount++;
      } else {
        links.push(`${acc.email}\n获取失败: ${result?.error || '未知错误'}`);
      }
    } catch (error) {
      links.push(`${acc.email}\n获取异常: ${error.message}`);
    }
  }
  
  // 复制到剪贴板
  const allLinks = links.join('\n\n');
  await navigator.clipboard.writeText(allLinks);
  
  showToast(`获取完成！成功 ${successCount}/${accounts.length} 个，已复制到剪贴板`, 
    successCount === accounts.length ? 'success' : 'warning');
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
    // 获取重新绑卡选择器中选中的虚拟卡
    const cardId = getRetrySelectedCardId();
    
    const result = await ipcRenderer.invoke('retry-bind-card', { 
      email, 
      password, 
      selectedCardId: cardId 
    });
    
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

// 监听绑卡自动确认事件（后台检测成功后触发）
ipcRenderer.on('binding-confirmed', (event, data) => {
  const { email, success } = data;
  if (success) {
    // 从待确认列表中移除
    pendingBindingAccounts = pendingBindingAccounts.filter(acc => acc.email !== email);
    renderPendingAccounts();
    showToast(`${email} 绑卡成功`, 'success');
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
  const logEntry = document.createElement('div');
  logEntry.style.cssText = `color:${color}; margin-bottom:4px;`;
  logEntry.innerHTML = message;
  
  logContent.appendChild(logEntry);
  
  // 强制滚动到底部 - 使用 scrollIntoView 更可靠
  logEntry.scrollIntoView({ behavior: 'auto', block: 'end' });
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
async function switchAccount(email, password, refreshToken = null, apiKey = null, name = null) {
  // 显示切号日志窗口
  showSwitchLog();
  
  try {
    const result = await ipcRenderer.invoke('switch-account', { 
      email, 
      password, 
      refreshToken,
      apiKey,
      name
    });
    
    if (result.success) {
      showToast(`切号成功: ${result.account?.email || ''}`, 'success');
      
      // 切号成功后调用首页的刷新系统信息功能
      if (typeof window.refreshSystemInfo === 'function') {
        window.refreshSystemInfo();
      }
      
      // 如果 Windsurf 启动成功，延迟刷新并跳转首页
      if (result.windsurfStarted) {
        setTimeout(() => {
          // 刷新系统信息
          if (typeof window.refreshSystemInfo === 'function') {
            window.refreshSystemInfo();
          }
          // 跳转首页
          if (typeof window.switchTab === 'function') {
            window.switchTab('home');
          }
        }, 3000);
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
  if (type === 'success' || message.includes('成功') || message.includes('完成')) {
    color = '#34c759';
  } else if (type === 'error' || message.includes('失败') || message.includes('错误') || message.includes('异常')) {
    color = '#ff3b30';
  } else if (type === 'warning' || message.includes('警告') || message.includes('注意')) {
    color = '#ff9500';
  } else if (type === 'info' || message.includes('开始') || message.includes('正在')) {
    color = '#007aff';
  }
  
  const logLine = document.createElement('div');
  logLine.style.cssText = `color: ${color}; word-wrap: break-word; margin-bottom: 2px;`;
  logLine.textContent = message;
  
  logContent.appendChild(logLine);
  
  // 强制滚动到底部 - 使用 scrollIntoView 更可靠
  logLine.scrollIntoView({ behavior: 'auto', block: 'end' });
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
  filterAccountsByEmail,
  deleteAccountFromTable,
  updateAccountStats,
  showAddAccountModal,
  hideAddAccountModal,
  switchAddAccountType,
  doAddAccounts,
  toggleSelectAllAccounts,
  updateSelectedBindCount,
  toggleAccountCheckbox,
  switchAccount,
  markCardBound,
  toggleAddAccountMenu,
  selectUnboundAccounts,
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
  filterAccountsByType,
  toggleFilterMenu,
  hideFilterMenu,
  refreshSelectedAccounts,
  exportSelectedAccounts,
  doExportAccounts,
  deleteSelectedAccounts,
  toggleCardSelector,
  toggleRetryCardSelector,
  toggleCardSelectorGeneric,
  getSelectedCardId,
  getRetrySelectedCardId,
  getPendingCardId,
  hideBindingLog,
  renderPendingAccounts,
  confirmBindSuccessForAccount,
  retryBindingForAccount,
  startBatchCancel,
  showCancelLog,
  hideCancelLog,
  addCancelLog,
  updateCancelProgress,
  cancelCancelOperation,
  showImportByTokenForm,
  hideImportByTokenForm,
  importAccountsByToken,
  refreshAndReloadDetail,
  pinAccount,
  // 绑卡功能
  startApiBatchBinding,
  showBindingMethodDialog,
  executeBindingWithMethod,
  executeBrowserBatchBinding,
  executeApiBatchBinding,
  apiBindSingleAccount,
  getPaymentLinkOnly,
  getPaymentLinkForAccount,
  loginBindAccount,
  batchGetPaymentLinks,
  showBindingLog
};

Object.assign(window, accountsModule);
module.exports = accountsModule;

// DOM加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccountEvents);
} else {
  initAccountEvents();
}
