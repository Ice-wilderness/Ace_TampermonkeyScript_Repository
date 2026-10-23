import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

// 使用实页的无 href、背景图封面结构；所有数据和网络均在本地隔离。
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = () => {};
        window.GM_addStyle = css => {
            const style = document.createElement('style'); style.textContent = css; document.head.append(style);
        };
        document.body.innerHTML = `<style>
            .bpx-player-ending-related-item{display:inline-block;width:200px;height:120px;overflow:hidden}
            .bpx-player-ending-related-item-img,.bpx-player-ending-related-item-cover{position:absolute;inset:0}
            .bpx-player-ending-related-item-title{position:absolute;bottom:0}
            .video-page-card-small img{width:180px;height:100px}
        </style><div id="player"></div><div class="right-container"></div>`;
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { StorageManager, DOMWatcher, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        window.records = new Map([
            ['BV1PsnM6DEgW', { status: '已观看', percent: '95%', savedAt: '测试记录' }],
            ['BV0000000002', { status: '已访问', savedAt: '测试记录' }]
        ]);
        StorageManager.getRecord = key => records.get(key) || null;
        StorageManager.getRelatedKeys = () => [];
        StorageManager.onDataChange = fn => { window.notifyChange = fn; return () => {}; };
        window.addSidebar = (key, cover, title) => {
            const card = document.createElement('div'); card.className = 'video-page-card-small';
            card.innerHTML = `<a href="/video/${key}"><img src="//i1.hdslb.com/bfs/archive/${cover}.jpg@336w_190h_1c.avif"></a><a href="/video/${key}"><p class="title">${title}</p></a>`;
            document.querySelector('.right-container').append(card);
            return card;
        };
        window.addEnding = (cover, title, attrs = '') => {
            const card = document.createElement('a'); card.className = 'bpx-player-ending-related-item';
            card.innerHTML = `<div class="bpx-player-ending-related-item-img" style="background-image:url(//i0.hdslb.com/bfs/archive/${cover}.jpg@336w_190h.avif)"></div><div class="bpx-player-ending-related-item-cover"><div class="bpx-player-ending-related-item-title">${title}</div></div>`;
            if (attrs) card.setAttribute(...attrs);
            document.querySelector('.bpx-player-ending-related').append(card);
            return card;
        };
        testAPI.injectStyles();
        window.watcher = new DOMWatcher();
        const root = document.createElement('div'); root.className = 'bpx-player-ending-related';
        root.style.display = 'none'; document.querySelector('#player').append(root);
        window.first = addEnding('same-cover', '化石视频');
        window.unknown = addEnding('unknown-cover', '未知视频');
    });
    await page.waitForFunction(() => watcher.observedElements.has(first));
    assert.equal(await page.locator('.bpx-player-ending-related .bvh-tag').count(), 0);
    await page.evaluate(() => {
        window.sidebar = addSidebar('BV1PsnM6DEgW', 'same-cover', '化石视频');
        document.querySelector('.bpx-player-ending-related').style.display = '';
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag')?.textContent.includes('95%'));
    assert.equal(await page.locator('.bpx-player-ending-related .bvh-tag').count(), 1);
    assert.equal(await page.locator('.bpx-player-ending-related .bvh-progress-bar').count(), 1);
    assert.equal(await page.evaluate(() => first.hasAttribute('href')), false, '解析身份不能改写站点点击行为');
    const position = await page.evaluate(() => {
        const tag = first.querySelector('.bvh-tag');
        const a = first.getBoundingClientRect(), b = tag.getBoundingClientRect();
        return { inCard: b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom,
            pointerEvents: getComputedStyle(tag).pointerEvents, parent: tag.parentElement === first };
    });
    assert.deepEqual(position, { inCard: true, pointerEvents: 'none', parent: true });
    console.log('通过：结束区域动态插入、右侧推荐延迟加载、无 href 背景封面匹配和标签定位');

    const stable = await page.evaluate(async () => {
        const old = first.querySelector('.bvh-tag'); let writes = 0;
        const observer = new MutationObserver(entries => { writes += entries.length; });
        observer.observe(first, { childList: true, subtree: true });
        watcher.processLink(first); watcher.processLink(first);
        await Promise.resolve(); observer.disconnect();
        return { same: old === first.querySelector('.bvh-tag'), writes };
    });
    assert.deepEqual(stable, { same: true, writes: 0 });
    await page.evaluate(() => {
        records.get('BV1PsnM6DEgW').percent = '60%';
        notifyChange({ changedBases: new Set(['BV1PsnM6DEgW']) });
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag')?.textContent.includes('60%'));
    await page.evaluate(() => {
        testAPI.CONFIG.coverStyle = 'ring'; testAPI.CONFIG.tagPosition = 'bottom-right';
        notifyChange({ settingsChanged: true });
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag-ring'));
    assert.equal(await page.locator('.bpx-player-ending-related .bvh-progress-bar').count(), 0);
    assert.equal(await page.evaluate(() => first.querySelector('.bvh-tag').style.right), '0px');
    await page.evaluate(() => {
        records.delete('BV1PsnM6DEgW'); notifyChange({ changedBases: new Set(['BV1PsnM6DEgW']) });
    });
    await page.waitForFunction(() => !first.querySelector('.bvh-tag'));
    console.log('通过：重复处理零 DOM 写入，进度、圆环与位置设置、删除记录同步刷新');

    await page.evaluate(() => {
        first.setAttribute('href', '/video/BV0000000002');
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag')?.textContent.includes('已访问'));
    await page.evaluate(() => {
        testAPI.CONFIG.showVisitedTag = false; notifyChange({ settingsChanged: true });
    });
    await page.waitForFunction(() => !first.querySelector('.bvh-tag'));
    await page.evaluate(() => {
        testAPI.CONFIG.showVisitedTag = true;
        first.removeAttribute('href'); first.setAttribute('data-bvid', 'BV0000000002');
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag'));
    await page.evaluate(() => {
        first.removeAttribute('data-bvid');
        records.set('BV1PsnM6DEgW', { status: '已观看', percent: '80%' });
        first.querySelector('.bpx-player-ending-related-item-title').firstChild.data = '同名不同封面';
        first.querySelector('.bpx-player-ending-related-item-img').style.backgroundImage = 'url(//i1.hdslb.com/bfs/archive/other.jpg)';
    });
    await page.waitForFunction(() => !first.querySelector('.bvh-tag'));
    await page.evaluate(() => addSidebar('BV1PsnM6DEgW', 'other', '同名不同封面'));
    await page.waitForFunction(() => first.querySelector('.bvh-tag')?.textContent.includes('80%'));
    // 只更新背景图，也应移除旧身份的标签。
    await page.evaluate(() => { first.querySelector('.bpx-player-ending-related-item-img').style.backgroundImage = 'url(//i1.hdslb.com/bfs/archive/missing.jpg)'; });
    await page.waitForFunction(() => !first.querySelector('.bvh-tag'));
    console.log('通过：链接和 data-bvid 属性复用、隐藏访问标签、文本及背景图单独更新均不遗留旧标签');

    await page.evaluate(() => {
        addSidebar('BV0000000002', 'same-cover', '化石视频');
        first.querySelector('.bpx-player-ending-related-item-title').textContent = '化石视频';
        first.querySelector('.bpx-player-ending-related-item-img').style.backgroundImage = 'url(//i1.hdslb.com/bfs/archive/same-cover.jpg)';
    });
    await page.waitForFunction(() => !watcher.flushScheduled && !watcher.pendingLinks.size);
    assert.equal(await page.evaluate(() => watcher.getVideoKeyFromLink(first)), '');
    assert.equal(await page.evaluate(() => first.querySelector('.bvh-tag')), null);
    await page.evaluate(() => {
        first.setAttribute('href', '/video/BV1PsnM6DEgW');
        first.querySelector('.bpx-player-ending-related-item-img').replaceWith(document.createElement('div'));
        first.querySelector('div').innerHTML = '<img width="200" height="120" src="/cover.jpg">';
    });
    await page.waitForFunction(() => first.querySelector('.bvh-tag'));
    await page.evaluate(() => first.remove());
    await page.waitForFunction(() => !watcher.observedElements.has(first));
    await page.evaluate(() => document.querySelector('.bpx-player-ending-related').append(first));
    await page.waitForFunction(() => watcher.observedElements.has(first) && first.querySelectorAll('.bvh-tag').length === 1);
    console.log('通过：身份冲突安全跳过，兼容带 href 和 img 的卡片，移除重插不重复标记');
} finally {
    await browser.close();
}
