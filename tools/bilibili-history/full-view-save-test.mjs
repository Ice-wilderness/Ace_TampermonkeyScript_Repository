import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { records, key, record } from './fixtures.mjs';

const shared = sharedStorage(), page = instance(shared, 'page'), s = page.StorageManager;
for (const [id, value] of Object.entries(records(10000))) {
    const shard = 'bvh_shard_' + s._getShardId(id), data = shared.data.get(shard) || {};
    data[id] = s._compact(value); shared.data.set(shard, data);
}
await s.initializeForKeys([key(1)]);
await s.initialize(); // 历史管理的完整初始化；关闭面板不改变存储模式。
const cache = s.getAllKeys(), index = structuredClone(shared.data.get(s._BASE_INDEX_KEY));
assert.equal(cache.length, 10000);
const oldBlocks = new Set([...shared.data.keys()].filter(k => k.startsWith('bvh_shard_')));
shared.calls.length = 0;
for (const percent of [70, 15, 25]) await s.saveRecord(key(1), record(percent));
assert.equal(s.getAllKeys(), cache, '仅更新进度却重建全部 key 列表');
assert.equal(s.getRecord(key(1)).percent, '25%');
assert(!shared.calls.some(c => c.type === 'set' && c.key === s._BASE_INDEX_KEY), '全量模式的播放保存重写索引');
assert(!shared.calls.some(c => c.type === 'get' && oldBlocks.has(c.key)), '播放保存重读旧历史分片');
for (const c of shared.calls.filter(c => c.type === 'set' && c.key.startsWith('bvh_tx_'))) {
    const entries = shared.data.get(c.key).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, key(1));
}
assert.deepEqual(shared.data.get(s._BASE_INDEX_KEY), index);
console.log('通过：万条历史全量初始化后连续保存进度，零全量索引写入、零旧分片读取，复用 key 列表');

await s.saveRecord(key(1) + '?p=2', record(30));
assert.equal(s.getAllKeys().length, 10001);
const fresh = instance(shared, 'fresh');
await fresh.StorageManager.initializeForKeys([key(1)]);
assert.equal(fresh.StorageManager.getRecord(key(1)).percent, '25%');
assert.equal(fresh.StorageManager.getRecord(key(1) + '?p=2').percent, '30%');
assert.deepEqual(shared.data.get(s._BASE_INDEX_KEY), index);
console.log('通过：未重写索引仍可跨页读取最新进度和新增分 P');

await s.deleteRecords([key(1) + '?p=2']);
assert.equal(s.getAllKeys().length, 10000);
await fresh.StorageManager._syncIfStale();
assert.equal(fresh.StorageManager.getRecord(key(1) + '?p=2'), null);
console.log('通过：删除后缓存与跨页关联结果仍正确');
