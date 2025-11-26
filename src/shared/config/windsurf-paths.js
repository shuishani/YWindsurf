const path = require('path');
const fs = require('fs');

/**
 * Windsurf路径配置
 * 简单的配置管理，支持自定义安装目录
 */
class WindsurfPaths {
  constructor() {
    // 默认的Windsurf数据目录（基于环境变量）
    this.baseDataDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'Windsurf') : null;
    this.baseCacheDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Windsurf') : null;
    
    // 可自定义的安装目录（默认常见位置）
    this.customInstallDir = null;
    
    // 可自定义的data目录
    this.customDataDir = null;
    
    // 检测是否为开发者版本
    this.isDevMode = this.detectDevMode();
    
    this.loadConfig();
  }

  /**
   * 获取Windsurf安装目录
   */
  getInstallDir() {
    if (this.customInstallDir && fs.existsSync(this.customInstallDir)) {
      return this.customInstallDir;
    }
    
    // 默认安装位置
    const defaultPaths = [
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Windsurf'),
      path.join(process.env.PROGRAMFILES, 'Windsurf'),
      path.join(process.env['PROGRAMFILES(X86)'], 'Windsurf')
    ];
    
    for (const installPath of defaultPaths) {
      if (fs.existsSync(installPath)) {
        return installPath;
      }
    }
    
    return null;
  }

  /**
   * 获取Windsurf可执行文件路径
   */
  getExecutablePath() {
    const installDir = this.getInstallDir();
    return installDir ? path.join(installDir, 'Windsurf.exe') : null;
  }

  /**
   * 获取数据目录
   */
  getDataDir() {
    return this.baseDataDir;
  }

  /**
   * 获取缓存目录
   */
  getCacheDir() {
    return this.baseCacheDir;
  }

  /**
   * 设置自定义安装目录
   */
  setCustomInstallDir(dir) {
    this.customInstallDir = dir || null; // 空字符串转为null，表示重置
    this.saveConfig();
  }

  /**
   * 设置自定义data目录
   */
  setCustomDataDir(dir) {
    this.customDataDir = dir || null; // 空字符串转为null，表示重置
    this.saveConfig();
  }

  /**
   * 检查是否使用自定义安装路径
   */
  isUsingCustomInstallPath() {
    return this.customInstallDir !== null;
  }

  /**
   * 检查是否使用自定义data路径
   */
  isUsingCustomDataPath() {
    return this.customDataDir !== null;
  }

  /**
   * 检查是否使用自定义路径（兼容旧方法）
   */
  isUsingCustomPath() {
    return this.customInstallDir !== null;
  }

  /**
   * 检测是否为开发者版本
   * 通过检查项目根目录是否存在 data 文件夹来判断
   */
  detectDevMode() {
    try {
      // 从当前文件位置向上查找项目根目录
      let currentDir = __dirname;
      for (let i = 0; i < 5; i++) { // 最多向上查找5层
        const dataDir = path.join(currentDir, 'data');
        if (fs.existsSync(dataDir)) {
          return true;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break; // 已到根目录
        currentDir = parentDir;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取项目根目录
   */
  getProjectRoot() {
    let currentDir = __dirname;
    for (let i = 0; i < 5; i++) {
      const dataDir = path.join(currentDir, 'data');
      if (fs.existsSync(dataDir)) {
        return currentDir;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return __dirname; // fallback
  }

  /**
   * 获取账号和虚拟卡JSON文件的存储目录
   * 优先级：自定义路径 > 开发者版本 > 安装版本
   */
  getJsonDataDir() {
    // 如果设置了自定义data路径，优先使用
    if (this.customDataDir && fs.existsSync(this.customDataDir)) {
      return this.customDataDir;
    }
    
    if (this.isDevMode) {
      // 开发者版本：使用项目根目录下的 data 文件夹
      const projectRoot = this.getProjectRoot();
      const dataDir = path.join(projectRoot, 'data');
      
      // 确保 data 目录存在
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      return dataDir;
    } else {
      // 安装版本：使用 YWindsurf 安装目录下的 data 文件夹
      const ywindsurfDataDir = this.getYWindsurfDataDir();
      
      // 确保 data 目录存在
      if (!fs.existsSync(ywindsurfDataDir)) {
        fs.mkdirSync(ywindsurfDataDir, { recursive: true });
      }
      
      return ywindsurfDataDir;
    }
  }

  /**
   * 获取安装版本的 data 文件夹
   * 直接使用当前应用安装目录下的 data 文件夹
   */
  getYWindsurfDataDir() {
    try {
      // 获取当前应用的可执行文件路径
      const { app } = require('electron');
      const appPath = app.getAppPath();
      
      // 如果是打包后的应用，appPath 会指向 app.asar 或安装目录
      // 我们需要找到实际的安装目录
      let installDir;
      
      if (appPath.includes('.asar')) {
        // 打包后的应用，获取 .asar 文件的父目录的父目录
        installDir = path.dirname(path.dirname(appPath));
      } else {
        // 开发环境或未打包，向上查找到合适的目录
        installDir = path.dirname(appPath);
      }
      
      // 返回安装目录下的 data 文件夹
      const dataDir = path.join(installDir, 'data');
      
      // 确保目录存在
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      return dataDir;
    } catch (error) {
      // 如果出错，回退到临时目录
      const os = require('os');
      const fallbackDir = path.join(os.tmpdir(), 'ywindsurf-data');
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    }
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      // 先尝试从默认位置加载配置，避免循环依赖
      let settingsPath;
      if (this.isDevMode) {
        const projectRoot = this.getProjectRoot();
        settingsPath = path.join(projectRoot, 'data', 'settings.json');
      } else {
        // 直接使用基础路径，不依赖 customDataDir
        const ywindsurfDataDir = this.getYWindsurfDataDir();
        settingsPath = path.join(ywindsurfDataDir, 'settings.json');
      }
      
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        // 只有在配置文件存在且有效时才设置自定义路径
        if (settings.windsurfPath && typeof settings.windsurfPath === 'string') {
          this.customInstallDir = settings.windsurfPath;
        }
        if (settings.dataPath && typeof settings.dataPath === 'string') {
          this.customDataDir = settings.dataPath;
        }
      }
    } catch (error) {
      // 静默处理配置加载失败，重置自定义路径
      this.customInstallDir = null;
      this.customDataDir = null;
    }
  }

  /**
   * 保存配置到统一的 settings.json
   */
  saveConfig() {
    try {
      // 避免循环依赖，直接使用基础路径
      let settingsPath;
      if (this.isDevMode) {
        const projectRoot = this.getProjectRoot();
        settingsPath = path.join(projectRoot, 'data', 'settings.json');
        
        // 确保目录存在
        const dataDir = path.join(projectRoot, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
      } else {
        const ywindsurfDataDir = this.getYWindsurfDataDir();
        settingsPath = path.join(ywindsurfDataDir, 'settings.json');
        
        // 确保目录存在
        if (!fs.existsSync(ywindsurfDataDir)) {
          fs.mkdirSync(ywindsurfDataDir, { recursive: true });
        }
      }
      
      let settings = {};
      
      // 读取现有设置
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      
      // 更新路径配置
      settings.windsurfPath = this.customInstallDir || '';
      settings.useCustomWindsurfPath = !!this.customInstallDir;
      settings.dataPath = this.customDataDir || '';
      settings.useCustomDataPath = !!this.customDataDir;
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      // 配置已保存
    } catch (error) {
      // 保存路径配置失败，静默处理
    }
  }
}

// 导出单例
module.exports = new WindsurfPaths();
