import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { epoch } from './fixtures.mjs';

export const scriptPath = new URL('../../scripts/Bilibili视频观看历史记录.js', import.meta.url);
export const source = fs.readFileSync(scriptPath, 'utf8');
export function instrument(text = source) {
    const marker = '    // --- 启动 ---';
    if (!text.includes(marker)) throw new Error('找不到原脚本启动边界，拒绝执行未隔离脚本');
    return text.slice(0, text.indexOf(marker)) + `
    globalThis.testAPI = { StorageManager, VideoKey, VideoPlayerObserver, DOMWatcher, UIComponent,
        EpisodeResolver, HistoryPageSync, SettingsManager, CONFIG, DEFAULT_CONFIG, Utils, injectStyles, AppController,
        ...(typeof HistoryCommitStore === 'undefined' ? {} : { HistoryCommitStore, HistoryStoreIO }),
        ...(typeof HistoryQueries === 'undefined' ? {} : { HistoryQueries, HistoryManagerPanel, WorkbenchLayers }) };
})();`;
}
export function memoryLocalStorage() {
    const data = new Map();
    return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
        getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
export function sharedStorage() {
    const data = new Map(), calls = [], listeners = new Map();
    let serial = 0;
    const shared = { data, calls, before: null, dropSignals: false,
        api(owner) {
            const run = (type, k, value) => {
                calls.push({ owner, type, key: k });
                if (type === 'get') return structuredClone(data.has(k) ? data.get(k) : value);
                if (type === 'list') return [...data.keys()];
                if (type === 'delete') { data.delete(k); return; }
                const old = data.get(k); data.set(k, structuredClone(value));
                if (!shared.dropSignals) for (const l of listeners.values()) if (l.key === k)
                    queueMicrotask(() => l.fn(k, structuredClone(old), structuredClone(value), l.owner !== owner));
            };
            const sync = { getValue: (k, d) => run('get', k, d), setValue: (k, v) => run('set', k, v),
                deleteValue: k => run('delete', k), listValues: () => run('list') };
            const async = {};
            for (const [name, fn] of Object.entries(sync)) async[name] = async (...args) => {
                await shared.before?.({ owner, name, args }); return fn(...args);
            };
            return { GM: async, GM_getValue: sync.getValue, GM_setValue: sync.setValue,
                GM_deleteValue: sync.deleteValue, GM_listValues: sync.listValues,
                GM_addValueChangeListener: (key, fn) => { const id = ++serial; listeners.set(id, { owner, key, fn }); return id; },
                GM_removeValueChangeListener: id => listeners.delete(id) };
        }
    };
    return shared;
}
export function instance(shared = sharedStorage(), owner = 'www', text = source) {
    const timers = new Map(); let serial = 0;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; } }
    const window = { addEventListener() {}, removeEventListener() {} };
    const context = vm.createContext({ ...shared.api(owner), console, URL, crypto: webcrypto, Date: Clock,
        performance, structuredClone, TextEncoder, queueMicrotask, window, unsafeWindow: window,
        location: { href: `https://${owner}.bilibili.com/video/BV0000000001` },
        document: { title: '合成页面', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
        localStorage: memoryLocalStorage(), sessionStorage: memoryLocalStorage(),
        setTimeout: (fn, ms) => { if (!ms) return setTimeout(fn, 0); const id = ++serial; timers.set(id, fn); return id; }, clearTimeout: id => typeof id === 'number' ? timers.delete(id) : clearTimeout(id),
        setInterval: fn => { const id = ++serial; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
        GM_addStyle() {}, GM_registerMenuCommand() {}, GM_info: { script: { version: 'test' } }
    });
    vm.runInContext(instrument(text), context, { filename: scriptPath.pathname });
    const api = context.testAPI;
    // 日志与 UI 输出不是本层断言对象，避免夹具触发浏览器外部能力。
    for (const name of ['log', 'warn', 'error', 'logSlow', 'logEvery']) api.Utils[name] = () => {};
    api.Utils.debugTime = () => () => {};
    return { ...api, context, shared, timers, flushTimers() {
        const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
    } };
}
