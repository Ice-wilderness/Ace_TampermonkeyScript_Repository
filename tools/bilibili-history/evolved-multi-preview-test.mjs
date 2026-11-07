import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
        body{margin:0;font:14px sans-serif}a{color:inherit;text-decoration:none}
        .custom-navbar-item{position:fixed;left:820px;top:0;width:100px;height:50px}
        .popup-container{position:absolute;left:50%;top:50px;width:0;height:0;pointer-events:none}
        .popup{position:absolute;left:0;top:0;transform:translateX(-50%);width:380px;height:550px;background:#eee;opacity:0;pointer-events:none}
        .custom-navbar-item:hover .popup-container > .popup{opacity:1;pointer-events:auto}
        .list{height:100%;overflow:auto;padding:12px;box-sizing:border-box}
        .watchlater-card,.favorite-card,.time-group-item{display:grid;grid-template-columns:130px 1fr;grid-template-rows:55px 30px;gap:0 10px;margin-bottom:12px}
        .watchlater-cover-container,.favorites-cover-container,.history-cover-container{position:relative;grid-row:1/3}
        .video-card{display:grid;grid-template-columns:1fr 1fr;width:190px;margin-bottom:12px}
        .video-card .cover-container,.video-card .title{grid-column:1/-1;position:relative}
        .cover-container{height:120px}.cover{display:block;width:100%;height:100%;background:#cedce8}
        .video-card .title{padding:8px}.up{font-size:12px}.title{overflow:hidden}
    </style></head><body><button id="outside">外部按钮</button><div class="custom-navbar"><div class="custom-navbar-item" data-name="watchlater"><a class="main-content" href="#">菜单</a><div class="popup-container"><div class="popup"><div class="list"></div></div></div></div></div></body></html>` }));
    await page.goto('https://www.bilibili.com/');
    await page.evaluate(() => {
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = () => { throw new Error('隔离测试禁止持久化'); };
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { StorageManager: s, Utils, EpisodeResolver } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        window.records = new Map();
        for (const p of [10, 2, 1]) records.set(`BV0000000001${p === 1 ? '' : `?p=${p}`}`, {
            status: '已观看', percent: `${p * 9}%`, title: `测试分 P ${p}`, currentTime: '01:20', savedAt: '2026-11-08 12:30:00'
        });
        records.set('BV0000000002?p=2', { status: '已访问', title: '仅记录 P2' });
        s.getRecord = key => records.get(key) || null;
        s.getRelatedKeys = base => [...records.keys()].filter(key => testAPI.VideoKey.base(key) === base);
        const listeners = []; s.onDataChange = fn => { listeners.push(fn); return () => {}; };
        window.notify = change => listeners.forEach(fn => fn(change));
        EpisodeResolver.getTitleInfo = () => ({ title: '', parts: new Map(), confirmed: false });
        testAPI.injectStyles(); window.watcher = new testAPI.DOMWatcher(); watcher.scanExistingLinks();
        const item = document.querySelector('.custom-navbar-item');
        item.addEventListener('pointerleave', () => item.dataset.closed = 'true');
        window.renderMenu = name => {
            item.dataset.name = name; delete item.dataset.closed;
            document.querySelector('.list').innerHTML = [1, 2].map(n => {
                const url = name === 'watchlater' ? `/list/watchlater?bvid=BV000000000${n}` : `/video/BV000000000${n}?p=2&t=30`;
                if (name === 'feeds') return `<a class="video-card" href="${url}"><div class="cover-container"><img class="cover"></div><h1 class="title">动态多 P ${n}</h1><span class="up">UP</span></a>`;
                const card = {watchlater:'watchlater-card',favorites:'favorite-card',history:'time-group-item'}[name];
                return `<div class="${card}"><a class="${name === 'history' ? 'history' : name}-cover-container" href="${url}"><img class="cover"></a><a class="title" href="${url}">多 P 视频 ${n}</a><a class="up" href="https://space.bilibili.com/1">UP</a></div>`;
            }).join('');
            watcher.refreshHeaderPopoverCards();
        };
        renderMenu('watchlater');
    });
    const panel = page.locator('#bvh-multi-history');
    const openMenu = () => page.locator('.custom-navbar-item > .main-content').hover();
    await page.waitForFunction(() => document.querySelectorAll('[data-bvh-multi-base]').length === 2);
    await openMenu();
    await page.locator('.list .title').first().hover(); await page.waitForTimeout(240);
    assert.equal(await panel.count(), 0, '保留多 P 详情默认关闭的设置');
    await page.evaluate(() => testAPI.CONFIG.showMultiPageHistory = true);
    await page.mouse.move(20, 700);

    for (const name of ['feeds', 'watchlater', 'favorites', 'history']) {
        await page.evaluate(name => renderMenu(name), name);
        await page.waitForFunction(() => document.querySelectorAll('[data-bvh-multi-base]').length === 2);
        await openMenu();
        await page.locator('.list .title').first().hover(); await panel.waitFor();
        assert.deepEqual(await panel.locator('.bvh-multi-page').allTextContents(), ['P1', 'P2', 'P10']);
        assert.equal(await panel.evaluate(el => el.matches(':popover-open')), true);
        assert.equal(await page.locator('.popup-container').evaluate(el => el.getBoundingClientRect().width), 0);
        const menu = await page.locator('.popup').boundingBox(), detail = await panel.boundingBox();
        assert(detail.x + detail.width <= menu.x - 8, `${name} 应按真实弹窗左边界展开，不与菜单重叠`);
        assert.equal(await panel.evaluate(el => el.parentElement.matches('.popup')), true);
        await panel.hover(); await page.waitForTimeout(180);
        assert.equal(await page.locator('.custom-navbar-item').getAttribute('data-closed'), null, '移入详情不触发菜单移出关闭');
        assert.equal(await page.locator('.popup').evaluate(el => getComputedStyle(el).opacity), '1', '菜单不能因顶层详情未传递 hover 状态而消失');
        assert.equal(await panel.evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
        await page.locator('.list .title').last().hover();
        await page.waitForFunction(() => document.querySelector('#bvh-multi-history .bvh-multi-page')?.textContent === 'P2');
        assert.deepEqual(await panel.locator('.bvh-multi-page').allTextContents(), ['P2']);
        await page.keyboard.press('Escape'); await page.mouse.move(20, 700);
        await page.locator(name === 'feeds' ? '.list a.video-card' : '.list .title').first().focus(); await panel.waitFor();
        await page.locator('#outside').focus(); await panel.waitFor({ state: 'detached' });
        assert.equal(await page.locator('.custom-navbar-item').getAttribute('data-bvh-multi-open'), null, '关闭后恢复 Evolved 原有菜单行为');
    }
    console.log('通过：四种 Evolved 菜单的标题/键盘触发、P 排序、仅 P2、真实弹窗边界定位及移入详情保持菜单');

    await page.evaluate(() => { document.querySelector('.custom-navbar-item').style.left = '140px'; renderMenu('watchlater'); });
    await openMenu();
    await page.locator('.list .title').first().hover(); await panel.waitFor();
    assert.equal(await panel.getAttribute('data-side'), 'right');
    await page.keyboard.press('Escape'); await page.mouse.move(700, 700);
    await page.setViewportSize({ width: 430, height: 700 });
    await page.evaluate(() => { document.querySelector('.custom-navbar-item').style.left = '165px'; renderMenu('watchlater'); });
    await page.waitForFunction(() => document.querySelector('[data-bvh-multi-base]'));
    await openMenu();
    const before = await page.locator('.watchlater-card').first().evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    await page.locator('.list .title').first().hover(); await panel.waitFor();
    assert.equal(await panel.getAttribute('data-inline'), 'true');
    assert.equal(await panel.evaluate(el => el.previousElementSibling.matches('.watchlater-card') && el.parentElement.matches('.list')), true);
    assert.deepEqual(await page.locator('.watchlater-card').first().evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]), before);
    assert((await panel.boundingBox()).height > 100, '高度应取实际弹窗而非零尺寸容器');
    await panel.hover(); assert.equal(await page.locator('.custom-navbar-item').getAttribute('data-closed'), null);
    await page.keyboard.press('Escape'); await page.mouse.move(420, 650);
    await page.evaluate(() => renderMenu('feeds'));
    await openMenu();
    await page.locator('.list .title').first().hover(); await panel.waitFor();
    assert.equal(await panel.getAttribute('data-inline'), 'true');
    assert.equal(await panel.evaluate(el => el.previousElementSibling.matches('a.video-card') && !el.closest('a')), true, '动态详情不嵌入整卡链接');
    console.log('通过：左右展开、窄屏按整张卡片内嵌、保留网格布局、动态整卡链接隔离和实际菜单高度');

    await page.keyboard.press('Escape'); await page.mouse.move(420, 650);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.querySelector('.custom-navbar-item').style.left = '820px'; renderMenu('favorites'); });
    await openMenu();
    await page.locator('.list .title').first().hover(); await panel.waitFor();
    await page.evaluate(() => document.querySelector('.favorites-cover-container').href = '/video/BV0000000002');
    await panel.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.favorites-cover-container').dataset.bvhMultiBase === 'BV0000000002');
    await page.mouse.move(20, 700); await openMenu(); await page.locator('.list .title').first().hover(); await panel.waitFor();
    assert.deepEqual(await panel.locator('.bvh-multi-page').allTextContents(), ['P2']);
    await page.evaluate(() => {
        records.get('BV0000000002?p=2').title = '更新后的分 P 标题';
        notify({ changedBases: new Set(['BV0000000002']) });
    });
    assert.equal(await panel.locator('.bvh-multi-title').textContent(), '更新后的分 P 标题');
    await page.evaluate(() => document.querySelector('.favorite-card').remove());
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('通过：复用卡片切换 BV 时清理旧详情、重新悬停解析新分 P、实时更新及移除卡片清理');
} finally {
    await browser.close();
}
