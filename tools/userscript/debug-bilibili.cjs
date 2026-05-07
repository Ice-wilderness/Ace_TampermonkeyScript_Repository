const path = require('path');
const { chromium } = require('@playwright/test');
const { ensureDir } = require('./artifacts.cjs');
const { chromiumLaunchOptions } = require('./browser-options.cjs');
const { collectUserscriptState, installUserscript } = require('./runner.cjs');
const { attachPageDiagnostics, makeArtifactDir, savePageSnapshot } = require('./snapshot.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili'));
const startUrl = process.argv[2] || 'https://www.bilibili.com/';
const saveSnapshot = process.env.DEBUG_SAVE_SNAPSHOT !== '0';

(async () => {
  const context = await chromium.launchPersistentContext(profileDir, chromiumLaunchOptions({
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1440, height: 1000 }
  }));

  await installUserscript(context, {
    scriptPath,
    initialStore: {
      bvh_settings: { debug: true }
    },
    storageKey: 'bvh_playwright_gm_store'
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = context.pages()[0] || await context.newPage();
  const diagnostics = attachPageDiagnostics(page);
  page.on('console', (message) => {
    const type = message.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[browser:${type}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.stack || error.message}`);
  });

  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log(`Bilibili profile directory: ${profileDir}`);
  console.log(`Debug URL: ${startUrl}`);
  console.log('浏览器会保持打开。你可以登录、跳转视频页并手动测试脚本。');
  console.log(saveSnapshot
    ? '复现问题后回到终端按 Enter，会先保存现场再关闭浏览器。'
    : '结束后回到终端按 Enter 关闭浏览器。');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  let artifactDir = null;
  if (saveSnapshot) {
    artifactDir = ensureDir(makeArtifactDir(repoRoot, 'debug-sessions'));
    await savePageSnapshot(page, {
      artifactDir,
      mode: 'debug',
      notes: 'Saved after manual reproduction before closing debug browser.',
      consoleMessages: diagnostics.consoleMessages,
      pageErrors: diagnostics.pageErrors
    });
    await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
    console.log(`Debug snapshot saved to: ${artifactDir}`);
  } else {
    await context.tracing.stop().catch(() => {});
  }

  const state = await collectUserscriptState(page).catch(() => null);
  if (state) {
    console.log(`Registered menu commands: ${state.menuCommands.map((command) => command.name).join(', ') || '(none)'}`);
  }

  await context.close();
})();
