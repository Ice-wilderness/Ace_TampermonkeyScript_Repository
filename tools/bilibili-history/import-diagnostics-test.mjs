import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record } from './fixtures.mjs';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const report = async w => (await w.ImportDiagnostics.collect()).records[0];
const invalid = percent => JSON.stringify({ [key(1)]: { ...record(), percent, title: '不应进入诊断的私人标题' } });
const diagnosticKeys = w => [...w.shared.data.keys()].filter(key => key.startsWith(w.ImportDiagnostics.prefix));

test('默认关闭调试也保留校验现场，刷新后可读，包含管理器版本但不含标题或文件名', async () => {
    const w = instance();
    w.context.GM_info = { script: { version: '4.5.0-test' }, scriptHandler: '合成管理器', version: '1.2.3' };
    assert.equal(w.CONFIG.debug, false);
    await assert.rejects(w.StorageManager.importFile(invalid('NaN%'), '私人文件名.json'), /百分比/);
    const entry = await report(instance(w.shared));
    assert.equal(entry.stage, '校验 JSON');
    assert.equal(entry.environment.manager, '合成管理器');
    assert.equal(entry.environment.managerVersion, '1.2.3');
    assert.equal(entry.environment.scriptVersion, '4.5.0-test');
    assert.equal(entry.file.format, 'json');
    assert(entry.file.size > 0);
    assert.equal(entry.recordCount, 1);
    assert.equal(entry.validation.key, key(1));
    assert.equal(entry.validation.value.type, 'string');
    assert.equal(entry.validation.value.value, 'NaN%');
    assert.match(entry.error.stack, /validateImport/);
    assert(!JSON.stringify(entry).includes('私人'));
    assert.equal(w.StorageManager.getAllKeys().length, 0);
});

test('JSON 解析错误不泄露原生错误附带的正文，异常字段限长', async () => {
    const w = instance();
    await assert.rejects(w.StorageManager.importFile('私人正文并非JSON', '错误.json'));
    let entry = await report(w);
    assert.equal(entry.stage, '解析 JSON');
    assert(!JSON.stringify(entry).includes('私人正文'));
    assert.match(entry.error.stack, /at /);
    const firefoxError = { name: 'SyntaxError', message: '错误正文 at line 2 column 3',
        stack: 'JSON.parse@moz-extension://synthetic/script.js:2:3\nimportFile@https://www.bilibili.com/test.js:4:5' };
    const safe = w.ImportDiagnostics.errorInfo(firefoxError, true);
    assert.match(safe.stack, /importFile@https:/);
    assert.match(safe.message, /line 2 column 3/);
    assert(!safe.message.includes('错误正文'));
    await assert.rejects(w.StorageManager.importFile(invalid('9'.repeat(1000)), '超长.json'));
    entry = await report(w);
    assert.equal(entry.validation.value.length, 1000);
    assert(entry.validation.value.value.length < 180);
});

test('CSV 解析与行校验分开记录，保留出错行和实际时长', async () => {
    const w = instance();
    const headers = '标题,视频链接,观看时间,观看进度,完成度';
    await assert.rejects(w.StorageManager.importFile(headers + '\n"未闭合', '错误.csv'));
    assert.equal((await report(w)).stage, '解析 CSV');
    await assert.rejects(w.StorageManager.importFile(headers + `\n私人标题,https://www.bilibili.com/video/${key(1)},2026-09-06 08:00:00,Infinity秒,50%`, '错误.csv'));
    const entry = await report(w);
    assert.equal(entry.stage, '校验 CSV');
    assert.equal(entry.validation.row, 2);
    assert.equal(entry.validation.field, '时长');
    assert.equal(entry.validation.value.value, 'Infinity秒');
    assert(!JSON.stringify(entry).includes('私人标题'));
});

test('File.text、FileReader 读取错误和中止均留存，原始错误不被替换', async () => {
    const w = instance(), failure = new Error('合成读取错误');
    await assert.rejects(w.StorageManager.importLocalFile({ name: '读取.csv', size: 123, text: async () => { throw failure; } }), error => error === failure);
    assert.equal((await report(w)).stage, '读取文件');
    assert.equal((await report(w)).file.size, 123);
    for (const event of ['onerror', 'onabort']) {
        w.context.FileReader = class { readAsText() { this.error = failure; this[event](); } };
        await assert.rejects(w.StorageManager.importLocalFile({ name: '读取.json' }));
        assert.equal((await report(w)).stage, '读取文件');
    }
    assert.equal(diagnosticKeys(w).length, 3);
});

test('写入回读内容被篡改时保留块编号、预期与实际校验和', async () => {
    const w = instance();
    w.shared.before = ({ name, args }) => {
        if (name === 'getValue' && args[0].startsWith('bvh_tx_') && w.shared.data.has(args[0]))
            w.shared.data.get(args[0]).entries[0].record.p = 99;
    };
    await assert.rejects(w.StorageManager.importFile(JSON.stringify({ [key(1)]: record() }), '正常.json'), /历史数据块写入未确认/);
    const entry = await report(w);
    assert.equal(entry.stage, '校验数据块');
    assert.match(entry.storage.transaction, /^bvh_commit_/);
    assert.match(entry.storage.block, /^bvh_tx_/);
    assert.equal(entry.storage.expectedCount, 1);
    assert.equal(entry.storage.actualCount, 1);
    assert.notEqual(entry.storage.expectedChecksum, entry.storage.actualChecksum);
});

test('提交清单被损坏时记录最终确认阶段和总条数差异', async () => {
    const w = instance();
    w.shared.before = ({ name, args }) => {
        if (name === 'getValue' && args[0].startsWith('bvh_commit_') && w.shared.data.has(args[0]))
            w.shared.data.get(args[0]).count = 99;
    };
    await assert.rejects(w.StorageManager.importFile(JSON.stringify({ [key(1)]: record() }), '正常.json'), /历史提交未确认/);
    const entry = await report(w);
    assert.equal(entry.stage, '确认提交');
    assert.equal(entry.storage.manifestCount, 99);
    assert.equal(entry.storage.actualEntryCount, 1);
    assert.match(entry.storage.confirmationError, /总条数/);
});

test('历史写入失败且 GM 无法保存诊断时降级本地，重载同源页面仍可下载', async () => {
    const w = instance(), failure = new Error('合成 GM 写入失败');
    w.shared.before = ({ name }) => { if (name === 'setValue') throw failure; };
    await assert.rejects(w.StorageManager.importFile(JSON.stringify({ [key(1)]: record() }), '正常.json'), error => error === failure);
    const entry = await report(w);
    assert.equal(entry.stage, '写入数据块');
    assert.equal(entry.persistence, 'localStorage');
    assert.match(entry.persistenceError.message, /GM 写入失败/);
    const next = instance(w.shared);
    next.context.localStorage = w.context.localStorage;
    assert.equal((await report(next)).id, entry.id);
});

test('两种持久存储都不可用时保留内存并可直接下载，普通日志也包含诊断', async () => {
    const w = instance();
    w.shared.before = () => { throw new Error('合成 GM 不可用'); };
    w.context.localStorage.setItem = () => { throw new Error('合成本地存储不可用'); };
    await assert.rejects(w.StorageManager.importFile(invalid('NaN%'), '失败.json'));
    assert.equal((await report(w)).persistence, 'memory');
    const original = new Error('合成错误');
    await assert.rejects(w.StorageManager.importLocalFile({ name: '失败.json', text: async () => { throw original; } }));
    assert.match(w.ImportDiagnostics.failureMessage(original), /先下载再刷新/);
    let anchor;
    w.context.Blob = Blob;
    w.context.navigator = { userAgent: '合成浏览器' };
    w.context.document.createElement = () => (anchor = { click() { this.clicked = true; } });
    await w.ImportDiagnostics.download();
    assert.equal(anchor.clicked, true);
    let content = await (await fetch(anchor.href)).json();
    URL.revokeObjectURL(anchor.href);
    assert(content.records.some(entry => entry.validation?.value.value === 'NaN%'));
    assert.match(content.unavailable.join(), /GM/);
    await w.Utils.downloadDebugLog();
    content = await (await fetch(anchor.href)).text();
    URL.revokeObjectURL(anchor.href);
    assert.match(content, /导入失败诊断/);
    assert.match(content, /NaN%/);
    assert.match(content, /脚本管理器/);
});

test('诊断存储无响应有超时降级，不阻止原始错误返回', async () => {
    const w = instance();
    w.shared.before = ({ name }) => name === 'setValue' ? new Promise(() => {}) : undefined;
    const failed = assert.rejects(w.StorageManager.importFile(invalid('NaN%'), '失败.json'), /百分比/);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    w.flushTimers();
    await failed;
    const entry = await report(w);
    assert.equal(entry.persistence, 'localStorage');
    assert.match(entry.persistenceError.message, /超时/);
});

test('诊断数量有上限，多页面并发不会互相覆盖，清理不触碰历史记录', async () => {
    const shared = sharedStorage(), a = instance(shared, 'a'), b = instance(shared, 'b');
    shared.data.set('bvh_shard_1', { synthetic: '应保留的历史' });
    await Promise.all([a.StorageManager.importFile(invalid('NaN%'), 'a.json').catch(() => {}), b.StorageManager.importFile(invalid('NaN%'), 'b.json').catch(() => {})]);
    assert.equal(diagnosticKeys(a).length, 2);
    for (let i = 0; i < 23; i++) await a.StorageManager.importFile(invalid('NaN%'), '失败.json').catch(() => {});
    assert.equal(diagnosticKeys(a).length, 20);
    assert.equal((await a.ImportDiagnostics.collect()).records.length, 20);
    await a.ImportDiagnostics.clear();
    assert.equal(diagnosticKeys(a).length, 0);
    assert.equal(a.context.localStorage.length, 0);
    assert.equal(a.ImportDiagnostics.memory.size, 0);
    assert.equal(shared.data.get('bvh_shard_1').synthetic, '应保留的历史');
});

test('成功导入不产生诊断存储读写', async () => {
    const w = instance();
    assert.equal((await w.StorageManager.importFile(JSON.stringify({ [key(1)]: record() }), '正常.json')).count, 1);
    assert(!w.shared.calls.some(call => call.key?.startsWith(w.ImportDiagnostics.prefix)));
    assert.equal(w.ImportDiagnostics.memory.size, 0);
});

test('损坏的持久诊断不会阻止导出有效现场，同步 GM API 也可留存', async () => {
    const w = instance(); w.context.GM = undefined;
    await assert.rejects(w.StorageManager.importFile(invalid('NaN%'), '异常.json'));
    w.shared.data.set(w.ImportDiagnostics.prefix + 'corrupt', { id: 42 });
    w.context.localStorage.setItem(w.ImportDiagnostics.prefix + 'corrupt', '非 JSON');
    const result = await w.ImportDiagnostics.collect();
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].persistence, 'GM');
    assert.match(result.unavailable.join(), /无效|失败/);
});

let failed = 0;
for (const { name, run } of tests) {
    try { await run(); console.log(`通过：${name}`); }
    catch (error) { failed++; console.error(`失败：${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} 导入诊断测试通过`);
process.exitCode = failed ? 1 : 0;
