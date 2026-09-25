import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { instance, sharedStorage } from './harness.mjs';

const files = new Map(), calls = [];
const server = { conditional: false, weak: false, fail: null };
const install = local => {
    const blobs = new Map(); let serial = 0;
    class TestURL extends URL {
        static createObjectURL(blob) { const key = `blob:worker-${++serial}`; blobs.set(key, blob); return key; }
        static revokeObjectURL(key) { blobs.delete(key); }
    }
    class TestWorker {
        constructor(key) {
            this.pending = [];
            blobs.get(key).text().then(code => {
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
        terminate() { this.stopped = true; this.worker?.terminate(); }
    }
    local.context.URL = TestURL; local.context.Worker = TestWorker; local.context.Blob = Blob;
    local.WebDavClient.prototype.request = async function (method, path, { body, headers = {}, targetUrl } = {}) {
        calls.push({ method, path, root: this.root, headers, targetUrl });
        const key = targetUrl || this.url(path), current = files.get(key);
        if (method === 'MKCOL') return { status: 201, body: '', headers: '' };
        if (method === 'GET') {
            if (!current) { const error = new Error('404'); error.status = 404; throw error; }
            return { status: 200, body: typeof current.body === 'string' ? current.body : current.body.slice(0),
                headers: server.conditional ? `ETag: ${server.weak ? 'W/' : ''}"${current.etag}"\r\n` : '' };
        }
        if (method === 'PUT') {
            const failure = server.fail && ((server.fail.path === 'state.json' && path === 'state.json')
                || (server.fail.path === 'history' && path.startsWith('history-'))
                || (server.fail.path === 'backup' && path.startsWith('backups/before-'))) ? server.fail : null;
            if (failure) server.fail = null;
            if (failure?.when === 'before') {
                const error = new Error(failure.message || '模拟写入失败'); error.status = failure.status;
                throw error;
            }
            if (server.conditional && ((headers['If-None-Match'] === '*' && current)
                || (headers['If-Match'] && headers['If-Match'] !== `"${current?.etag}"`))) {
                const error = new Error('412'); error.status = 412; throw error;
            }
            files.set(key, { body: typeof body === 'string' ? body : body.slice(0), etag: String(calls.length), modifiedAt: Date.now() });
            if (failure?.when === 'after') throw new Error(failure.message || '模拟响应丢失');
            return { status: current ? 204 : 201, body: '', headers: '' };
        }
        if (method === 'DELETE') { files.delete(key); return { status: 204, body: '', headers: '' }; }
        throw new Error(`未实现 ${method}`);
    };
    local.WebDavClient.prototype.list = async function (path = '') {
        calls.push({ method: 'PROPFIND', path, root: this.root });
        const prefix = this.url(path);
        return [...files].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([key, value]) => ({ name: key.slice(prefix.length), modifiedAt: value.modifiedAt,
                bytes: typeof value.body === 'string' ? value.body.length : value.body.byteLength }));
    };
    assert.equal(blobs.size, 0);
    return local;
};

const config = { url: 'https://dav.example/users/history/', username: 'user', password: 'secret',
    frequency: 'off', backupRetentionDays: 7 };
const record = (title, percent = 40) => ({ s: 1, t: '01:30', p: percent, a: 100, n: title });
const a = install(instance(sharedStorage(), 'a'));
await a.WebDavSync.saveConfig(config);
await a.StorageManager.saveRecord('BV0000000001', record('甲'));
await a.WebDavSync.sync(true);
const root = 'https://dav.example/users/history/bilibili-history/';
assert.ok(files.has(root + 'state.json'));
assert.ok([...files.keys()].some(key => key.startsWith(root + 'backups/daily-')));
const firstHistoryFile = JSON.parse(files.get(root + 'state.json').body).file;
assert.ok(calls.every(call => call.root === root), '请求只能进入脚本专用目录');
const firstState = await a.WebDavSync.state(root);
assert.equal(firstState.conditional, false);
const nested = new a.WebDavClient({ ...config, directory: 'archive/history' });
assert.equal(nested.root, 'https://dav.example/users/history/archive/history/bilibili-history/');
await nested.ensureDirectories();
assert.ok(calls.some(call => call.method === 'MKCOL'
    && call.targetUrl === 'https://dav.example/users/history/archive/'));
assert.ok(calls.some(call => call.method === 'MKCOL'
    && call.targetUrl === 'https://dav.example/users/history/archive/history/'));
const before = calls.length;
await a.WebDavSync.sync(true);
assert.equal(calls.slice(before).filter(call => call.method === 'GET' && call.path.endsWith('.gz')).length, 0,
    '无变化时不能下载正文');
assert.equal(calls.slice(before).filter(call => call.method === 'PUT' && call.path.endsWith('.gz')).length, 0,
    '无变化时不能上传正文');
assert.equal(calls.slice(before).map(call => `${call.method} ${call.path}`).join(','), 'GET state.json',
    '同一天无变化应仅请求小索引');
const previousDate = a.context.Date, nextUtcDay = previousDate.now() + 86400000;
a.context.Date = class extends previousDate {
    constructor(...args) { super(...(args.length ? args : [nextUtcDay])); }
    static now() { return nextUtcDay; }
};
const newDayStart = calls.length;
await a.WebDavSync.sync(true);
assert.equal(calls.slice(newDayStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 0);
assert.equal(calls.slice(newDayStart).filter(call => call.method === 'PUT' && call.path.startsWith('backups/daily-')).length, 1,
    '无历史变化的新 UTC 日仍应创建日期备份');
console.log('兼容模式首次同步、每日备份、专用目录及无变化跳过正文通过');

const b = install(instance(sharedStorage(), 'b'));
await b.WebDavSync.saveConfig(config);
const remoteOnlyStart = calls.length;
await b.WebDavSync.sync(true);
assert.equal(b.StorageManager.getRecord('BV0000000001')?.title, '甲');
assert.equal(calls.slice(remoteOnlyStart).filter(call => call.method === 'GET' && call.path.endsWith('.gz')).length, 1);
assert.equal(calls.slice(remoteOnlyStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 0);
await b.StorageManager.saveRecord('BV0000000002', record('乙'));
const localOnlyStart = calls.length;
await b.WebDavSync.sync(true);
assert.equal(calls.slice(localOnlyStart).filter(call => call.method === 'GET' && call.path.startsWith('history-')).length, 0);
assert.equal(calls.slice(localOnlyStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 1);
await a.WebDavSync.sync(true);
assert.equal(a.StorageManager.getRecord('BV0000000002')?.title, '乙');
await a.StorageManager.saveRecord('BV0000000004', record('A 新增'));
await b.StorageManager.saveRecord('BV0000000005', record('B 新增'));
await a.WebDavSync.sync(true);
const bothStart = calls.length;
await b.WebDavSync.sync(true);
assert.equal(calls.slice(bothStart).filter(call => call.method === 'GET' && call.path.startsWith('history-')).length, 1);
assert.equal(calls.slice(bothStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 1);
await a.WebDavSync.sync(true);
assert.equal(a.StorageManager.getRecord('BV0000000005')?.title, 'B 新增');
await a.WebDavSync.saveConfig({ ...config, backupRetentionDays: 14 });
await a.WebDavSync.sync(true);
await b.WebDavSync.sync(true);
assert.equal((await b.WebDavSync.config()).backupRetentionDays, 14, '保留策略应跨设备共享');
await a.StorageManager.deleteRecord('BV0000000001');
await a.WebDavSync.sync(true);
await b.WebDavSync.sync(true);
assert.equal(b.StorageManager.getRecord('BV0000000001'), null);
console.log('隔离设备双向合并与删除传播通过');

const backups = await a.WebDavSync.backups();
assert.ok(backups.length);
assert.notEqual(JSON.parse(files.get(root + 'state.json').body).file, firstHistoryFile);
files.delete(root + firstHistoryFile);
await a.WebDavSync.restore(backups[0].name);
await b.WebDavSync.sync(true);
assert.equal(b.StorageManager.getRecord('BV0000000001')?.title, '甲');
assert.equal(b.StorageManager.getRecord('BV0000000002'), null);
await a.StorageManager.saveRecord('BV0000000006', record('本地替换失败前'));
const beforeRestoreFailure = JSON.parse(files.get(root + 'state.json').body).snapshotId;
server.fail = { path: 'backup', when: 'before', message: '模拟恢复前备份失败' };
await assert.rejects(() => a.WebDavSync.restore(backups[0].name), /模拟恢复前备份失败/);
assert.equal(JSON.parse(files.get(root + 'state.json').body).snapshotId, beforeRestoreFailure);
assert.equal(a.StorageManager.getRecord('BV0000000006')?.title, '本地替换失败前');
const replaceOriginal = a.StorageManager.replaceCloudEntries;
a.StorageManager.replaceCloudEntries = async () => { throw new Error('模拟本地替换失败'); };
await assert.rejects(() => a.WebDavSync.restore(backups[0].name), /模拟本地替换失败/);
a.StorageManager.replaceCloudEntries = replaceOriginal;
assert.equal(a.StorageManager.getRecord('BV0000000006')?.title, '本地替换失败前');
await a.WebDavSync.sync(true);
assert.equal(a.StorageManager.getRecord('BV0000000006'), null,
    '云端已回滚而本地失败时，下轮必须先采用云端批次');
console.log('所有设备日期回滚通过');

server.conditional = true;
const protectedConfig = { ...config, url: 'https://dav.example/users/protected/' };
const c = install(instance(sharedStorage(), 'c'));
await c.WebDavSync.saveConfig(protectedConfig);
await c.StorageManager.saveRecord('BV0000000011', record('条件写入'));
await c.WebDavSync.sync(true);
const protectedRoot = 'https://dav.example/users/protected/bilibili-history/';
assert.equal((await c.WebDavSync.state(protectedRoot)).conditional, true);
assert.ok(calls.some(call => call.root === protectedRoot && call.path === 'state.json'
    && call.headers['If-None-Match'] === '*'));
await c.StorageManager.saveRecord('BV0000000012', record('后续更新'));
await c.WebDavSync.sync(true);
assert.ok(calls.some(call => call.root === protectedRoot && call.path === 'state.json'
    && call.headers['If-Match']));
const beforeConflict = JSON.parse(files.get(protectedRoot + 'state.json').body).snapshotId;
await c.StorageManager.saveRecord('BV0000000013', record('条件冲突'));
server.fail = { path: 'state.json', when: 'before', status: 412, message: '模拟 412' };
const conflictStart = calls.length;
await assert.rejects(() => c.WebDavSync.sync(true), /模拟 412/);
assert.equal(JSON.parse(files.get(protectedRoot + 'state.json').body).snapshotId, beforeConflict);
assert.equal(calls.slice(conflictStart).filter(call => call.path === 'state.json' && call.method === 'PUT').length, 1,
    '412 后不得去掉条件头重试覆盖');
await c.WebDavSync.sync(true);
console.log('强 ETag 条件创建与更新通过');

server.weak = true;
const weak = install(instance(sharedStorage(), 'weak'));
const weakClient = new weak.WebDavClient({ ...config, url: 'https://dav.example/users/weak/' });
assert.equal((await weakClient.testConnection()).conditional, false, '弱 ETag 应采用兼容模式');
server.weak = false; server.conditional = false;
const ignored = install(instance(sharedStorage(), 'ignored'));
const ignoredClient = new ignored.WebDavClient({ ...config, url: 'https://dav.example/users/ignored/' });
assert.equal((await ignoredClient.testConnection()).conditional, false, '忽略条件头应采用兼容模式');
const removeProbe = ignoredClient.delete;
ignoredClient.delete = async () => { throw new Error('模拟 DELETE 无权限'); };
await assert.rejects(() => ignoredClient.testConnection(), /模拟 DELETE 无权限/,
    '连接测试必须验证探测文件可删除');
ignoredClient.delete = removeProbe;
console.log('弱 ETag 与忽略条件头的连接探测通过');

const failureConfig = { ...config, url: 'https://dav.example/users/failure/' };
const failing = install(instance(sharedStorage(), 'failing'));
await failing.WebDavSync.saveConfig(failureConfig);
await failing.StorageManager.saveRecord('BV0000000021', record('待上传'));
server.fail = { path: 'history', when: 'before' };
await assert.rejects(() => failing.WebDavSync.sync(true), /模拟写入失败/);
const failureRoot = 'https://dav.example/users/failure/bilibili-history/';
assert.equal(files.has(failureRoot + 'state.json'), false);
assert.equal(failing.StorageManager.getRecord('BV0000000021')?.title, '待上传');
await failing.WebDavSync.sync(true);
const firstIndex = JSON.parse(files.get(failureRoot + 'state.json').body);
await failing.StorageManager.saveRecord('BV0000000022', record('索引写入前失败'));
server.fail = { path: 'state.json', when: 'before' };
await assert.rejects(() => failing.WebDavSync.sync(true), /模拟写入失败/);
assert.equal(JSON.parse(files.get(failureRoot + 'state.json').body).snapshotId, firstIndex.snapshotId);
await failing.WebDavSync.sync(true);
assert.notEqual(JSON.parse(files.get(failureRoot + 'state.json').body).snapshotId, firstIndex.snapshotId);
await failing.StorageManager.saveRecord('BV0000000023', record('超时但索引已写入'));
server.fail = { path: 'state.json', when: 'after', message: '模拟响应超时' };
await assert.rejects(() => failing.WebDavSync.sync(true), /模拟响应超时/);
const uploaded = JSON.parse(files.get(failureRoot + 'state.json').body);
const retryStart = calls.length;
await failing.WebDavSync.sync(true);
assert.equal(JSON.parse(files.get(failureRoot + 'state.json').body).snapshotId, uploaded.snapshotId);
assert.equal(calls.slice(retryStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 0,
    '响应超时后应先重读索引并采用已发布正文');
console.log('正文失败、索引失败与响应丢失后的重读恢复通过');

const goodIndex = files.get(failureRoot + 'state.json');
const goodBody = files.get(failureRoot + uploaded.file);
const mismatchedId = crypto.randomUUID(), mismatchedFile = `history-${mismatchedId}.json.gz`;
files.set(failureRoot + mismatchedFile, goodBody);
files.set(failureRoot + 'state.json', { ...goodIndex, body: JSON.stringify({ ...uploaded,
    snapshotId: mismatchedId, file: mismatchedFile }) });
await assert.rejects(() => failing.WebDavSync.sync(true), /快照格式无效/);
assert.equal(failing.StorageManager.getRecord('BV0000000023')?.title, '超时但索引已写入');
files.delete(failureRoot + mismatchedFile);
await assert.rejects(() => failing.WebDavSync.sync(true), /404/);
files.set(failureRoot + 'state.json', goodIndex);
console.log('索引与正文 ID 不符、正文缺失均未修改本地历史');

const cleanupConfig = { ...config, url: 'https://dav.example/users/cleanup/' };
const cleanup = install(instance(sharedStorage(), 'cleanup'));
await cleanup.WebDavSync.saveConfig(cleanupConfig);
await cleanup.StorageManager.saveRecord('BV0000000031', record('删除标记'));
await cleanup.WebDavSync.sync(true);
await cleanup.StorageManager.deleteRecord('BV0000000031');
await cleanup.WebDavSync.sync(true);
const cleanupClient = new cleanup.WebDavClient(cleanupConfig);
const cleanupRoot = cleanupClient.root;
let cleanupIndex = await cleanupClient.readIndex();
let cleanupSnapshot = await cleanup.WebDavSync.readSnapshot(cleanupClient, cleanupIndex.index);
assert.equal(cleanupSnapshot.entries[0].deleted, true);
assert.ok(cleanupSnapshot.entries[0].publishedAt > 0, '第一次上传才开始计算删除保留期');
const firstPublication = { revision: cleanupSnapshot.entries[0].publishedRevision,
    at: cleanupSnapshot.entries[0].publishedAt };
await cleanup.StorageManager.saveRecord('BV0000000039', record('后续观看'));
await cleanup.WebDavSync.sync(true);
cleanupIndex = await cleanupClient.readIndex();
cleanupSnapshot = await cleanup.WebDavSync.readSnapshot(cleanupClient, cleanupIndex.index);
const repeated = cleanupSnapshot.entries.find(entry => entry.key === 'BV0000000031');
assert.equal(repeated.publishedRevision, firstPublication.revision);
assert.equal(repeated.publishedAt, firstPublication.at);
const normal = install(instance(sharedStorage(), 'normal'));
await normal.WebDavSync.saveConfig(cleanupConfig);
await normal.WebDavSync.sync(true);
const cleanupState = await cleanup.WebDavSync.state(cleanupRoot);
const aged = { ...cleanupSnapshot, snapshotId: crypto.randomUUID(), revision: cleanupSnapshot.revision + 1,
    entries: cleanupSnapshot.entries.map(entry => entry.deleted ? { ...entry,
        publishedAt: cleanup.context.Date.now() - 31 * 86400000 } : entry) };
await cleanup.WebDavSync.publish(cleanupClient, cleanupState, cleanupIndex, aged, Date.now());
await cleanup.StorageManager.mergeCloudEntries(aged.entries);
cleanupState.maintenanceAt = 0; cleanupState.backedUpDate = '';
await cleanup.WebDavSync.maintain(cleanupClient, cleanupState, aged);
cleanupIndex = await cleanupClient.readIndex();
cleanupSnapshot = await cleanup.WebDavSync.readSnapshot(cleanupClient, cleanupIndex.index);
assert.equal(cleanupSnapshot.entries.length, 1);
assert.ok(cleanupSnapshot.minSyncRevision >= 1);
assert.equal((await cleanup.StorageManager.getCloudEntries()).length, 1, '已发布删除应在本地物理回收，仍保留活跃记录');
const normalStart = calls.length;
assert.equal((await normal.WebDavSync.sync(true)).pendingChoice, undefined);
assert.equal(calls.slice(normalStart).filter(call => call.method === 'PUT' && call.path.startsWith('history-')).length, 0,
    '见过删除的设备不应重传已回收的标记');
const stale = install(instance(sharedStorage(), 'stale'));
await stale.WebDavSync.saveConfig(cleanupConfig);
await stale.StorageManager.saveRecord('BV0000000031', record('长期未同步的旧记录'));
assert.equal((await stale.WebDavSync.sync(true)).pendingChoice, true);
assert.equal(stale.StorageManager.getRecord('BV0000000031')?.title, '长期未同步的旧记录');
await stale.WebDavSync.resolveChoice('cloud');
assert.equal(stale.StorageManager.getRecord('BV0000000031'), null);
assert.ok((await stale.WebDavSync.backups()).some(item => item.name.startsWith('before-resync-local-')));
const competing = { ...cleanupSnapshot, snapshotId: crypto.randomUUID(), createdAt: new Date().toISOString() };
const competingFile = `history-${competing.snapshotId}.json.gz`;
await cleanupClient.put(competingFile, await cleanup.WebDavWorker.encode(competing));
await cleanupClient.put('state.json', JSON.stringify({ format: 'bvh-webdav-index', schemaVersion: 1,
    snapshotId: competing.snapshotId, file: competingFile }));
assert.equal((await stale.WebDavSync.sync(true)).pendingChoice, true,
    '兼容模式同修订不同正文且已有清理进度时应暂停合并');
console.log('30 天删除回收、旧设备暂停和双份备份后选云端通过');

const failedChoice = install(instance(sharedStorage(), 'failed-choice'));
await failedChoice.WebDavSync.saveConfig(cleanupConfig);
await failedChoice.StorageManager.saveRecord('BV0000000033', record('选择失败仍保留'));
assert.equal((await failedChoice.WebDavSync.sync(true)).pendingChoice, true);
const beforeChoiceFailure = (await cleanupClient.readIndex()).index.snapshotId;
server.fail = { path: 'backup', when: 'before', message: '模拟来源备份失败' };
await assert.rejects(() => failedChoice.WebDavSync.resolveChoice('local'), /模拟来源备份失败/);
assert.equal((await cleanupClient.readIndex()).index.snapshotId, beforeChoiceFailure);
assert.equal(failedChoice.StorageManager.getRecord('BV0000000033')?.title, '选择失败仍保留');
const localChoice = install(instance(sharedStorage(), 'local-choice'));
await localChoice.WebDavSync.saveConfig(cleanupConfig);
await localChoice.StorageManager.saveRecord('BV0000000032', record('只在本机'));
assert.equal((await localChoice.WebDavSync.sync(true)).pendingChoice, true);
await localChoice.WebDavSync.resolveChoice('local');
await cleanup.WebDavSync.sync(true);
assert.equal(cleanup.StorageManager.getRecord('BV0000000032')?.title, '只在本机');
assert.equal((await cleanup.WebDavSync.state(cleanupRoot)).minSyncRevision, 0);
console.log('旧设备选本地后全设备采用新批次通过');

const maintenanceState = await cleanup.WebDavSync.state(cleanupRoot);
maintenanceState.maintenanceAt = 0; maintenanceState.filesCleanedAt = 0;
const orphan = `history-${crypto.randomUUID()}.json.gz`;
files.set(cleanupRoot + orphan, { body: new ArrayBuffer(4), etag: 'orphan',
    modifiedAt: cleanup.context.Date.now() - 25 * 3600000 });
files.set(cleanupRoot + 'another-script.json', { body: '{}', etag: 'foreign',
    modifiedAt: cleanup.context.Date.now() - 25 * 3600000 });
const oldBackup = `daily-2026-08-01-000000-${crypto.randomUUID()}.json.gz`;
files.set(cleanupRoot + 'backups/' + oldBackup, { body: new ArrayBuffer(4), etag: 'old-backup',
    modifiedAt: cleanup.context.Date.now() - 8 * 86400000 });
files.set(cleanupRoot + 'backups/other-app.json.gz', { body: new ArrayBuffer(4), etag: 'foreign-backup',
    modifiedAt: cleanup.context.Date.now() - 8 * 86400000 });
const latestCleanupIndex = await cleanupClient.readIndex();
await cleanup.WebDavSync.maintain(cleanupClient, maintenanceState,
    await cleanup.WebDavSync.readSnapshot(cleanupClient, latestCleanupIndex.index));
assert.equal(files.has(cleanupRoot + orphan), false);
assert.equal(files.has(cleanupRoot + latestCleanupIndex.index.file), true);
assert.equal(files.has(cleanupRoot + 'another-script.json'), true);
assert.equal(files.has(cleanupRoot + 'backups/' + oldBackup), false);
assert.equal(files.has(cleanupRoot + 'backups/other-app.json.gz'), true);
console.log('过期孤立同步文件回收且保留当前和陌生文件通过');

const newDirectoryConfig = { ...config, url: 'https://dav.example/users/new-directory/' };
const directoryOwner = install(instance(sharedStorage(), 'directory-owner'));
await directoryOwner.WebDavSync.saveConfig(newDirectoryConfig);
await directoryOwner.StorageManager.saveRecord('BV0000000041', record('新目录中的历史'));
await directoryOwner.WebDavSync.sync(true);
assert.notEqual(a.StorageManager._store.epoch, 'initial');
await a.WebDavSync.saveConfig(newDirectoryConfig);
assert.equal((await a.WebDavSync.sync(true)).pendingChoice, true,
    '已有回滚批次的本地历史不能盲目合并到另一个初始批次目录');
assert.equal(a.StorageManager.getRecord('BV0000000041'), null);
await a.WebDavSync.resolveChoice('cloud');
assert.equal(a.StorageManager.getRecord('BV0000000041')?.title, '新目录中的历史');
await a.StorageManager._store.compact();
assert.equal(a.StorageManager.getRecord('BV0000000041')?.title, '新目录中的历史');
assert.equal(a.StorageManager.getRecord('BV0000000001'), null);
const restartedDirectory = install(instance(a.shared, 'restarted-directory'));
await restartedDirectory.StorageManager.initialize();
assert.equal(restartedDirectory.StorageManager.getRecord('BV0000000041')?.title, '新目录中的历史');
assert.equal(restartedDirectory.StorageManager.getRecord('BV0000000001'), null);
console.log('切换到不同批次的 WebDAV 目录时先选择记录来源通过');

const uninitializedConfig = { ...config, url: 'https://dav.example/users/uninitialized/' };
const uninitialized = install(instance(sharedStorage(), 'uninitialized'));
await uninitialized.WebDavSync.saveConfig(uninitializedConfig);
const uninitializedList = uninitialized.WebDavClient.prototype.list;
uninitialized.WebDavClient.prototype.list = async function (path) {
    if (path === 'backups/') { const error = new Error('HTTP 409'); error.status = 409; throw error; }
    return uninitializedList.call(this, path);
};
assert.equal((await uninitialized.WebDavSync.backups()).length, 0,
    '首次同步前目录未创建时，备份列表应显示为空');
const uninitializedRoot = new uninitialized.WebDavClient(uninitializedConfig).root;
files.set(uninitializedRoot + 'state.json', { ...goodIndex });
await assert.rejects(() => uninitialized.WebDavSync.backups(), /HTTP 409/,
    '已有索引却无法列举备份目录时，应保留真实错误');
console.log('未初始化目录的 409 显示为空，实际备份目录错误仍反馈通过');
