import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { instrument, instance, sharedStorage } from './harness.mjs';

const settingsStorage = sharedStorage();
assert.equal(instance(settingsStorage).CONFIG.showMultiPageHistory, false);
for (const [value, expected] of [[true, true], [false, false], ['true', false], [null, false]]) {
    settingsStorage.data.set('bvh_settings', { showMultiPageHistory: value });
    assert.equal(instance(settingsStorage).CONFIG.showMultiPageHistory, expected);
}
await instance(settingsStorage).SettingsManager.save({ showMultiPageHistory: true });
assert.equal(instance(settingsStorage).CONFIG.showMultiPageHistory, true);

// 合成页面与本地记录；不访问 B 站，也不使用真实观看数据。
const browser = await chromium.launch({ headless: true });
const artifactDir = path.join(os.tmpdir(), 'bvh-edge-multi-review');
await fs.mkdir(artifactDir, { recursive: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#f5f4f0;color:#243040;font:14px "Microsoft YaHei",sans-serif}
        main{display:flex;flex-wrap:wrap;gap:24px;padding:50px 20px}.bili-video-card{width:280px}
        a{color:inherit;text-decoration:none}a>div{position:relative}img{display:block;width:280px;height:156px;background:#d8e3e7;border-radius:12px}
        .card-title{display:block;padding:12px 0}
        </style></head><body><button id="focus-start">页面按钮</button><main>${[1, 2, 3].map(n => `<article class="bili-video-card" id="card-${n}"><a href="/video/BV000000000${n}"><div><img alt="合成视频封面"></div></a><a class="card-title" href="/video/BV000000000${n}">合成视频 ${n}</a></article>`).join('')}</main></body></html>` }));
    await page.goto('https://www.bilibili.com/');
    await page.evaluate(() => {
        window.gmData = new Map(); window.gmWrites = [];
        window.GM_getValue = (key, fallback) => gmData.has(key) ? structuredClone(gmData.get(key)) : fallback;
        window.GM_setValue = (key, value) => { gmWrites.push(key); gmData.set(key, structuredClone(value)); };
        window.GM_deleteValue = key => gmData.delete(key); window.GM_listValues = () => [...gmData.keys()];
        window.GM_addStyle = css => { const el = document.createElement('style'); el.textContent = css; document.head.append(el); };
        window.GM_info = { script: { version: 'test' } }; window.unsafeWindow = window;
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { StorageManager: s, Utils, UIComponent } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        await s.initialize();
        testAPI.injectStyles();
        window.openCalls = 0; UIComponent.showManagerPanel = () => openCalls++;
        UIComponent.refreshFloatingButtons();
    });
    const entry = page.locator('body > .bvh-floating-entry');
    const entryBox = async () => {
        await entry.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
        return entry.boundingBox();
    };
    assert.equal(await entry.getAttribute('data-collapsed'), 'false');
    assert.equal((await entry.boundingBox()).x, 15);
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeHide = true; testAPI.FloatingEntry.place(); });
    let rect = await entryBox(); assert.equal(rect.x + rect.width, 12);
    for (const width of [8, 24, 64]) {
        await page.evaluate(width => { testAPI.CONFIG.floatingEdgeWidth = width; testAPI.FloatingEntry.place(); }, width);
        rect = await entryBox(); assert.equal(rect.x + rect.width, Math.min(width, rect.width));
    }
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeWidth = 12; testAPI.FloatingEntry.place(); });
    rect = await entryBox();
    await page.screenshot({ path: path.join(artifactDir, 'edge-left.png') });
    await page.mouse.move(5, rect.y + rect.height / 2);
    assert.equal(await entry.getAttribute('data-collapsed'), 'false');
    assert(await entry.evaluate(el => el.getAnimations().some(animation => animation.playState === 'running')), '展开应存在实际运行的滑动动画');
    assert.equal((await entryBox()).x, 0);
    await page.mouse.move(600, 600);
    assert.equal(await entry.getAttribute('data-collapsed'), 'true');
    await page.locator('#focus-start').focus();
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab');
    assert(await entry.evaluate(el => el === document.activeElement));
    assert.equal(await entry.getAttribute('data-collapsed'), 'false');
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => openCalls), 1);
    await page.locator('#focus-start').focus();
    rect = await entryBox();
    await page.mouse.move(5, rect.y + rect.height / 2);
    rect = await entryBox();
    await page.mouse.move(rect.x + 20, rect.y + 18); await page.mouse.down();
    await page.mouse.move(1277, 350, { steps: 6 }); await page.mouse.up();
    await page.mouse.move(600, 600);
    assert.equal(await entry.getAttribute('data-dock'), 'right');
    assert.equal(await entry.getAttribute('data-collapsed'), 'true', '鼠标拖拽后的焦点不应阻止收起');
    assert.equal((await entryBox()).x, 1268);
    assert.equal(await page.evaluate(() => gmData.get('bvh_panel_position').dock), 'right');
    assert.equal(await page.evaluate(() => openCalls), 1, '拖拽不应打开管理面板');
    await page.screenshot({ path: path.join(artifactDir, 'edge-right.png') });
    await page.evaluate(() => {
        const overlay = document.createElement('div'); overlay.id = 'scrollbar-overlay';
        overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:20px;z-index:20000;background:#c9cdd1';
        document.body.append(overlay);
    });
    rect = await entryBox();
    assert.equal(await page.evaluate(y => document.elementFromPoint(1275, y)?.id, rect.y + rect.height / 2), 'scrollbar-overlay', '覆盖式滚动条应能复现原来的遮挡');
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeWidth = 32; testAPI.FloatingEntry.place(); });
    rect = await entryBox(); assert.equal(rect.x, 1248);
    const hoverY = rect.y + rect.height / 2;
    assert.equal(await page.evaluate(y => document.elementFromPoint(1254, y)?.closest('.bvh-floating-entry')?.id, hoverY), 'bvh-quick-entry');
    await page.mouse.move(1254, hoverY);
    assert.equal(await entry.getAttribute('data-collapsed'), 'false', '调宽后应能从滚动条左侧正常唤出入口');
    await entryBox(); await page.mouse.move(600, 600); await entryBox();
    await page.evaluate(() => { document.querySelector('#scrollbar-overlay').remove(); testAPI.CONFIG.floatingEdgeWidth = 12; testAPI.FloatingEntry.place(); });
    await entryBox();
    await page.mouse.move(1275, 350);
    assert.equal(await entry.getAttribute('data-collapsed'), 'false');
    rect = await entryBox(); assert.equal(rect.x + rect.width, 1280);
    // 离开边缘后保持展开；拖回右侧、销毁重建和窗口缩放后仍正确贴边。
    await page.mouse.move(rect.x + 20, rect.y + 18); await page.mouse.down();
    await page.mouse.move(600, 350, { steps: 5 }); await page.mouse.up(); await page.mouse.move(800, 600);
    assert.equal(await entry.getAttribute('data-dock'), '');
    assert.equal(await entry.getAttribute('data-collapsed'), 'false');
    rect = await entryBox();
    await page.mouse.move(rect.x + 20, rect.y + 18); await page.mouse.down();
    await page.mouse.move(1277, 350, { steps: 5 }); await page.mouse.up(); await page.mouse.move(600, 600);
    await page.evaluate(() => { testAPI.FloatingEntry.remove(); testAPI.UIComponent.refreshFloatingButtons(); });
    assert.equal((await entryBox()).x, 1268);
    await page.evaluate(() => testAPI.FloatingEntry.show({ status: '已观看', currentTime: '10:00', percent: '70%', savedAt: '2026-11-08 12:30:00' }, 'BV0000000001?p=2'));
    assert.equal((await entryBox()).x, 1268, '入口内容变宽后仍应保持右侧贴边');
    await page.evaluate(() => testAPI.UIComponent.refreshFloatingButtons());
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForFunction(() => testAPI.FloatingEntry.current.el.getBoundingClientRect().left === 378);
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeHide = false; testAPI.FloatingEntry.place(); });
    rect = await entryBox(); assert(rect.x >= 8 && rect.x + rect.width <= 382);
    await page.evaluate(() => testAPI.FloatingEntry.resetPosition());
    assert.equal((await entry.boundingBox()).x, 15);
    assert.equal(await page.evaluate(() => gmData.has('bvh_panel_position')), false);
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeHide = true; testAPI.FloatingEntry.place(); });
    rect = await entryBox();
    await page.mouse.move(5, rect.y + rect.height / 2); await page.mouse.down();
    assert.equal(await entry.evaluate(el => getComputedStyle(el).transitionDuration), '0s', '动画中按下拖拽应立即停用滑动过渡');
    assert.equal((await entry.boundingBox()).x, 0);
    await page.mouse.move(220, 350, { steps: 3 }); await page.mouse.up(); await page.mouse.move(350, 600);
    assert.equal(await entry.getAttribute('data-dock'), '');
    assert.equal(await page.evaluate(() => openCalls), 1);
    await page.evaluate(() => testAPI.FloatingEntry.resetPosition());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeHide = true; testAPI.FloatingEntry.place(); });
    assert.equal(await entry.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.equal(await entry.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
    await page.evaluate(() => { testAPI.CONFIG.floatingEdgeHide = false; testAPI.FloatingEntry.place(); });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('通过：默认关闭、左右收起与悬停展开、键盘展开、拖拽脱离、右侧持久化与缩放、关闭及恢复位置');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async () => {
        const rows = {};
        for (const p of [10, 3, 1, 2]) rows[`BV0000000001${p > 1 ? `?p=${p}` : ''}`] = {
            status: p === 3 ? '已访问' : '已观看', currentTime: p === 3 ? '' : '07:04', percent: p === 3 ? '' : `${p * 8}%`,
            savedAt: '2026-11-08 12:30:00', title: p === 2 ? '<img src=x onerror="window.injected=true">分 P 标题' : `合成标题 · 第 ${p} P${p === 10 ? '_哔哩哔哩_bilibili' : ''}`
        };
        rows['BV0000000002?p=2'] = { status: '已观看', currentTime: '01:20', percent: '20%', savedAt: '2026-11-08 12:31:00' };
        rows.BV0000000003 = { status: '已观看', currentTime: '00:12', percent: '10%', savedAt: '2026-11-08 12:32:00' };
        await testAPI.StorageManager.importRecords(rows);
        window.watcher = new testAPI.DOMWatcher();
        watcher.scanExistingLinks();
    });
    await page.waitForFunction(() => document.querySelector('#card-1 [data-bvh-multi-base]') && document.querySelector('#card-2 [data-bvh-multi-base]'));
    assert((await page.locator('#card-2 .bvh-tag').first().textContent()).includes('多P'), '仅记录 P2 时普通卡片也应有标记');
    const popup = page.locator('#bvh-multi-history');
    await page.locator('#card-1 img').hover(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '默认关闭时悬停不应显示详情');
    await page.locator('#card-1 .card-title').focus(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '默认关闭时键盘聚焦也不应显示详情');
    await page.locator('#focus-start').focus(); await page.mouse.move(1000, 600);
    await page.evaluate(async () => { await testAPI.SettingsManager.save({ showMultiPageHistory: true }); });
    await page.evaluate(() => {
        // 模拟宿主菜单按容器 ID 重置后代样式，覆盖加载顺序与较高选择器权重。
        const hostStyle = document.createElement('style');
        hostStyle.textContent = '#favorites *{margin:0;padding:0;border:0;font:18px/1 serif;color:crimson;text-align:center}#favorite-content-scroll section{padding:0}#favorite-content-scroll div{display:block;gap:0;white-space:nowrap}';
        document.head.append(hostStyle);
        const favorites = document.createElement('aside'); favorites.id = 'favorites'; favorites.className = 'favorite-panel-popover';
        favorites.style.cssText = 'position:fixed;left:960px;top:60px;width:280px;height:340px;background:white;z-index:100;overflow:hidden;transform:translateZ(0)';
        const scroll = document.createElement('div'); scroll.id = 'favorite-content-scroll'; scroll.style.cssText = 'height:340px;overflow:auto'; favorites.append(scroll);
        for (let i = 0; i < 2; i++) {
            const link = document.querySelector(`#card-${i + 1} a`).cloneNode(true); link.className = 'header-fav-card';
            scroll.append(link);
        }
        favorites.addEventListener('pointerleave', () => { favorites.dataset.closed = 'true'; favorites.style.display = 'none'; });
        document.body.append(favorites);
    });
    const favorites = page.locator('#favorites');
    await page.waitForFunction(() => [...document.querySelectorAll('#favorites a')].every(el => el._bvhTag?.isConnected && el.dataset.bvhMultiBase));
    await favorites.locator('img').first().hover(); await popup.waitFor();
    assert.equal(await popup.evaluate(el => el.matches(':popover-open')), true);
    const spacing = await popup.evaluate(el => {
        const heading = getComputedStyle(el.querySelector('.bvh-multi-heading')), row = getComputedStyle(el.querySelector('.bvh-multi-row'));
        return { padding: heading.paddingTop, display: heading.display, rowPadding: row.paddingTop, rowDisplay: row.display, font: getComputedStyle(el).fontSize };
    });
    assert.deepEqual(spacing, { padding: '14px', display: 'flex', rowPadding: '12px', rowDisplay: 'flex', font: '13px' }, '宿主菜单的样式重置不应压缩卡片排版');
    assert.equal(await popup.locator('time').first().evaluate(el => getComputedStyle(el).textAlign), 'left', '时间不应继承宿主菜单的居中样式');
    assert.equal(await popup.evaluate(el => document.querySelector('#favorite-content-scroll').contains(el)), true, '详情应保留在收藏夹滚动容器的 DOM 内');
    let menuBox = await favorites.boundingBox(), detailBox = await popup.boundingBox();
    assert(detailBox.x + detailBox.width <= menuBox.x - 8, '详情应放到左侧，避开向下浏览的路径');
    assert(await popup.evaluate(el => el.contains(document.elementFromPoint(el.getBoundingClientRect().left + 30, el.getBoundingClientRect().top + 60))), '侧边详情不应被 overflow 或 transform 裁切');
    await page.mouse.move(detailBox.x + detailBox.width + 4, menuBox.y + 78, { steps: 8 });
    assert.equal(await favorites.getAttribute('data-closed'), null, '跨越菜单与详情间隙不应关闭收藏夹');
    await popup.hover(); await page.waitForTimeout(200);
    assert.equal(await favorites.evaluate(el => el.matches(':hover')), true);
    assert.equal(await favorites.getAttribute('data-closed'), null, '鼠标移入详情不应触发收藏夹的移出关闭');
    await page.screenshot({ path: path.join(artifactDir, 'favorites-side-detail.png') });
    await favorites.locator('img').first().hover(); await favorites.locator('img').last().hover(); await popup.waitFor();
    assert.equal(await page.locator('#favorites').getAttribute('data-closed'), null, '向下浏览收藏夹应保持鼠标处于收藏夹内');
    assert.deepEqual(await popup.locator('.bvh-multi-page').allTextContents(), ['P2']);
    await page.keyboard.press('Escape');
    await page.mouse.move(1000, 600);
    await page.evaluate(() => { const menu = document.querySelector('#favorites'); menu.style.left = '20px'; menu.style.display = 'block'; delete menu.dataset.closed; });
    await favorites.locator('img').first().hover(); await popup.waitFor();
    menuBox = await favorites.boundingBox(); detailBox = await popup.boundingBox();
    assert(detailBox.x >= menuBox.x + menuBox.width + 8, '左侧菜单应向右展开详情');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('#favorites').style.left = '60px'; });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.mouse.move(380, 600);
    await page.evaluate(() => { const menu = document.querySelector('#favorites'); menu.style.display = 'block'; delete menu.dataset.closed; });
    await favorites.locator('img').first().hover(); await popup.waitFor();
    assert.equal(await popup.getAttribute('data-inline'), 'true', '窄屏无侧边空间时应在列表内展开');
    await popup.scrollIntoViewIfNeeded(); await popup.hover();
    assert.equal(await favorites.getAttribute('data-closed'), null);
    assert.equal(await popup.count(), 1, '滚动查看内嵌详情不应关闭详情');
    assert((await popup.boundingBox()).height <= 324, '内嵌详情自身应适应菜单高度');
    assert(await popup.locator('.bvh-multi-rows').evaluate(el => el.scrollHeight > el.clientHeight));
    await page.screenshot({ path: path.join(artifactDir, 'favorites-inline-detail.png') });
    await page.keyboard.press('Escape'); await page.mouse.move(380, 600);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
        const menu = document.querySelector('#favorites'); menu.style.left = '960px'; menu.style.display = 'block'; delete menu.dataset.closed;
        document.querySelector('#favorite-content-scroll').scrollTop = 0;
        window.savedShowPopover = HTMLElement.prototype.showPopover; HTMLElement.prototype.showPopover = undefined;
    });
    await favorites.locator('img').first().hover(); await popup.waitFor();
    assert.equal(await popup.getAttribute('data-inline'), 'true', '旧浏览器应降级为菜单内展开，保留悬浮菜单详情');
    await page.evaluate(() => { HTMLElement.prototype.showPopover = savedShowPopover; });
    await page.evaluate(() => document.querySelector('#favorites').remove());
    await popup.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.mouse.move(1000, 600);
    console.log('通过：收藏夹内侧边详情、原生鼠标移出关闭、跨间隙悬停、向下浏览、overflow／transform、左右布局与窄屏内嵌滚动');
    await page.locator('#card-1 img').hover(); await popup.waitFor();
    assert.equal(await popup.evaluate(el => getComputedStyle(el).animationName), 'bvh-multi-enter');
    assert.deepEqual(await popup.locator('.bvh-multi-page').allTextContents(), ['P1', 'P2', 'P3', 'P10']);
    assert((await popup.textContent()).includes('07:04'));
    assert.equal(await popup.locator('time').first().textContent(), '2026-11-08 12:30:00');
    assert.equal(await popup.locator('.bvh-multi-row').nth(2).locator('.bvh-multi-track').count(), 0, '访问记录不应伪造进度');
    assert.equal(await popup.locator('img').count(), 0); assert.equal(await page.evaluate(() => !!window.injected), false);
    assert.equal(await popup.locator('.bvh-multi-row').last().locator('.bvh-multi-title').textContent(), '合成标题 · 第 10 P');
    assert.equal(await page.locator('#card-1 .bvh-tag').first().getAttribute('title'), '');
    await popup.hover(); assert.equal(await popup.count(), 1);
    await page.screenshot({ path: path.join(artifactDir, 'multi-history-light.png') });
    await page.evaluate(async () => {
        const s = testAPI.StorageManager, key = 'BV0000000001?p=2';
        await s.saveRecord(key, { ...s.getRecord(key), percent: '66%', currentTime: '09:30' });
    });
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history')?.textContent.includes('66%'));
    await page.evaluate(async () => { await testAPI.SettingsManager.save({ showMultiPageHistory: false }); });
    await popup.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.bvh-multi-history').count(), 0, '关闭开关应清理现有详情及退场浮层');
    assert.equal(await page.locator('[aria-describedby~=bvh-multi-history]').count(), 0);
    await page.locator('#card-2 img').hover(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '关闭后不应再次弹出详情');
    await page.evaluate(async () => { await testAPI.SettingsManager.save({ showMultiPageHistory: true }); });
    await page.locator('#card-1 img').hover(); await popup.waitFor();
    await page.keyboard.press('Escape'); assert.equal(await popup.count(), 0);
    const leaving = page.locator('.bvh-multi-leaving');
    assert.equal(await leaving.count(), 1);
    assert.equal(await leaving.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await leaving.waitFor({ state: 'detached' });
    await page.locator('#card-2 .card-title').hover(); await popup.waitFor();
    assert.deepEqual(await popup.locator('.bvh-multi-page').allTextContents(), ['P2']);
    await page.mouse.move(900, 600); await popup.waitFor({ state: 'detached' });
    await page.locator('#card-1 .card-title').focus(); await popup.waitFor();
    assert.equal(await popup.locator('.bvh-multi-row').count(), 4);
    assert.equal(await page.locator('#card-1 .card-title').getAttribute('aria-describedby'), 'bvh-multi-history');
    await page.locator('#focus-start').focus(); await popup.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#card-1 .card-title').getAttribute('aria-describedby'), null);
    await page.locator('#card-3 img').hover();
    await page.waitForTimeout(250); assert.equal(await popup.count(), 0);
    await page.evaluate(async () => {
        await testAPI.StorageManager.saveRecord('BV0000000001', { status: '已访问', savedAt: '2026-11-08 12:35:00' });
        await testAPI.SettingsManager.save({ showVisitedTag: false });
    });
    await page.locator('#card-1 img').hover(); await popup.waitFor();
    assert.equal(await popup.locator('.bvh-multi-row').count(), 4, 'P1 仅访问且关闭访问标签时，仍应展示已观看的其他分 P');
    await page.evaluate(() => watcher.refreshForRoute()); await popup.waitFor({ state: 'detached' });
    await page.mouse.move(1000, 600);
    console.log('通过：封面与标题悬停、P 序号排序、时间进度、访问记录、仅有 P2、单 P、键盘与原生说明清理、转义及实时更新');

    await page.evaluate(async () => {
        const rows = {};
        for (let p = 11; p <= 45; p++) rows[`BV0000000001?p=${p}`] = {
            status: '已观看', currentTime: '02:00', percent: '50%', savedAt: '2026-11-08 13:00:00', title: '长标题检查'.repeat(15)
        };
        await testAPI.StorageManager.importRecords(rows); testAPI.CONFIG.floatingTheme = 'dark';
    });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.locator('#card-1 img').hover(); await popup.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#bvh-multi-history .bvh-multi-row').length === 39);
    rect = await popup.boundingBox(); assert(rect.x >= 8 && rect.y >= 8 && rect.x + rect.width <= 382 && rect.y + rect.height <= 692);
    assert(await popup.locator('.bvh-multi-rows').evaluate(el => el.scrollHeight > el.clientHeight));
    await popup.locator('.bvh-multi-rows').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await popup.count(), 1, '浮层内部滚动不应关闭');
    assert(await popup.evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.evaluate(() => {
        const list = document.querySelector('#bvh-multi-history .bvh-multi-rows');
        const row = [...list.children].find(row => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
        window.reading = { list, row, key: row.dataset.key, offset: row.getBoundingClientRect().top - list.getBoundingClientRect().top,
            title: row.querySelector('.bvh-multi-title'), focus: document.activeElement };
        const selection = window.getSelection(); selection.removeAllRanges();
        const range = document.createRange(); range.selectNodeContents(reading.title); selection.addRange(range);
        reading.selected = selection.toString();
    });
    for (const percent of [61, 62, 63]) {
        await page.evaluate(async percent => {
            const s = testAPI.StorageManager, key = 'BV0000000001?p=2';
            await s.saveRecord(key, { ...s.getRecord(key), percent: `${percent}%`, currentTime: '09:40' });
        }, percent);
        await page.waitForFunction(percent => [...document.querySelectorAll('#bvh-multi-history .bvh-multi-row')]
            .find(row => row.dataset.key === 'BV0000000001?p=2')?.textContent.includes(`${percent}%`), percent);
        const readingState = await page.evaluate(() => ({ sameList: reading.list === document.querySelector('#bvh-multi-history .bvh-multi-rows'),
            sameTitle: reading.title === reading.row.querySelector('.bvh-multi-title'), sameFocus: reading.focus === document.activeElement,
            selected: window.getSelection().toString() === reading.selected,
            drift: reading.row.getBoundingClientRect().top - reading.list.getBoundingClientRect().top - reading.offset }));
        assert.deepEqual(readingState, { sameList: true, sameTitle: true, sameFocus: true, selected: true, drift: 0 }, '后台连续保存不应重建滚动容器、抢焦点或打断正在阅读的分 P');
    }
    await page.evaluate(async () => {
        const s = testAPI.StorageManager, key = 'BV0000000001';
        await s.saveRecord(key, { ...s.getRecord(key), title: '更长的前置标题用于验证换行后继续保留当前阅读位置'.repeat(6) });
    });
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-title')?.textContent.includes('更长的前置标题'));
    assert(Math.abs(await page.evaluate(() => reading.row.getBoundingClientRect().top - reading.list.getBoundingClientRect().top - reading.offset)) <= 1,
        '前置标题增高后阅读位置应保持在一个 CSS 像素内，允许浏览器 scrollTop 的整数取整');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    console.log('通过：后台连续保存原位更新，滚动行及偏移、焦点与文本选择保持不变，前置标题增高不跳动');
    await page.screenshot({ path: path.join(artifactDir, 'multi-history-dark-mobile.png') });
    await page.evaluate(() => { document.querySelector('#card-1').remove(); });
    await popup.waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#card-2 img').hover(); await popup.waitFor();
    assert.equal(await popup.evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.evaluate(async () => { await testAPI.StorageManager.deleteRecords(['BV0000000002?p=2']); });
    await popup.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.bvh-multi-leaving').count(), 0, '减少动态效果模式应立即清理浮层');
    console.log('通过：窄屏深色、多 P 滚动、无横向溢出、卡片移除与记录删除时清理；截图目录：' + artifactDir);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async () => {
        const title = '纯黑《生灵重塑 REANIMAL》小小梦魇式全流程解说';
        await testAPI.StorageManager.importRecords({
            BV0000000004: { status: '已观看', currentTime: '33:21', percent: '100%', savedAt: '2026-09-19 13:12:14', title },
            'BV0000000004?p=2': { status: '已观看', currentTime: '34:03', percent: '100%', savedAt: '2026-09-19 13:42:12', title }
        });
        testAPI.CONFIG.floatingTheme = 'light';
        const menu = document.createElement('aside'); menu.id = 'favorites'; menu.className = 'favorite-panel-popover';
        menu.style.cssText = 'position:fixed;left:960px;top:80px;width:280px;height:340px;background:white;overflow:hidden;transform:translateZ(0)';
        menu.innerHTML = '<div id="favorite-content-scroll"><a class="header-fav-card" href="/video/BV0000000004"><div class="header-fav-card__image"><img alt="合成视频封面"></div></a></div>';
        document.body.append(menu); watcher.processLink(menu.querySelector('a'));
    });
    await page.locator('#favorites img').hover(); await popup.waitFor();
    assert.equal(await popup.locator('.bvh-multi-video-title').count(), 1, '相同的视频标题应只在顶部显示一次');
    assert.equal(await popup.locator('.bvh-multi-title').count(), 0);
    assert.equal(await popup.locator('[data-complete=true]').count(), 2);
    assert.deepEqual(await popup.locator('.bvh-multi-status strong').allTextContents(), ['100%', '100%']);
    await popup.screenshot({ path: path.join(artifactDir, 'favorites-refined-light.png') });
    await page.evaluate(async () => { await testAPI.SettingsManager.save({ floatingTheme: 'dark', showMultiPageHistory: true }); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#bvh-multi-history')).backgroundColor === 'rgb(32, 38, 49)');
    await popup.screenshot({ path: path.join(artifactDir, 'favorites-refined-dark.png') });
    await page.evaluate(async () => {
        window.__INITIAL_STATE__ = { bvid: 'BV0000000004', videoData: { title: testAPI.StorageManager.getRecord('BV0000000004').title,
            pages: [{ page: 1, part: '01（一之刻）' }, { page: 2, part: '02（二之刻）' }] } };
        await testAPI.SettingsManager.save({ showMultiPageHistory: true });
    });
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-title')?.textContent === '01（一之刻）');
    assert.deepEqual(await popup.locator('.bvh-multi-title').allTextContents(), ['01（一之刻）', '02（二之刻）']);
    await popup.screenshot({ path: path.join(artifactDir, 'favorites-part-titles.png') });
    console.log('通过：宿主高权重样式隔离、共用标题去重、完成状态及浅色／深色外观截图');
    assert.deepEqual(errors, []);
} finally { await browser.close(); }
