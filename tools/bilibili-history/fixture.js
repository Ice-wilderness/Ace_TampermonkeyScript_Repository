(async () => {
    window.addEventListener('error', event => {
        document.documentElement.dataset.fixtureError = JSON.stringify({ message: event.message, source: event.filename, stack: event.error?.stack });
    });
    // 独立 iframe 提供真实 CSS 视口，不依赖桌面应用是否接受窗口尺寸覆盖。
    const frameParams = new URL(location.href).searchParams;
    if (frameParams.has('frame')) {
        const width = Number(frameParams.get('frame')), height = Number(frameParams.get('height'));
        if (![390, 1024, 1440].includes(width) || ![844, 768, 900].includes(height)) throw new Error('非法验收尺寸');
        frameParams.delete('frame'); frameParams.delete('height');
        const frame = document.createElement('iframe'); frame.title = '指定尺寸管理面板验收';
        frame.width = width; frame.height = height; frame.style.cssText = 'display:block;border:0';
        document.body.style.cssText = 'margin:0;padding:0'; document.body.replaceChildren(frame);
        frame.src = '/?' + frameParams;
        frame.onload = () => {
            let attempts = 0;
            const timer = setInterval(() => {
                if (++attempts > 500) { clearInterval(timer); return; }
                if (!frame.contentDocument.querySelector('#fixture-results[data-ready=true]')) return;
                clearInterval(timer);
                const shell = frame.contentDocument.querySelector('.bvh-shell');
                document.body.dataset.frameLoaded = 'true';
                document.body.dataset.geometry = JSON.stringify({ width: frame.contentWindow.innerWidth, height: frame.contentWindow.innerHeight, shellWidth: shell.clientWidth, scrollWidth: shell.scrollWidth });
            }, 20);
        };
        return;
    }
    const api = window.testAPI, report = document.getElementById('fixture-results');
    const count = Number(new URL(location.href).searchParams.get('count') ?? 120);
    const seed = await (await fetch('/seed.json?count=' + count)).json();
    for (const [key, record] of Object.entries(seed)) {
        const shard = 'bvh_shard_' + api.StorageManager._getShardId(key);
        const data = fixtureData.get(shard) || {}; data[key] = api.StorageManager._compact(record); fixtureData.set(shard, data);
    }
    const scopedKey = new URL(location.href).searchParams.get('scope');
    const t0 = performance.now();
    if (scopedKey) await api.StorageManager.initializeForKeys([scopedKey]);
    else await api.StorageManager.initialize();
    const initTime = performance.now() - t0;
    const nativeStyle = () => ['backgroundColor', 'borderTopWidth', 'borderTopColor'].map(key => getComputedStyle(document.getElementById('native-button'))[key]).join('|');
    const nativeBefore = nativeStyle();
    api.injectStyles();
    document.getElementById('open-manager').onclick = () => api.UIComponent.showManagerPanel();
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const until = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(20); } throw new Error('等待界面状态超时'); };
    const run = async () => {
        const results = [];
        const test = async (name, fn) => { try { await fn(); results.push('通过：' + name); } catch (e) { results.push('失败：' + name + ' / ' + e.message); } report.textContent = results.join('\n'); };
        let panel;
        if (scopedKey) await test('当前视频局部读取，历史页按需升级完整视图', async () => {
            assert(api.StorageManager._ready === null && api.StorageManager._store.scope, '启动已经全量加载');
            assert(api.StorageManager.getAllKeys().length < count, '局部视图混入其他视频');
            const manager = api.HistoryManagerPanel.show({ activeTab: 'history' });
            await until(() => manager.filtered && manager.filtered.length === count);
            assert(api.StorageManager._store.scope === null && manager.filtered.length === count, '历史页未加载完整记录');
            manager.dispose();
        });
        await test('站点原生控件样式隔离', async () => {
            const p = api.HistoryManagerPanel.show();
            assert(nativeStyle() === nativeBefore, '面板样式污染站点按钮'); p.dispose();
        });
        await test('反复打开关闭 20 次释放订阅与滚动锁', async () => {
            api.HistoryManagerPanel.active?.dispose();
            const subscribers = api.StorageManager._changeCallbacks.size, overflow = document.body.style.overflow;
            for (let i = 0; i < 20; i++) { const p = api.HistoryManagerPanel.show(); p.dispose(); }
            assert(api.StorageManager._changeCallbacks.size === subscribers, '订阅泄漏');
            assert(document.body.style.overflow === overflow, '滚动状态未恢复');
        });
        await test('设置草稿、预览隔离、页签保留、阈值校验', async () => {
            panel = api.HistoryManagerPanel.show();
            const input = panel.q('[data-setting="showProgressBar"]'); input.click();
            assert(api.CONFIG.showProgressBar === true && panel.draft.showProgressBar === false, '草稿改变正式设置');
            assert(panel.q('[data-preview-bar]').hidden, '预览未更新');
            panel.q('[data-tab="history"]').click(); await until(() => panel.filtered);
            panel.q('[data-tab="settings"]').click(); assert(!panel.q('[data-setting="showProgressBar"]').checked, '切页丢草稿');
            const field = panel.q('[data-setting="highThreshold"]'); field.value = '1'; field.dispatchEvent(new Event('input', { bubbles: true }));
            assert(!await panel.save(), '非法阈值保存成功'); assert(api.CONFIG.highThreshold === 80, '校验失败污染设置');
            field.value = '80'; field.dispatchEvent(new Event('input', { bubbles: true }));
            assert(await panel.save(), '合法设置保存失败'); assert(api.CONFIG.showProgressBar === false, '正式设置未更新');
        });
        await test('设置保存失败保留输入，恢复默认不立即应用', async () => {
            panel.q('[data-action="defaults"]').click(); assert(api.CONFIG.showProgressBar === false, '默认值提前应用');
            fixtureFault = true; assert(!await panel.save(), '存储失败误报成功'); fixtureFault = false;
            assert(panel.draft.showProgressBar === true, '失败丢失草稿'); assert(await panel.save(), '重试失败');
        });
        await test('历史分页缓存、即时全选状态、搜索不失焦', async () => {
            panel.q('[data-tab="history"]').click(); await until(() => panel.q('[data-select-page]') || count === 0);
            if (!count) return;
            const build = api.HistoryQueries.metrics.builds, sorts = api.HistoryQueries.metrics.sorts;
            if (count > 20) { panel.q('[data-action="next"]').click(); panel.q('[data-action="prev"]').click(); }
            assert(api.HistoryQueries.metrics.builds === build && api.HistoryQueries.metrics.sorts === sorts, '翻页重新构建或排序');
            panel.q('[data-select]').click(); assert(panel.q('[data-select-page]').indeterminate, '全选未变部分选中');
            const search = panel.q('[data-query]'); search.focus(); search.value = '不存在的合成标题'; search.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => panel.q('[data-results]').textContent.includes('没有匹配'));
            assert(document.activeElement === search, '搜索丢失焦点'); panel.q('[data-action="clear-query"]').click(); await until(() => panel.q('[data-select-page]'));
        });
        await test('关闭确认的顶层 Escape 与焦点返回', async () => {
            panel.q('[data-tab="settings"]').click(); panel.q('[data-setting="showProgressBar"]').click();
            const close = panel.q('[data-close]'); close.focus(); close.click(); await until(() => document.querySelector('.bvh-confirm'));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay(0);
            assert(panel.root.isConnected && !document.querySelector('.bvh-confirm'), 'Escape 关闭了外层'); assert(document.activeElement === close, '焦点未返回');
            panel.q('[data-action="defaults"]').click(); await panel.save();
        });
        await test('统计三个范围与原公式一致', async () => {
            for (const days of [7, 30, 90]) {
                const actual = await api.HistoryQueries.stats(days), expected = api.StorageManager.getStatsBundle(days);
                assert(Object.keys(expected.cards).every(key => actual.counts[key] === expected.cards[key]), '计数不一致：' + days);
                assert(actual.days.length === days, '日期长度错误');
            }
        });
        await test('相同数据统计复用与大数据性能', async () => {
            const started = performance.now(); const rows = await api.HistoryQueries.query({ query: '合成', sort: 'percent-desc' });
            const searchTime = performance.now() - started;
            const statsStarted = performance.now();
            const first = await api.HistoryQueries.stats(30), second = await api.HistoryQueries.stats(30); assert(first === second, '统计未缓存');
            assert(rows.length === count, '搜索数量错误');
            const segment = Math.max(0, ...api.HistoryQueries.metrics.segments); assert(segment < 50, '计算段超过 50 ms：' + segment);
            results.push(`性能：${count} 条；初始化 ${initTime.toFixed(1)} ms；搜索 ${searchTime.toFixed(1)} ms；统计 ${(performance.now() - statsStarted).toFixed(1)} ms；最长查询计算段 ${segment.toFixed(1)} ms`);
        });
        await test('保留周期确认不受搜索限制，取消不写入', async () => {
            panel.q('[data-tab="history"]').click(); await until(() => panel.filtered);
            panel.q('[data-retention-value]').value = '1'; panel.q('[data-retention-unit]').value = 'days';
            const before = api.StorageManager.getAllKeys().length;
            if (count > 10) {
                const pending = panel.retention(); await until(() => document.querySelector('.bvh-confirm'));
                const text = document.querySelector('.bvh-confirm-message').textContent;
                assert(text.includes('保留最近 1天') && text.includes('截止时间') && text.includes('预计删除'), '确认缺少范围说明');
                document.querySelector('[data-choice="cancel"]').click(); await pending;
                assert(api.StorageManager.getAllKeys().length === before, '取消后仍删除');
            }
        });
        await test('真实 DOM 标记就地更新，进度条、透明度和提示同步', async () => {
            if (count < 2) return;
            const node = document.createElement('a'); node.href = 'https://www.bilibili.com/video/BV0000000002'; node.style.position = 'relative';
            node.innerHTML = '<img width="240" height="135" alt="合成封面">'; document.body.append(node);
            const watcher = Object.create(api.DOMWatcher.prototype);
            Object.assign(watcher, { isSkippedHeaderNode: () => false, isHeaderPopoverVideoLink: () => false, getHeaderPopoverCover: () => null, getRelatedKeysCached: base => api.StorageManager.getRelatedKeys(base) });
            watcher.processLink(node); const original = node.querySelector('.bvh-tag'); assert(original, '标签未生成');
            api.CONFIG.showProgressBar = false; api.CONFIG.tagOpacity = 55; api.CONFIG.tagPosition = 'bottom-right'; watcher.processLink(node);
            assert(node.querySelector('.bvh-tag') === original, '标签被重建'); assert(!node.querySelector('.bvh-progress-bar'), '进度条未隐藏');
            assert(original.style.opacity === '0.55' && original.style.right === '0px' && original.style.bottom === '0px', '样式未同步');
            Object.assign(api.CONFIG, api.DEFAULT_CONFIG); node.remove();
        });
        await test('删除失败反馈、成功撤销按钮及防重复执行', async () => {
            if (!count) return;
            panel.q('[data-tab="history"]').click(); await until(() => panel.q('[data-select-page]'));
            const key = api.StorageManager.getAllKeys()[0], before = api.StorageManager.getAllKeys().length;
            fixtureFault = true; await panel.deleteKeys([key], true); fixtureFault = false;
            assert(api.StorageManager.getAllKeys().length === before && !panel.busy, '失败后状态错误');
            await panel.deleteKeys([key], true); assert(api.StorageManager.getAllKeys().length === before - 1, '删除未提交');
            const undo = [...document.querySelectorAll('.bvh-toast button')].find(el => el.textContent === '撤销'); assert(undo, '缺少撤销按钮');
            panel.q('[data-tab="settings"]').focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
            assert(document.activeElement === undo, '面板焦点循环无法到达撤销按钮');
            undo.click(); undo.click(); await until(() => api.StorageManager.getAllKeys().length === before);
            assert(undo.disabled, '撤销未防重复执行');
        });
        await test('面板导入文件与导出内容往返', async () => {
            let fileInput, exported;
            const click = HTMLInputElement.prototype.click, anchorClick = HTMLAnchorElement.prototype.click, createURL = URL.createObjectURL;
            try {
                HTMLInputElement.prototype.click = function () { if (this.type === 'file') fileInput = this; else click.call(this); };
                panel.import(); assert(fileInput, '未创建导入入口');
                const transfer = new DataTransfer();
                transfer.items.add(new File([JSON.stringify({ BV9999999999: { status: '已观看', percent: '60%', currentTime: '01:00', savedAt: '2026-09-06 08:00:00', title: '导入往返验证' } })], 'fixture.json', { type: 'application/json' }));
                fileInput.files = transfer.files; await fileInput.onchange();
                assert(api.StorageManager.getRecord('BV9999999999'), '导入未提交');
                URL.createObjectURL = blob => { exported = blob; return createURL(blob); };
                HTMLAnchorElement.prototype.click = function () {};
                await panel.export(); const data = JSON.parse(await exported.text());
                assert(data.BV9999999999.title === '导入往返验证', '导出缺少导入内容');
                const before = api.StorageManager.getAllKeys().length;
                await fileInput.onchange(); assert(api.StorageManager.getAllKeys().length === before, '重复导入没有跳过已有记录');
            } finally { HTMLInputElement.prototype.click = click; HTMLAnchorElement.prototype.click = anchorClick; URL.createObjectURL = createURL; }
        });
        await test('慢速撤销即时显示持续进度，失败允许重试', async () => {
            let release, calls = 0;
            const gate = new Promise(resolve => { release = resolve; });
            const toast = api.UIComponent.toastUndo('慢速撤销验证', 20, async () => { calls++; await gate; return '撤销完成：恢复 12 条'; });
            const button = toast.querySelector('button'); button.click(); button.click();
            const pending = document.querySelector('.bvh-progress-toast.is-pending');
            assert(pending && pending.classList.contains('show'), '点击后未即时显示撤销进度');
            assert(button.disabled && button.textContent === '正在撤销…' && calls === 1, '按钮状态或重复执行错误');
            assert(!pending.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'), '等待进度伪报百分比');
            await delay(350); assert(!toast.isConnected && pending.isConnected, '原撤销提示过期导致执行进度消失');
            release(); await until(() => !pending.classList.contains('is-pending'));
            assert(pending.textContent.includes('恢复 12 条'), '未显示实际完成结果');
            let attempts = 0;
            const retryToast = api.UIComponent.toastUndo('失败重试验证', 5000, async () => { await delay(30); if (++attempts === 1) throw new Error('合成恢复失败'); return '重试成功'; });
            const retry = retryToast.querySelector('button'); retry.click();
            await until(() => !retry.disabled);
            assert(retry.textContent === '重试撤销', '失败后未恢复重试入口');
            assert([...document.querySelectorAll('.bvh-progress-toast.error')].some(el => el.textContent.includes('合成恢复失败')), '失败反馈缺失');
            retry.click(); await until(() => !retryToast.isConnected); assert(attempts === 2, '重试未执行');
        });
        fixtureFault = false; panel?.dispose();
        report.dataset.result = results.some(r => r.startsWith('失败')) ? 'failed' : 'passed'; report.textContent = results.join('\n');
        api.HistoryManagerPanel.show();
    };
    document.getElementById('run-tests').onclick = run;
    report.textContent = `已加载 ${count} 条合成记录；初始化 ${initTime.toFixed(1)} ms`;
    if (new URL(location.href).searchParams.has('run')) await run();
    else {
        const params = new URL(location.href).searchParams, state = params.get('state');
        const panel = api.HistoryManagerPanel.show({ activeTab: params.get('tab') || (['selection', 'confirm', 'undo', 'empty'].includes(state) ? 'history' : 'settings') });
        if (panel.tab === 'history') await until(() => panel.filtered);
        if (state === 'draft' || state === 'failure') panel.q('[data-setting="showProgressBar"]').click();
        if (state === 'error') { const field = panel.q('[data-setting="highThreshold"]'); field.value = '1'; field.dispatchEvent(new Event('input', { bubbles: true })); await panel.save(); field.scrollIntoView({ block: 'center' }); }
        if (state === 'failure') { fixtureFault = true; await panel.save(); fixtureFault = false; }
        if (state === 'selection') panel.q('[data-select]')?.click();
        if (state === 'confirm') { panel.q('[data-retention-value]').value = '1'; panel.q('[data-retention-unit]').value = 'days'; panel.retention(); }
        if (state === 'progress') { const feedback = api.UIComponent.progressToast('正在提交合成测试批次…'); feedback.update(45, '已准备 45 / 100 条合成记录，等待提交确认'); }
        if (state === 'undo' && count) await panel.deleteKeys([api.StorageManager.getAllKeys()[0]], true);
        if (state === 'undo-pending') {
            const toast = api.UIComponent.toastUndo('撤销等待效果验证', 5000, async () => { await delay(15000); return '模拟撤销完成'; });
            toast.querySelector('button').click();
        }
        await delay(350); // 等待反馈淡入完成，截图覆盖稳定可见状态。
        report.dataset.ready = 'true';
    }
})().catch(error => { document.getElementById('fixture-results').textContent = error.stack; });
