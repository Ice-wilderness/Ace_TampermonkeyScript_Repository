import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { instrument, instance } from './harness.mjs';

const base = 'BV0000000001';
const payload = (bvid = base) => ({ code: 0, data: { bvid, aid: 123, title: '视频主标题',
    pages: [{ page: 1, part: '第一 P_哔哩哔哩_bilibili' }, { page: 2, part: '第二 P' }] } });
const unit = instance();
let options;
unit.context.GM_xmlhttpRequest = request => { options = request; request.onload({ status: 200, response: payload() }); };
assert.deepEqual([...((await unit.EpisodeResolver.fetchTitleInfo(base)).parts.values())], ['第一 P', '第二 P']);
assert.equal(options.url, `https://api.bilibili.com/x/web-interface/view?bvid=${base}`);
assert.equal(options.method, 'GET'); assert.equal(options.timeout, 15000);
assert.deepEqual([...((await unit.EpisodeResolver.fetchTitleInfo('av123')).parts.keys())], ['av123', 'av123?p=2']);
assert.equal(options.url, 'https://api.bilibili.com/x/web-interface/view?aid=123');
assert.equal((await unit.EpisodeResolver.fetchTitleInfo('av00123')).parts.size, 2);
for (const response of [
    { status: 412 }, { status: 429 }, { status: 500 },
    { status: 200, response: { code: -352 } }, { status: 200, response: { code: -404 } },
    { status: 200, response: payload('BV0000000002') },
    { status: 200, responseText: '{broken' },
    { status: 200, response: { code: 0, data: { bvid: base, pages: [{ page: 1, part: '' }] } } },
    { status: 200, response: { code: 0, data: { bvid: base, pages: [{ page: 1, part: 'A' }, { page: 1, part: 'B' }] } } }
]) {
    unit.context.GM_xmlhttpRequest = request => request.onload(response);
    await assert.rejects(unit.EpisodeResolver.fetchTitleInfo(base));
}
for (const event of ['onerror', 'ontimeout', 'onabort']) {
    unit.context.GM_xmlhttpRequest = request => request[event]();
    await assert.rejects(unit.EpisodeResolver.fetchTitleInfo(base));
}
await assert.rejects(unit.EpisodeResolver.fetchTitleInfo('not-a-video'));
unit.context.GM_xmlhttpRequest = request => request.onload({ status: 200, responseText: JSON.stringify(payload()) });
assert.equal((await unit.EpisodeResolver.fetchTitleInfo(base)).parts.size, 2);
console.log('通过：BV／AV 请求、后缀清理、响应格式、视频身份与分 P 完整性校验、限流／网络／超时错误');

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#f5f4f0"></body></html>' }));
    await page.goto(`https://www.bilibili.com/video/${base}`);
    await page.evaluate(() => {
        const values = new Map();
        window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
        window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
        window.GM_deleteValue = key => values.delete(key); window.GM_listValues = () => [...values.keys()];
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        window.GM_info = { script: { version: 'test' } }; window.unsafeWindow = window;
        window.requests = []; window.GM_xmlhttpRequest = request => requests.push(request);
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { StorageManager: s, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[name] = () => {};
        await s.initialize();
        const rows = {};
        for (let p = 1; p <= 20; p++) rows[`BV0000000001${p > 1 ? `?p=${p}` : ''}`] = {
            title: `旧分 P ${p}`, status: '已观看', percent: '50%', currentTime: '05:00', savedAt: '2026-11-08 10:00:00'
        };
        rows['BV0000000002?p=2'] = { title: '另一个视频的第二 P', status: '已观看', percent: '20%', currentTime: '01:00', savedAt: '2026-11-08 10:00:00' };
        await s.importRecords(rows);
        window.__INITIAL_STATE__ = { bvid: 'BV0000000001', videoData: { title: '视频主标题', pages: Array.from({ length: 20 }, (_, index) => ({ page: index + 1, part: `旧分 P ${index + 1}` })) } };
        testAPI.CONFIG.showMultiPageHistory = true; testAPI.injectStyles();
        const menu = document.createElement('aside'); menu.id = 'favorites'; menu.className = 'favorite-panel-popover';
        menu.style.cssText = 'position:fixed;left:960px;top:80px;width:280px;height:360px;background:white;overflow:hidden;transform:translateZ(0)';
        menu.innerHTML = [1, 2].map(n => `<a class="header-fav-card" style="display:block" href="/video/BV000000000${n}"><div class="header-fav-card__image" style="position:relative"><img alt="视频封面" style="display:block;width:280px;height:160px;background:#dde8ec"></div></a>`).join('');
        menu.addEventListener('pointerleave', () => { menu.dataset.closed = 'true'; menu.style.display = 'none'; });
        window.menuClicks = 0; menu.addEventListener('click', () => menuClicks++);
        document.body.append(menu); window.watcher = new testAPI.DOMWatcher();
        menu.querySelectorAll('a').forEach(link => watcher.processLink(link));
        window.newPayload = () => ({ code: 0, data: { bvid: 'BV0000000001', title: '视频主标题',
            pages: Array.from({ length: 21 }, (_, index) => ({ page: index + 1, part: `新分 P ${index + 1}` })) } });
    });
    const popup = page.locator('#bvh-multi-history'), button = popup.locator('[data-refresh-titles]');
    await page.locator('#favorites img').first().hover(); await popup.waitFor();
    assert.equal(await page.evaluate(() => requests.length), 0, '仅悬停不应请求标题接口');
    await popup.locator('.bvh-multi-rows').evaluate(el => { el.scrollTop = 450; });
    await page.evaluate(() => {
        const list = document.querySelector('#bvh-multi-history .bvh-multi-rows');
        const row = [...list.children].find(row => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
        window.reading = { list, row, offset: row.getBoundingClientRect().top - list.getBoundingClientRect().top };
    });
    await button.click();
    assert.equal(await button.isDisabled(), true); assert.equal(await button.textContent(), '刷新中…');
    await button.dispatchEvent('click'); assert.equal(await page.evaluate(() => requests.length), 1);
    assert.equal(await page.evaluate(() => menuClicks), 0, '刷新按钮不应触发菜单或视频卡片的点击操作');
    await page.waitForTimeout(200);
    assert.equal(await popup.count(), 1, '按钮禁用导致的失焦不能关闭正在等待请求的详情');
    assert.equal(await page.locator('#favorites').getAttribute('data-closed'), null);
    await page.evaluate(async () => {
        const s = testAPI.StorageManager, key = 'BV0000000001?p=10';
        await s.saveRecord(key, { ...s.getRecord(key), percent: '77%', currentTime: '09:51', savedAt: '2026-11-08 11:00:00' });
        await s.deleteRecords(['BV0000000001?p=20']);
        requests[0].onload({ status: 200, response: newPayload() });
    });
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-note')?.textContent === '已更新 19 条分 P 标题');
    assert.equal(await button.isDisabled(), false);
    const result = await page.evaluate(() => {
        const s = testAPI.StorageManager, record = s.getRecord('BV0000000001?p=10');
        const player = new testAPI.VideoPlayerObserver(); player.bvId = 'BV0000000001';
        const liveTitle = player.getConfirmedTitle(); player.destroy();
        return { title: record.title, percent: record.percent, time: record.currentTime, savedAt: record.savedAt,
            deleted: s.getRecord('BV0000000001?p=20'), unwatched: s.getRecord('BV0000000001?p=21'), liveTitle,
            sameList: reading.list === document.querySelector('#bvh-multi-history .bvh-multi-rows'),
            drift: reading.row.getBoundingClientRect().top - reading.list.getBoundingClientRect().top - reading.offset,
            closed: document.querySelector('#favorites').dataset.closed || '' };
    });
    assert.deepEqual({ ...result, drift: 0 }, { title: '新分 P 10', percent: '77%', time: '09:51', savedAt: '2026-11-08 11:00:00',
        deleted: null, unwatched: null, liveTitle: '新分 P 1', sameList: true, drift: 0, closed: '' });
    assert(Math.abs(result.drift) <= 1, `刷新后阅读位置变化：${result.drift}`);
    const artifactDir = path.join(os.tmpdir(), 'bvh-title-refresh-review'); await fs.mkdir(artifactDir, { recursive: true });
    await popup.screenshot({ path: path.join(artifactDir, 'title-refresh-success.png') });
    console.log('通过：按钮按需请求、重复点击去重、并发播放进度保留、删除记录不复活、不新增未看分 P、旧页元数据不覆盖新标题及收藏夹滚动保持');

    await button.click();
    await page.evaluate(() => requests[1].onload({ status: 412 }));
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-note')?.textContent.includes('请求受限'));
    assert.equal(await button.isDisabled(), false);
    assert.equal(await page.evaluate(() => testAPI.StorageManager.getRecord('BV0000000001').title), '新分 P 1');
    await button.click();
    await page.evaluate(() => requests[2].onload({ status: 200, response: newPayload() }));
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-note')?.textContent === '标题已是最新');
    console.log('通过：限流提示保留原记录，失败后允许重试，标题未变时明确提示已是最新');

    await button.click();
    await page.locator('#favorites img').last().hover(); await popup.waitFor();
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-title')?.textContent === '另一个视频的第二 P');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => requests[3].onload({ status: 200, response: newPayload() }));
    await page.waitForFunction(() => !document.querySelector('#bvh-multi-history [data-refresh-titles]')?.disabled);
    assert.equal(await popup.locator('.bvh-multi-title').textContent(), '另一个视频的第二 P');
    assert.equal(await popup.locator('.bvh-multi-note').textContent(), '仅显示本地已记录的分 P');
    console.log('通过：请求期间切换卡片，结果仅更新原视频，当前卡片保持独立；截图目录：' + artifactDir);
    assert.deepEqual(errors, []);
} finally { await browser.close(); }
