import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>合成播放页</title></head><body></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        const values = new Map();
        window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
        window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
        window.GM_deleteValue = key => values.delete(key); window.GM_listValues = () => [...values.keys()];
        window.holdWrites = false; window.blocked = false;
        window.GM = { getValue: async (...args) => GM_getValue(...args), listValues: async () => GM_listValues(),
            deleteValue: async key => GM_deleteValue(key), setValue: async (key, value) => {
                if (holdWrites && key.startsWith('bvh_tx_')) { window.blocked = true; await new Promise(resolve => { window.releaseWrite = resolve; }); }
                GM_setValue(key, value);
            } };
        window.GM_addStyle = css => { const el = document.createElement('style'); el.textContent = css; document.head.append(el); };
        window.GM_info = { script: { version: 'test' }, scriptHandler: '合成慢存储' };
        window.unsafeWindow = window;
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { StorageManager: s, VideoPlayerObserver, EpisodeResolver, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[name] = () => {};
        await s.initialize(); clearTimeout(s._compactionTimer); s._compactionTimer = null;
        s._scheduleCompaction = () => {};
        await s.importRecords(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`BV${String(i + 1).padStart(10, '0')}`,
            { status: '已观看', currentTime: '05:00', percent: '50%', title: '合成记录', savedAt: '2026-09-06 08:00:00' }])));
        EpisodeResolver.getCurrentKey = () => 'BV0000000001'; EpisodeResolver.getLatestRecord = () => null;
        window.media = Object.assign(new EventTarget(), { readyState: 1, currentTime: 30, duration: 10000, currentSrc: 'synthetic', paused: false });
        window.player = new VideoPlayerObserver(); player.bvId = EpisodeResolver.getCurrentKey();
        testAPI.UIComponent.showViewPanel(s.getRecord(player.bvId), player.bvId);
        player.getCurrentVideo = () => media; player.bindVideo(media); player.hasPlayed = true;
        await s._queue;
        holdWrites = true; window.saving = player.saveProgress();
    });
    await page.waitForFunction(() => blocked);
    await page.evaluate(() => { media.currentTime = 31; player.capture(); holdWrites = false; releaseWrite(); });
    await page.evaluate(() => saving);
    assert.equal(await page.locator('#bvh-view-panel [data-float-time]').innerText(), '00:30');
    console.log('通过：真实悬浮入口在慢存储确认后刷新，继续播放不会阻止已保存进度显示');

    const cdp = await page.context().newCDPSession(page), heaps = [];
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    heaps.push(await heap());
    for (let round = 0; round < 3; round++) {
        await page.evaluate(() => { holdWrites = true; blocked = false; media.currentTime += 1; window.saving = player.saveProgress(); });
        await page.waitForFunction(() => blocked);
        const pending = await page.evaluate(() => {
            for (let i = 0; i < 1000; i++) { media.currentTime += 1; player.saveProgress(); }
            return { queuedWrites: testAPI.StorageManager._queuedWrites, active: testAPI.VideoPlayerObserver.metrics.activeSaves,
                pending: !!player._pendingSnapshot, latest: player._lastKnownState.value.currentTime };
        });
        assert.equal(pending.queuedWrites, 1); assert.equal(pending.active, 1); assert.equal(pending.pending, true);
        await page.evaluate(() => { holdWrites = false; releaseWrite(); });
        await page.evaluate(() => saving);
        assert.equal(await page.locator('#bvh-view-panel [data-float-time]').innerText(), pending.latest);
        heaps.push(await heap());
    }
    const state = await page.evaluate(() => ({ metrics: testAPI.VideoPlayerObserver.metrics, queued: testAPI.StorageManager._queuedWrites,
        commits: testAPI.StorageManager._store.commits.size, pending: !!player._pendingSnapshot, saving: !!player._saveTask }));
    assert.equal(state.metrics.activeSaves, 0); assert.equal(state.queued, 0); assert.equal(state.pending, false); assert.equal(state.saving, false);
    assert.equal(state.metrics.completed, 7); assert(state.commits < 12);
    assert(Math.max(...heaps) - heaps[0] < 3 * 1024 * 1024, `回收后堆内存持续增长：${heaps}`);
    console.log('通过：5000 条历史下连续 3000 次保存请求仅提交 7 次，队列及缓存有界，GC 后堆内存样本', heaps);
    await page.evaluate(() => player.destroy()); assert.deepEqual(errors, []);
} finally { await browser.close(); }
