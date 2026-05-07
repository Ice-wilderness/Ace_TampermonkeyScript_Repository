const { defineConfig } = require('@playwright/test');

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
const launchOptions = {
  ...(executablePath ? { executablePath } : {}),
  ...(channel && !executablePath ? { channel } : {})
};

module.exports = defineConfig({
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  outputDir: 'test-results/playwright',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]
  ],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'fixture',
      testMatch: /.*fixture\.spec\.cjs/,
      use: {
        browserName: 'chromium',
        launchOptions,
        viewport: { width: 1280, height: 900 }
      }
    },
    {
      name: 'bilibili',
      testMatch: /.*e2e\.spec\.cjs/,
      use: {
        browserName: 'chromium',
        launchOptions,
        viewport: { width: 1440, height: 1000 }
      }
    }
  ]
});
