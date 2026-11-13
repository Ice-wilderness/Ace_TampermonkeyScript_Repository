import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key } from './fixtures.mjs';

const watched = (currentTime = '00:45') => ({ status: '已观看', currentTime, percent: '45%', savedAt: '2026-09-06 08:00:00' });
const media = (options = {}) => {
    const events = new Map(), writes = [];
    let current = options.currentTime ?? 0;
    return { readyState: 1, duration: 100, currentSrc: 'synthetic-a', paused: true, seeking: false, plays: 0,
        ...options, events, writes,
        get currentTime() { return current; },
        set currentTime(value) { writes.push(value); if (!this.ignoreSeek) current = value; },
        addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
        removeEventListener(type, fn) { events.get(type)?.delete(fn); },
        fire(type) { for (const fn of [...events.get(type) || []]) fn(); },
        play() { this.plays++; this.paused = false; return this.rejectPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }
    };
};
const runTimer = (w, id) => { const fn = w.timers.get(id); assert(fn, '目标计时器尚未安排'); w.timers.delete(id); fn(); };
const setup = async ({ mode = 'auto', record = watched(), video = media(), page = 1, url = '' } = {}) => {
    const shared = sharedStorage(); shared.data.set('bvh_settings', { resumeMode: mode });
    const w = instance(shared); await w.StorageManager.initialize();
    const id = key(1, page); let activeKey = id, activeVideo = video;
    w.context.location.href = `https://www.bilibili.com/video/${key(1)}/${url || (page > 1 ? '?p=' + page : '')}`;
    if (record) await w.StorageManager.saveRecord(id, record);
    const messages = [], listeners = new Map();
    w.context.document.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
    w.context.document.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
    w.context.document.createElement = () => ({ addEventListener(type, fn) { this[type] = fn; } });
    w.context.document.querySelector = () => activeVideo;
    w.EpisodeResolver.getCurrentKey = () => activeKey;
    w.EpisodeResolver.getLatestRecord = () => { throw new Error('自动模式不得读取其他分 P'); };
    w.UIComponent.showViewPanel = () => {}; w.UIComponent.updateViewPanelProgress = () => {};
    w.UIComponent.toast = message => {
        const notice = { message, appendChild(button) { this.button = button; }, remove() { this.removed = true; } };
        messages.push(notice); return notice;
    };
    const p = new w.VideoPlayerObserver(); p.bvId = id; p.bindVideo(video);
    return { w, p, video, messages, listeners, setKey(value) { activeKey = value; }, setVideo(value) { activeVideo = value; } };
};

const cases = [
    ['新用户默认提示，旧开关保持开启提示或关闭，非法新值安全回退', async () => {
        for (const [saved, expected] of [[{}, 'prompt'], [null, 'prompt'], [{ autoResumePrompt: true }, 'prompt'],
            [{ autoResumePrompt: false }, 'off'], [{ autoResumePrompt: false, resumeMode: 'invalid' }, 'off'],
            [{ resumeMode: 'auto' }, 'auto']]) {
            const shared = sharedStorage(); shared.data.set('bvh_settings', saved);
            const w = instance(shared); assert.equal(w.CONFIG.resumeMode, expected);
            await w.SettingsManager.save({ debug: false });
            assert.equal(shared.data.get('bvh_settings').resumeMode, expected);
            assert.equal(shared.data.get('bvh_settings').autoResumePrompt, expected !== 'off');
        }
    }],
    ['仅恢复当前 P，缓存旧进度且保持播放或暂停状态，提供从头播放', async () => {
        for (const paused of [true, false]) {
            const { w, p, video, messages, listeners } = await setup({ page: 2, video: media({ paused }) });
            await w.StorageManager.saveRecord(key(1), watched('01:10'));
            p.hasPlayed = true; video.currentTime = 1; video.fire('timeupdate');
            assert.equal(p.capture(), null);
            assert.equal(w.StorageManager.getRecord(key(1, 2)).currentTime, '00:45');
            // 后台同步不能替换本次打开时选定的目标，也不能触发再次恢复。
            await w.StorageManager.saveRecord(key(1, 2), watched('00:55'));
            runTimer(w, p._autoResumeTimer);
            assert.equal(video.currentTime, 45); assert.equal(video.paused, paused); assert.equal(video.plays, 0);
            assert.equal(messages.length, 1); assert.equal(listeners.get('pointerdown').size, 0);
            messages[0].button.click();
            assert.equal(video.currentTime, 0); assert.equal(video.paused, paused); assert.equal(video.plays, 0);
            assert.equal(messages[0].removed, true);
            p.confirmMedia(); assert.equal(video.currentTime, 0); assert.equal(messages.length, 1);
            p.destroy();
        }
    }],
    ['没有当前 P 记录时不借用其他 P；关闭模式不提示也不跳转', async () => {
        for (const options of [{ record: null, page: 2 }, { mode: 'off' }]) {
            const { w, p, video, messages } = await setup(options);
            await w.StorageManager.saveRecord(key(1, 3), watched('00:55'));
            assert.equal(p._resumeFinished, true); assert.equal(video.currentTime, 0); assert.equal(messages.length, 0);
            p.destroy();
        }
    }],
    ['提示模式保留手动跨 P 继续观看，不自动执行', async () => {
        const shared = sharedStorage(); shared.data.set('bvh_settings', { autoResumePrompt: true });
        const w = instance(shared); await w.StorageManager.initialize(); const video = media();
        const target = { key: key(1, 2), record: watched() };
        let prompt;
        w.EpisodeResolver.getCurrentKey = () => key(1); w.EpisodeResolver.getLatestRecord = () => target;
        w.context.document.querySelector = () => video; w.UIComponent.showViewPanel = () => {};
        w.UIComponent.showResumePrompt = item => { prompt = item; };
        const p = new w.VideoPlayerObserver(); p.bvId = key(1); p.bindVideo(video);
        assert.equal(prompt, target); assert.equal(video.currentTime, 0); assert.equal(video.plays, 0); p.destroy();
    }],
    ['无效、过短、越界、片尾及非观看记录不自动恢复', async () => {
        for (const value of [watched('00:04'), watched('NaN'), watched('00:99'), watched('00:100abc'), watched('01:40'),
            watched('01:37'), { ...watched(), status: '已访问' }]) {
            const { w, p, video } = await setup({ record: value });
            if (p._autoResumeTimer) runTimer(w, p._autoResumeTimer);
            assert.equal(video.currentTime, 0, value.currentTime); assert.equal(p._resumeFinished, true); p.destroy();
        }
        const { w, p, video } = await setup({ record: watched('00:18'), video: media({ duration: 20 }) });
        runTimer(w, p._autoResumeTimer); assert.equal(video.currentTime, 18, '短视频不应套用固定十秒片尾阈值'); p.destroy();
    }],
    ['链接指定时间、原生已恢复位置及用户手动操作优先', async () => {
        for (const url of ['?t=0', '?t=30', '?start_progress=30000', '#t=30']) {
            const { p, video } = await setup({ url }); assert.equal(p._resumeFinished, true); assert.equal(video.currentTime, 0); p.destroy();
        }
        for (const action of [({ video }) => { video.currentTime = 20; video.fire('seeking'); },
            ({ w }) => { w.context.location.href += '?t=30'; },
            ({ listeners }) => { for (const fn of [...listeners.get('pointerdown')]) fn({ target: { closest: () => true } }); },
            ({ listeners }) => { for (const fn of [...listeners.get('keydown')]) fn({ type: 'keydown', key: 'ArrowRight', target: { closest: () => false } }); }]) {
            const state = await setup(); const timer = state.w.timers.get(state.p._autoResumeTimer);
            action(state); timer(); assert.notEqual(state.video.currentTime, 45); assert.equal(state.p._resumeFinished, true); state.p.destroy();
        }
        const { w, p, video } = await setup({ video: media({ currentTime: 30 }) });
        runTimer(w, p._autoResumeTimer); assert.equal(video.currentTime, 30); p.destroy();
    }],
    ['媒体时长迟到后恢复，等待有时限且切换会话后旧任务失效', async () => {
        const state = await setup({ video: media({ duration: NaN }) });
        runTimer(state.w, state.p._autoResumeTimer); assert.equal(state.video.currentTime, 0);
        state.video.duration = 100; state.video.fire('durationchange'); assert.equal(state.video.currentTime, 45); state.p.destroy();
        const stalled = await setup({ video: media({ duration: NaN }) });
        runTimer(stalled.w, stalled.p._autoResumeTimer); runTimer(stalled.w, stalled.p._autoResumeTimeout);
        stalled.video.duration = 100; stalled.video.fire('durationchange'); assert.equal(stalled.video.currentTime, 0); stalled.p.destroy();
        const switched = await setup(); const late = switched.w.timers.get(switched.p._autoResumeTimer);
        switched.setKey(key(2)); switched.p.destroy(); late();
        assert.equal(switched.video.currentTime, 0); assert.equal(switched.listeners.get('keydown').size, 0);
    }],
    ['恢复前媒体重建可继续等待，成功后重建或切清晰度不重复恢复', async () => {
        const { w, p, video, setVideo, messages } = await setup(); const replacement = media();
        setVideo(replacement); p.bindVideo(replacement);
        runTimer(w, p._autoResumeTimer); assert.equal(video.currentTime, 0); assert.equal(replacement.currentTime, 45);
        replacement.fire('loadstart'); replacement.currentTime = 50; replacement.fire('loadedmetadata'); runTimer(w, p._metadataTimer);
        assert.equal(replacement.currentTime, 50);
        const third = media({ currentTime: 51 }); setVideo(third); p.bindVideo(third);
        assert.equal(third.currentTime, 51); assert.equal(messages.length, 1); p.destroy();
    }],
    ['恢复前删除或回滚历史时取消，恢复后的旧提示不能操作新媒体', async () => {
        for (const reset of [async ({ w }) => w.StorageManager.deleteRecords([key(1)]),
            async ({ w }) => { w.StorageManager._store.epoch = 'new-epoch'; }]) {
            const state = await setup(); await reset(state); runTimer(state.w, state.p._autoResumeTimer);
            assert.equal(state.video.currentTime, 0); state.p.destroy();
        }
        const state = await setup(); runTimer(state.w, state.p._autoResumeTimer);
        const button = state.messages[0].button; const next = media(); state.setVideo(next); state.p.bindVideo(next);
        button.click(); assert.equal(next.currentTime, 0); assert.equal(state.video.currentTime, 45); state.p.destroy();
    }],
    ['手动待跳转优先于自动续播与链接时间，自动播放拒绝有降级提示', async () => {
        const state = await setup(); state.p.destroy();
        state.video.currentTime = 0; state.video.rejectPlay = true;
        state.w.context.location.href += '?t=20';
        state.w.context.sessionStorage.setItem('bvh_pending_seek', JSON.stringify({ key: key(1), currentTime: '00:30', savedAt: state.w.context.Date.now() }));
        const p = new state.w.VideoPlayerObserver(); p.bvId = key(1); p.bindVideo(state.video);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.video.currentTime, 30); assert.equal(state.video.plays, 1);
        assert.equal(state.w.context.sessionStorage.getItem('bvh_pending_seek'), null);
        assert(state.messages.some(item => item.message.includes('点击播放器'))); assert.equal(p._autoResumeTimer, null); p.destroy();
    }],
    ['跳转失败最多尝试两次并清理监听；等待取消后不再跳转', async () => {
        const { w, p, video } = await setup({ video: media({ ignoreSeek: true }) });
        runTimer(w, p._autoResumeTimer);
        for (let i = 0; i < 10; i++) video.fire('canplay');
        assert.equal(video.writes.length, 2);
        runTimer(w, p._autoResumeTimeout); video.fire('canplay');
        assert.equal(video.writes.length, 2); assert.equal(p._resumePending, false); p.destroy();
        assert.equal([...video.events.values()].reduce((total, items) => total + items.size, 0), 0);
    }],
    ['手动跳转尚未完成时用户再次拖动，不重试争抢位置', async () => {
        const { w, p, video } = await setup({ mode: 'off' });
        video.ignoreSeek = true;
        w.UIComponent.jumpToProgress(watched());
        video.ignoreSeek = false; video.currentTime = 10; video.fire('seeking');
        for (let i = 0; i < 5; i++) video.fire('canplay');
        assert.equal(video.currentTime, 10); assert.equal(video.plays, 0); p.destroy();
    }]
];
let failed = 0;
for (const [name, test] of cases) {
    try { await test(); console.log('通过：' + name); }
    catch (error) { failed++; console.error(name, error); }
}
process.exitCode = failed ? 1 : 0;
console.log(`${cases.length - failed}/${cases.length} 续播测试通过`);
