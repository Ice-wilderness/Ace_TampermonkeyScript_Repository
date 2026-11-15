import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { instrument } from './harness.mjs';

// 隔离页面与内存记录；不请求 B 站或操作真实收藏／稍后再看。
const cases = [
    ['收藏夹现代卡片', 'https://space.bilibili.com/1/favlist', 'fav-video-list', 'bili-video-card'],
    ['收藏夹旧版卡片', 'https://space.bilibili.com/1/favlist', 'fav-video-list', 'small-item'],
    ['稍后再看现代卡片', 'https://www.bilibili.com/list/watchlater', 'video-list', 'bili-video-card'],
    ['稍后再看旧版卡片', 'https://www.bilibili.com/watchlater/', 'watch-later-list', 'av-item'],
    ['未知分离链接卡片', 'https://space.bilibili.com/1/favlist', 'fav-video-list', 'collection-entry'],
    ['原生收藏菜单', 'https://www.bilibili.com/', 'favorite-panel-popover', 'header-fav-card', true],
    ['原生历史菜单', 'https://www.bilibili.com/', 'history-panel-popover', 'header-history-card', true]
];
const browser = await chromium.launch({ headless: true });
const artifactDir = path.join(os.tmpdir(), 'bvh-library-placement-review');
await fs.mkdir(artifactDir, { recursive: true });
try {
    for (const [name, url, rootClass, cardClass, menu] of cases) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
        page.setDefaultTimeout(5000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const href = url.includes('/list/') ? '/list/watchlater?bvid=BV0000000001' : '/video/BV0000000001';
        const media = `<div class="cover"><img alt="视频封面"><span class="duration">视频时长</span><span class="more" role="button" tabindex="0">更多</span></div>`;
        const info = `<div class="info"><${menu ? 'span tabindex="0"' : `a href="${href}"`} class="title">独立视频标题</${menu ? 'span' : 'a'}><span class="native-delete" role="button" tabindex="0">删除</span><${menu ? 'span tabindex="0"' : 'a href="https://space.bilibili.com/1"'} class="up">UP 主</${menu ? 'span' : 'a'}></div>`;
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><style>
            body{margin:0;font:14px sans-serif}a{color:inherit;text-decoration:none}
            main{position:absolute;left:40px;top:40px;width:280px}.card{display:block;width:280px}
            .cover{position:relative;height:180px}.cover img{display:block;width:280px;height:180px;background:#cadce4}
            .duration{position:absolute;bottom:0;right:0}.more{position:absolute;top:5px;right:5px;background:white;padding:5px}
            .info{display:grid;grid-template-columns:1fr 40px;gap:10px;padding:12px 0}.up{grid-column:1/-1}
            ${menu ? 'main{height:600px;background:#eee;overflow:auto}' : ''}
            </style><button id="outside">外部按钮</button><main class="${rootClass}">
            ${menu ? `<a id="card" class="card ${cardClass}" href="${href}">${media}${info}</a>` : `<article id="card" class="card ${cardClass}"><a class="media-link" href="${href}">${media}</a>${info}</article>`}
            </main>` }));
        await page.goto(url);
        await page.evaluate(() => {
            const data = new Map();
            window.GM_getValue = (key, fallback) => data.has(key) ? structuredClone(data.get(key)) : fallback;
            window.GM_setValue = (key, value) => data.set(key, structuredClone(value));
            window.GM_deleteValue = key => data.delete(key); window.GM_listValues = () => [...data.keys()];
            window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
            window.GM_info = { script: { version: 'test' } }; window.unsafeWindow = window;
            window.titleCalls = 0; window.GM_xmlhttpRequest = request => {
                titleCalls++; request.onload({ status: 200, response: { code: 0, data: { bvid: 'BV0000000001', title: '视频标题',
                    pages: Array.from({ length: 18 }, (_, i) => ({ page: i + 1, part: `最新标题 ${i + 1}` })) } } });
            };
            window.actionClicks = 0;
            document.querySelectorAll('.native-delete,.more').forEach(el => el.addEventListener('click', event => { event.preventDefault(); actionClicks++; }));
        });
        await page.evaluate(instrument());
        await page.evaluate(async () => {
            const { StorageManager: s, Utils } = testAPI;
            for (const key of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[key] = () => {};
            await s.initialize();
            await s.importRecords(Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`BV0000000001${i ? `?p=${i + 1}` : ''}`, {
                title: `第 ${i + 1} P 标题`, status: '已观看', percent: '50%', currentTime: '05:00', savedAt: '2026-11-15 10:00:00'
            }])));
            testAPI.CONFIG.showMultiPageHistory = true; testAPI.injectStyles();
            window.watcher = new testAPI.DOMWatcher(); watcher.scanExistingLinks();
        });
        const card = page.locator('#card'), panel = page.locator('#bvh-multi-history');
        await page.waitForFunction(() => document.querySelector('[data-bvh-multi-base]'));
        for (const selector of ['.title', '.native-delete', '.up', '.more']) {
            await card.locator(selector).hover(); await page.waitForTimeout(220);
            assert.equal(await panel.count(), 0, `${name} ${selector} 悬停不能触发`);
            await card.locator(selector).focus(); await page.waitForTimeout(220);
            assert.equal(await panel.count(), 0, `${name} ${selector} 聚焦不能触发`);
        }
        await card.locator('.duration').hover(); await panel.waitFor();
        const cover = await card.locator('img').boundingBox(), detail = await panel.boundingBox();
        assert(detail.x >= cover.x + cover.width || detail.x + detail.width <= cover.x || detail.y >= cover.y + cover.height || detail.y + detail.height <= cover.y, `${name} 不覆盖当前封面`);
        for (const selector of ['.title', '.native-delete', '.more']) {
            assert.equal(await card.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), true, `${name} ${selector} 应保持可达`);
        }
        const rows = panel.locator('.bvh-multi-rows');
        await rows.hover(); await page.mouse.wheel(0, 240);
        await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
        const scroll = await rows.evaluate(el => el.scrollTop);
        await page.evaluate(async () => { const s = testAPI.StorageManager; await s.saveRecord('BV0000000001', { ...s.getRecord('BV0000000001'), percent: '63%' }); });
        assert.equal(await rows.evaluate(el => el.scrollTop), scroll, `${name} 更新记录不能回顶`);
        await panel.locator('[data-refresh-titles]').click();
        await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-note')?.textContent === '已更新 18 条分 P 标题');
        assert.equal(await rows.evaluate(el => el.scrollTop), scroll, `${name} 刷新标题不能回顶`);
        assert.equal(await page.evaluate(() => titleCalls), 1);
        await card.locator('.native-delete').hover(); await panel.waitFor({ state: 'detached' });
        await card.locator('.native-delete').click(); await card.locator('.more').click();
        assert.equal(await page.evaluate(() => actionClicks), 2);
        await card.locator('img').hover(); await card.locator('.more').hover();
        await page.waitForTimeout(250); assert.equal(await panel.count(), 0, `${name} 快速移到操作区取消待弹出详情`);
        await page.locator(menu ? '#card' : '.media-link').focus(); await panel.waitFor();
        assert.equal(await panel.locator('.bvh-multi-row').count(), 18, `${name} 封面键盘入口可用`);
        await page.locator('#outside').focus(); await panel.waitFor({ state: 'detached' });
        if (!menu) {
            await page.setViewportSize({ width: 390, height: 740 });
            await card.locator('img').hover(); await panel.waitFor();
            assert.equal(await panel.getAttribute('data-card-below'), 'true');
            await card.locator('.title').hover(); await page.waitForTimeout(180);
            assert.equal(await panel.count(), 1, `${name} 经过标题进入下方详情应保持显示`);
            await rows.hover(); await page.mouse.wheel(0, 180);
            await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
            await card.locator('.more').hover(); await panel.waitFor({ state: 'detached' });
        }
        if (name === '稍后再看现代卡片') {
            await page.setViewportSize({ width: 1100, height: 850 });
            await page.evaluate(() => {
                const style = document.createElement('style');
                style.textContent = '.card{display:grid;grid-template-columns:160px 120px}.card .cover,.card img{width:160px;height:120px}.card .info{box-sizing:border-box;padding:8px;grid-template-columns:minmax(0,1fr) 32px;gap:4px}#neighbor{position:absolute;left:288px;top:0;grid-template-columns:80px 320px;width:400px}#neighbor .cover,#neighbor img{width:80px}';
                document.head.append(style);
                const neighbor = document.createElement('article'); neighbor.id = 'neighbor'; neighbor.className = 'card bili-video-card';
                neighbor.innerHTML = '<a href="/video/BV0000000009"><div class="cover"><img alt="无本地记录的邻卡"></div></a><div class="info"><a class="title" href="/video/BV0000000009">邻卡横排标题</a><button class="native-delete">删除</button></div>';
                document.querySelector('main').append(neighbor);
            });
            await card.locator('img').hover(); await panel.waitFor();
            assert.equal(await panel.getAttribute('data-side'), 'right', '侧边有空间时不应因邻卡改为向下显示');
            assert((await panel.boundingBox()).height >= 420, '邻卡信息区不能挤压正常详情高度');
            for (const selector of ['#card .title', '#card .native-delete']) {
                const hit = await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(), target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { reachable: el.contains(target), rect: r.toJSON(), target: target?.outerHTML.slice(0, 180) }; });
                assert.equal(hit.reachable, true, `${selector} 保持可达 ${JSON.stringify(hit)}`);
            }
            assert.equal(await page.locator('#neighbor [data-bvh-multi-base]').count(), 0, '用于列定位的邻卡没有本地多 P 标记');
            await page.screenshot({ path: path.join(artifactDir, 'normal-side.png') });
            await page.keyboard.press('Escape'); await page.mouse.move(1000, 750);
            await page.setViewportSize({ width: 1400, height: 850 });
            await page.evaluate(() => {
                document.querySelector('#card').style.cssText = 'position:relative;left:360px';
                document.querySelector('#neighbor').style.cssText = 'left:0;width:280px;grid-template-columns:80px 200px';
            });
            await card.locator('img').hover(); await panel.waitFor();
            const rightmost = await card.boundingBox(), inward = await panel.boundingBox();
            assert(1400 - rightmost.x - rightmost.width > 340, '复现列表右侧仍有大片页面空白的最右列');
            assert.equal(await panel.getAttribute('data-side'), 'left', '最右列应向列表内侧展开');
            assert(inward.x + inward.width <= rightmost.x - 8 && inward.x >= 8);
            assert(inward.height >= 420 && inward.width === 340);
            await rows.hover(); await page.mouse.wheel(0, 180);
            await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-rows')?.scrollTop > 0);
            const before = await rows.evaluate(el => el.scrollTop);
            await page.evaluate(async () => { const s = testAPI.StorageManager; await s.saveRecord('BV0000000001', { ...s.getRecord('BV0000000001'), percent: '74%' }); });
            assert.deepEqual(await panel.boundingBox(), inward, '后台刷新不改变展开方向和正常尺寸');
            assert.equal(await rows.evaluate(el => el.scrollTop), before);
            await page.screenshot({ path: path.join(artifactDir, 'rightmost-inward.png') });
            console.log('通过：横排卡片侧边优先、正常高度，最右列有右侧空白时仍向左展开，刷新不移动／回顶');
        }
        assert.deepEqual(errors, []);
        console.log(`通过：${name} 封面触发、标题和原生操作不触发、详情滚动／更新／刷新标题保留位置、按钮可点击与键盘入口`);
        await page.close();
    }
} finally { await browser.close(); }
