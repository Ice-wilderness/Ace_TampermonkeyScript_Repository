import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

// 模拟官方历史网格及原生删除按钮，不操作真实观看记录。
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
        body{margin:0;background:#f5f4f0;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(3,280px);gap:20px;padding:40px}
        .history-card{width:280px}.bili-cover-card{display:block;position:relative}.bili-cover-card img{display:block;width:280px;height:180px;background:#dce6eb}
        .info{display:flex;align-items:flex-start;gap:8px;padding-top:10px;min-height:45px}.title{flex:1}.native-delete{width:34px;height:30px}a{color:inherit}
        </style></head><body><main>${[1, 2, 3, 4, 5, 6].map(n => `<article class="history-card" id="card-${n}"><a class="bili-cover-card" href="/video/BV000000000${n}"><img alt="视频封面"><span style="position:absolute;bottom:0;right:0">视频时长</span></a><div class="info"><a class="title" href="/video/BV000000000${n}">视频标题 ${n}</a><button class="native-delete" type="button" aria-label="删除历史">删除</button></div><small>观看时间</small></article>`).join('')}</main></body></html>` }));
    await page.goto('https://www.bilibili.com/account/history');
    await page.evaluate(() => {
        const values = new Map();
        window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
        window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
        window.GM_deleteValue = key => values.delete(key); window.GM_listValues = () => [...values.keys()];
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        window.GM_info = { script: { version: 'test' } }; window.unsafeWindow = window;
        window.titleCalls = 0; window.GM_xmlhttpRequest = request => {
            titleCalls++; request.onload({ status: 200, response: { code: 0, data: { bvid: 'BV0000000002', title: '历史视频标题',
                pages: Array.from({ length: 18 }, (_, index) => ({ page: index + 1, part: `最新标题 ${index + 1}` })) } } });
        };
        window.deleteClicks = 0; document.querySelectorAll('.native-delete').forEach(button => button.addEventListener('click', () => deleteClicks++));
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { StorageManager: s, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[name] = () => {};
        await s.initialize();
        const records = {};
        for (let video = 1; video <= 6; video++) for (let p = 1; p <= 18; p++) records[`BV000000000${video}${p > 1 ? `?p=${p}` : ''}`] = {
            title: `第 ${p} P 独立标题`, status: '已观看', percent: '50%', currentTime: '05:00', savedAt: '2026-11-08 10:00:00'
        };
        await s.importRecords(records); testAPI.CONFIG.showMultiPageHistory = true; testAPI.injectStyles();
        window.watcher = new testAPI.DOMWatcher(); watcher.scanExistingLinks();
    });
    const card = page.locator('#card-2'), popup = page.locator('#bvh-multi-history');
    await page.waitForFunction(() => document.querySelector('#card-2 [data-bvh-multi-base]'));
    await card.locator('.title').hover(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '标题区域不能触发详情');
    await card.locator('.native-delete').hover(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '原生删除按钮不能触发详情');
    await card.locator('.title').focus(); await page.waitForTimeout(250);
    assert.equal(await popup.count(), 0, '聚焦标题也不能触发详情');
    await card.locator('.bili-cover-card').focus(); await popup.waitFor();
    assert.equal(await popup.getAttribute('data-history-compact'), 'true', '密集网格应限制详情高度，避开邻近卡片操作区');
    const coverBox = await card.locator('img').boundingBox(), detailBox = await popup.boundingBox();
    assert(detailBox.y >= coverBox.y && detailBox.y + detailBox.height <= coverBox.y + coverBox.height + 1);
    assert.equal(await card.locator('img').evaluate(el => {
        const rect = el.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === el;
    }), true, '当前封面链接也应保持可点击');
    assert.equal(await card.locator('.native-delete').evaluate(el => {
        const rect = el.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === el;
    }), true, '展开后原生删除按钮仍应能命中');
    const rows = popup.locator('.bvh-multi-rows');
    await rows.hover(); await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
    const before = await rows.evaluate(el => el.scrollTop);
    await page.waitForTimeout(180); assert.equal(await popup.count(), 1, '从封面移入详情不能关闭详情');
    await page.evaluate(async () => {
        const s = testAPI.StorageManager, key = 'BV0000000002'; await s.saveRecord(key, { ...s.getRecord(key), percent: '63%' });
    });
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history')?.textContent.includes('63%'));
    assert.equal(await rows.evaluate(el => el.scrollTop), before);
    assert.deepEqual(await popup.boundingBox(), detailBox, '后台更新不应突然移动详情');
    await popup.locator('[data-refresh-titles]').click();
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-note')?.textContent === '已更新 18 条分 P 标题');
    assert.equal(await page.evaluate(() => titleCalls), 1);
    assert.equal(await rows.evaluate(el => el.scrollTop), before, '详情刷新标题后仍应保留滚动位置');
    await card.locator('.native-delete').hover(); await popup.waitFor({ state: 'detached' });
    await card.locator('.native-delete').click(); assert.equal(await page.evaluate(() => deleteClicks), 1);
    await page.waitForTimeout(250); assert.equal(await popup.count(), 0, '删除操作期间不能延迟弹出详情');
    console.log('通过：历史页标题／删除区域不触发、封面聚焦可触发、密集网格不遮挡操作、移入详情滚动及后台刷新保持、原生删除可点击');

    await page.evaluate(() => { document.querySelectorAll('.history-card:not(#card-2)').forEach(card => card.remove()); document.querySelector('main').style.display = 'block'; });
    await card.locator('img').hover(); await popup.waitFor();
    assert.equal(await popup.getAttribute('data-side'), 'right');
    await popup.hover(); await page.waitForTimeout(180); assert.equal(await popup.count(), 1);
    await rows.hover(); await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
    await card.locator('.title').hover(); await popup.waitFor({ state: 'detached' });
    console.log('通过：宽松布局侧边详情、封面移入侧边详情可滚动、返回标题时让开');

    await card.locator('img').hover(); await card.locator('.native-delete').hover();
    await page.waitForTimeout(250); assert.equal(await popup.count(), 0, '从封面快速移到删除按钮应取消待弹出的详情');
    await page.setViewportSize({ width: 390, height: 740 });
    await card.locator('img').hover(); await popup.waitFor();
    const narrow = await popup.boundingBox();
    assert(narrow.x >= 8 && narrow.x + narrow.width <= 382 && narrow.y >= (await card.boundingBox()).y + (await card.boundingBox()).height + 8);
    assert.equal(await popup.getAttribute('data-history-below'), 'true');
    await card.locator('.title').hover(); assert.equal(await popup.count(), 1, '经过标题移入下方详情时应保持显示，且不遮挡标题操作区');
    await rows.hover(); await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
    await card.locator('.native-delete').click(); assert.equal(await page.evaluate(() => deleteClicks), 2);
    console.log('通过：快速移出取消触发，窄屏详情可滚动且删除按钮保持可达');
    assert.deepEqual(errors, []);
} finally { await browser.close(); }
