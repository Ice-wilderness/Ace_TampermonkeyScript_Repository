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
tabs.run("resetTargetStatus(t); launchTarget(t); globalThis.action={operation:getTaskLease('wcccc')}; taskActions(action).completeSign('wcccc','明确今日已签到'); syncLaunchedAutoCloseTabs()");
assert.equal(tabs.tabs[1].closed, true);

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
