import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { instance } from './harness.mjs';
import { records, key, record } from './fixtures.mjs';
const w = instance(), storage = w.StorageManager, q = w.HistoryQueries;
let mockStorageMs = 0;
for (const method of ['get', 'set', 'list', 'delete']) {
    const original = w.HistoryStoreIO[method];
    if (!original) continue;
    w.HistoryStoreIO[method] = async (...args) => {
        const start = performance.now();
        try { return await original.apply(w.HistoryStoreIO, args); } finally { mockStorageMs += performance.now() - start; }
    };
}
for (const [k, v] of Object.entries(records(10000))) {
    const shard = 'bvh_shard_' + storage._getShardId(k), data = w.shared.data.get(shard) || {};
    data[k] = storage._compact(v); w.shared.data.set(shard, data);
}
const measurements = {};
async function measure(name, fn) { const start = performance.now(), before = w.shared.calls.length, ioBefore = mockStorageMs; const result = await fn(); measurements[name] = { ms: +(performance.now() - start).toFixed(2), storageCalls: w.shared.calls.length - before, mockStorageMs: +(mockStorageMs - ioBefore).toFixed(2) }; return result; }
await measure('initialize', () => storage.initialize());
const rows = await measure('coldQuery', () => q.query()); assert.equal(rows.length, 10000);
const builds = q.metrics.builds, sorts = q.metrics.sorts;
await measure('pagination', async () => { for (let page = 0; page < 10; page++) assert.equal((await q.query()).slice(page * 20, (page + 1) * 20).length, 20); });
assert.equal(q.metrics.builds, builds); assert.equal(q.metrics.sorts, sorts); assert.equal(measurements.pagination.storageCalls, 0);
await measure('search', () => q.query({ query: '合成视频 99', sort: 'title-asc' }));
for (const days of [7, 30, 90]) {
    const actual = await measure('stats' + days, () => q.stats(days)), expected = storage.getStatsBundle(days);
    for (const [k, v] of Object.entries(expected.cards)) assert.equal(actual.counts[k], v, k);
    assert.strictEqual(await q.stats(days), actual);
}
await assert.rejects(q.query({ query: '需要取消的查询' }, { cancelled: () => true }), { name: 'AbortError' });
await storage.saveRecord(key(2), record(60));
let reads = 0; const getRecord = storage.getRecord;
storage.getRecord = id => { reads++; return getRecord(id); };
await q.model(); assert.equal(reads, 1); storage.getRecord = getRecord;
await measure('unknownQueries', async () => { for (let i = 1; i <= 5; i++) assert.equal(storage.getRelatedKeys(key(9000000000 + i)).length, 0); });
assert.equal(measurements.unknownQueries.storageCalls, 0);
await measure('compaction', () => storage._store.compact());
assert.equal(storage._store.entries.size, 10000);
measurements.maxSegmentMs = +(q.metrics.maxSegment || 0).toFixed(2);
assert(measurements.maxSegmentMs < 50, '计算段超出 50 ms');
console.log('通过：一万条历史、分页复用、增量模型、取消查询、统计边界及未知查询零写入');
console.log(JSON.stringify(measurements, null, 2));
