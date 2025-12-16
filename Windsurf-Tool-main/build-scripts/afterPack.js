const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const asarmor = require('asarmor');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ====== ESM 依赖修复函数 ======
// 将 chrome-launcher 及其依赖复制到 puppeteer-real-browser/node_modules 目录
// 解决 ESM 动态导入 (await import()) 在 asar 打包环境中找不到模块的问题
function fixEsmDependencies(unpackedPath) {
  console.log('   修复 ESM 依赖问题...');
  
  const prbPath = path.join(unpackedPath, 'node_modules', 'puppeteer-real-browser');
  if (!fs.existsSync(prbPath)) {
    console.log('   ⚠️ 未找到 puppeteer-real-browser 目录');
    return;
  }
  
  // 需要复制到 puppeteer-real-browser/node_modules 的模块
  // chrome-launcher 及其所有依赖
  const modulesToCopy = [
    'chrome-launcher',
    '@types',  // @types/node 的父目录
    'escape-string-regexp',
    'is-wsl',
    'lighthouse-logger',
    'marky',
    'debug',
    'ms'
  ];
  
  // 创建目标 node_modules 目录
  const targetNodeModules = path.join(prbPath, 'node_modules');
  if (!fs.existsSync(targetNodeModules)) {
    fs.mkdirSync(targetNodeModules, { recursive: true });
  }
  
  let copiedCount = 0;
  for (const moduleName of modulesToCopy) {
    const sourcePath = path.join(unpackedPath, 'node_modules', moduleName);
    const targetPath = path.join(targetNodeModules, moduleName);
    
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      try {
        copyDirSync(sourcePath, targetPath);
        copiedCount++;
        console.log(`   ✓ 复制 ${moduleName} -> puppeteer-real-browser/node_modules/`);
      } catch (error) {
        console.warn(`   ⚠️ 复制 ${moduleName} 失败: ${error.message}`);
      }
    }
  }
  
  // ====== 修复 rebrowser-puppeteer-core 内部的依赖 ======
  const rebrowserPath = path.join(unpackedPath, 'node_modules', 'rebrowser-puppeteer-core', 'node_modules');
  
  // 1. 修复 proxy-agent 依赖
  const proxyAgentPath = path.join(rebrowserPath, 'proxy-agent');
  if (fs.existsSync(proxyAgentPath)) {
    console.log('   修复 proxy-agent 依赖...');
    
    const proxyAgentDeps = [
      'proxy-from-env',
      'lru-cache',
      'socks',
      'ip-address',
      'smart-buffer'
    ];
    
    const proxyAgentNodeModules = path.join(proxyAgentPath, 'node_modules');
    if (!fs.existsSync(proxyAgentNodeModules)) {
      fs.mkdirSync(proxyAgentNodeModules, { recursive: true });
    }
    
    for (const dep of proxyAgentDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(proxyAgentNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> proxy-agent/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
  }
  
  // 定义 @puppeteer/browsers 需要的依赖列表（在外部定义以便复用）
  // 完整覆盖所有嵌套依赖，避免 Windows 打包后出现依赖缺失
  const browsersDeps = [
      // extract-zip 及其依赖
      'extract-zip',
      'get-stream',
      'pump',
      'end-of-stream',
      'once',
      'wrappy',
      'yauzl',
      'fd-slicer',
      'buffer-crc32',
      'pend',
      // progress
      'progress',
      // unbzip2-stream 及其依赖
      'unbzip2-stream',
      'buffer',
      'through',
      'base64-js',
      'ieee754',
      // yargs 及其依赖
      'yargs',
      'cliui',
      'escalade',
      'get-caller-file',
      'require-directory',
      'string-width',
      'y18n',
      'yargs-parser',
      'strip-ansi',
      'wrap-ansi',
      'ansi-regex',
      'ansi-styles',
      'color-convert',
      'color-name',
      'emoji-regex',
      'is-fullwidth-code-point',
      // tar-fs 及其依赖（关键！Windows 缺失 mkdirp-classic）
      'tar-stream',
      'tar-fs',
      'mkdirp-classic',
      'bare-fs',
      'bare-path',
      'b4a',
      'fast-fifo',
      'streamx',
      'text-decoder',
      'events-universal',
      'bare-events',
      // semver
      'semver',
      // proxy-agent 及其完整依赖链
      'proxy-agent',
      'agent-base',
      'http-proxy-agent',
      'https-proxy-agent',
      'pac-proxy-agent',
      'socks-proxy-agent',
      'proxy-from-env',
      'lru-cache',
      // pac-resolver 及其依赖
      'pac-resolver',
      'degenerator',
      'ast-types',
      'escodegen',
      'esprima',
      'estraverse',
      'esutils',
      'source-map',
      'tslib',
      'netmask',
      // get-uri 及其依赖
      'get-uri',
      'basic-ftp',
      'data-uri-to-buffer',
      // socks 及其依赖
      'socks',
      'ip-address',
      'smart-buffer',
      'sprintf-js',
      // is-wsl 的依赖
      'is-docker',
      // 通用依赖
      'debug',
      'ms',
      // rebrowser-puppeteer-core 的依赖
      'typed-query-selector',
      'chromium-bidi',
      'devtools-protocol',
      'mitt',
      'urlpattern-polyfill',
      'zod',
      'ws'
  ];
  
  // 复制 @tootallnate 目录（pac-proxy-agent 的依赖）
  const tootallnateSrc = path.join(unpackedPath, 'node_modules', '@tootallnate');
  if (fs.existsSync(tootallnateSrc)) {
    console.log('   复制 @tootallnate 依赖...');
    // 这个会在后续的 browsersDeps 复制中一起处理
  }
  
  // 2. 修复 rebrowser-puppeteer-core 内的 @puppeteer/browsers 依赖
  const browsersPath = path.join(rebrowserPath, '@puppeteer', 'browsers');
  if (fs.existsSync(browsersPath)) {
    console.log('   修复 @puppeteer/browsers 依赖...');
    
    const browsersNodeModules = path.join(browsersPath, 'node_modules');
    if (!fs.existsSync(browsersNodeModules)) {
      fs.mkdirSync(browsersNodeModules, { recursive: true });
    }
    
    for (const dep of browsersDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(browsersNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> @puppeteer/browsers/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
    
    // 复制 @tootallnate 到 @puppeteer/browsers/node_modules
    const tootallnateTarget = path.join(browsersNodeModules, '@tootallnate');
    if (fs.existsSync(tootallnateSrc) && !fs.existsSync(tootallnateTarget)) {
      try {
        copyDirSync(tootallnateSrc, tootallnateTarget);
        copiedCount++;
        console.log(`   ✓ 复制 @tootallnate -> @puppeteer/browsers/node_modules/`);
      } catch (error) {
        console.warn(`   ⚠️ 复制 @tootallnate 失败: ${error.message}`);
      }
    }
  }
  
  // 3. 修复根目录的 @puppeteer/browsers 依赖
  const rootBrowsersPath = path.join(unpackedPath, 'node_modules', '@puppeteer', 'browsers');
  if (fs.existsSync(rootBrowsersPath)) {
    console.log('   修复根目录 @puppeteer/browsers 依赖...');
    
    const rootBrowsersNodeModules = path.join(rootBrowsersPath, 'node_modules');
    if (!fs.existsSync(rootBrowsersNodeModules)) {
      fs.mkdirSync(rootBrowsersNodeModules, { recursive: true });
    }
    
    for (const dep of browsersDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(rootBrowsersNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> 根目录@puppeteer/browsers/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
    
    // 复制 @tootallnate 到根目录 @puppeteer/browsers/node_modules
    const rootTootallnateTarget = path.join(rootBrowsersNodeModules, '@tootallnate');
    if (fs.existsSync(tootallnateSrc) && !fs.existsSync(rootTootallnateTarget)) {
      try {
        copyDirSync(tootallnateSrc, rootTootallnateTarget);
        copiedCount++;
        console.log(`   ✓ 复制 @tootallnate -> 根目录@puppeteer/browsers/node_modules/`);
      } catch (error) {
        console.warn(`   ⚠️ 复制 @tootallnate 失败: ${error.message}`);
      }
    }
  }
  
  // 4. 修复 extract-zip 的依赖（确保 get-stream 和 yauzl 在正确位置）
  const extractZipPath = path.join(browsersPath, 'node_modules', 'extract-zip');
  if (fs.existsSync(extractZipPath)) {
    console.log('   修复 extract-zip 依赖...');
    
    const extractZipDeps = ['get-stream', 'pump', 'end-of-stream', 'once', 'wrappy', 'yauzl', 'fd-slicer', 'buffer-crc32', 'pend'];
    const extractZipNodeModules = path.join(extractZipPath, 'node_modules');
    
    if (!fs.existsSync(extractZipNodeModules)) {
      fs.mkdirSync(extractZipNodeModules, { recursive: true });
    }
    
    for (const dep of extractZipDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(extractZipNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> extract-zip/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
  }
  
  // 5. 修复 mailparser/parseley 依赖链
  // parseley 需要 leac 和 peberminta，但它们可能没有被正确解包
  const parseleyPath = path.join(unpackedPath, 'node_modules', 'parseley');
  if (fs.existsSync(parseleyPath)) {
    console.log('   修复 parseley 依赖...');
    
    const parseleyDeps = ['leac', 'peberminta'];
    const parseleyNodeModules = path.join(parseleyPath, 'node_modules');
    
    if (!fs.existsSync(parseleyNodeModules)) {
      fs.mkdirSync(parseleyNodeModules, { recursive: true });
    }
    
    for (const dep of parseleyDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(parseleyNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> parseley/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
  }

  // 6. 修复 form-data 依赖链
  // form-data 需要 es-set-tostringtag 及其深层依赖
  const formDataPath = path.join(unpackedPath, 'node_modules', 'form-data');
  if (fs.existsSync(formDataPath)) {
    console.log('   修复 form-data 依赖...');
    
    const formDataDeps = [
      'es-set-tostringtag',
      'hasown',
      'es-errors',
      'get-intrinsic',
      'has-tostringtag',
      'function-bind',
      'call-bind-apply-helpers',
      'es-define-property',
      'es-object-atoms',
      'get-proto',
      'dunder-proto',
      'gopd',
      'has-symbols',
      'math-intrinsics'
    ];
    const formDataNodeModules = path.join(formDataPath, 'node_modules');
    
    if (!fs.existsSync(formDataNodeModules)) {
      fs.mkdirSync(formDataNodeModules, { recursive: true });
    }
    
    for (const dep of formDataDeps) {
      const sourcePath = path.join(unpackedPath, 'node_modules', dep);
      const targetPath = path.join(formDataNodeModules, dep);
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          copyDirSync(sourcePath, targetPath);
          copiedCount++;
          console.log(`   ✓ 复制 ${dep} -> form-data/node_modules/`);
        } catch (error) {
          console.warn(`   ⚠️ 复制 ${dep} 失败: ${error.message}`);
        }
      }
    }
  }

  console.log(`   ✅ ESM 依赖修复完成: 复制了 ${copiedCount} 个模块`);
}

// 递归复制目录
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 混淆配置（安全版本）
const obfuscateConfig = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedNames: [
    'require', 'module', 'exports', '__dirname', '__filename',
    'window', 'document', 'console', 'process', 'global', 'Buffer',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'async', 'await', 'Error', 'JSON', 'Object', 'Array',
    'String', 'Number', 'Boolean', 'Function', 'Symbol', 'Map', 'Set',
    'AccountManager', 'AccountQuery', 'switchToAccount', 'lucide',
    'AutoBindCard', 'ipcRenderer', 'showCenterMessage', 'electron',
    'app', 'BrowserWindow', 'ipcMain', 'shell', 'dialog', 'Menu',
    'log', 'warn', 'error', 'info', 'debug',
    // Puppeteer 相关方法
    'page', 'browser', 'puppeteer', 'launch', 'newPage', 'goto', 'click',
    'type', 'waitForSelector', 'waitForTimeout', 'waitForNavigation',
    'evaluate', 'evaluateHandle', 'focus', 'select', 'close', 'screenshot',
    'frames', 'mainFrame', 'content', 'setViewport', 'cookies', 'setCookie', 'deleteCookie'
  ],
  reservedStrings: ['console', 'ipcRenderer', 'lucide', 'electron']
};

// 混淆单个文件
function obfuscateFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, obfuscateConfig);
    fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
    return true;
  } catch (error) {
    console.warn(`   ⚠️ 混淆失败: ${path.basename(filePath)} - ${error.message}`);
    return false;
  }
}

// 不混淆的文件列表（包含 page.evaluate 等需要在浏览器上下文执行的代码，或需要调试的模块）
const excludeFiles = [
  'registrationBot.js',
  'autoBindCard.js',
  'accountSwitcher.js'  // 切号功能，不混淆便于调试
];

// 递归混淆目录
function obfuscateDirectory(dir, excludeDirs = ['node_modules']) {
  if (!fs.existsSync(dir)) return 0;

  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        count += obfuscateDirectory(fullPath, excludeDirs);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      // 跳过排除列表中的文件
      if (excludeFiles.includes(entry.name)) {
        console.log(`   ⏭️ 跳过混淆: ${entry.name} (包含浏览器上下文代码)`);
        continue;
      }
      if (obfuscateFile(fullPath)) count++;
    }
  }
  return count;
}

exports.default = async function(context) {
  const { appOutDir, packager } = context;
  const platformName = packager.platform.name;
  const electronPlatformName = context.electronPlatformName;
  
  console.log(`\n🔒 afterPack: ${platformName} (${electronPlatformName}) 平台打包完成`);
  console.log(`   输出目录: ${appOutDir}`);
  
  // 获取资源路径
  let resourcesPath;
  if (platformName === 'mac' || electronPlatformName === 'darwin') {
    const appFilename = packager.appInfo.productFilename + '.app';
    resourcesPath = path.join(appOutDir, appFilename, 'Contents', 'Resources');
  } else {
    resourcesPath = path.join(appOutDir, 'resources');
  }

  const asarPath = path.join(resourcesPath, 'app.asar');
  const appPath = path.join(resourcesPath, 'app');

  console.log(`   资源路径: ${resourcesPath}`);

  // 修复 app.asar.unpacked 中的 ESM 依赖
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
  if (fs.existsSync(unpackedPath)) {
    console.log('\n🔧 修复解压目录中的 ESM 依赖...');
    fixEsmDependencies(unpackedPath);
  }

  // 检查是否使用 ASAR
  if (fs.existsSync(asarPath)) {
    // ASAR 模式：解压 -> 混淆 -> 重新打包 -> 加密
    console.log('\n📦 检测到 ASAR 模式');
    
    try {
      // 1. 解压 ASAR
      console.log('   解压 ASAR...');
      execSync(`npx asar extract "${asarPath}" "${appPath}"`, { stdio: 'pipe' });
      
      // 2. 混淆主进程
      console.log('   混淆主进程...');
      const mainPath = path.join(appPath, 'main.js');
      if (fs.existsSync(mainPath)) {
        obfuscateFile(mainPath);
      }
      
      // 3. 混淆前端 JS
      console.log('   混淆前端 JS...');
      let totalCount = 0;
      
      const rendererPath = path.join(appPath, 'renderer.js');
      if (fs.existsSync(rendererPath) && obfuscateFile(rendererPath)) {
        totalCount++;
      }
      
      const jsDir = path.join(appPath, 'js');
      if (fs.existsSync(jsDir)) {
        totalCount += obfuscateDirectory(jsDir);
      }
      
      const srcDir = path.join(appPath, 'src');
      if (fs.existsSync(srcDir)) {
        totalCount += obfuscateDirectory(srcDir);
      }
      
      console.log(`   ✅ 混淆完成: ${totalCount} 个文件`);
      
      // 4. 重新打包 ASAR
      console.log('   重新打包 ASAR...');
      fs.unlinkSync(asarPath);
      execSync(`npx asar pack "${appPath}" "${asarPath}"`, { stdio: 'pipe' });
      
      // 5. 删除解压的目录
      fs.rmSync(appPath, { recursive: true, force: true });
      
      // 6. 应用 asarmor 保护
      console.log('   应用 asarmor 保护...');
      const archive = await asarmor.open(asarPath);
      archive.patch();
      await archive.write(asarPath);
      
      console.log('\n🔒 代码保护完成：');
      console.log('   - 主进程: 强力混淆保护');
      console.log('   - 前端 JS: 强力混淆保护');
      console.log('   - ASAR: 防解压保护');
      
    } catch (error) {
      console.error('❌ 保护失败:', error.message);
    }
  } else if (fs.existsSync(appPath)) {
    // 非 ASAR 模式：直接混淆
    console.log('\n📁 检测到非 ASAR 模式');
    
    try {
      // 混淆主进程
      console.log('   混淆主进程...');
      const mainFilePath = path.join(appPath, 'main.js');
      if (fs.existsSync(mainFilePath)) {
        obfuscateFile(mainFilePath);
      }
      
      // 混淆前端 JS
      console.log('   混淆前端 JS...');
      let totalCount = 0;
      
      const rendererPath = path.join(appPath, 'renderer.js');
      if (fs.existsSync(rendererPath) && obfuscateFile(rendererPath)) {
        totalCount++;
      }
      
      const jsDir = path.join(appPath, 'js');
      if (fs.existsSync(jsDir)) {
        totalCount += obfuscateDirectory(jsDir);
      }
      
      const srcDir = path.join(appPath, 'src');
      if (fs.existsSync(srcDir)) {
        totalCount += obfuscateDirectory(srcDir);
      }
      
      console.log('\n🔒 代码保护完成：');
      console.log('   - 主进程: 强力混淆保护');
      console.log(`   - 前端 JS: 强力混淆保护 (${totalCount} 个文件)`);
      
    } catch (error) {
      console.error('❌ 保护失败:', error.message);
    }
  } else {
    console.warn('⚠️ 未找到应用目录');
  }
};
