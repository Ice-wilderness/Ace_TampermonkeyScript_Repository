import assert from 'node:assert/strict';
import { instance, sharedStorage } from './harness.mjs';
import { key, record, records, legacy, invalidImports, epoch } from './fixtures.mjs';

const baseline = process.argv.includes('--baseline');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const seed = (w, data) => {
    for (const [k, v] of Object.entries(data)) {
        const sk = `bvh_shard_${w.StorageManager._getShardId(k)}`;
        w.shared.data.set(sk, { ...w.shared.data.get(sk), [k]: w.StorageManager._compact(v) });
    }
};
test('隔离环境与可重复数据生成', () => {
    const w = instance(); assert.equal(w.shared.data.size, 0);
    assert.equal(w.context.fetch, undefined); assert.equal(w.context.process, undefined);
    assert.deepEqual(records(10000), records(10000)); assert.equal(Object.keys(records(0)).length, 0);
    assert.equal(Object.keys(legacy()).length, 3); assert.equal(invalidImports().length, 5);
    assert.equal(w.StorageManager.getAllKeys().length, 0);
});
test('1 同分片交错保存保留两条记录', async () => {
    const shared = sharedStorage(), a = instance(shared, 'www'), b = instance(shared, 'space');
    assert.equal(a.StorageManager._getShardId(key(2)), a.StorageManager._getShardId(key(8)));
    a.StorageManager.getRecord(key(2)); b.StorageManager.getRecord(key(8));
    await a.StorageManager.saveRecord(key(2), record()); await b.StorageManager.saveRecord(key(8), record());
    const c = instance(shared); await c.StorageManager.initialize?.();
    assert.equal(c.StorageManager.getAllKeys().length, baseline ? 1 : 2);
});
test('2 先读 P1 后完整返回 P1/P2/P3', async () => {
    const w = instance(); seed(w, legacy()); await w.StorageManager.initialize?.();
    w.StorageManager.getRecord(key(1));
    assert.equal(w.StorageManager.getRelatedKeys(key(1)).length, baseline ? 1 : 3);
});
test('3 新增记录不把完整索引覆盖成局部索引', async () => {
    const a = instance(); seed(a, records(80)); await a.StorageManager._rebuildBaseIndex();
    const b = instance(a.shared); await b.StorageManager.initialize?.();
    await b.StorageManager.saveRecord(key(9000000001), record());
    const index = a.shared.data.get('bvh_base_index').index;
    assert.equal(Object.keys(index).length, baseline ? 7 : 80);
    if (!baseline) {
        const fresh = instance(a.shared);
        await fresh.StorageManager.initializeForKeys([key(9000000001)]);
        assert.equal(fresh.StorageManager.getRelatedKeys(key(9000000001)).length, 1);
        await fresh.StorageManager.initialize();
        assert.equal(fresh.StorageManager.getAllKeys().length, 81);
    }
});
test('4 完整索引下五次未知查询不写入', async () => {
    const w = instance(); seed(w, records(80)); await w.StorageManager.initialize?.(); await w.StorageManager._rebuildBaseIndex();
    w.shared.calls.length = 0;
    for (let i = 0; i < 5; i++) assert.equal(w.StorageManager.getRelatedKeys(key(9000000000 + i)).length, 0);
    assert.equal(w.shared.calls.filter(c => c.type === 'set').length, baseline ? 5 : 0);
});
test('5 旧备份不覆盖较新的正式进度', async () => {
    const w = instance(); seed(w, { [key(1)]: record(80) }); await w.StorageManager.initialize?.();
    w.context.localStorage.setItem(`BvH_backup_${key(1)}`, JSON.stringify({ key: key(1), value: record(20, epoch - 86400000), savedAt: epoch - 86400000 }));
    await w.StorageManager.restoreFromLocalStorage();
    assert.equal(w.StorageManager.getRecord(key(1)).percent, baseline ? '20%' : '80%');
});
test('6 无效导入不污染查询缓存', async () => {
    const w = instance(); await w.StorageManager.initialize?.();
    let failed = false; try { await w.StorageManager.importRecords(invalidImports()[0]); } catch { failed = true; }
    assert.equal(failed, true); assert.equal(!!w.StorageManager.getRecord(key(1)), baseline);
    assert.equal([...w.shared.data.keys()].filter(k => k.startsWith('bvh_shard_')).length, 0);
});
test('7 旧媒体不能保存到新路由身份', async () => {
    const w = instance(); await w.StorageManager.initialize?.();
    w.EpisodeResolver.getCurrentKey = () => key(2);
    w.UIComponent.updateViewPanelProgress = () => {}; w.UIComponent.showViewPanel = () => {};
    const player = new w.VideoPlayerObserver();
    Object.assign(player, { bvId: key(1), title: '旧视频', hasPlayed: true, videoEl: { currentTime: 300, duration: 600 } });
    await player.saveProgress();
    assert.equal(!!w.StorageManager.getRecord(key(2)), baseline);
});
test('8 同文案卡片响应进度条设置变化', async () => {
    const w = instance(); seed(w, { [key(1)]: record(80) });
    await w.StorageManager.initialize?.();
    const tag = { innerText: '已观看80%' }, bar = {};
    let tags = [tag], bars = [bar];
    const el = { _bvhLastVideoKey: key(1), _bvhRetryCount: 3,
        matches: () => false, closest: () => null, querySelector: () => null,
        querySelectorAll: selector => selector === '.bvh-progress-bar' ? bars : tags };
    const watcher = Object.create(w.DOMWatcher.prototype);
    Object.assign(watcher, { isSkippedHeaderNode: () => false, getVideoKeyFromLink: () => key(1),
        isHeaderPopoverVideoLink: () => false, getHeaderPopoverCover: () => null,
        getRelatedKeysCached: () => [key(1)], removeExistingMark: () => { tags = []; bars = []; } });
    w.CONFIG.showProgressBar = false; watcher.processLink(el);
    assert.equal(bars.length, baseline ? 1 : 0);
});

let failed = 0;
for (const { name, run } of tests) {
    try { await run(); console.log(`通过：${name}`); }
    catch (e) { failed++; console.error(`失败：${name}\n${e.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} 通过${baseline ? '（旧版缺陷观测模式，不代表修复通过）' : ''}`);
process.exitCode = failed ? 1 : 0;
