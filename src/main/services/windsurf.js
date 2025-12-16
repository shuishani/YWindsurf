const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { createTaggedLogger } = require('../utils/logger');
const windsurfPaths = require('../../shared/config/windsurf-paths');

/**
 * Windsurf管理器 - Windows版本
 * 重置配置、机器码、自动登录
 */
// 静态变量：缓存 Windsurf 可执行文件路径
let cachedWindsurfPath = null;

class WindsurfManagerWindows {
  constructor(logCallback = null, tag = '') {
    // logCallback参数保留以兼容旧代码，但不再使用
    this.platform = 'win32';
    // 使用带标签的logger实例
    this.logger = createTaggedLogger(tag);
    
    // 使用简单的路径配置
    this.windsurfPaths = windsurfPaths;
    
    // Windsurf 相关路径
    this.paths = {
      appSupport: this.windsurfPaths.getDataDir(),
      cache: path.join(this.windsurfPaths.getCacheDir(), 'Cache'),
      userData: path.join(this.windsurfPaths.getDataDir(), 'User'),
      logs: path.join(this.windsurfPaths.getDataDir(), 'logs')
    };
    
    // 需要删除的子目录
    this.deleteSubdirs = [
      'Cache',
      'CachedData',
      'CachedExtensionVSIXs',
      'CachedProfilesData',
      'Code Cache',
      'Cookies',
      'Cookies-journal',
      'Crashpad',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'GPUCache',
      'Local Storage',
      'Session Storage',
      'Shared Dictionary',
      'SharedStorage',
      'TransportSecurity',
      'Trust Tokens',
      'Trust Tokens-journal',
      'blob_storage',
      'logs',
      'Network Persistent State',
    ];
    
    // 配置文件路径
    this.storageJson = path.join(this.paths.appSupport, 'User', 'globalStorage', 'storage.json');
    this.machineidFile = path.join(this.paths.appSupport, 'machineid');
  }

  /**
   * 日志输出（统一使用logger系统）
   */
  log(...args) {
    const message = args.join(' ');
    this.logger.info(message);
  }

  /**
   * 等待指定毫秒
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成64位十六进制机器ID
   */
  generateMachineId() {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 64; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  /**
   * 生成UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 生成带大括号的UUID
   */
  generateSqmId() {
    return '{' + this.generateUUID() + '}';
  }

  /**
   * 检查 Windsurf 是否正在运行（Windows）
   */
  async checkWindsurfRunning() {
    try {
      const { stdout } = await execPromise('tasklist /FI "IMAGENAME eq Windsurf.exe" /NH');
      return stdout.toLowerCase().includes('windsurf.exe');
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取正在运行的 Windsurf 可执行文件路径
   */
  async getRunningWindsurfPath() {
    try {
      const { stdout } = await execPromise(
        'wmic process where "name=\'Windsurf.exe\'" get ExecutablePath /format:list',
        { timeout: 5000 }
      );
      const match = stdout.match(/ExecutablePath=(.+\.exe)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (error) {
      // 获取失败，忽略
    }
    return null;
  }

  /**
   * 关闭 Windsurf 应用（Windows）
   */
  async closeWindsurf() {
    try {
      this.logger.system('正在关闭Windsurf');
      
      const isRunning = await this.checkWindsurfRunning();
      if (!isRunning) {
        this.logger.info('Windsurf未运行');
        return true;
      }
      
      // 关闭前缓存运行路径（用于后续启动）
      const runningPath = await this.getRunningWindsurfPath();
      if (runningPath) {
        cachedWindsurfPath = runningPath;
      }
      
      this.logger.info('检测到Windsurf正在运行,开始关闭');
      
      // 正常关闭
      await execPromise('taskkill /IM Windsurf.exe').catch(() => {});
      await this.sleep(2000);
      
      // 检查是否成功关闭
      const stillRunning1 = await this.checkWindsurfRunning();
      if (!stillRunning1) {
        this.logger.success('Windsurf已成功关闭');
        return true;
      }
      
      // 强制关闭所有相关进程
      await execPromise('taskkill /F /IM Windsurf.exe').catch(() => {});
      await execPromise('taskkill /F /IM "Windsurf Helper.exe"').catch(() => {});
      await execPromise('taskkill /F /IM "Windsurf Helper (GPU).exe"').catch(() => {});
      await execPromise('taskkill /F /IM "Windsurf Helper (Renderer).exe"').catch(() => {});
      await this.sleep(3000); // 增加等待时间
      
      if (!await this.checkWindsurfRunning()) {
        this.logger.success('Windsurf已强制关闭');
        return true;
      }
      
      // 通过进程树关闭
      await execPromise('wmic process where "name=\'Windsurf.exe\'" call terminate').catch(() => {});
      await this.sleep(2000);
      
      this.logger.warning('Windsurf关闭流程完成，继续执行');
      return true;
      
    } catch (error) {
      this.logger.error('关闭Windsurf失败', error.message);
      return false;
    }
  }

  /**
   * 删除缓存和数据
   */
  async deleteCachesAndData() {
    this.log('\n🗑️  删除缓存和数据...');
    
    // 删除 Application Support 下的子目录
    for (const subdir of this.deleteSubdirs) {
      const dirPath = path.join(this.paths.appSupport, subdir);
      try {
        const stat = await fs.stat(dirPath);
        if (stat.isFile()) {
          await fs.unlink(dirPath);
          this.log(`  ✓ 已删除文件: ${subdir}`);
        } else {
          await fs.rm(dirPath, { recursive: true, force: true });
          this.log(`  ✓ 已删除目录: ${subdir}`);
        }
      } catch (error) {
        // 文件不存在,跳过
      }
    }
    
    // 删除 Cache 目录
    try {
      await fs.rm(this.paths.cache, { recursive: true, force: true });
      this.log('  ✓ 已删除: Cache');
    } catch (error) {
      // 目录不存在
    }
  }

  /**
   * 清理用户数据
   */
  async cleanUserData() {
    this.log('\n🧹 清理用户数据...');
    
    const userDir = this.paths.userData;
    
    try {
      await fs.access(userDir);
    } catch (error) {
      this.log('  ⚠️  User目录不存在');
      return;
    }
    
    // 删除 globalStorage (除了 storage.json)
    const globalStorage = path.join(userDir, 'globalStorage');
    try {
      const items = await fs.readdir(globalStorage);
      for (const item of items) {
        if (item !== 'storage.json') {
          const itemPath = path.join(globalStorage, item);
          const stat = await fs.stat(itemPath);
          if (stat.isFile()) {
            await fs.unlink(itemPath);
          } else {
            await fs.rm(itemPath, { recursive: true, force: true });
          }
          this.log(`  ✓ 已删除: globalStorage/${item}`);
        }
      }
    } catch (error) {
      // 目录不存在
    }
    
    // 清理 workspaceStorage
    const workspaceStorage = path.join(userDir, 'workspaceStorage');
    try {
      await fs.rm(workspaceStorage, { recursive: true, force: true });
      await fs.mkdir(workspaceStorage, { recursive: true });
      this.log('  ✓ 已清理: workspaceStorage');
    } catch (error) {
      // 处理失败
    }
    
    // 清理 History
    const history = path.join(userDir, 'History');
    try {
      await fs.rm(history, { recursive: true, force: true });
      await fs.mkdir(history, { recursive: true });
      this.log('  ✓ 已清理: History');
    } catch (error) {
      // 处理失败
    }
  }

  /**
   * 创建预设配置
   */
  async createPresetConfig() {
    this.log('\n📝 创建预设配置...');
    
    // 生成新的ID
    const newMachineId = this.generateMachineId();
    const newSqmId = this.generateSqmId();
    const newDeviceId = this.generateUUID();
    const newMachineid = this.generateUUID();
    
    this.log(`  新machineId: ${newMachineId}`);
    this.log(`  新sqmId: ${newSqmId}`);
    this.log(`  新devDeviceId: ${newDeviceId}`);
    this.log(`  新machineid: ${newMachineid}`);
    
    // 1. 创建 settings.json
    try {
      const settingsPath = path.join(this.paths.appSupport, 'User', 'settings.json');
      const settings = {
        "workbench.startupEditor": "none",
        "workbench.welcomePage.walkthroughs.openOnInstall": false,
        "telemetry.telemetryLevel": "off",
        "window.commandCenter": true,
        "explorer.confirmDragAndDrop": false,
        "explorer.confirmDelete": false
      };
      
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      this.log('  ✓ 已创建: settings.json');
    } catch (error) {
      this.log(`  ✗ 创建失败 settings.json: ${error.message}`);
    }
    
    // 2. 创建 storage.json
    try {
      const storageData = {
        "telemetry.machineId": newMachineId,
        "telemetry.sqmId": newSqmId,
        "telemetry.devDeviceId": newDeviceId,
        "theme": "vs-dark",
        "themeBackground": "#1f1f1f"
      };
      
      await fs.mkdir(path.dirname(this.storageJson), { recursive: true });
      
      // 如果文件已存在，先删除
      try {
        await fs.unlink(this.storageJson);
      } catch (e) {
        // 文件不存在，忽略
      }
      
      await fs.writeFile(this.storageJson, JSON.stringify(storageData, null, 4));
      this.log('  ✓ 已创建: storage.json');
    } catch (error) {
      this.log(`  ✗ 创建失败 storage.json: ${error.message}`);
    }
    
    // 3. 创建 machineid 文件
    try {
      await fs.mkdir(path.dirname(this.machineidFile), { recursive: true });
      
      // 如果文件已存在，先删除
      try {
        await fs.unlink(this.machineidFile);
      } catch (e) {
        // 文件不存在，忽略
      }
      
      await fs.writeFile(this.machineidFile, newMachineid + '\n');
      this.log('  ✓ 已创建: machineid');
    } catch (error) {
      this.log(`  ✗ 创建失败 machineid: ${error.message}`);
    }
    
    // 4. 创建必要的目录结构
    try {
      const dirs = [
        path.join(this.paths.appSupport, 'User', 'workspaceStorage'),
        path.join(this.paths.appSupport, 'User', 'History'),
        path.join(this.paths.appSupport, 'User', 'globalStorage')
      ];
      
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }
      this.log('  ✓ 已创建必要目录');
    } catch (error) {
      this.log(`  ✗ 创建目录失败: ${error.message}`);
    }
  }

  /**
   * 重置机器标识（旧方法，保留兼容）
   */
  async resetMachineIds() {
    this.log('\n🔧 重置机器标识...');
    
    // 生成新的ID
    const newMachineId = this.generateMachineId();
    const newSqmId = this.generateSqmId();
    const newDeviceId = this.generateUUID();
    const newMachineid = this.generateUUID();
    
    this.log(`  新machineId: ${newMachineId}`);
    this.log(`  新sqmId: ${newSqmId}`);
    this.log(`  新devDeviceId: ${newDeviceId}`);
    this.log(`  新machineid: ${newMachineid}`);
    
    // 修改 storage.json
    try {
      let data;
      try {
        const content = await fs.readFile(this.storageJson, 'utf-8');
        data = JSON.parse(content);
      } catch (error) {
        // 文件不存在，创建新的
        data = {};
      }
      
      // 修改三个字段
      data['telemetry.machineId'] = newMachineId;
      data['telemetry.sqmId'] = newSqmId;
      data['telemetry.devDeviceId'] = newDeviceId;
      
      // 清理其他可能的标识字段
      const keysToRemove = [
        'backupWorkspaces',
        'profileAssociations',
        'windowControlHeight',
        'lastKnownMenubarData'
      ];
      for (const key of keysToRemove) {
        delete data[key];
      }
      
      // 确保目录存在
      await fs.mkdir(path.dirname(this.storageJson), { recursive: true });
      
      // 写回文件
      await fs.writeFile(this.storageJson, JSON.stringify(data, null, 4));
      
      this.log('  ✓ 已修改: storage.json');
    } catch (error) {
      this.log(`  ✗ 修改失败 storage.json: ${error.message}`);
    }
    
    // 修改 machineid 文件
    try {
      await fs.mkdir(path.dirname(this.machineidFile), { recursive: true });
      await fs.writeFile(this.machineidFile, newMachineid + '\n');
      this.log('  ✓ 已修改: machineid');
    } catch (error) {
      this.log(`  ✗ 修改失败 machineid: ${error.message}`);
    }
  }

  /**
   * 完整重置 Windsurf
   */
  async fullReset() {
    this.log('='.repeat(60));
    this.log('Windsurf完整重置 (Windows)');
    this.log('='.repeat(60));
    
    try {
      // 步骤1: 强制关闭Windsurf
      this.log('\n【步骤1/4】强制关闭Windsurf');
      const isRunning = await this.checkWindsurfRunning();
      if (isRunning) {
        this.log('⚠️  检测到Windsurf正在运行');
        await this.closeWindsurf();
        this.log('✓ Windsurf关闭流程完成');
        await this.sleep(3000);
      } else {
        this.log('✓ Windsurf未运行');
      }
      
      // 步骤2: 删除缓存和数据
      this.log('\n【步骤2/4】删除缓存和数据');
      await this.deleteCachesAndData();
      this.log('✓ 缓存和数据已删除');
      
      // 步骤3: 清理用户数据
      this.log('\n【步骤3/4】清理用户数据');
      await this.cleanUserData();
      this.log('✓ 用户数据已清理');
      
      // 步骤4: 创建预设配置
      this.log('\n【步骤4/4】创建预设配置并重置机器码');
      await this.createPresetConfig();
      this.log('✓ 预设配置已创建，机器码已重置');
      
      this.log('\n' + '='.repeat(60));
      this.log('✅ Windsurf重置完成!');
      this.log('='.repeat(60));
      
      return { success: true, message: 'Windsurf重置完成' };
    } catch (error) {
      this.logger.error('重置失败', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 检测 Windsurf 配置文件路径
   */
  async detectConfigPaths() {
    const results = {
      appSupport: { exists: false, path: this.paths.appSupport },
      cache: { exists: false, path: this.paths.cache },
      userData: { exists: false, path: this.paths.userData },
      logs: { exists: false, path: this.paths.logs },
      storageJson: { exists: false, path: this.storageJson },
      machineidFile: { exists: false, path: this.machineidFile },
    };

    for (const key in results) {
      try {
        await fs.access(results[key].path);
        results[key].exists = true;
      } catch (error) {
        results[key].exists = false;
      }
    }

    return results;
  }

  /**
   * 检测 Windsurf 应用路径
   */
  async detectWindsurfApp() {
    for (const appPath of this.windsurfAppPaths) {
      try {
        await fs.access(appPath);
        this.windsurfApp = appPath;
        this.log(`✓ 找到Windsurf应用: ${appPath}`);
        return appPath;
      } catch (error) {
        // 继续检查下一个路径
      }
    }
    
    throw new Error('未找到Windsurf应用,请确认已安装');
  }

  /**
   * 启动 Windsurf 应用（Windows）
   */
  async launchWindsurf() {
    try {
      this.log('\n启动Windsurf...');
      
      let appPath = null;
      
      // 优先使用缓存的路径（关闭时保存的）
      if (cachedWindsurfPath) {
        try {
          await fs.access(cachedWindsurfPath);
          appPath = cachedWindsurfPath;
        } catch (e) {
          // 缓存路径无效，继续检测
        }
      }
      
      // 缓存路径无效，检测应用路径
      if (!appPath) {
        appPath = await this.detectWindsurfApp();
      }
      
      // 使用 start 命令启动
      await execPromise(`start "" "${appPath}"`);
      this.log('  ✓ Windsurf已启动');
      return true;
    } catch (error) {
      this.log(`  ✗ 启动失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 使用 robotjs 模拟按键
   */
  pressKey(key) {
    robot.keyTap(key);
  }

  /**
   * 按 Enter 键
   */
  async pressEnter() {
    this.log('  按 Enter 键...');
    robot.keyTap('enter');
    await this.sleep(500);
  }

  /**
   * 按 Tab 键
   */
  async pressTab() {
    robot.keyTap('tab');
    await this.sleep(300);
  }

  /**
   * 输入文本
   */
  async typeText(text) {
    this.log(`  输入文本: ${text}`);
    robot.typeString(text);
    await this.sleep(500);
  }

  /**
   * 等待窗口出现（Windows）
   * 使用 PowerShell 检测窗口
   */
  async waitForWindow(timeout = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const script = `
          Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class Win32 {
              [DllImport("user32.dll")]
              public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
            }
"@
          $hwnd = [Win32]::FindWindow($null, "Windsurf")
          if ($hwnd -ne [IntPtr]::Zero) {
            Write-Output "found"
          }
        `;
        const { stdout } = await execPromise(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
        if (stdout.trim() === 'found') {
          this.log('✓ 检测到 Windsurf 窗口');
          return true;
        }
      } catch (error) {
        // 继续等待
      }
      await this.sleep(1000);
    }
    return false;
  }

  /**
   * 激活 Windsurf 窗口（Windows）
   */
  async activateWindsurf() {
    try {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
          }
"@
        $hwnd = [Win32]::FindWindow($null, "Windsurf")
        if ($hwnd -ne [IntPtr]::Zero) {
          [Win32]::SetForegroundWindow($hwnd)
        }
      `;
      await execPromise(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      await this.sleep(500);
      return true;
    } catch (error) {
      this.log('激活窗口失败:', error.message);
      return false;
    }
  }

  /**
   * 自动完成初始设置流程（Windows版本）
   * 使用 robotjs 模拟键盘操作
   */
  async completeOnboarding() {
    try {
      this.log('\n🎯 开始自动完成初始设置 (Windows)...');
      
      // 等待窗口出现
      this.log('\n等待Windsurf窗口...');
      const hasWindow = await this.waitForWindow(30000);
      if (!hasWindow) {
        this.log('⚠️  未检测到窗口，可能Windsurf已经配置完成');
        return { success: true, message: '未检测到欢迎窗口' };
      }
      
      // 等待窗口内容完全加载
      this.log('等待窗口内容完全加载（3秒）...');
      await this.sleep(3000);
      
      // 激活窗口
      await this.activateWindsurf();
      await this.sleep(500);
      
      this.log('\n💡 使用键盘自动完成设置流程\n');
      
      // 前3个页面：按回车键
      for (let step = 1; step <= 3; step++) {
        this.log(`--- 步骤 ${step}/4: 按回车键 ---`);
        
        await this.activateWindsurf();
        await this.sleep(200);
        await this.pressEnter();
        this.log(`✓ 已按回车键`);
        
        await this.sleep(800);
      }
      
      // 第4个页面：按 Tab 键导航到 Log in 按钮，然后按 Enter
      this.log('\n--- 步骤 4/4: 导航并点击 Log in 按钮 ---');
      
      await this.activateWindsurf();
      await this.sleep(500);
      
      // 按 Tab 键导航到按钮（可能需要多次）
      this.log('按 Tab 键导航到 Log in 按钮...');
      for (let i = 0; i < 3; i++) {
        await this.pressTab();
      }
      
      // 按 Enter 点击按钮
      this.log('按 Enter 点击按钮...');
      await this.pressEnter();
      
      await this.sleep(2000);
      
      this.log('\n✓ 初始设置流程完成，浏览器应该已打开');
      return { success: true, message: '初始设置完成' };
      
    } catch (error) {
      this.log(`⚠️  设置流程出错: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 自动登录 Windsurf（Windows版本）
   * 流程：
   * 1. 完整重置
   * 2. 启动应用
   * 3. 完成初始设置
   * 4. 浏览器自动登录（使用 Puppeteer）
   * 
   * 注意：浏览器登录部分需要配合 BrowserAutomation 类使用
   */
  async autoLogin(email, password) {
    try {
      this.log('\n🔐 开始自动登录Windsurf (Windows)...');
      this.log(`📧 邮箱: ${email}`);
      
      // 1. 完整重置
      this.log('\n========== 步骤1: 完整重置Windsurf ==========');
      const resetResult = await this.fullReset();
      if (!resetResult.success) {
        throw new Error('重置失败: ' + resetResult.error);
      }
      await this.sleep(2000);
      
      // 2. 启动Windsurf
      this.log('\n========== 步骤2: 启动Windsurf ==========');
      await this.launchWindsurf();
      await this.sleep(5000);
      
      // 3. 完成初始设置
      this.log('\n========== 步骤3: 完成初始设置 ==========');
      const onboardingResult = await this.completeOnboarding();
      if (!onboardingResult.success) {
        this.log('⚠️  初始设置可能未完成，但继续执行');
      }
      
      this.log('\n========== 步骤4: 浏览器登录 ==========');
      this.log('💡 浏览器应该已经打开登录页面');
      this.log('💡 请使用 BrowserAutomation 类完成浏览器登录');
      this.log('💡 或手动在浏览器中完成登录');
      
      return {
        success: true,
        message: '自动登录流程完成，请在浏览器中完成登录',
        needsBrowserLogin: true
      };
      
    } catch (error) {
      this.log(`\n❌ 自动登录失败: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }





  /**
   * 生成 UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }


  /**
   * 获取键盘按键码（Windows）
   * robotjs 使用的是虚拟键码
   */
  getKeyCode(key) {
    const keyCodes = {
      'enter': 'enter',
      'return': 'enter',
      'tab': 'tab',
      'space': 'space',
      'escape': 'escape',
      'backspace': 'backspace',
      'delete': 'delete',
      'up': 'up',
      'down': 'down',
      'left': 'left',
      'right': 'right'
    };
    return keyCodes[key.toLowerCase()] || key;
  }

  /**
   * 启动 Windsurf
   */
  async startWindsurf() {
    try {
      this.log('正在启动 Windsurf...');
      
      // 检查是否已经在运行
      const isRunning = await this.checkWindsurfRunning();
      if (isRunning) {
        this.log('✓ Windsurf 已在运行');
        return true;
      }
      
      // 启动 Windsurf
      const { spawn } = require('child_process');
      let windsurfPath = null;
      
      // 优先使用缓存的路径（关闭时保存的）
      if (cachedWindsurfPath) {
        try {
          await fs.access(cachedWindsurfPath);
          windsurfPath = cachedWindsurfPath;
        } catch (e) {
          // 缓存路径无效，继续检测
        }
      }
      
      // 缓存路径无效，使用配置的路径
      if (!windsurfPath) {
        windsurfPath = this.windsurfPaths.getExecutablePath();
      }
      
      // 检查 Windsurf 可执行文件是否存在
      try {
        await fs.access(windsurfPath);
      } catch (error) {
        this.log('❌ 未找到 Windsurf 可执行文件');
        return false;
      }
      
      // 启动 Windsurf（分离进程）
      const child = spawn(windsurfPath, [], {
        detached: true,
        stdio: 'ignore'
      });
      
      child.unref(); // 允许父进程退出
      
      // 等待 Windsurf 启动并完全加载
      this.log('等待 Windsurf 启动...');
      await this.sleep(5000);
      
      // 验证是否成功启动
      const isNowRunning = await this.checkWindsurfRunning();
      if (isNowRunning) {
        this.log('Windsurf 启动成功');
        this.log('等待 Windsurf 完全加载账号信息...');
        await this.sleep(3000); // 额外等待账号信息加载
        return true;
      } else {
        this.log(' Windsurf 可能启动失败');
        return false;
      }
      
    } catch (error) {
      this.log('启动 Windsurf 失败:', error.message);
      return false;
    }
  }
}

module.exports = WindsurfManagerWindows;
