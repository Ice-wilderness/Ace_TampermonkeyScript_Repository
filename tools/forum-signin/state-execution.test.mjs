import assert from 'node:assert/strict';
import { createFixture } from './fixture.mjs';

const f = await createFixture();
assert.equal(f.run("markSignSuccess('wcccc')"), false, '没有证据不能成功');
f.run("globalThis.targets = getBuiltInTargets().slice(0,3); markTargetsSuccess(targets)");
assert.equal(f.run('undoManualStatus().restored'), 3);
f.run("completeSign('wcccc','今日已签到'); setManualTargetStatus(getBuiltInTargets().find(t=>t.id==='wcccc'),'skipped')");
assert.equal(f.run("getData('wcccc')"), '');
assert.equal(f.run('undoManualStatus().restored'), 1);
assert.equal(f.run("getRawTargetStatus('wcccc').confirmationSource"), 'automatic');
assert.equal(f.run("getData('wcccc')"), f.run('getToday()'));
f.run("globalThis.op = acquireTaskLease('fxacg'); globalThis.ctx = {operation:op}; globalThis.actions = taskActions(ctx); resetTargetStatus(getBuiltInTargets().find(t=>t.id==='fxacg'))");
assert.equal(f.run("actions.completeSign('fxacg','今日已签到')"), false);

// 各站立即并行执行、同实例复用和逐项失败隔离。
const q = await createFixture();
q.run(`globalThis.calls=[]; globalThis.pending=[];
    for (const site of siteConfigs.filter(s=>s.directRun)) site.directRun = ctx => {
        calls.push(site.key); return new Promise(resolve => pending.push(() => { taskActions(ctx).completeSign(site.key,'明确今日完成'); resolve(true); }));
    };
    globalThis.ts=getBuiltInTargets().filter(t=>t.directApi);
    globalThis.jobs=ts.map(t=>runDirectTarget(t));`);
assert.equal(q.run('calls.length'), q.run('ts.length'), '所有直签立即启动，不等候名额');
assert.equal(q.run('runDirectTarget(ts[0]) === jobs[0]'), true);
assert.equal(q.run("getRawTargetStatus(ts[3].id).status"), 'running');
await q.tick(45000);
assert.equal(q.run('hasActiveTask(ts[3].id)'), true, '执行中的站点独立续约');
q.run('pending.shift()()'); await q.tick(1);
assert.equal(q.run('calls.length'), q.run('ts.length'));
while (q.run('pending.length')) { q.run('pending.shift()()'); await q.tick(1); }
await Promise.all(q.run('jobs'));
await q.tick(1);
assert.equal(q.run('directTasks.size'), 0);

// 跨上下文租约、过期恢复与昨日回包。
const abandonedSouth = await createFixture();
abandonedSouth.run("globalThis.op=acquireTaskLease('southplus','page'); recordTargetStatus('southplus','running',{context:op})");
await abandonedSouth.tick(31000);
assert.equal(abandonedSouth.run("hasActiveTask('southplus')"), false, '页面异常退出且无法发送离页事件时，South-Plus 不占用十分钟');
assert.equal(abandonedSouth.run("getNormalizedTargetStatus(getBuiltInTargets().find(t=>t.id==='southplus')).status"), 'result-unknown');
assert.ok(abandonedSouth.run("acquireTaskLease('southplus','page')"), '超期后可重新查询实际状态');
const shared = new Map();
const a = await createFixture({ storage: shared });
const b = await createFixture({ storage: shared });
a.run("acquireTaskLease('fxacg')");
assert.equal(b.run("acquireTaskLease('fxacg')"), null);
await b.tick(31000);
assert.ok(b.run("acquireTaskLease('fxacg')"));
assert.equal(a.run("isOperationCurrent({key:'fxacg',date:getToday(),mutationId:'',taskId:'old'})"), false);
a.run("globalThis.yesterday=captureOperation('wcccc')");
await a.tick(24*60*60*1000);
assert.equal(a.run("completeSign('wcccc','迟到成功',{context:yesterday})"), false);

// 所有前台站点立即独立打开；重复点击不会重复打开同站。
const pages = await createFixture();
pages.run("globalThis.front=getBuiltInTargets().filter(t=>t.openMode==='foreground'&&!t.directApi); front.forEach(t=>launchTarget(t));");
assert.equal(pages.tabs.length, pages.run('front.length'));
assert.equal(pages.run("front.every(t=>getRawTargetStatus(t.id).status==='opened')"), true);
const reopened = await createFixture({ storage: pages.storage });
assert.equal(reopened.run("acquireTaskLease(getBuiltInTargets().filter(t=>t.openMode==='foreground'&&!t.directApi)[1].id)"), null, '另一控制台不能重复打开已有页面');
await reopened.tick(601000);
assert.equal(reopened.run("getNormalizedTargetStatus(getBuiltInTargets().filter(t=>t.openMode==='foreground'&&!t.directApi)[1]).status"), 'result-unknown', '未完成页面到期可恢复');
reopened.run("launchTarget(getBuiltInTargets().filter(t=>t.openMode==='foreground'&&!t.directApi)[1])");
assert.equal(reopened.run("getTaskLease(getBuiltInTargets().filter(t=>t.openMode==='foreground'&&!t.directApi)[1].id).checkOnly"), false, '正常打开不能因为旧的未完成状态被隐式变成只读');
pages.run('front.forEach(t=>launchTarget(t))');
assert.equal(pages.tabs.length, pages.run('front.length'));
pages.tabs[0].closed = true;
pages.run('syncLaunchedAutoCloseTabs()');
assert.equal(pages.run("getRawTargetStatus(front[0].id).status"), 'result-unknown');
const legacyQueue = await createFixture();
legacyQueue.run("globalThis.front=getBuiltInTargets().find(t=>t.openMode==='foreground'&&!t.directApi); globalThis.op=acquireTaskLease(front.id,'page'); recordTargetStatus(front.id,'queued',{context:op,stage:'foreground-queue'}); launchTarget(front)");
assert.equal(legacyQueue.tabs.length, 1, '旧版本排队记录不阻塞新版本立即打开');
assert.equal(legacyQueue.run('getTaskLease(front.id).checkOnly'), false, '未执行的旧排队记录可正常签到');
const denied = await createFixture({ openTab: () => null });
denied.run("launchTarget(getBuiltInTargets().find(t=>t.id==='wcccc'))");
assert.equal(denied.run("getRawTargetStatus('wcccc').reasonCode"), 'open-failed');
const degraded = await createFixture({ openTab: () => undefined });
degraded.run("launchTarget(getBuiltInTargets().find(t=>t.id==='wcccc'))");
assert.equal(degraded.run("getRawTargetStatus('wcccc').status"), 'opened');
assert.ok(degraded.run("getRawTargetStatus('wcccc').message.includes('无法跟踪')"));
assert.equal(degraded.run("hasActiveTask('wcccc')"), true);
degraded.run("launchTarget(getBuiltInTargets().find(t=>t.id==='wcccc'))");
assert.equal(degraded.run('launchedAutoCloseTabs.size'), 1);
const fallbackTab = await createFixture();
fallbackTab.run("GM_openInTab=undefined; globalThis.tabHandle={opener:window}; window.open=()=>tabHandle; openUrl('https://example.test/','foreground')");
assert.equal(fallbackTab.run('tabHandle.opener'), null);

// 标签关联、手动成功不关闭、对应自动确认才关闭。
const tabs = await createFixture();
tabs.run("updateDashboardPreference({autoClosePageAfterSign:true}); globalThis.t=getBuiltInTargets().find(t=>t.id==='wcccc'); launchTarget(t)");
const token = tabs.run("getTaskLease('wcccc').taskId");
const page = await createFixture({ storage: tabs.storage });
page.context.location.hostname = 'wcccc.cc';
page.context.location.href = 'https://wcccc.cc/?__bbs_task=' + token;
page.run("globalThis.pageOp=bindPageTask('wcccc')");
assert.equal(page.run('pageOp.taskId'), token);
const unrelated = await createFixture({ storage: tabs.storage });
assert.equal(unrelated.run("bindPageTask('wcccc')"), null);
tabs.run("setManualTargetStatus(t,'success'); syncLaunchedAutoCloseTabs()");
assert.equal(tabs.tabs[0].closed, false);
tabs.run("resetTargetStatus(t); launchTarget(t); globalThis.action={operation:getTaskLease('wcccc')}; taskActions(action).completeSign('wcccc','明确今日已签到'); finishTaskLease(action.operation); syncLaunchedAutoCloseTabs()");
assert.equal(tabs.tabs[1].closed, true);

// 老王验证码页确认成功并结束租约后，原标签的延迟关页与控制台句柄都仍有效。
const wang = await createFixture();
wang.run("updateDashboardPreference({autoClosePageAfterSign:true}); globalThis.t=getBuiltInTargets().find(t=>t.id==='laowang'); launchTarget(t)");
const wangPage = await createFixture({ storage: wang.storage });
wangPage.context.location.hostname = 'laowang.vip';
wangPage.context.location.href = 'https://laowang.vip/plugin.php?id=k_misign:sign&__bbs_task=' + wang.run("getTaskLease('laowang').taskId");
wangPage.run("globalThis.closes=0; window.close=()=>closes++; globalThis.op=bindPageTask('laowang'); pageOperations.set('laowang',op); markPendingAutoCloseAfterSignAction('laowang','captcha-submit'); taskActions({operation:op}).completeSign('laowang','人工验证后已自动签到成功'); finishTaskLease(op)");
assert.equal(wangPage.run("hasActiveTask('laowang')"), false);
await wangPage.tick(800);
assert.equal(wangPage.run('closes'), 1);
wang.run('syncLaunchedAutoCloseTabs()');
assert.equal(wang.tabs[0].closed, true, '成功不能因租约先结束而丢失关页句柄');
for (const invalidate of [
    "finishTaskLease(getTaskLease('laowang'))",
    "setManualTargetStatus(t,'success')",
    "taskActions({operation:getTaskLease('laowang')}).completeSign('laowang','明确成功'); finishTaskLease(getTaskLease('laowang')); acquireTaskLease('laowang','page')",
    "taskActions({operation:getTaskLease('laowang')}).completeSign('laowang','明确成功'); resetTargetStatus(t)"
]) {
    const stale = await createFixture();
    stale.run("updateDashboardPreference({autoClosePageAfterSign:true}); globalThis.t=getBuiltInTargets().find(t=>t.id==='laowang'); launchTarget(t);" + invalidate + '; syncLaunchedAutoCloseTabs()');
    assert.equal(stale.tabs[0].closed, false, '无自动成功证据、人工成功、替换或重置不能关闭旧标签');
}

// SS失败页刷新：结束/过期的任务续接原编号，控制台保留原句柄直至真正完成。
for (const ended of [false, true]) {
    const sstm = await createFixture();
    sstm.run("updateDashboardPreference({autoClosePageAfterSign:true}); globalThis.t=getBuiltInTargets().find(t=>t.id==='sstm'); launchTarget(t)");
    const retry = await createFixture({ storage: sstm.storage });
    const id = sstm.run("getTaskLease('sstm').taskId");
    retry.context.location.hostname = 'sstm.moe';
    retry.context.location.href = 'https://sstm.moe/topic/123-test/?__bbs_task=' + id;
    retry.run("globalThis.op=bindPageTask('sstm'); recordTargetStatus('sstm','failed',{context:op,stage:'editor'})");
    if (ended) retry.run('finishTaskLease(op)');
    await sstm.tick(601000);
    await retry.tick(601000);
    assert.equal(sstm.run('launchedAutoCloseTabs.size'), 1, '待刷新失败标签不能因租约或十分钟等待被丢弃');
    assert.equal(sstm.tabs[0].closed, false);
    retry.context.location.href = 'https://sstm.moe/topic/123-test/';
    retry.run("globalThis.resumed=bindPageTask('sstm')");
    assert.equal(retry.run('resumed.taskId'), id, '刷新续接同一标签原任务');
    assert.equal(retry.run("hasActiveTask('sstm')"), true);
    retry.run("taskActions({operation:resumed}).completeSign('sstm','已确认本人今日发布的签到评论'); finishTaskLease(resumed)");
    sstm.run('syncLaunchedAutoCloseTabs()');
    assert.equal(sstm.tabs[0].closed, true, '刷新成功后通过原句柄关闭同一标签');
}
for (const invalidate of [
    "resetTargetStatus(t)",
    "finishTaskLease(getTaskLease('sstm')); acquireTaskLease('sstm','page')",
    "setManualTargetStatus(t,'skipped')"
]) {
    const stale = await createFixture();
    stale.run("updateDashboardPreference({autoClosePageAfterSign:true}); globalThis.t=getBuiltInTargets().find(t=>t.id==='sstm'); launchTarget(t); globalThis.original=getTaskLease('sstm'); finishTaskLease(original);" + invalidate + '; syncLaunchedAutoCloseTabs()');
    stale.context.location.href = 'https://sstm.moe/topic/123-test/';
    stale.sessions.set('BBSSignHelperPageTask:sstm', stale.run('original.taskId'));
    assert.equal(stale.run("bindPageTask('sstm')"), null, '重置、替换和人工跳过后旧标签不能续接原任务');
    assert.equal(stale.run('launchedAutoCloseTabs.size'), 0);
    assert.equal(stale.tabs[0].closed, false);
}

// 两分钟以上监听继续工作，配置变化重绑后数量不积累。
const sync = await createFixture({ storage: new Map() });
sync.run('startStateSynchronization()');
const count = sync.listeners.size;
await sync.tick(180000);
sync.run('updateDashboardPreference({autoClosePageAfterSign:true})');
await sync.tick(100);
assert.equal(sync.listeners.size, count);
assert.equal(sync.run('syncDay'), sync.run('getToday()'));
await sync.tick(24*60*60*1000);
assert.equal(sync.run('syncDay'), sync.run('getToday()'));
sync.run('stopStateSynchronization()');
assert.equal(sync.listeners.size, 0);
const fallback = await createFixture({ noListeners: true });
fallback.run('startStateSynchronization()');
assert.ok(fallback.run('syncPollTimer'));
fallback.context.document.hidden = true;
fallback.run('refreshSyncPolling()');
assert.equal(fallback.run('syncPollTimer'), null);
fallback.context.document.hidden = false;
fallback.events.get('document:visibilitychange')();
assert.ok(fallback.run('syncPollTimer'));
console.log('通过：证据入口、批量撤销、全部直签并行/防重、前台标签独立打开、旧排队解除、跨实例租约、跨日、页面关联、长期监听与降级轮询。');
