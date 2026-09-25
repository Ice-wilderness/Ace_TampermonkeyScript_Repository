import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => errors.push(error.message));
const bootstrap = `
    const previewValues = new Map();
    window.GM_getValue = (key, fallback) => previewValues.has(key) ? previewValues.get(key) : fallback;
    window.GM_setValue = (key, value) => previewValues.set(key, value);
    window.GM_deleteValue = key => previewValues.delete(key);
    window.GM_listValues = () => [...previewValues.keys()];
    window.GM = { getValue: async (key, fallback) => GM_getValue(key, fallback),
        setValue: async (key, value) => GM_setValue(key, value), deleteValue: async key => GM_deleteValue(key),
        listValues: async () => GM_listValues() };
    window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    window.GM_addValueChangeListener = () => 1;
    window.GM_removeValueChangeListener = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_info = { script: { version: 'preview' } };
    window.unsafeWindow = window;
`;
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({ content: bootstrap });
await page.addScriptTag({ content: instrument() });
if (!await page.evaluate(() => !!globalThis.testAPI)) throw new Error(`脚本预览初始化失败：${errors.join('；')}`);
await page.evaluate(() => testAPI.injectStyles());
await page.evaluate(() => testAPI.UIComponent.showManagerPanel({ activeTab: 'cloud' }));
await page.locator('[data-cloud-field="url"]').waitFor();
assert.equal(await page.locator('[data-tab]').count(), 4);
assert.equal(await page.locator('[data-cloud-path]').innerText(), '/bilibili-history/');
const unconfigured = path.join(os.tmpdir(), 'bvh-cloud-unconfigured.png');
await page.screenshot({ path: unconfigured });
await page.locator('[data-cloud-field="url"]').fill('https://dav.example/root/');
assert.equal(await page.locator('[data-cloud-path]').innerText(), '/bilibili-history/');
await page.locator('[data-cloud-field="directory"]').fill('archive/history');
assert.equal(await page.locator('[data-cloud-path]').innerText(), '/archive/history/bilibili-history/');
await page.locator('[data-cloud-field="directory"]').fill('');
assert.equal(await page.locator('[data-cloud-path]').innerText(), '/bilibili-history/');
await page.locator('[data-cloud-field="directory"]').fill('archive/history');
await page.evaluate(() => {
    testAPI.WebDavClient.prototype.testConnection = async function () {
        window.testedRoot = this.root;
        return { conditional: false };
    };
});
const titleStatusBeforeTest = await page.locator('[data-cloud-status]').innerText();
await page.locator('[data-action="cloud-test"]').click();
assert.match(await page.locator('.bvh-progress-toast').last().innerText(), /连接成功/);
assert.equal(await page.locator('[data-cloud-status]').innerText(), titleStatusBeforeTest);
assert.equal(await page.evaluate(() => window.testedRoot),
    'https://dav.example/root/archive/history/bilibili-history/');
assert.equal(await page.evaluate(() => GM_getValue('bvh_webdav_config')), undefined,
    '测试连接不得要求预先保存或自动保存配置');
await page.locator('[data-cloud-field="backupRetentionDays"]').fill('14');
await page.locator('[data-cloud-field="frequency"][value="daily"]').check();
await page.locator('[data-action="cloud-save"]').click();
await page.waitForFunction(() => GM_getValue('bvh_webdav_config')?.frequency === 'daily');
assert.equal(await page.evaluate(() => GM_getValue('bvh_webdav_config').backupRetentionDays), 14);
assert.equal(await page.evaluate(() => GM_getValue('bvh_webdav_config').directory), 'archive/history');
assert.equal(await page.locator('[data-action="cloud-sync"]').isEnabled(), true);
assert.equal(await page.locator('[data-cloud-days="14"]').getAttribute('aria-pressed'), 'true');
await page.evaluate(async () => {
    testAPI.WebDavSync.backups = async () => [];
    await testAPI.UIComponent.showManagerPanel().loadCloudBackups();
});
assert.match(await page.locator('[data-cloud-backups]').innerText(), /暂无日期备份/);
await page.locator('[data-action="cloud-reload"]').click();
assert.match(await page.locator('.bvh-progress-toast').last().innerText(), /暂无日期备份/);
await page.locator('[data-cloud-field="username"]').fill('unsaved-draft');
await page.locator('[data-tab="settings"]').click();
await page.locator('[data-tab="cloud"]').click();
assert.equal(await page.locator('[data-cloud-field="username"]').inputValue(), 'unsaved-draft');
assert.equal(await page.evaluate(() => GM_getValue('bvh_webdav_config').username), '');
await page.evaluate(() => {
    testAPI.WebDavClient.prototype.testConnection = async () => { throw new Error('模拟认证失败'); };
});
const titleStatusBeforeFailedTest = await page.locator('[data-cloud-status]').innerText();
await page.locator('[data-action="cloud-test"]').click();
assert.match(await page.locator('.bvh-progress-toast').last().innerText(), /连接失败：模拟认证失败/);
assert.equal(await page.locator('[data-cloud-status]').innerText(), titleStatusBeforeFailedTest);
await page.locator('[data-cloud-field="username"]').fill('');
await page.evaluate(() => { testAPI.WebDavSync.sync = async () => ({ changed: false }); });
const titleStatusBeforeSync = await page.locator('[data-cloud-status]').innerText();
await page.locator('[data-action="cloud-sync"]').click();
assert.match(await page.locator('.bvh-progress-toast').last().innerText(), /记录已是最新/);
assert.equal(await page.locator('[data-cloud-status]').innerText(), titleStatusBeforeSync);
await page.locator('[data-cloud-field="username"]').fill('unsaved-draft');
await page.evaluate(() => { window.previewToastCount = 0; testAPI.UIComponent.toast = () => { previewToastCount++; }; });
await page.locator('[data-cloud-field="backupRetentionDays"]').focus();
await page.evaluate(() => testAPI.WebDavSync.emit({ phase: 'error', message: '模拟自动任务失败' }));
assert.equal(await page.evaluate(() => previewToastCount), 0);
assert.equal(await page.locator('.bvh-dialog-mask').count(), 0);
assert.equal(await page.evaluate(() => document.activeElement?.dataset.cloudField), 'backupRetentionDays');
const failed = path.join(os.tmpdir(), 'bvh-cloud-failed.png');
await page.screenshot({ path: failed });
const desktop = path.join(os.tmpdir(), 'bvh-cloud-desktop.png');
await page.screenshot({ path: desktop });
await page.setViewportSize({ width: 390, height: 844 });
const mobile = path.join(os.tmpdir(), 'bvh-cloud-mobile.png');
await page.screenshot({ path: mobile });
await page.locator('.bvh-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
const mobileBottom = path.join(os.tmpdir(), 'bvh-cloud-mobile-bottom.png');
await page.screenshot({ path: mobileBottom });
await page.evaluate(() => testAPI.WebDavSync.emit({ state: { pendingChoice: {
    snapshotId: '123e4567-e89b-42d3-a456-426614174000' } } }));
assert.equal(await page.locator('.bvh-cloud-source').count(), 2);
await page.locator('[data-cloud-choice]').scrollIntoViewIfNeeded();
const mobileChoice = path.join(os.tmpdir(), 'bvh-cloud-mobile-choice.png');
await page.screenshot({ path: mobileChoice });
const bounds = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth, panelWidth: document.querySelector('.bvh-shell').scrollWidth,
    panelClient: document.querySelector('.bvh-shell').clientWidth }));
assert.ok(bounds.documentWidth <= bounds.viewportWidth + 1, JSON.stringify(bounds));
assert.ok(bounds.panelWidth <= bounds.panelClient + 1, JSON.stringify(bounds));
assert.deepEqual(errors, []);
await browser.close();
await new Promise(resolve => server.close(resolve));
console.log(`未配置、空备份、失败、待选择及桌面和 390px 界面通过：${unconfigured}，${desktop}，${mobile}，${mobileBottom}，${failed}，${mobileChoice}`);
