const path = require('path');
const { chromium } = require('@playwright/test');
const { ensureDir, writeJson } = require('./artifacts.cjs');
const { attachPageDiagnostics, makeArtifactDir, savePageSnapshot } = require('./snapshot.cjs');
const { waitForEnter } = require('./terminal.cjs');
const { clearDevToolsActivePort, launchChrome, waitForDevToolsEndpoint } = require('./real-browser.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili-real'));
const startUrl = process.argv[2] || 'https://www.bilibili.com/';
const saveSnapshot = process.env.DEBUG_SAVE_SNAPSHOT !== '0';

function selectSnapshotPage(browser, requestedUrl) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  if (pages.length === 0) {
    throw new Error('没有找到可采集的 Chrome 页面。请保持要采集的 Bilibili 标签页打开。');
  }

  const httpPages = pages.filter((page) => /^https?:\/\//.test(page.url()));
  const bilibiliPages = httpPages.filter((page) => {
    try {
      return new URL(page.url()).hostname.endsWith('bilibili.com');
    } catch (error) {
      return false;
    }
  });
  const requestedOrigin = (() => {
    try {
      return new URL(requestedUrl).origin;
    } catch (error) {
      return '';
    }
  })();
  const sameOriginPages = requestedOrigin
    ? httpPages.filter((page) => {
      try {
        return new URL(page.url()).origin === requestedOrigin;
      } catch (error) {
        return false;
      }
    })
    : [];

  return sameOriginPages.at(-1) || bilibiliPages.at(-1) || httpPages.at(-1) || pages.at(-1);
}

function terminateBrowser(browserProcess) {
  if (browserProcess.exitCode === null && !browserProcess.killed) {
    try {
      browserProcess.kill('SIGTERM');
    } catch (error) {
      // Browser may have already exited after the CDP connection closed.
    }
  }
}

(async () => {
  let launch;
  let devToolsEndpointPromise = null;
  try {
    clearDevToolsActivePort(profileDir);
    launch = launchChrome({
      profileDir,
      remoteDebuggingPort: 0,
      startUrl
    });
    devToolsEndpointPromise = waitForDevToolsEndpoint(profileDir);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const browserProcess = launch.process;

  browserProcess.on('error', (error) => {
    console.error(`启动浏览器失败: ${error.message}`);
  });

  console.log(`Browser executable: ${launch.browserPath}`);
  console.log(`Real Bilibili profile directory: ${profileDir}`);
  console.log(`Debug URL: ${startUrl}`);
  console.log('CDP endpoint: waiting for Chrome DevToolsActivePort');
  console.log('现在打开的是普通 Chrome 进程；人工复现阶段 Playwright 不会连接或控制页面。');
  console.log('请在浏览器中复现问题，并保持要采集的 Bilibili 标签页打开。');
  console.log(saveSnapshot
    ? '复现问题后回到终端按 Enter，工具会通过 CDP 临时接入、保存现场并关闭浏览器。'
    : '结束后回到终端按 Enter 关闭浏览器。');

  await waitForEnter();

  if (!saveSnapshot) {
    terminateBrowser(browserProcess);
    return;
  }

  let connectedBrowser = null;
  let tracingStarted = false;
  let artifactDir = null;

  try {
    const devToolsEndpoint = await devToolsEndpointPromise;
    connectedBrowser = await chromium.connectOverCDP(devToolsEndpoint.wsEndpoint || devToolsEndpoint.httpEndpoint);
    const page = selectSnapshotPage(connectedBrowser, startUrl);
    const context = page.context();
    const diagnostics = attachPageDiagnostics(page);

    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracingStarted = true;
    } catch (error) {
      diagnostics.pageErrors.push({
        name: error.name,
        message: `CDP trace start failed: ${error.message}`,
        stack: error.stack
      });
    }

    artifactDir = ensureDir(makeArtifactDir(repoRoot, 'real-debug-sessions'));
    await savePageSnapshot(page, {
      artifactDir,
      mode: 'real-debug-cdp',
      notes: 'Saved after manual reproduction in an ordinary Chrome process. Playwright attached through CDP only after Enter.',
      userscriptState: false,
      userscriptStateNote: 'Real userscript manager mode skips Playwright GM shim state collection. GM storage is managed by the installed extension.',
      consoleMessages: diagnostics.consoleMessages,
      pageErrors: diagnostics.pageErrors
    });
    writeJson(path.join(artifactDir, 'real-environment.json'), {
      profileDir,
      startUrl,
      capturedUrl: page.url(),
      remoteDebuggingPort: devToolsEndpoint.port,
      cdpEndpoint: devToolsEndpoint.httpEndpoint,
      wsEndpoint: devToolsEndpoint.wsEndpoint,
      devToolsActivePortFile: devToolsEndpoint.filePath,
      launchedByPlaywright: false,
      playwrightAttachedAfterReproduction: true,
      injectedByPlaywright: false,
      gmShim: false,
      extensionsEnabled: true,
      consoleCapturedAfterAttachOnly: true,
      traceCoversCaptureOnly: true,
      note: 'Manual reproduction happened in a normal Chrome process. Playwright connected through CDP only to save artifacts.'
    });
    if (tracingStarted) {
      await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
      tracingStarted = false;
    }
    console.log(`Real debug snapshot saved to: ${artifactDir}`);
  } finally {
    if (tracingStarted && artifactDir && connectedBrowser) {
      const firstContext = connectedBrowser.contexts()[0];
      await firstContext?.tracing.stop({ path: path.join(artifactDir, 'trace.zip') }).catch(() => {});
    }
    await connectedBrowser?.close().catch(() => {});
    terminateBrowser(browserProcess);
  }
})();
