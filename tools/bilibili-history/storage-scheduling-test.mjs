import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, records, epoch } from './fixtures.mjs';

const tests = [], test = (name, run) => tests.push({ name, run });
const until = async check => {
    const start = performance.now();
    while (!check()) { assert(performance.now() - start < 5000, '等待测试事件超时'); await new Promise(resolve => setTimeout(resolve, 2)); }
};
async function seed(count = 1024, batch = true) {
    const shared = sharedStorage({ batch }), page = instance(shared, 'page');
    const entries = Array.from({ length: count }, (_, i) => ({ key: key(i + 1), version: [epoch, 'seed', i + 1],
        deleted: false, record: page.StorageManager._compact(record(40)) }));
    const tx = await page.StorageManager._store.prepare(entries);
    for (const block of tx.blocks) shared.data.set(block.key, block.value);
    shared.data.set(tx.key, tx.manifest);
    await page.StorageManager.initializeForKeys([key(1)]);
    return { shared, page, tx };
}
async function audit(shared, expected) {
    const fresh = instance(shared, 'audit'); await fresh.StorageManager.initialize();
    assert.equal(fresh.StorageManager.getAllKeys().length, expected); return fresh;
}

test('五万条导入批量读写，模拟每次写入复制整份存储的成本，旧 API 仍可回退', async () => {
    const input = records(50000), reports = [];
    for (const batch of [false, true]) {
        const shared = sharedStorage({ batch }), page = instance(shared); let writes = 0, bytes = 0;
        for (const name of ['setValue', 'setValues']) if (page.context.GM[name]) {
            const original = page.context.GM[name];
            page.context.GM[name] = async (...args) => {
                const result = await original(...args); writes++;
                bytes += Buffer.byteLength(JSON.stringify(Object.fromEntries(shared.data))); return result;
            };
        }
        const result = await page.StorageManager.importRecords(input);
        assert.equal(result.count, 50000); assert.equal(page.StorageManager.getAllKeys().length, 50000);
        assert.equal((await audit(shared, 50000)).StorageManager.getRecord(key(49999)).title, input[key(49999)].title);
        reports.push({ batch, writes, serializedMiB: +(bytes / 1048576).toFixed(1) });
    }
    assert(reports[1].writes < reports[0].writes / 2);
    assert(reports[1].serializedMiB < reports[0].serializedMiB / 2);
    console.log('整份存储复制成本对照', reports);
});

test('批量写入部分数据块失败不发布清单，同事务重试可完成', async () => {
    const shared = sharedStorage({ batch: true }), page = instance(shared);
    const entries = Array.from({ length: 512 }, (_, i) => ({ key: key(i + 1), version: [epoch, 'seed', i + 1], deleted: false,
        record: page.StorageManager._compact(record(40)) }));
    const tx = await page.StorageManager._store.prepare(entries), original = page.context.GM.setValues;
    let failed = false;
    page.context.GM.setValues = async values => {
        if (!failed && Object.keys(values).some(key => key.startsWith('bvh_tx_'))) {
            failed = true; await original(Object.fromEntries(Object.entries(values).slice(0, 1))); throw new Error('合成部分写入');
        }
        return original(values);
    };
    await assert.rejects(page.StorageManager._store.publish(tx), /合成部分写入/);
    assert(!shared.data.has(tx.key)); await audit(shared, 0);
    page.context.GM.setValues = original; await page.StorageManager._store.publish(tx); await audit(shared, 512);
});

test('批量 API 重排嵌套对象字段仍可校验，并拒绝回读损坏的批次', async () => {
    const shared = sharedStorage({ batch: true }), page = instance(shared), original = page.context.GM.setValues;
    const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    page.context.GM.setValues = values => original(reorder(values));
    await page.StorageManager.importRecords(records(256)); await audit(shared, 256);
    let corrupt = true;
    page.context.GM.setValues = async values => {
        await original(reorder(values));
        if (corrupt) for (const key of Object.keys(values)) if (key.startsWith('bvh_tx_')) {
            shared.data.get(key).entries[0].record.n = '合成内容损坏'; corrupt = false; break;
        }
    };
    await assert.rejects(page.StorageManager.importRecords(Object.fromEntries([257, 258, 259].map(i => [key(i), record()]))), /历史数据块写入未确认/);
    await audit(shared, 256);
});

test('清单与提示合并写入时，提示失败不把完整提交误报失败', async () => {
    const shared = sharedStorage({ batch: true }), page = instance(shared), original = page.context.GM.setValues;
    page.context.GM.setValues = async values => {
        if ('bvh_change_signal' in values) {
            await original(Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'bvh_change_signal')));
            throw new Error('合成提示失败');
        }
        return original(values);
    };
    assert.equal(await page.StorageManager.saveRecord(key(1), record(75)), 1);
    assert.equal((await audit(shared, 1)).StorageManager.getRecord(key(1)).percent, '75%');
});

test('后台检查点和回收使用批量 API，条数及正文缓冲预算仍有界', async () => {
    const { shared, page } = await seed(4096);
    shared.calls.length = 0; await page.StorageManager._maintainHistory();
    const stats = page.StorageManager._maintenanceStats;
    assert.equal(stats.phase, '完成'); assert(stats.publishRounds < stats.publishedBatches / 2);
    assert(stats.maxBufferedEntries <= page.HistoryMaintenance.bufferEntries);
    assert(stats.maxBufferedBytes <= page.HistoryMaintenance.bufferBytes);
    assert(shared.calls.some(call => call.type === 'setMany' && call.keys.every(key => key.startsWith('bvh_checkpoint_'))));
    assert(shared.calls.some(call => call.type === 'deleteMany'));
    await audit(shared, 4096);
});

test('批量发布部分检查点清单失败，原始事务仍完整且后续可恢复', async () => {
    const { shared, page, tx } = await seed();
    const original = page.context.GM.setValues; let failed = false;
    page.context.GM.setValues = async values => {
        if (!failed && Object.keys(values).length > 1 && Object.keys(values).every(key => key.startsWith('bvh_commit_'))) {
            failed = true; await original(Object.fromEntries(Object.entries(values).slice(0, 1))); throw new Error('合成检查点中断');
        }
        return original(values);
    };
    await assert.rejects(page.StorageManager._maintainHistory(), /合成检查点中断/);
    assert(shared.data.has(tx.key)); await audit(shared, 1024);
    page.context.GM.setValues = original; await page.StorageManager._maintainHistory(); await audit(shared, 1024);
});

test('批量回收部分清单失败，不损伤记录，重试后可完成', async () => {
    const shared = sharedStorage({ batch: true }), page = instance(shared);
    for (let i = 1; i <= 32; i++) await page.StorageManager.saveRecord(key(i), record(40));
    const original = page.context.GM.deleteValues; let failed = false;
    page.context.GM.deleteValues = async keys => {
        if (!failed && keys.every(key => key.startsWith('bvh_commit_'))) {
            failed = true; await original(keys.slice(0, 1)); throw new Error('合成回收中断');
        }
        return original(keys);
    };
    // 未到数量阈值时用旧标记缺失触发初次整理。
    await assert.rejects(page.StorageManager._maintainHistory(), /合成回收中断/); await audit(shared, 32);
    page.context.GM.deleteValues = original; await page.StorageManager._maintainHistory(); await audit(shared, 32);
});

test('播放期间后台不做存储操作，前台保存完成后暂停播放可恢复整理', async () => {
    const { shared, page } = await seed(); shared.calls.length = 0;
    page.HistoryWorkPriority.playing('synthetic-player', true);
    const background = page.StorageManager._maintainHistory();
    await until(() => page.StorageManager._maintenanceStats.waitingForForeground);
    assert.equal(shared.calls.length, 0);
    await page.StorageManager.saveRecord(key(1), record(85));
    assert.equal(page.StorageManager.getRecord(key(1)).percent, '85%');
    assert(page.StorageManager._maintenanceStats.waitingForForeground);
    page.HistoryWorkPriority.playing('synthetic-player', false); await background;
    assert.equal(page.StorageManager._maintenanceStats.phase, '完成');
    assert.equal((await audit(shared, 1024)).StorageManager.getRecord(key(1)).percent, '85%');
});

test('已在途的后台写入结束后让路，不再继续发布清单抢占播放保存', async () => {
    const { shared, page } = await seed(); let release, reached, blocked = false;
    const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { reached = resolve; });
    shared.before = async ({ name, args }) => {
        if (!blocked && name === 'setValues' && Object.keys(args[0]).some(key => key.startsWith('bvh_checkpoint_'))) {
            blocked = true; reached(); await gate;
        }
    };
    const background = page.StorageManager._maintainHistory(); await ready;
    page.HistoryWorkPriority.playing('synthetic-player', true); await page.StorageManager.saveRecord(key(1), record(90));
    release(); await until(() => page.StorageManager._maintenanceStats.waitingForForeground);
    assert.equal([...shared.data.values()].filter(value => value?.kind === 'checkpoint').length, 0);
    page.HistoryWorkPriority.playing('synthetic-player', false); await background;
    assert.equal((await audit(shared, 1024)).StorageManager.getRecord(key(1)).percent, '90%');
});

test('同源其他页面播放时后台暂停，播放停止后通过消息立即恢复', async () => {
    const channels = new Set();
    class Channel {
        constructor(name) { this.name = name; channels.add(this); }
        postMessage(data) { for (const peer of channels) if (peer !== this && peer.name === this.name)
            queueMicrotask(() => { if (channels.has(peer)) peer.onmessage?.({ data: structuredClone(data) }); }); }
        close() { channels.delete(this); }
    }
    const { shared, page } = await seed(), player = instance(shared, 'player');
    page.context.BroadcastChannel = Channel; player.context.BroadcastChannel = Channel;
    player.HistoryWorkPriority.playing('synthetic-player', true);
    const background = page.StorageManager._maintainHistory();
    await until(() => page.StorageManager._maintenanceStats.waitingForForeground);
    assert.equal(page.StorageManager._maintenanceStats.publishedBatches, 0);
    player.HistoryWorkPriority.playing('synthetic-player', false); await background; await audit(shared, 1024);
    player.StorageManager.dispose(); page.StorageManager.dispose(); assert.equal(channels.size, 0);
});

test('长时间前台写入续租只发内存消息，通道不可用时仍有本页优先保护', async () => {
    const page = instance(), messages = [];
    const callsBefore = page.shared.calls.length;
    page.context.BroadcastChannel = class {
        postMessage(message) { messages.push(message); }
        close() { }
    };
    let release;
    const operation = page.StorageManager._enqueue(() => new Promise(resolve => { release = resolve; }));
    await until(() => !!release);
    const timer = page.HistoryWorkPriority.leaseTimer;
    assert(timer); page.HistoryWorkPriority.lastSent = -Infinity;
    page.timers.get(timer)();
    assert.equal(messages.filter(message => message.kind === 'status' && message.busy).length, 2);
    assert.equal(page.shared.calls.length, callsBefore, '续租访问了 GM 存储');
    release(); await operation; assert.equal(page.HistoryWorkPriority.leaseTimer, null);
    page.StorageManager.dispose();
    const fallback = instance();
    fallback.context.BroadcastChannel = class { constructor() { throw new Error('合成不支持通道'); } };
    fallback.HistoryWorkPriority.playing('fallback-player', true);
    assert(fallback.HistoryWorkPriority.unavailable); assert(fallback.HistoryWorkPriority.busy());
    fallback.HistoryWorkPriority.playing('fallback-player', false); assert(!fallback.HistoryWorkPriority.busy());
});

let failed = 0;
for (const { name, run } of tests) {
    try { await run(); console.log(`通过：${name}`); }
    catch (error) { failed++; console.error(`失败：${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} 存储批处理与前台优先测试通过`);
process.exitCode = failed ? 1 : 0;
