import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { instance, sharedStorage, instrument } from './harness.mjs';

const shared = sharedStorage();
shared.data.set('bvh_settings', { tagOpacity: 70, floatingButtonVisibility: 'hide-video', floatingTheme: 'invalid', floatingAccentColor: 'red', floatingSize: '', floatingOpacity: 59, floatingMode: null });
shared.data.set('bvh_panel_position', { left: '52px', top: '81px' });
const legacy = instance(shared);
for (const key of ['floatingTheme', 'floatingAccentColor', 'floatingSize', 'floatingOpacity', 'floatingMode']) assert.equal(legacy.CONFIG[key], legacy.DEFAULT_CONFIG[key]);
assert.equal(legacy.CONFIG.tagOpacity, 70);
await legacy.SettingsManager.save({ floatingTheme: 'dark', floatingAccentColor: '#123456', floatingSize: 'large', floatingOpacity: 60, floatingMode: 'compact' });
const reloaded = instance(shared);
assert.equal(reloaded.CONFIG.floatingTheme, 'dark');
assert.equal(reloaded.CONFIG.floatingAccentColor, '#123456');
assert.equal(reloaded.CONFIG.floatingSize, 108);
assert.equal(reloaded.CONFIG.floatingOpacity, 60);
assert.equal(reloaded.CONFIG.floatingMode, 'compact');
assert.equal(reloaded.CONFIG.floatingButtonVisibility, 'hide-video');
assert.deepEqual(shared.data.get('bvh_panel_position'), { left: '52px', top: '81px' });
for (const value of ['', null, false, 'NaN', 101, 60.5]) {
    await legacy.SettingsManager.save({ floatingOpacity: value });
    assert.equal(legacy.CONFIG.floatingOpacity, 100);
}
assert.equal(instance().CONFIG.floatingMode, 'detailed');
for (const [value, expected] of [['small', 92], ['medium', 100], ['large', 108], [123, 123], [79, 100], [161, 100], [90.5, 100], ['', 100]]) {
    shared.data.set('bvh_settings', { floatingSize: value });
    assert.equal(instance(shared).CONFIG.floatingSize, expected);
}
console.log('通过：旧设置补齐、异常字段独立回退、外观持久化且保留原设置和位置');

const browser = await chromium.launch({ headless: true });
const artifactDir = path.join(os.tmpdir(), 'bvh-floating-entry-review');
await fs.mkdir(artifactDir, { recursive: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:linear-gradient(120deg,#d4e4e9,#f5f1e5);font:14px sans-serif}button.site-button{color:rgb(123,45,67)}</style></head><body><button class="site-button">页面原按钮</button></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        window.gmData = new Map(); window.gmWrites = []; window.menu = new Map(); window.failSave = false;
        window.GM_getValue = (key, fallback) => gmData.has(key) ? structuredClone(gmData.get(key)) : fallback;
        window.GM_setValue = (key, value) => {
            if (key === 'bvh_settings' && failSave) throw new Error('模拟保存失败');
            gmWrites.push(key); gmData.set(key, structuredClone(value));
        };
        window.GM_deleteValue = key => gmData.delete(key);
        window.GM_listValues = () => [...gmData.keys()];
        window.GM_registerMenuCommand = (label, fn) => menu.set(label, fn);
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { Utils, StorageManager, EpisodeResolver, UIComponent, AppController } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        await StorageManager.initialize();
        window.currentKey = 'BV0000000001';
        window.record = { status: '已观看', currentTime: '07:04', percent: '55%', savedAt: '2026-09-25 14:32:00' };
        EpisodeResolver.getCurrentKey = () => currentKey;
        StorageManager.getRecord = () => record;
        window.openManager = UIComponent.showManagerPanel;
        window.openCalls = [];
        UIComponent.showManagerPanel = options => openCalls.push(options);
        testAPI.injectStyles(); new AppController().initMenuCommands(); UIComponent.refreshFloatingButtons();
    });
    const entry = page.locator('body > .bvh-floating-entry');
    assert.equal(await entry.count(), 1);
    assert.equal(await entry.getAttribute('data-mode'), 'detailed');
    assert.equal(await entry.locator('[data-float-time]').textContent(), '07:04');
    assert.equal(await entry.locator('[data-float-saved]').textContent(), '2026-09-25 14:32:00');
    const videoSize = await entry.boundingBox();
    assert(videoSize.width <= 170 && videoSize.height <= 105, '标准视频入口应保持紧凑');
    assert(videoSize.width < 150, '视频入口宽度应随实际内容收紧');
    assert(await entry.evaluate(el => parseFloat(getComputedStyle(el.querySelector('[data-float-time]')).fontSize) >= 2 * parseFloat(getComputedStyle(el.querySelector('[data-float-status]')).fontSize)), '观看时间应具有明显的字号层级');
    assert.equal(await page.locator('.site-button').evaluate(el => getComputedStyle(el).color), 'rgb(123, 45, 67)');
    await page.evaluate(() => { window.originalEntry = testAPI.FloatingEntry.current.el; record.percent = '62%'; testAPI.UIComponent.updateViewPanelProgress(record); });
    assert(await page.evaluate(() => originalEntry === testAPI.FloatingEntry.current.el));
    assert.equal(await entry.locator('[data-float-percent]').textContent(), '62%');
    await page.evaluate(() => {
        Object.assign(testAPI.CONFIG, { floatingTheme: 'dark', floatingAccentColor: '#ee7799', floatingSize: 'large', floatingOpacity: 60, floatingMode: 'compact' });
        testAPI.UIComponent.refreshFloatingButtons();
    });
    assert.equal(await entry.locator('[data-float-compact]').textContent(), '62%');
    assert.equal(await entry.locator('[data-float-time]').isVisible(), false);
    const appearance = await entry.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity, font: getComputedStyle(el).fontSize, accent: getComputedStyle(el.querySelector('.bvh-float-icon')).color }));
    assert.deepEqual(appearance, { bg: 'rgba(32, 38, 49, 0.6)', opacity: '1', font: '14.04px', accent: 'rgb(238, 119, 153)' });
    assert((await entry.getAttribute('aria-label')).includes('07:04'));
    await page.evaluate(() => { currentKey = 'BV0000000001?p=3'; testAPI.UIComponent.refreshFloatingButtons(); });
    assert((await entry.getAttribute('aria-label')).includes('P3'));
    for (const state of [{ status: '已访问' }, { status: '正在读取历史记录…' }, { status: '已观看', percent: 'bad', savedAt: null }]) {
        await page.evaluate(state => { record = state; testAPI.CONFIG.floatingMode = 'detailed'; testAPI.UIComponent.refreshFloatingButtons(); }, state);
        assert.equal(await entry.locator('[data-float-track]').isVisible(), false);
        assert.equal(await entry.locator('[data-float-saved]').isVisible(), false);
        assert(!/undefined|NaN|Invalid Date/.test(await entry.textContent()));
    }
    console.log('通过：主题、颜色、大小与透明度，简洁信息、分 P、原地刷新及无进度状态');

    await page.evaluate(() => {
        history.replaceState({}, '', '/video/BV0000000002'); currentKey = 'BV0000000002'; record = null;
        testAPI.UIComponent.showQuickEntry();
    });
    assert.equal(await entry.getAttribute('id'), 'bvh-quick-entry', '新视频未加载时不得保留旧视频浮层');
    assert((await entry.getAttribute('aria-label')).includes('BV0000000002'));

    for (const video of [true, false]) for (const visibility of ['show-all', 'hide-video', 'hide-non-video', 'hide-all']) for (const hasRecord of [true, false]) {
        await page.evaluate(({ video, visibility, hasRecord }) => {
            history.replaceState({}, '', video ? '/video/BV0000000001' : '/');
            currentKey = video ? 'BV0000000001' : null;
            record = hasRecord ? { status: '已观看', percent: '55%' } : null;
            testAPI.CONFIG.floatingButtonVisibility = visibility;
            testAPI.UIComponent.refreshFloatingButtons();
        }, { video, visibility, hasRecord });
        const visible = visibility !== 'hide-all' && visibility !== (video ? 'hide-video' : 'hide-non-video');
        assert.equal(await entry.count(), visible ? 1 : 0, `${video}/${visibility}/${hasRecord}`);
        if (visible) assert.equal(await entry.getAttribute('id'), video && hasRecord ? 'bvh-view-panel' : 'bvh-quick-entry');
    }
    await page.evaluate(() => menu.get('打开设置与历史管理')());
    assert.equal(await page.evaluate(() => openCalls.length), 1);
    console.log('通过：两类路由 × 四种显示范围 × 有无记录；全部隐藏仍能从菜单打开');

    await page.evaluate(() => {
        Object.assign(testAPI.CONFIG, testAPI.DEFAULT_CONFIG); history.replaceState({}, '', '/video/BV0000000001'); currentKey = 'BV0000000001';
        record = { status: '已观看', currentTime: '07:04', percent: '55%', savedAt: '2026-09-25 14:32:00' };
        gmData.set('bvh_panel_position', { left: '52px', top: '81px' });
        testAPI.UIComponent.refreshFloatingButtons(); openCalls.length = 0;
    });
    let rect = await entry.boundingBox(); assert.equal(rect.x, 52); assert.equal(rect.y, 81);
    await entry.click(); assert.equal(await page.evaluate(() => openCalls.length), 1);
    assert.equal(await page.evaluate(() => openCalls[0].currentKey), 'BV0000000001');
    await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down();
    await page.mouse.move(500, 420, { steps: 5 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => openCalls.length), 1, '拖拽误触发点击');
    rect = await entry.boundingBox(); assert.equal(rect.x, 480); assert.equal(rect.y, 400);
    assert.deepEqual(await page.evaluate(() => gmData.get('bvh_panel_position')), { left: '480px', top: '400px' });
    await page.evaluate(() => { history.replaceState({}, '', '/'); currentKey = null; testAPI.UIComponent.refreshFloatingButtons(); });
    rect = await entry.boundingBox(); assert.equal(rect.x, 480); assert.equal(rect.y, 400);
    assert.equal(await entry.textContent(), '观看记录');
    assert(rect.width <= 115 && rect.height <= 40, '非视频入口应按内容收紧为单行');
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForFunction(() => testAPI.FloatingEntry.current.el.getBoundingClientRect().right <= 382);
    rect = await entry.boundingBox(); assert(rect.x + rect.width <= 382);
    assert.deepEqual(await page.evaluate(() => gmData.get('bvh_panel_position')), { left: '480px', top: '400px' }, '被动校正不应写入位置');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => testAPI.FloatingEntry.current.el.getBoundingClientRect().left === 480);
    await page.evaluate(() => menu.get('恢复面板默认位置')());
    rect = await entry.boundingBox(); assert.equal(rect.x, 15); assert.equal(900 - rect.y - rect.height, 15);
    assert.equal(await page.evaluate(() => gmData.has('bvh_panel_position')), false);
    for (const pos of [{ left: 'oops', top: '1px' }, { left: 'Infinitypx', top: '5px' }, { left: '-500px', top: '99999px' }]) {
        await page.evaluate(pos => { testAPI.FloatingEntry.remove(); gmData.set('bvh_panel_position', pos); testAPI.UIComponent.refreshFloatingButtons(); }, pos);
        rect = await entry.boundingBox(); assert(rect.x >= 8 && rect.y >= 8 && rect.x + rect.width <= 1272 && rect.y + rect.height <= 892);
    }
    await page.evaluate(() => testAPI.FloatingEntry.resetPosition());
    rect = await entry.boundingBox();
    const writesBefore = await page.evaluate(() => gmWrites.filter(key => key === 'bvh_panel_position').length);
    await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down(); await page.mouse.move(400, 350);
    await entry.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    await page.mouse.up();
    assert.equal(await page.evaluate(() => gmWrites.filter(key => key === 'bvh_panel_position').length), writesBefore);
    assert.equal((await entry.boundingBox()).x, 15);
    const callCount = await page.evaluate(() => openCalls.length);
    await page.evaluate(() => { for (let i = 0; i < 12; i++) testAPI.UIComponent.refreshFloatingButtons(); });
    await entry.click(); assert.equal(await page.evaluate(() => openCalls.length), callCount + 1);
    rect = await entry.boundingBox();
    await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down(); await page.mouse.move(250, 250);
    await page.evaluate(() => { window.removedEntry = testAPI.FloatingEntry.current.el; testAPI.FloatingEntry.remove(); });
    await page.mouse.up();
    await page.evaluate(() => removedEntry.click());
    assert.equal(await page.evaluate(() => openCalls.length), callCount + 1, '销毁后仍残留监听器');
    await page.evaluate(() => testAPI.UIComponent.refreshFloatingButtons());
    console.log('通过：旧位置共用、越界校正、位置恢复、拖拽与点击分离、取消与销毁清理');

    await page.evaluate(() => { testAPI.UIComponent.showManagerPanel = openManager; });
    await page.locator('.site-button').focus(); await page.keyboard.press('Tab');
    assert(await entry.evaluate(el => el === document.activeElement));
    assert.notEqual(await entry.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#bvh-modal-mask').count(), 1);
    await page.keyboard.press('Escape');
    assert(await entry.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#bvh-modal-mask').count(), 1);
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await entry.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('通过：键盘激活、可见焦点、关闭焦点恢复与减少动态效果');

    await entry.click();
    await page.evaluate(() => { window.panel = testAPI.HistoryManagerPanel.active; });
    assert.equal(await page.locator('.bvh-setting-groups > .bvh-section:visible').count(), 1);
    assert.equal(await page.locator('.bvh-preview-panel').isVisible(), false);
    assert.equal(await page.locator('.bvh-floating-preview-panel').isVisible(), false);
    await page.locator('.bvh-settings-nav [data-settings-group=floating]').click();
    const field = key => page.locator(`[data-setting="${key}"]`);
    const actualStyle = () => entry.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, mode: el.dataset.mode, theme: el.dataset.theme }));
    const originalStyle = await actualStyle();
    await field('floatingTheme').selectOption('dark');
    await page.locator('#bvh-floatingSize').fill('123');
    assert.equal(await field('floatingSize').first().inputValue(), '123');
    await page.locator('#bvh-floatingAccentColor').fill('#ee7799');
    await page.locator('#bvh-floatingOpacity').fill('75');
    for (const invalid of ['', '79', '161', '99.5']) {
        await page.locator('#bvh-floatingSize').fill(invalid); await page.locator('[data-action=save]').click();
        assert.equal(await page.locator('#bvh-error-floatingSize').textContent(), '请输入 80–160 的整数');
    }
    await page.locator('#bvh-floatingSize').fill('123');
    await field('floatingMode').selectOption('compact');
    await page.locator('.bvh-settings-nav [data-settings-group=marks]').click();
    assert.equal(await page.locator('.bvh-preview-panel').isVisible(), true);
    assert.equal(await page.locator('.bvh-floating-preview-panel').isVisible(), false);
    await page.locator('.bvh-settings-nav [data-settings-group=floating]').click();
    assert.equal(await field('floatingMode').inputValue(), 'compact');
    assert.equal(await page.locator('.bvh-preview-panel').isVisible(), false);
    assert.deepEqual(await actualStyle(), originalStyle, '草稿提前应用到了页面');
    const previewStyle = await page.locator('[data-floating-preview=video]').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, mode: el.dataset.mode, theme: el.dataset.theme }));
    assert.deepEqual(previewStyle, { bg: 'rgba(32, 38, 49, 0.75)', mode: 'compact', theme: 'dark' });
    assert.equal(await page.evaluate(() => gmData.has('bvh_settings')), false);
    await page.locator('[data-tab=history]').click();
    assert.equal(await page.locator('.bvh-settings-nav').isVisible(), false);
    await page.locator('[data-tab=settings]').click();
    assert.equal(await field('floatingTheme').inputValue(), 'dark');
    await page.locator('[data-floating-preview=video]').click();
    assert.equal(await page.locator('#bvh-modal-mask').count(), 1);
    await page.locator('#bvh-floatingAccentColor').fill('invalid');
    await page.locator('.bvh-settings-nav [data-settings-group=common]').click();
    await page.locator('[data-action=save]').click();
    assert.equal(await page.locator('.bvh-settings-nav [data-settings-group=floating]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.bvh-setting-groups > .bvh-section:visible').count(), 1);
    assert(await page.locator('#bvh-floatingAccentColor').evaluate(el => el === document.activeElement));
    assert.equal(await page.locator('#bvh-error-floatingAccentColor').textContent(), '请输入 #RRGGBB 格式的颜色');
    assert.equal(await page.evaluate(() => gmData.has('bvh_settings')), false);
    await page.locator('#bvh-floatingAccentColor').fill('#ee7799');
    for (const invalid of ['', '59', '101', '60.5']) {
        await page.locator('#bvh-floatingOpacity').fill(invalid); await page.locator('[data-action=save]').click();
        assert.equal(await page.locator('#bvh-error-floatingOpacity').textContent(), '请输入 60–100 的整数');
    }
    await page.locator('#bvh-floatingOpacity').fill('75');
    await page.evaluate(() => { panel.draft.floatingTheme = 'unknown'; });
    await page.locator('[data-action=save]').click();
    assert.equal(await page.locator('#bvh-error-floatingTheme').textContent(), '请选择有效的悬浮外观');
    await field('floatingTheme').selectOption('dark');
    await page.evaluate(() => { failSave = true; });
    await page.locator('[data-action=save]').click();
    await page.waitForFunction(() => !panel.saving);
    assert((await page.locator('.bvh-save-status').textContent()).includes('保存失败'));
    assert.deepEqual(await actualStyle(), originalStyle);
    assert.equal(await field('floatingTheme').inputValue(), 'dark');
    await page.evaluate(() => { failSave = false; });
    await page.locator('[data-action=save]').click();
    await page.waitForFunction(() => !panel.saving && !panel.dirty);
    assert.deepEqual(await actualStyle(), previewStyle);
    assert.equal(await page.evaluate(() => gmData.get('bvh_settings').floatingOpacity), 75);
    assert.equal(await page.evaluate(() => gmData.get('bvh_settings').floatingSize), 123);

    await field('floatingTheme').selectOption('light');
    await page.locator('[data-close]').click();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    assert.equal(await field('floatingTheme').inputValue(), 'light');
    await page.locator('[data-close]').click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    assert.deepEqual(await actualStyle(), previewStyle);
    await entry.click(); await page.evaluate(() => { panel = testAPI.HistoryManagerPanel.active; });
    await page.locator('.bvh-settings-nav [data-settings-group=floating]').click();
    assert.equal(await field('floatingTheme').inputValue(), 'dark');
    await field('floatingTheme').selectOption('light');
    await page.locator('[data-close]').click();
    await page.getByRole('button', { name: '保存后关闭', exact: true }).click();
    await page.waitForFunction(() => !testAPI.HistoryManagerPanel.active);
    assert.equal((await actualStyle()).theme, 'light');

    await entry.click(); await page.evaluate(() => { panel = testAPI.HistoryManagerPanel.active; });
    await page.locator('.bvh-settings-nav [data-settings-group=floating]').click();
    await field('floatingButtonVisibility').selectOption('hide-all');
    await page.locator('[data-action=save]').click(); await page.waitForFunction(() => !panel.saving && !panel.dirty);
    assert.equal(await entry.count(), 0);
    assert.equal(await page.locator('[data-floating-preview=video]').isVisible(), true);
    await page.evaluate(() => { gmData.set('bvh_panel_position', { left: '70px', top: '100px' }); });
    const otherSettings = await page.evaluate(() => ({ tagOpacity: panel.draft.tagOpacity, visibility: panel.draft.floatingButtonVisibility }));
    await page.locator('[data-action=floating-defaults]').click();
    assert.equal(await field('floatingTheme').inputValue(), 'light');
    assert.equal(await field('floatingMode').inputValue(), 'detailed');
    assert.deepEqual(await page.evaluate(() => ({ tagOpacity: panel.draft.tagOpacity, visibility: panel.draft.floatingButtonVisibility })), otherSettings);
    assert.deepEqual(await page.evaluate(() => gmData.get('bvh_panel_position')), { left: '70px', top: '100px' });
    assert.equal(await page.evaluate(() => gmData.get('bvh_settings').floatingMode), 'compact', '局部恢复提前写入');
    await page.locator('.bvh-settings-nav [data-settings-group=maintenance]').click();
    await page.locator('[data-action=reset-position]').click();
    assert.equal(await page.evaluate(() => gmData.has('bvh_panel_position')), false);
    await page.locator('[data-action=defaults]').click();
    assert.equal(await field('floatingButtonVisibility').inputValue(), 'show-all');
    assert.equal(await page.evaluate(() => gmData.get('bvh_settings').floatingButtonVisibility), 'hide-all');
    await page.locator('[data-action=save]').click(); await page.waitForFunction(() => !panel.saving && !panel.dirty);
    assert.equal(await entry.count(), 1);
    assert.equal((await entry.boundingBox()).x, 15);
    await page.locator('[data-close]').click();
    console.log('通过：独立预览、跨页签草稿、非法值、保存失败、关闭三分支与局部／全局恢复默认');

    // 各尺寸、主题和信息模式的真实渲染截图，供人工视觉检查。
    await page.evaluate(() => {
        document.querySelector('.bvh-toast-container')?.replaceChildren();
        testAPI.FloatingEntry.remove();
        const gallery = document.createElement('main'); gallery.id = 'review-gallery';
        gallery.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;padding:32px;align-items:start';
        for (const theme of ['light', 'dark']) for (const size of [80, 100, 160]) for (const mode of ['detailed', 'compact']) {
            const card = document.createElement('section'); card.style.cssText = 'min-width:0;padding:16px;border:1px solid #bccbd0;border-radius:14px;background:repeating-linear-gradient(135deg,#dce5e5 0 12px,#f1eee6 12px 24px)';
            const label = document.createElement('p'); label.textContent = `${theme === 'light' ? '浅色' : '深色'} · ${size}% · ${mode === 'detailed' ? '详细' : '简洁'}`; label.style.cssText = 'margin:0 0 16px;color:#354650;font-size:12px';
            card.append(label);
            const el = document.createElement('div'); el.className = 'bvh-floating-preview';
            testAPI.FloatingEntry.render(el, { status: '已观看', currentTime: '07:04', percent: '55%', savedAt: '2026-09-25 14:32' }, 'BV0000000001?p=3', { floatingTheme: theme, floatingSize: size, floatingMode: mode, floatingOpacity: size === 160 ? 60 : 100, floatingAccentColor: theme === 'dark' ? '#ee7799' : '#00aeec' });
            card.append(el); gallery.append(card);
        }
        document.body.append(gallery);
    });
    await page.locator('#review-gallery').screenshot({ path: path.join(artifactDir, 'appearance-matrix.png') });
    await page.evaluate(() => document.getElementById('review-gallery').remove());
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => {
            history.replaceState({}, '', '/video/BV0000000001?p=3'); currentKey = 'BV0000000001?p=3';
            testAPI.EpisodeResolver.getPageLabel = () => 'P3 · 很长的分集名称用于检查窄屏显示边界';
            Object.assign(testAPI.CONFIG, testAPI.DEFAULT_CONFIG);
            testAPI.UIComponent.refreshFloatingButtons();
        });
        for (const theme of ['light', 'dark']) for (const mode of ['compact', 'detailed']) for (const size of [80, 100, 160]) for (const opacity of [60, 100]) {
            await page.evaluate(({ theme, mode, size, opacity }) => {
                Object.assign(testAPI.CONFIG, { floatingTheme: theme, floatingMode: mode, floatingSize: size, floatingOpacity: opacity });
                testAPI.UIComponent.refreshFloatingButtons();
            }, { theme, mode, size, opacity });
            const bounds = await entry.boundingBox(); assert(bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= viewport.width - 8 && bounds.y + bounds.height <= viewport.height - 8);
            assert(await entry.evaluate(el => el.scrollWidth <= el.clientWidth + 1), '浮层横向溢出');
        }
        await entry.click(); await page.evaluate(() => { panel = testAPI.HistoryManagerPanel.active; });
        await page.locator('.bvh-settings-nav [data-settings-group=floating]').click();
        await page.locator('.bvh-floating-settings').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => [...panel.root.querySelectorAll('.bvh-section, .bvh-floating-settings, .bvh-floating-samples, .bvh-content')].filter(el => el.scrollWidth > el.clientWidth + 1).length), 0, '外观设置横向溢出');
        await page.screenshot({ path: path.join(artifactDir, `settings-${viewport.width}.png`) });
        await page.locator('.bvh-floating-samples').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifactDir, `preview-${viewport.width}.png`) });
        for (const group of ['common', 'marks', 'maintenance', 'floating']) {
            await page.locator(`.bvh-settings-nav [data-settings-group=${group}]`).click();
            assert.equal(await page.locator('.bvh-setting-groups > .bvh-section:visible').count(), 1);
            assert(await page.locator('.bvh-settings-nav').evaluate(el => el.scrollWidth <= el.clientWidth), '分类栏不得横向溢出');
            if (viewport.width === 1280) await page.screenshot({ path: path.join(artifactDir, `category-${group}.png`) });
        }
        await page.locator('[data-close]').click();
        await entry.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
        await page.screenshot({ path: path.join(artifactDir, `entry-${viewport.width}.png`) });
    }
    console.log('通过：1280／390 视口全部外观组合边界及设置窄屏布局；已生成视觉截图');
    assert.deepEqual(errors, []);
    console.log('浏览器夹具验证通过，截图目录：' + artifactDir);
} finally { await browser.close(); }
