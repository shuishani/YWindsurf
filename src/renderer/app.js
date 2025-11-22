/**
 * 渲染进程入口文件
 * 负责模块加载和标签页切换
 * 注意: 各模块的函数已在各自文件中通过 window.xxx 暴露,这里只需加载模块即可
 */

// 加载所有模块 - 模块加载时会自动将函数暴露到 window
const path = require('path');
require(path.join(__dirname, 'utils', 'utils'));
require(path.join(__dirname, 'pages', 'cards'));
require(path.join(__dirname, 'pages', 'accounts'));
require(path.join(__dirname, 'pages', 'settings'));
const home = require(path.join(__dirname, 'pages', 'home'));

// 标签页切换
window.switchTab = function(tabName, evt) {
  try {
    // 移除所有激活状态
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // 激活点击的导航项
    if (evt && evt.currentTarget) {
      evt.currentTarget.classList.add('active');
    } else {
      // 通过 tabName 查找对应的导航项
      const navItem = document.querySelector(`.nav-item[onclick*="${tabName}"]`);
      if (navItem) navItem.classList.add('active');
    }
    
    // 激活对应的内容区域
    const tabContent = document.getElementById(tabName);
    if (tabContent) {
      tabContent.classList.add('active');
    }
    
    // 加载对应页面数据
    const dataLoaders = {
      register: () => window.loadAccounts(),
      switch: () => window.loadCards(),
      settings: () => window.loadSettings().catch(console.error)
    };
    
    if (dataLoaders[tabName]) {
      dataLoaders[tabName]();
    }
  } catch (error) {
    console.error('switchTab error:', error);
  }
};

// 页面加载完成后初始化首页
document.addEventListener('DOMContentLoaded', () => {
  // 稍微延迟加载首页数据，确保启动日志先显示
  setTimeout(() => {
    home.refreshSystemInfo();
  }, 200);
});
