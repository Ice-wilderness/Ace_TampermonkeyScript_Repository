import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { instrument, instance, sharedStorage } from './harness.mjs';

const shared = sharedStorage();
shared.data.set('bvh_settings', { tagOpacity: 70, lowThreshold: 25, coverFontSize: -8, tagLowBg: 'invalid' });
const legacy = instance(shared);
assert.equal(legacy.CONFIG.tagOpacity, 70);
assert.equal(legacy.CONFIG.lowThreshold, 25);
assert.equal(legacy.CONFIG.coverFontSize, 12);
assert.equal(legacy.CONFIG.tagLowBg, '#ff9800');
assert.equal(legacy.CONFIG.episodeLabelMode, 'full');
console.log('通过：旧设置自动补齐样式默认值，异常颜色和尺寸安全回退');

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        window.savedSettings = null;
        window.GM_getValue = (_key, fallback) => fallback;
        window.GM_setValue = (key, value) => { if (key === 'bvh_settings') window.savedSettings = structuredClone(value); };
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    });
    await page.evaluate(instrument());
    await page.evaluate(() => {
        const { StorageManager, DOMWatcher, Utils } = testAPI;
        for (const name of ['log', 'warn', 'error', 'logEvery', 'logSlow']) Utils[name] = () => {};
        Utils.debugTime = () => () => {};
        window.changes = [];
        StorageManager._notifyChange = change => changes.push(change);
        StorageManager.getRecord = () => ({ status: '已观看', percent: '55%', savedAt: '测试' });
        window.watcher = Object.create(DOMWatcher.prototype);
        window.item = document.createElement('div');
        item.className = 'video-pod__item'; item.dataset.key = 'BV0000000001';
        item.innerHTML = '<span class="title-txt">合集测试</span>'; document.body.append(item);
        watcher.processPlaylistItem(item);
        testAPI.injectStyles();
        window.panel = testAPI.HistoryManagerPanel.show({});
    });
    const setting = key => page.locator(`[data-setting="${key}"]`);
    assert.equal(await page.locator('.bvh-setting-groups > .bvh-section').count(), 3);
    assert.equal(await setting('debug').isVisible(), false);
    assert.equal(await setting('coverRingSize').isVisible(), false);
    await page.getByText('状态配色', { exact: true }).click();
    await setting('tagMidBg').fill('#123456');
    await setting('tagMidText').fill('#fedcba');
    await setting('coverFontSize').fill('20');
    await setting('coverRadius').fill('9');
    await setting('coverPadding').fill('12');
    await setting('coverLabelMode').selectOption('compact');
    await setting('episodeFontSize').fill('14');
    await setting('episodeRadius').fill('7');
    await setting('episodePadding').fill('8');
    await setting('episodeLabelMode').selectOption('compact');
    const read = selector => page.locator(selector).evaluate(el => {
        const s = getComputedStyle(el);
        return { text: el.textContent, bg: s.backgroundColor, color: s.color, font: s.fontSize, radius: s.borderRadius, padding: s.paddingLeft };
    });
    const cover = await read('[data-preview-tag]'), episode = await read('[data-preview-episode]');
    assert.deepEqual(cover, { text: '55%', bg: 'rgba(18, 52, 86, 0.9)', color: 'rgb(254, 220, 186)', font: '20px', radius: '9px', padding: '12px' });
    assert.equal(episode.font, '14px'); assert.equal(episode.radius, '7px'); assert.equal(episode.padding, '8px');
    assert.equal(await page.evaluate(() => testAPI.CONFIG.coverFontSize), 12, '草稿不得提前应用');
    assert.equal(await page.evaluate(() => savedSettings), null);
    console.log('通过：实时预览准确、封面和合集尺寸独立、草稿不修改已保存设置');

    await page.locator('[data-action="save"]').click();
    assert.equal(await page.evaluate(() => panel.root.querySelectorAll('[aria-invalid="true"]').length), 0, await page.locator('.bvh-save-status').textContent());
    assert.equal(await page.evaluate(() => savedSettings?.coverFontSize), 20, await page.locator('.bvh-save-status').textContent());
    await page.waitForFunction(() => savedSettings?.coverFontSize === 20 && !panel.saving);
    assert.equal(await page.evaluate(() => changes.some(change => change.settingsChanged)), true);
    const actual = await page.evaluate(() => {
        watcher.processPlaylistItem(item);
        const cover = testAPI.UIComponent.createTag('55%', '完整记录', 'bvh-tag bvh-tag-mid');
        document.body.append(cover);
        return { cover: cover.style.cssText, preview: panel.q('[data-preview-tag]').style.cssText,
            episode: item.querySelector('.bvh-episode-tag').style.cssText, text: item.querySelector('.bvh-episode-tag').textContent };
    });
    assert.equal(actual.text, '55%'); assert(actual.cover.includes('font-size: 20px')); assert(actual.episode.includes('font-size: 14px'));
    assert(actual.cover.includes('rgb(254, 220, 186)')); assert(actual.episode.includes('rgb(254, 220, 186)'));
    console.log('通过：保存持久化并通知页面刷新；既有合集标签更新样式和内容');

    await setting('coverStyle').selectOption('ring');
    await setting('episodeStyle').selectOption('ring');
    assert.equal(await setting('coverRadius').isVisible(), false);
    assert.equal(await setting('coverLabelMode').isVisible(), false);
    assert.equal(await setting('coverRingSize').isVisible(), true);
    assert.equal(await setting('coverRadius').inputValue(), '9', '切换样式不丢失隐藏字段草稿');
    await setting('coverRingSize').fill('48');
    await setting('episodeRingSize').fill('32');
    const ring = await page.locator('[data-preview-tag]').evaluate(el => ({ text: el.textContent, ring: el.classList.contains('bvh-tag-ring'), arc: el.querySelector('circle[pathLength]')?.getAttribute('stroke-dasharray'), width: el.style.width, height: el.style.height }));
    assert.equal(ring.text, '55%'); assert.equal(ring.ring, true);
    assert.equal(ring.width, '48px');
    assert.equal(await page.locator('[data-preview-episode]').evaluate(el => el.style.width), '32px');
    assert.equal(await page.locator('[data-preview-grid]').evaluate(el => el.style.width), '27px');
    assert.equal(ring.arc, '55 100'); assert.equal(ring.width, ring.height);
    assert.equal(await page.locator('[data-preview-bar]').isHidden(), true);
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => savedSettings?.coverStyle === 'ring' && !panel.saving);
    assert.equal(await page.evaluate(() => savedSettings.coverRingSize), 48);
    await setting('coverRingSize').fill('65');
    await page.locator('[data-action="save"]').click();
    assert.equal(await setting('coverRingSize').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => savedSettings.coverRingSize), 48);
    await setting('coverRingSize').fill('48');
    assert.equal(await page.evaluate(() => { watcher.processPlaylistItem(item); return item.querySelector('.bvh-tag-ring')?.textContent; }), '55%');
    const edges = await page.evaluate(() => ['0%', '100%', '150%', '-5%'].map(percent => {
        const tag = watcher.createEpisodeTag({ status: '已观看', percent });
        return { text: tag.textContent, arc: tag.querySelector('circle[pathLength]').getAttribute('stroke-dasharray'), opacity: tag.querySelector('circle[pathLength]').getAttribute('opacity') };
    }));
    assert.deepEqual(edges.map(edge => edge.text), ['0%', '100%', '100%', '0%']);
    assert.equal(edges[0].arc, '0 100'); assert.equal(edges[0].opacity, '0'); assert.equal(edges[1].arc, '100 100');
    for (const state of ['visited', 'multi']) {
        await page.locator(`[data-preview="${state}"]`).click();
        assert.equal(await page.locator('[data-preview-tag]').evaluate(el => el.classList.contains('bvh-tag-ring')), false);
    }
    await page.locator('[data-preview="mid"]').click();
    await page.evaluate(() => {
        window.previewDraft = { ...panel.draft };
        for (const key of ['tagMidBg', 'tagMidText', 'coverFontSize', 'episodeFontSize']) panel.draft[key] = testAPI.DEFAULT_CONFIG[key];
        panel.renderPreview();
    });
    await page.locator('.bvh-preview-panel').screenshot({ path: path.join(os.tmpdir(), 'bvh-ring-preview.png') });
    await page.evaluate(() => { panel.draft = previewDraft; panel.renderPreview(); });
    await setting('coverStyle').selectOption('label');
    await setting('episodeStyle').selectOption('label');
    assert.equal(await page.locator('[data-preview-tag]').evaluate(el => el.style.backgroundImage), '');
    assert.equal(await page.locator('[data-preview-tag]').evaluate(el => el.style.width), '');
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => savedSettings.coverStyle === 'label' && !panel.saving);
    console.log('通过：圆环预览、保存、现有标签切换、0/100% 边界与无进度文字回退');

    await setting('coverFontSize').fill('99');
    await page.locator('[data-action="save"]').click();
    assert.equal(await setting('coverFontSize').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => savedSettings.coverFontSize), 20);
    await setting('coverFontSize').fill('20');
    await setting('showProgressBar').uncheck();
    await page.locator('[data-action="style-defaults"]').click();
    assert.equal(await setting('coverFontSize').inputValue(), '12');
    assert.equal(await setting('episodeFontSize').inputValue(), '10');
    assert.equal(await setting('coverRingSize').inputValue(), '36');
    assert.equal(await setting('episodeRingSize').inputValue(), '27');
    assert.equal(await setting('tagMidBg').inputValue(), '#4285f4');
    assert.equal(await setting('showProgressBar').isChecked(), false, '样式重置不能修改其他偏好');
    assert.equal(await page.evaluate(() => savedSettings.coverFontSize), 20, '重置草稿仍需保存');
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => savedSettings.coverFontSize === 12 && !panel.saving);
    console.log('通过：非法输入阻止保存，恢复样式默认值保留其他偏好且保存后生效');

    const advanced = page.getByText('位置、透明度与进度分界', { exact: true });
    await advanced.click();
    await setting('highThreshold').fill('0');
    await advanced.click();
    await page.locator('[data-action="save"]').click();
    assert.equal(await setting('highThreshold').isVisible(), true);
    assert.equal(await setting('highThreshold').evaluate(el => el === document.activeElement), true);
    await setting('highThreshold').fill('80');
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(() => !panel.saving);
    await advanced.click();
    console.log('通过：三组设置、按样式隐藏无关选项、保留草稿，折叠项出错自动展开并聚焦');

    for (const [name, text] of [['visited', '已访问'], ['low', '已观看15%'], ['high', '已观看95%'], ['multi', '已记录 多P']]) {
        await page.locator(`[data-preview="${name}"]`).click();
        assert.equal(await page.locator('[data-preview-tag]').textContent(), text);
    }
    await page.locator('[data-preview="mid"]').click();
    await page.evaluate(() => { panel.q('.bvh-content').scrollTop = 650; });
    await page.screenshot({ path: path.join(os.tmpdir(), 'bvh-tag-style-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('状态配色', { exact: true }).click();
    await page.locator('.bvh-tag-colors').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(os.tmpdir(), 'bvh-tag-style-mobile.png') });
    const overflow = await page.evaluate(() => [...panel.root.querySelectorAll('.bvh-content, .bvh-section, .bvh-shell')].filter(el => el.scrollWidth > el.clientWidth + 1).length);
    assert.equal(overflow, 0, '窄窗口不应出现横向溢出');
    console.log('通过：四种状态与多 P 预览，390px 窄窗口无横向溢出');

    await page.setViewportSize({ width: 700, height: 500 });
    const layout = await page.evaluate(() => {
        panel.dispose();
        Object.assign(testAPI.CONFIG, { coverStyle: 'ring', episodeStyle: 'ring', coverFontSize: 24, episodeFontSize: 16 });
        document.body.innerHTML = `<style>
            body{font:14px sans-serif;padding:24px;background:#fff;color:#24282e}
            .fixture{width:340px;padding:16px;background:#f1f2f3;border-radius:10px;margin-bottom:20px}
            .fixture .video-pod__item{display:flex;align-items:center;gap:10px;height:36px}
            .fixture .title-txt{display:flex;align-items:center;flex:1;min-width:0;overflow:hidden}
            .fixture .title-txt>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
            .duration{flex:none;color:#999}
            .header-dynamic__box--right{display:block}.cover{width:120px;height:68px;overflow:hidden;border-radius:5px;background:#657988}
            .cover img{width:120px;height:68px}
            /* 模拟站点 SVG 全局规则和从卡片继承的字距。 */
            .fixture{letter-spacing:2px}.fixture svg text{text-anchor:start;dominant-baseline:auto;letter-spacing:3px;font-size:18px!important;stroke:red}
            </style><div class="fixture"><h3>合集 · 紧凑列表</h3>${[5, 100].map(p => `<div class="video-pod__item" data-key="BV0000000001"><div class="title-txt"><span>这是很长很长的视频标题，仍然需要为进度和时长留出空间</span></div><span class="duration">02:01</span></div>`).join('')}</div>
            <div class="fixture dynamic-panel-popover"><h3>动态弹窗 · 小封面</h3><a class="header-dynamic__box--right" href="/video/BV0000000001"><div class="cover"><img alt="视频封面"></div></a></div>`;
        const rows = [...document.querySelectorAll('.video-pod__item')];
        rows.forEach((el, index) => {
            testAPI.StorageManager.getRecord = () => ({ status: '已观看', percent: index ? '100%' : '5%' });
            watcher.processPlaylistItem(el);
        });
        watcher.relatedKeysCache = new Map();
        watcher.processLink(document.querySelector('a'));
        return [...document.querySelectorAll('.bvh-tag-ring')].map(el => {
            const r = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
            const text = el.querySelector('text').getBoundingClientRect();
            return { width: r.width, height: r.height, inside: r.left >= parent.left && r.right <= parent.right,
                textFits: text.left >= r.left + 4 && text.right <= r.right - 4 && text.top >= r.top + 3 && text.bottom <= r.bottom - 3,
                centered: Math.abs((text.left + text.right) / 2 - (r.left + r.right) / 2) < 1, small: el.classList.contains('bvh-tag-small') };
        });
    });
    assert.equal(layout.length, 3);
    for (const box of layout) {
        assert.equal(box.width, box.height, 'flex 布局不得将圆环压扁');
        assert(box.width <= (box.small ? 36 : 27)); assert(box.inside); assert(box.textFits, '100% 文字必须在内圈留白范围内'); assert(box.centered);
    }
    assert.equal(layout[2].width, 36, '小封面圆环上限放宽至 36px');
    assert.equal(layout[2].small, true, '弹窗封面应自动使用紧凑尺寸');
    const updated = await page.evaluate(() => {
        const el = document.querySelector('a'), oldTag = el._bvhTag;
        testAPI.StorageManager.getRecord = () => ({ status: '已观看', percent: '55%' });
        watcher.processLink(el);
        return { reused: oldTag === el._bvhTag, svg: !!el._bvhTag.querySelector('svg'), text: el._bvhTag.textContent };
    });
    assert.deepEqual(updated, { reused: true, svg: true, text: '55%' });
    await page.emulateMedia({ colorScheme: 'light' });
    const theme = () => page.locator('.bvh-tag-ring').first().evaluate(el => ({
        surface: getComputedStyle(el.querySelector('circle')).fill,
        ink: getComputedStyle(el.querySelector('text')).fill
    }));
    assert.deepEqual(await theme(), { surface: 'rgb(255, 255, 255)', ink: 'rgb(24, 35, 47)' });
    await page.screenshot({ path: path.join(os.tmpdir(), 'bvh-ring-compact-layout.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.deepEqual(await theme(), { surface: 'rgb(24, 24, 24)', ink: 'rgb(255, 255, 255)' });
    await page.screenshot({ path: path.join(os.tmpdir(), 'bvh-ring-dark-layout.png') });
    console.log('通过：SVG 圆环原位更新，系统深浅色切换无需重新渲染即可生效');
    console.log('通过：长标题 flex 列表和 120×68 弹窗封面，即使最大字号也保持正圆、完整文字且不溢出');
} finally {
    await browser.close();
}
