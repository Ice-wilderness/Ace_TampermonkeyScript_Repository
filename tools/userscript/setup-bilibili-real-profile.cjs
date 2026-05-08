const path = require('path');
const { ensureDir } = require('./artifacts.cjs');
const { launchChrome } = require('./real-browser.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili-real'));
const startUrl = process.argv[2] || 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo';

let launch;
try {
  launch = launchChrome({ profileDir, startUrl });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Browser executable: ${launch.browserPath}`);
console.log(`Real Bilibili profile directory: ${profileDir}`);
console.log(`Setup URL: ${startUrl}`);
console.log('这个命令不会通过 Playwright 控制浏览器，适合安装 Tampermonkey/Violentmonkey 和本地 loader。');
console.log('准备完成后请关闭这个 Chrome 窗口，命令会随浏览器退出。');

const browser = launch.process;

browser.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});

browser.on('error', (error) => {
  console.error(`启动浏览器失败: ${error.message}`);
  process.exit(1);
});
