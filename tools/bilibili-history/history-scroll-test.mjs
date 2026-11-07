import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

// 本地合成管理面板：沿真实数据变更订阅测试后台刷新、排序和滚动。
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://www.bilibili.com/');
    await page.evaluate(() => {
        const values = new Map();
        window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
        window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
        window.GM_deleteValue = key => values.delete(key); window.GM_listValues = () => [...values.keys()];
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        window.GM_info = { script: { version: 'test' } }; window.unsafeWindow = window;
    });
    await page.evaluate(instrument());
    await page.evaluate(async () => {
        const { StorageManager: s, HistoryQueries: queries, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) Utils[name] = () => {};
        await s.initialize();
        const rows = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`BV${String(index + 1).padStart(10, '0')}`, {
            title: `合成记录 ${String(index + 1).padStart(3, '0')}`, status: '已观看', currentTime: '05:00', percent: '50%',
            savedAt: new Date(Date.UTC(2026, 10, 8, 0, 0, 0) - index * 1000).toISOString()
        }]));
        await s.importRecords(rows);
        window.holdQuery = false; window.failQuery = false; window.queryBlocked = false;
        const query = queries.query.bind(queries);
        queries.query = async (...args) => {
            if (holdQuery) { window.queryBlocked = true; await new Promise(resolve => { window.releaseQuery = resolve; }); }
            if (failQuery) throw new Error('模拟后台查询失败');
            return query(...args);
        };
        window.panel = testAPI.HistoryManagerPanel.show({ activeTab: 'history' });
        window.saveProgress = async (key, percent, savedAt) => {
            await s.saveRecord(key, { ...s.getRecord(key), percent: `${percent}%`, ...(savedAt ? { savedAt } : {}) });
        };
        window.rememberReading = () => {
            const table = panel.q('.bvh-table-scroll'), top = table.getBoundingClientRect().top;
            const visibleTop = top + table.querySelector('thead').getBoundingClientRect().height;
            const row = [...table.querySelector('tbody').children].find(row => row.getBoundingClientRect().bottom > visibleTop);
            window.reading = { table, row, key: row.dataset.historyKey, offset: row.getBoundingClientRect().top - top,
                left: table.scrollLeft, contentTop: panel.q('.bvh-content').scrollTop };
        };
    });
    await page.waitForFunction(() => panel.pageRows?.length === 20 && panel.q('tbody'));
    await page.locator('[data-page-size]').selectOption('100');
    await page.evaluate(() => {
        const table = panel.q('.bvh-table-scroll'); table.scrollTop = 1100;
        const row = [...table.querySelector('tbody').children].find(row => row.getBoundingClientRect().top > table.getBoundingClientRect().top + 50);
        const checkbox = row.querySelector('[data-select]'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        checkbox.focus({ preventScroll: true }); window.focused = checkbox; rememberReading(); holdQuery = true;
    });
    await page.evaluate(() => saveProgress('BV0000000090', 61, '2026-11-08 12:00:00'));
    await page.waitForFunction(() => queryBlocked);
    assert.equal(await page.evaluate(() => reading.table === panel.q('.bvh-table-scroll')), true, '查询等待期间不能把表格替换成加载提示');
    await page.evaluate(() => { reading.table.scrollTop += 150; rememberReading(); holdQuery = false; releaseQuery(); });
    await page.waitForFunction(() => panel.pageRows[0]?.key === 'BV0000000090');
    const checkReading = async () => {
        const result = await page.evaluate(() => ({ sameTable: reading.table === panel.q('.bvh-table-scroll'),
            connected: reading.row.isConnected, drift: reading.row.getBoundingClientRect().top - reading.table.getBoundingClientRect().top - reading.offset,
            focus: document.activeElement === focused, checked: focused.checked, selected: panel.selected.has(focused.dataset.select) }));
        assert.equal(result.sameTable, true); assert.equal(result.connected, true);
        assert(Math.abs(result.drift) <= 1, JSON.stringify(result));
        assert.equal(result.focus, true); assert.equal(result.checked, true); assert.equal(result.selected, true);
    };
    await checkReading();
    for (const percent of [62, 63]) {
        await page.evaluate(percent => saveProgress('BV0000000090', percent), percent);
        await page.waitForFunction(percent => panel.q('tbody tr .bvh-progress-number')?.textContent === `${percent}%`, percent);
        await checkReading();
    }
    // 更新有焦点的记录并改变其排序位置，也不能让列表或焦点跳回顶部。
    await page.evaluate(() => saveProgress(focused.dataset.select, 70, '2026-11-08 13:00:00'));
    await page.waitForFunction(() => panel.pageRows[0]?.key === focused.dataset.select);
    await checkReading();
    console.log('通过：后台查询等待保留表格，等待时继续滚动生效，连续更新／排序变化保留阅读行、勾选及焦点');

    await page.evaluate(() => { failQuery = true; });
    await page.evaluate(() => saveProgress('BV0000000090', 64));
    await page.waitForFunction(() => document.querySelector('.bvh-toast')?.textContent.includes('模拟后台查询失败'));
    await checkReading();
    await page.evaluate(() => { failQuery = false; });
    await page.evaluate(() => saveProgress('BV0000000090', 65));
    await page.waitForFunction(() => [...panel.q('tbody').children].find(row => row.dataset.historyKey === 'BV0000000090')
        ?.querySelector('.bvh-progress-number').textContent === '65%');
    await checkReading();
    console.log('通过：后台查询失败仍保留当前列表和位置，下一次更新可正常恢复');

    await page.locator('[data-action=next]').click();
    assert.equal(await page.evaluate(() => panel.state.page), 2);
    assert.equal(await page.locator('.bvh-table-scroll').evaluate(el => el.scrollTop), 0);
    await page.locator('[data-action=prev]').click();
    assert.equal(await page.evaluate(() => panel.state.page), 1);
    assert.equal(await page.locator('.bvh-table-scroll').evaluate(el => el.scrollTop), 0);
    await page.locator('[data-query]').fill('合成记录 050');
    await page.waitForFunction(() => panel.pageRows?.length === 1 && panel.pageRows[0].key === 'BV0000000050');
    assert.equal(await page.locator('.bvh-table-scroll').evaluate(el => el.scrollTop), 0);
    await page.locator('[data-action=clear-query]').click();
    await page.waitForFunction(() => panel.pageRows?.length === 100);
    await page.locator('[data-filter=sort]').selectOption('title-asc');
    await page.waitForFunction(() => panel.pageRows?.[0].key === 'BV0000000001');
    await page.locator('[data-page-size]').selectOption('50');
    assert.equal(await page.locator('.bvh-table-scroll').evaluate(el => el.scrollTop), 0);
    console.log('通过：主动翻页、搜索、筛选和修改每页数量仍从顶部显示新结果');

    await page.setViewportSize({ width: 390, height: 780 });
    await page.evaluate(() => {
        const table = panel.q('.bvh-table-scroll'); table.scrollTop = 500; table.scrollLeft = 120;
        panel.q('.bvh-content').scrollTop = 100;
        const row = [...table.querySelector('tbody').children].find(row => row.getBoundingClientRect().top > table.getBoundingClientRect().top + 50);
        window.focused = row.querySelector('[data-select]'); focused.checked = true; focused.dispatchEvent(new Event('change', { bubbles: true }));
        focused.focus({ preventScroll: true }); rememberReading();
    });
    await page.evaluate(() => saveProgress('BV0000000001', 83));
    await page.waitForFunction(() => panel.q('tbody .bvh-progress-number')?.textContent === '83%');
    await checkReading();
    assert.equal(await page.evaluate(() => reading.table.scrollLeft === reading.left), true);
    assert.equal(await page.evaluate(() => panel.q('.bvh-content').scrollTop === reading.contentTop), true);
    console.log('通过：窄屏保留表格横向／纵向滚动及外层内容滚动');
    await page.evaluate(() => panel.dispose());
    assert.deepEqual(errors, []);
} finally { await browser.close(); }
