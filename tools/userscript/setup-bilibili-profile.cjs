const path = require('path');
const { chromium } = require('@playwright/test');
const { ensureDir } = require('./artifacts.cjs');
const { chromiumLaunchOptions } = require('./browser-options.cjs');
const { waitForEnter } = require('./terminal.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili'));

(async () => {
  const context = await chromium.launchPersistentContext(profileDir, chromiumLaunchOptions({
    headless: false,
    viewport: { width: 1440, height: 1000 }
  }));

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });

  console.log(`Bilibili profile directory: ${profileDir}`);
  console.log('请在打开的浏览器中完成登录。登录完成后回到终端按 Enter 关闭浏览器并保存 profile。');

  await waitForEnter();

  await context.close();
})();
