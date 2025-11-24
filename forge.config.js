const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'YWindsurf',
    executableName: 'YWindsurf',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-nsis',
      config: {
        name: 'YWindsurf',
        setupExe: 'YWindsurf-Setup.exe',
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        license: 'LICENSE.txt',
        displayLanguageSelector: false,
        installerLanguages: ['zh_CN'],
        createDesktopShortcut: true,
        createStartMenuShortcut: true
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
