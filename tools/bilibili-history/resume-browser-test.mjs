import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
const errors = [];
const open = async settings => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="bilibili-player" class="bpx-player-container"><video muted></video><button id="manual-seek">手动跳转</button></div></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(settings => {
        const values = new Map([['bvh_settings', settings]]);
        window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
        window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
        window.GM_deleteValue = key => values.delete(key); window.GM_listValues = () => [...values.keys()];
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        window.unsafeWindow = window;
    }, settings);
    await page.evaluate(instrument());
    await page.evaluate(() => {
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) testAPI.Utils[name] = () => {};
        testAPI.Utils.debugTime = () => () => {};
    });
    return page;
};
const prepareMedia = async (page, { playing = false, pending = false } = {}) => {
    await page.evaluate(async ({ playing, pending }) => {
        const { StorageManager, EpisodeResolver } = testAPI;
        await StorageManager.initialize();
        await StorageManager.saveRecord('BV0000000001', { status: '已观看', currentTime: '00:45', percent: '45%', savedAt: '2026-09-06 08:00:00' });
        EpisodeResolver.getCurrentKey = () => 'BV0000000001';
        EpisodeResolver.getLatestRecord = () => { throw new Error('自动续播误用了跨 P 记录'); };
        window.video = document.querySelector('video');
        // 本地合成 100 秒静音 WAV，使用浏览器原生媒体时钟和 seeking/seeked 事件。
        const samples = 8000 * 100, buffer = new ArrayBuffer(44 + samples * 2), data = new DataView(buffer);
        const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
        text(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
        data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
        data.setUint32(24, 8000, true); data.setUint32(28, 16000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
        text(36, 'data'); data.setUint32(40, samples * 2, true);
        await new Promise((resolve, reject) => {
            video.addEventListener('loadedmetadata', resolve, { once: true }); video.addEventListener('error', reject, { once: true });
            video.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
        });
        if (playing) await video.play();
        if (pending) {
            sessionStorage.setItem('bvh_pending_seek', JSON.stringify({ key: 'BV0000000001', currentTime: '00:30', savedAt: Date.now() }));
            video.play = () => Promise.reject(new DOMException('合成自动播放限制', 'NotAllowedError'));
        }
        document.querySelector('#manual-seek').onclick = () => { video.currentTime = 10; };
        window.player = new testAPI.VideoPlayerObserver(); player.bvId = 'BV0000000001'; player.bindVideo(video);
    }, { playing, pending });
};

try {
    for (const [saved, expected] of [[{}, 'prompt'], [{ autoResumePrompt: true }, 'prompt'], [{ autoResumePrompt: false }, 'off']]) {
        const page = await open(saved);
        await page.evaluate(() => { window.panel = testAPI.HistoryManagerPanel.show({}); });
        const field = page.locator('[data-setting="resumeMode"]');
        assert.equal(await field.inputValue(), expected);
        await page.locator('[data-action="save"]').click();
        await page.waitForFunction(expected => GM_getValue('bvh_settings').resumeMode === expected, expected);
        assert.equal(await page.evaluate(() => GM_getValue('bvh_settings').autoResumePrompt), expected !== 'off');
        await field.selectOption('auto');
        assert.equal(await page.evaluate(() => testAPI.CONFIG.resumeMode), expected, '草稿不得自动开启续播');
        await page.locator('[data-action="save"]').click();
        await page.waitForFunction(() => testAPI.CONFIG.resumeMode === 'auto');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await field.isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.close();
    }
    console.log('通过：真实设置面板默认提示、旧关闭状态保留，自动续播须主动选择并保存，窄屏不溢出');

    for (const playing of [false, true]) {
        const page = await open({ resumeMode: 'auto' });
        await prepareMedia(page, { playing });
        await page.waitForFunction(() => player._resumeFinished && Math.abs(video.currentTime - 45) < 2 && !video.seeking);
        assert.equal(await page.evaluate(() => video.paused), !playing);
        const notice = page.locator('.bvh-toast').filter({ hasText: '已恢复至 00:45' });
        await notice.getByRole('button', { name: '从头播放' }).click();
        await page.waitForFunction(() => video.currentTime < 2 && !video.seeking);
        assert.equal(await page.evaluate(() => video.paused), !playing);
        await page.evaluate(() => player.confirmMedia());
        assert.equal(await page.evaluate(() => video.currentTime < 2), true);
        await page.evaluate(() => player.destroy()); await page.close();
    }
    console.log('通过：原生媒体实际跳至保存位置，播放和暂停状态保持，从头播放后不会再次恢复');

    const manual = await open({ resumeMode: 'auto' });
    await prepareMedia(manual);
    await manual.locator('#manual-seek').click();
    await manual.waitForFunction(() => player._resumeFinished && video.currentTime === 10 && !video.seeking);
    assert.equal(await manual.locator('.bvh-toast').filter({ hasText: '已恢复至' }).count(), 0);
    await manual.evaluate(() => player.destroy()); await manual.close();
    console.log('通过：用户真实点击播放器操作时取消待执行恢复');

    const pending = await open({ resumeMode: 'auto' });
    await prepareMedia(pending, { pending: true });
    await pending.waitForFunction(() => video.currentTime === 30 && !video.seeking);
    await pending.getByText('已恢复进度，请点击播放器开始播放', { exact: true }).waitFor();
    assert.equal(await pending.evaluate(() => sessionStorage.getItem('bvh_pending_seek')), null);
    await pending.evaluate(() => player.destroy()); await pending.close();
    console.log('通过：显式待跳转优先，原生媒体完成跳转后自动播放被拒绝时降级提示');
    assert.deepEqual(errors, [], '浏览器中不应出现未处理异常');
} finally { await browser.close(); }
