import assert from 'node:assert/strict';
import { instance } from './harness.mjs';
import { key, record, legacy, invalidImports } from './fixtures.mjs';

const headers = '标题,UP主,分类,视频链接,观看时间,视频时长,观看进度,完成度,是否收藏';
const ownHeaders = '标题,视频链接,观看时间,观看进度,完成度';
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
const row = (n = 1, overrides = {}) => [
    '合成标题,含"引号"\n和换行', '合成 UP 主', '测试分类', `https://www.bilibili.com/video/${key(n)}`,
    '2026/09/06 08:00:00', '10分钟0秒', '5分钟0秒', '50.0%', '否'
].map((value, index) => overrides[index] ?? value).map(quote).join(',');
const csv = (...rows) => '\uFEFF' + [headers, ...rows].join('\r\n');
const tests = [];
const test = (name, run) => tests.push({ name, run });

async function download(w, format) {
    let anchor;
    w.context.Blob = Blob;
    w.context.document.createElement = tag => {
        assert.equal(tag, 'a');
        anchor = { click() { this.clicked = true; } };
        return anchor;
    };
    await w.HistoryManagerPanel.prototype.export.call({}, format);
    assert.equal(anchor.clicked, true);
    try { return { content: await (await fetch(anchor.href)).text(), filename: anchor.download }; }
    finally { URL.revokeObjectURL(anchor.href); }
}

test('附件九列 CSV：引号换行、BOM、时间、已看完和异常完成度', async () => {
    const w = instance(), s = w.StorageManager;
    const result = await s.importFile(csv(
        row(),
        row(2, { 6: '-1秒', 7: '-0.2%' }),
        row(3, { 5: '0秒', 6: '0秒', 7: 'NaN%' }),
        row(4, { 5: '1小时1分钟', 6: '1小时0分钟', 7: '98.4%' }),
        row(5, { 3: `https://www.bilibili.com/video/${key(5)}?p=2`, 7: '150.0%' })
    ), '外部.CSV');
    assert.deepEqual({ ...result }, { count: 5, skipCount: 0 });
    assert.equal(s.getRecord(key(1)).title, '合成标题,含"引号"\n和换行');
    assert.equal(s.getRecord(key(1)).savedAt, '2026-09-06 08:00:00');
    assert.equal(s.getRecord(key(1)).currentTime, '05:00');
    assert.equal(s.getRecord(key(1)).percent, '50%');
    assert.equal(s.getRecord(key(2)).currentTime, '10:00');
    assert.equal(s.getRecord(key(2)).percent, '100%');
    assert.equal(s.getRecord(key(3)).status, '已观看');
    assert.equal(s.getRecord(key(4)).currentTime, '01:00:00');
    assert.equal(s.getRecord(key(4)).percent, '98%');
    assert.equal(s.getRecord(key(5, 2)).percent, '100%');
    assert.equal((await s.importFile(csv(row()), '重复.csv')).skipCount, 1);
    assert.equal(s.getRecord(key(1)).percent, '50%');
});

test('重复视频选最新观看时间，同时间选较高进度，已有记录不覆盖', async () => {
    const w = instance(), s = w.StorageManager;
    await s.saveRecord(key(2), record(90));
    const result = await s.importFile(csv(
        row(1, { 4: '2026/09/05 08:00:00', 7: '90.0%' }),
        row(1, { 7: '20.0%' }), row(1, { 7: '30.0%' }), row(2)
    ), '历史.csv');
    assert.deepEqual({ ...result }, { count: 1, skipCount: 3 });
    assert.equal(s.getRecord(key(1)).percent, '30%');
    assert.equal(s.getRecord(key(2)).percent, '90%');
});

test('异常 CSV 全量校验后拒绝，不写入前面的有效记录', async () => {
    const badFiles = [
        csv(row(), row(2, { 3: 'https://example.com/video/' + key(2) })),
        csv(row(), row(2, { 3: 'https://www.bilibili.com/video/不是视频' })),
        csv(row(), row(2, { 3: `https://www.bilibili.com/video/${key(2)}?p=0` })),
        csv(row(), row(2, { 4: '2026/02/30 08:00:00' })),
        csv(row(), row(2, { 4: '错误日期' })),
        csv(row(), row(2, { 5: '-1秒' })),
        csv(row(), row(2, { 6: '-2秒' })),
        csv(row(), row(2, { 6: 'Infinity秒' })),
        csv(row(), row(2, { 7: 'NaN%' })),
        csv(row(), row(2, { 6: '-1秒', 7: '错误完成度' })),
        csv(row(), row(2, { 7: '-20%' })),
        csv(row(), row(2)) + ',多余列',
        csv(row()) + '\r\n"未闭合',
        csv(row()) + '\r\n"已闭合"非法后缀',
        '错误表头\n' + row()
    ];
    for (const content of badFiles) {
        const w = instance();
        await assert.rejects(w.StorageManager.importFile(content, '异常.csv'));
        assert.equal(w.StorageManager.getAllKeys().length, 0);
        assert.equal(w.shared.calls.filter(call => call.type === 'set').length, 0);
    }
});

test('CSV 导出仅含五列，支持自身往返、分 P 和超过一小时的秒数', async () => {
    const w = instance(), s = w.StorageManager;
    await s.saveRecord(key(1, 2), { ...record(61), currentTime: '01:01:01', title: '标题,"双引号"\r\n第二行' });
    await s.saveRecord(key(2), { ...record(0), status: '已访问', currentTime: '' });
    const exported = await download(w, 'csv');
    assert.match(exported.filename, /\.csv$/);
    assert.equal(exported.content.split('\r\n')[0], ownHeaders);
    assert.match(exported.content, /1小时1分钟1秒/);
    assert(!exported.content.includes('UP主'));
    const target = instance();
    assert.equal((await target.StorageManager.importFile(exported.content, exported.filename)).count, 2);
    const original = Object.fromEntries(s.getAllRecords().map(item => [item.key, item.record]));
    const restored = Object.fromEntries(target.StorageManager.getAllRecords().map(item => [item.key, item.record]));
    assert.deepEqual(structuredClone(restored), structuredClone(original));
});

test('JSON 导入导出和旧格式校验保持原样，空 CSV 可正常导入', async () => {
    const w = instance(), s = w.StorageManager;
    for (const data of invalidImports()) await assert.rejects(s.importFile(JSON.stringify(data), '原备份.json'));
    await assert.rejects(s.importFile('[]', '原备份.json'));
    assert.equal((await s.importFile(JSON.stringify(legacy()), '原备份.json')).count, 3);
    assert.equal((await s.importFile(JSON.stringify(legacy()), '原备份.json')).skipCount, 3);
    const exported = await download(w);
    assert.match(exported.filename, /\.json$/);
    assert.deepEqual(JSON.parse(exported.content), structuredClone(Object.fromEntries(s.getAllRecords().map(item => [item.key, item.record]))));
    assert.equal((await s.importFile(headers + '\r\n', '空.csv')).count, 0);
    assert.equal((await s.importFile(ownHeaders + '\n', '空.csv')).count, 0);
});

test('菜单和管理面板的导入入口均接受 CSV，菜单提供 CSV 导出', async () => {
    const w = instance(), menus = new Map(), messages = [];
    let input;
    w.context.GM_registerMenuCommand = (name, callback) => menus.set(name, callback);
    w.context.document.createElement = () => (input = { click() {} });
    w.context.FileReader = class {
        readAsText(file) { this.done = this.onload({ target: { result: file.content } }); readers.push(this.done); }
    };
    const readers = [];
    w.UIComponent.toast = message => messages.push(message);
    w.AppController.prototype.initMenuCommands.call({});
    assert(menus.has('导出历史记录（CSV）'));
    menus.get('导入历史记录')();
    assert.equal(input.accept, '.json,.csv');
    input.onchange({ target: { files: [{ name: '菜单.csv', content: csv(row()) }] } });
    await Promise.all(readers);
    assert.equal(w.StorageManager.getRecord(key(1)).percent, '50%');
    assert.match(messages.at(-1), /成功导入 1/);
    const panel = { busy: false, disposed: false, refresh() { this.refreshed = true; } };
    w.UIComponent.progressToast = () => ({ close: message => messages.push(message) });
    w.HistoryManagerPanel.prototype.import.call(panel);
    assert.equal(input.accept, '.json,.csv');
    input.files = [{ name: '面板.csv', text: async () => csv(row(2)) }];
    await input.onchange();
    assert.equal(w.StorageManager.getRecord(key(2)).percent, '50%');
    assert.equal(panel.refreshed, true);
    assert.equal(panel.busy, false);
});

let failed = 0;
for (const { name, run } of tests) {
    try { await run(); console.log(`通过：${name}`); }
    catch (error) { failed++; console.error(`失败：${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} 通过`);
process.exitCode = failed ? 1 : 0;
