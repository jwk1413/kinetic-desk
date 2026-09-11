// Preserve the known-working local Electron runtime; re-sign after bundle changes.
// Ad-hoc signing validates local integrity; it is not Developer ID notarization.
const { execFileSync } = require('node:child_process');
const { join, dirname } = require('node:path');
const { cpSync, rmSync } = require('node:fs');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const localArch = process.arch === 'arm64' ? 3 : 1;
  if (context.arch !== localArch) throw new Error('Mac runtime packaging requires matching host architecture');
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Keep the known-working Electron runtime layout, then re-seal the entire bundle.
  const runtime = join(dirname(require.resolve('electron/package.json')), 'dist/Electron.app');
  for (const dir of ['MacOS', 'Frameworks']) {
    const dest = join(app, 'Contents', dir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(runtime, 'Contents', dir), dest, { recursive: true, verbatimSymlinks: true });
  }
  const plist = join(app, 'Contents/Info.plist');
  execFileSync('plutil', ['-replace', 'CFBundleExecutable', '-string', 'Electron', plist]);
  execFileSync('plutil', ['-remove', 'ElectronAsarIntegrity', plist]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], {stdio:'inherit'});
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {stdio:'inherit'});
};
