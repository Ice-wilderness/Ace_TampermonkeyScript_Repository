import assert from 'node:assert/strict';
import { instance, sharedStorage, source } from './harness.mjs';
import { records } from './fixtures.mjs';

// 对比同一协议、同一数据和扩展延迟，唯一差异为只读并发度。
const seed = sharedStorage(), writer = instance(seed);
await writer.StorageManager.initialize();
await writer.StorageManager.importRecords(records(1000));
for (let shard = 0; shard < 64; shard++) seed.data.set(`bvh_shard_${shard}`, {});
const measurements = {};
for (const concurrent of [false, true]) {
    const shared = sharedStorage();
    for (const [key, value] of seed.data) shared.data.set(key, structuredClone(value));
    let active = 0, peak = 0;
    shared.before = async ({ name }) => {
        if (name !== 'getValue') return;
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 8)); active--;
    };
    const code = concurrent ? source : source.replace('offset += 4', 'offset += 1').replace('offset + 4).map(read)', 'offset + 1).map(read)');
    assert(concurrent || code !== source);
    const app = instance(shared, 'www', code), started = performance.now();
    await app.StorageManager.initialize();
    assert.equal(app.StorageManager.getAllKeys().length, 1000);
    measurements[concurrent ? 'bounded' : 'serial'] = { ms: +(performance.now() - started).toFixed(1), peak, calls: shared.calls.length };
}
assert(measurements.bounded.ms < measurements.serial.ms * 0.65);
assert(measurements.bounded.peak <= 16 && measurements.bounded.peak > 1);
assert.equal(measurements.bounded.calls, measurements.serial.calls);
console.log('通过：模拟扩展读取延迟下初始化提速，记录完整且并发有界', measurements);

const w = instance(); let playerStarted = 0;
w.context.document.readyState = 'complete';
w.context.document.documentElement = {};
w.context.MutationObserver = class { observe() {} disconnect() {} };
const app = new w.AppController();
app.checkAndInitVideoPage = () => { playerStarted++; };
app.deferDomStart();
assert.equal(playerStarted, 1, '播放器仍等待头部出现或稳定');
assert.equal(app._domStarted, false, '提前启动不应同时扫描卡片');
console.log('通过：DOM 就绪即启动播放器，头部与卡片扫描继续延后');

const boot = instance(); const panels = [];
boot.UIComponent.showViewPanel = record => panels.push(record.status);
let releaseRead, releaseRestore, domStarted = false;
const readGate = new Promise(resolve => { releaseRead = resolve; });
const restoreGate = new Promise(resolve => { releaseRestore = resolve; });
boot.StorageManager.initializeForKeys = () => readGate;
boot.StorageManager.restoreFromLocalStorage = () => restoreGate;
boot.StorageManager.cleanupLocalStorageBackups = () => {};
const startup = new boot.AppController();
startup.initMenuCommands = () => {};
startup.deferDomStart = () => { domStarted = true; };
const starting = startup.start();
assert.equal(panels[0], '正在读取历史记录…', '首次读取仍阻塞进度框');
releaseRead(); await starting;
assert(domStarted, '备份恢复仍阻塞页面启动');
releaseRestore();
console.log('通过：历史读取挂起时显示真实等待状态，备份恢复不阻塞页面启动');

const visit = instance(); await visit.StorageManager.initialize();
visit.EpisodeResolver.getCurrentKey = () => 'BV0000000001';
let releaseWrite, status;
visit.UIComponent.showViewPanel = record => { status = record.status; };
visit.StorageManager.saveRecord = () => new Promise(resolve => { releaseWrite = resolve; });
const observer = new visit.VideoPlayerObserver(); observer.bvId = 'BV0000000001';
observer.ensureVisitedRecord();
assert.equal(status, '正在保存访问记录…', '访问提交仍阻塞进度框');
assert.equal(visit.StorageManager.getRecord(observer.bvId), null, '等待状态污染正式记录');
observer.destroy(); releaseWrite();
console.log('通过：访问提交挂起时进度框立即显示，正式记录不暴露未提交数据');
