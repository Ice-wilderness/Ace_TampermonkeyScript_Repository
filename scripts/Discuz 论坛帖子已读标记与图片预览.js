// ==UserScript==
// @name              Discuz 论坛帖子已读标记与图片预览
// @name:en           Discuz Visited Thread Marker with Image Preview
// @namespace         http://tampermonkey.net/
// @version           5.0.0
// @description       自动记录并标记 Discuz! 论坛中已访问过的帖子，支持列表页静默并发图片预览、可选后续分页抓取、已读样式配置、帖子列表宽度控制和可拖动设置入口。
// @description:en    Marks visited threads in Discuz! forum lists, with silent concurrent image previews, optional extra-page fetching, configurable visited styles, thread list width control, and a draggable settings entry.
// @author            Ice_wilderness
// @match             *://*/*forum.php?mod=forumdisplay*
// @match             *://*/*forum.php?mod=viewthread*
// @match             *://*/*forum-*-*.html
// @match             *://*/*thread-*-*.html
// @grant             GM_setValue
// @grant             GM_listValues
// @grant             GM_getValue
// @grant             GM_deleteValue
// @grant             GM_registerMenuCommand
// @grant             GM_addStyle
// @run-at            document-end
// @license           MIT
// @downloadURL https://update.greasyfork.org/scripts/574710/Discuz%20%E8%AE%BA%E5%9D%9B%E5%B8%96%E5%AD%90%E5%B7%B2%E8%AF%BB%E6%A0%87%E8%AE%B0%E4%B8%8E%E5%9B%BE%E7%89%87%E9%A2%84%E8%A7%88.user.js
// @updateURL https://update.greasyfork.org/scripts/574710/Discuz%20%E8%AE%BA%E5%9D%9B%E5%B8%96%E5%AD%90%E5%B7%B2%E8%AF%BB%E6%A0%87%E8%AE%B0%E4%B8%8E%E5%9B%BE%E7%89%87%E9%A2%84%E8%A7%88.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const uid = () => crypto.randomUUID();
    const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validTid = (value) => /^[1-9]\d*$/.test(value);
    const hostName = window.location.hostname.replace(/[^a-zA-Z0-9]/g, '_'); // 兼容既有宽度配置键
    const VISITED_STYLE_MODES = ['default', 'opacity', 'strike', 'opacity-strike', 'color', 'hidden'];
    const DEFAULT_MIN_DIMENSION = 200,
        DEFAULT_AUTO_PREVIEW_LIMIT = 5,
        DEFAULT_AUTO_PREVIEW_CONCURRENT = 1;
    const DEFAULT_THREAD_LIST_WIDTH_SELECTOR = '.wp',
        DEFAULT_THREAD_LIST_WIDTH_MODE = 'percent';
    const THREAD_LIST_WIDTH_SETTING_KEYS = {
        enabled: 'thread_list_width_enabled',
        selector: 'thread_list_width_selector',
        mode: 'thread_list_width_mode',
        value: 'thread_list_width_value',
    };
    const THREAD_LIST_WIDTH_MODES = ['percent', 'pixel'],
        DEFAULT_THREAD_LIST_WIDTH_SITE_POLICY = 'default';
    const THREAD_LIST_WIDTH_SITE_POLICIES = ['default', 'site', 'disabled'];
    const THREAD_LIST_WIDTH_VALUE_LIMITS = {
        percent: { default: 80, min: 50, max: 100 },
        pixel: { default: 1400, min: 800, max: 3840 },
    };
    const THREAD_LIST_WIDTH_SITE_POLICY_KEY = `thread_list_width_site_policy_${hostName}`;
    const THREAD_LIST_WIDTH_LEGACY_SITE_OVERRIDE_KEY = `thread_list_width_site_override_${hostName}`;
    function getNumberSetting(key, defaultValue, min, max) {
        const value = Number(GM_getValue(key, defaultValue));
        if (!Number.isFinite(value)) return defaultValue;
        return Math.min(max, Math.max(min, Math.round(value)));
    }

    const CONFIG_DEFS = {
        preview_min_dimension: { default: DEFAULT_MIN_DIMENSION, min: 1, max: 2000 },
        auto_preview_limit: { default: DEFAULT_AUTO_PREVIEW_LIMIT, min: 1, max: 20 },
        auto_preview_concurrent: { default: DEFAULT_AUTO_PREVIEW_CONCURRENT, min: 1, max: 5 },
    };

    function getConfig(key) {
        const def = CONFIG_DEFS[key];
        if (!def) return undefined;
        return getNumberSetting(key, def.default, def.min, def.max);
    }

    // 旧 wrapper 保留，内部委托给 getConfig，实现平滑过渡
    function getMinDimension() {
        return getConfig('preview_min_dimension');
    }
    function getAutoPreviewLimit() {
        return getConfig('auto_preview_limit');
    }
    function getAutoPreviewConcurrent() {
        return getConfig('auto_preview_concurrent');
    }

    function canFetchExtraPages() {
        return GM_getValue('enable_extra_page_preview', false);
    }

    function getVisitedStyleMode() {
        const mode = GM_getValue('visited_style_mode', 'default');
        return VISITED_STYLE_MODES.includes(mode) ? mode : 'default';
    }

    function getThreadListWidthSettingKey(name, scope = 'default') {
        const key = THREAD_LIST_WIDTH_SETTING_KEYS[name];
        return scope === 'site' ? `${key}_${hostName}` : key;
    }

    function getThreadListWidthSitePolicy() {
        const policy = GM_getValue(THREAD_LIST_WIDTH_SITE_POLICY_KEY, null);
        if (THREAD_LIST_WIDTH_SITE_POLICIES.includes(policy)) return policy;
        return GM_getValue(THREAD_LIST_WIDTH_LEGACY_SITE_OVERRIDE_KEY, false) === true
            ? 'site'
            : DEFAULT_THREAD_LIST_WIDTH_SITE_POLICY;
    }

    function saveThreadListWidthSitePolicy(policy) {
        GM_setValue(
            THREAD_LIST_WIDTH_SITE_POLICY_KEY,
            THREAD_LIST_WIDTH_SITE_POLICIES.includes(policy) ? policy : DEFAULT_THREAD_LIST_WIDTH_SITE_POLICY,
        );
    }

    function normalizeThreadListWidthMode(mode) {
        return THREAD_LIST_WIDTH_MODES.includes(mode) ? mode : DEFAULT_THREAD_LIST_WIDTH_MODE;
    }

    function getThreadListWidthValueLimits(mode) {
        return (
            THREAD_LIST_WIDTH_VALUE_LIMITS[normalizeThreadListWidthMode(mode)] ||
            THREAD_LIST_WIDTH_VALUE_LIMITS[DEFAULT_THREAD_LIST_WIDTH_MODE]
        );
    }

    function normalizeThreadListWidthValue(value, mode) {
        const limits = getThreadListWidthValueLimits(mode);
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) return limits.default;
        return Math.min(limits.max, Math.max(limits.min, Math.round(numberValue)));
    }

    function readThreadListWidthConfig(scope, fallback = {}) {
        const fallbackMode = normalizeThreadListWidthMode(fallback.mode || DEFAULT_THREAD_LIST_WIDTH_MODE);
        const mode = normalizeThreadListWidthMode(
            GM_getValue(getThreadListWidthSettingKey('mode', scope), fallbackMode),
        );
        const limits = getThreadListWidthValueLimits(mode);
        const fallbackValue = fallback.value !== undefined ? fallback.value : limits.default;
        const selector = String(
            GM_getValue(
                getThreadListWidthSettingKey('selector', scope),
                fallback.selector || DEFAULT_THREAD_LIST_WIDTH_SELECTOR,
            ) || '',
        ).trim();

        return {
            enabled: GM_getValue(getThreadListWidthSettingKey('enabled', scope), fallback.enabled === true) === true,
            selector: selector || DEFAULT_THREAD_LIST_WIDTH_SELECTOR,
            mode,
            value: normalizeThreadListWidthValue(
                GM_getValue(getThreadListWidthSettingKey('value', scope), fallbackValue),
                mode,
            ),
        };
    }

    function getThreadListWidthConfig(scope = 'effective') {
        const defaultConfig = readThreadListWidthConfig('default');
        if (scope === 'default') return defaultConfig;
        const siteConfig = readThreadListWidthConfig('site', defaultConfig);
        if (scope === 'site') return siteConfig;
        const sitePolicy = getThreadListWidthSitePolicy();
        if (sitePolicy === 'disabled') return { ...defaultConfig, enabled: false };
        if (sitePolicy === 'site') return { ...siteConfig, enabled: true };
        return defaultConfig;
    }

    function saveThreadListWidthConfig(scope, config) {
        const mode = normalizeThreadListWidthMode(config.mode);
        GM_setValue(getThreadListWidthSettingKey('enabled', scope), config.enabled === true);
        GM_setValue(
            getThreadListWidthSettingKey('selector', scope),
            (config.selector || '').trim() || DEFAULT_THREAD_LIST_WIDTH_SELECTOR,
        );
        GM_setValue(getThreadListWidthSettingKey('mode', scope), mode);
        GM_setValue(getThreadListWidthSettingKey('value', scope), normalizeThreadListWidthValue(config.value, mode));
    }

    function isThreadListWidthEnabled() {
        return getThreadListWidthConfig().enabled;
    }

    function getThreadListWidthSelector() {
        return getThreadListWidthConfig().selector;
    }

    function getThreadListWidthCssValue() {
        const { mode, value } = getThreadListWidthConfig();
        return mode === 'pixel' ? `${value}px` : `${value}%`;
    }

    function readSettings() {
        return {
            theme: ['system', 'light', 'dark'].includes(GM_getValue('dh_theme')) ? GM_getValue('dh_theme') : 'system',
            style: getVisitedStyleMode(),
            preview: GM_getValue('enable_preview', true) === true,
            auto: GM_getValue('enable_auto_preview', true) === true,
            extra: canFetchExtraPages(),
            limit: getAutoPreviewLimit(),
            concurrent: getAutoPreviewConcurrent(),
            min: getMinDimension(),
        };
    }

    class PreviewError extends Error {
        constructor(kind, message, extra = {}) {
            super(message);
            this.kind = kind;
            Object.assign(this, extra);
        }
    }
    const canceled = () => new PreviewError('cancel', '操作已取消');
    const PageAdapter = {
        path(url) {
            return url.pathname.match(/^(.*\/)(?:forum\.php|(?:thread|forum)-\d+.*\.html)$/i)?.[1] || null;
        },
        site(url = new URL(window.location.href)) {
            return `${url.hostname}${url.port ? `:${url.port}` : ''}${this.path(url) || url.pathname.replace(/[^/]*$/, '')}`;
        },
        tid(url) {
            try {
                const u = new URL(url, window.location.href);
                const tid = u.searchParams.get('tid') || u.pathname.match(/thread-(\d+)-/)?.[1];
                return validTid(tid) ? tid : null;
            } catch {
                return null;
            }
        },
        type(url = new URL(window.location.href)) {
            if (url.searchParams.get('mod') === 'forumdisplay' || /\/forum-\d+-\d+\.html$/i.test(url.pathname))
                return 'list';
            if (url.searchParams.get('mod') === 'viewthread' || /\/thread-\d+-/.test(url.pathname)) return 'detail';
            return 'other';
        },
        page(url, page) {
            const u = new URL(url, window.location.href);
            if (/thread-\d+-\d+(?:-\d+)?\.html$/i.test(u.pathname))
                u.pathname = u.pathname.replace(/(thread-\d+-)\d+((?:-\d+)?\.html)$/i, `$1${page}$2`);
            else u.searchParams.set('page', String(page));
            u.hash = '';
            return u.href;
        },
        parse(doc, url) {
            const message = doc.querySelector('#messagetext, .alert_error, #ct .alert_info')?.textContent || '';
            const primary = [...doc.querySelectorAll('.t_f')];
            const areas = primary.length ? primary : [...doc.querySelectorAll('.t_fsz')];
            // 已有正文时，“积分 / 购买”等附件提示不表示整帖被拒绝访问。
            if (
                !areas.length &&
                (/验证|captcha|安全检查|人机/i.test(message) || doc.querySelector('form[action*="challenge"]'))
            )
                throw new PreviewError('challenge', '需要先在帖子页完成验证');
            if (!areas.length && /登录|权限|无权|购买|积分|不存在|删除/.test(message))
                throw new PreviewError('auth', '帖子暂不可访问，请打开原帖查看');
            if (!areas.length && doc.querySelector('#loginform, form input[name="password"]'))
                throw new PreviewError('auth', '需要登录后查看帖子');
            if (!areas.length && doc.querySelector('#challenge-running, #challenge-form'))
                throw new PreviewError('challenge', '需要先在帖子页完成验证');
            if (!areas.length) throw new PreviewError('unrecognized', '无法识别帖子正文，请打开原帖查看');
            const images = new Set();
            for (const area of areas)
                for (const img of area.querySelectorAll('img')) {
                    const raw = ['zoomfile', 'file', 'data-original', 'data-src', 'data-lazy-src', 'src']
                        .map((a) => img.getAttribute(a))
                        .find(Boolean);
                    if (!raw || /smilie|clear\.gif|none\.gif|avatar|loading/i.test(raw)) continue;
                    try {
                        const src = new URL(raw, url);
                        if (/^https?:$/.test(src.protocol)) images.add(src.href);
                    } catch {
                        /* 跳过损坏地址 */
                    }
                }
            let max = 1;
            for (const node of doc.querySelectorAll('.pg a, .pg strong')) {
                const label = (node.textContent || '').trim();
                if (/^\d+$/.test(label)) max = Math.max(max, Number(label));
                const href = node.getAttribute('href') || '';
                const m = href.match(/[?&]page=(\d+)/) || href.match(/thread-\d+-(\d+)/);
                if (m) max = Math.max(max, Number(m[1]));
            }
            return { images: [...images], maxPage: Math.min(100000, max) };
        },
    };
    function buildThreadPageUrl(url, page) {
        return PageAdapter.page(url, page);
    }

    // --- 足迹存储：字段独立写入；代次切换提交批量操作 ---
    function parseImport(text) {
        if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB');
        const input = JSON.parse(text);
        if (!plain(input)) throw new Error('文件必须是 JSON 对象');
        const modern = Object.hasOwn(input, 'schemaVersion');
        if (modern && (input.schemaVersion !== 1 || typeof input.siteId !== 'string' || !plain(input.records)))
            throw new Error('不支持的数据版本或站点信息');
        const records = modern ? input.records : input,
            normalized = Object.create(null);
        for (const [tid, record] of Object.entries(records)) {
            if (!validTid(tid)) throw new Error(`无效帖子编号：${tid}`);
            if (record === true || record === false) {
                normalized[tid] = { visited: { value: record, ts: 0 }, legacy: true };
                continue;
            }
            if (!plain(record)) throw new Error(`帖子 ${tid} 的记录格式无效`);
            if (Object.keys(record).some((k) => ['__proto__', 'prototype', 'constructor'].includes(k)))
                throw new Error('记录包含不安全字段');
            const ts = record.ts ?? 0;
            if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) throw new Error('更新时间无效');
            const fields = { legacy: !modern };
            for (const field of ['visited', 'viewedImages']) {
                if (!Object.hasOwn(record, field)) continue;
                const v = record[field];
                if (modern) {
                    if (
                        !plain(v) ||
                        typeof v.value !== 'boolean' ||
                        typeof v.ts !== 'number' ||
                        !Number.isFinite(v.ts) ||
                        v.ts < 0
                    )
                        throw new Error('状态字段无效');
                    fields[field] = { value: v.value, ts: v.ts };
                } else {
                    if (typeof v !== 'boolean') throw new Error('旧状态字段无效');
                    fields[field] = { value: v, ts };
                }
            }
            if (!fields.visited && !fields.viewedImages) throw new Error(`帖子 ${tid} 没有有效状态`);
            normalized[tid] = fields;
        }
        return { siteId: modern ? input.siteId : null, records: normalized };
    }
    class HistoryStore {
        constructor(site = PageAdapter.site()) {
            this.site = site;
            this.prefix = `dh_history_v1:${encodeURIComponent(site)}:`;
            this.error = null;
        }
        epoch() {
            return GM_getValue(this.prefix + 'epoch', 'initial');
        }
        key(tid, field, epoch = this.epoch()) {
            return `${this.prefix}${epoch}:${tid}:${field}`;
        }
        read(tid, epoch = this.epoch()) {
            const result = {};
            for (const field of ['visited', 'viewedImages']) {
                const v = GM_getValue(this.key(tid, field, epoch));
                if (plain(v) && typeof v.value === 'boolean' && Number.isFinite(v.ts)) result[field] = v;
            }
            return result;
        }
        all(epoch = this.epoch()) {
            const p = `${this.prefix}${epoch}:`,
                ids = new Set();
            for (const key of GM_listValues()) {
                if (!key.startsWith(p)) continue;
                const tid = key.slice(p.length).split(':')[0];
                if (validTid(tid)) ids.add(tid);
            }
            return Object.fromEntries([...ids].map((tid) => [tid, this.read(tid, epoch)]));
        }
        write(tid, field, value, { epoch = this.epoch(), ts = Date.now() } = {}) {
            if (!validTid(tid) || !['visited', 'viewedImages'].includes(field) || typeof value !== 'boolean')
                throw new Error('无效足迹操作');
            if (epoch !== this.epoch()) return null;
            const next = { value, ts, op: uid() };
            const key = this.key(tid, field, epoch);
            GM_setValue(key, next);
            if (GM_getValue(key)?.op !== next.op) throw new Error('足迹保存未确认，请重试');
            return next;
        }
        // 只向新代次写批量快照，所有字段验证后切换；失败时当前代次不变。
        commit(records, expected = this.epoch()) {
            const before = JSON.stringify(this.all(expected)),
                nextEpoch = uid(),
                staged = [];
            try {
                for (const [tid, record] of Object.entries(records))
                    for (const field of ['visited', 'viewedImages'])
                        if (record[field]) {
                            const key = this.key(tid, field, nextEpoch),
                                value = { ...record[field], op: uid() };
                            staged.push(key);
                            GM_setValue(key, value);
                            if (GM_getValue(key)?.op !== value.op) throw new Error('数据写入未确认，原数据保持可用');
                        }
                if (this.epoch() !== expected || JSON.stringify(this.all(expected)) !== before)
                    throw new Error('数据已在其他页面更改，请重试');
                GM_setValue(this.prefix + 'epoch', nextEpoch);
                if (this.epoch() !== nextEpoch) throw new Error('数据提交失败');
            } catch (error) {
                if (this.epoch() !== nextEpoch)
                    for (const key of staged) {
                        try {
                            GM_deleteValue(key);
                        } catch {}
                    }
                throw error;
            }
            // 保留上一代供恢复；更早的内部代次可回收，升级前的旧脚本数据不动。
            for (const key of GM_listValues())
                if (key.startsWith(this.prefix)) {
                    const tail = key.slice(this.prefix.length),
                        generation = tail.split(':')[0];
                    if (tail.includes(':') && generation !== expected && generation !== nextEpoch) {
                        try {
                            GM_deleteValue(key);
                        } catch {}
                    }
                }
            return nextEpoch;
        }
        export(legacy = false) {
            const records = this.all();
            if (legacy)
                return Object.fromEntries(
                    Object.entries(records).map(([tid, r]) => [
                        tid,
                        {
                            visited: r.visited?.value || false,
                            viewedImages: r.viewedImages?.value || false,
                            ts: Math.max(r.visited?.ts || 0, r.viewedImages?.ts || 0),
                        },
                    ]),
                );
            return { schemaVersion: 1, siteId: this.site, exportedAt: Date.now(), records };
        }
        planImport(input) {
            const epoch = this.epoch(),
                base = this.all(epoch),
                merged = structuredClone(base);
            let added = 0,
                updated = 0,
                skipped = 0;
            for (const [tid, fields] of Object.entries(input.records)) {
                const r = merged[tid] || {};
                let changed = false;
                for (const field of ['visited', 'viewedImages']) {
                    const incoming = fields[field],
                        current = r[field];
                    if (!incoming) continue;
                    if (current && ((fields.legacy && current.value === false) || incoming.ts <= current.ts)) continue;
                    r[field] = incoming;
                    changed = true;
                }
                if (changed) {
                    merged[tid] = r;
                    base[tid] ? updated++ : added++;
                } else skipped++;
            }
            return { epoch, base, merged, added, updated, skipped };
        }
        import(input) {
            const plan = this.planImport(input);
            if (!plan.added && !plan.updated) return plan;
            this.commit(plan.merged, plan.epoch);
            return plan;
        }
        clear() {
            this.commit({});
        }
        reset(tid, field) {
            const epoch = this.epoch(),
                previous = this.read(tid, epoch)[field];
            const next = this.write(tid, field, false, { epoch });
            const until = Date.now() + 5000;
            return () => {
                if (Date.now() > until || this.epoch() !== epoch || this.read(tid, epoch)[field]?.op !== next?.op)
                    return false;
                this.write(tid, field, previous?.value || false, { epoch });
                return true;
            };
        }
        cleanup(days = null) {
            const epoch = this.epoch(),
                all = this.all(epoch),
                entries = Object.entries(all).sort((a, b) => this.time(b[1]) - this.time(a[1]));
            const candidates =
                days === null
                    ? entries.length > 2200
                        ? entries.slice(2000)
                        : []
                    : entries.filter(([, r]) => Date.now() - this.time(r) > days * 86400000);
            if (!candidates.length) return 0;
            const latest = this.all(epoch);
            let removed = 0;
            for (const [tid, old] of candidates)
                if (JSON.stringify(latest[tid]) === JSON.stringify(old)) {
                    delete latest[tid];
                    removed++;
                }
            // 检查从快照到提交期间的变化；有变化则由下次清理处理，不覆盖它。
            if (JSON.stringify(this.all(epoch)) !== JSON.stringify(all)) return 0;
            this.commit(latest, epoch);
            return removed;
        }
        time(r) {
            return Math.max(r.visited?.ts || 0, r.viewedImages?.ts || 0);
        }
        legacyKeys() {
            return GM_listValues().filter((k) => k.startsWith('discuz_visited_threads_'));
        }
        migrate() {
            if (GM_getValue(this.prefix + 'migrated', false)) return;
            // 老键只带损失信息的域名，无法证明子目录归属；留给数据管理显式选择。
            const path = PageAdapter.path(new URL(window.location.href));
            const ambiguous =
                path !== '/' ||
                [...document.querySelectorAll('a[href*="forum.php"]')].some((a) => {
                    try {
                        const u = new URL(a.href);
                        return u.hostname === window.location.hostname && PageAdapter.path(u) !== path;
                    } catch {
                        return false;
                    }
                });
            const keys = this.legacyKeys().filter((k) => k.endsWith('_' + hostName));
            if (ambiguous) return;
            const merged = this.all();
            for (const key of keys) {
                let input;
                try {
                    input = parseImport(GM_getValue(key, '{}'));
                } catch {
                    continue;
                }
                for (const [tid, fields] of Object.entries(input.records))
                    for (const field of ['visited', 'viewedImages'])
                        if (fields[field]) {
                            merged[tid] ??= {};
                            const existing = merged[tid][field];
                            if (!existing) merged[tid][field] = fields[field];
                            else if (!existing.op && fields[field].ts > existing.ts) merged[tid][field] = fields[field];
                        }
            }
            if (keys.length) this.commit(merged);
            GM_setValue(this.prefix + 'migrated', true);
        }
    }

    class PreviewCache {
        constructor(site = PageAdapter.site()) {
            this.prefix = `dh_preview_v2:${encodeURIComponent(site)}:`;
        }
        read(tid, page) {
            try {
                const k = this.prefix + tid,
                    entry = JSON.parse(sessionStorage.getItem(k) || 'null');
                if (!entry) return null;
                for (const [p, v] of Object.entries(entry.pages || {}))
                    if (Date.now() - v.at > 86400000) delete entry.pages[p];
                const value = entry.pages?.[page];
                if (!value) {
                    sessionStorage.setItem(k, JSON.stringify(entry));
                    return null;
                }
                if (
                    !Number.isFinite(value.at) ||
                    !Number.isFinite(value.maxPage) ||
                    !Array.isArray(value.images) ||
                    !value.images.every((s) => typeof s === 'string' && /^https?:\/\//.test(s))
                ) {
                    delete entry.pages[page];
                    sessionStorage.setItem(k, JSON.stringify(entry));
                    return null;
                }
                entry.used = Date.now();
                sessionStorage.setItem(k, JSON.stringify(entry));
                return value;
            } catch {
                return null;
            }
        }
        write(tid, page, value) {
            try {
                const k = this.prefix + tid;
                let entry;
                try {
                    entry = JSON.parse(sessionStorage.getItem(k) || 'null');
                } catch {}
                entry = plain(entry) && plain(entry.pages) ? entry : { pages: {} };
                entry.pages[page] = { ...value, at: Date.now() };
                entry.used = Date.now();
                const items = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key.startsWith(this.prefix) && key !== k) {
                        try {
                            const v = JSON.parse(sessionStorage.getItem(key));
                            items.push({ key, text: JSON.stringify(v), used: v.used || 0 });
                        } catch {
                            items.push({ key, text: '', used: 0 });
                        }
                    }
                }
                const text = JSON.stringify(entry);
                let size = new TextEncoder().encode(text).length;
                if (size > 2 * 1024 * 1024) {
                    sessionStorage.removeItem(k);
                    return;
                }
                items.sort((a, b) => b.used - a.used);
                let count = 1;
                for (const item of items) {
                    size += new TextEncoder().encode(item.text).length;
                    if (count >= 100 || size > 2 * 1024 * 1024 || Date.now() - item.used > 86400000)
                        sessionStorage.removeItem(item.key);
                    else count++;
                }
                sessionStorage.setItem(k, text);
            } catch {
                /* 缓存失效不影响本次结果 */
            }
        }
        clear(tid) {
            try {
                sessionStorage.removeItem(this.prefix + tid);
            } catch {}
        }
    }

    // --- 请求调度与生命周期 ---
    class RequestScheduler {
        constructor(limit, spacing = 0) {
            this.limit = limit;
            this.spacing = spacing;
            this.active = 0;
            this.queue = [];
            this.nextAuto = 0;
            this.pauseUntil = 0;
            this.timer = null;
        }
        enqueue(owner, work, { priority = 0, eligible = () => true, rank = () => 0, onWait = () => {} } = {}) {
            return new Promise((resolve, reject) => {
                this.queue.push({ owner, work, priority, eligible, rank, onWait, resolve, reject });
                this.drain();
            });
        }
        cancel(owner) {
            this.queue = this.queue.filter((t) => {
                if (t.owner !== owner) return true;
                t.reject(canceled());
                return false;
            });
            this.drain();
        }
        drain() {
            clearTimeout(this.timer);
            this.timer = null;
            this.queue.sort((a, b) => b.priority - a.priority || b.rank() - a.rank());
            while (this.active < this.limit()) {
                const now = Date.now();
                const index = this.queue.findIndex(
                    (t) =>
                        t.eligible() &&
                        (!document.hidden || t.priority >= 2) &&
                        now >= this.pauseUntil &&
                        (t.priority > 0 || now >= this.nextAuto),
                );
                if (index < 0) break;
                const t = this.queue.splice(index, 1)[0];
                if (t.priority === 0) this.nextAuto = now + this.spacing;
                this.active++;
                Promise.resolve()
                    .then(t.work)
                    .then(t.resolve, t.reject)
                    .finally(() => {
                        this.active--;
                        this.drain();
                    });
            }
            const now = Date.now();
            this.queue.forEach((t, index) => {
                const message =
                    now < this.pauseUntil
                        ? `服务器限流 · ${Math.ceil((this.pauseUntil - now) / 1000)} 秒后继续`
                        : document.hidden && t.priority < 2
                          ? '页面在后台 · 返回后继续'
                          : !t.eligible()
                            ? '已暂停 · 展开预览或进入图片附近后继续'
                            : `等待读取 · 正在请求 ${this.active} / ${this.limit()} · 队列第 ${index + 1} 项`;
                if (message !== t.waitMessage) {
                    t.waitMessage = message;
                    t.onWait(message);
                }
            });
            if (this.queue.length && !document.hidden) {
                // 间隔恰好到期也必须唤醒；兜底检查布局变化，避免只有滚动才恢复。
                const due = Math.max(this.pauseUntil, this.nextAuto);
                const delay = due > now ? Math.min(1000, Math.max(1, due - now)) : 1000;
                this.timer = setTimeout(() => this.drain(), delay);
            }
        }
    }
    function abortableDelay(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(canceled());
                return;
            }
            const abort = () => {
                clearTimeout(timer);
                reject(canceled());
            };
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', abort);
                resolve();
            }, ms);
            signal.addEventListener('abort', abort, { once: true });
        });
    }
    async function requestPage(url, signal, scheduler, retry = true) {
        for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
            if (signal.aborted) throw canceled();
            const controller = new AbortController();
            let timeout = false;
            const abort = () => controller.abort();
            signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => {
                timeout = true;
                controller.abort();
            }, 15000);
            try {
                const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
                if (response.status === 429) {
                    const value = response.headers.get('Retry-After');
                    const seconds = Number(value);
                    const delay = value
                        ? Number.isFinite(seconds)
                            ? seconds * 1000
                            : Date.parse(value) - Date.now()
                        : 30000;
                    scheduler.pauseUntil = Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 30000);
                    throw new PreviewError('http', '请求较频繁，请稍后重试', { status: 429 });
                }
                if (!response.ok)
                    throw new PreviewError('http', `页面请求失败（${response.status}）`, { status: response.status });
                const text = await response.text();
                if (signal.aborted) throw canceled();
                return PageAdapter.parse(new DOMParser().parseFromString(text, 'text/html'), response.url || url);
            } catch (error) {
                if (signal.aborted) throw canceled();
                const e = timeout
                    ? new PreviewError('timeout', '页面加载超时')
                    : error.kind
                      ? error
                      : new PreviewError('network', '网络请求失败');
                if (retry && attempt === 0 && (e.kind === 'network' || e.kind === 'timeout' || e.status >= 500)) {
                    await abortableDelay(1000, signal);
                    continue;
                }
                throw e;
            } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
            }
        }
    }
    function requestImage(src, signal, onStart = () => {}) {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(canceled());
                return;
            }
            const image = new Image();
            let done = false;
            const finish = (error) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                image.onload = null;
                image.onerror = null;
                if (error) image.src = '';
                error ? reject(error) : resolve(image);
            };
            const abort = () => finish(canceled());
            const timer = setTimeout(() => finish(new PreviewError('timeout', '图片加载超时，点击重试')), 20000);
            signal.addEventListener('abort', abort, { once: true });
            image.onload = () => finish();
            image.onerror = () => finish(new PreviewError('image-failed', '图片加载失败，点击重试'));
            onStart(image);
            image.src = src;
            if (image.complete && image.naturalWidth) finish();
        });
    }

    let settings = readSettings(),
        history,
        previewCache,
        pageQueue,
        imageQueue,
        appearancePreview = null;
    const controllers = new Map();
    let temporaryHideVisited = null;
    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const own = (node) => {
        node.dataset.dhOwned = '';
        return node;
    };
    function button(text, action, cls = 'dh-btn') {
        const b = el('button', cls, text);
        b.type = 'button';
        b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            Promise.resolve()
                .then(() => action(e))
                .catch(report);
        });
        return b;
    }
    function report(error) {
        if (error?.kind === 'cancel') return;
        console.warn('[Discuz Helper]', error);
        toast(error?.message || '操作失败，请重试', null, true);
    }
    let toastTimer;
    function toast(text, action, error = false) {
        document.querySelector('.dh-toast')?.remove();
        clearTimeout(toastTimer);
        const box = own(el('div', `dh-root dh-toast${error ? ' dh-error' : ''}`));
        box.setAttribute('role', error ? 'alert' : 'status');
        box.append(el('span', '', text));
        if (action)
            box.append(
                button('撤销', () => {
                    const ok = action();
                    toast(ok ? '已撤销' : '状态已变化，无法撤销');
                    refreshMarks();
                }),
            );
        document.body.append(box);
        applyTheme();
        toastTimer = setTimeout(() => box.remove(), 5000);
    }
    function visible(node) {
        const r = node.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0;
    }

    // 可视优先级独立于手动优先级，自动任务仍遵守请求间隔。
    function viewportRank(node) {
        const r = node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return -Infinity;
        return r.bottom > 0 && r.top < window.innerHeight ? 1 : -Math.max(0, r.top - window.innerHeight, -r.bottom);
    }

    class PreviewController {
        constructor(thread, title, tid) {
            this.thread = thread;
            this.title = title;
            this.tid = tid;
            this.url = title.href;
            this.disposed = false;
            this.expanded = false;
            this.manual = false;
            this.intent = null;
            this.epoch = history.epoch();
            this.pages = new Map();
            this.images = new Map();
            this.maxPage = 1;
            this.busy = false;
            this.error = null;
            this.failedPage = null;
            this.autoStarted = false;
            this.abort = new AbortController();
            this.imageObserver = null;
            this.safe = false;
            this.autoRecovery = 0;
            this.recoveryTimer = null;
            this.tools = own(el('span', 'dh-root dh-tools'));
            this.badge = el('span', 'dh-badge');
            this.toggle = button('预览图片', () => this.togglePreview(), 'dh-btn dh-preview-toggle');
            const menu = el('details', 'dh-menu'),
                summary = el('summary', '', '更多');
            summary.setAttribute('aria-label', '帖子操作');
            const actions = el('div', 'dh-menu-items');
            actions.append(
                button('恢复未读', () => this.reset('visited')),
                button('清除看图标记', () => this.reset('viewedImages')),
            );
            menu.append(summary, actions);
            this.tools.append(this.badge, this.toggle, menu);
            title.insertAdjacentElement('afterend', this.tools);
            const row = title.closest('tr');
            if (
                thread.tagName === 'TBODY' &&
                row &&
                row.parentElement === thread &&
                !row.querySelector('[rowspan]:not([rowspan="1"])')
            ) {
                this.row = own(el('tr', 'dh-preview-row'));
                const cell = el('td');
                cell.colSpan = [...row.children].reduce((sum, n) => sum + (Number(n.colSpan) || 1), 0);
                this.panel = el('section', 'dh-root dh-preview');
                this.panel.setAttribute('aria-label', `${title.textContent.trim()}的图片预览`);
                this.status = el('p', 'dh-status');
                this.status.setAttribute('role', 'status');
                this.grid = el('div', 'dh-grid');
                this.footer = el('div', 'dh-preview-footer');
                this.more = button('加载更多图片', () => this.loadMore(), 'dh-btn dh-primary');
                this.retry = button('重试失败页', () => this.loadMore(true));
                this.reload = button('重新获取', () => this.reloadPreview(), 'dh-btn dh-quiet');
                this.footer.append(this.more, this.retry, this.reload);
                this.panel.append(this.status, this.grid, this.footer);
                cell.append(this.panel);
                this.row.append(cell);
                thread.append(this.row);
                this.safe = true;
                this.imageObserver = new IntersectionObserver(
                    (entries) => {
                        for (const entry of entries) {
                            const item = [...this.images.values()].find((v) => v.card === entry.target);
                            if (item) item.near = entry.isIntersecting;
                        }
                        imageQueue.drain();
                        this.maybeMark();
                    },
                    { rootMargin: '300px' },
                );
            }
            this.toggle.hidden = !settings.preview || !this.safe;
            this.render();
            thread.dataset.dhThread = tid;
        }
        live() {
            return (
                !this.disposed &&
                this.thread.isConnected &&
                this.thread.id.endsWith('_' + this.tid) &&
                this.title.href === this.url
            );
        }
        count() {
            return [...this.images.values()].filter((i) => i.status === 'ready').length;
        }
        pending() {
            return [...this.images.values()].filter((i) => ['queued', 'loading'].includes(i.status)).length;
        }
        grantIntent(viewing = false) {
            clearTimeout(this.recoveryTimer);
            this.manual = true;
            this.epoch = history.epoch();
            this.intent = viewing ? { epoch: this.epoch, token: uid() } : null;
        }
        maybeMark(force = false) {
            if (
                !force ||
                !this.intent ||
                !this.live() ||
                this.intent.epoch !== history.epoch() ||
                (!force && (!this.expanded || document.hidden))
            )
                return;
            if (!force && ![...this.images.values()].some((i) => i.status === 'ready' && visible(i.card))) return;
            try {
                history.write(this.tid, 'viewedImages', true, { epoch: this.intent.epoch });
                this.intent = null;
                refreshMarks();
            } catch (error) {
                this.intent = null;
                report(error);
            }
        }
        reset(field) {
            this.intent = null;
            const undo = history.reset(this.tid, field);
            toast(field === 'visited' ? '已恢复未读' : '已清除看图标记', undo);
            refreshMarks();
        }
        async auto() {
            if (this.autoStarted || !this.live() || !settings.auto || !settings.preview || !this.safe) return;
            this.autoStarted = true;
            this.expanded = true;
            await this.loadPages(1, 1, false);
        }
        async togglePreview() {
            if (!this.safe) return;
            if (this.expanded) {
                this.expanded = false;
                this.intent = null;
                this.render();
                return;
            }
            this.expanded = true;
            this.grantIntent();
            this.render();
            this.maybeMark();
            pageQueue.drain();
            imageQueue.drain();
            if (!this.pages.size) await this.loadPages(1, settings.extra ? 3 : 1, true);
        }
        async loadMore(retry = false) {
            if (this.busy) return;
            this.expanded = true;
            this.grantIntent();
            this.render();
            this.maybeMark();
            if (retry && this.failedPage) {
                await this.loadPages(this.failedPage, settings.extra ? 3 : 1, true);
                return;
            }
            const first = this.pages.get(1);
            if (first && first.images.some((src) => !this.images.has(src))) {
                this.addImages(first.images);
                this.render();
                return;
            }
            let page = 1;
            while (this.pages.has(page)) page++;
            if (page === 1 || settings.extra) await this.loadPages(page, settings.extra ? 3 : 1, true);
        }
        async loadPages(start, batch, manual) {
            if (this.busy || !this.live() || !this.safe) return;
            this.busy = true;
            this.error = null;
            this.waitMessage = '';
            this.render();
            try {
                for (let page = start; page < start + batch && (page === 1 || page <= this.maxPage); page++) {
                    if (page > 1 && !settings.extra) break;
                    let result = this.pages.get(page) || previewCache.read(this.tid, page);
                    if (!result) {
                        this.readingPage = false;
                        result = await pageQueue.enqueue(
                            this,
                            () => {
                                this.readingPage = true;
                                this.render();
                                return requestPage(
                                    PageAdapter.page(this.url, page),
                                    this.abort.signal,
                                    pageQueue,
                                    manual,
                                );
                            },
                            {
                                priority: manual ? 1 : 0,
                                eligible: () => this.live() && (manual || this.expanded),
                                rank: () => viewportRank(this.title),
                                onWait: (message) => {
                                    this.waitMessage = message;
                                    if (this.live()) this.render();
                                },
                            },
                        );
                    }
                    if (!this.live()) return;
                    this.pages.set(page, result);
                    this.maxPage = result.maxPage;
                    previewCache.write(this.tid, page, result);
                    this.failedPage = null;
                    if (manual) this.addImages(result.images);
                    else this.fillAuto();
                    this.render();
                }
            } catch (error) {
                if (error.kind !== 'cancel' && this.live()) {
                    this.error = error;
                    let p = start;
                    while (this.pages.has(p)) p++;
                    this.failedPage = p;
                    // 自动补试重新排队，等待期间释放名额；整次自动操作最多请求两次。
                    if (
                        !manual &&
                        this.autoRecovery === 0 &&
                        (['network', 'timeout'].includes(error.kind) || error.status >= 500 || error.status === 429)
                    ) {
                        this.autoRecovery++;
                        const delay = Math.max(3000, pageQueue.pauseUntil - Date.now());
                        this.recoveryTimer = setTimeout(
                            () => {
                                if (this.live() && !this.manual && settings.auto) {
                                    this.expanded = true;
                                    this.loadPages(start, batch, false);
                                }
                            },
                            Math.min(delay, 2147483647),
                        );
                    }
                }
            } finally {
                this.busy = false;
                this.readingPage = false;
                if (this.live()) this.render();
            }
        }
        fillAuto() {
            if (this.manual || !this.live()) return;
            const needed = settings.limit - this.count() - this.pending();
            if (needed <= 0) return;
            this.addImages((this.pages.get(1)?.images || []).filter((s) => !this.images.has(s)).slice(0, needed));
        }
        addImages(sources) {
            for (const src of sources) {
                if (this.images.has(src)) continue;
                const card = button(
                    '',
                    () => {
                        const item = this.images.get(src);
                        if (item.status === 'ready') {
                            this.grantIntent(true);
                            openLightbox(this, src, card);
                        } else if (item.status === 'failed') {
                            this.grantIntent();
                            this.loadImage(item);
                        }
                    },
                    'dh-card',
                );
                card.setAttribute('aria-label', '图片正在加载');
                const label = el('span', 'dh-card-label', '等待加载');
                card.append(label);
                const item = { src, status: 'queued', card, label, near: false };
                this.images.set(src, item);
                this.grid.append(card);
                this.imageObserver.observe(card);
                this.loadImage(item);
            }
        }
        loadImage(item) {
            if (item.status === 'loading') return;
            item.status = 'queued';
            item.card.classList.remove('dh-error');
            item.label.textContent = '等待加载';
            imageQueue
                .enqueue(
                    this,
                    async () => {
                        if (!this.live()) throw canceled();
                        item.status = 'loading';
                        item.label.textContent = '加载中…';
                        const img = await requestImage(item.src, this.abort.signal, (loadingImage) => {
                            loadingImage.alt = '';
                            item.card.replaceChildren(loadingImage, item.label);
                        });
                        if (!this.live()) throw canceled();
                        if (img.naturalWidth < settings.min || img.naturalHeight < settings.min) {
                            item.status = 'filtered';
                            item.card.hidden = true;
                            this.imageObserver.unobserve(item.card);
                        } else {
                            item.status = 'ready';
                            img.alt = '帖子预览图片';
                            item.card.replaceChildren(img);
                            item.card.setAttribute('aria-label', '打开图片');
                            this.maybeMark();
                        }
                    },
                    {
                        priority: this.manual ? 1 : 0,
                        eligible: () => this.live() && this.expanded && item.near,
                        rank: () => viewportRank(item.card),
                    },
                )
                .catch((error) => {
                    if (!this.live() || error.kind === 'cancel') return;
                    item.card.replaceChildren(item.label);
                    item.status = 'failed';
                    item.label.textContent = error.message;
                    item.card.classList.add('dh-error');
                    item.card.setAttribute('aria-label', error.message);
                })
                .finally(() => {
                    if (this.live()) {
                        this.fillAuto();
                        this.render();
                    }
                });
        }
        render() {
            if (this.disposed) return;
            if (!this.manual && !this.busy && !this.pending() && !this.count() && (this.pages.size || this.error))
                this.expanded = false;
            if (this.safe) {
                this.row.hidden = !this.expanded || (!this.manual && !this.busy && !this.pending() && !this.count());
                const n = this.count(),
                    failed = [...this.images.values()].filter((i) => i.status === 'failed').length;
                const text = this.error
                    ? `${n ? `已保留 ${n} 张图片。` : ''}${this.error.message}`
                    : this.busy
                      ? this.readingPage
                          ? '正在读取帖子正文…'
                          : this.waitMessage || '等待进入请求队列…'
                      : this.pending()
                        ? `正在呈现图片 · 已显示 ${n} 张`
                        : n
                          ? `已读取 ${this.pages.size} / ${this.maxPage} 页 · ${n} 张图片${failed ? ` · ${failed} 张失败` : ''}`
                          : failed
                            ? '图片加载失败，可点击重试'
                            : this.images.size
                              ? '没有满足尺寸要求的图片'
                              : '该页没有图片';
                this.status.textContent = text;
                this.status.hidden = !this.manual && !this.busy && !this.pending();
                this.status.classList.toggle('dh-error', !!this.error);
                const remaining = (this.pages.get(1)?.images || []).some((s) => !this.images.has(s));
                this.more.hidden = !(remaining || (settings.extra && this.pages.size < this.maxPage));
                this.more.disabled = this.busy;
                this.retry.hidden = !this.error;
                this.retry.disabled = this.busy;
                this.reload.disabled = this.busy;
                this.footer.hidden = !this.manual && this.more.hidden;
            }
            this.toggle.textContent = this.expanded
                ? this.busy && !this.count()
                    ? this.readingPage
                        ? '读取中 · 收起'
                        : '排队中 · 收起'
                    : this.pending() && !this.count()
                      ? '加载中 · 收起'
                      : '收起图片'
                : this.count()
                  ? `预览图片 · ${this.count()}`
                  : this.error
                    ? '查看预览状态'
                    : this.pages.size && !this.pending()
                      ? '查看图片结果'
                      : '预览图片';
            this.toggle.setAttribute('aria-expanded', String(this.expanded));
            this.toggle.title = '展开或收起图片预览';
        }
        reloadPreview() {
            const node = this.thread,
                title = this.title,
                tid = this.tid;
            previewCache.clear(tid);
            this.destroy();
            const fresh = new PreviewController(node, title, tid);
            controllers.set(node, fresh);
            fresh.expanded = true;
            fresh.grantIntent();
            fresh.loadPages(1, settings.extra ? 3 : 1, true);
            applyTheme();
        }
        destroy() {
            if (this.disposed) return;
            this.disposed = true;
            this.intent = null;
            clearTimeout(this.recoveryTimer);
            this.abort.abort();
            pageQueue.cancel(this);
            imageQueue.cancel(this);
            this.imageObserver?.disconnect();
            this.tools.remove();
            this.row?.remove();
            delete this.thread.dataset.dhThread;
            delete this.thread.dataset.dhHidden;
            controllers.delete(this.thread);
        }
    }

    // --- 视觉组件 ---
    function injectStyles() {
        GM_addStyle(`
    .dh-root{--dh-bg:#f7f8f5;--dh-surface:#fff;--dh-ink:#202a2a;--dh-muted:#61716b;--dh-accent:#277c72;--dh-soft:#eaf3ee;--dh-border:#dce5dd;--dh-danger:#b13d37;color:var(--dh-ink);font:14px/1.6 "PingFang SC","Microsoft YaHei",sans-serif;text-align:left;color-scheme:light}
    .dh-root[data-dh-theme="dark"]{--dh-bg:#171d1d;--dh-surface:#222b2a;--dh-ink:#e7eeeb;--dh-muted:#a5b9b0;--dh-accent:#72c8b6;--dh-soft:#2d4039;--dh-border:#40524a;--dh-danger:#ffaaa0;color-scheme:dark}
    .dh-root *{box-sizing:border-box}.dh-root [hidden],.dh-preview-row[hidden]{display:none!important}
    .dh-root button,.dh-root input,.dh-root select{font:inherit}.dh-root button{cursor:pointer}.dh-root button:disabled{opacity:.55;cursor:wait}
    .dh-root :focus-visible{outline:3px solid var(--dh-accent);outline-offset:3px}.dh-root .dh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--dh-border);border-radius:8px;padding:7px 13px;background:var(--dh-surface);color:var(--dh-ink);white-space:normal;line-height:1.5;box-shadow:none;text-decoration:none}
    .dh-root .dh-btn:hover{background:var(--dh-soft);border-color:var(--dh-accent)}.dh-root .dh-primary{background:var(--dh-accent);border-color:var(--dh-accent);color:var(--dh-surface);font-weight:600}.dh-root .dh-primary:hover{filter:brightness(.95);background:var(--dh-accent)}
    .dh-root .dh-quiet{background:transparent;border-color:transparent;color:var(--dh-accent)}.dh-root .dh-danger,.dh-root .dh-error{color:var(--dh-danger)}
    .dh-tools{display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap;margin:6px 0 0 10px;vertical-align:middle}.dh-tools .dh-btn,.dh-tools summary{font-size:13px;padding:4px 10px;font-weight:600}.dh-tools .dh-preview-toggle{color:var(--dh-accent);background:var(--dh-soft);border-color:var(--dh-accent)}.dh-tools .dh-preview-toggle[aria-expanded="true"]{box-shadow:inset 3px 0 var(--dh-accent)}.dh-tools .dh-badge{display:inline-flex;align-items:center;font-size:12px;font-weight:700;padding:3px 8px;border:1px solid;border-radius:5px;white-space:nowrap;color:#174d85;background:#e7f1ff;border-color:#8db4df}.dh-tools .dh-badge[data-state="viewed"]{color:#7b4506;background:#fff2d6;border-color:#d4aa5c}.dh-tools[data-dh-theme="dark"] .dh-badge{color:#b9dbff;background:#243b55;border-color:#688fb8}.dh-tools[data-dh-theme="dark"] .dh-badge[data-state="viewed"]{color:#ffe0a3;background:#49391f;border-color:#a78953}.dh-menu{position:relative}.dh-menu summary{cursor:pointer;list-style:none;color:var(--dh-ink);border:1px solid var(--dh-border);border-radius:8px;background:var(--dh-surface)}.dh-menu-items{position:absolute;z-index:20;right:0;top:100%;padding:6px;width:150px;background:var(--dh-surface);border:1px solid var(--dh-border);border-radius:10px;box-shadow:0 8px 25px #0002}.dh-menu-items .dh-btn{width:100%;justify-content:start}
    .dh-preview-row>td{padding:12px!important;vertical-align:middle!important;border:0!important}.dh-preview{padding:12px;background:var(--dh-bg);border:1px solid var(--dh-border);border-radius:12px;min-width:0;width:100%;max-width:100%;box-sizing:border-box;contain:inline-size}.dh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),190px));gap:8px;max-height:min(340px,45vh);overflow:auto;align-content:start;justify-content:start;overscroll-behavior:contain;min-width:0}
    .dh-root .dh-card{display:flex;position:relative;align-items:center;justify-content:center;width:100%!important;height:142px!important;max-width:190px!important;min-width:0!important;min-height:0!important;overflow:hidden;padding:0!important;border:1px solid var(--dh-border);border-radius:8px;background:var(--dh-surface);color:var(--dh-muted)}.dh-root .dh-card img{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;min-width:0!important;min-height:0!important;object-fit:contain!important;display:block!important;margin:0!important}.dh-card-label{position:relative;z-index:1;padding:6px 10px;font-size:12px;background:var(--dh-surface);border-radius:5px}.dh-card:hover{border-color:var(--dh-accent)}.dh-status{font-size:12px;color:var(--dh-muted);margin:0 0 12px}.dh-preview-footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
    tbody[data-dh-state="visited"][data-dh-style="opacity"] a.xst,tbody[data-dh-state="visited"][data-dh-style="opacity-strike"] a.xst{opacity:.5}
    tbody[data-dh-state="visited"][data-dh-style="strike"] a.xst,tbody[data-dh-state="visited"][data-dh-style="opacity-strike"] a.xst{text-decoration:line-through!important}
    tbody[data-dh-state="visited"][data-dh-style="color"] a.xst{color:#78867b!important}tbody[data-dh-state="visited"][data-dh-style="default"] a.xst{color:#738279!important}
    tbody[data-dh-hidden="true"]{display:none!important}
    .dh-overlay{position:fixed;inset:0;z-index:100000;background:#10201988;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(5px)}
    .dh-dialog{width:min(860px,100%);max-height:90vh;background:var(--dh-surface);border:1px solid var(--dh-border);border-radius:16px;box-shadow:0 25px 90px #0004;display:flex;flex-direction:column;overflow:hidden}
    .dh-dialog-header{display:flex;align-items:start;justify-content:space-between;gap:12px;padding:24px 28px;border-bottom:1px solid var(--dh-border)}.dh-dialog h2{font-size:23px;line-height:1.4;font-weight:650;margin:3px 0;color:var(--dh-ink)}.dh-kicker{font-size:10px;letter-spacing:.18em;color:var(--dh-accent);font-weight:700}.dh-dialog-header p{margin:5px 0 0;font-size:12px;color:var(--dh-muted)}
    .dh-settings-layout{display:grid;grid-template-columns:170px minmax(0,1fr);min-height:320px;overflow:hidden}.dh-nav{display:flex;flex-direction:column;gap:5px;padding:20px 12px;background:var(--dh-bg);border-right:1px solid var(--dh-border)}.dh-root .dh-nav .dh-btn{justify-content:start;padding:10px 14px;background:transparent;border-color:transparent}.dh-root .dh-nav .dh-btn[aria-selected="true"]{background:var(--dh-soft);color:var(--dh-accent);font-weight:650}
    .dh-settings-content{padding:24px 28px;overflow-y:auto;min-width:0}.dh-settings-content h3{font-size:18px;margin:0 0 4px;color:var(--dh-ink)}.dh-hint{color:var(--dh-muted);font-size:12px;line-height:1.8;margin:0 0 20px}.dh-field{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--dh-border)}.dh-field span{font-size:13px}.dh-field input:not([type="checkbox"]),.dh-field select{border:1px solid var(--dh-border);background:var(--dh-bg);color:var(--dh-ink);padding:7px 10px;border-radius:7px;width:170px;max-width:55%;min-width:0}.dh-field input[type="checkbox"]{appearance:auto;width:17px;height:17px;accent-color:var(--dh-accent)}
    .dh-dialog-footer{display:flex;gap:10px;justify-content:end;align-items:center;padding:16px 28px;border-top:1px solid var(--dh-border);background:var(--dh-surface)}.dh-dialog-footer small{margin-right:auto;color:var(--dh-muted);font-size:11px}
    .dh-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.dh-stat{padding:12px;background:var(--dh-bg);border-radius:8px;color:var(--dh-muted);font-size:11px}.dh-stat strong{display:block;font-size:23px;line-height:1.5;color:var(--dh-ink);font-weight:500}.dh-data-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.dh-danger-zone{border-top:1px solid var(--dh-border);padding-top:20px;margin-top:24px}.dh-site-id{overflow-wrap:anywhere;font-size:11px;color:var(--dh-muted)}
    .dh-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100010;max-width:calc(100% - 32px);padding:12px 18px;background:var(--dh-surface);border:1px solid var(--dh-border);border-radius:10px;box-shadow:0 8px 32px #0003;display:flex;align-items:center;gap:16px}
    .dh-floating{position:fixed;right:18px;bottom:86px;z-index:99990;width:46px;height:46px;border-radius:14px!important;box-shadow:0 6px 24px #0002!important;touch-action:none;user-select:none}.dh-floating svg{width:21px;height:21px}
    .dh-lightbox{background:#111b19ed;backdrop-filter:blur(8px);color:#e7eeeb}.dh-lightbox-stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative}.dh-lightbox-stage>img{width:100%;height:calc(100% - 100px);object-fit:contain;cursor:pointer}.dh-lightbox-top{position:absolute;top:5px;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:12px}.dh-lightbox .dh-btn{background:#263b34;color:#e7eeeb;border-color:#506158}.dh-lightbox-prev,.dh-lightbox-next{position:absolute;top:50%;font-size:24px!important}.dh-lightbox-prev{left:0}.dh-lightbox-next{right:0}.dh-lightbox-state{position:absolute;bottom:8px;left:60px;right:60px;text-align:center;font-size:12px}.dh-hidden-toggle{margin:12px 0;display:block}
    @media(max-width:600px){.dh-overlay{padding:10px}.dh-dialog{max-height:94vh;border-radius:12px}.dh-dialog-header{padding:18px}.dh-settings-layout{display:flex;flex-direction:column;min-height:0}.dh-nav{flex-direction:row;flex-wrap:wrap;padding:8px;border-right:0;border-bottom:1px solid var(--dh-border);gap:2px}.dh-root .dh-nav .dh-btn{padding:6px 8px;font-size:12px}.dh-settings-content{padding:18px}.dh-dialog-footer{padding:12px 18px}.dh-dialog-footer small{display:none}.dh-field{gap:8px}.dh-field select{width:145px}.dh-preview{padding:8px}.dh-grid{grid-template-columns:repeat(auto-fill,minmax(min(140px,100%),1fr))}.dh-root .dh-card{max-width:190px!important;height:120px!important}.dh-tools{margin-left:0}.dh-preview-row>td{padding:8px 6px!important}}
    @media(prefers-reduced-motion:no-preference){.dh-root .dh-btn{transition:background .15s,border-color .15s}.dh-dialog{animation:dh-enter .16s ease-out}@keyframes dh-enter{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}}
    `);
    }
    function applyTheme(theme = appearancePreview ?? settings.theme) {
        const resolved =
            theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
        document.querySelectorAll('.dh-root').forEach((n) => (n.dataset.dhTheme = resolved));
    }
    function refreshVisitedVisibility() {
        const hide = temporaryHideVisited ?? settings.style === 'hidden';
        for (const c of controllers.values()) {
            c.thread.dataset.dhHidden = String(hide && c.thread.dataset.dhState === 'visited');
        }
        document.querySelectorAll('.dh-visibility-toggle').forEach((node) => {
            node.textContent = hide ? '临时显示已访问帖子' : '临时隐藏已访问帖子';
            node.setAttribute('aria-pressed', String(hide));
        });
    }
    function visibilityButton() {
        return button(
            '临时显示 / 隐藏已访问帖子',
            () => {
                temporaryHideVisited = !(temporaryHideVisited ?? settings.style === 'hidden');
                refreshVisitedVisibility();
                pageQueue.drain();
                imageQueue.drain();
                const count = [...controllers.values()].filter((c) => c.thread.dataset.dhState === 'visited').length;
                toast(
                    count
                        ? `已临时${temporaryHideVisited ? '隐藏' : '显示'} ${count} 个已访问帖子`
                        : '当前列表没有已访问帖子',
                );
            },
            'dh-btn dh-visibility-toggle',
        );
    }
    function refreshMarks() {
        if (!history) return;
        let data;
        try {
            data = history.all();
        } catch (error) {
            report(error);
            return;
        }
        for (const c of controllers.values()) {
            const r = data[c.tid];
            const state = r?.visited?.value ? 'visited' : r?.viewedImages?.value ? 'viewed' : '';
            c.thread.dataset.dhState = state;
            c.thread.dataset.dhStyle = settings.style;
            c.badge.textContent = state === 'visited' ? '✓ 已访问' : state === 'viewed' ? '▧ 已看图' : '';
            c.badge.dataset.state = state;
            c.badge.hidden = !state;
        }
        refreshVisitedVisibility();
    }
    const dialogStack = [];
    function modal(title, lightbox = false) {
        const opener = document.activeElement,
            overlay = own(el('div', `dh-root dh-overlay${lightbox ? ' dh-lightbox' : ''}`));
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', title);
        overlay.tabIndex = -1;
        const oldOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.body.append(overlay);
        dialogStack.push(overlay);
        let onClose = () => {};
        const close = () => {
            if (!overlay.isConnected) return;
            onClose();
            overlay.remove();
            dialogStack.splice(dialogStack.indexOf(overlay), 1);
            document.body.style.overflow = oldOverflow;
            document.removeEventListener('keydown', keys, true);
            if (opener?.isConnected) opener.focus();
            else document.querySelector('.dh-floating')?.focus();
        };
        const keys = (e) => {
            if (dialogStack.at(-1) !== overlay) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
            if (e.key === 'Tab') {
                const list = [
                    ...overlay.querySelectorAll(
                        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
                    ),
                ].filter((n) => n.getClientRects().length);
                if (!list.length) {
                    e.preventDefault();
                    return;
                }
                if (
                    e.shiftKey &&
                    (document.activeElement === overlay ||
                        document.activeElement === list[0] ||
                        !overlay.contains(document.activeElement))
                ) {
                    e.preventDefault();
                    list.at(-1).focus();
                } else if (
                    !e.shiftKey &&
                    (document.activeElement === overlay ||
                        document.activeElement === list.at(-1) ||
                        !overlay.contains(document.activeElement))
                ) {
                    e.preventDefault();
                    list[0].focus();
                }
            }
        };
        document.addEventListener('keydown', keys, true);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        applyTheme();
        overlay.focus();
        return {
            overlay,
            close,
            set onClose(fn) {
                onClose = fn;
            },
        };
    }
    function openLightbox(controller, src, opener) {
        const items = [...controller.images.values()].filter((i) => i.status === 'ready');
        let index = items.findIndex((i) => i.src === src),
            token = 0,
            abort;
        const box = modal('图片查看器', true),
            stage = el('div', 'dh-lightbox-stage'),
            top = el('div', 'dh-lightbox-top'),
            counter = el('span'),
            status = el('div', 'dh-lightbox-state');
        const image = el('img');
        image.alt = '正在加载图片';
        const owner = {};
        const show = async () => {
            const current = ++token;
            abort?.abort();
            imageQueue.cancel(owner);
            abort = new AbortController();
            status.textContent = '正在加载图片…';
            image.hidden = true;
            counter.textContent = `${index + 1} / ${items.length}`;
            try {
                const result = await imageQueue.enqueue(owner, () => requestImage(items[index].src, abort.signal), {
                    priority: 2,
                });
                if (current !== token || !controller.live()) return;
                image.src = result.src;
                image.alt = `第 ${index + 1} 张图片`;
                image.hidden = false;
                status.textContent = '← → 切换图片 · Esc 关闭';
                controller.maybeMark(true);
            } catch (error) {
                if (current !== token || error.kind === 'cancel') return;
                status.replaceChildren(el('span', '', error.message + ' '), button('重试', show));
            }
        };
        const move = (delta) => {
            index = (index + delta + items.length) % items.length;
            show();
        };
        top.append(counter, button('关闭', box.close));
        stage.append(
            image,
            top,
            button('‹', () => move(-1), 'dh-btn dh-lightbox-prev'),
            button('›', () => move(1), 'dh-btn dh-lightbox-next'),
            status,
        );
        box.overlay.append(stage);
        box.overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                move(e.key === 'ArrowLeft' ? -1 : 1);
            }
        });
        const direction = (e) => (e.clientX < image.getBoundingClientRect().left + image.clientWidth / 2 ? -1 : 1);
        const cursors = [-1, 1].map((d) => {
            const path = d < 0 ? 'M22 9L14 17L22 25' : 'M12 9L20 17L12 25';
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><circle cx="17" cy="17" r="16" fill="#172b26" stroke="white"/><path d="${path}" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 17 17, ${d < 0 ? 'w-resize' : 'e-resize'}`;
        });
        image.style.cursor = cursors[1];
        image.addEventListener('pointermove', (e) => {
            image.style.cursor = cursors[direction(e) < 0 ? 0 : 1];
        });
        image.addEventListener('click', (e) => move(direction(e)));
        box.onClose = () => {
            token++;
            abort?.abort();
            imageQueue.cancel(owner);
            if (opener.isConnected) opener.focus();
        };
        show();
    }

    const widthOriginal = new Map();
    function applyWidth() {
        for (const [node, style] of widthOriginal) {
            if (node.isConnected) for (const [name, value] of Object.entries(style)) node.style[name] = value;
        }
        widthOriginal.clear();
        if (PageAdapter.type() !== 'list') return;
        const config = getThreadListWidthConfig();
        if (!config.enabled) return;
        try {
            for (const node of document.querySelectorAll(config.selector)) {
                widthOriginal.set(
                    node,
                    Object.fromEntries(
                        ['width', 'maxWidth', 'marginLeft', 'marginRight'].map((k) => [k, node.style[k]]),
                    ),
                );
                Object.assign(node.style, {
                    width: config.mode === 'pixel' ? `${config.value}px` : `${config.value}%`,
                    maxWidth: 'none',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                });
            }
        } catch (error) {
            console.warn('[Discuz Helper] 宽度选择器无效', error);
        }
    }
    function field(label, type, value, options) {
        const row = el('label', 'dh-field'),
            input = el(type === 'select' ? 'select' : 'input');
        row.append(el('span', '', label), input);
        if (type === 'select')
            for (const [v, text] of options) {
                const o = el('option', '', text);
                o.value = v;
                input.append(o);
            }
        else input.type = type;
        if (type === 'checkbox') input.checked = value;
        else input.value = String(value);
        return { row, input };
    }
    function download(legacy) {
        const blob = new Blob([JSON.stringify(history.export(legacy), null, 2)], { type: 'application/json' }),
            url = URL.createObjectURL(blob),
            a = el('a');
        a.href = url;
        a.download = `discuz_history_${encodeURIComponent(history.site)}${legacy ? '_legacy' : ''}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function showSettingsPanel() {
        if (document.querySelector('.dh-settings')) return;
        const original = { ...settings },
            draft = { ...settings },
            box = modal('Discuz 辅助设置'),
            dialog = el('div', 'dh-dialog dh-settings'),
            header = el('div', 'dh-dialog-header');
        const heading = el('div');
        heading.append(
            el('div', 'dh-kicker', 'DISCUZ / 阅读辅助'),
            el('h2', '', '让浏览，更从容。'),
            el('p', '', '按你的阅读习惯，调整每一处细节。'),
        );
        header.append(heading, button('关闭', box.close, 'dh-btn dh-quiet'));
        const layout = el('div', 'dh-settings-layout'),
            nav = el('nav', 'dh-nav'),
            content = el('div', 'dh-settings-content');
        nav.setAttribute('aria-label', '设置分类');
        const panes = [],
            navButtons = [];
        const pane = (name, description) => {
            const section = el('section');
            section.append(el('h3', '', name), el('p', 'dh-hint', description));
            section.hidden = panes.length > 0;
            const tab = button(name, () => {
                panes.forEach((p, i) => {
                    p.hidden = p !== section;
                    navButtons[i].setAttribute('aria-selected', String(p === section));
                });
            });
            tab.setAttribute('aria-selected', String(!panes.length));
            nav.append(tab);
            panes.push(section);
            navButtons.push(tab);
            content.append(section);
            return section;
        };
        const appearance = pane('外观', '自然的色彩，清晰的层次。修改后可直接预览，取消会恢复原样。');
        const theme = field('界面主题', 'select', draft.theme, [
            ['system', '跟随系统'],
            ['light', '浅色'],
            ['dark', '深色'],
        ]);
        appearance.append(theme.row);
        theme.input.onchange = () => {
            draft.theme = theme.input.value;
            appearancePreview = draft.theme;
            applyTheme();
        };
        const sample = el('div', 'dh-preview');
        sample.style.marginTop = '24px';
        const themeExample = el('div', 'dh-soft');
        themeExample.hidden = true;
        themeExample.style.cssText =
            'margin-top:12px;padding:12px;border:1px solid var(--dh-border);border-radius:8px;background:var(--dh-surface);color:var(--dh-ink)';
        themeExample.append(
            el('strong', '', '帖子标题示例'),
            el('p', 'dh-hint', '正文与辅助文字会随所选主题实时变化。'),
        );
        const sampleToggle = button(
            '预览效果',
            () => {
                themeExample.hidden = !themeExample.hidden;
                sampleToggle.textContent = themeExample.hidden ? '预览效果' : '收起示例';
                sampleToggle.setAttribute('aria-expanded', String(!themeExample.hidden));
            },
            'dh-btn dh-primary',
        );
        sampleToggle.setAttribute('aria-expanded', 'false');
        sample.append(
            el('span', 'dh-kicker', '阅读体验'),
            el('p', '', '保持专注，让图片与文字各得其所。'),
            sampleToggle,
            themeExample,
        );
        appearance.append(sample);
        const preview = pane('图片预览', '自动预览只读取第一页。后续分页由你主动加载，不会自动翻页。');
        const defs = [
            ['preview', '启用图片预览', 'checkbox'],
            ['auto', '自动预览第一页', 'checkbox'],
            ['extra', '允许手动抓取后续分页', 'checkbox'],
            ['limit', '自动预览张数', 'number'],
            ['concurrent', '页面请求并发数', 'number'],
            ['min', '最小图片边长（像素）', 'number'],
        ];
        const inputs = {};
        for (const [key, label, type] of defs) {
            const f = field(label, type, draft[key]);
            inputs[key] = f.input;
            if (type === 'number') {
                const limits = { limit: [1, 20], concurrent: [1, 5], min: [1, 2000] }[key];
                f.input.min = limits[0];
                f.input.max = limits[1];
                f.input.step = 1;
            }
            preview.append(f.row);
        }
        const marks = pane('已读样式', '访问与看图分别记录。弱化标题时，图片和操作按钮依然清晰。');
        const style = field('已访问帖子的显示方式', 'select', draft.style, [
            ['default', '柔和标签'],
            ['opacity', '半透明标题'],
            ['strike', '标题删除线'],
            ['opacity-strike', '半透明与删除线'],
            ['color', '标题变色'],
            ['hidden', '隐藏已访问帖子'],
        ]);
        marks.append(style.row);
        style.input.onchange = () => {
            draft.style = style.input.value;
            settings.style = draft.style;
            temporaryHideVisited = null;
            refreshMarks();
        };
        marks.append(visibilityButton());
        refreshVisitedVisibility();
        const width = pane('列表宽度', '仅作用于帖子列表页。可沿用默认值，也可为当前站点单独设置。');
        const policy = field('当前站点策略', 'select', getThreadListWidthSitePolicy(), [
            ['default', '使用默认配置'],
            ['site', '使用独立配置'],
            ['disabled', '当前站点不启用'],
        ]);
        const enabled = field('启用默认宽度', 'checkbox', false),
            selector = field('容器选择器', 'text', ''),
            mode = field('宽度模式', 'select', 'percent', [
                ['percent', '百分比'],
                ['pixel', '固定像素'],
            ]),
            value = field('宽度值', 'number', 80);
        width.append(policy.row, enabled.row, selector.row, mode.row, value.row);
        const syncLimits = () => {
            const limits = getThreadListWidthValueLimits(mode.input.value);
            value.input.min = limits.min;
            value.input.max = limits.max;
            value.input.value = normalizeThreadListWidthValue(value.input.value, mode.input.value);
        };
        const loadWidth = () => {
            const p = policy.input.value,
                c = getThreadListWidthConfig(p === 'site' ? 'site' : 'default');
            enabled.input.checked = c.enabled;
            selector.input.value = c.selector;
            mode.input.value = c.mode;
            value.input.value = c.value;
            enabled.row.hidden = p !== 'default';
            for (const f of [selector, mode, value]) f.input.disabled = p === 'disabled';
            syncLimits();
        };
        policy.input.onchange = loadWidth;
        mode.input.onchange = () => {
            value.input.value = getThreadListWidthValueLimits(mode.input.value).default;
            syncLimits();
        };
        loadWidth();
        const data = pane('数据管理', '足迹仅保存在本地。导出用于备份，旧版本的 JSON 文件也可以导入。');
        const stats = el('div', 'dh-stats'),
            info = el('p', 'dh-hint'),
            id = el('p', 'dh-site-id', `当前论坛：${history.site}`);
        data.append(stats, info, id);
        const updateData = () => {
            const records = Object.values(history.all()),
                visited = records.filter((r) => r.visited?.value).length,
                viewed = records.filter((r) => !r.visited?.value && r.viewedImages?.value).length;
            stats.replaceChildren();
            for (const [label, n] of [
                ['足迹', records.length],
                ['已访问', visited],
                ['仅看图', viewed],
            ]) {
                const card = el('div', 'dh-stat', label);
                card.prepend(el('strong', '', n));
                stats.append(card);
            }
            const recent = Math.max(0, ...records.map((r) => history.time(r)));
            info.textContent = recent ? `最近记录 ${new Date(recent).toLocaleString()}` : '还没有阅读记录';
            refreshMarks();
        };
        const actions = el('div', 'dh-data-actions'),
            file = el('input');
        file.type = 'file';
        file.accept = '.json';
        file.hidden = true;
        const doImport = (input) => {
            const plan = history.planImport(input);
            const foreign =
                input.siteId && input.siteId !== history.site ? `文件属于 ${input.siteId}，将合并到当前论坛。\n` : '';
            if (
                !confirm(
                    `${foreign}新增 ${plan.added} 条，更新 ${plan.updated} 条，跳过 ${plan.skipped} 条。确认导入？`,
                )
            )
                return;
            history.import(input);
            invalidateIntents();
            updateData();
            toast('导入完成');
        };
        file.addEventListener('change', async () => {
            try {
                const chosen = file.files[0];
                if (!chosen) return;
                if (chosen.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB');
                doImport(parseImport(await chosen.text()));
            } catch (error) {
                report(error);
            } finally {
                file.value = '';
            }
        });
        actions.append(
            button('导出备份', () => download(false)),
            button('导出旧格式', () => download(true)),
            button('导入 JSON', () => file.click()),
            file,
        );
        data.append(actions);
        const legacyKeys = history.legacyKeys();
        if (legacyKeys.length) {
            const legacy = field(
                '保留的旧数据',
                'select',
                legacyKeys[0],
                legacyKeys.map((k) => [k, k]),
            );
            data.append(
                legacy.row,
                button('从选定旧数据导入', () => doImport(parseImport(GM_getValue(legacy.input.value, '{}')))),
            );
        }
        const danger = el('div', 'dh-danger-zone');
        danger.append(
            el('p', 'dh-hint', '清理操作前，建议先导出一份备份。'),
            button('清理 30 天前的足迹', () => {
                const n = history.cleanup(30);
                invalidateIntents();
                updateData();
                toast(`已清理 ${n} 条记录`);
            }),
            button(
                '清空当前论坛足迹',
                () => {
                    if (confirm('确定清空当前论坛足迹？请先导出备份。')) {
                        history.clear();
                        invalidateIntents();
                        updateData();
                        toast('当前论坛足迹已清空');
                    }
                },
                'dh-btn dh-danger',
            ),
        );
        data.append(danger);
        try {
            updateData();
        } catch (error) {
            info.textContent = '数据暂不可读取：' + error.message;
        }
        const footer = el('div', 'dh-dialog-footer');
        let saved = false;
        footer.append(
            el('small', '', '本地保存 · 随时调整'),
            button('取消', box.close),
            button(
                '保存设置',
                () => {
                    const next = { ...draft };
                    for (const [key, , type] of defs) {
                        const input = inputs[key];
                        if (type === 'number') {
                            const n = Number(input.value);
                            if (!Number.isInteger(n) || n < Number(input.min) || n > Number(input.max))
                                throw new Error('请填写范围内的整数');
                            next[key] = n;
                        } else next[key] = input.checked;
                    }
                    for (const [key, value] of Object.entries({
                        dh_theme: next.theme,
                        visited_style_mode: next.style,
                        enable_preview: next.preview,
                        enable_auto_preview: next.auto,
                        enable_extra_page_preview: next.extra,
                        auto_preview_limit: next.limit,
                        auto_preview_concurrent: next.concurrent,
                        preview_min_dimension: next.min,
                    }))
                        GM_setValue(key, value);
                    saveThreadListWidthSitePolicy(policy.input.value);
                    if (policy.input.value !== 'disabled')
                        saveThreadListWidthConfig(policy.input.value === 'site' ? 'site' : 'default', {
                            enabled: policy.input.value === 'site' || enabled.input.checked,
                            selector: selector.input.value,
                            mode: mode.input.value,
                            value: value.input.value,
                        });
                    const changed = ['preview', 'auto', 'extra', 'limit', 'concurrent', 'min'].some(
                        (k) => next[k] !== original[k],
                    );
                    settings = next;
                    saved = true;
                    box.close();
                    applyTheme();
                    applyWidth();
                    if (changed) rebuild();
                    else refreshMarks();
                    toast('设置已保存');
                },
                'dh-btn dh-primary',
            ),
        );
        layout.append(nav, content);
        dialog.append(header, layout, footer);
        box.overlay.append(dialog);
        refreshVisitedVisibility();
        box.onClose = () => {
            appearancePreview = null;
            if (!saved) {
                settings = { ...original };
            }
            applyTheme();
            refreshMarks();
        };
        applyTheme(draft.theme);
    }
    function invalidateIntents() {
        for (const c of controllers.values()) c.intent = null;
    }
    function floatingButton() {
        const root = own(el('div', 'dh-root'));
        const b = button(
            '',
            (e) => {
                if (!dragged || e.detail === 0) showSettingsPanel();
                dragged = false;
            },
            'dh-btn dh-floating',
        );
        b.setAttribute('aria-label', '打开 Discuz 辅助设置');
        b.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="19" r="2" fill="currentColor"/></svg>';
        root.append(b);
        document.body.append(root);
        let drag = null,
            dragged = false;
        const place = (x, y) => {
            b.style.left = `${Math.max(8, Math.min(window.innerWidth - 54, x))}px`;
            b.style.top = `${Math.max(8, Math.min(window.innerHeight - 54, y))}px`;
            b.style.right = 'auto';
            b.style.bottom = 'auto';
        };
        const pos = GM_getValue('floating_settings_button_pos');
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) place(pos.x, pos.y);
        b.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            dragged = false;
            const r = b.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
            b.setPointerCapture(e.pointerId);
        });
        b.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x,
                dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true;
            if (dragged) place(drag.left + dx, drag.top + dy);
        });
        const finish = () => {
            if (drag && dragged) {
                const r = b.getBoundingClientRect();
                try {
                    GM_setValue('floating_settings_button_pos', { x: r.left, y: r.top });
                } catch (error) {
                    report(error);
                }
            }
            drag = null;
        };
        b.addEventListener('pointerup', finish);
        b.addEventListener('pointercancel', finish);
        window.addEventListener('resize', () => {
            const r = b.getBoundingClientRect();
            place(r.left, r.top);
        });
    }
    let autoObserver, domObserver, scanTimer;
    function attach(thread) {
        const title = thread.querySelector('th a.s.xst, th a.xst'),
            tid = thread.id.replace(/^(normalthread_|stickthread_)/, '');
        if (!title || !validTid(tid)) return;
        const old = controllers.get(thread);
        if (old && (old.tid !== tid || old.url !== title.href || old.title !== title)) old.destroy();
        else if (old) return;
        const c = new PreviewController(thread, title, tid);
        controllers.set(thread, c);
        if (settings.preview && settings.auto && c.safe) autoObserver.observe(thread);
    }
    function scan() {
        for (const [node, c] of controllers)
            if (!c.live() || !node.closest('#threadlisttableid')) {
                autoObserver.unobserve(node);
                c.destroy();
            }
        document
            .querySelectorAll(
                '#threadlisttableid tbody[id^="normalthread_"], #threadlisttableid tbody[id^="stickthread_"]',
            )
            .forEach(attach);
        refreshMarks();
        applyTheme();
    }
    function rebuild() {
        for (const c of [...controllers.values()]) {
            autoObserver.unobserve(c.thread);
            c.destroy();
        }
        scan();
        pageQueue.drain();
        imageQueue.drain();
    }
    function observeThreads() {
        autoObserver = new IntersectionObserver(
            (entries) => {
                for (const e of entries)
                    if (e.isIntersecting) {
                        autoObserver.unobserve(e.target);
                        controllers.get(e.target)?.auto();
                    }
            },
            { rootMargin: '500px 0px' },
        );
        domObserver = new MutationObserver((mutations) => {
            const relevant = mutations.some((m) => {
                if (m.target.closest?.('[data-dh-owned]')) return false;
                if (m.type === 'attributes') return !!m.target.closest?.('#threadlisttableid');
                return [...m.addedNodes, ...m.removedNodes].some(
                    (n) =>
                        n.nodeType === 1 &&
                        !n.hasAttribute('data-dh-owned') &&
                        (n.matches?.('#threadlisttableid, tbody[id^="normalthread_"], tbody[id^="stickthread_"]') ||
                            n.querySelector?.(
                                '#threadlisttableid, tbody[id^="normalthread_"], tbody[id^="stickthread_"]',
                            ) ||
                            m.target.closest?.('#threadlisttableid')),
                );
            });
            if (relevant) {
                clearTimeout(scanTimer);
                scanTimer = setTimeout(scan, 30);
            }
        });
        domObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['id', 'href'],
        });
        scan();
    }

    // --- 初始化流程 ---
    injectStyles();
    history = new HistoryStore();
    previewCache = new PreviewCache();
    pageQueue = new RequestScheduler(() => settings.concurrent, 300);
    imageQueue = new RequestScheduler(() => 4);
    try {
        history.migrate();
        history.cleanup();
    } catch (error) {
        report(error);
    }
    GM_registerMenuCommand('Discuz 辅助设置', showSettingsPanel);
    floatingButton();
    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
    if (PageAdapter.type() === 'list') {
        observeThreads();
        applyWidth();
        const toolbar = own(el('div', 'dh-root dh-hidden-toggle'));
        toolbar.append(visibilityButton());
        document.querySelector('#threadlisttableid')?.before(toolbar);
        refreshVisitedVisibility();
        applyTheme();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                invalidateIntents();
                refreshMarks();
            }
            pageQueue.drain();
            imageQueue.drain();
        });
        let viewportFrame = 0;
        const refreshViewport = () => {
            if (viewportFrame) return;
            viewportFrame = requestAnimationFrame(() => {
                viewportFrame = 0;
                pageQueue.drain();
                imageQueue.drain();
                for (const c of controllers.values()) c.maybeMark();
            });
        };
        window.addEventListener('resize', refreshViewport);
        window.addEventListener('scroll', refreshViewport, { passive: true });
    } else if (PageAdapter.type() === 'detail') {
        try {
            PageAdapter.parse(document, window.location.href);
            const tid = PageAdapter.tid(window.location.href);
            if (tid) history.write(tid, 'visited', true);
        } catch (error) {
            if (!error.kind) report(error);
        }
    }
})();
