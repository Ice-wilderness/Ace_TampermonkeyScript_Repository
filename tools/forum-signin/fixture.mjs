import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const scriptPath = new URL('../../scripts/自用论坛辅助签到自写.js', import.meta.url);
export const source = await readFile(scriptPath, 'utf8');
const storageBuses = new WeakMap();

export async function createFixture(options = {}) {
    const storage = options.storage || new Map();
    const queries = new Map();
    const timers = new Map();
    const listeners = new Map();
    const sessions = new Map();
    const events = new Map();
    const tabs = [];
    if (!storageBuses.has(storage)) storageBuses.set(storage, new Set());
    storageBuses.get(storage).add(listeners);
    let now = new Date('2026-10-09T12:00:00+08:00').getTime();
    let sequence = 0;
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const timer = (fn, ms, repeat = false) => {
        const id = ++sequence;
        timers.set(id, { fn, at: now + Math.max(1, ms), ms, repeat });
        return id;
    };
    const document = {
        hidden: false, body: { innerText: '', append() {} }, documentElement: { innerHTML: '' },
        getElementById: id => queries.get('#' + id) || null,
        querySelector: selector => queries.get(selector) || null,
        querySelectorAll: selector => queries.get(selector) || [],
        addEventListener: (name, fn) => events.set('document:' + name, fn), removeEventListener() {}
    };
    const context = {
        console: { log() {}, error() {} }, Date: ClockDate, URL, URLSearchParams,
        TextDecoder, Headers, Response, Blob, AbortController, crypto: globalThis.crypto,
        location: { hostname: 'www.limestart.cn', href: 'https://www.limestart.cn/', pathname: '/', search: '' },
        document, history: { replaceState() {} },
        sessionStorage: { getItem: key => sessions.get(key) || null, setItem: (key, val) => sessions.set(key, val), removeItem: key => sessions.delete(key) },
        GM_getValue: (key, fallback) => structuredClone(storage.has(key) ? storage.get(key) : fallback),
        GM_setValue: (key, value) => {
            options.beforeWrite?.(key, value);
            const previous = storage.get(key);
            storage.set(key, structuredClone(value));
            for (const bus of storageBuses.get(storage)) for (const [name, fn] of [...bus.values()]) if (name === key) fn(key, previous, value, bus !== listeners);
        },
        GM_listValues: () => [...storage.keys()].filter(key => !key.startsWith('session:')),
        GM_deleteValue: key => storage.delete(key),
        GM_addValueChangeListener: (name, fn) => { const id = ++sequence; listeners.set(id, [name, fn]); return id; },
        GM_removeValueChangeListener: id => listeners.delete(id),
        GM_addStyle() {}, GM_registerMenuCommand() {},
        GM_openInTab: options.openTab || ((url, details) => { const tab = { url, details, closed: false, close() { this.closed = true; } }; tabs.push(tab); return tab; }),
        GM_xmlhttpRequest: options.request || (() => { throw new Error('禁止真实网络请求'); }),
        fetch: options.fetch || (async () => { throw new Error('禁止真实网络请求'); }),
        setTimeout: (fn, ms) => timer(fn, ms), clearTimeout: id => timers.delete(id),
        setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => timers.delete(id),
        addEventListener: (name, fn) => events.set('window:' + name, fn), removeEventListener() {}, alert() {}, confirm: () => true,
        requestAnimationFrame: fn => timer(fn, 1), MutationObserver: class { observe() {} disconnect() {} }
    };
    context.window = context;
    context.unsafeWindow = context;
    if (options.noListeners) { delete context.GM_addValueChangeListener; delete context.GM_removeValueChangeListener; }
    vm.createContext(context);
    const boundary = source.indexOf('    // ================== 主引擎核心');
    if (boundary < 0) throw new Error('未找到测试隔离边界');
    await vm.runInContext(source.slice(0, boundary) + '\n globalThis.evaluate = value => eval(value);\n})();', context);
    // 站点逻辑回归不需要真实 toast DOM；UI 另由浏览器用例覆盖。
    context.evaluate('showPageSignToast = () => {}; updateDashboardReminderButton = () => {};');
    async function tick(ms) {
        const end = now + ms;
        for (let steps = 0; steps < 10000; steps++) {
            for (let i = 0; i < 40; i++) await Promise.resolve();
            const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            const [id, task] = next;
            now = task.at;
            if (task.repeat) task.at += Math.max(1, task.ms); else timers.delete(id);
            task.fn();
        }
        now = end;
        for (let i = 0; i < 40; i++) await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));
    }
    return { context, storage, sessions, events, tabs, queries, timers, listeners, tick, run: context.evaluate };
}
