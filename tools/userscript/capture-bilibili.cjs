const path = require('path');
const { chromium } = require('@playwright/test');
const { collectUserscriptState, installUserscript } = require('./runner.cjs');
const { ensureDir, timestampForPath, writeJson, writeText } = require('./artifacts.cjs');
const { chromiumLaunchOptions } = require('./browser-options.cjs');

const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run capture:bilibili -- <url>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili'));
const artifactDir = ensureDir(path.join(repoRoot, 'artifacts', 'captures', timestampForPath()));
const waitMs = Number(process.env.CAPTURE_WAIT_MS || 5000);
const headless = process.env.HEADLESS === '1';

(async () => {
  const consoleMessages = [];
  const pageErrors = [];
  let tracingStarted = false;

  const context = await chromium.launchPersistentContext(profileDir, chromiumLaunchOptions({
    headless,
    viewport: { width: 1440, height: 1000 }
  }));

  try {
    await installUserscript(context, {
      scriptPath,
      initialStore: {
        bvh_settings: { debug: true }
      }
    });

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracingStarted = true;

    const page = context.pages()[0] || await context.newPage();
    page.on('console', (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location()
      });
    });
    page.on('pageerror', (error) => {
      pageErrors.push({
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(waitMs);

    await page.screenshot({ path: path.join(artifactDir, 'screenshot.png'), fullPage: true });
    writeText(path.join(artifactDir, 'page.html'), await page.content());
    writeJson(path.join(artifactDir, 'console.json'), consoleMessages);
    writeJson(path.join(artifactDir, 'page-errors.json'), pageErrors);
    writeJson(path.join(artifactDir, 'userscript-state.json'), await collectUserscriptState(page));
    writeJson(path.join(artifactDir, 'summary.json'), {
      url,
      capturedAt: new Date().toISOString(),
      waitMs,
      headless,
      artifactDir
    });

    await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
    tracingStarted = false;

    console.log(`Capture saved to: ${artifactDir}`);
  } finally {
    if (tracingStarted) {
      await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') }).catch(() => {});
    }
    await context.close();
  }
})();
