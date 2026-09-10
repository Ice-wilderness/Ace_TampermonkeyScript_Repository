import fs from 'node:fs';
import vm from 'node:vm';
export const scriptPath = new URL('../../scripts/Discuz 论坛帖子已读标记与图片预览.js', import.meta.url);
export const source = () => fs.readFileSync(scriptPath, 'utf8');
export function instrument(text = source()) {
    const marker = '    // --- 初始化流程 ---';
    if (!text.includes(marker)) throw new Error('缺少受控启动边界');
    const names = [
        'PageAdapter',
        'HistoryStore',
        'PreviewCache',
        'RequestScheduler',
        'PreviewController',
        'parseImport',
        'readSettings',
        'getThreadListWidthConfig',
        'getThreadListWidthSitePolicy',
        'getThreadListWidthCssValue',
        'getAutoPreviewLimit',
        'getAutoPreviewConcurrent',
        'canFetchExtraPages',
        'buildThreadPageUrl',
        'requestPage',
        'requestImage',
    ];
    return (
        text.slice(0, text.indexOf(marker)) +
        '\n globalThis.testAPI = {' +
        names.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',') +
        `,
        configure(v){ if(v.settings)settings={...settings,...v.settings};if(v.history)history=v.history;if(v.pageQueue)pageQueue=v.pageQueue;if(v.imageQueue)imageQueue=v.imageQueue;if(v.previewCache)previewCache=v.previewCache; }
    };\n})();`
    );
}
export function memory() {
    const data = new Map(),
        calls = [];
    return {
        data,
        calls,
        before: null,
        api() {
            const run = (type, k, v) => {
                this.before?.(type, k, v);
                calls.push({ type, k });
                if (type === 'get') return structuredClone(data.has(k) ? data.get(k) : v);
                if (type === 'set') {
                    data.set(k, structuredClone(v));
                    return;
                }
                if (type === 'delete') {
                    data.delete(k);
                    return;
                }
                return [...data.keys()];
            };
            return {
                GM_getValue: (k, d) => run('get', k, d),
                GM_setValue: (k, v) => run('set', k, v),
                GM_deleteValue: (k) => run('delete', k),
                GM_listValues: () => run('list'),
            };
        },
    };
}
export function instance(shared = memory(), href = 'https://forum.example/forum.php?mod=forumdisplay&fid=1') {
    const location = new URL(href);
    const storage = new Map();
    const document = {
        title: '阅读论坛 - Powered by Discuz!',
        hidden: false,
        querySelectorAll: () => [],
        querySelector: () => null,
        documentElement: { dataset: {} },
        body: { classList: { add() {}, remove() {} } },
        addEventListener() {},
    };
    const context = {
        ...shared.api(),
        document,
        location,
        window: { location },
        console,
        URL,
        URLSearchParams,
        AbortController,
        DOMException,
        TextEncoder,
        structuredClone,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        crypto: globalThis.crypto,
        Date,
        fetch: globalThis.fetch,
        GM_addStyle() {},
        GM_registerMenuCommand() {},
        sessionStorage: {
            get length() {
                return storage.size;
            },
            key: (i) => [...storage.keys()][i],
            getItem: (k) => storage.get(k) || null,
            setItem: (k, v) => storage.set(k, String(v)),
            removeItem: (k) => storage.delete(k),
        },
    };
    vm.createContext(context);
    vm.runInContext(instrument(), context);
    return { ...context.testAPI, context, shared };
}
