const path = require('path');
const { chromium } = require('@playwright/test');
const { installUserscript } = require('./runner.cjs');
const { ensureDir } = require('./artifacts.cjs');
const { chromiumLaunchOptions } = require('./browser-options.cjs');
const { attachPageDiagnostics, makeArtifactDir, savePageSnapshot } = require('./snapshot.cjs');

const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run capture:bilibili -- <url>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const profileDir = ensureDir(path.join(repoRoot, '.browser-profiles', 'bilibili'));
const artifactDir = ensureDir(makeArtifactDir(repoRoot, 'captures'));
const waitMs = Number(process.env.CAPTURE_WAIT_MS || 5000);
const headless = process.env.HEADLESS === '1';

(async () => {
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
    const diagnostics = attachPageDiagnostics(page);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(waitMs);

    await savePageSnapshot(page, {
      artifactDir,
      mode: 'capture',
      notes: `waitMs=${waitMs}; headless=${headless}`,
      consoleMessages: diagnostics.consoleMessages,
      pageErrors: diagnostics.pageErrors
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
