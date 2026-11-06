import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>' }));
    await page.goto('https://www.bilibili.com/video/BV0000000001');
    await page.evaluate(() => {
        const values = new Map();
        window.failGM = false;
        const check = () => { if (failGM) throw new Error('合成 GM 故障'); };
        window.GM_getValue = (key, fallback) => { check(); return values.has(key) ? structuredClone(values.get(key)) : fallback; };
        window.GM_setValue = (key, value) => { check(); values.set(key, structuredClone(value)); };
        window.GM_deleteValue = key => { check(); values.delete(key); };
        window.GM_listValues = () => { check(); return [...values.keys()]; };
        window.GM = { getValue: async (...args) => GM_getValue(...args), setValue: async (...args) => GM_setValue(...args),
            listValues: async () => GM_listValues(), deleteValue: async key => GM_deleteValue(key) };
        window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
        window.GM_registerMenuCommand = () => {};
        window.GM_info = { script: { version: 'test' }, scriptHandler: '合成管理器', version: '1.2.3' };
        window.unsafeWindow = window;
    });
    await page.evaluate(instrument());
    await page.evaluate(() => { testAPI.injectStyles(); testAPI.UIComponent.showManagerPanel({ activeTab: 'history' }); });

    async function importFile() {
        const chooser = page.waitForEvent('filechooser');
        await page.locator('.bvh-history-tools [data-action="import"]').click();
        await (await chooser).setFiles({ name: '合成异常.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ BV0000000001: { status: '已观看', percent: 'NaN%', title: '私人标题不应导出' } })) });
        await page.locator('.bvh-progress-toast.error').last().waitFor();
        assert.equal(await page.evaluate(() => testAPI.CONFIG.debug), false);
    }
    async function downloadByClick(locator, json = true) {
        const pending = page.waitForEvent('download');
        await locator.click();
        const download = await pending, stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        return json ? JSON.parse(text) : text;
    }
    await importFile();
    let diagnostic = await downloadByClick(page.locator('.bvh-progress-toast.error button').last());
    assert.equal(diagnostic.records[0].stage, '校验 JSON');
    assert.equal(diagnostic.records[0].environment.managerVersion, '1.2.3');
    assert(!JSON.stringify(diagnostic).includes('私人标题'));
    console.log('通过：真实文件选择、失败提示下载按钮、关闭调试时的诊断下载');

    await page.evaluate(() => {
        window.failGM = true;
        Storage.prototype.setItem = () => { throw new Error('合成本地存储故障'); };
        File.prototype.text = async () => { throw new Error('合成文件读取失败'); };
    });
    await importFile();
    diagnostic = await downloadByClick(page.locator('.bvh-progress-toast.error button').last());
    assert.equal(diagnostic.records[0].stage, '读取文件');
    assert.equal(diagnostic.records[0].persistence, 'memory');
    console.log('通过：读取失败且持久存储全部故障时仍能通过按钮下载内存现场');

    await page.locator('[data-tab="settings"]').click();
    await page.locator('.bvh-settings-nav [data-settings-group="maintenance"]').click();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const button = page.locator('[data-action="download-import-diagnostic"]');
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, '下载入口超出视口');
        diagnostic = await downloadByClick(button);
        assert.equal(diagnostic.records[0].persistence, 'memory');
    }
    const log = await downloadByClick(page.locator('[data-action="download-log"]'), false);
    assert.match(log, /导入失败诊断/);
    assert.match(log, /合成管理器 1.2.3/);
    assert.match(log, /合成文件读取失败/);
    assert.deepEqual(errors, []);
    console.log('通过：桌面与窄屏设置入口可用，普通日志包含自动诊断，无浏览器未处理异常');
} finally { await browser.close(); }
