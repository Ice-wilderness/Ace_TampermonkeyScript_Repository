import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { source } from './fixture.mjs';

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
    await ui.locator('dialog').getByText('关闭', { exact: true }).click();
    assert.equal(await evaluate(ui, 'JSON.stringify(getStatusStore())'), beforeDiagnostics);
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

    // 真实截图中的自绘报告没有 role/Element UI 类，且报告会逐步更新。
    const customHunt = await pageFor('https://www.fufugal.com/', '<div id="photo_wrap"><div class="user-infos"><button class="xbs">寻宝</button></div></div>');
    await customHunt.evaluate(() => {
        window.__huntClicks = 0; window.__huntTicks = 0;
        document.querySelector('button').onclick = () => {
            __huntClicks++;
            const report = document.createElement('div'); report.id = 'custom-report';
            report.innerHTML = '<h3>寻宝报告</h3><p>守护灵开始锻炼，进入小世界</p>'; document.body.append(report);
        };
    });
    await evaluate(customHunt, `delay = async ms => { window.__now += ms; if (++window.__huntTicks === 3) document.querySelector('#custom-report').innerHTML = '<h3>寻宝报告</h3><p>战斗失败，离开小世界</p><p>最后携带回了1积分</p><p>寻宝结束，守护灵进入休息状态</p><button>确定</button>'; }`);
    await runSite(customHunt, 'fufugal');
    assert.equal(await result(customHunt, 'fufugal'), 'success', '自绘报告中的结束状态应确认完成');
    assert.equal(await customHunt.evaluate(() => __huntClicks), 1);
    await evaluate(customHunt, "checkSiteResult(siteConfigs.find(s=>s.key==='fufugal'))");
    assert.equal(await customHunt.evaluate(() => __huntClicks), 1, '报告复查不能重复寻宝');
    await customHunt.evaluate(() => document.querySelector('#photo_wrap').remove());
    await runSite(customHunt, 'fufugal');
    assert.equal(await result(customHunt, 'fufugal'), 'success', '已显示完成报告时不要求寻宝按钮仍存在');
    await customHunt.close();

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
        ['fxacg', '', '今日已签到'], ['southplus', '', '还没超过刷新时间'], ['sl-asmr', '', '您已签到'],
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

    const manualHt = await pageFor('https://sehuatang.org/forum.php', '<div>98堂论坛</div>');
    await runSite(manualHt, 'sehuatang');
    assert.equal(await result(manualHt, 'sehuatang'), 'needs-foreground');
    assert.equal(await manualHt.evaluate(() => location.pathname), '/forum.php');
    assert.equal(await manualHt.evaluate(() => __requests.length), 0);
    await manualHt.close();

    // 跳转仅移除本脚本参数，同一标签 sessionStorage 续接；普通同站标签不能认领。
    const linked = await pageFor('https://bbs.wcccc.cc/plugin.php?id=k_misign:sign&foo=keep');
    await evaluate(linked, "globalThis.op=acquireTaskLease('wcccc','page'); globalThis.url=new URL(location.href); url.searchParams.set('__bbs_task',op.taskId); history.replaceState(null,'',url.href); globalThis.bound=bindPageTask('wcccc')");
    assert.equal(await linked.evaluate(() => new URL(location.href).searchParams.get('foo')), 'keep');
    assert.equal(await linked.evaluate(() => new URL(location.href).searchParams.has('__bbs_task')), false);
    await linked.evaluate(() => history.replaceState(null, '', '/result'));
    assert.equal(await evaluate(linked, "bindPageTask('wcccc').taskId === op.taskId"), true);
    await linked.close();

    // 从旧版状态/租约进入完整主引擎，不能只验证直接调用站点函数的理想路径。
    const legacyHunt = await pageFor('https://www.fufugal.com/', '<div id="photo_wrap"><div class="user-infos"><button class="xbs">寻宝</button></div></div>');
    await legacyHunt.evaluate(() => {
        window.__huntClicks = 0;
        document.querySelector('button').onclick = () => { __huntClicks++; const report = document.createElement('div'); report.innerHTML = '<h3>寻宝报告</h3><p>最后携带回了1积分</p><p>寻宝结束，守护灵进入休息状态</p><button>确定</button>'; document.body.append(report); };
    });
    await seedLegacyPageTask(legacyHunt, 'fufugal', 'result-unknown', 'hunt-click');
    await legacyHunt.evaluate(engine);
    assert.equal(await legacyHunt.evaluate(() => __huntClicks), 1, '旧未知状态和隐式只读租约不能阻止寻宝点击');
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
    await explicitHunt.close();

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
        ['southplus', 'https://www.south-plus.net/', '', null, null],
        ['sl-asmr', 'https://www.sl-asmr.com/', '', null, null],
        ['2dfan', 'https://2dfan.com/checkin', '<div class="checkin-info"><span class="pull-right">已连续签到12天</span></div>', null, null],
        ['laowang', 'https://laowang.vip/', '<div>其他用户已签到</div>', null, null],
        ['galGameXNew', 'https://www.galgamex.net/', '<button>今日已完成</button><div>签到成功指南</div>', null, null],
        ['soushuba', 'https://sp6m.fwsefwef66s.com/', '<form id="lsform">登录</form>', null, null],
        ['sehuatang', 'https://sehuatang.org/forum.php', '<div>尚未回复</div>', null, null]
    ]) {
        const page = await pageFor(url, html);
        await page.evaluate(({ gm, payload }) => { if (location.hostname.includes('uu-gg')) window.discuz_uid = 7; if (gm) __responses.push({ responseText: gm }); if (payload) __fetchResponses.push({ text: JSON.stringify(payload) }); if (location.hostname.includes('vikacg')) localStorage.setItem('token', 'x'.repeat(80)); }, { gm, payload });
        const checked = await evaluate(page, `siteConfigs.find(s=>s.key===${JSON.stringify(key)}).check(startSignDebugCapture(${JSON.stringify(key)},'只读样例','check'))`);
        assert.notEqual(checked.outcome, 'success', key + '未签/无证据不能成功');
        const requests = await page.evaluate(() => __requests);
        assert.ok(!requests.some(item => /ok=3|operation=qiandao|type=goSign|userMission|actions=job|mission\/fast/.test(item.url)), key + '只读不产生签到请求');
        await page.close();
    }
    assert.equal(new Set(verified).size, 17);
    console.log('通过：17站隔离样例；SS新版完整引擎、CKEditor异步写入/隐藏字段同步/可用按钮、40页一次本人过滤、待确认不重发、刷新重试上限；青葱寻宝、老王验证后提交、显式复查、维咔令牌/Cookie回退、GBK及跨跳转关联。');
} finally { await context.close(); await browser.close(); }
