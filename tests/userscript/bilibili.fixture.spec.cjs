const path = require('path');
const { test, expect } = require('@playwright/test');
const { collectUserscriptState, installUserscript } = require('../../tools/userscript/runner.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'Bilibili视频观看历史记录.js');
const listFixturePath = path.join(__dirname, 'fixtures', 'bilibili-list.html');
const videoFixturePath = path.join(__dirname, 'fixtures', 'bilibili-video.html');
const listUrl = 'https://www.bilibili.com/?__bvh_fixture=list';
const videoUrl = 'https://www.bilibili.com/video/BV1xx411c7mD/';

const watchedRecord = {
  v: 2,
  status: '已观看',
  currentTime: '03:21',
  percent: '67%',
  savedAt: '2026-05-07 23:00:00',
  title: 'Fixture watched video'
};

async function installBilibiliScript(context, initialStore = {}, options = {}) {
  await installUserscript(context, {
    scriptPath,
    initialStore: {
      bvh_settings: { debug: true },
      ...initialStore
    },
    eagerIntersectionObserver: true,
    ...options
  });
}

test('marks watched cards from GM storage', async ({ context, page }) => {
  await installBilibiliScript(context, {
    BV1xx411c7mD: watchedRecord
  });
  await context.route(listUrl, (route) => route.fulfill({ path: listFixturePath, contentType: 'text/html' }));

  await page.goto(listUrl);

  await expect(page.locator('.bvh-tag')).toContainText('已观看67%');
  await expect(page.locator('.bvh-progress-bar')).toBeVisible();

  const state = await collectUserscriptState(page);
  expect(state.menuCommands.map((command) => command.name)).toContain('打开设置与历史管理');
  expect(state.gmStore.bvh_meta.version).toBe(3);
});

test('opens manager panel through registered menu command', async ({ context, page }) => {
  await installBilibiliScript(context, {
    BV1xx411c7mD: watchedRecord
  });
  await context.route(listUrl, (route) => route.fulfill({ path: listFixturePath, contentType: 'text/html' }));

  await page.goto(listUrl);
  await page.evaluate(() => window.__userscriptRunMenuCommand('打开设置与历史管理'));

  await expect(page.locator('#bvh-modal-mask')).toBeVisible();
  await expect(page.locator('.bvh-history-summary')).toContainText('共 1 条');
});

test('records video progress on fixture video page', async ({ context, page }) => {
  await installBilibiliScript(context);
  await context.route(videoUrl, (route) => route.fulfill({ path: videoFixturePath, contentType: 'text/html' }));

  await page.goto(videoUrl);
  await expect(page.locator('#bvh-view-panel')).toBeVisible();

  await page.evaluate(() => {
    const video = document.querySelector('#fixture-video');
    video.duration = 100;
    video.currentTime = 42;
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('pause'));
  });

  await expect.poll(async () => {
    const state = await collectUserscriptState(page);
    return Object.values(state.gmStore)
      .filter((value) => value && typeof value === 'object')
      .some((value) => value.BV1xx411c7mD && value.BV1xx411c7mD.s === 1 && value.BV1xx411c7mD.p === 42);
  }).toBe(true);
});

test('shares GM storage updates across same-origin pages', async ({ context, page }) => {
  await installBilibiliScript(context, {
    BV1xx411c7mD: watchedRecord
  }, {
    storageKey: 'bvh_fixture_shared_store'
  });
  await context.route(listUrl, (route) => route.fulfill({ path: listFixturePath, contentType: 'text/html' }));

  await page.goto(listUrl);
  await expect(page.locator('.bvh-tag')).toContainText('已观看67%');

  const secondPage = await context.newPage();
  await secondPage.goto(listUrl);
  await secondPage.evaluate(() => {
    GM_setValue('bvh_shard_32', {
      BV1xx411c7mD: {
        s: 1,
        t: '08:00',
        p: 88,
        a: Math.floor(Date.now() / 1000),
        n: 'Updated from second page'
      }
    });
    GM_setValue('bvh_storage_revision', 99);
  });

  await page.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible'
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.locator('.bvh-tag')).toContainText('已观看88%');
});
