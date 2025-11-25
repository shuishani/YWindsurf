/**
 * 虚拟卡管理模块
 */

const { ipcRenderer } = require('electron');
const { showToast, generateEmptyStateHTML } = require('../utils/utils');

let virtualCards = [];
let editingCardId = null;

// 加载虚拟卡列表
async function loadCards() {
  try {
    const result = await ipcRenderer.invoke('get-cards');
    if (result.success) {
      virtualCards = result.cards || [];
      renderCards();
      renderBins();  // 同时渲染BIN列表
    }
  } catch (error) {
    console.error('加载虚拟卡失败:', error);
  }
}

// 渲染虚拟卡列表（只显示完整卡）
function renderCards() {
  const tbody = document.getElementById('cardsList');
  if (!tbody) return;
  
  // 只显示完整卡
  const fullCards = virtualCards.filter(c => c.type === 'full' || !c.type);
  
  if (fullCards.length === 0) {
    tbody.innerHTML = generateEmptyStateHTML(7, '暂无完整卡', '点击"添加"按钮或从BIN生成');
    return;
  }
  
  tbody.innerHTML = fullCards.map(card => {
    const balance = card.balance || 0;
    const bindCount = card.bindCount !== undefined ? card.bindCount : 0;
    const bindClass = bindCount === 0 ? 'badge-card-none' : 'badge-card-bound';
    
    return `
      <tr>
        <td><div class="account-email-cell" style="font-size:14px;">${card.number}</div></td>
        <td><span style="font-family:monospace; color:#6e6e73;">${card.expMonth}/${card.expYear}</span></td>
        <td><span style="font-family:monospace; color:#6e6e73;">${card.cvv}</span></td>
        <td>$${balance.toFixed(2)}</td>
        <td><span class="badge ${bindClass}">${bindCount} 次</span></td>
        <td><div style="max-width:200px; overflow:hidden; text-overflow:ellipsis; color:#6e6e73;" title="${card.note || ''}">${card.note || '-'}</div></td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="action-btn" onclick="editCard('${card.id}')" title="编辑">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="action-btn" onclick="deleteCard('${card.id}')" title="删除" style="color:#ff3b30;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 显示添加卡片表单
function showCardForm() {
  editingCardId = null;
  document.getElementById('cardFormTitle').textContent = '添加完整卡';
  document.getElementById('cardNumber').value = '';
  document.getElementById('cardExpDate').value = '';
  document.getElementById('cardCvv').value = '';
  document.getElementById('cardBalance').value = '';
  document.getElementById('cardBindCount').value = '0';
  document.getElementById('cardNote').value = '';
  document.getElementById('cardFormError').textContent = '';
  document.getElementById('cardFormModal').style.display = 'flex';
}

// 编辑卡片
function editCard(cardId) {
  const card = virtualCards.find(c => c.id === cardId);
  if (!card) return;
  
  editingCardId = cardId;
  document.getElementById('cardFormTitle').textContent = '编辑完整卡';
  document.getElementById('cardNumber').value = card.number || '';
  document.getElementById('cardExpDate').value = `${card.expMonth}/${card.expYear}`;
  document.getElementById('cardCvv').value = card.cvv || '';
  document.getElementById('cardBalance').value = card.balance || '';
  document.getElementById('cardBindCount').value = card.bindCount !== undefined ? card.bindCount : 0;
  document.getElementById('cardNote').value = card.note || '';
  document.getElementById('cardFormError').textContent = '';
  document.getElementById('cardFormModal').style.display = 'flex';
}

// 隐藏卡片表单
function hideCardForm() {
  document.getElementById('cardFormModal').style.display = 'none';
  editingCardId = null;
}

// 保存卡片（只处理完整卡）
async function saveCard() {
  const number = document.getElementById('cardNumber').value.trim().replace(/\s/g, '');
  const expDate = document.getElementById('cardExpDate').value.trim();
  const cvv = document.getElementById('cardCvv').value.trim();
  const balance = parseFloat(document.getElementById('cardBalance').value) || 0;
  const bindCount = parseInt(document.getElementById('cardBindCount').value);
  const note = document.getElementById('cardNote').value.trim();
  const errorEl = document.getElementById('cardFormError');

  if (!number || !/^\d{13,19}$/.test(number)) {
    errorEl.textContent = '请输入有效的卡号（13-19位数字）';
    return;
  }

  if (!expDate || !/^\d{2}\/\d{2}$/.test(expDate)) {
    errorEl.textContent = '请输入有效的过期日期（格式：MM/YY，如 10/27）';
    return;
  }

  const [expMonth, expYear] = expDate.split('/');
  const month = parseInt(expMonth);
  if (month < 1 || month > 12) {
    errorEl.textContent = '月份必须在 01-12 之间';
    return;
  }

  if (!cvv || !/^\d{3,4}$/.test(cvv)) {
    errorEl.textContent = '请输入有效的CVV（3-4位数字）';
    return;
  }

  // 判重：检查卡号是否已存在
  const exists = virtualCards.find(c => 
    c.id !== editingCardId &&
    c.type === 'full' &&
    c.number === number
  );
  
  if (exists) {
    errorEl.textContent = '该卡号已存在';
    return;
  }

  const card = {
    id: editingCardId || Date.now().toString(),
    type: 'full',
    number,
    expMonth,
    expYear,
    cvv,
    balance,
    bindCount,
    note,
    createdAt: editingCardId ? virtualCards.find(c => c.id === editingCardId).createdAt : new Date().toISOString()
  };

  if (editingCardId) {
    const index = virtualCards.findIndex(c => c.id === editingCardId);
    virtualCards[index] = card;
  } else {
    virtualCards.push(card);
  }

  const result = await ipcRenderer.invoke('save-cards', virtualCards);
  if (result.success) {
    hideCardForm();
    renderCards();
    renderBins();  // 同时更新BIN列表
    showToast(editingCardId ? '卡片已更新' : '卡片已添加', 'success');
  } else {
    errorEl.textContent = '保存失败: ' + result.error;
  }
}

// 删除卡片
async function deleteCard(cardId) {
  console.log('deleteCard called with cardId:', cardId);
  console.log('showConfirmDialog function:', window.showConfirmDialog);
  
  // 获取卡片信息用于显示
  const card = virtualCards.find(c => c.id === cardId);
  const cardNumber = card ? card.number.replace(/(\d{4})(?=\d)/g, '$1 ') : '未知卡号';
  
  if (typeof window.showConfirmDialog !== 'function') {
    console.error('showConfirmDialog is not available');
    if (confirm('确定要删除这张虚拟卡吗？')) {
      virtualCards = virtualCards.filter(c => c.id !== cardId);
      const result = await ipcRenderer.invoke('save-cards', virtualCards);
      if (result.success) {
        renderCards();
        renderBins();
        showToast('卡片已删除', 'success');
      }
    }
    return;
  }
  
  showConfirmDialog(
    '删除虚拟卡',
    `确定要删除虚拟卡 ${cardNumber} 吗？\n\n删除后无法恢复，请谨慎操作。`,
    async () => {
      virtualCards = virtualCards.filter(c => c.id !== cardId);
      const result = await ipcRenderer.invoke('save-cards', virtualCards);
      if (result.success) {
        renderCards();
        renderBins();  // 同时更新BIN列表
        showToast('卡片已删除', 'success');
      }
    }
  );
}

// 显示导入表单
function showImportCardsForm() {
  document.getElementById('importCardsFile').value = '';
  document.getElementById('importCardsPreview').value = '';
  document.getElementById('importCardsResult').innerHTML = '';
  document.getElementById('importCardsModal').style.display = 'flex';
}

// 隐藏导入表单
function hideImportCardsForm() {
  document.getElementById('importCardsModal').style.display = 'none';
}

// 导入卡片
async function importCards() {
  const text = document.getElementById('importCardsPreview').value.trim();
  const resultEl = document.getElementById('importCardsResult');

  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请选择文件</div>';
    return;
  }

  const lines = text.split('\n').filter(line => line.trim());
  let successCount = 0;
  let failCount = 0;
  let duplicateCount = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) {
      failCount++;
      continue;
    }

    const [number, expDate, cvv, bindCountStr] = parts;
    const bindCount = bindCountStr ? parseInt(bindCountStr) : 0; // 第4个参数为绑定次数，默认0

    if (expDate.length !== 4) {
      failCount++;
      continue;
    }

    const expMonth = expDate.substring(0, 2);
    const expYear = expDate.substring(2, 4);

    if (!/^\d{13,19}$/.test(number) || !/^\d{3,4}$/.test(cvv)) {
      failCount++;
      continue;
    }

    // 验证绑定次数（如果提供的话）
    if (bindCountStr && (isNaN(bindCount) || bindCount < 0)) {
      failCount++;
      continue;
    }

    // 判重：检查卡号是否已存在
    const exists = virtualCards.find(c => 
      (c.type === 'full' || !c.type) && c.number === number
    );
    
    if (exists) {
      duplicateCount++;
      continue;
    }

    const card = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      type: 'full',  // 添加类型字段
      number,
      expMonth,
      expYear,
      cvv,
      balance: 0,
      bindCount: bindCount, // 使用解析的绑定次数
      note: '',
      createdAt: new Date().toISOString()
    };

    virtualCards.push(card);
    successCount++;
  }

  if (successCount > 0) {
    const result = await ipcRenderer.invoke('save-cards', virtualCards);
    if (result.success) {
      renderCards();
      renderBins();  // 同时更新BIN列表
      
      let message = `成功导入 ${successCount} 张卡片`;
      if (duplicateCount > 0) {
        message += `，${duplicateCount} 张重复卡片已跳过`;
      }
      if (failCount > 0) {
        message += `，${failCount} 条记录格式错误已跳过`;
      }
      
      resultEl.innerHTML = `
        <div class="status-message status-success">
          ${message}
        </div>
      `;
      setTimeout(() => {
        hideImportCardsForm();
      }, 2000);
    }
  } else {
    let message = '没有有效的卡片数据';
    if (duplicateCount > 0) {
      message = `所有卡片都已存在（${duplicateCount} 张重复）`;
    }
    resultEl.innerHTML = `<div class="status-message status-error">${message}</div>`;
  }
}

// 导出卡片（只导出完整卡）
function exportCards() {
  const fullCards = virtualCards.filter(c => c.type === 'full' || !c.type);
  
  if (fullCards.length === 0) {
    showAlertDialog('导出失败', '暂无完整卡可导出', 'warning');
    return;
  }

  const content = fullCards.map(card =>
    `${card.number} ${card.expMonth}${card.expYear} ${card.cvv}`
  ).join('\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `virtual-cards-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('卡片已导出', 'success');
}

// 初始化事件监听（延迟到DOM加载完成）
function initCardEvents() {
  // 过期日期自动格式化
  const expDateInput = document.getElementById('cardExpDate');
  if (expDateInput) {
    expDateInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length >= 2) {
        value = value.substring(0, 2) + '/' + value.substring(2, 4);
      }
      e.target.value = value;
    });
  }

  // 导入虚拟卡文件监听
  const importInput = document.getElementById('importCardsFile');
  if (importInput) {
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById('importCardsPreview').value = text;
    });
  }
  
  // 导入BIN文件监听
  const importBinsInput = document.getElementById('importBinsFile');
  if (importBinsInput) {
    importBinsInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById('importBinsPreview').value = text;
    });
  }
}

// DOM加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardEvents);
} else {
  initCardEvents();
}

// ==================== BIN卡头管理 ====================

let editingBinId = null;

// 渲染BIN列表
function renderBins() {
  const tbody = document.getElementById('binsList');
  if (!tbody) return;
  
  const bins = virtualCards.filter(c => c.type === 'bin');
  
  if (bins.length === 0) {
    tbody.innerHTML = generateEmptyStateHTML(4, '暂无BIN卡头', '点击"添加"按钮开始添加');
    return;
  }
  
  tbody.innerHTML = bins.map(bin => {
    const bindCount = bin.bindCount || 0;
    const bindClass = bindCount === 0 ? 'badge-card-none' : 'badge-card-bound';
    
    return `
      <tr>
        <td><div class="account-email-cell" style="font-size:14px;">${bin.bin}</div></td>
        <td><span class="badge ${bindClass}">${bindCount} 次</span></td>
        <td><div style="max-width:200px; overflow:hidden; text-overflow:ellipsis; color:#6e6e73;" title="${bin.note || ''}">${bin.note || '-'}</div></td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="action-btn" onclick="editBin('${bin.id}')" title="编辑">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="action-btn" onclick="deleteBin('${bin.id}')" title="删除" style="color:#ff3b30;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 显示BIN表单
function showBinForm() {
  editingBinId = null;
  document.getElementById('binFormTitle').textContent = '添加BIN卡头';
  document.getElementById('binNumber').value = '';
  document.getElementById('binNote').value = '';
  document.getElementById('binFormError').textContent = '';
  document.getElementById('binFormModal').style.display = 'flex';
}

// 隐藏BIN表单
function hideBinForm() {
  document.getElementById('binFormModal').style.display = 'none';
  editingBinId = null;
}

// 编辑BIN
function editBin(binId) {
  const bin = virtualCards.find(c => c.id === binId);
  if (!bin) return;
  
  editingBinId = binId;
  document.getElementById('binFormTitle').textContent = '编辑BIN卡头';
  document.getElementById('binNumber').value = bin.bin || '';
  document.getElementById('binNote').value = bin.note || '';
  document.getElementById('binFormError').textContent = '';
  document.getElementById('binFormModal').style.display = 'flex';
}

// 保存BIN
async function saveBin() {
  const binNumber = document.getElementById('binNumber').value.trim();
  const note = document.getElementById('binNote').value.trim();
  const errorEl = document.getElementById('binFormError');

  if (!binNumber || binNumber.length < 6) {
    errorEl.textContent = '请输入有效的BIN卡头（至少6位）';
    return;
  }

  if (!/^[\dxX]+$/.test(binNumber)) {
    errorEl.textContent = 'BIN卡头只能包含数字和 x';
    return;
  }

  // 判重
  const exists = virtualCards.find(c => 
    c.id !== editingBinId &&
    c.type === 'bin' &&
    c.bin === binNumber.toLowerCase()
  );
  
  if (exists) {
    errorEl.textContent = '该BIN卡头已存在';
    return;
  }

  const bin = {
    id: editingBinId || Date.now().toString(),
    type: 'bin',
    bin: binNumber.toLowerCase(),
    bindCount: editingBinId ? virtualCards.find(c => c.id === editingBinId).bindCount : 0,
    note,
    createdAt: editingBinId ? virtualCards.find(c => c.id === editingBinId).createdAt : new Date().toISOString()
  };

  if (editingBinId) {
    const index = virtualCards.findIndex(c => c.id === editingBinId);
    virtualCards[index] = bin;
  } else {
    virtualCards.push(bin);
  }

  const result = await ipcRenderer.invoke('save-cards', virtualCards);
  if (result.success) {
    hideBinForm();
    renderBins();
    renderCards();  // 同时更新完整卡列表
    showToast(editingBinId ? 'BIN已更新' : 'BIN已添加', 'success');
  } else {
    errorEl.textContent = '保存失败: ' + result.error;
  }
}

// 删除BIN
async function deleteBin(binId) {
  if (!confirm('确定要删除这个BIN卡头吗？')) return;

  virtualCards = virtualCards.filter(c => c.id !== binId);
  const result = await ipcRenderer.invoke('save-cards', virtualCards);
  if (result.success) {
    renderBins();
    renderCards();  // 同时更新完整卡列表
    showToast('BIN已删除', 'success');
  }
}

// 显示导入BIN表单
function showImportBinsForm() {
  document.getElementById('importBinsFile').value = '';
  document.getElementById('importBinsPreview').value = '';
  document.getElementById('importBinsResult').innerHTML = '';
  document.getElementById('importBinsModal').style.display = 'flex';
}

// 隐藏导入BIN表单
function hideImportBinsForm() {
  document.getElementById('importBinsModal').style.display = 'none';
}

// 导入BIN
async function importBins() {
  const text = document.getElementById('importBinsPreview').value.trim();
  const resultEl = document.getElementById('importBinsResult');

  if (!text) {
    resultEl.innerHTML = '<div class="status-message status-error">请选择文件</div>';
    return;
  }

  const lines = text.split('\n').filter(line => line.trim());
  let successCount = 0;
  let failCount = 0;
  let duplicateCount = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const binNumber = parts[0];
    const note = parts.slice(1).join(' ') || '';

    if (!binNumber || binNumber.length < 6 || !/^[\dxX]+$/.test(binNumber)) {
      failCount++;
      continue;
    }

    // 检查是否已存在
    const exists = virtualCards.find(c => c.type === 'bin' && c.bin === binNumber.toLowerCase());
    if (exists) {
      duplicateCount++;
      continue;
    }

    const bin = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      type: 'bin',
      bin: binNumber.toLowerCase(),
      bindCount: 0,
      note,
      createdAt: new Date().toISOString()
    };

    virtualCards.push(bin);
    successCount++;
  }

  if (successCount > 0) {
    const result = await ipcRenderer.invoke('save-cards', virtualCards);
    if (result.success) {
      renderBins();
      renderCards();  // 同时更新完整卡列表
      
      let message = `成功导入 ${successCount} 个BIN`;
      if (duplicateCount > 0) {
        message += `，${duplicateCount} 个重复BIN已跳过`;
      }
      if (failCount > 0) {
        message += `，${failCount} 条记录格式错误已跳过`;
      }
      
      resultEl.innerHTML = `
        <div class="status-message status-success">
          ${message}
        </div>
      `;
      setTimeout(() => {
        hideImportBinsForm();
      }, 2000);
    }
  } else {
    let message = '没有有效的BIN数据';
    if (duplicateCount > 0) {
      message = `所有BIN都已存在（${duplicateCount} 个重复）`;
    }
    resultEl.innerHTML = `<div class="status-message status-error">${message}</div>`;
  }
}

// 导出BIN
function exportBins() {
  const bins = virtualCards.filter(c => c.type === 'bin');
  
  if (bins.length === 0) {
    alert('暂无BIN可导出');
    return;
  }

  const content = bins.map(bin =>
    `${bin.bin} ${bin.note || ''}`
  ).join('\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bin-cards-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('BIN已导出', 'success');
}

// 导出模块并暴露到全局
const cardsModule = {
  loadCards,
  showCardForm,
  hideCardForm,
  editCard,
  saveCard,
  deleteCard,
  showImportCardsForm,
  hideImportCardsForm,
  importCards,
  exportCards,
  showBinForm,
  hideBinForm,
  editBin,
  saveBin,
  deleteBin,
  showImportBinsForm,
  hideImportBinsForm,
  importBins,
  exportBins
};

Object.assign(window, cardsModule);
module.exports = cardsModule;

// 监听虚拟卡刷新事件
ipcRenderer.on('refresh-cards', async () => {
  await loadCards();
});
