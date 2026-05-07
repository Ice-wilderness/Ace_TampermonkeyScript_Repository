const path = require('path');
const { chromium, expect, test } = require('@playwright/test');
const { collectUserscriptState, installUserscript } = require('../../tools/userscript/runner.cjs');
const { chromiumLaunchOptions } = require('../../tools/userscript/browser-options.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const profileDir = path.join(repoRoot, '.browser-profiles', 'bilibili');

const defaultUrls = [
  'https://www.bilibili.com/'
];

function getSmokeUrls() {
  return (process.env.BILIBILI_E2E_URLS || defaultUrls.join(','))
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

test('Bilibili real-page smoke with userscript runner', async () => {
  const consoleErrors = [];
  const pageErrors = [];

  const context = await chromium.launchPersistentContext(profileDir, chromiumLaunchOptions({
    headless: process.env.HEADLESS === '1',
    viewport: { width: 1440, height: 1000 }
  }));

  try {
    await installUserscript(context, {
      scriptPath,
      initialStore: {
        bvh_settings: { debug: true }
      }
    });

    const page = context.pages()[0] || await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const url of getSmokeUrls()) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(Number(process.env.BILIBILI_E2E_WAIT_MS || 5000));
      const state = await collectUserscriptState(page);
      expect(state.menuCommands.map((command) => command.name)).toContain('打开设置与历史管理');
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((text) => text.includes('[userscript-runner]'))).toEqual([]);
  } finally {
    await context.close();
  }
});
