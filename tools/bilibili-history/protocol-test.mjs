import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, invalidImports, legacy, epoch } from './fixtures.mjs';
const tests = [];
const test = (name, run) => tests.push([name, run]);
const fresh = async shared => { const w = instance(shared); await w.StorageManager.initialize(); return w; };
const entry = (w, n, percent = 50, version = w.StorageManager.sampleVersion()) => ({ key: key(n), record: w.StorageManager._compact(record(percent)), source: 'playback', version, deleted: false });

test('整数哈希与旧乘法逐字一致，兼容嵌套字段、Unicode、长文本和旧校验格式', () => {
    const { HistoryCommitStore: Store } = instance();
    const previous = (value, canonical) => {
        const text = JSON.stringify(value, canonical ? (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item : undefined);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return `${canonical ? 'sorted:' : ''}${text.length}:${hash >>> 0}`;
    };
    const values = [null, false, 0, -0, NaN, '中文😀\ud800', { 10: '十', 2: '二', z: undefined, a: [null, undefined, , 3] },
        { z: '长文本😀'.repeat(20000), a: [{ p: 100, title: '引号"及\\换行\n' }] }];
    let state = 123456;
    for (let i = 0; i < 200; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        values.push({ z: [state, String.fromCharCode(state & 65535)], a: { p: i % 101, t: `${i}:00`, n: '标题' + state } });
    }
    for (const value of values) for (const canonical of [false, true])
        assert.equal(Store.checksum(value, canonical), previous(value, canonical));
});

test('新提交复用预期校验和，诊断与验证共用回读结果，实际正文仍独立校验四遍', async () => {
    const w = await fresh(), Store = w.HistoryCommitStore, store = w.StorageManager._store;
    const checksum = Store.checksum; let bodyChecks = 0;
    Store.checksum = (value, ...args) => { if (Array.isArray(value?.entries)) bodyChecks++; return checksum(value, ...args); };
    const tx = await store.prepare([entry(w, 1), entry(w, 2)]);
    assert.equal(bodyChecks, tx.blocks.length, '准备阶段每块只计算一次预期值');
    await store.publish(tx, null, false, { stage: '', storage: {} });
    assert.equal(bodyChecks, tx.blocks.length * 4, '准备、写后回读、提交确认与同步各校验一次');
    const ref = tx.manifest.blocks[0];
    w.shared.data.get(ref.key).entries[0].record.p++;
    await assert.rejects(store.publish(tx, null, false, { stage: '', storage: {} }), /提交身份冲突/);
});

test('准备后的正文被修改时不能靠复用的预期值发布，提交确认也拒绝晚到的损坏', async () => {
    for (const late of [false, true]) {
        const w = await fresh(), store = w.StorageManager._store, tx = await store.prepare([entry(w, 1)]);
        if (!late) tx.blocks[0].value.entries[0].record.p++;
        else w.shared.before = ({ name, args }) => {
            if (name === 'setValue' && args[0] === tx.key) w.shared.data.get(tx.blocks[0].key).entries[0].record.p++;
        };
        await assert.rejects(store.publish(tx, null, false, { stage: '', storage: {} }), /写入未确认|历史提交未确认/);
        assert.equal((await fresh(w.shared)).StorageManager.getAllKeys().length, 0);
    }
});

test('不同子域并行保存及遗漏信号', async () => {
    const shared = sharedStorage(); shared.dropSignals = true;
    const a = await fresh(shared), b = await fresh(shared);
    await Promise.all([a.StorageManager.saveRecord(key(2), record()), b.StorageManager.saveRecord(key(8), record())]);
    const c = await fresh(shared); assert.equal(c.StorageManager.getAllKeys().length, 2);
    await a.StorageManager._syncIfStale(); assert.equal(a.StorageManager.getAllKeys().length, 2);
});
test('每个数据块和清单写入失败均不可见，同事务重试幂等', async () => {
    for (let failAt = 1; failAt <= 4; failAt++) {
        const shared = sharedStorage(), w = await fresh(shared), store = w.StorageManager._store;
        const tx = await store.prepare([entry(w, 1), entry(w, 2), entry(w, 3)]);
        assert.equal(tx.blocks.length, 3); let calls = 0;
        shared.before = ({ name, args }) => { if (name === 'setValue' && /^bvh_(tx|commit)_/.test(args[0]) && ++calls === failAt) throw new Error('注入写入失败'); };
        await assert.rejects(store.publish(tx));
        assert.equal((await fresh(shared)).StorageManager.getAllKeys().length, 0);
        shared.before = null; await store.publish(tx); await store.publish(tx);
        assert.equal((await fresh(shared)).StorageManager.getAllKeys().length, 3);
        assert.equal([...shared.data.keys()].filter(k => k.startsWith('bvh_commit_')).length, 1);
    }
});
const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, reorder(value[key])])) : value;

test('对象字段重排不影响校验，数组顺序和字段内容仍参与校验', () => {
    const { HistoryCommitStore: Store } = instance();
    const value = { z: [{ title: '中文标题', progress: 50 }, { second: true }], a: null };
    assert.equal(Store.checksum(value), Store.checksum(reorder(value)));
    assert.notEqual(Store.checksum(value), Store.checksum({ ...value, z: [...value.z].reverse() }));
    assert.notEqual(Store.checksum(value), Store.checksum({ ...value, a: 0 }));
});

test('存储回读重排嵌套字段时 JSON/CSV 均可导入，重启、重试和快照正常', async () => {
    for (const modern of [true, false]) {
        const shared = sharedStorage(), w = instance(shared);
        const get = w.context.GM_getValue;
        w.context.GM_getValue = (key, fallback) => reorder(get(key, fallback));
        if (modern) w.context.GM.getValue = async (key, fallback) => w.context.GM_getValue(key, fallback);
        else w.context.GM = undefined;
        assert.equal((await w.StorageManager.importFile(JSON.stringify({ [key(1)]: record(50) }), '历史.json')).count, 1);
        const csv = `标题,视频链接,观看时间,观看进度,完成度\n测试,https://www.bilibili.com/video/${key(2)},2026-09-06 08:00:00,5分钟0秒,50%`;
        assert.equal((await w.StorageManager.importFile(csv, '历史.csv')).count, 1);
        const tx = await w.StorageManager._store.prepare([entry(w, 3)]);
        await w.StorageManager._store.publish(tx);
        await w.StorageManager._store.publish(tx);
        const c = await fresh(shared);
        assert.equal(c.StorageManager.getAllKeys().length, 3);
        assert.equal(await w.StorageManager.createLegacySnapshot({ writersStopped: true }), 3);
        const ref = tx.manifest.blocks[0], stored = shared.data.get(ref.key);
        stored.entries[0].record.p = 99;
        assert.equal(await c.StorageManager._store.readCommit(tx.key), null, '内容损坏仍须拒绝');
    }
});

test('旧版未标记校验和的提交仍可读取，损坏块仍拒绝', async () => {
    const w = await fresh(), store = w.StorageManager._store;
    const tx = await store.prepare([entry(w, 1)]);
    for (const ref of tx.manifest.blocks) {
        const value = tx.blocks.find(block => block.key === ref.key).value;
        const text = JSON.stringify(value);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        ref.checksum = `${text.length}:${hash >>> 0}`;
    }
    await store.publish(tx);
    assert.equal((await fresh(w.shared)).StorageManager.getRecord(key(1)).percent, '50%');
    w.shared.data.get(tx.blocks[0].key).entries[0].record.p = 99;
    assert.equal(await store.readCommit(tx.key), null);
});

test('缺失 API 报错及同步兼容适配', async () => {
    const w = instance(); w.context.GM = undefined; w.context.GM_setValue = undefined;
    await assert.rejects(w.HistoryStoreIO.set('test', 1), /缺少存储能力/);
    const b = instance(); b.context.GM = undefined; await b.HistoryStoreIO.set('test', 1);
    assert.equal(await b.HistoryStoreIO.get('test'), 1);
});
test('原采样版本、同时间决胜与从头重看', async () => {
    const shared = sharedStorage(), w = await fresh(shared), store = w.StorageManager._store;
    const older = await store.prepare([entry(w, 1, 80, [epoch, 'a', 1])]);
    const newer = await store.prepare([entry(w, 1, 20, [epoch, 'b', 1])]);
    await store.publish(newer); await store.publish(older);
    const c = await fresh(shared); assert.equal(c.StorageManager.getRecord(key(1)).percent, '20%');
    await c.StorageManager.saveRecord(key(1), record(5));
    assert.equal((await fresh(shared)).StorageManager.getRecord(key(1)).percent, '5%');
});
test('所有无效导入原子拒绝，旧格式与跳过已有记录', async () => {
    const w = await fresh();
    for (const input of invalidImports()) await assert.rejects(w.StorageManager.importRecords(input));
    assert.equal(w.StorageManager.getAllKeys().length, 0);
    assert.equal((await w.StorageManager.importRecords(legacy())).count, 3);
    assert.equal((await w.StorageManager.importRecords(legacy())).skipCount, 3);
});
test('历史同步五个百分点边界及 currentTime 保留', async () => {
    const w = await fresh(); await w.StorageManager.saveRecord(key(1), record(50));
    assert.equal(await w.StorageManager.saveRecords([{ key: key(1), record: record(55) }], true, { source: 'history' }), 0);
    await w.StorageManager.saveRecords([{ key: key(1), record: { ...record(56), currentTime: '' } }], true, { source: 'history' });
    assert.equal(w.StorageManager.getRecord(key(1)).currentTime, '05:00');
});
test('删除标记阻止旧备份，撤销跳过新观看', async () => {
    const w = await fresh(); await w.StorageManager.saveRecord(key(1), record());
    const deleted = await w.StorageManager.deleteRecords([key(1)], true, { details: true });
    w.StorageManager.writeBackup({ key: key(1), value: record(20, epoch - 10000), version: [epoch - 10000, '', 0] });
    await w.StorageManager.restoreFromLocalStorage(); assert.equal(w.StorageManager.getRecord(key(1)), null);
    await w.StorageManager.saveRecord(key(1), record(10)); assert.equal(await w.StorageManager.undoDelete(deleted), 0);
    assert.equal(w.StorageManager.getRecord(key(1)).percent, '10%');
    const next = await w.StorageManager.deleteRecords([key(1)], true, { details: true });
    assert.equal(await w.StorageManager.undoDelete(next), 1);
});
test('恢复失败保留备份，过期备份不导入', async () => {
    const w = await fresh(); w.StorageManager.writeBackup({ key: key(1), value: record(), version: [epoch, 'old', 1] });
    w.shared.before = ({ name, args }) => { if (name === 'setValue' && args[0].startsWith('bvh_tx_')) throw new Error('写入失败'); };
    await w.StorageManager.restoreFromLocalStorage(); assert.equal(w.context.localStorage.length, 1);
    w.shared.before = null; await w.StorageManager.restoreFromLocalStorage(); assert.equal(w.context.localStorage.length, 0);
    w.context.localStorage.setItem('BvH_backup_' + key(2), JSON.stringify({ key: key(2), value: record(20, epoch - 8 * 86400000), savedAt: epoch - 8 * 86400000 }));
    await w.StorageManager.restoreFromLocalStorage(); assert.equal(w.StorageManager.getRecord(key(2)), null);
});
test('未提交暂存块保留，离线清理显式要求停止写入', async () => {
    const w = await fresh(), store = w.StorageManager._store, tx = await store.prepare([entry(w, 1)]);
    tx.blocks[0].value.createdAt -= 2 * 86400000;
    tx.manifest.blocks[0].checksum = w.HistoryCommitStore.checksum(tx.blocks[0].value);
    w.shared.data.set(tx.blocks[0].key, structuredClone(tx.blocks[0].value));
    await assert.rejects(store.cleanupStaging(), /停止/);
    assert.equal((await store.stagingInfo()).count, 1);
    await store.cleanupStaging({ writersStopped: true }); assert.equal((await store.stagingInfo()).count, 0);
    await store.publish(tx); assert.equal((await fresh(w.shared)).StorageManager.getAllKeys().length, 1);
});
test('并发整理保留跨分片提交和删除，停写回退快照正确', async () => {
    const shared = sharedStorage(), a = await fresh(shared);
    for (let i = 1; i <= 12; i++) await a.StorageManager.saveRecord(key(i), record(i));
    await a.StorageManager.deleteRecord(key(1));
    const b = await fresh(shared), before = a.StorageManager._store.commits.size;
    await Promise.all([a.StorageManager._store.compact(), b.StorageManager._store.compact(), a.StorageManager.saveRecord(key(20), record(20))]);
    const c = await fresh(shared); assert.equal(c.StorageManager.getAllKeys().length, 12); assert.equal(c.StorageManager.getRecord(key(1)), null);
    assert.equal(await c.StorageManager.createLegacySnapshot({ writersStopped: true }), 12);
    const snapshot = [...shared.data].filter(([k]) => k.startsWith('bvh_shard_')).flatMap(([, v]) => Object.keys(v));
    assert.equal(snapshot.includes(key(1)), false); assert.equal(snapshot.length, 12);
    console.log('整理数量', before, '→', c.StorageManager._store.commits.size);
});
test('订阅去抖范围合并、取消订阅及远程负缓存失效', async () => {
    const w = await fresh(); w.flushTimers(); const events = [], unsubscribe = w.StorageManager.onDataChange(e => events.push(e));
    w.StorageManager._notifyChange({ changedKeys: [key(1)] }); w.StorageManager._notifyChange({ changedKeys: [key(2)] });
    w.flushTimers(); assert.equal(events[0].changedKeys.size, 2);
    unsubscribe(); w.StorageManager._notifyChange({ settingsChanged: true }); w.flushTimers(); assert.equal(events.length, 1);
    assert.equal(w.StorageManager.getRelatedKeys(key(8)).length, 0);
    const b = await fresh(w.shared); await b.StorageManager.saveRecord(key(8), record()); await w.StorageManager._syncIfStale();
    assert.equal(w.StorageManager.getRelatedKeys(key(8)).length, 1);
});
test('历史候选准备期间其他页面更新，提交前重新判断阈值', async () => {
    const shared = sharedStorage(), a = await fresh(shared), b = await fresh(shared);
    await a.StorageManager.saveRecord(key(1), record(50));
    let resume, reached;
    const paused = new Promise(resolve => { resume = resolve; });
    const ready = new Promise(resolve => { reached = resolve; });
    shared.before = async ({ name, args }) => {
        if (name === 'setValue' && args[0].startsWith('bvh_tx_') && args[1].entries[0]?.source === 'history') { reached(); await paused; }
    };
    const pending = a.StorageManager.saveRecords([{ key: key(1), record: record(70) }], true, { source: 'history' });
    await ready; await b.StorageManager._syncIfStale(); await b.StorageManager.saveRecord(key(1), record(80));
    assert.equal(b.StorageManager.getRecord(key(1)).percent, '80%'); resume();
    assert.equal(await pending, 0); assert.equal((await fresh(shared)).StorageManager.getRecord(key(1)).percent, '80%');
});
test('整理任意写入/删除阶段失败只保留冗余，不损伤已提交记录', async () => {
    const prepare = async () => {
        const w = await fresh();
        for (let i = 1; i <= 4; i++) await w.StorageManager.saveRecord(key(i), record(i * 10));
        await w.StorageManager.deleteRecord(key(1));
        return w;
    };
    const complete = await prepare(); let mutations = 0;
    complete.shared.before = ({ name }) => { if (['setValue', 'deleteValue'].includes(name)) mutations++; };
    await complete.StorageManager._store.compact(); complete.shared.before = null;
    for (let failAt = 1; failAt <= mutations; failAt++) {
        const w = await prepare();
        let mutation = 0;
        w.shared.before = ({ name }) => { if (['setValue', 'deleteValue'].includes(name) && ++mutation === failAt) throw new Error('整理中断'); };
        try { await w.StorageManager._store.compact(); } catch {}
        w.shared.before = null;
        const reader = await fresh(w.shared); assert.equal(reader.StorageManager.getAllKeys().length, 3); assert.equal(reader.StorageManager.getRecord(key(1)), null);
        for (let i = 2; i <= 4; i++) assert.equal(reader.StorageManager.getRecord(key(i)).percent, `${i * 10}%`);
    }
    console.log(`整理故障注入覆盖 ${mutations} 个实际写入/删除阶段`);
});
test('重复升级保留 v1/v2/v3 与未知保存时间', async () => {
    const w = instance();
    for (const [k, v] of Object.entries(legacy())) w.shared.data.set(k, structuredClone(v));
    w.shared.data.set(key(8), { status: '已观看', percent: '50%', title: '没有时间的旧记录' });
    await w.StorageManager.initialize(); assert.equal(w.StorageManager.getAllKeys().length, 4);
    assert.equal(w.StorageManager.getRecord(key(8)).savedAt, '');
    const next = await fresh(w.shared); await next.StorageManager.initialize(); assert.equal(next.StorageManager.getAllKeys().length, 4);
    assert.equal([...w.shared.data.keys()].filter(k => k.startsWith('bvh_commit_')).length, 0);
});
let failed = 0;
for (const [name, run] of tests) { try { await run(); console.log('通过：' + name); } catch (e) { failed++; console.error(name, e); } }
console.log(`${tests.length - failed}/${tests.length} 协议测试通过`); process.exitCode = failed ? 1 : 0;
