import test from 'node:test';
import assert from 'node:assert/strict';
import { instance, memory } from './harness.mjs';
test('基线：默认仅第一页、5 张图片、页面并发 1', () => {
    const w = instance();
    assert.equal(w.getAutoPreviewLimit(), 5);
    assert.equal(w.getAutoPreviewConcurrent(), 1);
    assert.equal(w.canFetchExtraPages(), false);
});
test('伪静态附带参数仍然修改路径页码', () => {
    const w = instance();
    assert.equal(
        w.buildThreadPageUrl('https://forum.example/thread-123-1-1.html?extra=abc', 2),
        'https://forum.example/thread-123-2-1.html?extra=abc',
    );
});
test('站点标识：标题无关、协议兼容、安装路径隔离', () => {
    const a = instance(),
        b = instance(memory(), 'http://forum.example/forum.php?mod=viewthread&tid=1'),
        c = instance(memory(), 'https://forum.example/bbs/forum.php?mod=viewthread&tid=1');
    assert.equal(a.PageAdapter.site(), b.PageAdapter.site());
    assert.notEqual(a.PageAdapter.site(), c.PageAdapter.site());
});
test('多标签页：不同帖及不同字段互不覆盖', () => {
    const shared = memory(),
        a = instance(shared),
        b = instance(shared),
        s = new a.HistoryStore(),
        t = new b.HistoryStore();
    s.write('1', 'visited', true);
    t.write('2', 'visited', true);
    t.write('1', 'viewedImages', true);
    assert.equal(Object.keys(s.all()).length, 2);
    assert.equal(s.read('1').visited.value, true);
    assert.equal(s.read('1').viewedImages.value, true);
});
test('清空后旧代次任务不能恢复，新的操作可以写入', () => {
    const w = instance(),
        s = new w.HistoryStore(),
        old = s.epoch();
    s.write('1', 'visited', true);
    s.clear();
    assert.equal(s.write('2', 'viewedImages', true, { epoch: old }), null);
    assert.equal(Object.keys(s.all()).length, 0);
    s.write('2', 'visited', true);
    assert.equal(s.read('2').visited.value, true);
});
test('重置字段独立，冲突撤销不会覆盖新操作', () => {
    const w = instance(),
        s = new w.HistoryStore();
    s.write('1', 'visited', true);
    s.write('1', 'viewedImages', true);
    const undo = s.reset('1', 'visited');
    assert.equal(s.read('1').viewedImages.value, true);
    assert.equal(undo(), true);
    const undo2 = s.reset('1', 'viewedImages');
    s.write('1', 'viewedImages', true);
    assert.equal(undo2(), false);
});
test('合法旧格式迁移保留备份且不覆盖显式重置', () => {
    const w = instance(),
        s = new w.HistoryStore();
    const key = 'discuz_visited_threads_old_forum_example';
    w.shared.data.set(key, JSON.stringify({ 1: true, 2: { viewedImages: true, ts: 50 } }));
    s.migrate();
    assert.equal(s.read('1').visited.value, true);
    assert.equal(w.shared.data.has(key), true);
    s.reset('1', 'visited');
    w.shared.data.delete(s.prefix + 'migrated');
    s.migrate();
    assert.equal(s.read('1').visited.value, false);
});
test('子目录不自动合并旧域名键', () => {
    const w = instance(memory(), 'https://forum.example/bbs/forum.php?mod=forumdisplay&fid=1'),
        s = new w.HistoryStore();
    w.shared.data.set('discuz_visited_threads_old_forum_example', '{"1":true}');
    s.migrate();
    assert.equal(Object.keys(s.all()).length, 0);
    assert.equal(s.legacyKeys().length, 1);
});
test('无效导入整体拒绝：null、数组、危险键、非法时间、未知版本、超限', () => {
    const w = instance();
    for (const input of [
        'null',
        '[]',
        '{"1":true,"2":null}',
        '{"1":[]}',
        '{"__proto__":true}',
        '{"1":{"visited":true,"ts":-1}}',
        '{"1":{"visited":true,"ts":"2"}}',
        '{"schemaVersion":5,"siteId":"x","records":{}}',
        ' '.repeat(5 * 1024 * 1024 + 1),
    ])
        assert.throws(() => w.parseImport(input));
});
test('导入后实时导出、字段合并与旧格式回退', () => {
    const w = instance(),
        s = new w.HistoryStore();
    s.import(w.parseImport('{"1":{"visited":true,"ts":5}}'));
    assert.equal(s.export().records['1'].visited.value, true);
    s.import(w.parseImport('{"2":true}'));
    assert.equal(Object.keys(s.export(true)).length, 2);
    s.reset('1', 'visited');
    s.import(w.parseImport('{"1":{"visited":true,"ts":9999999999999}}'));
    assert.equal(s.read('1').visited.value, false);
});
test('导入提交失败保留原数据、清除未提交暂存', () => {
    const w = instance(),
        s = new w.HistoryStore();
    s.write('1', 'visited', true);
    const old = s.epoch();
    let n = 0;
    w.shared.before = (type) => {
        if (type === 'set' && ++n === 2) throw new Error('disk full');
    };
    assert.throws(() => s.import(w.parseImport('{"2":true,"3":true}')));
    w.shared.before = null;
    assert.equal(s.epoch(), old);
    assert.equal(Object.keys(s.all()).length, 1);
});
test('批量写入期间发生并发更新时拒绝提交旧快照', () => {
    const w = instance(),
        s = new w.HistoryStore();
    s.write('1', 'visited', true);
    let fired = false;
    w.shared.before = (type, key) => {
        if (type === 'set' && key.includes(':2:') && !fired) {
            fired = true;
            s.write('3', 'visited', true);
        }
    };
    assert.throws(() => s.import(w.parseImport('{"2":true}')), /其他页面/);
    w.shared.before = null;
    assert.equal(s.read('3').visited.value, true);
    assert.equal(s.read('2').visited, undefined);
});
test('2201 条记录清理后保留最新 2000 条完整字段', () => {
    const w = instance(),
        s = new w.HistoryStore();
    for (let i = 1; i <= 2201; i++) {
        s.write(String(i), 'visited', true, { ts: i });
        s.write(String(i), 'viewedImages', true, { ts: i });
    }
    assert.equal(s.cleanup(), 201);
    assert.equal(Object.keys(s.all()).length, 2000);
    assert.equal(s.read('2201').viewedImages.value, true);
    assert.equal(s.read('1').visited, undefined);
});
test('缓存逐页过期、损坏与容量回收', () => {
    const w = instance(),
        cache = new w.PreviewCache();
    cache.write('1', 1, { images: ['https://example.com/a.jpg'], maxPage: 1 });
    assert.equal(cache.read('1', 1).images.length, 1);
    w.context.sessionStorage.setItem(cache.prefix + '1', JSON.stringify({ pages: { 1: { images: [], at: 1 } } }));
    assert.equal(cache.read('1', 1), null);
    for (let i = 1; i <= 105; i++) cache.write(String(i), 1, { images: [], maxPage: 1 });
    assert.equal(w.context.sessionStorage.length, 100);
    cache.clear('105');
    assert.equal(cache.read('105', 1), null);
});
test('调度：并发名额释放后手动优先', async () => {
    const w = instance(),
        queue = new w.RequestScheduler(() => 1),
        order = [];
    let release;
    const first = queue.enqueue(
        'a',
        () =>
            new Promise((r) => {
                release = r;
                order.push('a');
            }),
    );
    await Promise.resolve();
    const auto = queue.enqueue('b', () => order.push('b'));
    const manual = queue.enqueue('c', () => order.push('c'), { priority: 1 });
    release();
    await Promise.all([first, auto, manual]);
    assert.deepEqual(order, ['a', 'c', 'b']);
});
test('调度：取消排队任务与后台暂停', async () => {
    const w = instance(),
        queue = new w.RequestScheduler(() => 1);
    w.context.document.hidden = true;
    let ran = false;
    const task = queue.enqueue('x', () => {
        ran = true;
    });
    queue.cancel('x');
    await assert.rejects(task);
    assert.equal(ran, false);
});
test('正文分类：登录、验证、无法识别、真正空帖', () => {
    const w = instance();
    const doc = (kind) => ({
        querySelector: (s) =>
            kind === 'login' && s.includes('#loginform')
                ? {}
                : kind === 'challenge' && s.includes('#challenge-running')
                  ? {}
                  : null,
        querySelectorAll: (s) => (kind === 'empty' && s === '.t_f' ? [{ querySelectorAll: () => [] }] : []),
    });
    for (const [kind, error] of [
        ['login', 'auth'],
        ['challenge', 'challenge'],
        ['unknown', 'unrecognized'],
    ])
        assert.throws(
            () => w.PageAdapter.parse(doc(kind), 'https://example.com/'),
            (e) => e.kind === error,
        );
    assert.equal(w.PageAdapter.parse(doc('empty'), 'https://example.com/').images.length, 0);
});
test('图片提取以响应 URL 规范化、去重并排除非 HTTP', () => {
    const w = instance();
    const imgs = ['image/a.jpg', 'https://example.com/bbs/image/a.jpg', 'javascript:bad()'].map((src) => ({
        getAttribute: (a) => (a === 'file' ? src : null),
    }));
    const doc = {
        querySelector: () => null,
        querySelectorAll: (s) => (s === '.t_f' ? [{ querySelectorAll: () => imgs }] : []),
    };
    assert.equal(w.PageAdapter.parse(doc, 'https://example.com/bbs/thread-1-1-1.html').images.length, 1);
});
test('第 3 页失败保留前两页，重试只加载失败页', async () => {
    const w = instance(),
        requested = [],
        added = [];
    let fail = true;
    const responses = {
        1: { images: ['a', 'b'], maxPage: 3 },
        2: { images: ['c'], maxPage: 3 },
        3: { images: ['d'], maxPage: 3 },
    };
    w.configure({
        settings: { extra: true },
        previewCache: {
            read: (tid, p) => {
                requested.push(p);
                if (p === 3 && fail) throw new Error('network');
                return responses[p];
            },
            write() {},
        },
    });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        busy: false,
        safe: true,
        pages: new Map(),
        maxPage: 1,
        live: () => true,
        render() {},
        addImages: (s) => added.push(...s),
    });
    await c.loadPages(1, 3, true);
    assert.equal(c.pages.size, 2);
    assert.deepEqual(added, ['a', 'b', 'c']);
    assert.equal(c.failedPage, 3);
    fail = false;
    await c.loadPages(c.failedPage, 3, true);
    assert.deepEqual(added, ['a', 'b', 'c', 'd']);
    assert.deepEqual(requested, [1, 2, 3, 3]);
});
test('自动预览补足候选但不超数量，不进入后续页', async () => {
    const w = instance(),
        added = [],
        requested = [];
    w.configure({
        settings: { extra: false, limit: 5 },
        previewCache: {
            read: (tid, p) => {
                requested.push(p);
                return { images: ['a', 'b', 'c', 'd', 'e', 'f'], maxPage: 3 };
            },
            write() {},
        },
    });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        busy: false,
        safe: true,
        pages: new Map(),
        images: new Map(),
        maxPage: 1,
        live: () => true,
        render() {},
        count: () => 0,
        pending: () => 0,
        addImages: (s) => added.push(...s),
    });
    await c.loadPages(1, 1, false);
    assert.deepEqual(requested, [1]);
    assert.equal(added.length, 5);
});
test('只有灯箱成功才写看图，展开预览和过期代次不回写', () => {
    const w = instance(),
        s = new w.HistoryStore();
    w.configure({ history: s });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        tid: '1',
        live: () => true,
        expanded: true,
        images: new Map(),
        intent: null,
    });
    c.maybeMark();
    assert.equal(s.read('1').viewedImages, undefined);
    c.grantIntent();
    c.maybeMark();
    assert.equal(s.read('1').viewedImages, undefined);
    c.maybeMark(true);
    assert.equal(s.read('1').viewedImages, undefined);
    c.grantIntent(true);
    c.maybeMark();
    assert.equal(s.read('1').viewedImages, undefined);
    c.maybeMark(true);
    assert.equal(s.read('1').viewedImages.value, true);
    c.grantIntent(true);
    s.clear();
    c.maybeMark(true);
    assert.equal(s.read('1').viewedImages, undefined);
});
test('销毁会取消两个队列、观察器与异步信号', () => {
    const w = instance(),
        cancels = [];
    w.configure({
        pageQueue: { cancel: (c) => cancels.push('page') },
        imageQueue: { cancel: (c) => cancels.push('image') },
    });
    let disconnected = false;
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        abort: new AbortController(),
        thread: { dataset: {} },
        imageObserver: { disconnect: () => (disconnected = true) },
        tools: { remove() {} },
        row: { remove() {} },
    });
    c.destroy();
    assert.equal(c.abort.signal.aborted, true);
    assert.equal(disconnected, true);
    assert.deepEqual(cancels, ['page', 'image']);
});
test('页面 429 退避且权限请求不重试', async () => {
    const w = instance(),
        scheduler = { pauseUntil: 0 };
    let calls = 0;
    w.context.fetch = async () => {
        calls++;
        return { status: 429, ok: false, headers: { get: () => '2' } };
    };
    await assert.rejects(w.requestPage('https://example.com/', new AbortController().signal, scheduler));
    assert.equal(calls, 1);
    assert.ok(scheduler.pauseUntil > Date.now() + 1000);
    w.context.fetch = async () => {
        calls++;
        return { status: 403, ok: false };
    };
    await assert.rejects(w.requestPage('https://example.com/', new AbortController().signal, scheduler));
    assert.equal(calls, 2);
});
test('图片超时和取消清理所有定时资源', async () => {
    const w = instance(),
        timers = new Map();
    let id = 0;
    w.context.setTimeout = (fn, ms) => {
        timers.set(++id, { fn, ms });
        return id;
    };
    w.context.clearTimeout = (i) => timers.delete(i);
    w.context.Image = class {};
    const result = w.requestImage('https://example.com/a', new AbortController().signal);
    const timer = [...timers.values()][0];
    assert.equal(timer.ms, 20000);
    timer.fn();
    await assert.rejects(result);
    assert.equal(timers.size, 0);
    const a = new AbortController(),
        pending = w.requestImage('https://example.com/a', a.signal);
    a.abort();
    await assert.rejects(pending);
    assert.equal(timers.size, 0);
});
test('正常正文的积分提示不阻止外链普通图片预览', () => {
    const w = instance(),
        img = { getAttribute: (k) => (k === 'src' ? 'https://example.com/image.jpg' : null) };
    const doc = {
        querySelector: (s) => (s.includes('#messagetext') ? { textContent: '下载附件需要积分，可购买附件' } : null),
        querySelectorAll: (s) => (s === '.t_f' ? [{ querySelectorAll: () => [img] }] : []),
    };
    assert.equal(w.PageAdapter.parse(doc, 'https://example.com/thread-1-1-1.html').images.length, 1);
});
test('自动首次失败延迟补试一次，成功后不再重复抓取', async () => {
    const w = instance();
    let timer,
        requests = 0,
        complete = 0;
    w.context.setTimeout = (fn, ms) => {
        timer = { fn, ms };
        return 1;
    };
    w.context.clearTimeout = () => {};
    w.configure({
        settings: { auto: true },
        pageQueue: { pauseUntil: 0 },
        previewCache: {
            read: () => {
                requests++;
                if (requests === 1) throw Object.assign(new Error('network'), { kind: 'network' });
                return { images: [], maxPage: 1 };
            },
            write() {},
        },
    });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        autoRecovery: 0,
        busy: false,
        safe: true,
        pages: new Map(),
        maxPage: 1,
        live: () => true,
        render() {},
        fillAuto: () => complete++,
    });
    await c.loadPages(1, 1, false);
    assert.equal(timer.ms, 3000);
    assert.equal(c.autoRecovery, 1);
    timer.fn();
    await Promise.resolve();
    assert.equal(requests, 2);
    assert.equal(complete, 1);
});
test('自动连续失败不会无限补试', async () => {
    const w = instance();
    let timers = 0;
    w.context.setTimeout = () => ++timers;
    w.configure({
        settings: { auto: true },
        pageQueue: { pauseUntil: 0 },
        previewCache: {
            read: () => {
                throw Object.assign(new Error('network'), { kind: 'network' });
            },
            write() {},
        },
    });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        autoRecovery: 0,
        busy: false,
        safe: true,
        pages: new Map(),
        maxPage: 1,
        live: () => true,
        render() {},
    });
    await c.loadPages(1, 1, false);
    await c.loadPages(1, 1, false);
    assert.equal(timers, 1);
});
test('页面 15 秒超时仅重试一次且释放计时器', async () => {
    const w = instance(),
        timers = new Map();
    let id = 0,
        calls = 0;
    w.context.setTimeout = (fn, ms) => {
        const i = ++id;
        timers.set(i, { fn, ms });
        return i;
    };
    w.context.clearTimeout = (i) => timers.delete(i);
    w.context.fetch = (url, { signal }) => {
        calls++;
        return new Promise((resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        );
    };
    const result = w
        .requestPage('https://example.com/', new AbortController().signal, { pauseUntil: 0 })
        .catch((e) => e);
    const fire = async (ms) => {
        const [key, timer] = [...timers].find(([, v]) => v.ms === ms) || [];
        assert.ok(timer, `缺少 ${ms}ms 计时器`);
        timers.delete(key);
        timer.fn();
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    await fire(15000);
    await fire(1000);
    await fire(15000);
    assert.equal((await result).kind, 'timeout');
    assert.equal(calls, 2);
    assert.equal(timers.size, 0);
});
test('基线：宽度默认关闭，默认与站点策略隔离', () => {
    const w = instance();
    assert.equal(w.getThreadListWidthConfig().enabled, false);
    w.shared.data.set('thread_list_width_enabled', true);
    w.shared.data.set('thread_list_width_value', 90);
    assert.equal(w.getThreadListWidthCssValue(), '90%');
    w.shared.data.set('thread_list_width_site_policy_forum_example', 'disabled');
    assert.equal(w.getThreadListWidthConfig().enabled, false);
    assert.equal(w.getThreadListWidthConfig('default').enabled, true);
});
test('基线：动态和伪静态分页', () => {
    const w = instance();
    assert.match(w.buildThreadPageUrl('https://forum.example/forum.php?mod=viewthread&tid=1', 2), /page=2/);
    assert.match(w.buildThreadPageUrl('https://forum.example/thread-1-1-1.html', 2), /thread-1-2-1/);
});

test('可见位置变化后重新排序，但自动请求仍遵守间隔', async () => {
    const w = instance(),
        order = [];
    let slots = 0,
        firstRank = 1,
        secondRank = 0;
    const q = new w.RequestScheduler(() => slots, 300);
    const a = q.enqueue({}, () => order.push('离屏'), { rank: () => firstRank });
    const b = q.enqueue({}, () => order.push('当前可见'), { rank: () => secondRank });
    firstRank = -900;
    secondRank = 1;
    slots = 1;
    q.drain();
    await b;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(order, ['当前可见']);
    assert.ok(q.nextAuto > Date.now());
    q.nextAuto = 0;
    q.drain();
    await a;
    assert.deepEqual(order, ['当前可见', '离屏']);
    clearTimeout(q.timer);
});

test('离屏自动任务不占名额，重新进入附近后可恢复', async () => {
    const w = instance(),
        order = [];
    let near = false;
    const q = new w.RequestScheduler(() => 1);
    const a = q.enqueue({}, () => order.push('恢复'), { eligible: () => near });
    await q.enqueue({}, () => order.push('可见'));
    assert.deepEqual(order, ['可见']);
    near = true;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    q.drain();
    await a;
    assert.deepEqual(order, ['可见', '恢复']);
});

test('图片先挂载再下载，完成前不报告成功，取消后终止下载', async () => {
    const w = instance();
    let attached,
        ready = false;
    w.context.Image = class {};
    const abort = new AbortController();
    const pending = w.requestImage('https://example.com/progressive.jpg', abort.signal, (img) => {
        attached = img;
        assert.equal(img.src, undefined);
    });
    pending.then(
        () => {
            ready = true;
        },
        () => {},
    );
    await Promise.resolve();
    assert.equal(attached.src, 'https://example.com/progressive.jpg');
    assert.equal(ready, false);
    attached.naturalWidth = 1200;
    attached.onload();
    assert.equal(await pending, attached);
    assert.equal(ready, true);
    const next = w.requestImage('https://example.com/slow.jpg', abort.signal, (img) => {
        attached = img;
    });
    abort.abort();
    await assert.rejects(next);
    assert.equal(attached.src, '');
});

test('并发 3 实际启动三项，第四项明确显示占用并在释放后继续', async () => {
    const w = instance(),
        q = new w.RequestScheduler(() => 3),
        releases = [],
        messages = [];
    const tasks = Array.from({ length: 3 }, (_, i) =>
        q.enqueue(i, () => new Promise((resolve) => releases.push(resolve))),
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(q.active, 3);
    let fourthStarted = false;
    const fourth = q.enqueue(
        4,
        () => {
            fourthStarted = true;
        },
        { onWait: (m) => messages.push(m) },
    );
    assert.match(messages.at(-1), /正在请求 3 \/ 3/);
    assert.equal(fourthStarted, false);
    releases[0]();
    await fourth;
    assert.equal(fourthStarted, true);
    releases.slice(1).forEach((resolve) => resolve());
    await Promise.all(tasks);
});

test('没有滚动事件时兜底唤醒恢复任务，限流期间报告原因', async () => {
    const w = instance(),
        timers = new Map();
    let id = 0,
        eligible = false,
        message = '';
    w.context.setTimeout = (fn, ms) => {
        timers.set(++id, { fn, ms });
        return id;
    };
    w.context.clearTimeout = (key) => timers.delete(key);
    const q = new w.RequestScheduler(() => 3);
    q.pauseUntil = Date.now() + 30000;
    const task = q.enqueue({}, () => '完成', {
        eligible: () => eligible,
        onWait: (m) => {
            message = m;
        },
    });
    assert.match(message, /服务器限流/);
    assert.equal(q.active, 0);
    assert.equal([...timers.values()][0].ms, 1000);
    q.pauseUntil = 0;
    eligible = true;
    [...timers.values()][0].fn();
    assert.equal(await task, '完成');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(timers.size, 0);
});

test('正文已入队后移出视口不会因距离被永久搁置', async () => {
    const w = instance();
    w.context.window.innerHeight = 900;
    w.configure({
        previewCache: { read() {}, write() {} },
        pageQueue: {
            enqueue(owner, work, options) {
                assert.equal(options.eligible(), true);
                assert.ok(options.rank() < -500);
                return Promise.resolve({ images: [], maxPage: 1 });
            },
        },
    });
    const c = Object.assign(Object.create(w.PreviewController.prototype), {
        busy: false,
        safe: true,
        expanded: true,
        pages: new Map(),
        maxPage: 1,
        live: () => true,
        render() {},
        fillAuto() {},
        title: { getBoundingClientRect: () => ({ top: 3000, bottom: 3030, width: 300, height: 30 }) },
    });
    await c.loadPages(1, 1, false);
    assert.equal(c.pages.size, 1);
    assert.equal(c.busy, false);
});
