import assert from 'node:assert/strict';
import { instance } from './harness.mjs';
import { key } from './fixtures.mjs';
const media = () => {
    const events = new Map();
    return { readyState: 1, currentTime: 30, duration: 100, currentSrc: 'synthetic-a', paused: false, plays: 0,
        events, addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
        removeEventListener(type, fn) { events.get(type)?.delete(fn); },
        fire(type) { for (const fn of events.get(type) || []) fn(); }, play() { this.plays++; return Promise.resolve(); } };
};
const setup = async () => {
    const w = instance(); await w.StorageManager.initialize(); let currentKey = key(1), video = media();
    w.EpisodeResolver.getCurrentKey = () => currentKey; w.EpisodeResolver.getLatestRecord = () => null;
    w.UIComponent.updateViewPanelProgress = () => {}; w.UIComponent.showViewPanel = () => {};
    w.context.document.querySelector = () => video;
    const p = new w.VideoPlayerObserver(); p.bvId = currentKey; p.bindVideo(video); p.hasPlayed = true;
    return { w, p, get video() { return video; }, setVideo(v) { video = v; }, setKey(k) { currentKey = k; } };
};
const cases = [
    ['标题来自站点窗口或顶层 bvid，不依赖沙箱 window', async () => {
        for (const nested of [true, false]) {
            const { w, p, video } = await setup(); await w.StorageManager._queue;
            video.paused = true; video.currentTime = 0;
            w.context.unsafeWindow = { __INITIAL_STATE__: { bvid: key(1), videoData: { ...(nested ? { bvid: key(1) } : {}), title: '页面窗口标题' } } };
            assert.equal(w.context.window.__INITIAL_STATE__, undefined);
            await p.completeMissingTitle(); assert.equal(w.StorageManager.getRecord(key(1)).title, '页面窗口标题');
            p.destroy();
        }
    }],
    ['无全局状态时按页面 URL 元信息补标题，拒绝旧视频 DOM', async () => {
        const { w, p } = await setup(); await w.StorageManager._queue;
        let canonical = 'https://www.bilibili.com/video/' + key(2);
        w.context.document.querySelector = selector => selector === 'link[rel="canonical"]'
            ? { getAttribute: () => canonical } : selector === 'h1.video-title, h1[title]' ? { textContent: '页面可见标题' } : null;
        await p.completeMissingTitle(); assert.equal(w.StorageManager.getRecord(key(1)).title, '');
        canonical = 'https://www.bilibili.com/video/' + key(1);
        await p.completeMissingTitle(); assert.equal(w.StorageManager.getRecord(key(1)).title, '页面可见标题');
        p.destroy();
    }],
    ['暂停且媒体未就绪时补全迟到标题，保持进度和保存时间', async () => {
        const { w, p, video } = await setup(); await w.StorageManager._queue;
        video.paused = true; video.currentTime = 0; video.readyState = 0;
        p.state = 'waiting';
        const before = w.StorageManager.getRecord(key(1));
        w.context.window.__INITIAL_STATE__ = { videoData: { bvid: key(2), title: '别的视频' } };
        await p.completeMissingTitle(); assert.equal(w.StorageManager.getRecord(key(1)).title, '');
        w.context.window.__INITIAL_STATE__.videoData = { bvid: key(1), title: '迟到的正确标题' };
        p.startVideoWatch(); w.flushTimers(); await w.StorageManager._queue;
        const after = w.StorageManager.getRecord(key(1));
        assert.equal(after.title, '迟到的正确标题');
        for (const field of ['status', 'currentTime', 'percent', 'savedAt']) assert.equal(after[field], before[field]);
        const writes = w.shared.calls.length; await p.completeMissingTitle(); assert.equal(w.shared.calls.length, writes);
        p.destroy();
    }],
    ['标题补全保留最新进度、已有标题且不复活已删除记录', async () => {
        const { w, p } = await setup(); p.title = ''; await p.saveProgress();
        await w.StorageManager.saveRecord(key(1), { title: '补全标题' }, true, { source: 'title' });
        assert.equal(w.StorageManager.getRecord(key(1)).percent, '30%');
        await w.StorageManager.saveRecord(key(1), { title: '不应覆盖' }, true, { source: 'title' });
        assert.equal(w.StorageManager.getRecord(key(1)).title, '补全标题');
        p.destroy(); await w.StorageManager._queue;
        await w.StorageManager.deleteRecords([key(1)]);
        await w.StorageManager.saveRecord(key(1), { title: '迟到标题' }, true, { source: 'title' });
        assert.equal(w.StorageManager.getRecord(key(1)), null);
    }],
    ['切 P 或换集后媒体尚未就绪也立即创建访问记录', async () => {
        for (const target of [key(1) + '?p=2', key(2)]) {
            const { w, p, video, setKey } = await setup();
            await p.saveProgress(); p.destroy(); setKey(target);
            video.readyState = 0;
            w.context.window.__INITIAL_STATE__ = { videoData: { bvid: key(999), title: '旧视频标题' } };
            const next = new w.VideoPlayerObserver(); next.bvId = target; next.bindVideo(video);
            await w.StorageManager._queue;
            assert.equal(next.state, 'waiting');
            const visited = w.StorageManager.getRecord(target);
            assert.equal(visited.status, '已访问'); assert.equal(visited.currentTime, '');
            assert.equal(visited.title, ''); assert.equal(w.StorageManager.getRecord(key(1)).percent, '30%');
            next.destroy();
        }
    }],
    ['访问提交不会覆盖队列中已经保存的播放进度', async () => {
        const { w, p } = await setup();
        await p.saveProgress();
        await w.StorageManager.saveRecord(key(1), { status: '已访问', percent: '', currentTime: '', savedAt: '2026-09-06 08:00:00' }, true, { source: 'visit' });
        assert.equal(w.StorageManager.getRecord(key(1)).percent, '30%'); p.destroy();
    }],
    ['URL 先变只保存旧会话快照', async () => {
        const { w, p, video, setKey } = await setup(); await p.saveProgress(); setKey(key(2)); video.currentTime = 80;
        await p.saveProgress(); p.destroy(); await w.StorageManager._queue;
        assert.equal(w.StorageManager.getRecord(key(1)).percent, '30%'); assert.equal(w.StorageManager.getRecord(key(2)), null);
    }],
    ['媒体先变、旧元素复用与新会话低进度', async () => {
        const { w, p, video, setKey } = await setup(); await p.saveProgress();
        video.fire('emptied'); video.currentSrc = 'synthetic-b'; video.currentTime = 70;
        await p.saveProgress(); assert.equal(w.StorageManager.getRecord(key(1)).percent, '30%');
        p.destroy(); setKey(key(2));
        const next = new w.VideoPlayerObserver(); next.bvId = key(2); next.bindVideo(video);
        assert.equal(next.state, 'waiting'); next._metadataSeen = true; next.confirmMedia(); next.hasPlayed = true; video.currentTime = 5;
        await next.saveProgress(); assert.equal(w.StorageManager.getRecord(key(2)).percent, '5%'); next.destroy();
    }],
    ['同会话媒体重建仅一组监听，销毁清理', async () => {
        const { w, p, video, setVideo } = await setup(); const replacement = media(); setVideo(replacement);
        p.bindVideo(replacement); p.bindVideo(replacement);
        assert.equal([...video.events.values()].reduce((n, set) => n + set.size, 0), 0);
        assert.equal(replacement.events.get('timeupdate').size, 1);
        p.hasPlayed = true; replacement.currentTime = 50; await p.saveProgress(); p.destroy(); await w.StorageManager._queue;
        assert.equal([...replacement.events.values()].reduce((n, set) => n + set.size, 0), 0);
        replacement.fire('timeupdate'); assert.equal(w.StorageManager.getRecord(key(1)).percent, '50%');
    }],
    ['等待续播的元数据回调在会话取消后失效', async () => {
        const { w, video } = await setup(); let valid = true; video.readyState = 0; video.currentTime = 0;
        w.context.sessionStorage.setItem('bvh_pending_seek', JSON.stringify({ key: key(1), currentTime: '00:45', savedAt: w.context.Date.now() }));
        const cancel = w.UIComponent.applyPendingSeek(key(1), video, () => valid); valid = false; cancel(); video.fire('loadedmetadata');
        assert.equal(video.currentTime, 0); assert.equal(video.plays, 0);
    }],
    ['首次超时后轮询仍能发现媒体，销毁停止等待', async () => {
        const w = instance(); await w.StorageManager.initialize(); let video = null;
        w.context.MutationObserver = class { observe() {} disconnect() { this.disconnected = true; } };
        w.context.document.body = {}; w.context.document.querySelector = () => video;
        w.EpisodeResolver.getCurrentKey = () => key(1); w.EpisodeResolver.getLatestRecord = () => null;
        w.UIComponent.showViewPanel = () => {}; w.UIComponent.updateViewPanelProgress = () => {};
        const p = new w.VideoPlayerObserver(); p.bvId = key(1); p.startVideoWatch();
        const waiting = p.waitForVideo().catch(error => error.message); w.flushTimers();
        assert.equal(await waiting, '等待媒体超时');
        // 夹具 flush 是单次执行，重新安排真实实现的低频发现回调。
        p.videoWatchInterval = null; p.startVideoWatch(); video = media(); w.flushTimers();
        assert.equal(p.videoEl, video); p.destroy(); await w.StorageManager._queue;
        assert.equal(p.destroyed, true);
    }]
];
let failed = 0;
for (const [name, test] of cases) { try { await test(); console.log('通过：' + name); } catch (error) { failed++; console.error(name, error); } }
process.exitCode = failed ? 1 : 0; console.log(`${cases.length - failed}/${cases.length} 播放会话测试通过`);
