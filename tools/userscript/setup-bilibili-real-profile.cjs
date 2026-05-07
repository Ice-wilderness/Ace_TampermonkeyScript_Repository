const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ensureDir } = require('./artifacts.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili-real'));
const startUrl = process.argv[2] || 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo';

function findBrowserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const absoluteCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];

  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }

  return null;
}

const browserPath = findBrowserExecutable();

if (!browserPath) {
  console.error('未找到可用的 Chrome/Chromium。请先在 WSL 中安装 google-chrome-stable，或设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH。');
  process.exit(1);
}

console.log(`Browser executable: ${browserPath}`);
console.log(`Real Bilibili profile directory: ${profileDir}`);
console.log(`Setup URL: ${startUrl}`);
console.log('这个命令不会通过 Playwright 控制浏览器，适合安装 Tampermonkey/Violentmonkey 和本地 loader。');
console.log('准备完成后请关闭这个 Chrome 窗口，命令会随浏览器退出。');

const browser = spawn(browserPath, [
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  startUrl
], {
  stdio: 'inherit'
});

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
