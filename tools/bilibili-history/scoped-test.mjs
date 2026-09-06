import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, epoch } from './fixtures.mjs';

const shared = sharedStorage(), seed = instance(shared);
const target = key(1), parts = [target, target + '?p=2', target + '?p=3'];
const put = async (rows, version) => {
    const entries = rows.map(([id, value]) => ({ key: id, record: seed.StorageManager._compact(value), version: [version, 'seed', 1], deleted: false, source: 'playback' }));
    const tx = await seed.StorageManager._store.prepare(entries);
    for (const block of tx.blocks) shared.data.set(block.key, block.value);
    shared.data.set(tx.key, tx.manifest); return tx;
};
const related = await put(parts.map(id => [id, record(60)]), epoch);
const unrelated = [];
for (let i = 2; i <= 2001; i++) unrelated.push(await put([[key(i), record(40)]], epoch));
await seed.StorageManager.initialize();
const originalIndex = structuredClone(shared.data.get(seed.StorageManager._BASE_INDEX_KEY));
shared.calls.length = 0;
const reader = instance(shared, 'space');
await reader.StorageManager.initializeForKeys([target]);
assert.equal(reader.StorageManager._ready, null);
assert.deepEqual([...reader.StorageManager.getRelatedKeys(target)], parts);
assert.equal(reader.StorageManager.getAllKeys().length, 3);
const unrelatedBlocks = new Set(unrelated.flatMap(tx => tx.blocks.map(block => block.key)));
assert(!shared.calls.some(call => call.type === 'get' && unrelatedBlocks.has(call.key)), '读取了无关视频的数据块');
const initialCalls = shared.calls.length;
assert(initialCalls < 15, `当前视频查询读取过多：${initialCalls}`);
console.log(`通过：2003 条记录、2001 个事务，当前视频及三个分 P 仅 ${initialCalls} 次存储调用，无关块零读取`);
await reader.StorageManager.saveRecord(target, record(20));
assert(reader.StorageManager._store.scope, '播放写入意外触发全量初始化');
assert.equal(reader.StorageManager.getRecord(target).percent, '20%');
assert.deepEqual(shared.data.get(seed.StorageManager._BASE_INDEX_KEY), originalIndex, '局部结果覆盖完整索引');
console.log('通过：定向播放写入、重看低进度与完整索引隔离');

// 同一事务中不相关分片缺失，相关部分也不能出现。
const brokenShared = sharedStorage();
for (const [k, v] of shared.data) brokenShared.data.set(k, structuredClone(v));
brokenShared.data.delete(related.blocks.at(-1).key);
const broken = instance(brokenShared);
await broken.StorageManager.initializeForKeys([target + '?p=2']);
assert.equal(broken.StorageManager.getRecord(target + '?p=2'), null);
console.log('通过：相关事务缺任何数据块时均不暴露半提交结果');

await seed.StorageManager.deleteRecords([target + '?p=2']);
await reader.StorageManager._syncIfStale();
assert.equal(reader.StorageManager.getRecord(target + '?p=2'), null);
await reader.StorageManager.saveRecord(target + '?p=2', record(10), true, { source: 'backup', version: [epoch - 1, 'old', 1] });
assert.equal(reader.StorageManager.getRecord(target + '?p=2'), null);
console.log('通过：远程删除定向同步，旧备份不能复活记录');

await reader.StorageManager.initialize();
assert.equal(reader.StorageManager._store.scope, null);
assert.equal(reader.StorageManager.getAllKeys().length, 2002);
assert.equal((await reader.HistoryQueries.query()).length, 2002);
console.log('通过：打开全量查询后完整加载，局部缓存不冒充全部历史');

// 兼容升级前不带 bases / routes 的清单与索引。
const legacy = sharedStorage();
for (const [k, v] of shared.data) legacy.data.set(k, structuredClone(v));
for (const [k, v] of legacy.data) if (k.startsWith('bvh_commit_')) delete v.bases;
delete legacy.data.get(seed.StorageManager._BASE_INDEX_KEY).routes;
const upgraded = instance(legacy);
await upgraded.StorageManager.initializeForKeys([target]);
assert.equal(upgraded.StorageManager.getRecord(target).percent, '20%');
assert.equal(upgraded.StorageManager.getRecord(target + '?p=2'), null);
assert.equal(upgraded.StorageManager.getRecord(target + '?p=3').percent, '60%');
console.log('通过：旧格式提交清单、删除结果及多 P 兼容读取');

await reader.StorageManager._store.compact();
await reader.StorageManager._syncIfStale();
await reader.StorageManager._persistBaseIndex();
const fresh = instance(shared, 'search'); shared.calls.length = 0;
await fresh.StorageManager.initializeForKeys([target]);
assert.equal(fresh.StorageManager.getRecord(target).percent, '20%');
assert.equal(fresh.StorageManager.getRecord(target + '?p=2'), null);
const touched = shared.calls.filter(call => call.type === 'get' && call.key?.startsWith('bvh_checkpoint_')).length;
const totalBlocks = [...shared.data.keys()].filter(key => key.startsWith('bvh_checkpoint_')).length;
assert(touched < totalBlocks / 2, '整理后定向读取退化为全量检查点读取');
console.log(`通过：分组整理后仅读取 ${touched}/${totalBlocks} 个检查点块，删除标记仍保留`);
