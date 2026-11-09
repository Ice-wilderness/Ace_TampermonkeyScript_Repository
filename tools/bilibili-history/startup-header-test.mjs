import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <div id="app" data-server-rendered="true"><div id="biliMainHeader">预渲染导航</div>
        <div class="right-container"><div class="video-pod__list section">
        <div class="video-pod__item" data-key="BV0000000001"><div class="title-txt">第一集</div></div>
        </div></div></div></body></html>` }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = () => {};
        window.GM_addStyle = () => {};
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { AppController, DOMWatcher, StorageManager, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        StorageManager.getRecord = () => ({ status: '已观看', percent: '55%' });
        StorageManager.getRelatedKeys = () => ['BV0000000001'];
        window.started = 0; window.playerStarted = 0;
        window.controller = new AppController();
        controller.checkAndInitVideoPage = () => { playerStarted++; };
        controller.startDomPhase = () => {
            if (controller._domStarted) return;
            controller._domStarted = true; started++;
            window.watcher = new DOMWatcher(); watcher.scanExistingLinks();
        };
        window.ssrHTML = document.querySelector('#app').outerHTML;
        controller.deferDomStart();
    });
    assert.equal(await page.evaluate(() => playerStarted), 1);
    // 超过原有 900ms 稳定等待及 4500ms 兜底，预渲染 DOM 仍不允许插入标记。
    await page.waitForTimeout(4800);
    assert.equal(await page.evaluate(() => started), 0);
    assert.equal(await page.locator('#app').evaluate(el => el.outerHTML), await page.evaluate(() => ssrHTML));
    await page.evaluate(() => {
        document.querySelector('#app').removeAttribute('data-server-rendered');
        document.querySelector('#biliMainHeader').textContent = '已挂载导航';
    });
    await page.waitForFunction(() => document.querySelector('.bvh-episode-tag'));
    assert.equal(await page.evaluate(() => started), 1);
    assert.equal(await page.locator('#biliMainHeader').innerText(), '已挂载导航');
    console.log('通过：慢加载超过兜底时长也不改写 SSR 页面，播放器提前启动，接管完成后只初始化一次并标记选集');

    // 页面框架可能整体替换根节点；等待逻辑必须重新检查当前根节点。
    await page.evaluate(() => {
        const root = document.querySelector('#app'); root.setAttribute('data-server-rendered', 'true');
        window.replacementStarts = 0; window.replacement = new testAPI.AppController();
        replacement.checkAndInitVideoPage = () => {};
        replacement.startDomPhase = () => { replacementStarts++; replacement._domStarted = true; };
        replacement.deferDomStart();
        const mounted = document.createElement('div'); mounted.id = 'app';
        mounted.innerHTML = '<div id="biliMainHeader">替换后导航</div>'; root.replaceWith(mounted);
    });
    await page.waitForFunction(() => replacementStarts === 1);
    console.log('通过：SSR 根节点整体替换后仍能启动');

    await page.evaluate(() => {
        document.querySelector('#app').setAttribute('data-server-rendered', 'true');
        window.cachedStarts = 0; window.cached = new testAPI.AppController();
        cached.checkAndInitVideoPage = () => {};
        cached.startDomPhase = () => { cachedStarts++; cached._domStarted = true; };
        cached.deferDomStart(); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        document.querySelector('#app').removeAttribute('data-server-rendered');
    });
    await page.waitForFunction(() => cachedStarts === 1);
    console.log('通过：进入浏览器往返缓存后仍保留页面接管等待');

    await page.evaluate(() => {
        document.querySelector('#app').setAttribute('data-server-rendered', 'true');
        window.abandonedStarts = 0; const abandoned = new testAPI.AppController();
        abandoned.checkAndInitVideoPage = () => {};
        abandoned.startDomPhase = () => { abandonedStarts++; };
        abandoned.deferDomStart(); window.dispatchEvent(new Event('pagehide'));
        document.querySelector('#app').removeAttribute('data-server-rendered');
    });
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => abandonedStarts), 0);
    assert.deepEqual(errors, []);
    console.log('通过：离开页面时断开等待，后续变更不会启动旧页面');
} finally { await browser.close(); }
