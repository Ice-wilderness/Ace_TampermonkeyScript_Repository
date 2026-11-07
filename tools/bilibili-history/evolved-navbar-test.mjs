import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

// 按内置浏览器中 Evolved 顶栏实页的 DOM 构造隔离夹具，不读写用户历史。
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    // 播放页不会使用 body 全局内容观察，能验证独立顶栏弹窗的发现与加载。
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = () => {};
        window.GM_addStyle = css => {
            const style = document.createElement('style'); style.textContent = css; document.head.append(style);
        };
        document.body.innerHTML = `<style>
            .popup-container { display: inline-block; vertical-align: top; width: 230px; }
            .cover-container, .watchlater-cover-container, .favorites-cover-container, .history-cover-container,
            .header-history-video__image, .header-fav-card__image, .header-dynamic__box--right .cover,
            .bili-video-card__cover { display: block; position: relative; width: 196px; height: 120px; }
            img { width: 100%; height: 100%; }
            .up img { width: 24px; height: 24px; }
        </style><div class="bili-header"><a href="/video/BV0000000001" id="native-nav"><img></a>
            <div class="dynamic-panel-popover"><a class="header-dynamic__box--right" href="/video/BV0000000001"><div class="cover"><img></div></a></div>
            <div class="history-panel-popover"><a class="header-history-card" href="/video/BV0000000001"><div class="header-history-video__image"><img></div></a></div>
            <div class="favorite-panel-popover"><a class="header-fav-card" href="/video/BV0000000001"><div class="header-fav-card__image"><img></div></a></div>
        </div><div class="right-container"><div class="bili-video-card"><a href="/video/BV0000000001" class="bili-video-card__cover"><img></a></div></div>
        <div id="unrelated"><a class="history-cover-container" href="/video/BV0000000001"></a></div>`;
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { StorageManager, DOMWatcher, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        window.records = new Map([
            ['BV0000000001', { status: '已观看', percent: '55%', savedAt: '测试' }],
            ['BV0000000002', { status: '已访问', savedAt: '测试' }],
            ['BV0000000003?p=2', { status: '已观看', percent: '20%', savedAt: '测试' }]
        ]);
        StorageManager.getRecord = key => records.get(key) || null;
        StorageManager.getRelatedKeys = base => [...records.keys()].filter(key => testAPI.VideoKey.base(key) === base);
        StorageManager.onDataChange = fn => { window.notifyChange = fn; return () => {}; };
        testAPI.injectStyles(); window.watcher = new DOMWatcher(); watcher.scanExistingLinks();
    });
    await page.waitForFunction(() => document.querySelectorAll('.bvh-tag').length === 4);
    const nativeBefore = await page.locator('.bili-header, .right-container, #unrelated').evaluateAll(nodes => nodes.map(node => node.outerHTML));
    await page.evaluate(() => {
        const navbar = document.createElement('div'); navbar.className = 'custom-navbar';
        navbar.innerHTML = `<a href="/video/BV0000000001" id="evolved-nav"><img></a>` +
            ['feeds', 'watchlater', 'favorites', 'history'].map(name => `<div class="custom-navbar-item" data-name="${name}"><a class="main-content" href="/video/BV0000000001">菜单</a><div class="popup-container"><div class="popup"></div></div></div>`).join('');
        document.body.append(navbar);
    });
    await page.waitForFunction(() => [...watcher.contentObservers.keys()].filter(root => root.matches('.popup-container')).length === 4);
    await page.evaluate(() => {
        const href = '/video/BV0000000001';
        const feed = document.querySelector('[data-name="feeds"] .popup');
        feed.innerHTML = `<div class="navbar-feeds"><a class="video-card vertical no-stats" href="${href}"><div class="cover-container"><img class="cover"><div class="duration">03:00</div></div><h1 class="title">动态视频</h1><a href="https://space.bilibili.com/1" class="up"><img class="face"></a></a></div>`;
        for (const [name, cover] of [['watchlater', 'watchlater'], ['favorites', 'favorites'], ['history', 'history']]) {
            const url = name === 'watchlater' ? '/list/watchlater?bvid=BV0000000001' : href + '?p=1&t=15';
            document.querySelector(`[data-name="${name}"] .popup`).innerHTML = `<div class="cards"><div class="time-group-item"><a class="${cover}-cover-container" href="${url}"><img class="cover"><div class="floating pages">1P</div></a><a class="title" href="${url}">标题</a><a class="up" href="https://space.bilibili.com/1"><img class="face"></a></div></div>`;
        }
    });
    await page.waitForFunction(() => document.querySelectorAll('.custom-navbar .bvh-tag').length === 4);
    assert.equal(await page.locator('.custom-navbar .bvh-progress-bar').count(), 4);
    assert.equal(await page.locator('.custom-navbar .title .bvh-tag, .up .bvh-tag, #native-nav .bvh-tag, #evolved-nav .bvh-tag, .main-content .bvh-tag').count(), 0);
    const positions = await page.locator('.custom-navbar .bvh-tag').evaluateAll(tags => tags.map(tag => {
        const cover = tag.parentElement, a = cover.getBoundingClientRect(), b = tag.getBoundingClientRect();
        return { cover: cover.classList.contains('cover-container') || cover.className.endsWith('-cover-container'),
            inside: b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom,
            pointer: getComputedStyle(tag).pointerEvents };
    }));
    assert(positions.every(p => p.cover && p.inside && p.pointer === 'none'));
    assert.deepEqual(await page.locator('.bili-header, .right-container, #unrelated').evaluateAll(nodes => nodes.map(node => node.outerHTML)), nativeBefore);
    console.log('通过：四种 Evolved 弹窗延迟插入、封面定位、稍后再看 bvid 链接；原生顶栏和推荐区保持一致，不标记标题/头像/菜单');

    const cover = page.locator('[data-name="watchlater"] .watchlater-cover-container');
    await cover.evaluate(el => el.href = '/list/watchlater?bvid=BV0000000002');
    await page.waitForFunction(() => document.querySelector('.watchlater-cover-container .bvh-tag')?.textContent === '已访问');
    assert.equal(await cover.locator('.bvh-progress-bar').count(), 0);
    await cover.evaluate(el => el.href = '/list/watchlater?bvid=BV0000000099');
    await page.waitForFunction(() => !document.querySelector('.watchlater-cover-container .bvh-tag'));
    await cover.evaluate(el => el.href = '/list/watchlater?bvid=BV0000000001');
    await page.waitForFunction(() => document.querySelector('.watchlater-cover-container .bvh-tag'));
    await cover.evaluate(el => el.removeAttribute('href'));
    await page.waitForFunction(() => !document.querySelector('.watchlater-cover-container .bvh-tag'));
    await cover.evaluate(el => el.href = '/list/watchlater?bvid=BV0000000001');
    await page.waitForFunction(() => document.querySelector('.watchlater-cover-container .bvh-tag'));
    await cover.evaluate(el => el.replaceChildren(Object.assign(document.createElement('img'), { className: 'cover' })));
    await page.waitForFunction(() => document.querySelector('.watchlater-cover-container .bvh-tag'));
    console.log('通过：卡片复用只改 href、未知视频、移除链接和仅替换封面时自动刷新，无旧标记残留');

    await page.evaluate(() => {
        testAPI.CONFIG.coverStyle = 'ring'; testAPI.CONFIG.coverRingSize = 64; testAPI.CONFIG.tagPosition = 'bottom-right';
        watcher.refreshHeaderPopoverCards();
    });
    await page.waitForFunction(() => document.querySelectorAll('.custom-navbar .bvh-tag-ring').length === 4);
    assert.equal(await page.locator('.custom-navbar .bvh-progress-bar').count(), 0);
    assert((await page.locator('.custom-navbar .bvh-tag-ring').evaluateAll(nodes => nodes.map(el => el.style.width))).every(width => width === '36px'));
    await page.evaluate(() => {
        testAPI.CONFIG.coverStyle = 'label';
        document.querySelector('.watchlater-cover-container').href = '/list/watchlater?bvid=BV0000000003';
    });
    await page.waitForFunction(() => document.querySelector('.watchlater-cover-container .bvh-tag')?.textContent.includes('多P'));
    assert.equal(await cover.getAttribute('data-bvh-multi-base'), 'BV0000000003');
    assert.equal(await cover.locator('.bvh-progress-bar').count(), 0);
    await page.evaluate(() => {
        const el = document.querySelector('.watchlater-cover-container');
        window.oldTag = el.querySelector('.bvh-tag'); watcher.processLink(el); watcher.processLink(el);
    });
    assert.equal(await cover.evaluate(el => el.querySelector('.bvh-tag') === oldTag && el.querySelectorAll('.bvh-tag').length === 1), true);
    await page.evaluate(() => {
        records.delete('BV0000000003?p=2');
        notifyChange({ changedBases: new Set(['BV0000000003']) });
    });
    await page.waitForFunction(() => !document.querySelector('.watchlater-cover-container .bvh-tag'));
    assert.deepEqual(errors, []);
    console.log('通过：圆环小封面上限、位置设置、多 P 汇总、重复刷新和记录删除同步，无页面异常');
} finally {
    await browser.close();
}
