import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { instrument, source } from './harness.mjs';

const modes = [['优化版', source]];
if (process.env.BVH_BASELINE_REVISION) modes.unshift(['基线', execFileSync('git', ['show', `${process.env.BVH_BASELINE_REVISION}:scripts/Bilibili视频观看历史记录.js`], { encoding: 'utf8' })]);
const counts = (process.env.BVH_MAINTENANCE_COUNTS || '10000,50000').split(',').map(Number);
const browser = await chromium.launch({ headless: true }), reports = [];
try {
    for (const count of counts) for (const [mode, code] of modes) {
        const context = await browser.newContext(), page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><title>后台整理大数据夹具</title></head><body></body></html>' }));
            await page.goto('https://www.bilibili.com/video/BV0000000001');
            await page.evaluate(() => {
                const values = new Map(), bytes = new Map();
                window.ioStats = { reads: 0, writes: 0, readBytes: 0, writeBytes: 0, storageMutations: 0 };
                const dataKey = key => /^bvh_(tx|checkpoint)_/.test(key);
                window.GM_getValue = (key, fallback) => {
                    if (dataKey(key)) { ioStats.reads++; ioStats.readBytes += bytes.get(key) || 0; }
                    return values.has(key) ? structuredClone(values.get(key)) : fallback;
                };
                window.GM_setValue = (key, value) => {
                    const size = new TextEncoder().encode(JSON.stringify(value)).length;
                    if (dataKey(key)) { ioStats.writes++; ioStats.writeBytes += size; }
                    values.set(key, structuredClone(value)); bytes.set(key, size);
                };
                window.GM_deleteValue = key => { values.delete(key); bytes.delete(key); };
                window.GM_listValues = () => [...values.keys()];
                window.GM = { getValue: async (...args) => GM_getValue(...args), setValue: async (...args) => { ioStats.storageMutations++; GM_setValue(...args); },
                    listValues: async () => GM_listValues(), deleteValue: async key => { ioStats.storageMutations++; GM_deleteValue(key); },
                    getValues: async keys => Object.fromEntries(keys.map(key => [key, GM_getValue(key)])),
                    setValues: async values => { ioStats.storageMutations++; for (const [key, value] of Object.entries(values)) GM_setValue(key, value); },
                    deleteValues: async keys => { ioStats.storageMutations++; for (const key of keys) GM_deleteValue(key); } };
                window.GM_addStyle = css => { const el = document.createElement('style'); el.textContent = css; document.head.append(el); };
                window.GM_info = { script: { version: 'test' }, scriptHandler: '结构化复制存储夹具' };
                window.unsafeWindow = window; window.maintenanceCompleted = 0; window.warnings = [];
            });
            await page.evaluate(instrument(code));
            await page.evaluate(async count => {
                const { StorageManager: s, VideoPlayerObserver, EpisodeResolver, Utils } = testAPI;
                Utils.log = (...args) => { if (args[0] === '历史后台分组整理完成') maintenanceCompleted++; };
                Utils.warn = (...args) => warnings.push(args.map(arg => arg?.message || String(arg)).join(' '));
                const entries = Array.from({ length: count }, (_, i) => ({ key: `BV${String(i + 1).padStart(10, '0')}${(i + 1) % 20 === 0 ? '?p=2' : ''}`,
                    version: [1700000000000 + i, 'seed', i + 1], deleted: false, source: 'import',
                    record: { s: 1, t: '05:00', p: 50, a: 1700000000, n: `合成视频 ${i + 1} ` + '大数据后台维护'.repeat(40) } }));
                const transaction = await s._store.prepare(entries);
                for (const block of transaction.blocks) GM_setValue(block.key, block.value);
                GM_setValue(transaction.key, transaction.manifest);
                // 沿真实视频页的局部初始化启动两秒后自动整理，不关闭调度器。
                await s.initializeForKeys(['BV0000000001']);
                EpisodeResolver.getCurrentKey = () => 'BV0000000001'; EpisodeResolver.getLatestRecord = () => null;
                window.media = Object.assign(new EventTarget(), { readyState: 1, currentTime: 30, duration: 10000, currentSrc: 'synthetic', paused: false });
                window.player = new VideoPlayerObserver(); player.bvId = EpisodeResolver.getCurrentKey(); player.getCurrentVideo = () => media;
                testAPI.UIComponent.showViewPanel(s.getRecord(player.bvId), player.bvId);
                player.bindVideo(media); player.hasPlayed = true; player.startVideoWatch();
                window.mediaClock = setInterval(() => { media.currentTime++; media.dispatchEvent(new Event('timeupdate')); }, 100);
                window.heartbeats = 0; window.uiClock = setInterval(() => heartbeats++, 50);
                Object.assign(ioStats, { reads: 0, writes: 0, readBytes: 0, writeBytes: 0, storageMutations: 0 });
            }, count);
            const cdp = await context.newCDPSession(page);
            await cdp.send('HeapProfiler.collectGarbage');
            const baseline = (await cdp.send('Runtime.getHeapUsage')).usedSize;
            await page.waitForFunction(() => !!testAPI.StorageManager._maintenance, null, { timeout: 120000 });
            const started = performance.now(); let peak = baseline, foregroundMs;
            const foreground = page.evaluate(async () => {
                media.currentTime++; const started = performance.now(); await player.saveProgress(); return performance.now() - started;
            });
            if (mode === '优化版') {
                await page.waitForFunction(() => testAPI.StorageManager._maintenanceStats?.waitingForForeground);
                await foreground;
                const paused = await page.evaluate(() => ({ rewritten: testAPI.StorageManager._maintenanceStats.rewrittenEntries,
                    saves: testAPI.VideoPlayerObserver.metrics.completed }));
                assert.equal(paused.rewritten, 0, '播放期间后台仍在重写历史'); assert(paused.saves > 0, '前台保存被后台阻塞');
                await page.evaluate(async () => { clearInterval(mediaClock); media.paused = true; media.dispatchEvent(new Event('pause'));
                    await player._saveTask; await testAPI.StorageManager._queue; });
            }
            for (;;) {
                peak = Math.max(peak, (await cdp.send('Runtime.getHeapUsage')).usedSize);
                const running = await page.evaluate(() => !!testAPI.StorageManager._maintenance);
                if (!running) break;
                assert(performance.now() - started < 180000, `${mode}后台整理超时`);
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            foregroundMs = await foreground;
            const elapsedMs = Math.round(performance.now() - started);
            await page.evaluate(async () => { clearInterval(mediaClock); clearInterval(uiClock); player.capture(); player.destroy(); await player._saveTask; await testAPI.StorageManager._queue; });
            await cdp.send('HeapProfiler.collectGarbage');
            const settled = (await cdp.send('Runtime.getHeapUsage')).usedSize;
            const state = await page.evaluate(() => ({ io: ioStats, completed: maintenanceCompleted, warnings, heartbeats,
                stats: testAPI.StorageManager._maintenanceStats || null, ready: !!testAPI.StorageManager._ready,
                queued: testAPI.StorageManager._queuedWrites, saves: testAPI.VideoPlayerObserver.metrics.completed }));
            assert(state.completed >= 1, state.warnings.join('\n'));
            assert.equal(state.ready, false); assert.equal(state.queued || 0, 0);
            assert(state.saves > 0 && state.heartbeats > 0); assert.deepEqual(errors, []);
            if (mode === '优化版') {
                assert.equal(state.stats.phase, '完成');
                assert(state.stats.maxBufferedEntries <= 2048); assert(state.stats.maxBufferedBytes <= 2 * 1024 * 1024);
            }
            const total = await page.evaluate(async () => { const audit = new testAPI.HistoryCommitStore(); await audit.sync(); return [...audit.entries.values()].filter(entry => !entry.deleted).length; });
            assert.equal(total, count, '整理和并发播放后记录数量发生变化');
            const report = { mode, count, elapsedMs, foregroundMs: Math.round(foregroundMs),
                baselineMiB: +(baseline / 1048576).toFixed(1), peakMiB: +(peak / 1048576).toFixed(1), settledMiB: +(settled / 1048576).toFixed(1), ...state };
            reports.push(report); console.log(JSON.stringify(report));
            if (mode === '优化版' && count >= 50000) {
                await page.evaluate(async () => {
                    const s = testAPI.StorageManager;
                    if (s._maintenance) await s._maintenance;
                    clearTimeout(s._compactionTimer); s._compactionTimer = null;
                    // 模拟其他页面持续保存同一视频，达到真实后台整理阈值。
                    for (let i = 0; i < 128; i++) {
                        const tx = await s._store.prepare([{ key: 'BV0000000001', version: s.sampleVersion(), deleted: false,
                            record: { s: 1, t: '08:00', p: 80, a: 1700000000, n: '增量更新' } }]);
                        for (const block of tx.blocks) GM_setValue(block.key, block.value);
                        GM_setValue(tx.key, tx.manifest);
                    }
                    Object.assign(ioStats, { reads: 0, writes: 0, readBytes: 0, writeBytes: 0, storageMutations: 0 });
                    s._scheduleCompaction();
                });
                await cdp.send('HeapProfiler.collectGarbage');
                const initial = (await cdp.send('Runtime.getHeapUsage')).usedSize;
                await page.waitForFunction(() => !!testAPI.StorageManager._maintenance);
                const incrementalStarted = performance.now(); let incrementalPeak = initial;
                for (;;) {
                    incrementalPeak = Math.max(incrementalPeak, (await cdp.send('Runtime.getHeapUsage')).usedSize);
                    if (!await page.evaluate(() => !!testAPI.StorageManager._maintenance)) break;
                    assert(performance.now() - incrementalStarted < 60000, '增量后台整理超时');
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                const incrementalMs = Math.round(performance.now() - incrementalStarted);
                await cdp.send('HeapProfiler.collectGarbage');
                const finalHeap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
                const increment = await page.evaluate(() => ({ stats: testAPI.StorageManager._maintenanceStats, io: ioStats }));
                assert.equal(increment.stats.phase, '完成'); assert.equal(increment.stats.groupsTotal, 1);
                assert.equal(increment.stats.rewrittenEntries, 1); assert(increment.stats.scannedEntries < count / 4);
                assert(finalHeap - initial < 4 * 1048576, '增量整理结束后保留了大批额外数据');
                console.log(JSON.stringify({ mode: '五万条历史增量整理', elapsedMs: incrementalMs,
                    baselineMiB: +(initial / 1048576).toFixed(1), peakMiB: +(incrementalPeak / 1048576).toFixed(1), settledMiB: +(finalHeap / 1048576).toFixed(1), ...increment }));
            }
        } finally { await context.close(); }
    }
    console.log('通过：大数据量下自动后台整理实际启动并完成，持续播放和界面定时器可运行，全部记录完整');
} finally { await browser.close(); }
