import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

// 本地合成页面，无需登录、网络或真实观看记录。
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.setContent('<style>.video-pod__list{height:400px;overflow:auto}.video-pod__item{height:40px}</style><div class="video-pod"><div class="video-pod__list"></div></div>');
    await page.evaluate(() => {
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = () => {};
        window.__INITIAL_STATE__ = { bvid: 'BV0000000001' };
        const list = document.querySelector('.video-pod__list');
        list.innerHTML = Array.from({ length: 1000 }, (_, i) => `<div class="video-pod__item" data-key="BV${String(i + 1).padStart(10, '0')}"><span class="title-txt">第 ${i + 1} 集</span></div>`).join('');
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { DOMWatcher, EpisodeResolver, StorageManager, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        window.stats = { scans: 0, renders: 0, peakPending: 0 };
        const collect = EpisodeResolver._collectItems;
        EpisodeResolver._collectItems = () => { stats.scans++; return collect(); };
        window.records = new Map(Array.from({ length: 1000 }, (_, i) => [`BV${String(i + 1).padStart(10, '0')}`, { status: '已观看', percent: '50%', savedAt: '测试' }]));
        StorageManager.getRecord = key => records.get(key) || null;
        StorageManager.onDataChange = fn => { window.notifyDataChange = fn; return () => {}; };
        const process = DOMWatcher.prototype.processPlaylistItem;
        DOMWatcher.prototype.processPlaylistItem = function (el) { stats.renders++; return process.call(this, el); };
        const enqueue = DOMWatcher.prototype.enqueuePlaylistItems;
        DOMWatcher.prototype.enqueuePlaylistItems = function (items) {
            enqueue.call(this, items);
            stats.peakPending = Math.max(stats.peakPending, this.pendingPlaylistItems.size);
        };
        window.watcher = new DOMWatcher();
    });
    await page.waitForFunction(() => document.querySelector('.bvh-episode-tag') && !watcher.flushScheduled);
    const initial = await page.evaluate(() => ({ ...stats, tags: document.querySelectorAll('.bvh-episode-tag').length, observed: watcher.observedElements.size }));
    assert.equal(initial.observed, 1000);
    assert.equal(initial.scans, 0, '普通合集条目不应触发全表身份扫描');
    assert(initial.tags > 0 && initial.tags < 30, JSON.stringify(initial));
    assert(initial.peakPending < 30, JSON.stringify(initial));
    console.log('通过：1000 项合集首次渲染仅处理可见区域', initial);

    const stable = await page.evaluate(async () => {
        const el = document.querySelector('.video-pod__item');
        const oldTag = el.querySelector('.bvh-episode-tag');
        let changes = 0;
        const observer = new MutationObserver(entries => { changes += entries.length; });
        observer.observe(el, { subtree: true, childList: true });
        watcher.processPlaylistItem(el);
        watcher.processPlaylistItem(el);
        await Promise.resolve();
        observer.disconnect();
        return { sameTag: oldTag === el.querySelector('.bvh-episode-tag'), changes };
    });
    assert.deepEqual(stable, { sameTag: true, changes: 0 });

    await page.evaluate(() => {
        records.get('BV0000000001').percent = '80%';
        notifyDataChange({ changedBases: new Set(['BV0000000001']) });
    });
    await page.waitForFunction(() => document.querySelector('.bvh-episode-tag').textContent.includes('80%'));
    await page.evaluate(() => document.querySelector('.bvh-episode-tag').remove());
    await page.evaluate(() => watcher.refreshPlaylistItems());
    await page.waitForFunction(() => document.querySelector('.bvh-episode-tag')?.textContent.includes('80%'));
    await page.evaluate(() => {
        records.delete('BV0000000001');
        notifyDataChange({ changedBases: new Set(['BV0000000001']) });
    });
    await page.waitForFunction(() => !document.querySelector('.video-pod__item').querySelector('.bvh-episode-tag'));
    console.log('通过：重复刷新零 DOM 写入；进度变化、标签被替换和记录删除正确更新');

    await page.evaluate(() => {
        const list = document.querySelector('.video-pod__list');
        list.scrollTop = list.scrollHeight;
    });
    await page.waitForFunction(() => document.querySelector('.video-pod__item:last-child .bvh-episode-tag'));
    const scrolled = await page.evaluate(() => ({ ...stats, pending: watcher.pendingPlaylistItems.size }));
    assert.equal(scrolled.scans, 0);
    assert(scrolled.renders < 100, JSON.stringify(scrolled));
    console.log('通过：滚动到底部补齐标签，未遍历渲染中间条目', scrolled);

    await page.evaluate(() => {
        window.detached = document.querySelector('.video-pod__item:last-child');
        detached.remove();
    });
    await page.waitForFunction(() => !watcher.observedElements.has(detached));
    await page.evaluate(() => {
        detached.querySelector('.bvh-episode-tag').remove();
        document.querySelector('.video-pod__list').appendChild(detached);
        document.querySelector('.video-pod__list').scrollTop = 1e9;
    });
    await page.waitForFunction(() => watcher.observedElements.has(detached) && detached.querySelector('.bvh-episode-tag'));
    console.log('通过：节点移除后重插可重新观察并渲染');

    const fallback = await page.evaluate(async () => {
        watcher.rootObserver.disconnect();
        watcher.disconnectContentObservers();
        watcher.intersectionObserver.disconnect();
        document.body.innerHTML = '<div class="video-pod__list"><div class="video-pod__item" data-key="123"><span class="title-txt">第一 P</span></div><div class="video-pod__item" data-key="456"><span class="title-txt">第二 P</span></div></div>';
        testAPI.EpisodeResolver._invalidateItemsCache();
        return Array.from(document.querySelectorAll('.video-pod__item'), el => watcher.getPlaylistItemInfo(el).key);
    });
    assert.deepEqual(fallback, ['BV0000000001', 'BV0000000001?p=2']);
    console.log('通过：数字 CID 分 P 保留原有身份解析');

    const section = await page.evaluate(() => {
        document.body.innerHTML = `<div class="video-pod__list section">${[1, 2].map(i =>
            `<div class="video-pod__item" data-key="BV${String(i).padStart(10, '0')}"><div class="page-list">${[1, 2, 3].map(p =>
                `<div class="simple-base-item page-item"><span class="title-txt">分 P ${p}</span></div>`).join('')}</div></div>`).join('')}</div>`;
        testAPI.EpisodeResolver._invalidateItemsCache();
        const items = testAPI.EpisodeResolver.getItems().filter(item => item.cid.startsWith('section-page:'));
        return { resolved: items.map(item => item.key), rendered: Array.from(document.querySelectorAll('.page-item'), el => watcher.getPlaylistItemInfo(el).key) };
    });
    const expected = ['BV0000000001', 'BV0000000001?p=2', 'BV0000000001?p=3', 'BV0000000002', 'BV0000000002?p=2', 'BV0000000002?p=3'];
    assert.deepEqual(section.resolved, expected);
    assert.deepEqual(section.rendered, expected);
    console.log('通过：合集内多个视频各自的分 P 序号正确');
} finally {
    await browser.close();
}
