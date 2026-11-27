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

    // 验证各类列表标签统一置于时长左侧、兼容边界、零 DOM 写入幂等及自愈
    await page.evaluate(() => {
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        testAPI.injectStyles();
        Object.assign(testAPI.CONFIG, testAPI.DEFAULT_CONFIG);
        window.records = new Map([
            ['BV0000000001', { status: '已观看', percent: '96%', savedAt: '测试' }],
            ['BV0000000001?p=2', { status: '已观看', percent: '100%', savedAt: '测试' }],
            ['BV0000000001?p=3', { status: '已观看', percent: '1%', savedAt: '测试' }],
            ['BV0000000001?p=4', { status: '已观看', percent: '66%', savedAt: '测试' }],
            ['BV0000000002', { status: '已观看', percent: '55%', savedAt: '测试' }],
            ['BV0000000003', { status: '已访问', percent: '', savedAt: '测试' }],
            ['BV0000000004', { status: '已观看', percent: '80%', savedAt: '测试' }],
            ['BV0000000005', { status: '已观看', percent: '42%', savedAt: '测试' }],
            ['BV0000000006', { status: '已观看', percent: '75%', savedAt: '测试' }]
        ]);
        testAPI.StorageManager.getRecord = key => records.get(key) || null;
        window.__INITIAL_STATE__ = {
            bvid: 'BV0000000001',
            videoData: {
                bvid: 'BV0000000001',
                pages: [
                    { page: 1, cid: 1001, part: '短标题' },
                    { page: 2, cid: 1002, part: '这是一个非常非常非常长而且没有空格的测试视频标题WWWWWWWWWWWWWWWWWW' },
                    { page: 3, cid: 1003, part: '第三集标题' }
                ]
            }
        };
        document.body.innerHTML = `<style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 16px; font: 13px sans-serif; }
            .pod-box { width: 338px; margin-bottom: 16px; }
            .simple-base-item { display: flex; flex-direction: row; justify-content: space-between; align-items: center; height: 31px; padding: 0 10px; overflow: visible; }
            .simple-base-item.sub { padding-left: 24px; }
            .simple-base-item > .title { display: flex; flex: 1 1 0%; align-items: center; overflow: visible; }
            .simple-base-item .title-txt { display: flow-root; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .simple-base-item > .stats { display: block; flex: 0 0 auto; margin-left: 10px; }
            .generic-list .video-pod__item { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; }
            .generic-list .title-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .generic-list .duration { flex: 0 0 auto; }
            .video-pod__list.grid { display: flex; gap: 6px; }
            .video-pod__list.grid .video-pod__item.page { width: 64px; height: 36px; display: flex; align-items: center; justify-content: center; }
            .bpx-player-ctrl-eplist-multi-menu-item { display: flex; align-items: center; width: 280px; height: 32px; }
        </style>
        <div class="pod-box video-pod__list multip list">
            <div class="simple-base-item video-pod__item normal" data-key="1001"><div class="title"><div class="title-txt">短标题</div></div><div class="stats"><div class="stat-item duration">02:44</div></div></div>
            <div class="simple-base-item video-pod__item normal" data-key="1002"><div class="title"><div class="title-txt">这是一个非常非常非常长而且没有空格的测试视频标题WWWWWWWWWWWWWWWWWW</div></div><div class="stats"><div class="stat-item duration">22:30</div></div></div>
            <div class="simple-base-item video-pod__item normal" data-key="1003"><div class="title"><div class="title-txt">第三集标题</div></div><div class="stats"><div class="stat-item duration">33:01</div></div></div>
        </div>
        <div class="pod-box video-pod__list section">
            <div class="pod-item video-pod__item simple" data-key="BV0000000002">
                <div class="single-p"><div class="simple-base-item normal"><div class="title"><div class="title-txt">合集单P视频</div></div><div class="stats"><div class="stat-item duration">12:34</div></div></div></div>
            </div>
            <div class="pod-item video-pod__item simple" data-key="BV0000000001">
                <div class="multi-p">
                    <div class="simple-base-item head"><div class="title"><div class="title-txt">合集多P折叠头</div></div><div class="stats"><div class="stat-item expand-btn"></div></div></div>
                    <div class="page-list">
                        <div class="simple-base-item page-item sub"><div class="title"><div class="title-txt">第一部无印：石英联盟</div></div><div class="stats"><div class="stat-item duration">34:20</div></div></div>
                        <div class="simple-base-item page-item sub"><div class="title"><div class="title-txt">超长无空格合集子标题MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM</div></div><div class="stats"><div class="stat-item duration">22:30</div></div></div>
                        <div class="simple-base-item page-item sub"><div class="title"><div class="title-txt">第三部钻石与珍珠：神奥地区-上</div></div><div class="stats"><div class="stat-item duration">23:52</div></div></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="pod-box generic-list video-pod__list">
            <div class="video-pod__item" data-key="BV0000000004"><div class="title-txt">通用带duration条目</div><span class="duration">05:12</span></div>
            <div class="video-pod__item" data-key="BV0000000003"><div class="title"><div class="title-txt">无时长仅title降级</div></div></div>
            <div class="video-pod__item" data-key="BV0000000005"><span class="title-txt">极简无title无时长降级</span></div>
        </div>
        <div class="pod-box video-pod__list multip grid">
            <div class="video-pod__item page" data-key="1001">1</div>
        </div>
        <ul class="bpx-player-ctrl-eplist-multi-menu">
            <li class="bpx-player-ctrl-eplist-multi-menu-item" data-cid="1001"><span class="bpx-player-ctrl-eplist-multi-menu-item-text">短标题</span></li>
        </ul>
        <div class="action-list-item-wrap" data-key="BV0000000006">
            <div class="cover"><div class="cover-img"><img alt="cover"></div></div>
            <div class="info"><div class="title">播单图文条目</div></div>
        </div>`;
        testAPI.EpisodeResolver._invalidateItemsCache();
        document.querySelectorAll('.video-pod__item[data-key], .video-pod__list.section .simple-base-item.page-item, .bpx-player-ctrl-eplist-multi-menu-item[data-cid], .action-list-item-wrap[data-key]')
            .forEach(el => watcher.processPlaylistItem(el));
    });

    const placementCheck = await page.evaluate(() => {
        const multipRows = [...document.querySelectorAll('.video-pod__list.multip.list .simple-base-item')];
        const singleRow = document.querySelector('.video-pod__list.section .single-p > .simple-base-item.normal');
        const headRow = document.querySelector('.video-pod__list.section .multi-p > .simple-base-item.head');
        const pageRows = [...document.querySelectorAll('.video-pod__list.section .simple-base-item.page-item')];
        const genericDuration = document.querySelector('.generic-list .video-pod__item[data-key="BV0000000004"]');
        const fallbackTitle = document.querySelector('.generic-list .video-pod__item[data-key="BV0000000003"]');
        const fallbackBare = document.querySelector('.generic-list .video-pod__item[data-key="BV0000000005"]');
        const gridItem = document.querySelector('.video-pod__list.grid .video-pod__item.page');
        const playerItem = document.querySelector('.bpx-player-ctrl-eplist-multi-menu-item');
        const actionItem = document.querySelector('.action-list-item-wrap');

        const checkBefore = (row, anchorSel) => {
            const tag = row.querySelector('.bvh-episode-tag');
            const anchor = row.querySelector(anchorSel);
            return Boolean(tag && anchor && tag.parentNode === row && tag.nextElementSibling === anchor && !row.querySelector('.title-txt .bvh-episode-tag'));
        };

        return {
            multipBeforeStats: multipRows.every(row => checkBefore(row, ':scope > .stats')),
            singleBeforeStats: checkBefore(singleRow, ':scope > .stats'),
            headUntagged: headRow.querySelectorAll('.bvh-episode-tag').length === 0,
            pageBeforeStats: pageRows.every(row => checkBefore(row, ':scope > .stats')),
            genericBeforeDuration: checkBefore(genericDuration, ':scope > .duration'),
            fallbackTitleOk: fallbackTitle.querySelector(':scope > .title > .bvh-episode-tag') !== null,
            fallbackBareOk: fallbackBare.querySelector(':scope > .bvh-episode-tag') !== null && !fallbackBare.querySelector('.title-txt .bvh-episode-tag'),
            gridOk: gridItem.querySelector(':scope > .bvh-episode-tag.bvh-episode-tag-grid') !== null,
            playerOk: playerItem.querySelector(':scope > .bvh-episode-tag') !== null && Boolean(playerItem.style.getPropertyValue('--bvh-episode-label-space')),
            actionOk: actionItem.querySelector('.cover-img > .bvh-action-list-cover-tag') !== null && actionItem.querySelectorAll('.bvh-episode-tag').length === 0
        };
    });
    assert.deepEqual(placementCheck, {
        multipBeforeStats: true,
        singleBeforeStats: true,
        headUntagged: true,
        pageBeforeStats: true,
        genericBeforeDuration: true,
        fallbackTitleOk: true,
        fallbackBareOk: true,
        gridOk: true,
        playerOk: true,
        actionOk: true
    });
    console.log('通过：纯分 P、合集单 P、合集子 P、通用带时长、无时长降级与非文字列表边界全部符合预期');

    // 验证稳定态零 DOM 写入、.stats 延后插入及标签错位/移除自愈
    const selfHeal = await page.evaluate(async () => {
        const row = document.querySelector('.video-pod__list.section .simple-base-item.page-item');
        const originalTag = row.querySelector('.bvh-episode-tag');
        let stableChanges = 0;
        const observer = new MutationObserver(entries => { stableChanges += entries.length; });
        observer.observe(row, { subtree: true, childList: true });
        watcher.processPlaylistItem(row);
        watcher.processPlaylistItem(row);
        await Promise.resolve();
        observer.disconnect();
        const sameStable = originalTag === row.querySelector('.bvh-episode-tag');

        // 模拟 .stats 延后出现：先无 .stats 渲染，后补 .stats 再刷新
        const lateItem = document.createElement('div');
        lateItem.className = 'simple-base-item page-item sub';
        lateItem.innerHTML = '<div class="title"><div class="title-txt">延迟时长分 P</div></div>';
        document.querySelector('.video-pod__list.section .page-list').append(lateItem);
        watcher.processPlaylistItem(lateItem);
        const beforeStatsInTitle = lateItem.querySelector(':scope > .title > .bvh-episode-tag') !== null;
        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.innerHTML = '<div class="stat-item duration">11:11</div>';
        lateItem.append(stats);
        watcher.processPlaylistItem(lateItem);
        const afterStatsBefore = lateItem.querySelector(':scope > .bvh-episode-tag')?.nextElementSibling === stats
            && lateItem.querySelectorAll('.bvh-episode-tag').length === 1;

        // 模拟外部将标签移回 .title 内，再刷新应自动纠正
        lateItem.querySelector(':scope > .title').append(lateItem.querySelector('.bvh-episode-tag'));
        watcher.processPlaylistItem(lateItem);
        const healedFromMisplaced = lateItem.querySelector(':scope > .bvh-episode-tag')?.nextElementSibling === stats
            && lateItem.querySelectorAll('.bvh-episode-tag').length === 1;
        lateItem.remove();
        return { sameStable, stableChanges, beforeStatsInTitle, afterStatsBefore, healedFromMisplaced };
    });
    assert.deepEqual(selfHeal, {
        sameStable: true,
        stableChanges: 0,
        beforeStatsInTitle: true,
        afterStatsBefore: true,
        healedFromMisplaced: true
    });
    console.log('通过：带时长列表重复刷新零 DOM 写入，.stats 延后出现与标签错位自动校正');

    // 验证经典标签（默认与 16px 大字号）与 SVG 圆环（27px/36px）在短/超长标题下的几何对齐
    const geometryModes = [
        { name: '经典默认', config: { episodeStyle: 'label', episodeFontSize: 10, episodePadding: 4, episodeLabelMode: 'full' } },
        { name: '经典16px完整', config: { episodeStyle: 'label', episodeFontSize: 16, episodePadding: 8, episodeLabelMode: 'full' } },
        { name: '经典16px精简', config: { episodeStyle: 'label', episodeFontSize: 16, episodePadding: 6, episodeLabelMode: 'compact' } },
        { name: 'SVG圆环27px', config: { episodeStyle: 'ring', episodeRingSize: 27 } },
        { name: 'SVG圆环36px', config: { episodeStyle: 'ring', episodeRingSize: 36 } }
    ];
    for (const mode of geometryModes) {
        const metrics = await page.evaluate(cfg => {
            Object.assign(testAPI.CONFIG, testAPI.DEFAULT_CONFIG, cfg);
            const rows = [
                ...document.querySelectorAll('.video-pod__list.multip.list .simple-base-item'),
                ...document.querySelectorAll('.video-pod__list.section .simple-base-item.page-item')
            ];
            rows.forEach(row => watcher.processPlaylistItem(row));
            const measure = list => list.map(row => {
                const rr = row.getBoundingClientRect();
                const tr = row.querySelector(':scope > .title').getBoundingClientRect();
                const tag = row.querySelector(':scope > .bvh-episode-tag');
                const gr = tag.getBoundingClientRect();
                const sr = row.querySelector(':scope > .stats').getBoundingClientRect();
                return {
                    tagRight: Math.round(gr.right - rr.left),
                    statsLeft: Math.round(sr.left - rr.left),
                    gap: Math.round(sr.left - gr.right),
                    titleGap: Math.round(gr.left - tr.right),
                    noOverflow: sr.right <= rr.right + 1,
                    tagWidth: Math.round(gr.width),
                    tagHeight: Math.round(gr.height),
                    isRing: tag.classList.contains('bvh-tag-ring')
                };
            });
            return {
                multip: measure([...document.querySelectorAll('.video-pod__list.multip.list .simple-base-item')]),
                sectionPages: measure([...document.querySelectorAll('.video-pod__list.section .simple-base-item.page-item')])
            };
        }, mode.config);
        for (const [groupName, rows] of Object.entries(metrics)) {
            const firstRight = rows[0].tagRight;
            for (const row of rows) {
                assert.equal(row.noOverflow, true, `${mode.name}/${groupName} 不应溢出列表行: ${JSON.stringify(row)}`);
                assert(Math.abs(row.tagRight - firstRight) <= 1, `${mode.name}/${groupName} 同列表标签右边缘应对齐: ${JSON.stringify(rows)}`);
                assert(row.gap >= 8 && row.gap <= 12, `${mode.name}/${groupName} 标签与时长间距应稳定: ${JSON.stringify(row)}`);
                assert(row.titleGap >= 5, `${mode.name}/${groupName} 标题与标签不应重叠: ${JSON.stringify(row)}`);
                if (row.isRing) assert.equal(row.tagWidth, row.tagHeight, `${mode.name}/${groupName} 圆环不应被压扁`);
            }
        }
    }
    console.log('通过：经典标签（默认/16px 完整与精简）与 SVG 圆环（27px/36px）在短/超长标题下均对齐时长左侧且无溢出');
} finally {
    await browser.close();
}
