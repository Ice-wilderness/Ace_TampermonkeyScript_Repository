import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, epoch } from './fixtures.mjs';

async function legacy() {
    const shared = sharedStorage(), seed = instance(shared, 'seed');
    const entries = Array.from({ length: 256 }, (_, i) => ({ key: key(i + 1),
        record: seed.StorageManager._compact(record(40)), version: [epoch, 'seed', 1], deleted: false }));
    const tx = await seed.StorageManager._store.prepare(entries, 'checkpoint');
    delete tx.manifest.bases;
    for (const block of tx.blocks) shared.data.set(block.key, block.value);
    shared.data.set(tx.key, tx.manifest);
    return { shared, tx };
}
const { shared, tx } = await legacy();
const page = instance(shared, 'page');
await page.StorageManager.initializeForKeys([key(1)]);
assert(page.StorageManager._compactionTimer, '普通视频访问没有安排后台整理');
page.flushTimers();
await page.StorageManager._maintenance;
assert.equal(page.StorageManager._ready, null);
assert(page.StorageManager._store.scope);
assert(shared.data.has('bvh_grouping_complete_v1'));
assert(!shared.data.has(tx.key));
const fresh = instance(shared, 'fresh');
shared.calls.length = 0;
await fresh.StorageManager.initializeForKeys([key(1)]);
const reads = shared.calls.filter(c => c.type === 'get' && c.key.startsWith('bvh_checkpoint_')).length;
assert(reads < tx.blocks.length / 2);
shared.calls.length = 0;
fresh.flushTimers(); await fresh.StorageManager._maintenance;
assert(!shared.calls.some(c => c.type === 'get' && c.key.startsWith('bvh_checkpoint_')));
assert(!shared.calls.some(c => c.type === 'set'));
console.log(`通过：不打开管理面板自动整理；新页面读取 ${reads}/${tx.blocks.length} 块；已完成时后台不读数据块、不重写`);
const importer = instance(shared, 'importer');
await importer.StorageManager.saveRecords([257, 258, 259].map(i => ({ key: key(i), record: record(30) })));
const imported = [...shared.data.keys()].filter(k => k.startsWith('bvh_commit_') && !shared.data.get('bvh_grouping_complete_v1').coverage.includes(k));
await fresh.StorageManager._maintainHistory();
assert(imported.every(k => !shared.data.has(k)), '整理完成后新增的大型事务未再被整理');
console.log('通过：完成标记不会漏掉后来导入的跨组事务');

const interrupted = await legacy(), first = instance(interrupted.shared, 'first');
await first.StorageManager.initializeForKeys([key(1)]);
let published = 0;
interrupted.shared.before = ({ owner, name, args }) => {
    if (owner === 'first' && name === 'setValue' && args[0].startsWith('bvh_commit_') && ++published === 4) throw new Error('模拟关闭');
};
await assert.rejects(first.StorageManager._maintainHistory(), /模拟关闭/);
const completed = [...interrupted.shared.data.keys()].filter(k => k.startsWith('bvh_commit_') && k !== interrupted.tx.key);
assert.equal(completed.length, 3);
assert(!interrupted.shared.data.has('bvh_grouping_complete_v1'));
interrupted.shared.before = null;
const second = instance(interrupted.shared, 'second');
await second.StorageManager.initializeForKeys([key(1)]);
await second.StorageManager._maintainHistory();
for (const k of completed) assert(interrupted.shared.data.has(k), '中断后未复用已完成组');
const verify = instance(interrupted.shared, 'verify');
await verify.StorageManager.initialize();
assert.equal(verify.StorageManager.getAllKeys().length, 256);
console.log('通过：第四组写入中断后，下个页面复用前三组并保留全部历史');

const concurrent = await legacy(), a = instance(concurrent.shared, 'a'), b = instance(concurrent.shared, 'b');
await Promise.all([a.StorageManager.initializeForKeys([key(1)]), b.StorageManager.initializeForKeys([key(2)])]);
let release, reached;
const gate = new Promise(resolve => { release = resolve; });
const started = new Promise(resolve => { reached = resolve; });
let blocked = false;
concurrent.shared.before = async ({ owner, name, args }) => {
    if (!blocked && owner === 'a' && name === 'setValue' && args[0].startsWith('bvh_checkpoint_')) {
        blocked = true; reached(); await gate;
    }
};
const background = a.StorageManager._maintainHistory();
await started;
await a.StorageManager.saveRecord(key(1), record(75));
assert.equal(a.StorageManager.getRecord(key(1)).percent, '75%');
await b.StorageManager.deleteRecords([key(2)]);
release();
await Promise.all([background, b.StorageManager._maintainHistory()]);
concurrent.shared.before = null;
const final = instance(concurrent.shared, 'final');
await final.StorageManager.initialize();
assert.equal(final.StorageManager.getAllKeys().length, 255);
assert.equal(final.StorageManager.getRecord(key(1)).percent, '75%');
assert.equal(final.StorageManager.getRecord(key(2)), null);
console.log('通过：后台存储等待不阻塞前台写入；两个页面并发整理保留最新进度及删除状态');
