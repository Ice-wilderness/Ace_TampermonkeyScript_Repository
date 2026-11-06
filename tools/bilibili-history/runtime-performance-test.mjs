import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record } from './fixtures.mjs';

const shared = sharedStorage(), writer = instance(shared, 'writer');
const entries = (keys, percent) => keys.map(key => ({ key, record: writer.StorageManager._compact(record(percent)),
    version: writer.StorageManager.sampleVersion(), deleted: false, source: 'playback' }));
const original = await writer.StorageManager._store.prepare(entries(Array.from({ length: 512 }, (_, i) => key(i + 1)), 40));
const updates = [];
for (const percent of [50, 60, 70, 80]) updates.push(await writer.StorageManager._store.prepare(entries([key(1)], percent)));
const put = transaction => {
    for (const block of transaction.blocks) shared.data.set(block.key, structuredClone(block.value));
    shared.data.set(transaction.key, structuredClone(transaction.manifest));
};
put(original);
let lists = 0, appended = 0;
shared.before = ({ owner, name }) => {
    if (owner === 'reader' && name === 'listValues' && ++lists % 2 === 0 && appended < updates.length) put(updates[appended++]);
};
const reader = instance(shared, 'reader');
await reader.StorageManager._store.sync();
assert.equal(appended, 4);
assert.equal(reader.StorageManager._store.entries.size, 512);
assert.equal(reader.StorageManager._store.entries.get(key(1)).record.p, 80);
for (const block of original.blocks) {
    const reads = shared.calls.filter(call => call.owner === 'reader' && call.type === 'get' && call.key === block.key).length;
    assert.equal(reads, 1, '并发追加提交导致整个大历史反复回读、校验并保留多份副本');
}
console.log(`通过：同步期间连续追加 4 次进度，${original.blocks.length} 个历史块各读取一次，最终保留最新版本`);

// 稳定检查前被回收的提交，即使此前已验证，也不能继续出现在最终视图。
const gone = sharedStorage(), seed = instance(gone, 'seed');
const transaction = await seed.StorageManager._store.prepare([{ key: key(1), record: seed.StorageManager._compact(record(50)),
    version: seed.StorageManager.sampleVersion(), deleted: false }]);
for (const block of transaction.blocks) gone.data.set(block.key, block.value);
gone.data.set(transaction.key, transaction.manifest);
let scans = 0;
gone.before = ({ name }) => {
    if (name === 'listValues' && ++scans === 2) {
        gone.data.delete(transaction.key);
        for (const block of transaction.blocks) gone.data.delete(block.key);
    }
};
const fresh = instance(gone);
await fresh.StorageManager._store.sync();
assert.equal(fresh.StorageManager._store.entries.size, 0);
console.log('通过：重试复用已校验块仍排除并发回收的提交');

const page = instance();
await page.StorageManager.saveRecord(key(1), record(30));
await page.StorageManager._maintainHistory();
for (const percent of [40, 45, 50, 55, 60]) {
    await page.StorageManager.saveRecord(key(1), record(percent));
    page.shared.calls.length = 0;
    await page.StorageManager._maintainHistory();
    assert(!page.shared.calls.some(call => call.type === 'get' && /^bvh_(commit|tx|checkpoint)_/.test(call.key)),
        '后台检查重复回读已缓存的历史清单或数据块');
}
console.log('通过：连续播放保存后的后台检查复用清单缓存，不随待整理事务数量增加 GM 读取');
