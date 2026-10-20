import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { source } from './fixture.mjs';
import { southPlusPages, southPlusResponses, southPlusXml } from './southplus-fixtures.mjs';

const isolated = source.slice(0, source.indexOf('    // ================== 主引擎核心')).replace('const delay =', 'let delay =') + '\n globalThis.__bbs = expression => eval(expression);\n})();';
const engine = source.replace('const delay = (ms) => new Promise(res => setTimeout(res, ms));', 'const delay = async ms => { window.__now += ms; };');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 900 } });
await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
await context.addInitScript(() => {
    window.__now = new Date('2026-10-09T12:00:00+08:00').getTime();
    const RealDate = Date;
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [window.__now])); } static now() { return window.__now; } };
    window.__storage = new Map(); window.__listeners = new Map(); window.__requests = []; window.__responses = []; window.__fetchResponses = []; window.__tabs = [];
    window.GM_getValue = (key, fallback) => structuredClone(__storage.has(key) ? __storage.get(key) : fallback);
    window.GM_setValue = (key, value) => { const old = __storage.get(key); __storage.set(key, structuredClone(value)); for (const [name, fn] of [...__listeners.values()]) if (name === key) fn(key, old, value, true); };
    window.GM_listValues = () => [...__storage.keys()]; window.GM_deleteValue = key => __storage.delete(key);
    window.GM_addValueChangeListener = (key, fn) => { const id = crypto.randomUUID(); __listeners.set(id, [key, fn]); return id; };
    window.GM_removeValueChangeListener = id => __listeners.delete(id);
    window.GM_registerMenuCommand = () => {}; window.GM_addStyle = () => {};
    window.GM_openInTab = (url, details) => { const tab = { url, details, closed: false, close() { this.closed = true; } }; __tabs.push(tab); return tab; };
    window.GM_xmlhttpRequest = details => {
        __requests.push({ url: details.url, method: details.method || 'GET' });
        const next = __responses.shift();
        if (!next) throw new Error('样例未声明 GM 回包，禁止真实网络');
        queueMicrotask(() => details.onload({ status: 200, responseText: '', responseHeaders: '', ...next }));
        return { abort() {} };
    };
    window.fetch = async (url, options = {}) => {
        __requests.push({ url: String(url), method: options.method || 'GET' });
        const next = __fetchResponses.shift();
        if (!next) throw new Error('样例未声明 fetch 回包，禁止真实网络');
        const response = new Response(next.text || '', { status: next.status || 200, headers: next.headers || { 'Content-Type': 'application/json' } });
        Object.defineProperty(response, 'url', { value: String(url) }); return response;
    };
    window.unsafeWindow = window;
    window.alert = () => {}; window.confirm = () => true;
});
async function pageFor(url, html = '') {
    const page = await context.newPage();
    await page.goto(url);
    await page.evaluate(html => { document.body.innerHTML = html; }, html);
    await page.evaluate(isolated);
    // 站点等待用可控时间推进；真实 DOM、事件和 MutationObserver 保留。
    await page.evaluate(() => __bbs('delay = async ms => { window.__now += ms; };'));
    return page;
}
const evaluate = (page, expression) => page.evaluate(expression => __bbs(expression), expression);
const result = async (page, key) => evaluate(page, `getRawTargetStatus(${JSON.stringify(key)})?.status || 'not-started'`);
async function runSite(page, key) {
    await evaluate(page, `if (!pageOperations.has(${JSON.stringify(key)})) pageOperations.set(${JSON.stringify(key)},captureOperation(${JSON.stringify(key)}));`);
    return evaluate(page, `siteConfigs.find(s=>s.key===${JSON.stringify(key)}).run(startSignDebugCapture(${JSON.stringify(key)},'样例','site-run'))`);
}
async function seedLegacyPageTask(page, key, status, action = '') {
    await evaluate(page, `globalThis.legacyOp=acquireTaskLease(${JSON.stringify(key)},'page');
        pageOperations.set(${JSON.stringify(key)},legacyOp);
        sessionStorage.setItem('BBSSignHelperPageTask:'+${JSON.stringify(key)},legacyOp.taskId);
        recordTargetStatus(${JSON.stringify(key)},${JSON.stringify(status)},{context:legacyOp,stage:'editor'});
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.task,${JSON.stringify(key)}),{...getTaskLease(${JSON.stringify(key)}),checkOnly:true});
        ${action ? `markPendingAutoCloseAfterSignAction(${JSON.stringify(key)},${JSON.stringify(action)});` : ''}`);
}
const verified = [];
try {
    const ui = await pageFor('https://www.limestart.cn/');
    await evaluate(ui, 'initDashboardEntry(); startStateSynchronization(); showDashboard()');
    const search = ui.locator('.bbs-sign-search');
    assert.equal(await ui.locator('.bbs-sign-stat').count(), 5);
    assert.equal(await ui.locator('.bbs-sign-section:visible').count(), 1, '空分组不占位');
    assert.equal(await ui.locator('.bbs-sign-stat').evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().top))).size), 1, '桌面统计保持一行');
    await search.fill('不存在的站点-xyz');
    assert.equal(await ui.locator('.bbs-sign-section:visible').count(), 0);
    assert.equal(await ui.locator('.bbs-sign-empty').isVisible(), true, '搜索无结果有明确提示');
    await search.fill('月曦');
    assert.equal(await ui.locator('.bbs-sign-row:visible').count(), 1);
    await search.evaluate(node => { window.__searchNode = node; node.focus(); node.setSelectionRange(1, 1); });
    await evaluate(ui, "completeSign('wcccc','本人今日已签到'); refreshDashboardData()");
    assert.equal(await search.evaluate(node => node === window.__searchNode && document.activeElement === node), true);
    assert.equal(await search.evaluate(node => node.selectionStart), 1);
    await search.evaluate(node => {
        node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        node.value = '月曦论坛'; node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    assert.equal(await evaluate(ui, 'dashboardSearchQuery'), '月曦');
    await search.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.equal(await evaluate(ui, 'dashboardSearchQuery'), '月曦论坛');
    const completed = ui.locator('details.bbs-sign-section').filter({ has: ui.locator('summary', { hasText: '已完成' }) });
    assert.equal(await completed.evaluate(node => node.open), false);
    await completed.evaluate(node => { node.open = true; });
    await evaluate(ui, 'refreshDashboardData(); addDashboardStyles(); addDashboardStyles();');
    assert.equal(await completed.evaluate(node => node.open), true);
    assert.equal(await ui.locator('#bbs-sign-dashboard-style').count(), 1);
    await evaluate(ui, "showDashboard('settings')");
    const draft = ui.getByPlaceholder('站点名称', { exact: true });
    await draft.fill('未保存的草稿');
    await evaluate(ui, "completeSign('fxacg','明确签到成功'); refreshDashboardData()");
    assert.equal(await ui.locator('#bbs-sign-dashboard-overlay').getAttribute('data-view'), 'settings');
    assert.equal(await draft.inputValue(), '未保存的草稿');
    const listenerCount = await ui.evaluate(() => __listeners.size);
    await ui.evaluate(() => { window.__now += 180000; });
    await evaluate(ui, "recordTargetStatus('southplus','needs-login',{message:'远端人工等待超过两分钟'}); updateDashboardPreference({autoClosePageAfterSign:true})");
    await ui.waitForTimeout(100);
    assert.equal(await ui.evaluate(() => __listeners.size), listenerCount);
    assert.equal(await draft.inputValue(), '未保存的草稿');
    const settingsSearch = ui.locator('.bbs-sign-search');
    await settingsSearch.fill('月曦');
    assert.equal(await ui.locator('[data-setting-target]:visible').count(), 1);
    assert.equal(await draft.inputValue(), '未保存的草稿');
    await evaluate(ui, "showDashboard('dashboard'); showDashboard('settings')");
    assert.equal(await draft.inputValue(), '未保存的草稿');
    const beforeDiagnostics = await evaluate(ui, 'JSON.stringify(getStatusStore())');
    await evaluate(ui, "showTargetDiagnostics(getBuiltInTargets().find(t=>t.id==='wcccc'))");
    assert.ok((await ui.locator('dialog').textContent()).includes('没有保存失败请求日志'));
    assert.equal(JSON.parse(await ui.locator('dialog pre').textContent()).targetStatus.status, await result(ui, 'wcccc'));
    await ui.locator('dialog').getByText('关闭', { exact: true }).click();
    assert.equal(await evaluate(ui, 'JSON.stringify(getStatusStore())'), beforeDiagnostics);
    await evaluate(ui, "globalThis.timeBefore=getRawTargetStatus('wcccc'); GM_setValue(getTargetStatusStorageKey(getToday(),'wcccc'),{...timeBefore,updatedAt:'2026-10-20T12:20:43.014Z'}); showTargetDiagnostics(getBuiltInTargets().find(t=>t.id==='wcccc'))");
    const localDiagnostic = JSON.parse(await ui.locator('dialog pre').textContent());
    assert.equal(localDiagnostic.targetStatus.updatedAt, '2026-10-20T20:20:43.014+08:00', '旧UTC状态在诊断中显示北京时间');
    assert.equal(await evaluate(ui, "getRawTargetStatus('wcccc').updatedAt"), '2026-10-20T12:20:43.014Z', '导出兼容旧记录且不改写状态');
    await ui.locator('dialog').getByText('关闭', { exact: true }).click();
    await evaluate(ui, "GM_setValue(getTargetStatusStorageKey(getToday(),'wcccc'),timeBefore)");
    assert.equal(await ui.evaluate(() => __requests.length), 0);
    await evaluate(ui, "updateDashboardPreference({autoOpenDashboardOnAttention:true}); closeDashboardOverlay(dashboardMounted.overlay); completeSign('sijishe','明确今日已签到')");
    await ui.waitForTimeout(3200);
    assert.equal(await ui.locator('#bbs-sign-dashboard-overlay').count(), 0, '任务回调和提醒不能重开面板');
    await evaluate(ui, "showDashboard(); dashboardSearchQuery=''; refreshDashboardData()");
    await ui.setViewportSize({ width: 390, height: 844 });
    assert.equal(await ui.locator('.bbs-sign-row:visible').count() > 0, true);
    assert.equal(await ui.locator('.bbs-sign-panel').evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1), true);
    assert.equal(await ui.locator('.bbs-sign-body').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, '窄屏内容不横向溢出');
    await evaluate(ui, "recordTargetStatus('sehuatang','needs-foreground',{message:'请手动完成验证码'}); refreshDashboardData()");
    const attentionRow = ui.locator('[data-target="sehuatang"]');
    const more = attentionRow.locator('.bbs-sign-more');
    await more.locator('summary').click();
    assert.equal(await more.locator('button:visible').count(), 8, '窄屏更多菜单完整可用');
    assert.equal(await attentionRow.evaluate(node => [...node.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= innerWidth)), true);
    await evaluate(ui, "setManualTargetStatus(getAllTargets().find(t=>t.id==='sehuatang'),'success'); refreshDashboardData()");
    assert.equal(await attentionRow.isVisible(), true, '刷新后菜单展开的行保持可见');
    assert.equal(await more.evaluate(node => node.open), true);
    await more.locator('summary').click();
    await search.focus();
    await evaluate(ui, 'refreshDashboardData()');
    assert.equal(await attentionRow.evaluate(node => node.closest('details.bbs-sign-section').dataset.group), 'completed', '操作完成后移入正确分组');
    assert.equal(await ui.locator('[data-group="attention"] .bbs-sign-section-count').textContent(), '1', '分组计数仅保留仍需登录的 South-Plus');
    assert.equal(await ui.locator('[role="progressbar"]').getAttribute('aria-valuenow'), String(Math.round(4 / 17 * 100)));
    await evaluate(ui, 'stopStateSynchronization()');
    await ui.close();
    console.log('通过：浏览器搜索/中文组合输入/节点与焦点、配置草稿、折叠、样式防重、关闭不重开、五列统计/空态/进度及390px窄屏菜单与布局。');

    // South-Plus 按网站当前任务状态执行；今天完成昨天领取的任务后仍可能可申请。
    for (const action of ['重新检查', '继续签到', '一键处理未完成', '一键直签']) {
        const southRetry = await pageFor('https://www.limestart.cn/');
        await evaluate(southRetry, "for (const target of getBuiltInTargets()) updateBuiltInTargetSetting(target.id,{enabled:target.id==='southplus'}); completeSign('southplus','旧的今日完成记录');");
        if (action === '继续签到') await evaluate(southRetry, "recordTargetStatus('southplus','result-unknown',{reasonCode:'readonly-unavailable'})");
        await evaluate(southRetry, 'showDashboard()');
        const responses = southPlusResponses();
        if (action !== '重新检查') responses.push(southPlusXml(action === '继续签到' ? 'confirm\t您申请过[日常]还未完成,不需要重新申请!' : 'success\t任务已经申请成功!'), { responseText: southPlusPages({ daily: 'claimable' }).active }, southPlusXml('success\t你[日常]已经完成!\t15'), ...southPlusResponses({ daily: 'cooldown' }));
        await southRetry.evaluate(responses => __responses.push(...responses), responses);
        if (action === '重新检查') await southRetry.locator('[data-group="completed"] > summary').click();
        await southRetry.getByRole('button', { name: action, exact: true }).click();
        const expected = action === '重新检查' ? 'not-started' : 'success';
        await southRetry.waitForFunction(expected => __bbs("getRawTargetStatus('southplus')?.status") === expected, expected);
        const requests = await southRetry.evaluate(() => __requests);
        const submissions = requests.filter(request => /actions=job/.test(request.url)).map(request => {
            const url = new URL(request.url); return `${url.searchParams.get('actions')}:${url.searchParams.get('cid')}`;
        });
        assert.deepEqual(submissions, action === '重新检查' ? [] : ['job:15', 'job2:15'], action);
        assert.equal(requests.length, action === '重新检查' ? 3 : 9, '实际读取三个任务页面，申请后再查领取条件，领取后再次核对');
        assert.equal(await evaluate(southRetry, "getData('southplus') === getToday()"), expected === 'success');
        assert.ok((await evaluate(southRetry, "getRawTargetStatus('southplus').message")).includes('上次完成 2026-10-09 23:41:56'));
        if (action !== '重新检查') {
            await southRetry.evaluate(responses => __responses.push(...responses), southPlusResponses({ daily: 'cooldown' }));
            await southRetry.getByRole('button', { name: '一键处理未完成', exact: true }).click();
            await southRetry.waitForFunction(() => __requests.length === 12 && __bbs("getRawTargetStatus('southplus')?.status") === 'success');
            assert.equal(await southRetry.evaluate(() => __requests.filter(request => /actions=job/.test(request.url)).length), 2, '再次一键处理只查询当前冷却，不重复提交');
        }
        await southRetry.close();
    }
    // 已申请的任务只领取，不再申请；未达领取条件/状态不明时仅展示实际状态。
    for (const daily of ['claimable', 'in-progress', 'unknown', 'cooldown']) {
        const southState = await pageFor('https://www.limestart.cn/');
        const responses = southPlusResponses({ daily });
        if (daily === 'claimable') responses.push(southPlusXml('success\t你[日常]已经完成!\t15'), ...southPlusResponses({ daily: 'cooldown' }));
        await southState.evaluate(responses => __responses.push(...responses), responses);
        await evaluate(southState, "runDirectTarget(getBuiltInTargets().find(t=>t.id==='southplus'))");
        const submissions = await southState.evaluate(() => __requests.filter(request => /actions=job/.test(request.url)).map(request => new URL(request.url).searchParams.get('actions')));
        assert.deepEqual(submissions, daily === 'claimable' ? ['job2'] : [], daily);
        assert.equal(await result(southState, 'southplus'), ['claimable', 'cooldown'].includes(daily) ? 'success' : 'result-unknown');
        await southState.close();
    }
    const unconfirmedSouth = await pageFor('https://www.limestart.cn/');
    await unconfirmedSouth.evaluate(responses => __responses.push(...responses), [...southPlusResponses({ daily: 'claimable' }), southPlusXml('success\t你[日常]已经完成!\t15'), ...southPlusResponses({ daily: 'claimable' }), ...southPlusResponses({ daily: 'claimable' })]);
    await evaluate(unconfirmedSouth, "runDirectTarget(getBuiltInTargets().find(t=>t.id==='southplus'))");
    assert.equal(await result(unconfirmedSouth, 'southplus'), 'not-started', '网站仍显示可领取，不能凭成功回包标记成功');
    assert.equal(await unconfirmedSouth.evaluate(() => __requests.filter(request => /actions=job2/.test(request.url)).length), 1, '提交后复查不自动再次领取');
    await unconfirmedSouth.close();
    for (const responseText of ['<form action="login.php"><input name="pwpwd"></form>', '<a href="login.php?action-quit-verify-fixture.html">退出</a><div id="main">任务页面发生变化</div>']) {
        const invalidSouth = await pageFor('https://www.limestart.cn/');
        await invalidSouth.evaluate(responseText => __responses.push({ responseText }), responseText);
        await evaluate(invalidSouth, "runDirectTarget(getBuiltInTargets().find(t=>t.id==='southplus'))");
        assert.equal(await result(invalidSouth, 'southplus'), responseText.includes('pwpwd') ? 'needs-login' : 'failed');
        assert.equal(await invalidSouth.evaluate(() => __requests.length), 1, '登录失效/页面不匹配时不调用申请或领取接口');
        await invalidSouth.close();
    }
    verified.push('southplus');
    console.log('通过：South-Plus 三页真实结构查询、完成时间不作为领取冷却、已成功缓存仍查询、单站/两个一键入口、已申请只领取、未达条件/异常不提交及提交后只复查。');

    // 普通访问遵循所有站点的今日成功跳过规则；显式检查仍查询网站。
    for (const mode of ['cached', 'login', 'explicit', 'first-visit', 'in-progress', 'unknown', 'pagehide']) {
        const southVisit = await pageFor('https://www.south-plus.net/');
        if (['cached', 'explicit'].includes(mode)) await evaluate(southVisit, "completeSign('southplus','已有成功记录')");
        if (mode === 'explicit') {
            await seedLegacyPageTask(southVisit, 'southplus', 'success');
            await evaluate(southVisit, "GM_setValue(getScopedStorageKey(STORAGE_KEYS.task,'southplus'),{...getTaskLease('southplus'),checkOnly:true,checkOnlySource:'explicit'})");
        }
        const responses = mode === 'cached' ? [] : mode === 'login' ? [{ responseText: '<form action="login.php"><input name="pwpwd"></form>' }] : southPlusResponses({ daily: ['in-progress', 'unknown'].includes(mode) ? mode : 'cooldown' });
        await southVisit.evaluate(({ responses, mode }) => {
            document.querySelector('#bbs-sign-page-toast')?.remove();
            window.__toastAdded = 0; window.__requestToasts = [];
            new MutationObserver(records => {
                for (const record of records) for (const node of record.addedNodes) if (node.id === 'bbs-sign-page-toast') __toastAdded++;
            }).observe(document.body, { childList: true });
            const request = GM_xmlhttpRequest;
            window.GM_xmlhttpRequest = details => {
                __requestToasts.push({ url: details.url, title: document.querySelector('.bbs-sign-page-toast-title')?.textContent || '' });
                if (mode === 'pagehide') window.dispatchEvent(new Event('pagehide'));
                return request(details);
            };
            __responses.push(...responses);
        }, { responses, mode });
        await southVisit.evaluate(engine);
        const observed = await southVisit.evaluate(() => ({ added: __toastAdded, requests: __requestToasts, title: document.querySelector('.bbs-sign-page-toast-title')?.textContent || '' }));
        const incomplete = ['in-progress', 'unknown', 'pagehide'].includes(mode);
        assert.equal(observed.requests.length, mode === 'cached' ? 0 : ['login', 'pagehide'].includes(mode) ? 1 : 3, mode + '不叠加通用轮询');
        assert.equal(observed.title, incomplete ? '等待检查结果' : mode === 'login' ? '等待登录' : '签到成功', mode);
        assert.equal(await result(southVisit, 'southplus'), incomplete ? 'result-unknown' : mode === 'login' ? 'needs-login' : 'success');
        assert.equal(await evaluate(southVisit, "hasActiveTask('southplus')"), false, '查询结束/离开页面后立即释放任务：' + mode);
        if (mode === 'cached') {
            assert.equal(await evaluate(southVisit, "getRawTargetStatus('southplus').stage"), 'skip');
            await southVisit.evaluate(engine);
            assert.equal(await southVisit.evaluate(() => __requests.length), 0, '重复访问已签到网站也不查询');
        }
        await southVisit.close();
    }
    console.log('通过：South-Plus 今日成功普通访问零请求，显式复查/首次执行查询；未完成/异常/离页释放任务，无额外90秒轮询。');

    // 同站任务防重只影响签到动作，普通浏览不提示切回；其他站点互不占用。
    for (const kind of ['direct', 'page', 'other-site']) {
        const browsing = await pageFor('https://www.south-plus.net/');
        const ownerKey = kind === 'other-site' ? 'fxacg' : 'southplus';
        await evaluate(browsing, `globalThis.owner=acquireTaskLease('${ownerKey}','${kind === 'page' ? 'page' : 'direct'}'); recordTargetStatus('${ownerKey}','running',{context:owner})`);
        await browsing.evaluate(() => document.querySelector('#bbs-sign-page-toast')?.remove());
        if (kind === 'other-site') await browsing.evaluate(responses => __responses.push(...responses), southPlusResponses({ daily: 'cooldown' }));
        await browsing.evaluate(engine);
        assert.equal(await browsing.evaluate(() => __requests.length), kind === 'other-site' ? 3 : 0, kind);
        assert.equal(await evaluate(browsing, `getTaskLease('${ownerKey}').taskId === owner.taskId && hasActiveTask('${ownerKey}')`), true, '不能抢占或结束其他任务');
        if (kind !== 'other-site') assert.equal(await browsing.locator('#bbs-sign-page-toast').count(), 0, '普通浏览不弹任务占用提示');
        else assert.equal(await result(browsing, 'southplus'), 'success', '其他网站执行中不阻止South-Plus完成');
        if (kind === 'direct') {
            await evaluate(browsing, "showPageTaskInfo(getBuiltInTargets().find(t=>t.id==='southplus'))");
            assert.ok((await browsing.getByRole('dialog').textContent()).includes('正在控制台后台执行'));
            assert.equal((await browsing.getByRole('dialog').textContent()).includes('请切回'), false);
        }
        await browsing.close();
    }
    console.log('通过：同站任务期间普通浏览不提示占用，后台任务说明准确，跨站执行不阻塞且不抢占已有任务。');

    // 四个重点站点：点击、提交、草稿和无关通知都不是成功证据。
    const moon = await pageFor('https://bbs.wcccc.cc/plugin.php?id=k_misign:sign', '<button id="JD_sign">签到</button>');
    await moon.evaluate(() => { window.__clicks = 0; document.querySelector('#JD_sign').onclick = () => __clicks++; });
    await runSite(moon, 'wcccc');
    assert.equal(await result(moon, 'wcccc'), 'result-unknown');
    await evaluate(moon, "checkSiteResult(siteConfigs.find(s=>s.key==='wcccc'))");
    assert.equal(await moon.evaluate(() => __clicks), 1);
    await moon.evaluate(() => document.querySelector('#JD_sign').classList.add('btnvisted'));
    await evaluate(moon, "checkSiteResult(siteConfigs.find(s=>s.key==='wcccc'))");
    assert.equal(await result(moon, 'wcccc'), 'success'); verified.push('wcccc'); await moon.close();

    const zod = await pageFor('https://zodgame.xyz/plugin.php?id=dsu_paulsign:sign', '<div>今天签到了吗 写下今天最想说的话</div>');
    await runSite(zod, 'ZodGame'); assert.equal(await result(zod, 'ZodGame'), 'failed');
    await zod.evaluate(() => { document.body.innerHTML = '<div>今天签到了吗 写下今天最想说的话</div><form id="qiandao"></form>'; window.__submits = 0; document.querySelector('form').submit = () => __submits++; });
    await runSite(zod, 'ZodGame'); assert.equal(await result(zod, 'ZodGame'), 'result-unknown');
    await evaluate(zod, "checkSiteResult(siteConfigs.find(s=>s.key==='ZodGame'))");
    assert.equal(await zod.evaluate(() => __submits), 1);
    await zod.evaluate(() => { document.body.innerHTML = '<div id="ct"><div class="mn"><h1>您今天已经签到过了</h1></div></div>'; });
    await runSite(zod, 'ZodGame'); assert.equal(await result(zod, 'ZodGame'), 'success'); verified.push('ZodGame'); await zod.close();

    const hunt = await pageFor('https://www.fufugal.com/', '<div id="photo_wrap"><div class="user-infos"><button class="xbs">寻宝</button></div></div><div class="el-message__content">保存成功</div>');
    await runSite(hunt, 'fufugal'); assert.notEqual(await result(hunt, 'fufugal'), 'success');
    await hunt.evaluate(() => { document.querySelector('.el-message__content').textContent = '今日已完成寻宝但发生错误'; });
    await runSite(hunt, 'fufugal'); assert.notEqual(await result(hunt, 'fufugal'), 'success');
    await hunt.evaluate(() => { document.querySelector('.el-message__content').textContent = '寻宝结束，最终携带回了 20 积分'; });
    await runSite(hunt, 'fufugal'); assert.equal(await result(hunt, 'fufugal'), 'success'); verified.push('fufugal'); await hunt.close();

    // API 不依赖 Vue 按钮和报告渲染；中途战斗失败仍以最终寻宝结束为准。
    const customHunt = await pageFor('https://www.fufugal.com/');
    await customHunt.evaluate(() => {
        localStorage.setItem('user', JSON.stringify({ token: 'HUNT_TOKEN_SECRET' }));
        __fetchResponses.push({ text: JSON.stringify({ code: 200, obj: ['战斗失败，离开小世界', '最后携带回了1积分', '寻宝结束，守护灵进入休息状态'], wrap: 1, config: 3424 }) });
    });
    await runSite(customHunt, 'fufugal');
    assert.equal(await result(customHunt, 'fufugal'), 'success', '无按钮和弹窗仍由 API 完成报告确认成功');
    assert.deepEqual(await customHunt.evaluate(() => __requests), [{ url: 'https://www.fufugal.com/hunt', method: 'GET' }]);
    assert.equal(await evaluate(customHunt, "requestContexts.get('fufugal').submitted"), true, 'GET 寻宝也必须记作提交动作');
    assert.equal((await evaluate(customHunt, "JSON.stringify(requestContexts.get('fufugal').entries)")).includes('HUNT_TOKEN_SECRET'), false, '请求日志不得泄露认证令牌');
    await customHunt.evaluate(() => { document.body.innerHTML = '<h3>寻宝报告</h3><p>战斗失败，离开小世界</p><p>寻宝结束，守护灵进入休息状态</p><button>确定</button>'; });
    await evaluate(customHunt, "checkSiteResult(siteConfigs.find(s=>s.key==='fufugal'))");
    assert.equal(await result(customHunt, 'fufugal'), 'success');
    assert.equal(await customHunt.evaluate(() => __requests.length), 1, '结果复查不能再次调用寻宝接口');
    await customHunt.close();

    for (const [payload, expected] of [
        [{ code: 601 }, 'needs-login'], [{ code: 5 }, 'needs-login'],
        [{ code: 602 }, 'needs-foreground'], [{ code: 688 }, 'success'],
        [{ code: 200, obj: ['守护灵们为了更好的寻宝，拉着你一起开始锻炼', '咚咚咚......', '经过努力，你的等级提升到了3434级', '守护灵们分别提升到了930级,2265级,2055级,1903级,1713级', '进入小世界', '守护灵在草原上击败了一只野怪，获得了一颗珍贵的精灵珠！(๑•̀ㅂ•́)و✧', '离开小世界', '最终携带回了3积分', '寻宝结束,守护灵们进入休息状态'], wrap: 3, config: 3434 }, 'success'],
        [{ code: 200, obj: ['守护灵进入小世界'] }, 'result-unknown'],
        [{ code: 200, obj: { message: '寻宝结束' } }, 'result-unknown'],
        [{ code: 0, obj: ['寻宝结束'] }, 'result-unknown'],
        [{ code: 799, obj: ['寻宝结束'] }, 'result-unknown']
    ]) {
        const apiHunt = await pageFor('https://www.fufugal.com/');
        await apiHunt.evaluate(payload => {
            localStorage.setItem('user', JSON.stringify({ token: 'HUNT_TOKEN_SECRET' }));
            __fetchResponses.push({ text: JSON.stringify(payload) });
        }, payload);
        await apiHunt.evaluate(engine);
        assert.equal(await result(apiHunt, 'fufugal'), expected, `寻宝回包 ${JSON.stringify(payload)}`);
        assert.equal(await apiHunt.evaluate(() => __requests.length), 1, 'API 返回后不重复派遣');
        assert.equal(await apiHunt.evaluate(() => __now - new Date('2026-10-09T12:00:00+08:00').getTime()) < 1000, true, '不进入90秒 DOM 复查等待');
        await apiHunt.close();
    }
    for (const cachedUser of [null, '{broken', JSON.stringify({ token: 123 })]) {
        const noAuthHunt = await pageFor('https://www.fufugal.com/');
        await noAuthHunt.evaluate(value => { localStorage.removeItem('user'); if (value !== null) localStorage.setItem('user', value); }, cachedUser);
        await noAuthHunt.evaluate(engine);
        assert.equal(await result(noAuthHunt, 'fufugal'), 'needs-login');
        assert.equal(await noAuthHunt.evaluate(() => __requests.length), 0);
        await noAuthHunt.close();
    }
    const failedHunt = await pageFor('https://www.fufugal.com/');
    await failedHunt.evaluate(() => {
        localStorage.setItem('user', JSON.stringify({ token: 'HUNT_TOKEN_SECRET' }));
        window.fetch = async (url, options) => { __requests.push({ url: String(url), method: options.method }); throw new TypeError('Failed to fetch'); };
    });
    await failedHunt.evaluate(engine);
    assert.equal(await result(failedHunt, 'fufugal'), 'result-unknown', '已发送的寻宝请求失败后保持待核对');
    assert.equal(await failedHunt.evaluate(() => __requests.length), 1, '提交后网络失败不能自动重试寻宝');
    await failedHunt.close();

    const sstm = await pageFor('https://sstm.moe/topic/123-test/', '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="/profile/me/">本人</a><div class="ipsComposeArea"><div contenteditable="true">2026年10月9日 草稿</div></div><article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/other/">他人</a></h3></aside><div class="ipsComment_content">2026年10月9日</div></article>');
    assert.equal(await evaluate(sstm, 'isSstmSignedToday()'), false);
    await sstm.evaluate(() => { document.querySelector('article a').href = '/profile/me/'; });
    assert.equal(await evaluate(sstm, 'isSstmSignedToday()'), true);
    await runSite(sstm, 'sstm'); assert.equal(await result(sstm, 'sstm'), 'success');
    await sstm.evaluate(() => document.querySelector('#elUserLink').remove());
    assert.equal(await evaluate(sstm, 'isSstmSignedToday()'), false);
    verified.push('sstm'); await sstm.close();

    const sstmMenu = await pageFor('https://sstm.moe/topic/123-test/', '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="#elUserLink_menu">Ice_wilderness</a><ul id="elUserLink_menu"><li><a href="/profile/7-ice/">个人资料</a></li></ul><article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-ice-wilderness/">Ice_wilderness</a></h3></aside><div data-role="commentContent">2026年10月9日 01:19:42</div></article><div class="ipsComposeArea_dummy">回复此主题</div>');
    assert.equal(await evaluate(sstmMenu, 'isSstmSignedToday()'), true, '用户入口是菜单锚点时仍能识别本人已发回帖');
    await runSite(sstmMenu, 'sstm');
    assert.equal(await result(sstmMenu, 'sstm'), 'success');
    await sstmMenu.evaluate(() => document.querySelector('#elUserLink_menu').remove());
    assert.equal(await evaluate(sstmMenu, 'isSstmSignedToday()'), true, '保留原有精确用户名兼容');
    await sstmMenu.evaluate(() => { document.querySelector('[data-role="commentContent"]').innerHTML = '<div contenteditable="true">2026年10月9日 草稿</div>'; });
    assert.equal(await evaluate(sstmMenu, 'isSstmSignedToday()'), false, '本人编辑草稿仍不能当作已发布结果');
    await sstmMenu.close();

    const sstmReply = await pageFor('https://sstm.moe/topic/123-test/', '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="#elUserLink_menu">本人</a><div data-role="commentFeed"></div><form id="elReplyForm"><div contenteditable="true" style="min-height:40px">初始内容</div><button type="submit" class="ipsButton_primary">提交回复</button></form>');
    await sstmReply.evaluate(() => {
        window.__replySubmits = 0;
        document.querySelector('form').onsubmit = event => {
            event.preventDefault(); __replySubmits++;
            document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + document.querySelector('[contenteditable]').textContent + '</div></article>';
        };
    });
    await runSite(sstmReply, 'sstm');
    assert.equal(await result(sstmReply, 'sstm'), 'success', '回复表单不在 ipsComposeArea 内也能正常提交');
    assert.equal(await sstmReply.evaluate(() => __replySubmits), 1);
    await sstmReply.close();

    const sstmFrame = await pageFor('https://sstm.moe/topic/123-test/', '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="#elUserLink_menu">本人</a><div data-role="commentFeed"></div><form id="reply-editor"><iframe class="cke_wysiwyg_frame" style="height:80px"></iframe><button type="submit" class="ipsButton_primary">提交回复</button></form>');
    await sstmFrame.evaluate(() => {
        window.__frameSubmits = 0; document.querySelector('iframe').contentDocument.body.contentEditable = 'true';
        document.querySelector('form').onsubmit = event => {
            event.preventDefault(); __frameSubmits++;
            document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + document.querySelector('iframe').contentDocument.body.textContent + '</div></article>';
        };
    });
    await runSite(sstmFrame, 'sstm');
    assert.equal(await result(sstmFrame, 'sstm'), 'success', '保留原有独立 CKEditor iframe 兼容');
    assert.equal(await sstmFrame.evaluate(() => __frameSubmits), 1);
    await sstmFrame.close();

    // 依据真实页面：CKEditor 4.21、topic_comment_* 隐藏字段及独立回复区域。
    const ipsMarkup = '<h1 class="ipsType_pageTitle">版主招募区签到【2026/10/9】</h1><a id="elUserLink" href="#elUserLink_menu">本人</a><ul id="elUserLink_menu"><a href="/profile/7-me/">个人资料</a></ul><div data-role="commentFeed"></div><div data-role="replyArea"><form><textarea name="topic_comment_123" data-role="contentEditor" style="display:none"></textarea><div class="cke_wysiwyg_div" contenteditable="true" style="min-height:40px"></div><button type="submit" style="display:none">隐藏提交</button><button type="submit" class="ipsButton_primary" disabled>提交回复</button></form></div><div style="display:none"><a data-role="login">现有用户? 登入</a></div>';
    const ipsEditor = await pageFor('https://sstm.moe/topic/123-test/', ipsMarkup);
    await ipsEditor.evaluate(() => {
        const field = document.querySelector('[contenteditable]');
        const textarea = document.querySelector('textarea');
        window.__apiCalls = []; window.__ipsPosts = []; window.__hiddenClicks = 0;
        window.CKEDITOR = { instances: { topic_comment_123: {
            name: 'topic_comment_123', status: 'ready', readOnly: false,
            element: { $: textarea }, editable: () => ({ $: field }),
            setData(html, options) { __apiCalls.push('setData'); queueMicrotask(() => { field.innerHTML = html; __apiCalls.push('callback'); options.callback(); }); },
            fire(name) { __apiCalls.push(name); if (name === 'change') document.querySelector('.ipsButton_primary').disabled = false; },
            updateElement() { __apiCalls.push('updateElement'); textarea.value = field.innerHTML; },
            getData() { return field.innerHTML; }
        } } };
        document.querySelector('button').onclick = () => __hiddenClicks++;
        document.querySelector('form').onsubmit = event => {
            event.preventDefault(); __ipsPosts.push(textarea.value);
            if (textarea.value.includes('2026年10月9日')) document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><time datetime="2026-10-09T04:00:00Z"></time><div data-role="commentContent">' + textarea.value + '</div></article>';
        };
    });
    await seedLegacyPageTask(ipsEditor, 'sstm', 'result-unknown', 'reply-submit');
    await ipsEditor.evaluate(engine);
    assert.equal(await result(ipsEditor, 'sstm'), 'success');
    assert.deepEqual(await ipsEditor.evaluate(() => __apiCalls), ['setData', 'callback', 'change', 'updateElement']);
    assert.equal(await ipsEditor.evaluate(() => __ipsPosts.length), 1, '异步写入及隐藏字段同步后才提交');
    assert.match(await ipsEditor.evaluate(() => __ipsPosts[0]), /2026年10月9日/);
    assert.equal(await ipsEditor.evaluate(() => __hiddenClicks), 0, '不点击同表单的隐藏按钮');
    await ipsEditor.close();

    const pagedSstm = await pageFor('https://sstm.moe/topic/123-test/page/40/', ipsMarkup + '<a href="/topic/123-test/?view_author=11">只看该作者</a>');
    await pagedSstm.evaluate(() => {
        window.__fetchResponses.push({ text: '<h1 class="ipsType_pageTitle">签到【2026/10/9】</h1><article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><time datetime="2026-10-09T03:00:00Z"></time><div data-role="commentContent">每日一签</div></article>' });
        window.__unexpectedPosts = 0; document.querySelector('form').onsubmit = event => { event.preventDefault(); __unexpectedPosts++; };
    });
    await pagedSstm.evaluate(engine);
    assert.equal(await result(pagedSstm, 'sstm'), 'success', '本人今日评论在其他页时仍能确认');
    assert.equal(await pagedSstm.evaluate(() => __unexpectedPosts), 0);
    const ownRequests = await pagedSstm.evaluate(() => __requests);
    assert.equal(ownRequests.length, 1, '几十页评论只发一次本人过滤请求');
    assert.equal(new URL(ownRequests[0].url).searchParams.get('view_author'), '7');
    assert.equal(new URL(ownRequests[0].url).pathname, '/topic/123-test/');
    await pagedSstm.close();

    // 从控制台点击检查 → 列表找今日帖 → 同标签跳转 → 检查本人评论，全程只读。
    for (const outcome of ['found', 'missing', '404']) {
        const origin = await pageFor('https://www.limestart.cn/');
        await evaluate(origin, "for (const target of getBuiltInTargets()) updateBuiltInTargetSetting(target.id,{enabled:target.id==='sstm'}); recordTargetStatus('sstm','result-unknown',{message:'等待检查'}); showDashboard()");
        await origin.getByRole('button', { name: '检查结果', exact: true }).click();
        const launched = await origin.evaluate(() => ({ tab: __tabs[0], records: [...__storage] }));
        assert.ok(launched.tab.url.includes('__bbs_task='));
        const checkPage = await pageFor(launched.tab.url, '<h1 class="ipsType_pageTitle">同盟签到区</h1><a id="elUserLink" href="/profile/7-me/">本人</a><h4 class="ipsDataItem_title"><a href="/topic/yesterday/">签到【2026/10/8】</a></h4><h4 class="ipsDataItem_title"><a href="/topic/today-check/">签到【2026/10/9】</a></h4>');
        await checkPage.evaluate(records => {
            window.__storage = new Map(records);
            window.addEventListener('beforeunload', () => localStorage.setItem('__ssCheckStore', JSON.stringify([...__storage])));
        }, launched.records);
        const navigation = checkPage.waitForEvent('framenavigated', { predicate: frame => frame === checkPage.mainFrame() && new URL(frame.url()).pathname === '/topic/today-check/' });
        await checkPage.evaluate(engine).catch(error => { if (!/context.*destroyed|navigation/i.test(error.message)) throw error; });
        await navigation;
        await checkPage.waitForLoadState('domcontentloaded');
        assert.equal(new URL(checkPage.url()).pathname, '/topic/today-check/', '检查也必须进入当天签到帖');
        await checkPage.evaluate(({ outcome }) => {
            window.__storage = new Map(JSON.parse(localStorage.getItem('__ssCheckStore')));
            document.body.innerHTML = '<h1 class="ipsType_pageTitle">签到【2026/10/9】</h1><a id="elUserLink" href="/profile/7-me/">本人</a><a href="/topic/today-check/?view_author=11">只看该作者</a><article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/11-other/">其他用户</a></h3></aside><div data-role="commentContent">2026年10月9日</div></article><form id="elReplyForm"><div class="ipsComposeArea_dummy">回复此主题</div><div contenteditable="true">已有草稿</div><button type="submit">提交</button></form>';
            window.__editorOpens = 0; window.__posts = 0;
            document.querySelector('.ipsComposeArea_dummy').onclick = () => __editorOpens++;
            document.querySelector('form').onsubmit = event => { event.preventDefault(); __posts++; };
            __fetchResponses.push(outcome === '404' ? { status: 404, text: '找不到此页面' } : { text: '<h1 class="ipsType_pageTitle">签到【2026/10/9】</h1>' + (outcome === 'found' ? '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">2026年10月9日 11:00:00</div></article>' : '') });
        }, { outcome });
        await checkPage.evaluate(isolated);
        assert.equal(await evaluate(checkPage, "getTaskLease('sstm').checkOnlySource"), 'explicit', '跨页仍是用户发起的只读检查');
        await checkPage.evaluate(engine);
        assert.equal(await result(checkPage, 'sstm'), outcome === 'found' ? 'success' : 'result-unknown');
        const requests = await checkPage.evaluate(() => __requests);
        assert.equal(requests.length, 1, '实际请求本人评论过滤，不逐页扫描');
        assert.equal(new URL(requests[0].url).searchParams.get('view_author'), '7');
        assert.equal(requests[0].method, 'GET');
        assert.equal(await checkPage.evaluate(() => __editorOpens + __posts), 0, '检查不得激活或提交回复');
        assert.equal(await checkPage.locator('[contenteditable]').textContent(), '已有草稿');
        if (outcome !== 'found') assert.ok((await evaluate(checkPage, "getRawTargetStatus('sstm').message")).includes('已检查今日签到帖'));
        await checkPage.close(); await origin.close();
    }
    console.log('通过：SS同盟控制台检查实际进入今日帖、跨跳转保持只读、一次本人过滤请求、成功/未查到/404反馈且不触碰回复编辑器。');

    // 新一天本人尚无评论：IPS 的作者过滤可能返回 404，不能因此中断首次签到。
    const newDayMarkup = ipsMarkup.replaceAll('2026/10/9', '2026/10/10').replace(' disabled', '') + '<a href="/topic/123-test/?view_author=11">只看该作者</a>';
    const missingAuthorSstm = await pageFor('https://sstm.moe/topic/123-test/', newDayMarkup);
    await missingAuthorSstm.evaluate(() => {
        window.__now = new Date('2026-10-10T11:17:43+08:00').getTime();
        window.__fetchResponses.push({ status: 404, text: '<h1>找不到此页面</h1>' });
        window.__newDayPosts = 0;
        document.querySelector('form').onsubmit = event => {
            event.preventDefault(); __newDayPosts++;
            document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + document.querySelector('[contenteditable]').innerHTML + '</div></article>';
        };
    });
    await missingAuthorSstm.evaluate(engine);
    assert.equal(await result(missingAuthorSstm, 'sstm'), 'success', '次日本人过滤404后继续填写提交并确认发布');
    assert.equal(await missingAuthorSstm.evaluate(() => __newDayPosts), 1);
    assert.equal(await missingAuthorSstm.evaluate(() => __requests.length), 1, '404不增加翻页或重试请求');
    await missingAuthorSstm.close();

    const pending404Sstm = await pageFor('https://sstm.moe/topic/123-test/', newDayMarkup);
    await pending404Sstm.evaluate(() => {
        window.__now = new Date('2026-10-10T11:17:43+08:00').getTime();
        window.__fetchResponses.push(...Array.from({ length: 4 }, () => ({ status: 404, text: '找不到此页面' })));
        window.__pending404Posts = 0;
        document.querySelector('form').onsubmit = event => { event.preventDefault(); __pending404Posts++; };
    });
    await pending404Sstm.evaluate(engine);
    assert.equal(await result(pending404Sstm, 'sstm'), 'result-unknown', '提交后过滤404仍是待确认，不能算成功');
    await pending404Sstm.evaluate(engine);
    assert.equal(await pending404Sstm.evaluate(() => __pending404Posts), 1, '再次执行过滤404时仍不重复提交');
    const checked404 = await evaluate(pending404Sstm, "checkSiteResult(siteConfigs.find(s=>s.key==='sstm'), startSignDebugCapture('sstm','SS同盟','check'))");
    assert.equal(checked404.outcome, 'unknown', '显式复查404不能宣称明确未签');
    assert.equal(await pending404Sstm.evaluate(() => __pending404Posts), 1);
    await pending404Sstm.close();

    for (const [status, text, path, expected] of [
        [403, 'Forbidden', '/topic/123-test/', 'failed'],
        [404, 'Just a moment', '/topic/123-test/', 'needs-foreground'],
        [404, '找不到此页面', '/topic/other-test/', 'failed']
    ]) {
        const blockedSstm = await pageFor('https://sstm.moe/topic/123-test/', newDayMarkup);
        await blockedSstm.evaluate(({ status, text, path }) => {
            window.__now = new Date('2026-10-10T11:17:43+08:00').getTime();
            document.querySelector('a[href*="view_author="]').href = path + '?view_author=11';
            window.__fetchResponses.push({ status, text });
            window.__blockedPosts = 0;
            document.querySelector('form').onsubmit = event => { event.preventDefault(); __blockedPosts++; };
        }, { status, text, path });
        await blockedSstm.evaluate(engine);
        assert.equal(await result(blockedSstm, 'sstm'), expected, '权限、验证或其他帖子404不按空作者过滤放行');
        assert.equal(await blockedSstm.evaluate(() => __blockedPosts), 0);
        await blockedSstm.close();
    }

    const unknownSstm = await pageFor('https://sstm.moe/topic/123-test/', ipsMarkup.replace(' disabled', ''));
    await unknownSstm.evaluate(() => { window.__pendingPosts = 0; document.querySelector('form').onsubmit = event => { event.preventDefault(); __pendingPosts++; }; });
    await unknownSstm.evaluate(engine);
    assert.equal(await unknownSstm.evaluate(() => __pendingPosts), 1);
    assert.equal(await result(unknownSstm, 'sstm'), 'result-unknown', '草稿中有签到时间不能算提交成功');
    await unknownSstm.evaluate(engine);
    assert.equal(await unknownSstm.evaluate(() => __pendingPosts), 1, '新逻辑真实点击后的待确认记录避免重复发帖');
    await unknownSstm.close();

    // 其余13站保留各自证据和人工边界，所有响应均为脱敏构造样例。
    for (const [key, html, response] of [
        ['fxacg', '', '今日已签到'], ['sl-asmr', '', '您已签到'],
        ['kfpromax', '', '已经领过了'], ['sijishe', '', 'discuz_uid=7;<a class="btnvisted">今日已签到</a>'],
        ['galGameXNew', '<button>今日已签到</button>', null]
    ]) {
        const page = await pageFor('https://www.limestart.cn/', html);
        await page.evaluate(({ key, response }) => { if (response) __responses.push(...Array.from({ length: key === 'southplus' ? 2 : 1 }, () => ({ responseText: response }))); }, { key, response });
        // 绯月在控制台使用 arraybuffer，确认 GBK 字节仍能解码。
        if (key === 'kfpromax') await page.evaluate(() => { __responses[0] = { response: new Uint8Array([0xd2,0xd1,0xbe,0xad,0xc1,0xec,0xb9,0xfd,0xc1,0xcb]).buffer, responseHeaders: 'content-type: text/html; charset=gbk' }; });
        if (key === 'kfpromax') await evaluate(page, "runKfpromaxApiSign(startSignDebugCapture('kfpromax','绯月','direct'))");
        else await runSite(page, key);
        assert.equal(await result(page, key), 'success', key); verified.push(key); await page.close();
    }
    const sijisheFallback = await pageFor('https://www.limestart.cn/');
    await evaluate(sijisheFallback, "for (const target of getBuiltInTargets()) updateBuiltInTargetSetting(target.id,{enabled:target.id==='sijishe'}); showDashboard()");
    await sijisheFallback.evaluate(() => { __responses.push({ status: 403, responseText: '<html><script>window.location.href="/k_misign-sign.html";</script></html>' }); });
    await sijisheFallback.getByRole('button', { name: '一键处理未完成', exact: true }).click();
    await sijisheFallback.waitForFunction(() => __tabs.length === 1 && __bbs('directTasks.size') === 0);
    const handoff = await sijisheFallback.evaluate(() => ({ url: __tabs[0].url, details: __tabs[0].details, storage: [...__storage] }));
    assert.equal(handoff.details.active, true, '一键处理遇到403自动打开前台');
    assert.equal(await result(sijisheFallback, 'sijishe'), 'opened');
    assert.equal(await evaluate(sijisheFallback, "hasActiveTask('sijishe')"), true, '直签结束后页面任务仍有效');
    await sijisheFallback.getByRole('button', { name: '一键处理未完成', exact: true }).click();
    assert.equal(await sijisheFallback.evaluate(() => __tabs.length), 1, '页面接续中再次一键不重复开页');
    const sijisheHandoff = await context.newPage();
    await sijisheHandoff.goto(handoff.url);
    await sijisheHandoff.evaluate(entries => { for (const [key, value] of entries) __storage.set(key, value); __fetchResponses.push(
        { text: 'discuz_uid=7;<a id="JD_sign" href="plugin.php?id=k_misign:sign&operation=qiandao&formhash=SIGN_SECRET">签到</a>', headers: { 'Content-Type': 'text/html' } },
        { text: '<root>签到成功</root>', headers: { 'Content-Type': 'text/xml' } },
        { text: '<table><tr><td><a href="home.php?mod=space&uid=7">本人</a></td><td>2026-10-09</td></tr></table>', headers: { 'Content-Type': 'text/html' } }
    ); }, handoff.storage);
    await sijisheHandoff.evaluate(engine);
    const handoffResult = await sijisheHandoff.evaluate(() => ({ storage: [...__storage], status: GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sijishe'), submissions: __requests.filter(r => r.url.includes('operation=qiandao')).length }));
    assert.equal(handoffResult.status.status, 'success', '自动接续页面完成实际站内流程');
    assert.equal(handoffResult.submissions, 1);
    assert.equal(handoffResult.status.taskId, new URL(handoff.url).searchParams.get('__bbs_task'), '页面成功归属接续任务');
    await sijisheFallback.evaluate(entries => { for (const [key, value] of entries) GM_setValue(key, value); }, handoffResult.storage);
    assert.equal(await result(sijisheFallback, 'sijishe'), 'success', '控制台同步接续任务成功');
    await sijisheHandoff.close();
    await sijisheFallback.close();
    const sijishe = await pageFor('https://sjs96.com/k_misign-sign.html');
    await sijishe.evaluate(() => { __fetchResponses.push(
        { text: 'discuz_uid=7;<a id="JD_sign" href="plugin.php?id=k_misign:sign&operation=qiandao&formhash=SIGN_SECRET">签到</a>', headers: { 'Content-Type': 'text/html' } },
        { text: '<root>签到成功</root>', headers: { 'Content-Type': 'text/xml' } },
        { text: '<table><tr><td><a href="home.php?mod=space&uid=7">本人</a></td><td>2026-10-09</td></tr></table>', headers: { 'Content-Type': 'text/html' } }
    ); });
    await runSite(sijishe, 'sijishe');
    assert.equal(await result(sijishe, 'sijishe'), 'success', '司机社页面会话提交后核对本人当日排行');
    assert.equal(await sijishe.evaluate(() => __requests.filter(r => r.url.includes('operation=qiandao')).length), 1);
    assert.equal(await sijishe.evaluate(() => __responses.length), 0);
    await sijishe.close();
    const sijisheBlocked = await context.newPage();
    await sijisheBlocked.goto('https://sjs96.com/k_misign-sign.html');
    await sijisheBlocked.evaluate(() => { __fetchResponses.push({ status: 403, text: '<html><div></div></html><script>window.location.href="/k_misign-sign.html";</script><script src="https://static.cloudflareinsights.com/beacon.min.js"></script>', headers: { 'Content-Type': 'text/html' } }); });
    await sijisheBlocked.evaluate(engine);
    assert.equal(await sijisheBlocked.evaluate(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sijishe').status), 'needs-foreground', '本站页面403仍提示前台检查');
    assert.equal(await sijisheBlocked.evaluate(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sijishe').reasonCode), 'permission', '统计beacon不误判为验证码');
    assert.equal(await sijisheBlocked.evaluate(() => __requests.length), 1, '本站页面受限不提交、不重试');
    await sijisheBlocked.close();
    const dog = await pageFor('https://www.acgndog.com/');
    await dog.evaluate(() => { __fetchResponses.push({ text: JSON.stringify({ user: { isLoggedIn: true }, _nonce: 'sample-redacted', customPointSignDaily: { signed: false } }) }, { text: JSON.stringify({ code: 0, msg: '签到成功' }) }, { text: JSON.stringify({ user: { isLoggedIn: true }, _nonce: 'sample-redacted', customPointSignDaily: { signed: true } }) }); });
    await runSite(dog, 'acgndog'); assert.equal(await result(dog, 'acgndog'), 'success');
    assert.equal(await dog.evaluate(() => __requests.filter(r => r.url.includes('type=goSign')).length), 1); verified.push('acgndog'); await dog.close();
    const vik = await pageFor('https://www.vikacg.com/wallet/mission');
    await vik.evaluate(() => { localStorage.setItem('token', 'x'.repeat(80)); __fetchResponses.push({ text: JSON.stringify({ status: 'success', data: { basic: { id: 7 }, credit: { sign_time: Date.now() / 1000 } } }) }); });
    await runSite(vik, 'vik'); assert.equal(await result(vik, 'vik'), 'success');
    assert.equal(await vik.evaluate(() => __requests.some(r => r.url.endsWith('/userMission'))), false); verified.push('vik'); await vik.close();
    const vikFallback = await pageFor('https://www.vikacg.com/wallet/mission');
    await vikFallback.evaluate(() => {
        localStorage.setItem('staleToken', 'x'.repeat(80)); localStorage.setItem('currentToken', 'y'.repeat(80));
        __fetchResponses.push({ status: 401, text: JSON.stringify({ code: 401, message: '旧令牌过期' }) },
            { text: JSON.stringify({ status: 'success', data: { basic: { id: 7 }, credit: { sign_time: 0 } } }) },
            { text: JSON.stringify({ status: 'success', data: { sign_time: Date.now() / 1000, sign_days: 5 } }) });
    });
    await runSite(vikFallback, 'vik');
    assert.equal(await result(vikFallback, 'vik'), 'success', '旧令牌401不得中断有效令牌的签到');
    assert.equal(await vikFallback.evaluate(() => __requests.filter(r => r.url.endsWith('/userMission')).length), 1);
    await vikFallback.close();
    const vikCookie = await pageFor('https://www.vikacg.com/wallet/mission');
    await vikCookie.evaluate(() => { __fetchResponses.push({ text: JSON.stringify({ status: 'success', data: { basic: { id: 7 }, credit: { sign_time: Date.now() / 1000 } } }) }); });
    await runSite(vikCookie, 'vik');
    assert.equal(await result(vikCookie, 'vik'), 'success', '没有可读令牌时也应验证 Cookie 会话');
    await vikCookie.close();
    const vikExpired = await pageFor('https://www.vikacg.com/wallet/mission');
    await vikExpired.evaluate(() => {
        localStorage.setItem('staleToken', 'x'.repeat(80));
        __fetchResponses.push({ status: 401, text: '{"code":401}' }, { text: JSON.stringify({ status: 'success', data: { basic: { id: 7 }, credit: { sign_time: Date.now() / 1000 } } }) });
    });
    await runSite(vikExpired, 'vik');
    assert.equal(await result(vikExpired, 'vik'), 'success', '旧令牌401后仍可回退 Cookie 会话');
    await vikExpired.close();
    const uugg = await pageFor('https://www.uu-gg.one/plugin.php?id=dsu_paulsign:sign', '<div>签到服务台 今日已签到</div>');
    await runSite(uugg, 'uugg'); assert.equal(await result(uugg, 'uugg'), 'success');
    assert.equal(await uugg.evaluate(() => __requests.length), 0); verified.push('uugg'); await uugg.close();
    const book = await pageFor('https://sp6m.fwsefwef66s.com/', '<a href="member.php?mod=logging&action=logout">退出</a>');
    await runSite(book, 'soushuba'); assert.equal(await result(book, 'soushuba'), 'success'); verified.push('soushuba'); await book.close();
    const fan = await pageFor('https://2dfan.com/checkin', '<div class="checkin-action"><button>今日已签到</button></div>');
    await runSite(fan, '2dfan'); assert.equal(await result(fan, '2dfan'), 'success'); verified.push('2dfan'); await fan.close();
    const wang = await pageFor('https://laowang.vip/plugin.php?id=k_misign:sign', '<div class="qdleft"><a class="btnvisted">今日已签到</a></div>');
    await runSite(wang, 'laowang'); assert.equal(await result(wang, 'laowang'), 'success'); verified.push('laowang'); await wang.close();
    const ht = await pageFor('https://sehuatang.org/plugin.php?id=dd_sign', '<div class="ddpc_sign_btna"><a class="ddpc_sign_btn_grey">今日已签到</a></div>');
    await runSite(ht, 'sehuatang'); assert.equal(await result(ht, 'sehuatang'), 'success'); verified.push('sehuatang'); await ht.close();
    const captchaFan = await pageFor('https://2dfan.com/checkin', '<div class="checkin-action"><button>签到</button></div>');
    await captchaFan.evaluate(() => {
        window.__confirms = 0;
        document.querySelector('button').onclick = () => {
            const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
            dialog.innerHTML = '<div class="captcha-modal-body">人机验证</div><button disabled>确认</button>'; document.body.append(dialog);
            dialog.querySelector('button').onclick = () => { __confirms++; document.querySelector('.checkin-action button').textContent = '今日已签到'; dialog.remove(); };
        };
    });
    await runSite(captchaFan, '2dfan');
    assert.equal(await result(captchaFan, '2dfan'), 'needs-foreground');
    assert.equal(await captchaFan.evaluate(() => __confirms), 0);
    await captchaFan.evaluate(() => { document.querySelector('[role="dialog"] button').disabled = false; });
    await evaluate(captchaFan, "captchaAutoSubmitStates.get('2dfan').check(); captchaAutoSubmitStates.get('2dfan').check()");
    assert.equal(await captchaFan.evaluate(() => __confirms), 1);
    assert.equal(await result(captchaFan, '2dfan'), 'success');
    await captchaFan.close();

    const captchaWang = await pageFor('https://laowang.vip/plugin.php?id=k_misign:sign', '<form id="v2_captcha_form">点击进行验证<button type="button" id="submit-btn">签到</button></form>');
    await captchaWang.evaluate(() => { window.__passed = false; window.__submits = 0; window.TN = { result: () => __passed }; document.querySelector('button').onclick = () => { __submits++; document.querySelector('button').classList.add('btnvisted'); }; });
    await runSite(captchaWang, 'laowang');
    assert.equal(await result(captchaWang, 'laowang'), 'needs-foreground');
    assert.equal(await captchaWang.evaluate(() => __submits), 0);
    await captchaWang.evaluate(() => { __passed = true; });
    await evaluate(captchaWang, "captchaAutoSubmitStates.get('laowang').check(); captchaAutoSubmitStates.get('laowang').check()");
    assert.equal(await result(captchaWang, 'laowang'), 'success');
    assert.equal(await captchaWang.evaluate(() => __submits), 1);
    await captchaWang.close();

    const manualHt = await pageFor('https://www.sehuatang.org/forum.php', '<div>98堂论坛</div>');
    assert.equal(await evaluate(manualHt, "getBuiltInTargets().find(t=>t.id==='sehuatang').url"), 'https://www.sehuatang.org/plugin.php?id=dd_sign', '控制台直接打开98堂签到页');
    await seedLegacyPageTask(manualHt, 'sehuatang', 'opened');
    await evaluate(manualHt, 'updateDashboardPreference({autoClosePageAfterSign:true})');
    const oldHtStorage = await manualHt.evaluate(() => [...__storage]);
    await manualHt.evaluate(() => { window.__closes = 0; window.close = () => __closes++; });
    await manualHt.evaluate(engine);
    assert.equal(await result(manualHt, 'sehuatang'), 'needs-foreground');
    assert.equal(await evaluate(manualHt, "getRawTargetStatus('sehuatang').stage"), 'navigate');
    assert.match(await evaluate(manualHt, "getRawTargetStatus('sehuatang').message"), /直接进入.*签到页/);
    assert.equal(await evaluate(manualHt, "hasActiveTask('sehuatang')"), false, '浏览不占用98堂页面任务');
    assert.equal(await manualHt.evaluate(() => location.pathname), '/forum.php');
    assert.equal(await manualHt.evaluate(() => __requests.length), 0);

    // 另一个标签仍带旧版独占租约时，人工签到页也必须能正常观察结果。
    const signHt = await pageFor('https://www.sehuatang.org/plugin.php?id=dd_sign', '<div class="ddpc_sign_btna"><a id="signin-btn">今日未签到</a></div>');
    await signHt.evaluate(records => {
        window.__storage = new Map(records); window.__closes = 0; window.__clicks = 0; window.close = () => __closes++;
        document.querySelector('#signin-btn').onclick = event => { __clicks++; event.currentTarget.classList.add('ddpc_sign_btn_grey'); event.currentTarget.textContent = '今日已签到'; };
    }, oldHtStorage);
    await signHt.evaluate(engine);
    assert.equal(await result(signHt, 'sehuatang'), 'needs-foreground');
    assert.equal(await evaluate(signHt, "getRawTargetStatus('sehuatang').stage"), 'captcha');
    assert.equal(await evaluate(signHt, "getRawTargetStatus('sehuatang').taskId"), '', '人工结果检测不绑定其他标签的任务');
    assert.equal(await signHt.evaluate(() => __clicks), 0, '点选验证码和签到由用户完成');
    assert.equal(await signHt.locator('#bbs-sign-page-toast').innerText().then(text => text.includes('其他页面处理')), false);
    await signHt.locator('#signin-btn').click();
    await signHt.waitForFunction(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sehuatang')?.status === 'success');
    await signHt.waitForTimeout(850);
    assert.equal(await signHt.evaluate(() => __clicks), 1);
    assert.equal(await signHt.evaluate(() => __closes), 1, '本标签实际点击并完成签到后，按设置尝试自动关闭');
    const htSuccess = await signHt.evaluate(() => [...__storage]);
    await manualHt.evaluate(records => { window.__storage = new Map(records); }, htSuccess);
    await manualHt.evaluate(engine);
    await manualHt.waitForTimeout(850);
    assert.equal(await result(manualHt, 'sehuatang'), 'success');
    assert.equal(await manualHt.evaluate(() => __closes), 0, '其他标签完成签到后不关闭浏览页');
    assert.equal(await manualHt.evaluate(() => __requests.length), 0);
    await signHt.close();
    await manualHt.close();

    const htUnsigned = '<div class="ddpc_sign_btna"><a class="ddpc_sign_btn_red" id="signin-btn">今日未签到，点击签到</a></div><div id="toast" class="toast"><span class="toast-text"></span></div>';
    const popupHt = await pageFor('https://www.sehuatang.org/plugin.php?id=dd_sign', htUnsigned);
    await evaluate(popupHt, 'updateDashboardPreference({autoClosePageAfterSign:true})');
    await popupHt.evaluate(() => { window.__closes = 0; window.close = () => __closes++; });
    await runSite(popupHt, 'sehuatang');
    await runSite(popupHt, 'sehuatang');
    assert.equal(await evaluate(popupHt, 'pageObserverStops.size'), 1, '重复执行不叠加成功监听');
    await popupHt.locator('#signin-btn').click();
    await popupHt.evaluate(() => { const toast = document.querySelector('#toast'); toast.querySelector('.toast-text').textContent = '签到成功，获得奖励！'; toast.className = 'toast show success'; });
    await popupHt.waitForFunction(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sehuatang')?.status === 'success');
    assert.equal(await evaluate(popupHt, 'getSehuatangSignControlState().isSigned'), false, '按钮尚未更新时，已由独立成功浮层确认');
    assert.equal(await evaluate(popupHt, 'pageObserverStops.size'), 0, '成功后停止监听并移除点击事件');
    const popupRefreshState = await popupHt.evaluate(() => ({ records: [...__storage], action: sessionStorage.getItem('BBSSignHelperPageAction:sehuatang'), now: __now }));
    assert.ok(popupRefreshState.action, '刷新前保留本标签关页许可');
    await popupHt.close();
    const refreshedHt = await pageFor('https://www.sehuatang.org/plugin.php?id=dd_sign', '<div class="ddpc_sign_btna"><a class="ddpc_sign_btn_grey">今日已签到</a></div>');
    await refreshedHt.evaluate(state => {
        window.__storage = new Map(state.records); window.__now = state.now; sessionStorage.setItem('BBSSignHelperPageAction:sehuatang', state.action);
        window.__closes = 0; window.close = () => __closes++;
    }, popupRefreshState);
    await refreshedHt.evaluate(engine);
    await refreshedHt.waitForFunction(() => __closes === 1);
    assert.equal(await refreshedHt.evaluate(() => sessionStorage.getItem('BBSSignHelperPageAction:sehuatang')), null, '关页后消费许可');
    await refreshedHt.close();

    for (const [autoClose, click] of [[false, true], [true, false]]) {
        const gatedHt = await pageFor('https://www.sehuatang.org/plugin.php?id=dd_sign', htUnsigned);
        await evaluate(gatedHt, `updateDashboardPreference({autoClosePageAfterSign:${autoClose}})`);
        await gatedHt.evaluate(() => { window.__closes = 0; window.close = () => __closes++; });
        await gatedHt.evaluate(engine);
        if (click) await gatedHt.locator('#signin-btn').click();
        await gatedHt.evaluate(() => { const dialog = document.createElement('div'); dialog.className = 'alert_right'; dialog.textContent = '签到成功'; document.body.append(dialog); });
        await gatedHt.waitForFunction(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sehuatang')?.status === 'success');
        await gatedHt.waitForTimeout(850);
        assert.equal(await gatedHt.evaluate(() => __closes), 0, '未启用设置或本标签未发起签到时不自动关闭');
        await gatedHt.close();
    }
    const rejectedHt = await pageFor('https://www.sehuatang.org/plugin.php?id=dd_sign', htUnsigned);
    await rejectedHt.evaluate(engine);
    await rejectedHt.locator('#signin-btn').click();
    await rejectedHt.evaluate(() => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<p>签到成功是正常情况</p><div role="dialog">签到成功失败，发生错误</div><div class="alert_right" style="display:none">签到成功</div>';
        document.body.append(wrapper);
        const toast = document.querySelector('#toast'); toast.querySelector('.toast-text').textContent = '签到成功'; toast.className = 'toast success';
    });
    assert.notEqual(await result(rejectedHt, 'sehuatang'), 'success', '普通正文、失败提示和隐藏浮层不能误判成功');
    await rejectedHt.evaluate(() => { document.querySelector('#toast').className = 'toast show error'; });
    assert.notEqual(await result(rejectedHt, 'sehuatang'), 'success', '错误类型的站点 toast 不可作为成功证据');
    await rejectedHt.close();

    const closeHtPortal = await pageFor('https://www.limestart.cn/');
    await evaluate(closeHtPortal, "updateDashboardPreference({autoClosePageAfterSign:true}); launchTarget(getBuiltInTargets().find(t=>t.id==='sehuatang'))");
    const linkedHt = await pageFor(await closeHtPortal.evaluate(() => __tabs[0].url), htUnsigned);
    await linkedHt.evaluate(records => { window.__storage = new Map(records); window.close = () => {}; }, await closeHtPortal.evaluate(() => [...__storage]));
    await linkedHt.evaluate(engine);
    await closeHtPortal.evaluate(records => { window.__storage = new Map(records); }, await linkedHt.evaluate(() => [...__storage]));
    await evaluate(closeHtPortal, 'syncLaunchedAutoCloseTabs()');
    assert.equal(await evaluate(closeHtPortal, 'launchedAutoCloseTabs.size'), 1, '释放独占任务后仍保留控制台标签句柄');
    await linkedHt.locator('#signin-btn').click();
    await linkedHt.evaluate(() => { const dialog = document.createElement('div'); dialog.id = 'fwin_dialog'; dialog.textContent = '签到成功'; document.body.append(dialog); });
    await linkedHt.waitForFunction(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:sehuatang')?.status === 'success');
    await closeHtPortal.evaluate(records => { window.__storage = new Map(records); }, await linkedHt.evaluate(() => [...__storage]));
    await evaluate(closeHtPortal, 'syncLaunchedAutoCloseTabs()');
    assert.equal(await closeHtPortal.evaluate(() => __tabs[0].closed), true, '自身关页被拒绝时控制台可关闭实际签到任务的标签');
    await linkedHt.close(); await closeHtPortal.close();

    // 跳转仅移除本脚本参数，同一标签 sessionStorage 续接；普通同站标签不能认领。
    const linked = await pageFor('https://bbs.wcccc.cc/plugin.php?id=k_misign:sign&foo=keep');
    await evaluate(linked, "globalThis.op=acquireTaskLease('wcccc','page'); globalThis.url=new URL(location.href); url.searchParams.set('__bbs_task',op.taskId); history.replaceState(null,'',url.href); globalThis.bound=bindPageTask('wcccc')");
    assert.equal(await linked.evaluate(() => new URL(location.href).searchParams.get('foo')), 'keep');
    assert.equal(await linked.evaluate(() => new URL(location.href).searchParams.has('__bbs_task')), false);
    await linked.evaluate(() => history.replaceState(null, '', '/result'));
    assert.equal(await evaluate(linked, "bindPageTask('wcccc').taskId === op.taskId"), true);
    await linked.close();

    // 控制台打开SS → 找帖失败并结束任务 → 用户过期后刷新 → 确认本人评论 → 原句柄关页。
    const retryOrigin = await pageFor('https://www.limestart.cn/');
    await evaluate(retryOrigin, "updateDashboardPreference({autoClosePageAfterSign:true}); launchTarget(getBuiltInTargets().find(t=>t.id==='sstm'))");
    const launch = await retryOrigin.evaluate(() => ({ url: __tabs[0].url, records: [...__storage] }));
    const refreshCloseSstm = await pageFor(launch.url, '<h1 class="ipsType_pageTitle">同盟签到区</h1><a id="elUserLink" href="/profile/7-me/">本人</a>');
    await refreshCloseSstm.evaluate(records => {
        window.__storage = new Map(records); window.__closes = 0; window.close = () => __closes++;
    }, launch.records);
    await refreshCloseSstm.evaluate(engine);
    assert.equal(await result(refreshCloseSstm, 'sstm'), 'failed');
    const failedSstmTask = await evaluate(refreshCloseSstm, "getTaskLease('sstm')");
    assert.equal(failedSstmTask.expiresAt, 0);
    await retryOrigin.evaluate(records => { window.__storage = new Map(records); window.__now += 601000; }, await refreshCloseSstm.evaluate(() => [...__storage]));
    await evaluate(retryOrigin, 'syncLaunchedAutoCloseTabs()');
    assert.equal(await evaluate(retryOrigin, 'launchedAutoCloseTabs.size'), 1, '失败后仍保留原标签句柄等待用户刷新');
    await refreshCloseSstm.evaluate(() => {
        window.__now += 601000;
        history.replaceState(null, '', '/topic/123-test/');
        document.body.innerHTML = '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="/profile/7-me/">本人</a><div data-role="commentFeed"><article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">2026年10月9日 12:12:00</div></article></div>';
    });
    await refreshCloseSstm.evaluate(engine);
    assert.equal(await result(refreshCloseSstm, 'sstm'), 'success');
    assert.equal(await evaluate(refreshCloseSstm, "getRawTargetStatus('sstm').taskId"), failedSstmTask.taskId);
    await retryOrigin.evaluate(records => { window.__storage = new Map(records); }, await refreshCloseSstm.evaluate(() => [...__storage]));
    await retryOrigin.evaluate(() => { window.__closeAttempts = 0; __tabs[0].close = () => { if (++__closeAttempts === 2) __tabs[0].closed = true; }; });
    await evaluate(retryOrigin, 'syncLaunchedAutoCloseTabs()');
    assert.equal(await retryOrigin.evaluate(() => __tabs[0].closed), false, '首次关页尚未生效');
    assert.equal(await evaluate(retryOrigin, 'launchedAutoCloseTabs.size'), 1, '真实引擎确认成功后仍保留尚未关闭的句柄');
    await retryOrigin.evaluate(() => { window.__now += 2000; });
    await evaluate(retryOrigin, 'syncLaunchedAutoCloseTabs()');
    assert.equal(await retryOrigin.evaluate(() => __tabs[0].closed), true, '刷新成功后通过原控制台句柄重试关闭');
    await refreshCloseSstm.waitForFunction(() => __closes === 1);
    assert.equal(await refreshCloseSstm.evaluate(() => __requests.length), 0, '已有本人评论不重复提交');
    await refreshCloseSstm.close(); await retryOrigin.close();

    // 从旧版状态/租约进入完整主引擎，不能只验证直接调用站点函数的理想路径。
    const legacyHunt = await pageFor('https://www.fufugal.com/', '<div id="photo_wrap"><div class="user-infos"><button class="xbs">寻宝</button></div></div>');
    await legacyHunt.evaluate(() => {
        window.__huntClicks = 0;
        document.querySelector('button').onclick = () => __huntClicks++;
        localStorage.setItem('user', JSON.stringify({ token: 'HUNT_TOKEN_SECRET' }));
        __fetchResponses.push({ text: JSON.stringify({ code: 200, obj: ['寻宝结束，守护灵进入休息状态'] }) });
    });
    await seedLegacyPageTask(legacyHunt, 'fufugal', 'result-unknown', 'hunt-click');
    await legacyHunt.evaluate(engine);
    assert.equal(await legacyHunt.evaluate(() => __huntClicks), 0, '改用 API 后不再点击寻宝按钮');
    assert.equal(await legacyHunt.evaluate(() => __requests.length), 1, '旧未知状态和隐式只读租约不能阻止寻宝 API');
    assert.equal(await result(legacyHunt, 'fufugal'), 'success');
    await legacyHunt.close();

    const legacyWang = await pageFor('https://laowang.vip/plugin.php?id=k_misign:sign', '<form id="v2_captcha_form">请点击下面的按钮验证<input id="clicaptcha-submit-info"><button type="button" id="submit-btn">提交</button></form>');
    await legacyWang.evaluate(() => { window.__captchaSubmits = 0; document.querySelector('button').onclick = () => { __captchaSubmits++; document.querySelector('button').classList.add('btnvisted'); }; });
    await seedLegacyPageTask(legacyWang, 'laowang', 'result-unknown', 'sign-click');
    await legacyWang.evaluate(engine);
    assert.equal(await result(legacyWang, 'laowang'), 'needs-foreground');
    assert.equal(await legacyWang.evaluate(() => __captchaSubmits), 0);
    await legacyWang.evaluate(() => { document.querySelector('input').value = 'manual-pass_ok'; });
    await legacyWang.waitForFunction(() => __captchaSubmits === 1);
    await legacyWang.waitForFunction(() => GM_getValue('BBSSignHelperDashboardStatus:2026-10-09:laowang')?.status === 'success');
    assert.equal(await legacyWang.evaluate(() => __captchaSubmits), 1, '验证码页跳转前的入口点击不能阻止验证后的自动提交');
    await legacyWang.close();

    const portalMarkup = '<h1 class="ipsType_pageTitle">【2026/10/9】签到</h1><a id="elUserLink" href="#elUserLink_menu">本人</a><div data-role="commentFeed"></div><div data-role="replyArea"><form id="placeholder-form"><div class="ipsComposeArea"><div class="ipsComposeArea_dummy" tabindex="0">回复此主题</div></div></form></div>';
    const portalSstm = await pageFor('https://sstm.moe/topic/123-test/', portalMarkup);
    await portalSstm.evaluate(() => {
        window.__replySubmits = 0;
        document.querySelector('.ipsComposeArea_dummy').onclick = () => {
            if (document.querySelector('#portal-editor')) return;
            const form = document.createElement('form'); form.id = 'portal-editor'; form.innerHTML = '<div contenteditable="true" style="min-height:40px"></div><button type="submit" class="ipsButton_primary">提交回复</button>'; document.querySelector('[data-role="replyArea"]').append(form);
            form.onsubmit = event => { event.preventDefault(); __replySubmits++; document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + form.querySelector('[contenteditable]').textContent + '</div></article>'; };
        };
    });
    await seedLegacyPageTask(portalSstm, 'sstm', 'needs-foreground');
    await portalSstm.evaluate(engine);
    assert.equal(await result(portalSstm, 'sstm'), 'success', '编辑器挂到占位表单外时仍应填入并提交');
    assert.equal(await portalSstm.evaluate(() => __replySubmits), 1);
    await portalSstm.close();

    const retrySstm = await pageFor('https://sstm.moe/topic/123-test/', portalMarkup);
    await retrySstm.evaluate(() => {
        const originalSet = GM_setValue;
        window.GM_setValue = (key, value) => { originalSet(key, value); localStorage.setItem('__testGM', JSON.stringify([...__storage])); };
    });
    await seedLegacyPageTask(retrySstm, 'sstm', 'needs-foreground');
    const retryNavigation = retrySstm.waitForEvent('framenavigated', { predicate: frame => frame === retrySstm.mainFrame() });
    await retrySstm.evaluate(engine).catch(error => { if (!/context.*destroyed|navigation/i.test(error.message)) throw error; });
    await retryNavigation;
    await retrySstm.waitForLoadState('domcontentloaded');
    await retrySstm.evaluate(() => { window.__storage = new Map(JSON.parse(localStorage.getItem('__testGM'))); });
    assert.equal(await retrySstm.evaluate(() => GM_getValue('sstm_retry_count')), 1, '未定位编辑器时恢复原有自动刷新重试');
    await retrySstm.evaluate(html => {
        document.body.innerHTML = html;
        document.querySelector('[data-role="replyArea"]').insertAdjacentHTML('beforeend', '<form id="elReplyForm"><div contenteditable="true" style="min-height:40px"></div><button type="submit" class="ipsButton_primary">提交回复</button></form>');
        document.querySelector('form#placeholder-form').remove();
        window.__retrySubmits = 0;
        document.querySelector('form').onsubmit = event => { event.preventDefault(); __retrySubmits++; document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + document.querySelector('[contenteditable]').textContent + '</div></article>'; };
    }, portalMarkup);
    await retrySstm.evaluate(isolated);
    await retrySstm.evaluate(engine);
    assert.equal(await result(retrySstm, 'sstm'), 'success', '刷新后编辑器就绪应继续填入并自动提交');
    assert.equal(await retrySstm.evaluate(() => __retrySubmits), 1);
    assert.equal(await retrySstm.evaluate(() => GM_getValue('sstm_retry_count')), 0);
    await retrySstm.close();

    const cappedSstm = await pageFor('https://sstm.moe/topic/123-test/', portalMarkup);
    await cappedSstm.evaluate(() => {
        GM_setValue('sstm_retry_count', 3);
        window.__retryAlerts = 0;
        window.alert = () => __retryAlerts++;
    });
    await cappedSstm.evaluate(engine);
    assert.equal(await result(cappedSstm, 'sstm'), 'needs-foreground');
    assert.equal(await cappedSstm.evaluate(() => __retryAlerts), 0, '达到3次上限时保留状态提示，不用阻塞式弹窗');
    assert.equal(await evaluate(cappedSstm, "getRawTargetStatus('sstm').stage"), 'retry');
    await cappedSstm.close();

    const restoredSstm = await pageFor('https://sstm.moe/topic/123-test/', portalMarkup);
    await restoredSstm.evaluate(() => {
        window.__restoredSubmits = 0;
        // 模拟编辑器已展开、位于评论容器内；原流程全页寻找可见编辑器。
        document.querySelector('.ipsComposeArea').insertAdjacentHTML('afterend', '<article class="ipsComment"><div contenteditable="true" style="min-height:40px"></div><button type="submit" class="ipsButton_primary">提交回复</button></article>');
        document.querySelector('form').onsubmit = event => {
            event.preventDefault(); __restoredSubmits++;
            document.querySelector('[data-role="commentFeed"]').innerHTML = '<article class="ipsComment"><aside class="cAuthorPane"><h3><a href="/profile/7-me/">本人</a></h3></aside><div data-role="commentContent">' + document.querySelector('[contenteditable]').textContent + '</div></article>';
        };
    });
    await seedLegacyPageTask(restoredSstm, 'sstm', 'result-unknown', 'reply-submit');
    await restoredSstm.evaluate(engine);
    assert.equal(await restoredSstm.evaluate(() => __restoredSubmits), 1, '旧未知状态及泛用动作记录不能拦截新版填写和提交流程');
    assert.equal(await result(restoredSstm, 'sstm'), 'success');
    await restoredSstm.evaluate(engine);
    assert.equal(await restoredSstm.evaluate(() => __restoredSubmits), 1, '检测到完成记录后不再次提交');
    await restoredSstm.close();

    const explicitHunt = await pageFor('https://www.fufugal.com/', '<div id="photo_wrap"><div class="user-infos"><button class="xbs">寻宝</button></div></div>');
    await explicitHunt.evaluate(() => { window.__huntClicks = 0; document.querySelector('button').onclick = () => __huntClicks++; });
    await seedLegacyPageTask(explicitHunt, 'fufugal', 'result-unknown');
    await evaluate(explicitHunt, "GM_setValue(getScopedStorageKey(STORAGE_KEYS.task,'fufugal'),{...getTaskLease('fufugal'),checkOnly:true,checkOnlySource:'explicit'})");
    await explicitHunt.evaluate(engine);
    assert.equal(await explicitHunt.evaluate(() => __huntClicks), 0, '用户显式重新检查仍不能触发寻宝动作');
    assert.equal(await explicitHunt.evaluate(() => __requests.length), 0, '只读复查不得发送 GET /hunt');
    assert.equal(await evaluate(explicitHunt, "getRawTargetStatus('fufugal').reasonCode"), 'readonly-unavailable');
    assert.equal(await evaluate(explicitHunt, "hasActiveTask('fufugal')"), false, '只读复查结束后释放页面租约');
    assert.equal(await evaluate(explicitHunt, "buildSignDebugExport().logs.at(-1).mode"), 'check', '诊断区分只读检查和实际执行');
    const checkedHuntStorage = await explicitHunt.evaluate(() => [...__storage]);
    await explicitHunt.close();

    // 用户日志中的空请求复查必须能从控制台继续执行，且兼容旧版遗留的只读租约。
    const huntPortal = await pageFor('https://www.limestart.cn/');
    await huntPortal.evaluate(records => { window.__storage = new Map(records); }, checkedHuntStorage);
    await evaluate(huntPortal, `
        const oldCheck = getTaskLease('fufugal');
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.task,'fufugal'), {...oldCheck, checkOnly:true, checkOnlySource:'explicit', expiresAt:Date.now()+600000});
        showDashboard();
    `);
    assert.equal(await evaluate(huntPortal, "hasActiveTask('fufugal')"), true, '模拟尚未释放的旧复查租约');
    const huntRow = huntPortal.locator('[data-target="fufugal"]');
    await huntRow.getByRole('button', { name: '继续寻宝', exact: true }).click();
    assert.equal(await huntPortal.evaluate(() => __tabs.length), 1, '继续入口解除旧复查并打开执行页面');
    assert.equal(await evaluate(huntPortal, "getTaskLease('fufugal').checkOnly"), false, '继续寻宝启动实际执行任务');
    assert.notEqual(await evaluate(huntPortal, "getTaskLease('fufugal').taskId"), checkedHuntStorage.find(([key]) => key === 'BBSSignHelperTask:fufugal')[1].taskId);
    const resumedHunt = await pageFor(await huntPortal.evaluate(() => __tabs[0].url));
    await resumedHunt.evaluate(records => {
        window.__storage = new Map(records);
        localStorage.setItem('user', JSON.stringify({ token: 'HUNT_TOKEN_SECRET' }));
        __fetchResponses.push({ text: JSON.stringify({ code: 688 }) });
    }, await huntPortal.evaluate(() => [...__storage]));
    await resumedHunt.evaluate(engine);
    assert.equal(await resumedHunt.evaluate(() => __requests.length), 1, '控制台继续入口实际发送寻宝 API');
    assert.equal(await result(resumedHunt, 'fufugal'), 'success', '已完成响应也能结束待检查状态');
    assert.equal(await evaluate(resumedHunt, "hasActiveTask('fufugal')"), false);
    await huntPortal.evaluate(records => { window.__storage = new Map(records); }, await resumedHunt.evaluate(() => [...__storage]));
    await evaluate(huntPortal, 'refreshDashboardData()');
    await huntRow.locator('summary').click();
    await huntRow.getByRole('button', { name: '重新检查', exact: true }).last().click();
    assert.equal(await evaluate(huntPortal, "getTaskLease('fufugal').checkOnly"), true, '更多菜单的重新检查仍启动只读任务');
    await resumedHunt.close(); await huntPortal.close();

    const refresh = await pageFor('https://zodgame.xyz/plugin.php?id=dsu_paulsign:sign', '<div>今天签到了吗 写下今天最想说的话</div><form id="qiandao"></form>');
    await refresh.evaluate(() => {
        window.__submits = 0; document.querySelector('form').submit = () => __submits++;
        __storage.set('BBSSignHelperTask:ZodGame', { taskId: 'yesterday', date: '2026-10-08', expiresAt: 0 });
    });
    await refresh.evaluate(engine);
    assert.equal(await refresh.evaluate(() => __submits), 1, '昨日租约不妨碍新一日正常执行');
    assert.equal(await result(refresh, 'ZodGame'), 'result-unknown');
    await refresh.evaluate(engine);
    assert.equal(await refresh.evaluate(() => __submits), 1, '提交后刷新只查结果');
    await refresh.evaluate(() => { history.replaceState(null, '', '/plugin.php?id=dsu_paulsign:sign&result=done'); document.body.innerHTML = '<div id="ct"><div class="mn"><h1>您今天已经签到过了</h1></div></div>'; });
    await refresh.evaluate(engine);
    assert.equal(await result(refresh, 'ZodGame'), 'success');
    assert.equal(await refresh.evaluate(() => __submits), 1);
    await refresh.close();
    for (const [key, url, html, gm, payload] of [
        ['fxacg', 'https://feixueacg.org/', '', '<form id="signform">签到说明</form>', null],
        ['kfpromax', 'https://www.limestart.cn/', '', '<div id="kf_topuser">本人</div><a href="kf_growup.php?ok=3&safeid=sample">领取</a>', null],
        ['sijishe', 'https://sjs96.com/', '', 'discuz_uid=7;<a id="JD_sign" href="plugin.php?id=k_misign:sign&operation=qiandao">签到</a>', null],
        ['uugg', 'https://www.uu-gg.one/plugin.php?id=dsu_paulsign:sign', '<div>签到服务台 今天未签到</div><form id="qiandao"></form>', null, null],
        ['acgndog', 'https://www.acgndog.com/', '', null, { user: { isLoggedIn: true }, _nonce: 'sample', customPointSignDaily: { signed: false } }],
        ['vik', 'https://www.vikacg.com/wallet/mission', '', null, { status: 'success', data: { basic: { id: 7 }, credit: { sign_time: 0 } } }],
        ['sl-asmr', 'https://www.sl-asmr.com/', '', null, null],
        ['2dfan', 'https://2dfan.com/checkin', '<div class="checkin-info"><span class="pull-right">已连续签到12天</span></div>', null, null],
        ['laowang', 'https://laowang.vip/', '<div>其他用户已签到</div>', null, null],
        ['galGameXNew', 'https://www.galgamex.net/', '<button>今日已完成</button><div>签到成功指南</div>', null, null],
        ['soushuba', 'https://sp6m.fwsefwef66s.com/', '<form id="lsform">登录</form>', null, null],
        ['sehuatang', 'https://sehuatang.org/forum.php', '<div>尚未回复</div>', null, null]
    ]) {
        const page = await pageFor(url, html);
        await page.evaluate(({ gm, payload }) => { if (location.hostname.includes('uu-gg')) window.discuz_uid = 7; if (gm) { if (location.hostname === 'sjs96.com') __fetchResponses.push({ text: gm, headers: { 'Content-Type': 'text/html' } }); else __responses.push({ responseText: gm }); } if (payload) __fetchResponses.push({ text: JSON.stringify(payload) }); if (location.hostname.includes('vikacg')) localStorage.setItem('token', 'x'.repeat(80)); }, { gm, payload });
        const checked = await evaluate(page, `siteConfigs.find(s=>s.key===${JSON.stringify(key)}).check(startSignDebugCapture(${JSON.stringify(key)},'只读样例','check'))`);
        assert.notEqual(checked.outcome, 'success', key + '未签/无证据不能成功');
        const requests = await page.evaluate(() => __requests);
        assert.ok(!requests.some(item => /ok=3|operation=qiandao|type=goSign|userMission|actions=job|mission\/fast/.test(item.url)), key + '只读不产生签到请求');
        await page.close();
    }
    assert.equal(new Set(verified).size, 17);
    console.log('通过：17站隔离样例；SS新版完整引擎、CKEditor异步写入/隐藏字段同步/可用按钮、40页一次本人过滤、次日作者过滤404继续首次提交/待确认不重发/权限验证不放行、刷新重试上限；青葱寻宝、老王验证后提交、显式复查、维咔令牌/Cookie回退、GBK及跨跳转关联。');
} finally { await context.close(); await browser.close(); }
