import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, legacy, epoch } from './fixtures.mjs';

const tests = [];
const test = (name, run) => tests.push({ name, run });
async function seeded(count = 1024, options = {}) {
    const shared = sharedStorage(), seed = instance(shared, 'seed');
    const entries = Array.from({ length: count }, (_, i) => ({ key: options.pages ? key(i % 256 + 1, Math.floor(i / 256) + 1) : key(i + 1), version: [epoch, 'seed', i + 1], deleted: false,
        record: seed.StorageManager._compact(record(40, epoch, options.title ?? '合成标题'.repeat(options.long ? 160 : 1))) }));
    const tx = await seed.StorageManager._store.prepare(entries);
    if (options.legacy) delete tx.manifest.bases;
    for (const block of tx.blocks) shared.data.set(block.key, block.value);
    shared.data.set(tx.key, tx.manifest);
    const page = instance(shared, 'page'); await page.StorageManager.initializeForKeys([key(1)]);
    return { shared, page, tx };
}
async function full(shared) { const w = instance(shared, 'fresh'); await w.StorageManager.initialize(); return w; }

test('大历史流式整理，正文缓冲和输出块均受限，前台保持局部视图', async () => {
    const { shared, page, tx } = await seeded(10000, { long: true });
    await page.StorageManager._maintainHistory();
    const stats = page.StorageManager._maintenanceStats;
    assert.equal(stats.phase, '完成'); assert.equal(stats.rewrittenEntries, 10000);
    assert(stats.maxBufferedEntries <= page.HistoryMaintenance.bufferEntries);
    assert(stats.maxBufferedBytes <= page.HistoryMaintenance.bufferBytes);
    assert.equal(page.StorageManager._ready, null);
    assert.equal(page.StorageManager.getAllKeys().length, 1);
    assert(!shared.data.has(tx.key));
    for (const [name, block] of shared.data) if (name.startsWith('bvh_checkpoint_')) {
        assert(block.entries.length <= page.HistoryMaintenance.maxEntries);
        assert(new TextEncoder().encode(JSON.stringify(block)).length <= page.HistoryMaintenance.maxBytes);
    }
    const fresh = await full(shared);
    assert.equal(fresh.StorageManager.getAllKeys().length, 10000);
    assert.equal(fresh.StorageManager.getRecord(key(10000)).percent, '40%');
    console.log('大数据缓冲统计', stats);
});

test('已完成整理后仅修改一个分组，不读取或重写其他分组正文', async () => {
    const { shared, page } = await seeded(4096);
    await page.StorageManager._maintainHistory();
    const group = page.StorageManager._getShardId(key(1)), unrelated = new Set();
    for (const [name, manifest] of shared.data) if (name.startsWith('bvh_commit_') && manifest.bases.every(base => page.StorageManager._getShardId(base) !== group))
        for (const ref of manifest.blocks) unrelated.add(ref.key);
    for (let i = 0; i < 128; i++) await page.StorageManager.saveRecord(key(1), record(60));
    shared.calls.length = 0;
    await page.StorageManager._maintainHistory();
    assert(!shared.calls.some(call => call.type === 'get' && unrelated.has(call.key)), '读取了未受影响分组');
    const stats = page.StorageManager._maintenanceStats;
    assert.equal(stats.groupsTotal, 1); assert.equal(stats.rewrittenEntries, 1);
    assert(stats.scannedEntries < 512);
    assert.equal((await full(shared)).StorageManager.getRecord(key(1)).percent, '60%');
});

test('跨分 P 的旧事务每个来源块仅扫描、回读各一次，分组布局仍可兼容读取', async () => {
    const { shared, page, tx } = await seeded(2048, { pages: true });
    shared.calls.length = 0;
    await page.StorageManager._maintainHistory();
    assert.equal(page.StorageManager._maintenanceStats.sourceBlockReads, tx.blocks.length * 2);
    const fresh = await full(shared);
    assert.equal(fresh.StorageManager.getAllKeys().length, 2048);
    assert.equal(fresh.StorageManager.getRelatedKeys(key(1)).length, 8);
    for (const [key, value] of shared.data) if (key.startsWith('bvh_commit_')) delete value.bases;
    const compatible = instance(shared, 'compatible');
    await compatible.StorageManager.initializeForKeys([key(1, 2)]);
    assert.equal(compatible.StorageManager.getRelatedKeys(key(1)).length, 8);
});

test('旧数组、紧凑记录、旧分片和未知时间仍兼容，删除状态不会被基线复活', async () => {
    const shared = sharedStorage(), page = instance(shared);
    for (const [key, value] of Object.entries(legacy())) shared.data.set(key, structuredClone(value));
    shared.data.set('bvh_shard_0', { [key(8)]: { s: 1, t: '01:00', p: 50, a: null, n: '未知时间' } });
    await page.StorageManager.initializeForKeys([key(1)]);
    await page.StorageManager.deleteRecords([key(1, 2)]);
    await page.StorageManager._maintainHistory();
    const fresh = await full(shared);
    assert.equal(fresh.StorageManager.getAllKeys().length, 3);
    assert.equal(fresh.StorageManager.getRecord(key(1, 2)), null);
    assert.equal(fresh.StorageManager.getRecord(key(8)).savedAt, '');
    assert(shared.data.has(key(1)), '兼容旧记录的原始副本被删除');
});

test('缺失旧事务最后一块时整批停止，不发布有效前缀的检查点', async () => {
    const { shared, page, tx } = await seeded(1024, { legacy: true });
    shared.data.delete(tx.blocks.at(-1).key);
    await assert.rejects(page.StorageManager._maintainHistory(), /完整性/);
    assert(![...shared.data.keys()].some(key => key.startsWith('bvh_checkpoint_')));
    assert(shared.data.has(tx.key));
});

test('单条超大旧记录独占检查点，不截断字段或丢失数据', async () => {
    const title = '合成超大标题'.repeat(150000);
    const { shared, page } = await seeded(1, { title });
    await page.StorageManager._maintainHistory();
    const fresh = await full(shared);
    assert.equal(fresh.StorageManager.getRecord(key(1)).title, title);
    assert.equal(page.StorageManager._maintenanceStats.maxBufferedEntries, 1);
});

test('任意写入或删除阶段失败保留全部已提交记录，重试可完成', async () => {
    const baseline = await seeded(4); let mutations = 0;
    baseline.shared.before = ({ name }) => { if (['setValue', 'deleteValue'].includes(name)) mutations++; };
    await baseline.page.StorageManager._maintainHistory();
    for (let failAt = 1; failAt <= mutations; failAt++) {
        const { shared, page } = await seeded(4); let count = 0;
        shared.before = ({ name }) => { if (['setValue', 'deleteValue'].includes(name) && ++count === failAt) throw new Error('合成整理中断'); };
        try { await page.StorageManager._maintainHistory(); } catch { }
        shared.before = null;
        assert.equal((await full(shared)).StorageManager.getAllKeys().length, 4);
        await page.StorageManager._maintainHistory();
        assert.equal((await full(shared)).StorageManager.getAllKeys().length, 4);
    }
    console.log(`后台整理故障注入覆盖 ${mutations} 个写入/删除阶段`);
});

test('后台整理期间发生初始批次回滚，旧检查点不带回旧记录', async () => {
    const { shared, page } = await seeded(128);
    const other = instance(shared, 'other'); await other.StorageManager.initialize();
    let release, reached, blocked = false;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { reached = resolve; });
    shared.before = async ({ owner, name, args }) => {
        if (!blocked && owner === 'page' && name === 'setValue' && args[0].startsWith('bvh_checkpoint_')) { blocked = true; reached(); await gate; }
    };
    const pending = page.StorageManager._maintainHistory(); await ready;
    await other.StorageManager.replaceCloudEntries([], 'initial');
    release(); await pending;
    assert.equal((await full(shared)).StorageManager.getAllKeys().length, 0);
    await page.StorageManager._maintainHistory();
    assert.equal((await full(shared)).StorageManager.getAllKeys().length, 0);
});

test('非初始批次、删除标记及发布信息经后台整理仍完整', async () => {
    const { shared, page } = await seeded(16);
    const epochId = '123e4567-e89b-42d3-a456-426614174000';
    await page.StorageManager.replaceCloudEntries([
        { key: key(99), version: [epoch, 'cloud', 1], deleted: false, record: page.StorageManager._compact(record(90)) },
        { key: key(98), version: [epoch, 'cloud', 2], deleted: true, publishedRevision: 10, publishedAt: epoch }
    ], epochId);
    await page.StorageManager._maintainHistory();
    const fresh = await full(shared), entries = await fresh.StorageManager.getCloudEntries();
    assert.equal(fresh.StorageManager._store.epoch, epochId); assert.equal(entries.length, 2);
    assert.equal(fresh.StorageManager.getRecord(key(99)).percent, '90%');
    assert.equal(entries.find(entry => entry.key === key(98)).publishedRevision, 10);
    assert.equal(fresh.StorageManager.getRecord(key(1)), null);
});

let failed = 0;
for (const { name, run } of tests) {
    try { await run(); console.log(`通过：${name}`); }
    catch (error) { failed++; console.error(`失败：${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} 后台整理专项测试通过`);
process.exitCode = failed ? 1 : 0;
