const path = require('path');
const { chromium } = require('@playwright/test');
const { ensureDir, writeJson } = require('./artifacts.cjs');
const { chromiumLaunchOptions } = require('./browser-options.cjs');
const { attachPageDiagnostics, makeArtifactDir, savePageSnapshot } = require('./snapshot.cjs');
const { waitForEnter } = require('./terminal.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili-real'));
const startUrl = process.argv[2] || 'https://www.bilibili.com/';
const saveSnapshot = process.env.DEBUG_SAVE_SNAPSHOT !== '0';
const headless = process.env.HEADLESS === '1';

(async () => {
  let tracingStarted = false;
  let artifactDir = null;

  const context = await chromium.launchPersistentContext(profileDir, chromiumLaunchOptions({
    headless,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 1000 }
  }));

  try {
    if (saveSnapshot) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
    }

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

    console.log(`Real Bilibili profile directory: ${profileDir}`);
    console.log(`Debug URL: ${startUrl}`);
    console.log('真实环境入口不会注入 Playwright GM shim，也不会自动加载仓库脚本。');
    console.log('首次安装 Tampermonkey/Violentmonkey 时，请先运行 npm run setup:bilibili-real-profile。');
    console.log('本命令会忽略 Playwright 默认的 --disable-extensions，以便已安装的真实扩展继续运行。');
    console.log(saveSnapshot
      ? '复现问题后回到终端按 Enter，会先保存真实环境现场再关闭浏览器。'
      : '结束后回到终端按 Enter 关闭浏览器。');

    await waitForEnter();

    if (saveSnapshot) {
      artifactDir = ensureDir(makeArtifactDir(repoRoot, 'real-debug-sessions'));
      await savePageSnapshot(page, {
        artifactDir,
        mode: 'real-debug',
        notes: 'Saved from a real userscript manager profile. No Playwright GM shim or runner injection was used.',
        userscriptState: false,
        userscriptStateNote: 'Real userscript manager mode skips Playwright GM shim state collection. GM storage is managed by the installed extension.',
        consoleMessages: diagnostics.consoleMessages,
        pageErrors: diagnostics.pageErrors
      });
      writeJson(path.join(artifactDir, 'real-environment.json'), {
        profileDir,
        startUrl,
        headless,
        injectedByPlaywright: false,
        gmShim: false,
        extensionsEnabled: true,
        note: 'The userscript must be installed and executed by a real userscript manager in this browser profile.'
      });
      await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
      tracingStarted = false;
      console.log(`Real debug snapshot saved to: ${artifactDir}`);
    }
  } finally {
    if (tracingStarted) {
      const tracePath = artifactDir
        ? path.join(artifactDir, 'trace.zip')
        : path.join(ensureDir(makeArtifactDir(repoRoot, 'real-debug-sessions')), 'trace.zip');
      await context.tracing.stop({ path: tracePath }).catch(() => {});
    }
    await context.close();
  }
})();
