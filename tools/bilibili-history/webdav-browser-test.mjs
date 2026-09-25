import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { instrument } from './harness.mjs';

const files = new Map(), requests = [];
let serial = 0;
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/preview') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); return;
    }
    const key = url.pathname, current = files.get(key), conditional = key.startsWith('/conditional/');
    requests.push({ method: request.method, key });
    if (request.method === 'MKCOL') {
        response.writeHead(current ? 405 : 201); if (!current) files.set(key, { body: Buffer.alloc(0), time: Date.now(), etag: String(++serial), directory: true });
        response.end(); return;
    }
    if (request.method === 'PUT') {
        if (conditional && (request.headers['if-none-match'] === '*' && current
            || request.headers['if-match'] && request.headers['if-match'] !== `"${current?.etag}"`)) {
            response.writeHead(412); response.end(); return;
        }
        const parts = []; for await (const chunk of request) parts.push(chunk);
        files.set(key, { body: Buffer.concat(parts), time: Date.now(), etag: String(++serial) });
        response.writeHead(current ? 204 : 201); response.end(); return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
        if (!current) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': key.endsWith('.gz') ? 'application/gzip' : 'application/json',
            ...(conditional ? { ETag: `"${current.etag}"` } : {}), 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : current.body); return;
    }
    if (request.method === 'DELETE') { files.delete(key); response.writeHead(204); response.end(); return; }
    if (request.method === 'PROPFIND') {
        const children = [...files].filter(([path]) => path.startsWith(key) && path !== key
            && !path.slice(key.length).replace(/\/$/, '').includes('/'));
        const items = [[key, current], ...children].filter(([, item]) => item).map(([path, item]) =>
            `<d:response><d:href>${escapeXml(path)}</d:href><d:propstat><d:prop><d:getlastmodified>${new Date(item.time).toUTCString()}</d:getlastmodified><d:getcontentlength>${item.body.length}</d:getcontentlength><d:getetag>"${item.etag}"</d:getetag></d:prop></d:propstat></d:response>`).join('');
        response.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items}</d:multistatus>`); return;
    }
    response.writeHead(405); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const bootstrap = `
    const values = new Map();
    window.GM_getValue = (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback;
    window.GM_setValue = (key, value) => values.set(key, structuredClone(value));
    window.GM_deleteValue = key => values.delete(key);
    window.GM_listValues = () => [...values.keys()];
    window.GM = { getValue: async (key, fallback) => GM_getValue(key, fallback),
        setValue: async (key, value) => GM_setValue(key, value), deleteValue: async key => GM_deleteValue(key),
        listValues: async () => GM_listValues() };
    window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    window.GM_addValueChangeListener = () => 1;
    window.GM_removeValueChangeListener = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_info = { script: { version: 'browser-test' } };
    window.unsafeWindow = window;
    window.GM_xmlhttpRequest = options => {
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); options.ontimeout?.(); }, options.timeout);
        fetch(options.url, { method: options.method, body: options.data, headers: options.headers,
            signal: controller.signal, cache: 'no-store' }).then(async result => {
            clearTimeout(timer);
            const body = options.responseType === 'arraybuffer' ? await result.arrayBuffer() : await result.text();
            options.onload?.({ status: result.status, response: body,
                responseHeaders: [...result.headers].map(([key, value]) => key + ': ' + value).join('\\r\\n') });
        }).catch(error => { clearTimeout(timer); if (error.name !== 'AbortError') options.onerror?.(error); });
    };
`;
const createDevice = async () => {
    const page = await browser.newPage();
    await page.goto(origin + '/preview');
    await page.addScriptTag({ content: bootstrap });
    await page.addScriptTag({ content: instrument() });
    return page;
};
const a = await createDevice(), b = await createDevice();
const config = { url: origin + '/compat/', directory: '用户脚本', username: 'user', password: 'password',
    frequency: 'off', backupRetentionDays: 7 };
await a.evaluate(async config => {
    await testAPI.WebDavSync.saveConfig(config);
    await testAPI.StorageManager.saveRecord('BV0000000041', { s: 1, t: '03:00', p: 60, a: 100, n: '真实 HTTP 浏览器测试' });
    await testAPI.WebDavSync.sync(true);
}, config);
const dedicated = '/compat/%E7%94%A8%E6%88%B7%E8%84%9A%E6%9C%AC/bilibili-history/';
const index = JSON.parse(files.get(dedicated + 'state.json').body.toString());
assert.equal(files.get(dedicated + index.file).body.subarray(0, 2).toString('hex'), '1f8b');
assert.ok([...files.keys()].some(key => key.startsWith(dedicated + 'backups/daily-')));
await b.evaluate(async config => { await testAPI.WebDavSync.saveConfig(config); await testAPI.WebDavSync.sync(true); }, config);
assert.equal(await b.evaluate(() => testAPI.StorageManager.getRecord('BV0000000041')?.title), '真实 HTTP 浏览器测试');
const before = requests.length;
await b.evaluate(async () => testAPI.WebDavSync.sync(true));
assert.equal(requests.slice(before).filter(item => item.method === 'GET' && item.key.endsWith('.gz')).length, 0);
await a.evaluate(async () => { await testAPI.StorageManager.deleteRecord('BV0000000041'); await testAPI.WebDavSync.sync(true); });
await b.evaluate(async () => testAPI.WebDavSync.sync(true));
assert.equal(await b.evaluate(() => testAPI.StorageManager.getRecord('BV0000000041')), null);
if (process.env.BVH_BENCH === '1') {
    const result = await a.evaluate(async () => {
        const entries = Array.from({ length: 100000 }, (_, number) => ({
            key: `BV${number.toString(36).padStart(10, '0')}`, version: [1000 + number, 'worker-bench', number],
            deleted: false, record: { s: 1, t: '04:00', p: number % 101, a: 100 + number,
                n: `测试观看历史 ${number}：随机标题与节目内容` }
        }));
        const snapshot = { format: 'bvh-webdav', schemaVersion: 1, snapshotId: crypto.randomUUID(),
            epoch: 'initial', revision: 1, minSyncRevision: 0, createdAt: new Date().toISOString(),
            kind: 'latest', backupRetentionDays: 7, entries };
        let maxLag = 0, prior = performance.now(), maxTask = 0;
        const ticker = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - prior - 16); prior = now; }, 16);
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) maxTask = Math.max(maxTask, entry.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
        const before = performance.memory?.usedJSHeapSize || 0, start = performance.now();
        const zipped = await testAPI.WebDavWorker.encode(snapshot), zippedBytes = zipped.byteLength;
        const compressedAt = performance.now();
        const decoded = await testAPI.WebDavWorker.decode(zipped, snapshot.snapshotId);
        const finishedAt = performance.now(), after = performance.memory?.usedJSHeapSize || 0;
        clearInterval(ticker); observer.disconnect();
        return { count: decoded.entries.length, zippedBytes, compressMs: Math.round(compressedAt - start),
            decodeMs: Math.round(finishedAt - compressedAt), maxLag: Math.round(maxLag),
            maxTask: Math.round(maxTask), before, after };
    });
    assert.equal(result.count, 100000);
    console.log('浏览器 10 万条 Worker 测量', result);
}
if (process.env.BVH_BENCH === 'full') {
    const device = await createDevice();
    const full = await device.evaluate(async ({ config, suppressCompaction }) => {
        await testAPI.WebDavSync.saveConfig(config);
        const shards = new Map();
        for (let number = 0; number < 100000; number++) {
            const key = `BV${number.toString(36).padStart(10, '0')}`;
            const shard = testAPI.StorageManager._getShardId(key);
            if (!shards.has(shard)) shards.set(shard, {});
            shards.get(shard)[key] = { s: 1, t: '04:00', p: number % 101, a: 100 + number,
                n: `测试观看历史 ${number}：节目内容与观看进度` };
        }
        for (const [shard, rows] of shards) GM_setValue(`bvh_shard_${shard}`, rows);
        await testAPI.StorageManager.initialize();
        if (suppressCompaction) {
            clearTimeout(testAPI.StorageManager._compactionTimer);
            testAPI.StorageManager._compactionTimer = -1;
        }
        const markers = [];
        const wrap = (object, name) => {
            const original = object[name];
            object[name] = async function (...args) {
                const began = performance.now();
                try { return await original.apply(this, args); }
                finally { markers.push({ name, begin: Math.round(began), end: Math.round(performance.now()) }); }
            };
        };
        wrap(testAPI.StorageManager, '_maintainHistory');
        wrap(testAPI.StorageManager, '_persistBaseIndex');
        wrap(testAPI.StorageManager, 'getCloudEntries');
        wrap(testAPI.HistoryCommitStore.prototype, 'compact');
        wrap(testAPI.WebDavSync, 'synchronize');
        wrap(testAPI.WebDavSync, 'maintain');
        let maxLag = 0, prior = performance.now(), maxTask = 0, tasks = [];
        const ticker = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - prior - 16); prior = now; }, 16);
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.startTime < start) continue;
                maxTask = Math.max(maxTask, entry.duration);
                if (entry.duration >= 50) tasks.push({ at: Math.round(entry.startTime - start), ms: Math.round(entry.duration) });
            }
        });
        observer.observe({ entryTypes: ['longtask'] });
        const start = performance.now();
        const sync = testAPI.WebDavSync.sync(true);
        const playback = new Promise((resolve, reject) => setTimeout(() => {
            const began = performance.now();
            testAPI.StorageManager.saveRecord('BVZZZZZZZZZZ', { s: 1, t: '00:30', p: 10, a: 100,
                n: '同步期间的观看保存' }).then(() => resolve(Math.round(performance.now() - began)), reject);
        }, 50));
        const [result, saveMs] = await Promise.all([sync, playback]);
        const syncMs = Math.round(performance.now() - start);
        await testAPI.WebDavSync.sync(true);
        clearInterval(ticker); observer.disconnect();
        return { changed: result.changed, syncMs, saveMs, maxLag: Math.round(maxLag), maxTask: Math.round(maxTask),
            tasks: tasks.slice(0, 20), segmentMax: Math.round(testAPI.HistoryQueries.metrics.maxSegment || 0),
            markers: markers.map(marker => ({ ...marker, begin: marker.begin - Math.round(start),
                end: marker.end - Math.round(start) })).slice(0, 30),
            localCount: (await testAPI.StorageManager.getCloudEntries()).length };
    }, { config: { ...config, url: origin + '/bench/', directory: 'history' },
        suppressCompaction: process.env.BVH_NO_COMPACTION === '1' });
    assert.equal(full.localCount, 100001);
    console.log('浏览器 10 万条完整同步与并发播放保存', full);
    await device.close();
}
await a.close(); await b.close(); await browser.close();
await new Promise(resolve => server.close(resolve));
console.log('浏览器原生 Worker、gzip、HTTP WebDAV、隔离设备删除传播及专用目录通过');
