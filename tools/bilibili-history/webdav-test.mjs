import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { instance, sharedStorage } from './harness.mjs';

const base = instance();
const { WebDavFormat, WebDavCodec, WebDavWorker, StorageManager, shared } = base;
const id = '123e4567-e89b-42d3-a456-426614174000';
const index = { format: 'bvh-webdav-index', schemaVersion: 1, snapshotId: id, file: `history-${id}.json.gz` };
assert.equal(WebDavFormat.validateIndex(JSON.stringify(index)).snapshotId, id);
for (const file of ['../elsewhere.json.gz', 'history-wrong.json.gz', `history-${id}.json.gz/../x`]) {
    assert.throws(() => WebDavFormat.validateIndex({ ...index, file }), /索引格式/);
}

const snapshot = { format: 'bvh-webdav', schemaVersion: 1, snapshotId: id, epoch: 'initial',
    revision: 1, minSyncRevision: 0, createdAt: new Date().toISOString(), kind: 'latest', backupRetentionDays: 7,
    entries: [
        { key: 'BV1234567890?p=10', version: [1000, 'writer', 1], deleted: false,
            record: { s: 1, t: '02:00', p: 40, a: 100, n: '例子' } },
        { key: 'BV0000000001', version: [1001, 'writer', 2], deleted: true, publishedRevision: 1, publishedAt: 1001 }
    ] };
assert.equal(WebDavFormat.validateSnapshot(JSON.stringify(snapshot), id).entries.length, 2);
const compressed = await WebDavCodec.encode(snapshot);
assert.equal(new Uint8Array(compressed)[0], 0x1f);
assert.equal((await WebDavCodec.decode(compressed, id)).entries[0].record.n, '例子');
assert.equal(await WebDavCodec.digest(snapshot), await WebDavCodec.digest({ ...snapshot,
    snapshotId: '123e4567-e89b-42d3-a456-426614174002', createdAt: '2027-01-01T00:00:00Z', entries: [...snapshot.entries].reverse() }));
await assert.rejects(() => WebDavCodec.decode(new Uint8Array([1, 2, 3])), /.+/);
const compressor = base.context.CompressionStream;
base.context.CompressionStream = undefined;
await assert.rejects(() => WebDavCodec.encode(snapshot), /不支持 gzip 压缩/);
base.context.CompressionStream = compressor;
for (const bad of [
    { ...snapshot, minSyncRevision: 2 },
    { ...snapshot, entries: [...snapshot.entries, snapshot.entries[0]] },
    { ...snapshot, entries: [{ ...snapshot.entries[1], record: { n: '不应上传的标题' } }] },
    { ...snapshot, entries: [{ ...snapshot.entries[1], publishedRevision: 3 }] },
    { ...snapshot, entries: [{ ...snapshot.entries[0], record: { ...snapshot.entries[0].record, p: 101 } }] }
]) assert.throws(() => WebDavFormat.validateSnapshot(bad, id));
assert.equal(shared.data.size, 0, '格式检查不能写入正式存储');
assert.equal(StorageManager.validateImport({ BV1234567890: { status: '已观看', percent: '40%', savedAt: '2026-09-26 10:00:00', title: '旧格式' } }).length, 1);
console.log('WebDAV 格式校验通过');

const workerBlobs = new Map(); let created = 0, revoked = 0, terminated = 0;
class TestURL extends URL {
    static createObjectURL(blob) { const key = `blob:worker-${++created}`; workerBlobs.set(key, blob); return key; }
    static revokeObjectURL(key) { assert.ok(workerBlobs.delete(key)); revoked++; }
}
class TestWorker {
    constructor(key) {
        this.pending = [];
        this.ready = workerBlobs.get(key).text().then(code => {
            if (this.stopped) return;
            const prelude = `const { parentPort } = require('node:worker_threads');\n` +
                `globalThis.crypto = require('node:crypto').webcrypto;\n` +
                `globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);\n` +
                `parentPort.on('message', data => globalThis.onmessage({ data }));\n`;
            this.worker = new NodeWorker(prelude + code, { eval: true });
            this.worker.on('message', data => this.onmessage?.({ data }));
            this.worker.on('error', error => this.onerror?.(error));
            for (const [data, transfer] of this.pending) this.worker.postMessage(data, transfer);
            this.pending = [];
        });
    }
    postMessage(data, transfer) {
        if (this.worker) this.worker.postMessage(data, transfer);
        else this.pending.push([data, transfer]);
    }
    terminate() { this.stopped = true; terminated++; this.worker?.terminate(); }
}
base.context.URL = TestURL; base.context.Worker = TestWorker; base.context.Blob = Blob;
assert.equal((await WebDavWorker.decode(await WebDavWorker.encode(snapshot), id)).entries.length, 2);
assert.equal(await WebDavWorker.digest(snapshot), await WebDavCodec.digest(snapshot));
assert.equal((await WebDavWorker.difference([snapshot.entries[0]], snapshot.entries)).map(row => row.key).join(','), 'BV0000000001');
await assert.rejects(() => WebDavWorker.decode(new Uint8Array([1, 2, 3]).buffer, id));
assert.equal(created, revoked, 'Worker Blob URL 必须释放');
assert.equal(created, terminated, 'Worker 必须终止');
base.context.Worker = undefined;
await assert.rejects(() => WebDavWorker.encode(snapshot), /暂不可用/);
console.log('WebDAV 临时 Worker 和资源释放通过');

assert.match((await import('./harness.mjs')).source, /@grant\s+GM_xmlhttpRequest/);
assert.match((await import('./harness.mjs')).source, /@connect\s+\*/);
assert.throws(() => new base.WebDavClient({ url: 'https://user:secret@example.com/dav/' }), /不含账号/);
assert.throws(() => new base.WebDavClient({ url: 'https://example.com/dav/', directory: '/backup' }), /相对路径/);
const client = new base.WebDavClient({ url: 'https://example.com/dav', username: '用户', password: '密钥' });
assert.equal(client.root, 'https://example.com/dav/bilibili-history/');
assert.throws(() => client.url('../other-script.json'), /文件名无效/);
base.context.btoa = btoa;
let outcome = 'auth', seenRequest;
base.context.GM_xmlhttpRequest = options => {
    seenRequest = options;
    queueMicrotask(() => {
        if (outcome === 'timeout') options.ontimeout();
        else options.onload({ status: outcome === 'auth' ? 401 : 404, response: '', responseHeaders: '' });
    });
};
await assert.rejects(() => client.get('state.json'), /认证失败/);
assert.equal(seenRequest.url, client.root + 'state.json');
assert.ok(seenRequest.headers.Authorization.startsWith('Basic '));
assert.equal(seenRequest.headers['Cache-Control'], 'no-cache');
outcome = 'timeout';
await assert.rejects(() => client.get('state.json'), /超时/);
await base.StorageManager.saveRecord('BV0000000009', { s: 1, t: '00:20', p: 20, a: 100, n: '离线仍保存' });
assert.equal(base.StorageManager.getRecord('BV0000000009')?.title, '离线仍保存');
outcome = 'missing';
assert.equal(await client.readIndex(), null, '只有真实 404 才代表未初始化');
console.log('WebDAV 地址隔离、权限、认证、超时与 404 处理通过');

const a = instance(sharedStorage(), 'www'), b = instance(sharedStorage(), 'space');
const record = (title, percent, time) => ({ s: 1, t: '02:00', p: percent, a: time, n: title });
await a.StorageManager.saveRecords([
    { key: 'BV0000000001', record: record('甲', 80, 100) },
    { key: 'BV0000000002?p=2', record: record('分 P', 10, 100) }
]);
await b.StorageManager.saveRecord('BV0000000003', record('乙', 20, 101));
assert.equal(await b.StorageManager.mergeCloudEntries(await a.StorageManager.getCloudEntries()), 2);
assert.equal(await a.StorageManager.mergeCloudEntries(await b.StorageManager.getCloudEntries()), 1);
assert.equal((await a.StorageManager.getCloudEntries()).length, 3);
assert.equal(await a.StorageManager.mergeCloudEntries(await b.StorageManager.getCloudEntries()), 0, '相同版本应幂等');
const conflicting = await b.StorageManager.getCloudEntries();
conflicting[0].record = record('冲突', 99, 101);
await assert.rejects(() => a.StorageManager.mergeCloudEntries(conflicting), /版本冲突/);
await a.StorageManager.deleteRecord('BV0000000001');
assert.equal(await b.StorageManager.mergeCloudEntries(await a.StorageManager.getCloudEntries()), 1);
assert.equal(b.StorageManager.getRecord('BV0000000001'), null);
await b.StorageManager.saveRecord('BV0000000001', record('重看', 5, 102));
await a.StorageManager.mergeCloudEntries(await b.StorageManager.getCloudEntries());
assert.equal(a.StorageManager.getRecord('BV0000000001').percent, '5%');
console.log('WebDAV 原版本合并与删除传播通过');

const rollbackEpoch = '123e4567-e89b-42d3-a456-426614174001';
const oldTab = instance(a.shared, 'old-tab');
await oldTab.StorageManager.getCloudEntries();
await a.StorageManager.replaceCloudEntries([], rollbackEpoch);
assert.equal((await a.StorageManager.getCloudEntries()).length, 0, '空历史回滚也应生效');
assert.equal(await oldTab.StorageManager.saveRecord('BV0000000009', record('迟到采样', 50, 104)), 0);
assert.equal((await oldTab.StorageManager.getCloudEntries()).length, 0, '旧页面不能带回旧批次记录');
const initialReset = instance(sharedStorage(), 'initial-reset');
await initialReset.StorageManager.saveRecord('BV1234567890', record('旧记录', 50, 110));
await initialReset.StorageManager.replaceCloudEntries([], 'initial');
assert.equal((await initialReset.StorageManager.getCloudEntries()).length, 0, '云端初始批次也必须能完整替换');
const reopened = instance(a.shared, 'www-reopened');
assert.equal((await reopened.StorageManager.getCloudEntries()).length, 0, '重启后不应读取旧批次');
await reopened.StorageManager._store.compact();
assert.equal((await reopened.StorageManager.getCloudEntries()).length, 0, '整理后仍应保留空批次');
await reopened.StorageManager.saveRecord('BV0000000004', record('回滚后', 10, 103));
assert.equal((await reopened.StorageManager.getCloudEntries()).length, 1);
console.log('WebDAV 空历史回滚和重启隔离通过');

const local = instance(sharedStorage(), 'local');
await local.StorageManager.saveRecord('BV0000000005', record('待删除', 40, 105));
await local.StorageManager.deleteRecord('BV0000000005');
const tombstone = (await local.StorageManager.getCloudEntries())[0];
await local.StorageManager.mergeCloudEntries([{ ...tombstone, publishedRevision: 1, publishedAt: 1000 }]);
assert.equal((await local.StorageManager.getCloudEntries())[0].publishedRevision, 1);
local.StorageManager.writeBackup({ key: 'BV0000000005', value: { status: '已观看', percent: '40%', savedAt: '2026-09-26 10:00:00' } });
const delayedOld = await local.StorageManager._store.prepare([{ key: 'BV0000000005',
    version: [tombstone.version[0] - 1, 'old', 1], deleted: false, record: record('旧采样', 40, 105) }]);
assert.equal(await local.StorageManager.pruneCloudDeleted(['BV0000000005'], 1, 'initial'), 1);
await local.StorageManager._store.publish(delayedOld);
await local.StorageManager.restoreFromLocalStorage();
assert.equal((await local.StorageManager.getCloudEntries()).length, 0);
await local.StorageManager._store.compact();
assert.equal((await local.StorageManager.getCloudEntries()).length, 0);
assert.equal([...local.shared.data.keys()].filter(key => key.startsWith('bvh_commit_')).length, 1, '旧删除提交必须物理回收');
console.log('WebDAV 本地删除回收通过');

const many = instance(sharedStorage(), 'many');
const ids = Array.from({ length: 64 }, (_, n) => `BV${n.toString(36).padStart(10, '0')}`);
await many.StorageManager.saveRecords(ids.map(key => ({ key, record: record('会被物理回收的长标题'.repeat(8), 30, 105) })));
await many.StorageManager.deleteRecords(ids);
await many.StorageManager.mergeCloudEntries((await many.StorageManager.getCloudEntries()).map(entry => ({
    ...entry, publishedRevision: 1, publishedAt: 1000
})));
const bytes = () => JSON.stringify([...many.shared.data]).length;
const beforePrune = bytes();
await many.StorageManager.pruneCloudDeleted(ids, 1, 'initial');
const otherPage = instance(many.shared, 'other-page');
await otherPage.StorageManager.saveRecord('BV9999999999', record('并发新增', 15, 106));
await many.StorageManager._store.compact();
assert.ok(bytes() < beforePrune, '本地 GM 占用应实际下降');
assert.equal((await many.StorageManager.getCloudEntries()).length, 1, '清理期间的新提交应保留');
console.log('WebDAV 批量回收缩小存储并保留新提交');

const scoped = instance(sharedStorage(), 'scoped');
const visible = ids.slice(0, 40);
await scoped.StorageManager.saveRecords(visible.map(key => ({ key, record: record('保留', 25, 108) })));
await scoped.StorageManager.saveRecord('BV8888888888', record('清理对象', 20, 108));
await scoped.StorageManager.deleteRecord('BV8888888888');
const deleted = (await scoped.StorageManager.getCloudEntries()).find(entry => entry.key === 'BV8888888888');
await scoped.StorageManager.mergeCloudEntries([{ ...deleted, publishedRevision: 1, publishedAt: 1000 }]);
await scoped.StorageManager.pruneCloudDeleted(['BV8888888888'], 1, 'initial');
const groupedBlocks = [...scoped.shared.data.keys()].filter(key => key.startsWith('bvh_checkpoint_')).length;
const beforeCalls = scoped.shared.calls.length;
const videoTab = instance(scoped.shared, 'video-tab');
await videoTab.StorageManager.initializeForKeys([visible[0]]);
assert.ok(videoTab.StorageManager.getRecord(visible[0]));
const readBlocks = scoped.shared.calls.slice(beforeCalls).filter(call => call.type === 'get' && call.key.startsWith('bvh_checkpoint_')).length;
assert.ok(readBlocks < groupedBlocks, '视频页应仅读取命中范围的清理检查点');
console.log('WebDAV 回收后局部读取通过');

const interrupted = instance(sharedStorage(), 'interrupted');
await interrupted.StorageManager.saveRecord('BV7777777777', record('中断', 30, 108));
await interrupted.StorageManager.deleteRecord('BV7777777777');
const interruptedDelete = (await interrupted.StorageManager.getCloudEntries())[0];
await interrupted.StorageManager.mergeCloudEntries([{ ...interruptedDelete, publishedRevision: 1, publishedAt: 1000 }]);
interrupted.shared.before = ({ name, args }) => {
    if (name === 'setValue' && args[0].startsWith('bvh_commit_') && args[1]?.kind === 'prune') throw new Error('模拟清理标记写入失败');
};
await assert.rejects(() => interrupted.StorageManager.pruneCloudDeleted(['BV7777777777'], 1, 'initial'), /模拟清理/);
interrupted.shared.before = null;
assert.equal((await interrupted.StorageManager.getCloudEntries()).length, 1, '中断时旧删除仍可读');
assert.equal(await interrupted.StorageManager.pruneCloudDeleted(['BV7777777777'], 1, 'initial'), 1);
console.log('WebDAV 回收中断后重试通过');

if (process.env.BVH_BENCH === '1') {
    base.context.Worker = TestWorker;
    const large = { ...snapshot, entries: Array.from({ length: 100_000 }, (_, number) => ({
        key: `BV${number.toString(36).padStart(10, '0')}`, version: [1000 + number, `writer-${number % 3000}`, number],
        deleted: false, record: record(`标题 ${number}：测试观看历史压缩与恢复`, number % 101, 100 + number)
    })) };
    const rawBytes = new TextEncoder().encode(JSON.stringify(large)).length;
    let maxDelay = 0, previous = performance.now();
    const ticker = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - previous - 16); previous = now; }, 16);
    const start = performance.now(), zipped = await WebDavWorker.encode(large), middle = performance.now(), zippedBytes = zipped.byteLength;
    assert.equal((await WebDavWorker.decode(zipped, id)).entries.length, 100_000);
    clearInterval(ticker);
    assert.equal(created, revoked); assert.equal(created, terminated);
    console.log(`10 万条 Worker 测量：JSON ${rawBytes} B，gzip ${zippedBytes} B，压缩 ${Math.round(middle - start)} ms，含解压 ${Math.round(performance.now() - middle)} ms，事件循环最大采样延迟 ${Math.round(maxDelay)} ms`);
}
