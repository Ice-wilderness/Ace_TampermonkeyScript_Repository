// ==UserScript==
// @name         Bilibili视频观看历史记录
// @namespace    Bilibili-video-History
// @version      3.3.0
// @description  记录并提示Bilibili已观看或已访问但未观看视频记录。支持历史搜索、统计图表、保留周期清理和批量删除进度提示。
// @author       Ice_wilderness
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/v/*
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com
// @match        https://www.bilibili.com/?*
// @match        https://www.bilibili.com/account/history*
// @match        https://www.bilibili.com/history*
// @match        https://www.bilibili.com/watchlater/*
// @match        https://search.bilibili.com/*
// @match        https://www.bilibili.com/medialist/play/*
// @match        https://www.bilibili.com/list/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/574216/Bilibili%E8%A7%86%E9%A2%91%E8%A7%82%E7%9C%8B%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95.user.js
// @updateURL https://update.greasyfork.org/scripts/574216/Bilibili%E8%A7%86%E9%A2%91%E8%A7%82%E7%9C%8B%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_CONFIG = {
        showProgressBar: true,
        showVisitedTag: true,
        debug: false,
        tagOpacity: 100,
        tagPosition: 'top-left',
        lowThreshold: 30,
        highThreshold: 80,
        autoResumePrompt: true
    };

    const CONFIG = Object.assign({}, DEFAULT_CONFIG, GM_getValue('bvh_settings', {}));

    const RECORD_STATUS = {
        WATCHED: '已观看',
        VISITED: '已访问',
        DELETED: '已删除'
    };

    const BV_REGEX = /((BV|bv)[A-Za-z0-9]{10}(?:\?p=[0-9]+)?)|(av\d+(?:\?p=[0-9]+)?)/;
    const BACKUP_PREFIX = 'BvH_backup_';
    const PENDING_SEEK_KEY = 'bvh_pending_seek';
    const BACKUP_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
    const BACKUP_MAX_COUNT = 200;
    const HEADER_SELECTOR = '#biliMainHeader, .bili-header, .bili-header__bar, .mini-header, .international-header';
    const HEADER_SETTLE_DELAY = 900;
    const DOM_START_FALLBACK_DELAY = 4500;
    const DOM_IDLE_TIMEOUT = 800;
    const MIN_WATCH_SAVE_SECONDS = 2;
    const MIN_RESUME_SECONDS = 5;
    const ACTION_LIST_ITEM_SELECTOR = '.action-list-item-wrap[data-key]';
    const PLAYLIST_ITEM_SELECTOR = `${ACTION_LIST_ITEM_SELECTOR}, .video-pod__item[data-key], .bpx-player-ctrl-eplist-multi-menu-item[data-cid], .video-pod__list.section .simple-base-item.page-item`;
    const VIDEO_LINK_SELECTOR = 'a[href*="/video/"], a[href*="/v/"], a[href*="bvid="]';
    const HEADER_POPOVER_SELECTOR = '.dynamic-panel-popover, .history-panel-popover, .favorite-panel-popover, #biliHeaderDynScrollCon, #favorite-content-scroll, .header-favorite-popover';
    const HEADER_POPOVER_VIDEO_LINK_SELECTOR = [
        '.dynamic-panel-popover .header-dynamic__box--right[href*="/video/"]',
        '.history-panel-popover .header-history-card[href*="/video/"]',
        '.favorite-panel-popover .header-fav-card[href*="/video/"]',
        '.favorite-panel-popover .header-fav-card[href*="bvid="]',
        '#favorite-content-scroll .header-fav-card[href*="/video/"]',
        '#favorite-content-scroll .header-fav-card[href*="bvid="]'
    ].join(', ');
    const HEADER_POPOVER_COVER_SELECTOR = '.header-dynamic__box--right .cover, .header-history-video__image, .header-fav-card__image';
    const MUTATION_RELEVANT_SELECTOR = `${VIDEO_LINK_SELECTOR}, ${PLAYLIST_ITEM_SELECTOR}, ${HEADER_POPOVER_SELECTOR}, ${HEADER_POPOVER_VIDEO_LINK_SELECTOR}`;
    const VIDEO_OBSERVER_ROOT_SELECTOR = [
        '#reco_list',
        '.right-container',
        '.right-container-inner',
        '.recommend-list',
        '.recommend-list-v1',
        '.rec-list',
        '.rcmd-list',
        '.next-play',
        '.video-page-card-small',
        '.video-page-card',
        '.video-card-small',
        '.video-card-ad-small',
        '.bili-video-card',
        '.video-card',
        '.card-box',
        '.video-pod',
        '.video-pod__list',
        '.base-video-sections-v1',
        '.video-sections-v1',
        '.playlist-container',
        '.list-box',
        '.action-list',
        '.bpx-player-ctrl-eplist',
        '.bpx-player-ctrl-eplist-multi-menu',
        '.bpx-player-ctrl-eplist-episodes'
    ].join(', ');
    const LIST_OBSERVER_ROOT_SELECTOR = [
        '#app',
        '#i_cecream',
        '.bili-feed4-layout',
        '.bili-dyn-list__items',
        '.bili-dyn-card',
        '.bili-video-card',
        '.history-list',
        '.history-card',
        '.watch-later-list',
        '.search-page',
        '.video-list',
        '.fav-video-list',
        '.space-video',
        '.channel-list'
    ].join(', ');
    const OBSERVER_ROOT_DISCOVERY_SELECTOR = `${VIDEO_OBSERVER_ROOT_SELECTOR}, ${LIST_OBSERVER_ROOT_SELECTOR}, ${HEADER_POPOVER_SELECTOR}`;
    const DOM_MUTATION_WORK_LIMIT = 160;
    const DOM_LINK_BATCH_SIZE = 60;
    const DOM_PLAYLIST_BATCH_SIZE = 40;
    const DOM_PROCESS_TIME_BUDGET = 12;
    const DOM_RESCAN_DELAY = 350;

    const VideoKey = {
        fromUrl: (value) => {
            if (!value) return '';
            try {
                const url = new URL(value, location.href);
                const queryBvid = url.searchParams.get('bvid');
                const queryP = url.searchParams.get('p');
                if (queryBvid && VideoKey.isValid(queryBvid)) {
                    return VideoKey.normalize(queryP && queryP !== '1' ? `${queryBvid}?p=${queryP}` : queryBvid);
                }
                const pathKey = VideoKey.fromText(url.pathname);
                if (pathKey) {
                    return VideoKey.normalize(queryP && queryP !== '1' ? `${pathKey}?p=${queryP}` : pathKey);
                }
            } catch (e) { }
            return VideoKey.fromText(value);
        },
        fromText: (value) => {
            if (!value) return '';
            const match = String(value).match(BV_REGEX);
            return match ? VideoKey.normalize(match[0]) : '';
        },
        normalize: (value) => {
            if (!value) return '';
            const raw = String(value).trim();
            const match = raw.match(BV_REGEX);
            if (!match) return '';
            let key = match[0];
            key = key.replace(/^bv/i, 'BV').replace(/^AV/i, 'av');
            key = key.replace(/\?p=1$/, '');
            return key;
        },
        base: (value) => VideoKey.normalize(value).replace(/\?p=[0-9]+/, ''),
        page: (value) => {
            const match = VideoKey.normalize(value).match(/\?p=([0-9]+)/);
            return match ? parseInt(match[1], 10) : 1;
        },
        withPage: (base, page) => {
            const normalizedBase = VideoKey.base(base);
            const p = parseInt(page, 10) || 1;
            if (!normalizedBase) return '';
            return p <= 1 ? normalizedBase : `${normalizedBase}?p=${p}`;
        },
        isValid: (value) => !!VideoKey.fromText(value)
    };

    // --- 样式注入 ---
    let stylesInjected = false;
    const injectStyles = () => {
        if (stylesInjected) return;
        try {
            GM_addStyle(`
        .bvh-tag { position: absolute; margin: .5em!important; padding: 0 5px!important; height: 20px; line-height: 20px; border-radius: 4px; color: #fff; font-style: normal; font-size: 12px; white-space: nowrap; background-color: rgba(122, 134, 234, 0.7); z-index: 108; pointer-events: none; }
        .bvh-tag-visited { background-color: rgba(158, 158, 158, 0.9) !important; }
        .bvh-tag-low { background-color: rgba(255, 152, 0, 0.9) !important; }
        .bvh-tag-mid { background-color: rgba(66, 133, 244, 0.9) !important; }
        .bvh-tag-high { background-color: rgba(76, 175, 80, 0.9) !important; }
        .bvh-tag-small { margin: .2em!important; padding: 0 4px!important; height: 18px; line-height: 18px; font-size: 10px; }
        .bvh-tag-big { height: 22px; line-height: 23px; font-size: 14px; }
        .bvh-episode-tag { display: inline-block; margin-left: 6px; padding: 0 4px; height: 16px; line-height: 16px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 600; vertical-align: middle; white-space: nowrap; pointer-events: none; }
        .action-list-item-wrap .cover, .action-list-item-wrap .cover-img { position: relative; }
        ${HEADER_POPOVER_COVER_SELECTOR} { position: relative; }
        .bvh-action-list-cover-tag { z-index: 109 !important; }
        .video-pod__list.grid .video-pod__item.page { position: relative; }
        .bvh-episode-tag-grid { position: absolute; top: 2px; right: 2px; margin: 0; padding: 0 3px; min-width: 14px; max-width: 30px; height: 14px; line-height: 14px; font-size: 9px; text-align: center; overflow: hidden; text-overflow: ellipsis; }
        .bpx-player-ctrl-eplist-multi-menu-item { position: relative; }
        .bpx-player-ctrl-eplist-multi-menu-item .bpx-player-ctrl-eplist-multi-menu-item-text { display: block; padding-right: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bpx-player-ctrl-eplist-multi-menu-item .bvh-episode-tag { position: absolute; right: 10px; top: 50%; margin-left: 0; transform: translateY(-50%); }
        .bvh-progress-bar { background: linear-gradient(90deg, rgba(122, 134, 234, 0.9), rgba(156, 166, 255, 0.7)); z-index: 108; position: absolute; height: 4px; bottom: 0px; border-bottom-left-radius: inherit; border-bottom-right-radius: inherit; pointer-events: none; }
        .bvh-toast-container { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 100010; display: flex; flex-direction: column; align-items: center; gap: 10px; width: min(420px, calc(100vw - 32px)); pointer-events: none; }
        .bvh-toast { max-width: 100%; min-width: 220px; background-color: #333; color: #fff; padding: 10px 20px; border-radius: 4px; font-size: 14px; text-align: center; opacity: 0; transition: opacity 0.3s; box-shadow: 0 2px 8px rgba(0,0,0,0.2); pointer-events: auto; }
        .bvh-toast.show { opacity: 1; }
        .bvh-toast.success { border-left: 4px solid #4CAF50; }
        .bvh-toast.error { border-left: 4px solid #F44336; }
        .bvh-progress-toast { width: min(360px, calc(100vw - 48px)); text-align: left; }
        .bvh-toast-progress-text { margin-bottom: 8px; font-weight: 700; }
        .bvh-toast-progress-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,.28); overflow: hidden; }
        .bvh-toast-progress-fill { width: 0; height: 100%; border-radius: 999px; background: #00aeec; transition: width .18s ease; }
        .bvh-view-panel { position: fixed; text-align: center; border-left: 6px solid #2196F3; background-color: #aeffff; font-family: 'Segoe UI', sans-serif; font-weight: 600; padding: 5px; z-index: 9999; cursor: move; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border-radius: 0 4px 4px 0; user-select: none; }
        .bvh-quick-entry { position: fixed; left: 15px; bottom: 15px; z-index: 9998; border: 1px solid #00aeec; background: #fff; color: #00aeec; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.16); }
        .bvh-modal-mask { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.42); display: flex; align-items: center; justify-content: center; }
        .bvh-modal { width: min(980px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 28px)); background: #fff; color: #18191c; border-radius: 10px; box-shadow: 0 18px 60px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .bvh-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid #edf0f2; background: #fff; }
        .bvh-modal-title { font-size: 20px; font-weight: 800; letter-spacing: 0; }
        .bvh-modal-close { border: 0; background: transparent; font-size: 24px; line-height: 1; cursor: pointer; color: #61666d; }
        .bvh-tabs { display: flex; gap: 12px; padding: 0 24px; border-bottom: 1px solid #edf0f2; background: #fff; }
        .bvh-tab { border: 0; border-bottom: 3px solid transparent; padding: 14px 4px 13px; background: transparent; cursor: pointer; color: #61666d; font-weight: 700; font-size: 15px; }
        .bvh-tab.active { color: #00aeec; border-color: #00aeec; }
        .bvh-modal-body { padding: 18px 24px 22px; overflow: auto; background: #f6f8fa; }
        .bvh-pane { display: none; }
        .bvh-pane.active { display: block; }
        .bvh-settings-card { border: 1px solid #e3e5e7; border-radius: 8px; background: #fff; padding: 18px; margin-bottom: 14px; }
        .bvh-section-title { margin: 0 0 14px; color: #18191c; font-size: 15px; font-weight: 800; }
        .bvh-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px 18px; }
        .bvh-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 38px; }
        .bvh-field label { font-weight: 700; color: #18191c; line-height: 1.25; }
        .bvh-field input[type="number"], .bvh-field input[type="range"], .bvh-field select, .bvh-search { min-width: 120px; border: 1px solid #d0d7de; border-radius: 7px; padding: 8px 10px; background: #fff; color: #18191c; font-size: 14px; }
        .bvh-field input[type="checkbox"] { width: 18px; height: 18px; accent-color: #00aeec; }
        .bvh-opacity-control { display: grid; grid-template-columns: minmax(120px, 1fr) 72px; align-items: center; gap: 10px; min-width: 230px; }
        .bvh-opacity-control input[type="range"] { min-width: 120px; }
        .bvh-opacity-control input[type="number"] { min-width: 0; width: 72px; }
        .bvh-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; align-items: center; }
        .bvh-actions-search { margin-bottom: 6px; }
        .bvh-actions-search .bvh-search { flex: 1; min-width: 0; }
        .bvh-actions-bar { margin-top: 0; }
        .bvh-actions-spacer { flex: 1; }
        .bvh-retention-cleanup { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .bvh-retention-cleanup input, .bvh-retention-cleanup select { border: 1px solid #d0d7de; border-radius: 7px; padding: 8px 10px; background: #fff; color: #18191c; font-size: 14px; }
        .bvh-retention-cleanup input { width: 72px; min-width: 72px; }
        .bvh-retention-label { color: #61666d; font-size: 13px; font-weight: 700; }
        .bvh-history-loading { text-align: center; color: #9499a0; font-size: 14px; padding: 40px 0; }
        .bvh-btn { border: 1px solid #d0d7de; background: #fff; color: #18191c; border-radius: 7px; padding: 8px 13px; cursor: pointer; font-weight: 700; }
        .bvh-btn.primary { background: #00aeec; border-color: #00aeec; color: #fff; }
        .bvh-btn.danger { background: #f85a54; border-color: #f85a54; color: #fff; }
        .bvh-btn:disabled { opacity: .45; cursor: not-allowed; }
        .bvh-history-summary { margin: 8px 0 10px; color: #61666d; font-size: 13px; }
        .bvh-pagination { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; color: #61666d; font-size: 13px; }
        .bvh-page-jump { width: 66px; min-width: 66px!important; }
        .bvh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bvh-table th, .bvh-table td { padding: 8px 6px; border-bottom: 1px solid #edf0f2; text-align: left; vertical-align: middle; }
        .bvh-table th { color: #61666d; font-weight: 700; white-space: nowrap; }
        .bvh-table td:nth-child(2) { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bvh-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .bvh-stat { border: 1px solid #e3e5e7; border-radius: 8px; padding: 12px; background: #fafafa; }
        .bvh-stat strong { display: block; font-size: 22px; margin-top: 4px; color: #00aeec; }
        .bvh-resume { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 99998; background: #fff; color: #18191c; border: 1px solid #e3e5e7; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.2); padding: 12px; display: flex; align-items: center; gap: 10px; }
        .bvh-resume span { font-weight: 600; }
        .bvh-chart-toolbar { display: flex; justify-content: flex-end; margin: 14px 0; }
        .bvh-chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 14px; }
        .bvh-chart-card { border: 1px solid #e3e5e7; border-radius: 8px; background: #fff; padding: 14px; }
        .bvh-chart-card-wide { grid-column: 1 / -1; }
        .bvh-chart-title { margin: 0 0 12px; font-size: 14px; font-weight: 800; color: #18191c; }
        .bvh-chart-row { display: grid; grid-template-columns: 72px 1fr 44px; gap: 8px; align-items: center; margin: 8px 0; }
        .bvh-chart-label { font-size: 13px; color: #18191c; font-weight: 600; }
        .bvh-chart-value { font-size: 13px; color: #18191c; text-align: right; }
        .bvh-chart-bar-track { height: 10px; background: #edf0f2; border-radius: 999px; overflow: hidden; }
        .bvh-chart-bar-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
        .bvh-chart-empty { color: #9499a0; font-size: 13px; padding: 18px 0; text-align: center; }
        .bvh-completion-ring { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 8px 0; }
        .bvh-ring-svg { width: 90px; height: 90px; flex-shrink: 0; }
        .bvh-ring-text { display: flex; flex-direction: column; align-items: center; }
        .bvh-ring-text strong { font-size: 28px; color: #00aeec; }
        .bvh-ring-text span { font-size: 12px; color: #9499a0; }
        .bvh-svg-chart { width: 100%; height: auto; }
        .bvh-chart-scroll { overflow-x: auto; }
        .bvh-chart-scroll .bvh-svg-chart { min-width: 560px; height: 180px; }
            `);
            stylesInjected = true;
        } catch (e) { }
    };

    // --- 工具类 ---
    const Utils = {
        _debugCounters: {},
        _debugLogs: [],
        _debugLogLimit: 3000,
        _debugSessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        _issueLogKey: 'bvh_debug_issue_logs',
        _issueLogLimit: 800,
        _issueFlushDelay: 500,
        _issuePending: new Map(),
        _issueFlushTimer: null,
        _issuePersistedSnapshot: null,
        _isCapturingIssue: false,
        _isFlushingIssueLogs: false,
        _isConsolePassthrough: false,
        _issueHooksInstalled: false,
        _issueLifecycleHooksInstalled: false,
        _truncate: (value, limit = 2000) => {
            const text = String(value ?? '');
            return text.length > limit ? `${text.slice(0, limit)}...<truncated ${text.length - limit} chars>` : text;
        },
        _isErrorLike: (value) => {
            if (!value || typeof value !== 'object') return false;
            const tag = Object.prototype.toString.call(value);
            return tag === '[object Error]' || tag === '[object DOMException]' || ('message' in value && 'stack' in value);
        },
        _errorInfo: (value) => {
            const name = Utils._truncate(value?.name || 'Error', 120);
            const message = Utils._truncate(value?.message || String(value), 1200);
            const stack = Utils._truncate(value?.stack || '', 5000);
            return { name, message, stack };
        },
        _domNodeSummary: (value) => {
            if (!value || typeof value !== 'object' || typeof value.nodeType !== 'number') return '';
            const tag = String(value.tagName || value.nodeName || 'node').toLowerCase();
            const id = value.id ? `#${Utils._truncate(value.id, 80)}` : '';
            const cls = typeof value.className === 'string'
                ? `.${Utils._truncate(value.className.trim().split(/\s+/).slice(0, 3).join('.'), 120)}`
                : '';
            const src = value.src ? ` src=${Utils._truncate(value.src, 160)}` : '';
            const href = value.href ? ` href=${Utils._truncate(value.href, 160)}` : '';
            return `[DOM ${tag}${id}${cls}${src}${href}]`;
        },
        _toSafeDebugValue: (value, depth = 0, seen = new WeakSet()) => {
            if (value === null || value === undefined) return value;
            const type = typeof value;
            if (type === 'string') return Utils._truncate(value, 2000);
            if (type === 'number' || type === 'boolean') return value;
            if (type === 'bigint' || type === 'symbol') return String(value);
            if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
            if (Utils._isErrorLike(value)) {
                const info = Utils._errorInfo(value);
                return { name: info.name, message: info.message, stack: info.stack };
            }
            const domSummary = Utils._domNodeSummary(value);
            if (domSummary) return domSummary;
            try {
                if (value === window || value === Utils._getPageWindow()) return '[Window]';
            } catch (e) { }
            if (depth >= 3) return '[MaxDepth]';
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
            if (Array.isArray(value)) {
                const items = value.slice(0, 30).map(item => Utils._toSafeDebugValue(item, depth + 1, seen));
                if (value.length > 30) items.push(`...<${value.length - 30} more>`);
                return items;
            }
            const out = {};
            let keys = [];
            try {
                keys = Object.keys(value);
            } catch (e) {
                return '[Unreadable Object]';
            }
            keys.slice(0, 30).forEach(key => {
                try {
                    out[key] = Utils._toSafeDebugValue(value[key], depth + 1, seen);
                } catch (e) {
                    out[key] = '[Unreadable]';
                }
            });
            if (keys.length > 30) out.__truncatedKeys = keys.length - 30;
            return out;
        },
        _stringifyDebugArg: (arg) => {
            if (Utils._isErrorLike(arg)) {
                const info = Utils._errorInfo(arg);
                return `${info.name}: ${info.message}${info.stack ? `\n${info.stack}` : ''}`;
            }
            if (typeof arg === 'string') return arg;
            try {
                return Utils._truncate(JSON.stringify(Utils._toSafeDebugValue(arg)), 2000);
            } catch (e) {
                return Utils._truncate(String(arg), 2000);
            }
        },
        _normalizeIssueArgs: (args) => {
            const list = Array.isArray(args) ? args : [args];
            let stack = '';
            const parts = list.map(arg => {
                if (Utils._isErrorLike(arg)) {
                    const info = Utils._errorInfo(arg);
                    if (!stack) stack = info.stack;
                    return `${info.name}: ${info.message}`;
                }
                return Utils._stringifyDebugArg(arg);
            });
            return {
                message: Utils._truncate(parts.join(' '), 2000),
                stack: Utils._truncate(stack, 5000)
            };
        },
        _issueSignature: (record) => Utils._truncate([
            record.level || '',
            record.source || '',
            record.message || '',
            record.stack || record.url || ''
        ].join('\n'), 8000),
        _createIssueRecord: (level, source, payload) => {
            const at = new Date().toISOString();
            const info = Array.isArray(payload) ? Utils._normalizeIssueArgs(payload) : payload;
            const record = {
                sessionId: Utils._debugSessionId,
                lastSessionId: Utils._debugSessionId,
                firstAt: at,
                lastAt: at,
                count: 1,
                level,
                source,
                url: location.href,
                message: Utils._truncate(info?.message || '', 2000),
                stack: Utils._truncate(info?.stack || '', 5000),
                line: Utils._truncate(info?.line || '', 4000)
            };
            record.signature = Utils._issueSignature(record);
            return record;
        },
        _mergeIssueRecordInto: (map, incoming) => {
            if (!incoming) return;
            const signature = incoming.signature || Utils._issueSignature(incoming);
            const existing = map.get(signature);
            const next = Object.assign({}, incoming, { signature });
            next.count = Math.max(1, parseInt(next.count, 10) || 1);
            if (!existing) {
                map.set(signature, next);
                return;
            }
            existing.count = (parseInt(existing.count, 10) || 1) + next.count;
            existing.firstAt = existing.firstAt && existing.firstAt < next.firstAt ? existing.firstAt : next.firstAt;
            existing.lastAt = existing.lastAt && existing.lastAt > next.lastAt ? existing.lastAt : next.lastAt;
            existing.lastSessionId = next.lastSessionId || next.sessionId || existing.lastSessionId;
            existing.url = next.url || existing.url;
            existing.message = next.message || existing.message;
            existing.stack = next.stack || existing.stack;
            existing.line = next.line || existing.line;
        },
        _mergeIssueLogs: (base, incoming) => {
            const map = new Map();
            (Array.isArray(base) ? base : []).forEach(item => Utils._mergeIssueRecordInto(map, item));
            (Array.isArray(incoming) ? incoming : []).forEach(item => Utils._mergeIssueRecordInto(map, item));
            return Array.from(map.values())
                .sort((a, b) => new Date(a.lastAt || 0).getTime() - new Date(b.lastAt || 0).getTime())
                .slice(-Utils._issueLogLimit);
        },
        _queueIssueRecord: (record) => {
            if (!CONFIG.debug || !record) return;
            const signature = record.signature || Utils._issueSignature(record);
            const existing = Utils._issuePending.get(signature);
            if (existing) {
                existing.count += 1;
                existing.lastAt = record.lastAt;
                existing.lastSessionId = record.lastSessionId;
                existing.url = record.url;
                existing.line = record.line || existing.line;
            } else {
                if (Utils._issuePending.size >= Utils._issueLogLimit) {
                    const oldestKey = Utils._issuePending.keys().next().value;
                    if (oldestKey) Utils._issuePending.delete(oldestKey);
                }
                Utils._issuePending.set(signature, record);
            }
            Utils._scheduleIssueFlush();
        },
        _scheduleIssueFlush: () => {
            if (Utils._issueFlushTimer) return;
            Utils._issueFlushTimer = setTimeout(() => {
                Utils._issueFlushTimer = null;
                Utils._flushIssueLogs(false);
            }, Utils._issueFlushDelay);
        },
        _flushIssueLogs: (light = false) => {
            if (Utils._isFlushingIssueLogs || Utils._issuePending.size === 0) return false;
            Utils._isFlushingIssueLogs = true;
            const keys = Array.from(Utils._issuePending.keys());
            const pending = keys.map(key => Utils._issuePending.get(key)).filter(Boolean);
            try {
                let latest = Utils._issuePersistedSnapshot;
                if (!light) {
                    latest = GM_getValue(Utils._issueLogKey, []);
                } else if (!latest) {
                    return false;
                }
                const merged = Utils._mergeIssueLogs(Array.isArray(latest) ? latest : [], pending);
                GM_setValue(Utils._issueLogKey, merged);
                Utils._issuePersistedSnapshot = merged;
                keys.forEach(key => Utils._issuePending.delete(key));
                return true;
            } catch (e) {
                return false;
            } finally {
                Utils._isFlushingIssueLogs = false;
            }
        },
        _pushDebugLog: (level, label, args, options = {}) => {
            const line = `${new Date().toISOString()} ${label} ${args.map(Utils._stringifyDebugArg).join(' ')}`;
            Utils._debugLogs.push(line);
            if (Utils._debugLogs.length > Utils._debugLogLimit) {
                Utils._debugLogs.splice(0, Utils._debugLogs.length - Utils._debugLogLimit);
            }
            if (!options.skipIssue && (level === 'warn' || level === 'error')) {
                const issue = Utils._createIssueRecord(level, 'script', args);
                issue.line = line;
                Utils._queueIssueRecord(issue);
            }
        },
        _writeLog: (level, label, args, alwaysConsole = false) => {
            Utils._pushDebugLog(level, label, args);
            if (alwaysConsole || CONFIG.debug) {
                const writer = console[level] || console.log;
                try {
                    Utils._isConsolePassthrough = true;
                    writer.apply(console, [label, ...args]);
                } finally {
                    Utils._isConsolePassthrough = false;
                }
            }
        },
        log: (...args) => { if (CONFIG.debug) Utils._writeLog('log', '[BvH]', args); },
        warn: (...args) => { if (CONFIG.debug) Utils._writeLog('warn', '[BvH Warn]', args); },
        error: (...args) => Utils._writeLog('error', '[BvH Error]', args, true),
        debugTime: (name) => {
            const start = performance.now();
            return (extra = '') => {
                if (!CONFIG.debug) return;
                const cost = performance.now() - start;
                const suffix = extra ? ` ${extra}` : '';
                const level = cost >= 80 ? 'warn' : 'log';
                Utils._writeLog(level, '[BvH Perf]', [`${name}: ${cost.toFixed(1)}ms${suffix}`]);
            };
        },
        logSlow: (name, start, extra = '', threshold = 80, level = 'warn') => {
            if (!CONFIG.debug) return;
            const cost = performance.now() - start;
            if (cost >= threshold) {
                Utils._writeLog(level, '[BvH Slow]', [`${name}: ${cost.toFixed(1)}ms${extra ? ` ${extra}` : ''}`]);
            }
        },
        count: (name, step = 1) => {
            if (!CONFIG.debug) return 0;
            Utils._debugCounters[name] = (Utils._debugCounters[name] || 0) + step;
            return Utils._debugCounters[name];
        },
        logEvery: (name, interval, ...args) => {
            if (!CONFIG.debug) return;
            const count = Utils.count(name);
            if (count === 1 || count % interval === 0) {
                Utils._writeLog('log', '[BvH Count]', [`${name}: ${count}`, ...args]);
            }
        },
        _captureExternalIssue: (level, source, payload) => {
            if (!CONFIG.debug || Utils._isCapturingIssue || Utils._isFlushingIssueLogs) return;
            Utils._isCapturingIssue = true;
            try {
                const issue = Utils._createIssueRecord(level, source, payload);
                const line = issue.line || `${issue.lastAt} [BvH ${source}] ${issue.message}${issue.stack ? `\n${issue.stack}` : ''}`;
                Utils._pushDebugLog(level, `[BvH ${source}]`, [issue.message, issue.stack].filter(Boolean), { skipIssue: true });
                issue.line = line;
                Utils._queueIssueRecord(issue);
            } catch (e) {
            } finally {
                Utils._isCapturingIssue = false;
            }
        },
        _getPageWindow: () => {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch (e) {
                return window;
            }
        },
        _hookConsoleMethod: (consoleObj, level) => {
            try {
                if (!consoleObj || typeof consoleObj[level] !== 'function' || consoleObj[level].__bvhIssueHooked) return;
                const original = consoleObj[level];
                const hooked = function (...args) {
                    try {
                        if (!Utils._isConsolePassthrough) {
                            const info = Utils._normalizeIssueArgs(args);
                            Utils._captureExternalIssue(level, `console.${level}`, info);
                        }
                    } catch (e) { }
                    return original.apply(this, args);
                };
                Object.defineProperty(hooked, '__bvhIssueHooked', { value: true });
                consoleObj[level] = hooked;
            } catch (e) { }
        },
        _hookConsoleIssues: () => {
            const targets = [];
            const pageWindow = Utils._getPageWindow();
            try {
                if (pageWindow?.console) targets.push(pageWindow.console);
            } catch (e) { }
            try {
                if (window.console && !targets.includes(window.console)) targets.push(window.console);
            } catch (e) { }
            targets.forEach(consoleObj => {
                Utils._hookConsoleMethod(consoleObj, 'warn');
                Utils._hookConsoleMethod(consoleObj, 'error');
            });
        },
        _hookWindowIssues: () => {
            const bind = (targetWindow) => {
                try {
                    if (!targetWindow?.addEventListener) return false;
                    targetWindow.addEventListener('error', (event) => {
                        try {
                            const locationText = event.filename ? ` @ ${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '';
                            const errorInfo = Utils._isErrorLike(event.error) ? Utils._errorInfo(event.error) : null;
                            Utils._captureExternalIssue('error', 'window.error', {
                                message: Utils._truncate(`${event.message || errorInfo?.message || 'window error'}${locationText}`, 2000),
                                stack: errorInfo?.stack || ''
                            });
                        } catch (e) { }
                    }, true);
                    targetWindow.addEventListener('unhandledrejection', (event) => {
                        try {
                            const info = Utils._normalizeIssueArgs([event.reason]);
                            Utils._captureExternalIssue('error', 'unhandledrejection', info);
                        } catch (e) { }
                    }, true);
                    return true;
                } catch (e) {
                    return false;
                }
            };
            if (!bind(Utils._getPageWindow())) {
                bind(window);
            }
        },
        installIssueLifecycleHooks: () => {
            if (Utils._issueLifecycleHooksInstalled) return;
            Utils._issueLifecycleHooksInstalled = true;
            const lightFlush = () => Utils._flushIssueLogs(true);
            try { window.addEventListener('pagehide', lightFlush, { capture: true }); } catch (e) { }
            try { window.addEventListener('beforeunload', lightFlush, { capture: true }); } catch (e) { }
            try {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') lightFlush();
                }, { capture: true });
            } catch (e) { }
        },
        installIssueHooks: () => {
            if (Utils._issueHooksInstalled || !CONFIG.debug) return;
            Utils._issueHooksInstalled = true;
            Utils.installIssueLifecycleHooks();
            Utils._hookWindowIssues();
            Utils._hookConsoleIssues();
        },
        _getHistoricalIssueLogs: () => {
            Utils._flushIssueLogs(false);
            try {
                const logs = GM_getValue(Utils._issueLogKey, []);
                Utils._issuePersistedSnapshot = Array.isArray(logs) ? logs : [];
                return Utils._issuePersistedSnapshot.filter(item => item?.lastSessionId !== Utils._debugSessionId);
            } catch (e) {
                return [];
            }
        },
        _formatIssueLogRecord: (item) => {
            const count = parseInt(item.count, 10) || 1;
            const header = `${item.lastAt || item.firstAt || ''} [${String(item.level || '').toUpperCase()}] ${item.source || 'unknown'}${count > 1 ? ` x${count}` : ''} ${item.url || ''}`.trim();
            const body = [item.message, item.stack].filter(Boolean).join('\n');
            return `${header}${body ? `\n${body}` : ''}`;
        },
        clearDebugLogs: () => {
            Utils._debugLogs = [];
            Utils._debugCounters = {};
            Utils._issuePending.clear();
            if (Utils._issueFlushTimer) {
                clearTimeout(Utils._issueFlushTimer);
                Utils._issueFlushTimer = null;
            }
            Utils._issuePersistedSnapshot = [];
            try { GM_deleteValue(Utils._issueLogKey); } catch (e) { }
        },
        downloadDebugLog: () => {
            const historicalIssues = Utils._getHistoricalIssueLogs();
            const version = typeof GM_info !== 'undefined' ? (GM_info.script?.version || 'unknown') : 'unknown';
            const lines = [
                '# Bilibili视频观看历史记录 调试日志',
                `导出时间: ${Utils.formatTime()}`,
                `脚本版本: ${version}`,
                `日志会话: ${Utils._debugSessionId}`,
                `页面地址: ${location.href}`,
                `UserAgent: ${navigator.userAgent}`,
                `调试开关: ${CONFIG.debug}`,
                `页面状态: ${document.readyState}`,
                `可见状态: ${document.visibilityState}`,
                `当前页面日志条数: ${Utils._debugLogs.length}/${Utils._debugLogLimit}`,
                `历史异常日志条数: ${historicalIssues.length}/${Utils._issueLogLimit}`,
                '',
                '# 当前配置',
                JSON.stringify(CONFIG, null, 2),
                '',
                '# 调试计数器',
                JSON.stringify(Utils._debugCounters, null, 2),
                '',
                '# 存储缓存状态',
                typeof StorageManager === 'undefined'
                    ? 'StorageManager unavailable'
                    : JSON.stringify({
                        cachedShards: StorageManager._shardCache?.size || 0,
                        indexedBases: StorageManager._bvBaseIndex?.size || 0,
                        allKeysCached: !!StorageManager._allKeysCache,
                        allKeysCacheSize: StorageManager._allKeysCache?.length || 0
                    }, null, 2),
                '',
                '# 当前页面日志',
                ...Utils._debugLogs,
                '',
                '# 历史 warning/error 日志',
                ...(historicalIssues.length ? historicalIssues.map(Utils._formatIssueLogRecord) : ['(无历史 warning/error 日志)'])
            ];
            const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bvh-debug-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`;
            a.click();
            URL.revokeObjectURL(url);
            Utils.log('Debug log downloaded', `current=${Utils._debugLogs.length}`, `issues=${historicalIssues.length}`);
        },
        describeElement: (el) => {
            if (!el) return '(none)';
            const tag = (el.tagName || '').toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className && typeof el.className === 'string'
                ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
                : '';
            const key = el.getAttribute?.('data-key') || el.getAttribute?.('data-cid') || '';
            return `${tag}${id}${cls}${key ? `[data=${key}]` : ''}`;
        },
        formatTime: () => {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
        timeToSeconds: (timeStr) => {
            if (!timeStr) return 0;
            return timeStr.split(":").reverse().reduce((total, item, index) => total + parseInt(item || 0) * Math.pow(60, index), 0);
        },
        escapeHTML: (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        debounce: (fn, delay) => {
            let timer;
            return function (...args) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },
        throttle: (fn, interval) => {
            let lastRun = 0;
            return function (...args) {
                const now = Date.now();
                if (now - lastRun >= interval) {
                    lastRun = now;
                    fn.apply(this, args);
                }
            };
        }
    };

    Utils.installIssueLifecycleHooks();
    if (CONFIG.debug) Utils.installIssueHooks();

    const DISPLAY_SETTINGS = new Set([
        'showProgressBar',
        'showVisitedTag',
        'tagOpacity',
        'tagPosition',
        'lowThreshold',
        'highThreshold'
    ]);

    const SettingsManager = {
        save: (patch = {}) => {
            Object.assign(CONFIG, patch);
            GM_setValue('bvh_settings', Object.assign({}, CONFIG));
            if (patch.debug) Utils.installIssueHooks();
            const needsDomRefresh = Object.keys(patch).some(key => DISPLAY_SETTINGS.has(key));
            if (needsDomRefresh) {
                StorageManager._notifyChange();
            }
        },
        reset: () => {
            Object.keys(CONFIG).forEach(key => delete CONFIG[key]);
            Object.assign(CONFIG, DEFAULT_CONFIG);
            GM_setValue('bvh_settings', Object.assign({}, CONFIG));
            StorageManager._notifyChange();
        }
    };

    const EpisodeResolver = {
        getBaseKey: () => VideoKey.base(VideoKey.fromUrl(location.href) || window.__INITIAL_STATE__?.bvid || ''),
        _collectItems: () => {
            const seen = new Set();
            const items = [];
            const add = (el, cid, title, key = '') => {
                if (!cid || seen.has(cid)) return;
                seen.add(cid);
                const directKey = VideoKey.normalize(key);
                items.push({
                    el,
                    cid,
                    page: directKey ? VideoKey.page(directKey) : items.length + 1,
                    key: directKey,
                    base: directKey ? VideoKey.base(directKey) : '',
                    title: (title || '').trim()
                });
            };
            const normalizeTitle = (value) => String(value || '').replace(/\s+/g, '').trim();
            const sectionBaseByTitle = new Map();
            const keyByTitle = new Map();
            const sectionVideoKeys = [];
            const sectionMultiBases = new Set();
            const currentBase = EpisodeResolver.getBaseKey();

            document.querySelectorAll('.video-pod__item[data-key]').forEach(el => {
                const dataKey = el.getAttribute('data-key');
                const directKey = VideoKey.fromText(dataKey);
                const title = el.querySelector('.multi-p > .simple-base-item.head .title-txt')?.innerText ||
                    el.querySelector('.single-p .title-txt')?.innerText ||
                    el.querySelector('.title-txt')?.innerText ||
                    el.querySelector('.title')?.getAttribute('title') ||
                    el.innerText;
                const normalizedTitle = normalizeTitle(title);
                if (directKey && normalizedTitle) {
                    sectionBaseByTitle.set(normalizedTitle, directKey);
                    keyByTitle.set(normalizedTitle, directKey);
                }
                if (directKey && !el.querySelector('.page-list .simple-base-item.page-item')) {
                    sectionVideoKeys.push(directKey);
                }
                if (directKey && el.querySelector('.page-list .simple-base-item.page-item')) sectionMultiBases.add(directKey);
                add(el, dataKey, title, directKey);
            });
            document.querySelectorAll('.video-pod__list.section .video-pod__item[data-key] .page-list .simple-base-item.page-item').forEach(el => {
                const parent = el.closest('.video-pod__item[data-key]');
                const baseKey = VideoKey.fromText(parent?.getAttribute('data-key'));
                if (!baseKey) return;
                const pages = Array.from(parent.querySelectorAll('.page-list .simple-base-item.page-item'));
                const page = pages.indexOf(el) + 1;
                const key = VideoKey.withPage(baseKey, page);
                add(el, `section-page:${baseKey}:${page}`, el.querySelector('.title-txt')?.innerText || el.querySelector('.title')?.getAttribute('title') || el.innerText, key);
            });
            document.querySelectorAll('.bpx-player-ctrl-eplist-episodes').forEach(group => {
                const groupTitle = group.querySelector('.bpx-player-ctrl-eplist-episodes-title-text')?.innerText || '';
                const isActiveGroup = group.querySelector('.bpx-state-multi-active-item') || group.querySelector('.bpx-player-ctrl-eplist-multi-menu-item.bpx-state-multi-active-item');
                const baseKey = sectionBaseByTitle.get(normalizeTitle(groupTitle)) || (isActiveGroup && sectionMultiBases.has(currentBase) ? currentBase : '');
                if (!baseKey) return;
                const episodes = Array.from(group.querySelectorAll('.bpx-player-ctrl-eplist-episodes-content .bpx-player-ctrl-eplist-multi-menu-item[data-cid]'));
                episodes.forEach((el, index) => {
                    const page = index + 1;
                    const cid = el.getAttribute('data-cid');
                    const key = VideoKey.withPage(baseKey, page);
                    add(el, cid, el.querySelector('.bpx-player-ctrl-eplist-multi-menu-item-text')?.innerText || el.innerText, key);
                });
            });
            const playerMenuItems = Array.from(document.querySelectorAll('.bpx-player-ctrl-eplist-multi-menu-item[data-cid]'));
            const canMapPlayerByOrder = sectionVideoKeys.length > 1 && sectionVideoKeys.length === playerMenuItems.length;
            playerMenuItems.forEach((el, index) => {
                const title = el.querySelector('.bpx-player-ctrl-eplist-multi-menu-item-text')?.innerText || el.innerText;
                add(el, el.getAttribute('data-cid'), title, keyByTitle.get(normalizeTitle(title)) || (canMapPlayerByOrder ? sectionVideoKeys[index] : ''));
            });
            document.querySelectorAll('.action-list-item-wrap[data-key]').forEach(el => {
                const key = VideoKey.fromText(el.getAttribute('data-key'));
                if (key) {
                    const page = VideoKey.page(key);
                    const cid = `action-list:${key}`;
                    if (!seen.has(cid)) {
                        seen.add(cid);
                        items.push({
                            el,
                            cid,
                            page,
                            key,
                            base: VideoKey.base(key),
                            title: (el.querySelector('.info .title')?.getAttribute('title') || el.querySelector('.info .title')?.innerText || el.innerText || '').trim()
                        });
                    }
                }
            });

            return items;
        },
        _itemsCache: null,
        _itemsCacheInvalidator: null,
        _invalidateItemsCache: () => {
            EpisodeResolver._itemsCache = null;
            EpisodeResolver._itemsCacheInvalidator = null;
        },
        _scheduleItemsCacheInvalidation: () => {
            if (EpisodeResolver._itemsCacheInvalidator) return;
            const schedule = typeof queueMicrotask === 'function'
                ? (cb) => queueMicrotask(cb)
                : (cb) => setTimeout(cb, 0);
            EpisodeResolver._itemsCacheInvalidator = schedule(() => {
                EpisodeResolver._invalidateItemsCache();
            });
        },
        getItems: () => {
            if (EpisodeResolver._itemsCache) return EpisodeResolver._itemsCache;
            const base = EpisodeResolver.getBaseKey();
            const items = EpisodeResolver._collectItems();
            if (items.length === 0) {
                EpisodeResolver._itemsCache = [];
                EpisodeResolver._scheduleItemsCacheInvalidation();
                return EpisodeResolver._itemsCache;
            }
            const mapped = items.map(item => ({
                ...item,
                base: item.base || base,
                key: item.key || VideoKey.withPage(base, item.page)
            }));
            EpisodeResolver._itemsCache = mapped;
            EpisodeResolver._scheduleItemsCacheInvalidation();
            return mapped;
        },
        getActiveItem: () => {
            const currentBase = EpisodeResolver.getBaseKey();
            const items = EpisodeResolver.getItems().filter(item => !currentBase || item.base === currentBase || VideoKey.base(item.key) === currentBase);
            const isVisible = (item) => !item.el.closest('.page-list[style*="display:none"], .page-list[style*="display: none"]');
            return items.find(item =>
                isVisible(item) &&
                VideoKey.normalize(item.key) === currentBase &&
                item.el.matches?.('.video-pod__item[data-key]') &&
                (item.el.getAttribute('data-scrolled') === 'true' ||
                    item.el.querySelector('.single-p .simple-base-item.active') ||
                    item.el.querySelector('.single-p .playing-gif:not([style*="display: none"]):not([style*="display:none"])'))
            ) || items.find(item =>
                isVisible(item) &&
                item.el.matches?.('.video-pod__list.section .simple-base-item.page-item') &&
                (item.el.classList.contains('active') || item.el.getAttribute('data-scrolled') === 'true')
            ) || items.find(item =>
                isVisible(item) &&
                item.el.matches?.('.video-pod__list.section .simple-base-item.page-item') &&
                item.el.querySelector('.playing-gif:not([style*="display: none"]):not([style*="display:none"])')
            ) || items.find(item =>
                isVisible(item) &&
                (item.el.classList.contains('active') || item.el.classList.contains('bpx-state-multi-active-item'))
            ) || items.find(item =>
                isVisible(item) &&
                item.el.getAttribute('data-scrolled') === 'true' &&
                !item.el.querySelector('.page-list .simple-base-item.page-item.active')
            );
        },
        getCurrentPage: () => {
            const fromUrl = VideoKey.page(VideoKey.fromUrl(location.href));
            if (fromUrl > 1) return fromUrl;

            const active = EpisodeResolver.getActiveItem();
            return active?.page || fromUrl || 1;
        },
        getCurrentKey: () => {
            const base = EpisodeResolver.getBaseKey();
            const currentPage = EpisodeResolver.getCurrentPage();
            if (base && currentPage > 1) return VideoKey.withPage(base, currentPage);

            const active = EpisodeResolver.getActiveItem();
            if (active?.key && VideoKey.base(active.key) === base) return active.key;
            return base ? VideoKey.withPage(base, currentPage) : (active?.key || '');
        },
        getPageLabel: (keyOrPage) => {
            const page = typeof keyOrPage === 'number' ? keyOrPage : VideoKey.page(keyOrPage);
            return `P${page || 1}`;
        },
        getLatestRecord: (base) => {
            const done = Utils.debugTime('EpisodeResolver.getLatestRecord');
            const bvBase = VideoKey.base(base);
            if (!bvBase) {
                done('skip: empty base');
                return null;
            }
            const keys = StorageManager.getRelatedKeys(bvBase, { loadAll: true });
            let best = null;
            keys.forEach(key => {
                const record = StorageManager.getRecord(key);
                if (!record || record.status !== RECORD_STATUS.WATCHED || !record.currentTime) return;
                if (Utils.timeToSeconds(record.currentTime) < MIN_RESUME_SECONDS) return;
                const t = record.savedAt ? new Date(record.savedAt).getTime() : 0;
                if (!best || t > best.time) {
                    best = { key, record, page: VideoKey.page(key), time: t };
                }
            });
            done(`base=${bvBase} related=${keys.length} latest=${best?.key || 'none'}`);
            return best;
        },
        getEpisodeRecord: (item) => {
            if (!item?.key) return null;
            return StorageManager.getRecord(item.key);
        },
        getSeekUrl: (key) => {
            const base = VideoKey.base(key);
            const page = VideoKey.page(key);
            if (!base) return location.href;
            const url = new URL(`/video/${base}/`, location.origin);
            if (page > 1) url.searchParams.set('p', String(page));
            return url.href;
        }
    };

    // --- 数据层 (v3 分片存储架构) ---
    const SHARD_COUNT = 64;
    const STATUS_MAP = { 0: '已访问', 1: '已观看', 2: '已删除' };
    const STATUS_REVERSE = { '已访问': 0, '已观看': 1, '已删除': 2 };

    const StorageManager = {
        _shardCache: new Map(),       // shardId → { data: {...}, dirty: false }
        _bvBaseIndex: new Map(),      // bvBase → Set<fullKey>
        _shardForBase: new Map(),     // bvBase → Set<shardId>  二级索引（按需加载用）
        _allKeysCache: null,
        _changeCallbacks: [],
        _migrationCount: 0,
        _lastKnownRevision: 0,       // 多标签页同步：记录本地已知的存储版本号

        onDataChange: (cb) => {
            StorageManager._changeCallbacks.push(cb);
            Utils.log('Storage data-change listener registered:', StorageManager._changeCallbacks.length);
        },
        _notifyChange: Utils.debounce(() => {
            const start = performance.now();
            Utils.log('Storage notify change start, callbacks:', StorageManager._changeCallbacks.length);
            StorageManager._changeCallbacks.forEach(cb => cb());
            Utils.logSlow('StorageManager._notifyChange callbacks', start, `callbacks=${StorageManager._changeCallbacks.length}`, 20);
        }, 500),

        // --- 哈希函数 (FNV-1a) ---
        _getShardId: (bvId) => {
            let hash = 0x811c9dc5;
            for (let i = 0; i < bvId.length; i++) {
                hash ^= bvId.charCodeAt(i);
                hash = (hash * 0x01000193) | 0;
            }
            return Math.abs(hash) % SHARD_COUNT;
        },

        // --- 分片加载/保存 ---
        _loadShard: (shardId) => {
            if (StorageManager._shardCache.has(shardId)) {
                return StorageManager._shardCache.get(shardId);
            }
            const start = performance.now();
            const data = GM_getValue(`bvh_shard_${shardId}`, {});
            const shard = { data, dirty: false };
            StorageManager._shardCache.set(shardId, shard);
            const keys = Object.keys(data);
            // 加载时增量构建 BV 基础 ID 索引
            for (const key of keys) {
                StorageManager._indexKey(key, shardId);
            }
            Utils.logSlow('StorageManager._loadShard', start, `shard=${shardId} records=${keys.length}`, 30);
            return shard;
        },

        _flushShard: (shardId) => {
            const shard = StorageManager._shardCache.get(shardId);
            if (shard && shard.dirty) {
                const start = performance.now();
                GM_setValue(`bvh_shard_${shardId}`, shard.data);
                shard.dirty = false;
                Utils.logSlow('StorageManager._flushShard', start, `shard=${shardId} records=${Object.keys(shard.data).length}`, 30);
            }
        },

        _ensureAllShardsLoaded: () => {
            const start = performance.now();
            const before = StorageManager._shardCache.size;
            for (let i = 0; i < SHARD_COUNT; i++) {
                StorageManager._loadShard(i);
            }
            Utils.logSlow('StorageManager._ensureAllShardsLoaded', start, `loaded=${StorageManager._shardCache.size - before}/${SHARD_COUNT} cached=${StorageManager._shardCache.size}`, 50);
        },

        // --- 索引管理 ---
        _indexKey: (key, shardId) => {
            const base = VideoKey.base(key);
            if (base) {
                let set = StorageManager._bvBaseIndex.get(base);
                if (!set) { set = new Set(); StorageManager._bvBaseIndex.set(base, set); }
                set.add(key);
                // 二级索引：base → shards
                const sid = shardId !== undefined ? shardId : StorageManager._getShardId(key);
                let shardSet = StorageManager._shardForBase.get(base);
                if (!shardSet) { shardSet = new Set(); StorageManager._shardForBase.set(base, shardSet); }
                shardSet.add(sid);
            }
        },

        _removeFromIndex: (key) => {
            const base = VideoKey.base(key);
            if (base) {
                const set = StorageManager._bvBaseIndex.get(base);
                if (set) { set.delete(key); if (set.size === 0) StorageManager._bvBaseIndex.delete(base); }
                // 仅清除内存中的 keys，不清除 base→shard 映射（因为同一个 base 可能还有其他 key 在同一 shard 中）
            }
        },

        // --- 格式转换 ---
        _compact: (record) => {
            // 已经是 v3 紧凑格式
            if (typeof record.s === 'number') return record;

            // v1 数组格式: [status, currentTime, percent, savedAt, title]
            if (Array.isArray(record)) {
                const [status, currentTime, percent, savedAt, title] = record;
                return {
                    s: STATUS_REVERSE[status] ?? 0,
                    t: currentTime || '',
                    p: parseInt(percent) || 0,
                    a: savedAt ? Math.floor(new Date(savedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
                    n: title || ''
                };
            }

            // v2 对象格式: { v:2, status, currentTime, percent, savedAt, title }
            return {
                s: STATUS_REVERSE[record.status] ?? 0,
                t: record.currentTime || '',
                p: parseInt(record.percent) || 0,
                a: record.savedAt
                    ? Math.floor(new Date(record.savedAt).getTime() / 1000)
                    : Math.floor(Date.now() / 1000),
                n: record.title || ''
            };
        },

        _expand: (compact) => {
            const d = new Date(compact.a * 1000);
            const pad = n => String(n).padStart(2, '0');
            const savedAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            return {
                v: 3,
                status: STATUS_MAP[compact.s] || '已访问',
                currentTime: compact.t || '',
                percent: compact.p ? compact.p + '%' : '',
                savedAt: savedAt,
                title: compact.n || ''
            };
        },

        // --- 核心 API（对外接口与 v2 完全兼容）---
        getRecord: (id) => {
            if (!id) return null;
            id = VideoKey.normalize(id) || id;
            const shardId = StorageManager._getShardId(id);
            const shard = StorageManager._loadShard(shardId);
            const compact = shard.data[id];
            if (!compact) return null;
            return StorageManager._expand(compact);
        },

        saveRecord: (id, record, notify = true) => {
            if (!id) return;
            id = VideoKey.normalize(id) || id;
            const shardId = StorageManager._getShardId(id);
            const start = performance.now();
            const shard = StorageManager._loadShard(shardId);
            const base = VideoKey.base(id);
            // 检测 base→shard 映射是否变化（仅在新 base 出现或新增 shard 时才持久化索引）
            const shardSetBefore = base ? StorageManager._shardForBase.get(base) : null;
            const isNewShardForBase = base && (!shardSetBefore || !shardSetBefore.has(shardId));
            shard.data[id] = StorageManager._compact(record);
            shard.dirty = true;
            StorageManager._flushShard(shardId);
            StorageManager._indexKey(id, shardId);
            StorageManager._allKeysCache = null;
            StorageManager._incrementRevision();
            if (isNewShardForBase) {
                StorageManager._persistBaseIndex();
            }
            if (notify) StorageManager._notifyChange();
            Utils.logSlow('StorageManager.saveRecord', start, `key=${id} shard=${shardId} notify=${notify}`, 30);
        },

        deleteRecord: (id, notify = true) => {
            if (!id) return;
            id = VideoKey.normalize(id) || id;
            const shardId = StorageManager._getShardId(id);
            const start = performance.now();
            const shard = StorageManager._loadShard(shardId);
            const base = VideoKey.base(id);

            delete shard.data[id];
            shard.dirty = true;
            StorageManager._flushShard(shardId);
            StorageManager._removeFromIndex(id);
            StorageManager._allKeysCache = null;
            StorageManager._incrementRevision();

            if (base) {
                const hasSameBaseInThisShard = Object.keys(shard.data).some(k => VideoKey.base(k) === base);
                const shardSet = StorageManager._shardForBase.get(base);

                if (shardSet && !hasSameBaseInThisShard) {
                    shardSet.delete(shardId);
                    if (shardSet.size === 0) {
                        StorageManager._shardForBase.delete(base);
                    }
                    StorageManager._persistBaseIndex();
                }
            }

            if (notify) StorageManager._notifyChange();
            Utils.logSlow('StorageManager.deleteRecord', start, `key=${id} shard=${shardId} notify=${notify}`, 30);
        },

        saveRecords: (records, notify = true) => {
            const start = performance.now();
            const touchedShards = new Set();
            let count = 0;

            (Array.isArray(records) ? records : []).forEach(({ key, record }) => {
                if (!key || !record) return;
                const id = VideoKey.normalize(key) || key;
                if (!id) return;
                const shardId = StorageManager._getShardId(id);
                const shard = StorageManager._loadShard(shardId);
                shard.data[id] = StorageManager._compact(record);
                shard.dirty = true;
                StorageManager._indexKey(id, shardId);
                touchedShards.add(shardId);
                count++;
            });

            if (count === 0) return 0;

            for (const shardId of touchedShards) {
                StorageManager._flushShard(shardId);
            }
            StorageManager._allKeysCache = null;
            StorageManager._incrementRevision();
            StorageManager._persistBaseIndex();
            if (notify) StorageManager._notifyChange();
            Utils.logSlow('StorageManager.saveRecords', start, `records=${count} shards=${touchedShards.size} notify=${notify}`, 80);
            return count;
        },

        deleteRecords: (ids, notify = true) => {
            const start = performance.now();
            const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
                .map(id => VideoKey.normalize(id) || id)
                .filter(Boolean)));
            const touched = new Map();
            let count = 0;

            normalizedIds.forEach(id => {
                const shardId = StorageManager._getShardId(id);
                const shard = StorageManager._loadShard(shardId);
                if (!Object.prototype.hasOwnProperty.call(shard.data, id)) return;
                const base = VideoKey.base(id);
                delete shard.data[id];
                shard.dirty = true;
                StorageManager._removeFromIndex(id);
                if (!touched.has(shardId)) touched.set(shardId, new Set());
                if (base) touched.get(shardId).add(base);
                count++;
            });

            if (count === 0) return 0;

            touched.forEach((bases, shardId) => {
                const shard = StorageManager._loadShard(shardId);
                StorageManager._flushShard(shardId);
                if (bases.size === 0) return;
                const remainingBases = new Set();
                Object.keys(shard.data).forEach(key => {
                    const base = VideoKey.base(key);
                    if (base) remainingBases.add(base);
                });
                bases.forEach(base => {
                    if (remainingBases.has(base)) return;
                    const shardSet = StorageManager._shardForBase.get(base);
                    if (!shardSet) return;
                    shardSet.delete(shardId);
                    if (shardSet.size === 0) {
                        StorageManager._shardForBase.delete(base);
                    }
                });
            });

            StorageManager._allKeysCache = null;
            StorageManager._incrementRevision();
            StorageManager._persistBaseIndex();
            if (notify) StorageManager._notifyChange();
            Utils.logSlow('StorageManager.deleteRecords', start, `records=${count} shards=${touched.size} notify=${notify}`, 80);
            return count;
        },

        deleteRecordsWithProgress: (ids, onProgress, notify = true) => {
            const start = performance.now();
            const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
                .map(id => VideoKey.normalize(id) || id)
                .filter(Boolean)));
            const byShard = new Map();
            normalizedIds.forEach(id => {
                const shardId = StorageManager._getShardId(id);
                if (!byShard.has(shardId)) byShard.set(shardId, []);
                byShard.get(shardId).push(id);
            });
            const shards = Array.from(byShard.entries());
            const total = normalizedIds.length;
            let processed = 0;
            let count = 0;

            const report = (doneShards) => {
                if (typeof onProgress === 'function') {
                    onProgress({
                        processed,
                        total,
                        deleted: count,
                        shardsDone: doneShards,
                        shardsTotal: shards.length
                    });
                }
            };

            return new Promise(resolve => {
                const finish = () => {
                    if (count > 0) {
                        StorageManager._allKeysCache = null;
                        StorageManager._incrementRevision();
                        StorageManager._persistBaseIndex();
                        if (notify) StorageManager._notifyChange();
                    }
                    report(shards.length);
                    Utils.logSlow('StorageManager.deleteRecordsWithProgress', start, `records=${count} shards=${shards.length} notify=${notify}`, 80);
                    resolve(count);
                };

                const step = (index) => {
                    if (index >= shards.length) {
                        finish();
                        return;
                    }

                    const [shardId, shardIds] = shards[index];
                    const shard = StorageManager._loadShard(shardId);
                    const bases = new Set();

                    shardIds.forEach(id => {
                        if (!Object.prototype.hasOwnProperty.call(shard.data, id)) return;
                        const base = VideoKey.base(id);
                        delete shard.data[id];
                        shard.dirty = true;
                        StorageManager._removeFromIndex(id);
                        if (base) bases.add(base);
                        count++;
                    });

                    if (bases.size > 0) {
                        StorageManager._flushShard(shardId);
                        const remainingBases = new Set();
                        Object.keys(shard.data).forEach(key => {
                            const base = VideoKey.base(key);
                            if (base) remainingBases.add(base);
                        });
                        bases.forEach(base => {
                            if (remainingBases.has(base)) return;
                            const shardSet = StorageManager._shardForBase.get(base);
                            if (!shardSet) return;
                            shardSet.delete(shardId);
                            if (shardSet.size === 0) {
                                StorageManager._shardForBase.delete(base);
                            }
                        });
                    }

                    processed += shardIds.length;
                    report(index + 1);
                    setTimeout(() => step(index + 1), 0);
                };

                report(0);
                step(0);
            });
        },

        // 批量导入：defer flush / revision / index persist，最后一次性提交
        importRecords: (data) => {
            const start = performance.now();
            let count = 0;
            let skipCount = 0;
            for (const k in data) {
                if (!(typeof data[k] === 'object' || Array.isArray(data[k]))) continue;
                const id = VideoKey.normalize(k) || k;
                if (!id) continue;
                if (StorageManager.getRecord(id)) { skipCount++; continue; }
                const shardId = StorageManager._getShardId(id);
                const shard = StorageManager._loadShard(shardId);
                shard.data[id] = StorageManager._compact(data[k]);
                shard.dirty = true;
                StorageManager._indexKey(id, shardId);
                StorageManager._allKeysCache = null;
                count++;
            }
            // 批量 flush 所有脏分片
            for (const [shardId, shard] of StorageManager._shardCache) {
                if (shard.dirty) StorageManager._flushShard(shardId);
            }
            // 重建索引并写入版本号
            StorageManager._rebuildBaseIndex();
            StorageManager._incrementRevision();
            StorageManager._notifyChange();
            Utils.logSlow('StorageManager.importRecords', start, `imported=${count} skipped=${skipCount}`, 80);
            return { count, skipCount };
        },

        getAllKeys: () => {
            if (StorageManager._allKeysCache) {
                Utils.log('StorageManager.getAllKeys cache hit:', StorageManager._allKeysCache.length);
                return StorageManager._allKeysCache;
            }
            const start = performance.now();
            StorageManager._ensureAllShardsLoaded();
            const keys = [];
            for (const [, shard] of StorageManager._shardCache) {
                keys.push(...Object.keys(shard.data));
            }
            StorageManager._allKeysCache = keys;
            Utils.logSlow('StorageManager.getAllKeys', start, `keys=${keys.length}`, 50);
            return keys;
        },

        getRelatedKeys: (bvBase, options = {}) => {
            const start = performance.now();
            const shouldLoadAll = options.loadAll !== false;

            // 1. 已加载分片命中（内存 _bvBaseIndex）
            if (StorageManager._bvBaseIndex.has(bvBase)) {
                const keys = Array.from(StorageManager._bvBaseIndex.get(bvBase));
                Utils.logSlow('StorageManager.getRelatedKeys', start, `base=${bvBase} hit=memory keys=${keys.length}`, 30);
                return keys;
            }

            // 2. 从持久化索引或内存 _shardForBase 获取目标分片，按需加载
            if (!StorageManager._shardForBase.has(bvBase)) {
                StorageManager._loadPersistedBaseIndex();
            }
            const targetShards = StorageManager._shardForBase.get(bvBase);
            if (targetShards && targetShards.size > 0) {
                targetShards.forEach(sid => StorageManager._loadShard(sid));
                if (StorageManager._bvBaseIndex.has(bvBase)) {
                    const keys = Array.from(StorageManager._bvBaseIndex.get(bvBase));
                    Utils.logSlow('StorageManager.getRelatedKeys', start, `base=${bvBase} hit=on-demand shards=${targetShards.size} keys=${keys.length}`, 50);
                    return keys;
                }
            }

            // 3. 安全降级：全量加载并重建索引
            if (shouldLoadAll) {
                StorageManager._ensureAllShardsLoaded();
                StorageManager._rebuildBaseIndex();
                const set = StorageManager._bvBaseIndex.get(bvBase);
                const keys = set ? Array.from(set) : [];
                Utils.logSlow('StorageManager.getRelatedKeys', start, `base=${bvBase} hit=fallback keys=${keys.length}`, 80);
                return keys;
            }

            Utils.logSlow('StorageManager.getRelatedKeys', start, `base=${bvBase} hit=miss`, 30);
            return [];
        },

        getAllRecords: () => {
            const start = performance.now();
            const data = [];
            StorageManager.getAllKeys().forEach(k => {
                const record = StorageManager.getRecord(k);
                if (record) data.push({ key: k, record });
            });
            Utils.logSlow('StorageManager.getAllRecords', start, `records=${data.length}`, 80);
            return data;
        },

        getStatsBundle: (days = 30) => {
            const start = performance.now();
            const now = Date.now();
            const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
            const cutoff = now - days * 24 * 60 * 60 * 1000;
            const formatLocalMD = (ts) => {
                const d = new Date(ts);
                return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };

            const cards = { total: 0, watched: 0, visited: 0, low: 0, mid: 0, high: 0, recent7Days: 0, unfinished: 0 };
            const chartStatus = { watched: 0, visited: 0 };
            const chartProgress = { low: 0, mid: 0, high: 0 };
            const dailyMap = new Map();

            StorageManager.getAllRecords().forEach(({ record }) => {
                cards.total++;
                if (record.status === RECORD_STATUS.WATCHED) { cards.watched++; chartStatus.watched++; }
                if (record.status === RECORD_STATUS.VISITED) { cards.visited++; chartStatus.visited++; }
                const percent = parseInt(record.percent);
                if (!isNaN(percent)) {
                    if (percent < CONFIG.lowThreshold) { cards.low++; chartProgress.low++; }
                    else if (percent <= CONFIG.highThreshold) { cards.mid++; chartProgress.mid++; }
                    else { cards.high++; chartProgress.high++; }
                    if (percent < CONFIG.highThreshold) cards.unfinished++;
                }
                const savedTime = record.savedAt ? new Date(record.savedAt).getTime() : 0;
                if (savedTime >= weekAgo) cards.recent7Days++;
                if (savedTime >= cutoff) {
                    const dateKey = formatLocalMD(savedTime);
                    dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + 1);
                }
            });

            const recentDays = [];
            for (let d = days - 1; d >= 0; d--) {
                const key = formatLocalMD(now - d * 24 * 60 * 60 * 1000);
                recentDays.push({ date: key, value: dailyMap.get(key) || 0 });
            }

            const progressTotal = chartProgress.low + chartProgress.mid + chartProgress.high;

            Utils.logSlow('StorageManager.getStatsBundle', start, `days=${days} total=${cards.total}`, 80);
            return {
                cards,
                charts: {
                    status: [
                        { label: '已观看', value: chartStatus.watched },
                        { label: '已访问', value: chartStatus.visited }
                    ],
                    progress: [
                        { label: '低进度', value: chartProgress.low },
                        { label: '中进度', value: chartProgress.mid },
                        { label: '高进度', value: chartProgress.high }
                    ],
                    recentDays,
                    completion: {
                        total: cards.total,
                        unfinished: cards.total - chartProgress.high,
                        finished: chartProgress.high
                    }
                }
            };
        },

        // --- localStorage 备份恢复 ---
        restoreFromLocalStorage: () => {
            const start = performance.now();
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(BACKUP_PREFIX)) {
                    try {
                        const tempValue = JSON.parse(localStorage.getItem(key));
                        if (tempValue && tempValue.key && tempValue.value) {
                            StorageManager.saveRecord(tempValue.key, tempValue.value, false);
                        }
                    } catch (e) { }
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            Utils.log('StorageManager.restoreFromLocalStorage done:', keysToRemove.length, `cost=${(performance.now() - start).toFixed(1)}ms`);
        },

        cleanupLocalStorageBackups: () => {
            const start = performance.now();
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(BACKUP_PREFIX)) continue;
                let savedAt = 0;
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    savedAt = value?.savedAt || value?.ts || 0;
                    if (!savedAt && value?.value?.savedAt) savedAt = new Date(value.value.savedAt).getTime();
                } catch (e) { }
                backups.push({ key, savedAt: savedAt || 0 });
            }
            const now = Date.now();
            backups
                .filter(item => !item.savedAt || now - item.savedAt > BACKUP_MAX_AGE)
                .forEach(item => localStorage.removeItem(item.key));
            const remaining = backups
                .filter(item => localStorage.getItem(item.key) !== null)
                .sort((a, b) => b.savedAt - a.savedAt);
            remaining.slice(BACKUP_MAX_COUNT).forEach(item => localStorage.removeItem(item.key));
            Utils.logSlow('StorageManager.cleanupLocalStorageBackups', start, `found=${backups.length} remaining=${remaining.length}`, 50);
        },

        cleanupLocalStorageBackupsThrottled: null,

        // --- 数据迁移 (v1/v2 → v3 分片) ---
        migrateIfNeeded: () => {
            const done = Utils.debugTime('StorageManager.migrateIfNeeded');
            const meta = GM_getValue('bvh_meta');
            if (meta && meta.version === 3) {
                // 初始化版本号，避免首次 visibilitychange 误判 stale
                StorageManager._lastKnownRevision = GM_getValue(StorageManager._REVISION_KEY, 0) || 0;
                // 已有 v3 用户首次升级到含 base 索引的版本：检查并重建持久化索引
                if (!GM_getValue(StorageManager._BASE_INDEX_KEY)) {
                    Utils.log('migrateIfNeeded: v3 user upgrading to base-index, rebuilding...');
                    StorageManager._rebuildBaseIndex();
                    StorageManager._lastKnownRevision = GM_getValue(StorageManager._REVISION_KEY, 0) || 0;
                }
                done('already v3');
                return; // 已完成迁移
            }

            const allKeys = GM_listValues();
            const bvKeys = allKeys.filter(k => VideoKey.isValid(k));

            if (bvKeys.length === 0) {
                // 全新安装，直接标记为 v3
                GM_setValue('bvh_meta', { version: 3, shardCount: SHARD_COUNT, totalRecords: 0, migratedAt: Date.now() });
                StorageManager._lastKnownRevision = StorageManager._incrementRevision();
                StorageManager._persistBaseIndex();
                done('new install');
                return;
            }

            Utils.log(`开始迁移 ${bvKeys.length} 条记录到分片存储...`);

            // 初始化空分片
            const shards = new Array(SHARD_COUNT).fill(null).map(() => ({}));
            let migratedCount = 0;

            for (const key of bvKeys) {
                const oldRecord = GM_getValue(key);
                if (!oldRecord) continue;

                const normalizedKey = VideoKey.normalize(key) || key;
                const compact = StorageManager._compact(oldRecord);
                const shardId = StorageManager._getShardId(normalizedKey);
                shards[shardId][normalizedKey] = compact;
                migratedCount++;
            }

            // 批量写入分片（合并已有分片数据，防止覆盖其他来源的分片数据）
            for (let i = 0; i < SHARD_COUNT; i++) {
                if (Object.keys(shards[i]).length > 0) {
                    const existing = GM_getValue(`bvh_shard_${i}`, {});
                    GM_setValue(`bvh_shard_${i}`, Object.assign(existing, shards[i]));
                }
            }

            // 写入元数据标记
            GM_setValue('bvh_meta', {
                version: 3,
                shardCount: SHARD_COUNT,
                totalRecords: migratedCount,
                migratedAt: Date.now()
            });

            // 删除旧键（最后执行，崩溃安全：即使失败，重启后会重新迁移）
            for (const key of bvKeys) {
                GM_deleteValue(key);
            }

            Utils.log(`迁移完成：${migratedCount} 条记录`);
            StorageManager._migrationCount = migratedCount;
            // 重建持久化 base 索引
            StorageManager._rebuildBaseIndex();
            StorageManager._lastKnownRevision = StorageManager._incrementRevision();
            done(`migrated=${migratedCount}`);
        },

        // --- 持久化 base→shard 索引 + 存储版本号 ---
        _BASE_INDEX_KEY: 'bvh_base_index',
        _REVISION_KEY: 'bvh_storage_revision',
        _BASE_INDEX_VERSION: 1,

        _incrementRevision: () => {
            const rev = (GM_getValue(StorageManager._REVISION_KEY, 0) || 0) + 1;
            GM_setValue(StorageManager._REVISION_KEY, rev);
            StorageManager._lastKnownRevision = rev;
            return rev;
        },

        _persistBaseIndex: () => {
            const index = {};
            StorageManager._shardForBase.forEach((shardIds, base) => {
                index[base] = Array.from(shardIds);
            });
            GM_setValue(StorageManager._BASE_INDEX_KEY, {
                version: StorageManager._BASE_INDEX_VERSION,
                revision: GM_getValue(StorageManager._REVISION_KEY, 0) || 0,
                index
            });
        },

        _loadPersistedBaseIndex: () => {
            const persisted = GM_getValue(StorageManager._BASE_INDEX_KEY);
            if (!persisted || persisted.version !== StorageManager._BASE_INDEX_VERSION) return false;
            const index = persisted.index;
            if (!index || typeof index !== 'object') return false;
            let loaded = 0;
            for (const base of Object.keys(index)) {
                const shardIds = index[base];
                if (Array.isArray(shardIds) && shardIds.length > 0) {
                    const shardSet = new Set(shardIds);
                    StorageManager._shardForBase.set(base, shardSet);
                    loaded++;
                }
            }
            Utils.log('StorageManager._loadPersistedBaseIndex', `loaded=${loaded} bases`);
            return loaded > 0;
        },

        _rebuildBaseIndex: () => {
            const start = performance.now();
            StorageManager._bvBaseIndex.clear();
            StorageManager._shardForBase.clear();
            for (let i = 0; i < SHARD_COUNT; i++) {
                StorageManager._loadShard(i);
            }
            // 对已缓存的分片确保全部键被重新索引（_loadShard 对已缓存分片不会重复索引）
            for (const [shardId, shard] of StorageManager._shardCache) {
                for (const key of Object.keys(shard.data)) {
                    StorageManager._indexKey(key, shardId);
                }
            }
            StorageManager._persistBaseIndex();
            Utils.logSlow('StorageManager._rebuildBaseIndex', start, `bases=${StorageManager._shardForBase.size} shards=${StorageManager._shardCache.size}`, 80);
        },

        // --- 多标签页切换时同步（基于版本号） ---
        _syncIfStale: () => {
            const remoteRev = GM_getValue(StorageManager._REVISION_KEY, 0) || 0;
            if (remoteRev > StorageManager._lastKnownRevision) {
                Utils.log('StorageManager._syncIfStale: stale detected', `local=${StorageManager._lastKnownRevision}`, `remote=${remoteRev}`);
                StorageManager._shardCache.clear();
                StorageManager._bvBaseIndex.clear();
                StorageManager._shardForBase.clear();
                StorageManager._allKeysCache = null;
                StorageManager._lastKnownRevision = remoteRev;
                StorageManager._loadPersistedBaseIndex();
                return true;
            }
            return false;
        },

        invalidateCache: () => {
            Utils.log('StorageManager.invalidateCache', `cachedShards=${StorageManager._shardCache.size}`, `indexedBases=${StorageManager._bvBaseIndex.size}`);
            StorageManager._shardCache.clear();
            StorageManager._bvBaseIndex.clear();
            StorageManager._shardForBase.clear();
            StorageManager._allKeysCache = null;
        }
    };
    StorageManager.cleanupLocalStorageBackupsThrottled = Utils.throttle(StorageManager.cleanupLocalStorageBackups, 30000);
    VideoKey.latestRelatedRecord = (base) => EpisodeResolver.getLatestRecord(base);

    // --- UI层 ---
    const UIComponent = {
        toastContainer: null,
        initToastContainer: () => {
            if (!UIComponent.toastContainer) {
                UIComponent.toastContainer = document.createElement('div');
                UIComponent.toastContainer.className = 'bvh-toast-container';
                document.body.appendChild(UIComponent.toastContainer);
            }
        },
        toast: (msg, type = 'success', duration = 3000) => {
            UIComponent.initToastContainer();
            const el = document.createElement('div');
            el.className = `bvh-toast ${type}`;
            el.innerText = msg;
            UIComponent.toastContainer.appendChild(el);
            setTimeout(() => el.classList.add('show'), 10);
            setTimeout(() => {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            }, duration);
            return el;
        },
        toastUndo: (msg, duration = 5000, onUndo) => {
            const el = UIComponent.toast(msg, 'success', duration);
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                onUndo();
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            });
        },
        progressToast: (msg) => {
            UIComponent.initToastContainer();
            const el = document.createElement('div');
            el.className = 'bvh-toast success bvh-progress-toast';

            const text = document.createElement('div');
            text.className = 'bvh-toast-progress-text';
            text.innerText = msg;

            const track = document.createElement('div');
            track.className = 'bvh-toast-progress-track';
            const fill = document.createElement('div');
            fill.className = 'bvh-toast-progress-fill';
            track.appendChild(fill);

            el.appendChild(text);
            el.appendChild(track);
            UIComponent.toastContainer.appendChild(el);
            setTimeout(() => el.classList.add('show'), 10);

            const close = (message, type = 'success', duration = 2500) => {
                text.innerText = message;
                fill.style.width = '100%';
                el.classList.toggle('error', type === 'error');
                el.classList.toggle('success', type !== 'error');
                setTimeout(() => {
                    el.classList.remove('show');
                    setTimeout(() => el.remove(), 300);
                }, duration);
            };

            return {
                update: (percent, message) => {
                    const safePercent = Math.max(0, Math.min(100, Math.round(percent) || 0));
                    fill.style.width = `${safePercent}%`;
                    if (message) text.innerText = message;
                },
                close
            };
        },
        createTag: (text, title, className = 'bvh-tag') => {
            const el = document.createElement('div');
            el.className = className;
            el.title = title;
            el.innerText = text;
            el.style.opacity = String(Math.max(40, Math.min(100, CONFIG.tagOpacity)) / 100);
            const pos = CONFIG.tagPosition;
            if (pos.includes('right')) el.style.right = '0';
            else el.style.left = '0';
            if (pos.includes('bottom')) el.style.bottom = '0';
            else el.style.top = '0';
            return el;
        },
        createProgressBar: (percent) => {
            const el = document.createElement('div');
            el.className = 'bvh-progress-bar';
            let width = parseFloat(percent);
            if (isNaN(width) || width < 3) width = 3;
            el.style.width = `${width}%`;
            return el;
        },
        showViewPanel: (record, bvId) => {
            const existing = document.getElementById('bvh-view-panel');
            if (existing) existing.remove();

            if (!record) return;

            const el = document.createElement('div');
            el.id = 'bvh-view-panel';
            el.className = 'bvh-view-panel';
            el.dataset.bvhKey = bvId;

            // 恢复上次保存的位置
            const savedPos = GM_getValue('bvh_panel_position');
            if (savedPos) {
                el.style.left = savedPos.left;
                el.style.top = savedPos.top;
            } else {
                el.style.left = '15px';
                el.style.bottom = '15px';
            }

            let titleText = bvId;
            if (record.currentTime) {
                titleText += '\n左键单击打开设置与历史管理\n拖拽以移动面板';
            } else {
                titleText += '\n左键单击打开设置与历史管理\n拖拽以移动面板';
            }
            el.title = titleText;

            const p1 = document.createElement('p');
            p1.style.cssText = "margin:5px 10px 5px 10px; pointer-events:none;";
            let currentStr = record.currentTime ? ` \n${record.currentTime}(${record.percent})` : '';
            const pagePrefix = VideoKey.page(bvId) > 1 ? `${EpisodeResolver.getPageLabel(bvId)} ` : '';
            p1.innerText = `${pagePrefix}${record.status}${currentStr}`;

            const p2 = document.createElement('p');
            p2.style.cssText = "margin:0 10px 5px 10px; pointer-events:none;";
            const timeParts = record.savedAt ? record.savedAt.split(" ") : ["", ""];
            p2.innerText = `${timeParts[0]}\n${timeParts[1] || ''}`;

            el.appendChild(p1);
            el.appendChild(p2);

            // 拖拽与点击事件处理
            el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // 仅左键触发
                let isDragging = false;
                const startX = e.clientX;
                const startY = e.clientY;
                const rect = el.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;

                const onMouseMove = (moveEvent) => {
                    if (Math.abs(moveEvent.clientX - startX) > 5 || Math.abs(moveEvent.clientY - startY) > 5) {
                        isDragging = true;
                    }
                    if (isDragging) {
                        el.style.left = `${moveEvent.clientX - offsetX}px`;
                        el.style.bottom = 'auto'; // 取消 bottom 以免互相冲突
                        el.style.top = `${moveEvent.clientY - offsetY}px`;
                    }
                };

                const onMouseUp = (upEvent) => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    if (isDragging) {
                        GM_setValue('bvh_panel_position', {
                            left: el.style.left,
                            top: el.style.top
                        });
                    } else {
                        UIComponent.showManagerPanel({ activeTab: 'settings', currentKey: bvId });
                    }
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            document.body.appendChild(el);
            const quickEntry = document.getElementById('bvh-quick-entry');
            if (quickEntry) quickEntry.remove();
        },
        updateViewPanelProgress: (record) => {
            const panel = document.getElementById('bvh-view-panel');
            if (!panel || !record) return;

            const p1 = panel.querySelector('p:first-child');
            if (p1) {
                let currentStr = record.currentTime ? ` \n${record.currentTime}(${record.percent})` : '';
                const key = panel.dataset.bvhKey || '';
                const pagePrefix = VideoKey.page(key) > 1 ? `${EpisodeResolver.getPageLabel(key)} ` : '';
                p1.innerText = `${pagePrefix}${record.status}${currentStr}`;
            }
            const p2 = panel.querySelector('p:nth-child(2)');
            if (p2) {
                const timeParts = record.savedAt ? record.savedAt.split(" ") : ["", ""];
                p2.innerText = `${timeParts[0]}\n${timeParts[1] || ''}`;
            }
        },
        showQuickEntry: () => {
            let el = document.getElementById('bvh-quick-entry');
            const panel = document.getElementById('bvh-view-panel');
            if (panel) {
                if (el) el.remove();
                return;
            }
            if (!el) {
                el = document.createElement('button');
                el.id = 'bvh-quick-entry';
                el.className = 'bvh-quick-entry';
                el.type = 'button';
                el.innerText = '脚本设置';
                el.title = '打开 Bilibili 观看历史记录设置与历史管理';
                el.addEventListener('click', () => UIComponent.showManagerPanel({ activeTab: 'settings' }));
                document.body.appendChild(el);
            }
        },
        jumpToProgress: (record) => {
            if (!record?.currentTime) {
                Utils.log('UIComponent.jumpToProgress skipped: no currentTime');
                return;
            }
            const video = document.querySelector("#bilibili-player video, bwp-video");
            if (video) {
                Utils.log('UIComponent.jumpToProgress', record.currentTime, record.percent || '');
                video.currentTime = Utils.timeToSeconds(record.currentTime);
                video.play();
                UIComponent.toast(`已跳转到 ${record.currentTime}`, 'success', 2000);
            } else {
                Utils.warn('UIComponent.jumpToProgress skipped: video element not found');
            }
        },
        resumeToRecord: (target) => {
            if (!target?.record?.currentTime) {
                Utils.log('UIComponent.resumeToRecord skipped: no target currentTime');
                return;
            }
            const currentKey = EpisodeResolver.getCurrentKey() || VideoKey.fromUrl(location.href);
            if (!target.key || VideoKey.normalize(target.key) === VideoKey.normalize(currentKey)) {
                Utils.log('UIComponent.resumeToRecord same page', `current=${currentKey}`, `target=${target.key || 'none'}`);
                UIComponent.jumpToProgress(target.record);
                return;
            }

            const targetUrl = EpisodeResolver.getSeekUrl(target.key);
            Utils.log('UIComponent.resumeToRecord navigate', `current=${currentKey}`, `target=${target.key}`, `url=${targetUrl}`);
            sessionStorage.setItem(PENDING_SEEK_KEY, JSON.stringify({
                key: target.key,
                currentTime: target.record.currentTime,
                savedAt: Date.now()
            }));
            location.href = targetUrl;
        },
        applyPendingSeek: (currentKey, video) => {
            if (!currentKey || !video) return;
            let pending = null;
            try {
                pending = JSON.parse(sessionStorage.getItem(PENDING_SEEK_KEY) || 'null');
            } catch (e) { }
            if (!pending || VideoKey.normalize(pending.key) !== VideoKey.normalize(currentKey)) {
                if (pending) Utils.log('UIComponent.applyPendingSeek skip: key mismatch', `pending=${pending.key}`, `current=${currentKey}`);
                return;
            }
            if (Date.now() - (pending.savedAt || 0) > 60000) {
                Utils.log('UIComponent.applyPendingSeek expired', pending);
                sessionStorage.removeItem(PENDING_SEEK_KEY);
                return;
            }
            const seek = () => {
                Utils.log('UIComponent.applyPendingSeek seek', `key=${currentKey}`, `time=${pending.currentTime}`);
                video.currentTime = Utils.timeToSeconds(pending.currentTime);
                video.play();
                sessionStorage.removeItem(PENDING_SEEK_KEY);
                UIComponent.toast(`已跳转到 ${EpisodeResolver.getPageLabel(currentKey)} ${pending.currentTime}`, 'success', 2500);
            };
            if (video.readyState >= 1) seek();
            else video.addEventListener('loadedmetadata', seek, { once: true });
        },
        showResumePrompt: (target, onStartFresh) => {
            const record = target?.record || target;
            const resumeSeconds = Utils.timeToSeconds(record?.currentTime);
            if (!CONFIG.autoResumePrompt || !record?.currentTime || resumeSeconds < MIN_RESUME_SECONDS) {
                Utils.log('UIComponent.showResumePrompt skipped', `auto=${CONFIG.autoResumePrompt}`, `hasTime=${!!record?.currentTime}`, `seconds=${resumeSeconds}`);
                return;
            }
            if (document.getElementById('bvh-resume')) {
                Utils.log('UIComponent.showResumePrompt skipped: prompt exists');
                return;
            }
            const label = target?.key ? `${EpisodeResolver.getPageLabel(target.key)} ` : '';
            Utils.log('UIComponent.showResumePrompt show', `key=${target?.key || 'current'}`, `time=${record.currentTime}`, `percent=${record.percent || ''}`);
            const el = document.createElement('div');
            el.id = 'bvh-resume';
            el.className = 'bvh-resume';
            el.innerHTML = `<span>上次看到 ${Utils.escapeHTML(label)}${Utils.escapeHTML(record.currentTime)} (${Utils.escapeHTML(record.percent || '')})</span>
                <button class="bvh-btn primary" data-action="resume">继续播放</button>
                <button class="bvh-btn" data-action="fresh">从头播放</button>
                <button class="bvh-btn" data-action="close">关闭</button>`;
            el.addEventListener('click', (e) => {
                const action = e.target?.dataset?.action;
                if (!action) return;
                if (action === 'resume') UIComponent.resumeToRecord(target?.record ? target : { record });
                if (action === 'fresh' && onStartFresh) onStartFresh();
                el.remove();
            });
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 15000);
        },
        showManagerPanel: (options = {}) => {
            const old = document.getElementById('bvh-modal-mask');
            if (old) old.remove();

            const activeTab = options.activeTab || 'settings';
            const mask = document.createElement('div');
            mask.id = 'bvh-modal-mask';
            mask.className = 'bvh-modal-mask';
            mask.innerHTML = `
                <div class="bvh-modal" role="dialog" aria-modal="true">
                    <div class="bvh-modal-header">
                        <div class="bvh-modal-title">Bilibili 观看历史记录</div>
                        <button class="bvh-modal-close" data-action="close">×</button>
                    </div>
                    <div class="bvh-tabs">
                        <button class="bvh-tab" data-tab="settings">设置</button>
                        <button class="bvh-tab" data-tab="history">历史管理</button>
                        <button class="bvh-tab" data-tab="stats">统计</button>
                    </div>
                    <div class="bvh-modal-body">
                        <section class="bvh-pane" data-pane="settings"></section>
                        <section class="bvh-pane" data-pane="history"></section>
                        <section class="bvh-pane" data-pane="stats"></section>
                    </div>
                </div>`;
            document.body.appendChild(mask);

            const state = {
                tab: activeTab,
                query: '',
                status: 'all',
                sort: 'savedAt-desc',
                page: 1,
                pageSize: 20,
                selected: new Set(),
                statsRange: 30,
                _dataReady: false,
                _cachedRows: null
            };

            const renderTabs = () => {
                mask.querySelectorAll('.bvh-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === state.tab));
                mask.querySelectorAll('.bvh-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === state.tab));
            };

            const renderSettings = () => {
                const pane = mask.querySelector('[data-pane="settings"]');
                const currentRecord = options.currentKey ? StorageManager.getRecord(options.currentKey) : null;
                pane.innerHTML = `
                    <div class="bvh-settings-card">
                        <p class="bvh-section-title">显示与提示</p>
                        <div class="bvh-grid">
                            <div class="bvh-field"><label>显示进度条</label><input type="checkbox" data-setting="showProgressBar" ${CONFIG.showProgressBar ? 'checked' : ''}></div>
                            <div class="bvh-field"><label>显示已访问标记</label><input type="checkbox" data-setting="showVisitedTag" ${CONFIG.showVisitedTag ? 'checked' : ''}></div>
                            <div class="bvh-field"><label>自动续播提示</label><input type="checkbox" data-setting="autoResumePrompt" ${CONFIG.autoResumePrompt ? 'checked' : ''}></div>
                            <div class="bvh-field"><label>调试日志</label><input type="checkbox" data-setting="debug" ${CONFIG.debug ? 'checked' : ''}></div>
                        </div>
                    </div>
                    <div class="bvh-settings-card">
                        <p class="bvh-section-title">标签样式</p>
                        <div class="bvh-grid">
                            <div class="bvh-field"><label>标签透明度</label><div class="bvh-opacity-control">
                                <input type="range" min="40" max="100" data-setting="tagOpacity" data-opacity-range value="${CONFIG.tagOpacity}">
                                <input type="number" min="40" max="100" data-setting="tagOpacity" data-opacity-input value="${CONFIG.tagOpacity}">
                            </div></div>
                            <div class="bvh-field"><label>标签位置</label><select data-setting="tagPosition">
                                <option value="top-left" ${CONFIG.tagPosition === 'top-left' ? 'selected' : ''}>左上</option>
                                <option value="top-right" ${CONFIG.tagPosition === 'top-right' ? 'selected' : ''}>右上</option>
                                <option value="bottom-left" ${CONFIG.tagPosition === 'bottom-left' ? 'selected' : ''}>左下</option>
                                <option value="bottom-right" ${CONFIG.tagPosition === 'bottom-right' ? 'selected' : ''}>右下</option>
                            </select></div>
                            <div class="bvh-field"><label>低进度阈值</label><input type="number" min="1" max="99" data-setting="lowThreshold" value="${CONFIG.lowThreshold}"></div>
                            <div class="bvh-field"><label>高进度阈值</label><input type="number" min="1" max="99" data-setting="highThreshold" value="${CONFIG.highThreshold}"></div>
                        </div>
                    </div>
                    <div class="bvh-actions">
                        <button class="bvh-btn primary" data-action="save-settings">保存设置</button>
                        <button class="bvh-btn" data-action="reset-settings">恢复默认设置</button>
                        <button class="bvh-btn" data-action="download-debug-log">下载调试日志</button>
                        <button class="bvh-btn" data-action="clear-debug-log">清空调试日志</button>
                        <button class="bvh-btn" data-action="reset-panel">恢复左下角面板位置</button>
                        ${currentRecord?.currentTime ? '<button class="bvh-btn primary" data-action="jump-current">跳转当前视频进度</button>' : ''}
                    </div>`;
            };

            const getFilteredRows = () => {
                if (state._cachedRows) return state._cachedRows;
                const query = state.query.trim().toLowerCase();
                let rows = StorageManager.getAllRecords();
                if (query) {
                    rows = rows.filter(({ key, record }) => key.toLowerCase().includes(query) || (record.title || '').toLowerCase().includes(query));
                }
                if (state.status !== 'all') {
                    rows = rows.filter(({ record }) => record.status === state.status);
                }
                rows.sort((a, b) => {
                    if (state.sort === 'percent-desc') return (parseInt(b.record.percent) || 0) - (parseInt(a.record.percent) || 0);
                    if (state.sort === 'percent-asc') return (parseInt(a.record.percent) || 0) - (parseInt(b.record.percent) || 0);
                    if (state.sort === 'title-asc') return (a.record.title || '').localeCompare(b.record.title || '');
                    const at = new Date(a.record.savedAt || 0).getTime();
                    const bt = new Date(b.record.savedAt || 0).getTime();
                    return state.sort === 'savedAt-asc' ? at - bt : bt - at;
                });
                state._cachedRows = rows;
                return rows;
            };

            const renderHistoryShell = () => {
                const pane = mask.querySelector('[data-pane="history"]');
                const existingToolbar = pane.querySelector('.bvh-history-toolbar');
                if (!existingToolbar) {
                    pane.innerHTML = `
                        <div class="bvh-history-toolbar">
                            <div class="bvh-actions bvh-actions-search">
                                <input class="bvh-search" data-action="search" placeholder="搜索标题 / BV / av" value="${Utils.escapeHTML(state.query)}">
                                <button class="bvh-btn" data-action="clear-search" title="清空搜索">✕</button>
                            </div>
                            <div class="bvh-actions bvh-actions-bar">
                                <select data-action="status-filter">
                                    <option value="all" ${state.status === 'all' ? 'selected' : ''}>全部状态</option>
                                    <option value="${RECORD_STATUS.WATCHED}" ${state.status === RECORD_STATUS.WATCHED ? 'selected' : ''}>已观看</option>
                                    <option value="${RECORD_STATUS.VISITED}" ${state.status === RECORD_STATUS.VISITED ? 'selected' : ''}>已访问</option>
                                </select>
                                <select data-action="sort">
                                    <option value="savedAt-desc" ${state.sort === 'savedAt-desc' ? 'selected' : ''}>最近优先</option>
                                    <option value="savedAt-asc" ${state.sort === 'savedAt-asc' ? 'selected' : ''}>最早优先</option>
                                    <option value="percent-desc" ${state.sort === 'percent-desc' ? 'selected' : ''}>进度高优先</option>
                                    <option value="percent-asc" ${state.sort === 'percent-asc' ? 'selected' : ''}>进度低优先</option>
                                    <option value="title-asc" ${state.sort === 'title-asc' ? 'selected' : ''}>标题排序</option>
                                </select>
                                <span class="bvh-actions-spacer"></span>
                                <div class="bvh-retention-cleanup">
                                    <span class="bvh-retention-label">保留</span>
                                    <input type="text" inputmode="numeric" pattern="[0-9]*" data-action="retention-value" placeholder="N" aria-label="保留数量">
                                    <select data-action="retention-unit" aria-label="保留单位">
                                        <option value="days">天</option>
                                        <option value="months">月</option>
                                        <option value="years">年</option>
                                    </select>
                                    <button class="bvh-btn danger" data-action="cleanup-retention">清理久远记录</button>
                                </div>
                                <button class="bvh-btn" data-action="export">导出</button>
                                <button class="bvh-btn" data-action="import">导入</button>
                                <button class="bvh-btn danger" data-action="delete-selected">删除选中</button>
                            </div>
                        </div>
                        <div class="bvh-history-results"></div>`;
                } else {
                    existingToolbar.querySelector('[data-action="status-filter"]').value = state.status;
                    existingToolbar.querySelector('[data-action="sort"]').value = state.sort;
                    const searchInput = existingToolbar.querySelector('[data-action="search"]');
                    if (searchInput && searchInput !== document.activeElement) {
                        searchInput.value = state.query;
                    }
                }
            };

            const renderHistoryResults = () => {
                const resultsContainer = mask.querySelector('.bvh-history-results');
                if (!resultsContainer) return;
                const rows = getFilteredRows();
                const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize));
                if (state.page > pageCount) state.page = pageCount;
                if (state.page < 1) state.page = 1;
                const start = (state.page - 1) * state.pageSize;
                const visibleRows = rows.slice(start, start + state.pageSize);
                const displayStart = rows.length ? start + 1 : 0;
                const displayEnd = start + visibleRows.length;
                const pageKeys = visibleRows.map(({ key }) => key);
                const selectedOnPage = pageKeys.filter(key => state.selected.has(key)).length;
                const allSelected = pageKeys.length > 0 && selectedOnPage === pageKeys.length;
                const partialSelected = selectedOnPage > 0 && !allSelected;
                resultsContainer.innerHTML = `
                    <p class="bvh-history-summary">共 ${rows.length} 条，当前显示 ${displayStart}-${displayEnd} 条</p>
                    <table class="bvh-table">
                        <thead><tr><th><input type="checkbox" data-action="select-all" ${allSelected ? 'checked' : ''}></th><th>标题</th><th>Key</th><th>状态</th><th>进度</th><th>时间</th><th>操作</th></tr></thead>
                        <tbody>${visibleRows.map(({ key, record }) => `
                            <tr>
                                <td><input type="checkbox" data-key="${Utils.escapeHTML(key)}" ${state.selected.has(key) ? 'checked' : ''}></td>
                                <td title="${Utils.escapeHTML(record.title || '')}">${Utils.escapeHTML(record.title || '(无标题)')}</td>
                                <td>${Utils.escapeHTML(key)}</td>
                                <td>${Utils.escapeHTML(record.status)}</td>
                                <td>${Utils.escapeHTML(record.percent || '')}</td>
                                <td>${Utils.escapeHTML(record.savedAt || '')}</td>
                                <td><button class="bvh-btn danger" data-action="delete-one" data-key="${Utils.escapeHTML(key)}">删除</button></td>
                            </tr>`).join('')}</tbody>
                    </table>
                    ${rows.length === 0 && state.query ? '<p class="bvh-chart-empty">没有找到匹配的历史记录</p>' : ''}
                    <div class="bvh-pagination">
                        <button class="bvh-btn" data-action="page-first" ${state.page <= 1 ? 'disabled' : ''}>首页</button>
                        <button class="bvh-btn" data-action="page-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
                        <span>第 ${state.page} / ${pageCount} 页</span>
                        <button class="bvh-btn" data-action="page-next" ${state.page >= pageCount ? 'disabled' : ''}>下一页</button>
                        <button class="bvh-btn" data-action="page-last" ${state.page >= pageCount ? 'disabled' : ''}>末页</button>
                        <span>每页</span>
                        <select data-action="page-size">
                            <option value="20" ${state.pageSize === 20 ? 'selected' : ''}>20</option>
                            <option value="30" ${state.pageSize === 30 ? 'selected' : ''}>30</option>
                            <option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50</option>
                            <option value="100" ${state.pageSize === 100 ? 'selected' : ''}>100</option>
                        </select>
                    </div>`;
                if (partialSelected) {
                    const selectAllCb = resultsContainer.querySelector('[data-action="select-all"]');
                    if (selectAllCb) selectAllCb.indeterminate = true;
                }
            };

            const renderHistory = () => {
                renderHistoryShell();
                if (!state._dataReady) {
                    const resultsContainer = mask.querySelector('.bvh-history-results');
                    if (resultsContainer) {
                        resultsContainer.innerHTML = '<p class="bvh-history-loading">加载中...</p>';
                    }
                }
                setTimeout(() => {
                    state._cachedRows = null;
                    state._dataReady = true;
                    renderHistoryResults();
                }, 0);
            };

            const renderMiniBarChart = (items) => {
                const max = Math.max(1, ...items.map(item => item.value));
                if (!items.some(item => item.value > 0)) {
                    return '<div class="bvh-chart-empty">暂无数据</div>';
                }
                return items.map(item => {
                    const percent = Math.round((item.value / max) * 100);
                    const fillColor = item.color || '#00aeec';
                    return `
                        <div class="bvh-chart-row">
                            <span class="bvh-chart-label">${Utils.escapeHTML(item.label)}</span>
                            <div class="bvh-chart-bar-track">
                                <div class="bvh-chart-bar-fill" style="width:${percent}%;background:${fillColor}"></div>
                            </div>
                            <strong class="bvh-chart-value">${item.value}</strong>
                        </div>`;
                }).join('');
            };

            const renderDailySvgChart = (items) => {
                if (!items.length || !items.some(item => item.value > 0)) {
                    return '<div class="bvh-chart-empty">暂无数据</div>';
                }
                const max = Math.max(1, ...items.map(item => item.value));
                const chartHeight = 120;
                const paddingX = 10;
                const paddingTop = 16;
                const paddingBottom = 30;
                const barAreaWidth = items.length * 24;
                const totalWidth = barAreaWidth + paddingX * 2;
                const totalHeight = chartHeight + paddingTop + paddingBottom;
                const barBottom = chartHeight + paddingTop;
                const gap = barAreaWidth / items.length;
                const barWidth = Math.max(4, Math.min(20, gap - 4));
                const labelStep = Math.max(1, Math.ceil(items.length / 7));
                return `
                    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" class="bvh-svg-chart" aria-label="近期记录趋势图">
                        ${items.map((item, i) => {
                            const h = Math.max(0.5, max > 0 ? (item.value / max) * chartHeight : 0);
                            const x = paddingX + i * gap + (gap - barWidth) / 2;
                            const barY = barBottom - h;
                            return [
                                `<rect x="${x.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="#00aeec" rx="2"><title>${item.date}: ${item.value} 条</title></rect>`,
                                item.value > 0 ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(barY - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="#61666d" font-weight="600">${item.value}</text>` : ''
                            ].join('');
                        }).join('')}
                        ${items.map((item, i) => {
                            if (i % labelStep !== 0 && i !== items.length - 1) return '';
                            const x = paddingX + i * gap + gap / 2;
                            return `<text x="${x.toFixed(1)}" y="${barBottom + 18}" text-anchor="middle" font-size="10" fill="#9499a0">${item.date}</text>`;
                        }).join('')}
                    </svg>`;
            };

            const renderStats = () => {
                const bundle = StorageManager.getStatsBundle(state.statsRange);
                const stats = bundle.cards;
                const chartData = bundle.charts;
                const pane = mask.querySelector('[data-pane="stats"]');
                const completionPercent = chartData.completion.total > 0 ? Math.round((chartData.completion.finished / chartData.completion.total) * 100) : 0;

                pane.innerHTML = `
                    <div class="bvh-stats">
                        <div class="bvh-stat">总记录<strong>${stats.total}</strong></div>
                        <div class="bvh-stat">已观看<strong>${stats.watched}</strong></div>
                        <div class="bvh-stat">已访问<strong>${stats.visited}</strong></div>
                        <div class="bvh-stat">近 7 天<strong>${stats.recent7Days}</strong></div>
                        <div class="bvh-stat">低进度<strong>${stats.low}</strong></div>
                        <div class="bvh-stat">中进度<strong>${stats.mid}</strong></div>
                        <div class="bvh-stat">高进度<strong>${stats.high}</strong></div>
                        <div class="bvh-stat">未看完<strong>${stats.unfinished}</strong></div>
                    </div>
                    <div class="bvh-chart-toolbar">
                        <select data-action="stats-range">
                            <option value="7" ${state.statsRange === 7 ? 'selected' : ''}>近 7 天</option>
                            <option value="30" ${state.statsRange === 30 ? 'selected' : ''}>近 30 天</option>
                            <option value="90" ${state.statsRange === 90 ? 'selected' : ''}>近 90 天</option>
                        </select>
                    </div>
                    <div class="bvh-chart-grid">
                        <div class="bvh-chart-card">
                            <p class="bvh-chart-title">观看完成度</p>
                            <div class="bvh-completion-ring">
                                <svg viewBox="0 0 120 120" class="bvh-ring-svg">
                                    <circle cx="60" cy="60" r="50" fill="none" stroke="#edf0f2" stroke-width="10"/>
                                    <circle cx="60" cy="60" r="50" fill="none" stroke="#00aeec" stroke-width="10"
                                        stroke-dasharray="${completionPercent * 3.14} 314" stroke-linecap="round"
                                        transform="rotate(-90 60 60)"/>
                                </svg>
                                <div class="bvh-ring-text">
                                    <strong>${completionPercent}%</strong>
                                    <span>高进度 / 总数量</span>
                                </div>
                            </div>
                        </div>
                        <div class="bvh-chart-card">
                            <p class="bvh-chart-title">观看状态分布</p>
                            ${renderMiniBarChart([
                                { label: '已观看', value: chartData.status[0].value, color: '#4CAF50' },
                                { label: '已访问', value: chartData.status[1].value, color: '#9E9E9E' }
                            ])}
                        </div>
                        <div class="bvh-chart-card">
                            <p class="bvh-chart-title">观看进度分布</p>
                            ${renderMiniBarChart([
                                { label: '低进度', value: chartData.progress[0].value, color: '#FF9800' },
                                { label: '中进度', value: chartData.progress[1].value, color: '#4285F4' },
                                { label: '高进度', value: chartData.progress[2].value, color: '#4CAF50' }
                            ])}
                        </div>
                        <div class="bvh-chart-card bvh-chart-card-wide">
                            <p class="bvh-chart-title">近期记录趋势 (${state.statsRange} 天)</p>
                            <div class="bvh-chart-scroll">${renderDailySvgChart(chartData.recentDays)}</div>
                        </div>
                    </div>
`;
            };

            const render = () => {
                state._cachedRows = null;
                renderTabs();
                if (state.tab === 'settings') renderSettings();
                if (state.tab === 'history') renderHistory();
                if (state.tab === 'stats') renderStats();
            };

            const syncOpacityControls = (value) => {
                const next = Math.max(40, Math.min(100, parseInt(value, 10) || DEFAULT_CONFIG.tagOpacity));
                mask.querySelectorAll('[data-setting="tagOpacity"]').forEach(input => input.value = String(next));
            };

            const exportHistory = () => {
                const data = {};
                StorageManager.getAllRecords().forEach(({ key, record }) => data[key] = record);
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bilibili-history-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            };

            const importHistory = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                        try {
                            const data = JSON.parse(ev.target.result);
                            const result = StorageManager.importRecords(data);
                            UIComponent.toast(`成功导入 ${result.count} 条新记录 (跳过 ${result.skipCount} 条已有记录)`, 'success', 4000);
                            render();
                        } catch (err) {
                            UIComponent.toast('导入失败：文件格式错误', 'error');
                        }
                    };
                    reader.readAsText(file);
                };
                input.click();
            };

            const formatDateTime = (date) => {
                const pad = n => String(n).padStart(2, '0');
                return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
            };

            const getRetentionCutoff = (amount, unit) => {
                const cutoff = new Date();
                if (unit === 'months') cutoff.setMonth(cutoff.getMonth() - amount);
                else if (unit === 'years') cutoff.setFullYear(cutoff.getFullYear() - amount);
                else cutoff.setDate(cutoff.getDate() - amount);
                return cutoff;
            };

            const getRetentionCleanupRequest = () => {
                const amountInput = mask.querySelector('[data-action="retention-value"]');
                const unitInput = mask.querySelector('[data-action="retention-unit"]');
                const rawAmount = (amountInput?.value || '').trim();
                if (!/^[0-9]+$/.test(rawAmount) || parseInt(rawAmount, 10) < 1) {
                    UIComponent.toast('保留数量必须为正整数数字', 'error', 2500);
                    if (amountInput) amountInput.focus();
                    return null;
                }
                const unit = unitInput?.value || 'days';
                return { amount: parseInt(rawAmount, 10), unit };
            };

            const getRetentionCandidates = (cutoff) => {
                const cutoffTime = cutoff.getTime();
                return StorageManager.getAllRecords()
                    .filter(({ record }) => {
                        const savedTime = record?.savedAt ? new Date(record.savedAt).getTime() : NaN;
                        return Number.isFinite(savedTime) && savedTime < cutoffTime;
                    })
                    .map(({ key }) => key);
            };

            const deleteRecords = (keys) => {
                const backups = keys.map(key => ({ key, record: StorageManager.getRecord(key) })).filter(item => item.record);
                if (backups.length === 0) {
                    UIComponent.toast('没有可删除的记录', 'error', 2000);
                    return;
                }

                const runDelete = async () => {
                    const keysToDelete = backups.map(({ key }) => key);
                    const progress = backups.length > 1
                        ? UIComponent.progressToast(`准备删除 ${backups.length} 条记录...`)
                        : null;
                    const deletedCount = progress
                        ? await StorageManager.deleteRecordsWithProgress(keysToDelete, ({ processed, total, deleted, shardsDone, shardsTotal }) => {
                            const percent = total > 0 ? (processed / total) * 100 : 100;
                            progress.update(percent, `正在删除 ${processed}/${total} 条记录（${shardsDone}/${shardsTotal} 分片，已删 ${deleted} 条）`);
                        }, false)
                        : StorageManager.deleteRecords(keysToDelete, false);
                    if (deletedCount === 0) {
                        if (progress) progress.close('没有可删除的记录', 'error', 2000);
                        else UIComponent.toast('没有可删除的记录', 'error', 2000);
                        return;
                    }
                    StorageManager._notifyChange();
                    if (progress) progress.close(`删除完成：${deletedCount} 条记录`, 'success', 1200);
                    UIComponent.toastUndo(`已删除 ${deletedCount} 条记录，点击撤销`, 5000, () => {
                        StorageManager.saveRecords(backups, false);
                        StorageManager._notifyChange();
                        render();
                    });
                    state.selected.clear();
                    render();
                };

                if (backups.length > 1) {
                    setTimeout(runDelete, 30);
                } else {
                    runDelete();
                }
            };

            const cleanupByRetention = () => {
                const request = getRetentionCleanupRequest();
                if (!request) return;

                const unitLabels = { days: '天', months: '个月', years: '年' };
                const cutoff = getRetentionCutoff(request.amount, request.unit);
                const cutoffTime = cutoff.getTime();
                if (!Number.isFinite(cutoffTime)) {
                    UIComponent.toast('保留范围过大，无法计算清理时间', 'error', 2500);
                    return;
                }

                const keys = getRetentionCandidates(cutoff);
                const cutoffText = formatDateTime(cutoff);
                if (keys.length === 0) {
                    UIComponent.toast(`没有早于 ${cutoffText} 的历史记录需要删除`, 'success', 3000);
                    return;
                }

                const periodText = `${request.amount}${unitLabels[request.unit] || '天'}`;
                const confirmed = window.confirm([
                    `将保留最近 ${periodText} 的历史记录。`,
                    `删除范围：保存时间早于 ${cutoffText} 的记录。`,
                    `预计删除：${keys.length} 条。`,
                    '',
                    '确认删除这些久远历史记录？'
                ].join('\n'));
                if (!confirmed) return;

                deleteRecords(keys);
            };

            mask.addEventListener('click', (e) => {
                const target = e.target;
                if (target === mask || target.dataset.action === 'close') mask.remove();
                if (target.dataset.tab) {
                    state.tab = target.dataset.tab;
                    render();
                }
                if (target.dataset.action === 'page-first') {
                    state.page = 1;
                    renderHistoryResults();
                }
                if (target.dataset.action === 'page-prev') {
                    state.page = Math.max(1, state.page - 1);
                    renderHistoryResults();
                }
                if (target.dataset.action === 'page-next') {
                    state.page++;
                    renderHistoryResults();
                }
                if (target.dataset.action === 'page-last') {
                    state.page = Math.max(1, Math.ceil(getFilteredRows().length / state.pageSize));
                    renderHistoryResults();
                }
                if (target.dataset.action === 'save-settings') {
                    const patch = {};
                    mask.querySelectorAll('[data-setting]').forEach(input => {
                        const key = input.dataset.setting;
                        if (key in patch) return;
                        if (input.type === 'checkbox') patch[key] = input.checked;
                        else if (input.type === 'number' || input.type === 'range') patch[key] = parseInt(input.value, 10);
                        else patch[key] = input.value;
                    });
                    if (patch.lowThreshold >= patch.highThreshold) {
                        UIComponent.toast('低进度阈值必须小于高进度阈值', 'error');
                        return;
                    }
                    SettingsManager.save(patch);
                    Utils.log('Settings saved', patch);
                    UIComponent.toast('设置已保存', 'success', 2000);
                    render();
                }
                if (target.dataset.action === 'reset-settings') {
                    SettingsManager.reset();
                    Utils.log('Settings reset to default');
                    UIComponent.toast('设置已恢复默认', 'success', 2000);
                    render();
                }
                if (target.dataset.action === 'download-debug-log') {
                    Utils.downloadDebugLog();
                    UIComponent.toast('调试日志已下载', 'success', 2000);
                }
                if (target.dataset.action === 'clear-debug-log') {
                    Utils.clearDebugLogs();
                    UIComponent.toast('调试日志已清空', 'success', 2000);
                }
                if (target.dataset.action === 'reset-panel') {
                    GM_deleteValue('bvh_panel_position');
                    const panel = document.getElementById('bvh-view-panel');
                    if (panel) {
                        panel.style.left = '15px';
                        panel.style.bottom = '15px';
                        panel.style.top = 'auto';
                    }
                    UIComponent.toast('面板位置已恢复默认', 'success', 2000);
                }
                if (target.dataset.action === 'jump-current' && options.currentKey) {
                    UIComponent.jumpToProgress(StorageManager.getRecord(options.currentKey));
                }
                if (target.dataset.action === 'export') exportHistory();
                if (target.dataset.action === 'import') importHistory();
                if (target.dataset.action === 'cleanup-retention') cleanupByRetention();
                if (target.dataset.action === 'delete-one') deleteRecords([target.dataset.key]);
                if (target.dataset.action === 'delete-selected') deleteRecords(Array.from(state.selected));
                if (target.dataset.action === 'select-all') {
                    const start = (state.page - 1) * state.pageSize;
                    const rows = getFilteredRows().slice(start, start + state.pageSize);
                    if (target.checked) rows.forEach(({ key }) => state.selected.add(key));
                    else rows.forEach(({ key }) => state.selected.delete(key));
                    renderHistoryResults();
                }
                if (target.dataset.action === 'clear-search') {
                    state.query = '';
                    state.page = 1;
                    state._cachedRows = null;
                    const searchInput = mask.querySelector('[data-action="search"]');
                    if (searchInput) searchInput.value = '';
                    renderHistoryResults();
                }
            });

            mask.addEventListener('change', (e) => {
                const target = e.target;
                if (target.dataset.action === 'status-filter') {
                    state.status = target.value;
                    state.page = 1;
                    state._cachedRows = null;
                    renderHistoryResults();
                }
                if (target.dataset.action === 'sort') {
                    state.sort = target.value;
                    state.page = 1;
                    state._cachedRows = null;
                    renderHistoryResults();
                }
                if (target.dataset.action === 'page-size') {
                    state.pageSize = parseInt(target.value, 10) || 50;
                    state.page = 1;
                    renderHistoryResults();
                }
                if (target.dataset.action === 'stats-range') {
                    state.statsRange = parseInt(target.value, 10) || 30;
                    renderStats();
                }
                if (target.dataset.key) {
                    if (target.checked) state.selected.add(target.dataset.key);
                    else state.selected.delete(target.dataset.key);
                }
            });

            const updateSearchResults = Utils.debounce((value) => {
                state.query = value;
                state.page = 1;
                state._cachedRows = null;
                renderHistoryResults();
            }, 300);

            mask.addEventListener('input', (e) => {
                const target = e.target;
                if (target.dataset.setting === 'tagOpacity') {
                    syncOpacityControls(target.value);
                    return;
                }
                if (target.dataset.action === 'search') {
                    updateSearchResults(target.value);
                }
            });

            render();
        }
    };

    // --- 播放器监控层 ---
    class VideoPlayerObserver {
        constructor() {
            this.bvId = null;
            this.videoEl = null;
            this.title = '';
            this.hasPlayed = false;
            this.stateInterval = null;
            this._lastKnownState = null; // 缓存最近一次有效进度，供 destroy 安全使用

            // 绑定 this 用于事件注册与移除
            this._onBeforeUnload = () => this.saveProgress(true);
            this._onPlay = () => {
                this.hasPlayed = true;
                this.saveProgressDebounced();
            };
            this._onTimeUpdate = () => {
                if (!this.hasPlayed && this.videoEl && this.videoEl.currentTime > 0) {
                    this.hasPlayed = true;
                }
                if (this.hasPlayed) {
                    this.saveProgressDebounced();
                }
            };
            this._onPause = () => {
                if (this.hasPlayed) {
                    this.saveProgress(true);
                }
            };

            this.saveProgressDebounced = Utils.throttle(this.saveProgress.bind(this), 5000);
        }

        init() {
            Utils.log('VideoPlayerObserver.init', `url=${location.href}`);
            const getBvId = () => {
                // 合集页面: bvid 在 URL query 参数中
                const urlKey = VideoKey.fromUrl(location.href);
                if (urlKey) return urlKey;
                return VideoKey.normalize(window.__INITIAL_STATE__?.bvid);
            };

            this.bvId = getBvId();
            if (!this.bvId) {
                Utils.log('VideoPlayerObserver.init no bvId, start polling __INITIAL_STATE__');
                let retries = 0;
                this.stateInterval = setInterval(() => {
                    this.bvId = getBvId();
                    if (this.bvId) {
                        Utils.log('VideoPlayerObserver polling resolved bvId:', this.bvId, `retries=${retries}`);
                        clearInterval(this.stateInterval);
                        this.setupRecord();
                    } else if (retries++ > 50) {
                        Utils.warn('VideoPlayerObserver polling stopped: bvId not found');
                        clearInterval(this.stateInterval);
                    }
                }, 200);
            } else {
                Utils.log('VideoPlayerObserver.init bvId:', this.bvId);
                this.setupRecord();
            }
        }

        setupRecord() {
            const done = Utils.debugTime('VideoPlayerObserver.setupRecord');
            this.bvId = EpisodeResolver.getCurrentKey() || VideoKey.normalize(this.bvId);
            const state = window.__INITIAL_STATE__;
            this.title = document.title || (state?.videoData?.title) || '';
            Utils.log('VideoPlayerObserver.setupRecord resolved', `key=${this.bvId}`, `title=${this.title}`);

            const record = StorageManager.getRecord(this.bvId);
            if (record) {
                Utils.log('VideoPlayerObserver.setupRecord existing record', this.bvId, record.status, record.percent || '');
                UIComponent.showViewPanel(record, this.bvId);
            } else {
                Utils.log('VideoPlayerObserver.setupRecord create visited record', this.bvId);
                const visitedRecord = {
                    v: 2,
                    status: RECORD_STATUS.VISITED,
                    currentTime: '',
                    percent: '',
                    savedAt: Utils.formatTime(),
                    title: this.title
                };
                StorageManager.saveRecord(this.bvId, visitedRecord);
                UIComponent.showViewPanel(visitedRecord, this.bvId);
            }
            const latest = EpisodeResolver.getLatestRecord(VideoKey.base(this.bvId));
            if (latest) {
                Utils.log('VideoPlayerObserver.setupRecord latest resume target', `current=${this.bvId}`, `target=${latest.key}`, latest.record.currentTime, latest.record.percent || '');
                UIComponent.showResumePrompt(latest, () => {
                    if (this.videoEl) {
                        this.videoEl.currentTime = 0;
                        this.videoEl.play();
                    }
                });
            } else {
                Utils.log('VideoPlayerObserver.setupRecord no resume target', this.bvId);
            }

            this.waitForVideo().then(video => {
                this.videoEl = video;
                this.bindEvents();
                UIComponent.applyPendingSeek(this.bvId, video);
                Utils.log('Video element bound');
                done(`key=${this.bvId} videoReadyState=${video.readyState}`);
            }).catch(e => {
                Utils.error('Video element not found or timeout', e);
                done(`key=${this.bvId} video=timeout`);
            });
        }

        waitForVideo(timeout = 10000) {
            const done = Utils.debugTime('VideoPlayerObserver.waitForVideo');
            return new Promise((resolve, reject) => {
                const getVid = () => document.querySelector("#bilibili-player video, bwp-video");
                let video = getVid();
                if (video) {
                    done('found immediately');
                    return resolve(video);
                }
                let timer = null;

                const observer = new MutationObserver(() => {
                    video = getVid();
                    if (video) {
                        observer.disconnect();
                        if (timer) clearTimeout(timer);
                        done('found by mutation');
                        resolve(video);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                timer = setTimeout(() => {
                    observer.disconnect();
                    done('timeout');
                    reject(new Error("Timeout waiting for video element"));
                }, timeout);
            });
        }

        bindEvents() {
            if (!this.videoEl) return;
            Utils.log('VideoPlayerObserver.bindEvents', `key=${this.bvId}`, `duration=${this.videoEl.duration || 'unknown'}`);
            this.videoEl.addEventListener('play', this._onPlay);
            this.videoEl.addEventListener('timeupdate', this._onTimeUpdate);
            this.videoEl.addEventListener('pause', this._onPause);
            window.addEventListener('beforeunload', this._onBeforeUnload);
        }

        saveProgress(force = false) {
            const start = performance.now();
            const currentKey = EpisodeResolver.getCurrentKey() || this.bvId;
            if (currentKey && currentKey !== this.bvId) {
                Utils.log('VideoPlayerObserver.saveProgress key changed', `from=${this.bvId}`, `to=${currentKey}`);
                this.bvId = currentKey;
                const existing = StorageManager.getRecord(this.bvId);
                if (existing) UIComponent.showViewPanel(existing, this.bvId);
            }
            if (!this.hasPlayed || !this.bvId || !this.videoEl) {
                Utils.logEvery('saveProgressSkippedNotReady', 20, `force=${force}`, `hasPlayed=${this.hasPlayed}`, `key=${this.bvId || 'none'}`, `video=${!!this.videoEl}`);
                return;
            }
            if (!this.videoEl.duration) {
                Utils.logEvery('saveProgressSkippedNoDuration', 20, `force=${force}`, `key=${this.bvId}`);
                return;
            }

            const current = this.videoEl.currentTime || 0;
            const duration = this.videoEl.duration || 1;
            if (current < MIN_WATCH_SAVE_SECONDS) {
                Utils.logEvery('saveProgressSkippedTooEarly', 20, `force=${force}`, `key=${this.bvId}`, `current=${current.toFixed(2)}`);
                return;
            }

            const format = (sec) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const pad = v => String(v).padStart(2, '0');
                return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
            };

            const percent = Math.round((current / duration) * 100) + '%';
            const value = {
                v: 2,
                status: RECORD_STATUS.WATCHED,
                currentTime: format(current),
                percent: percent,
                savedAt: Utils.formatTime(),
                title: this.title
            };

            try {
                StorageManager.saveRecord(this.bvId, value);
            } catch (e) {
                // GM_setValue 写入失败时，用 localStorage 作为异常兜底
                Utils.error('StorageManager.saveRecord failed, falling back to localStorage', e);
                localStorage.setItem(`${BACKUP_PREFIX}${this.bvId}`, JSON.stringify({ key: this.bvId, value: value, savedAt: Date.now() }));
            }
            if (force) {
                localStorage.setItem(`${BACKUP_PREFIX}${this.bvId}`, JSON.stringify({ key: this.bvId, value: value, savedAt: Date.now() }));
                StorageManager.cleanupLocalStorageBackupsThrottled();
            }

            // 缓存最近一次有效进度
            this._lastKnownState = { key: this.bvId, value };

            // 轻量更新 View Panel（不重建 DOM，避免闪烁）
            const panel = document.getElementById('bvh-view-panel');
            if (panel) panel.dataset.bvhKey = this.bvId;
            UIComponent.updateViewPanelProgress(value);
            Utils.log('VideoPlayerObserver.saveProgress saved', `key=${this.bvId}`, `time=${value.currentTime}`, `percent=${value.percent}`, `force=${force}`);
            Utils.logSlow('VideoPlayerObserver.saveProgress', start, `key=${this.bvId} force=${force}`, 30);
        }

        destroy() {
            Utils.log('VideoPlayerObserver.destroy', `key=${this.bvId}`, `hasLastState=${!!this._lastKnownState}`);
            // 使用缓存的进度数据保存，不再读取 video 元素（SPA 切换时 video 可能已加载新视频）
            if (this._lastKnownState?.key && this._lastKnownState?.value) {
                StorageManager.saveRecord(this._lastKnownState.key, this._lastKnownState.value);
            }

            window.removeEventListener('beforeunload', this._onBeforeUnload);
            if (this.videoEl) {
                this.videoEl.removeEventListener('play', this._onPlay);
                this.videoEl.removeEventListener('timeupdate', this._onTimeUpdate);
                this.videoEl.removeEventListener('pause', this._onPause);
            }
            if (this.stateInterval) {
                clearInterval(this.stateInterval);
            }
        }
    }

    // --- DOM监控与渲染层 ---
    class DOMWatcher {
        constructor() {
            this.intersectionObserver = null;
            this.rootObserver = null;
            this.contentObservers = new Map();
            this.processedLinks = new WeakSet();
            this.visibleElements = new Set();
            this.pendingLinks = new Set();
            this.pendingPlaylistItems = new Set();
            this.pendingRescanRoots = new Map();
            this.flushScheduled = false;
            this.relatedKeysCache = new Map();
            this._initialScanInProgress = false;
            this.pageMode = this.getPageMode();
            this.scheduleHeaderPopoverRefresh = Utils.debounce(() => this.refreshHeaderPopoverCards(), 120);
            this.schedulePlaylistRefresh = Utils.debounce(() => this.refreshPlaylistItems(), 120);
            this.scheduleObserverRootRefresh = Utils.debounce(() => this.refreshObserverRoots(), 180);
            this.scheduleFullRescan = Utils.debounce(() => this.flushRescanRoots(), DOM_RESCAN_DELAY);
            this.initIntersectionObserver();
            this.initMutationObserver();
            document.addEventListener('pointerover', (e) => {
                if (e.target?.closest?.(HEADER_POPOVER_SELECTOR)) {
                    this.scheduleHeaderPopoverRefresh();
                }
            }, true);
            document.addEventListener('click', (e) => {
                if (e.target?.closest?.(HEADER_POPOVER_SELECTOR)) {
                    this.scheduleHeaderPopoverRefresh();
                    setTimeout(() => this.scheduleHeaderPopoverRefresh(), 450);
                }
            }, true);
            Utils.log('DOMWatcher constructed', `mode=${this.pageMode}`);

            // 事件驱动而非定时盲扫
            StorageManager.onDataChange(() => {
                const start = performance.now();
                let processed = 0;
                let removed = 0;
                this.relatedKeysCache.clear();
                this.visibleElements.forEach(el => {
                    if (document.contains(el)) {
                        this.enqueueElement(el);
                        processed++;
                    } else {
                        this.visibleElements.delete(el);
                        removed++;
                    }
                });
                Utils.log('DOMWatcher data-change refresh', `visible=${this.visibleElements.size}`, `processed=${processed}`, `removed=${removed}`);
                Utils.logSlow('DOMWatcher data-change refresh', start, `processed=${processed}`, 50);
            });
        }

        initIntersectionObserver() {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                const start = performance.now();
                let enterCount = 0;
                let leaveCount = 0;
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.visibleElements.add(entry.target);
                        this.enqueueElement(entry.target);
                        enterCount++;
                    } else {
                        this.visibleElements.delete(entry.target);
                        leaveCount++;
                    }
                });
                Utils.logEvery('intersectionBatches', 20, `entries=${entries.length}`, `enter=${enterCount}`, `leave=${leaveCount}`, `visible=${this.visibleElements.size}`);
                Utils.logSlow('DOMWatcher IntersectionObserver batch', start, `entries=${entries.length} enter=${enterCount}`, 50);
            }, { rootMargin: '200px 0px' });
            Utils.log('DOMWatcher IntersectionObserver initialized');
        }

        isHeaderPopoverNode(el) {
            return !!(el?.matches?.(HEADER_POPOVER_SELECTOR) || el?.closest?.(HEADER_POPOVER_SELECTOR));
        }

        isSkippedHeaderNode(el) {
            return !!(el?.closest?.(HEADER_SELECTOR) && !this.isHeaderPopoverNode(el) && !el?.querySelector?.(HEADER_POPOVER_SELECTOR));
        }

        isHeaderPopoverVideoLink(el) {
            return !!el?.matches?.(HEADER_POPOVER_VIDEO_LINK_SELECTOR);
        }

        getHeaderPopoverCover(el) {
            if (!this.isHeaderPopoverVideoLink(el)) return null;
            return el.querySelector('.cover, .header-history-video__image, .header-fav-card__image');
        }

        getPageMode() {
            return /\/(video|v|medialist\/play|list)\//.test(location.href) || /[?&]bvid=/.test(location.href) || window.__INITIAL_STATE__?.bvid
                ? 'video'
                : 'list';
        }

        refreshForRoute() {
            const nextMode = this.getPageMode();
            if (nextMode !== this.pageMode) {
                Utils.log('DOMWatcher mode changed', `from=${this.pageMode}`, `to=${nextMode}`, `url=${location.href}`);
                this.pageMode = nextMode;
                this.disconnectContentObservers();
            }
            this.relatedKeysCache.clear();
            EpisodeResolver._invalidateItemsCache();
            this.refreshObserverRoots();
            this.scanExistingLinks();
        }

        initMutationObserver() {
            this.rootObserver = new MutationObserver((mutations) => {
                const start = performance.now();
                let shouldRefreshRoots = false;
                let shouldRefreshHeaderPopoverCards = false;
                let childListCount = 0;
                let addedNodeCount = 0;
                mutations.forEach(m => {
                    if (m.type !== 'childList') return;
                    childListCount++;
                    m.addedNodes.forEach(node => {
                        addedNodeCount++;
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        if (node.matches?.('[class*="bvh-"]') || node.closest?.('[class*="bvh-"]')) return;
                        if (node.matches?.(HEADER_POPOVER_SELECTOR) || node.querySelector?.(HEADER_POPOVER_SELECTOR)) {
                            shouldRefreshHeaderPopoverCards = true;
                        }
                        const discoverySelector = this.pageMode === 'video'
                            ? `${VIDEO_OBSERVER_ROOT_SELECTOR}, ${HEADER_POPOVER_SELECTOR}`
                            : OBSERVER_ROOT_DISCOVERY_SELECTOR;
                        if (node.matches?.(discoverySelector) || node.querySelector?.(discoverySelector)) {
                            shouldRefreshRoots = true;
                        }
                    });
                });
                if (shouldRefreshRoots) this.scheduleObserverRootRefresh();
                if (shouldRefreshHeaderPopoverCards) this.scheduleHeaderPopoverRefresh();
                const cost = performance.now() - start;
                if (shouldRefreshRoots || shouldRefreshHeaderPopoverCards || cost >= 50) {
                    Utils.logEvery('rootMutationBatches', 50, `mode=${this.pageMode}`, `mutations=${mutations.length}`, `child=${childListCount}`, `nodes=${addedNodeCount}`, `refreshRoots=${shouldRefreshRoots}`, `headerPopover=${shouldRefreshHeaderPopoverCards}`, `cost=${cost.toFixed(1)}ms`);
                }
                Utils.logSlow('DOMWatcher root MutationObserver batch', start, `mutations=${mutations.length} child=${childListCount}`, 50);
            });
            this.rootObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            Utils.log('DOMWatcher root MutationObserver initialized: root discovery only');
            this.refreshObserverRoots();
        }

        getObserverRoots() {
            const selector = this.pageMode === 'video' ? VIDEO_OBSERVER_ROOT_SELECTOR : LIST_OBSERVER_ROOT_SELECTOR;
            const roots = new Set();
            document.querySelectorAll(selector).forEach(root => roots.add(root));
            document.querySelectorAll(HEADER_POPOVER_SELECTOR).forEach(root => roots.add(root));
            if (this.pageMode !== 'video' && roots.size === 0 && document.body) {
                roots.add(document.body);
            }
            return Array.from(roots).filter(root => {
                if (!root || !document.contains(root)) return false;
                if (root.matches?.('[class*="bvh-"]') || root.closest?.('[class*="bvh-"]')) return false;
                if (this.pageMode === 'video' && root === document.body) return false;
                if (this.isSkippedHeaderNode(root)) return false;
                return true;
            });
        }

        disconnectContentObservers() {
            this.contentObservers.forEach(observer => observer.disconnect());
            this.contentObservers.clear();
        }

        refreshObserverRoots() {
            const start = performance.now();
            let removed = 0;
            this.contentObservers.forEach((observer, root) => {
                if (!document.contains(root) || (this.pageMode === 'video' && root === document.body)) {
                    observer.disconnect();
                    this.contentObservers.delete(root);
                    removed++;
                }
            });

            let added = 0;
            this.getObserverRoots().forEach(root => {
                if (this.observeContentRoot(root)) added++;
            });
            Utils.log('DOMWatcher.refreshObserverRoots', `mode=${this.pageMode}`, `roots=${this.contentObservers.size}`, `added=${added}`, `removed=${removed}`, `cost=${(performance.now() - start).toFixed(1)}ms`);
            Utils.logSlow('DOMWatcher.refreshObserverRoots', start, `mode=${this.pageMode} roots=${this.contentObservers.size}`, 50);
        }

        observeContentRoot(root) {
            if (!root || this.contentObservers.has(root)) return false;
            if (this.pageMode === 'video' && root === document.body) return false;
            if (this.isSkippedHeaderNode(root)) return false;

            for (const existingRoot of this.contentObservers.keys()) {
                if (existingRoot !== root && existingRoot.contains(root) && !this.isHeaderPopoverNode(root)) {
                    return false;
                }
            }

            const observer = new MutationObserver(mutations => this.handleContentMutations(mutations, root));
            observer.observe(root, { childList: true, subtree: true });
            this.contentObservers.set(root, observer);
            if (!this._initialScanInProgress) {
                this.rescanContentRoot(root, 'observe root');
            }
            return true;
        }

        handleContentMutations(mutations, root) {
            const start = performance.now();
            const links = new Set();
            const playlistItems = new Set();
            let shouldRefreshHeaderPopoverCards = false;
            let childListCount = 0;
            let addedNodeCount = 0;
            let limited = false;

            mutations.forEach(m => {
                if (limited || m.type !== 'childList') return;
                childListCount++;
                m.addedNodes.forEach(node => {
                    if (limited) return;
                    addedNodeCount++;
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const result = this.collectWorkFromNode(node, links, playlistItems);
                    if (result.headerPopover) shouldRefreshHeaderPopoverCards = true;
                    if (links.size + playlistItems.size >= DOM_MUTATION_WORK_LIMIT) {
                        limited = true;
                    }
                });
            });

            if (limited) {
                Utils.warn('DOMWatcher content mutation limited, schedule rescan', `mode=${this.pageMode}`, `root=${Utils.describeElement(root)}`, `links=${links.size}`, `playlist=${playlistItems.size}`);
                this.requestContentRescan(root, 'mutation limit');
            } else {
                this.enqueueLinks(links);
                this.enqueuePlaylistItems(playlistItems);
            }
            if (playlistItems.size > 0) this.schedulePlaylistRefresh();
            if (shouldRefreshHeaderPopoverCards) this.scheduleHeaderPopoverRefresh();

            const cost = performance.now() - start;
            const hasWork = links.size > 0 || playlistItems.size > 0 || shouldRefreshHeaderPopoverCards || limited;
            if (hasWork || cost >= 50) {
                Utils.logEvery('mutationBatches', 20, `mode=${this.pageMode}`, `mutations=${mutations.length}`, `child=${childListCount}`, `nodes=${addedNodeCount}`, `links=${links.size}`, `playlist=${playlistItems.size}`, `limited=${limited}`, `headerPopover=${shouldRefreshHeaderPopoverCards}`, `cost=${cost.toFixed(1)}ms`);
            }
            Utils.logSlow('DOMWatcher content MutationObserver batch', start, `mode=${this.pageMode} child=${childListCount} links=${links.size} playlist=${playlistItems.size} limited=${limited}`, 50);
        }

        collectWorkFromNode(node, links, playlistItems) {
            if (node.matches?.('[class*="bvh-"]') || node.closest?.('[class*="bvh-"]')) {
                return { headerPopover: false };
            }
            if (this.isSkippedHeaderNode(node)) {
                return { headerPopover: false };
            }

            const selfIsRelevantLink = node.matches?.(VIDEO_LINK_SELECTOR);
            const selfIsPlaylistItem = node.matches?.(PLAYLIST_ITEM_SELECTOR);
            const selfIsHeaderPopover = node.matches?.(HEADER_POPOVER_SELECTOR);
            const selfIsHeaderPopoverCard = node.matches?.(HEADER_POPOVER_VIDEO_LINK_SELECTOR);
            const hasRelevantChild = node.querySelector?.(MUTATION_RELEVANT_SELECTOR);
            if (!selfIsRelevantLink && !selfIsPlaylistItem && !selfIsHeaderPopover && !selfIsHeaderPopoverCard && !hasRelevantChild) {
                return { headerPopover: false };
            }

            if (selfIsRelevantLink && node.href) {
                links.add(node);
            }
            if (node.querySelectorAll) {
                node.querySelectorAll(VIDEO_LINK_SELECTOR).forEach(link => links.add(link));
                node.querySelectorAll(PLAYLIST_ITEM_SELECTOR).forEach(item => playlistItems.add(item));
            }
            if (selfIsPlaylistItem) {
                playlistItems.add(node);
            }

            const headerPopover = !!(selfIsHeaderPopover || selfIsHeaderPopoverCard || node.querySelector?.(HEADER_POPOVER_SELECTOR) || node.querySelector?.(HEADER_POPOVER_VIDEO_LINK_SELECTOR));
            return { headerPopover };
        }

        rescanContentRoot(root, reason = 'manual') {
            if (!root || !document.contains(root)) return;
            if (this.pageMode === 'video' && root === document.body) return;
            const start = performance.now();
            const links = new Set();
            const playlistItems = new Set();
            this.collectExistingFromRoot(root, links, playlistItems);
            this.enqueueLinks(links);
            this.enqueuePlaylistItems(playlistItems);
            Utils.log('DOMWatcher.rescanContentRoot', `mode=${this.pageMode}`, `reason=${reason}`, `root=${Utils.describeElement(root)}`, `links=${links.size}`, `playlist=${playlistItems.size}`, `cost=${(performance.now() - start).toFixed(1)}ms`);
            Utils.logSlow('DOMWatcher.rescanContentRoot', start, `mode=${this.pageMode} root=${Utils.describeElement(root)} links=${links.size} playlist=${playlistItems.size}`, 50);
        }

        requestContentRescan(root, reason = 'queued') {
            if (!root || !document.contains(root)) return;
            this.pendingRescanRoots.set(root, reason);
            this.scheduleFullRescan();
        }

        flushRescanRoots() {
            const roots = Array.from(this.pendingRescanRoots.entries());
            this.pendingRescanRoots.clear();
            roots.forEach(([root, reason]) => this.rescanContentRoot(root, reason));
            if (roots.length > 0) {
                Utils.log('DOMWatcher.flushRescanRoots', `count=${roots.length}`);
            }
        }

        collectExistingFromRoot(root, links, playlistItems) {
            if (!root || this.isSkippedHeaderNode(root)) return;
            if (root.matches?.(VIDEO_LINK_SELECTOR) && root.href) links.add(root);
            if (root.querySelectorAll) root.querySelectorAll(VIDEO_LINK_SELECTOR).forEach(link => links.add(link));
            if (root.matches?.(PLAYLIST_ITEM_SELECTOR)) playlistItems.add(root);
            if (root.querySelectorAll) root.querySelectorAll(PLAYLIST_ITEM_SELECTOR).forEach(item => playlistItems.add(item));
        }

        enqueueElement(el) {
            if (!el) return;
            if (el.matches?.(PLAYLIST_ITEM_SELECTOR)) {
                this.enqueuePlaylistItems([el]);
            } else {
                this.enqueueLinks([el]);
            }
        }

        enqueueLinks(links) {
            links.forEach(link => {
                if (!link || !document.contains(link)) return;
                this.observeLink(link);
                this.pendingLinks.add(link);
            });
            this.scheduleQueueFlush();
        }

        enqueuePlaylistItems(items) {
            items.forEach(item => {
                if (!item || !document.contains(item)) return;
                this.observePlaylistItem(item);
                this.pendingPlaylistItems.add(item);
            });
            this.scheduleQueueFlush();
        }

        scheduleQueueFlush() {
            if (this.flushScheduled || (this.pendingLinks.size === 0 && this.pendingPlaylistItems.size === 0)) return;
            this.flushScheduled = true;
            const run = (deadline) => this.flushQueues(deadline);
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(run, { timeout: DOM_IDLE_TIMEOUT });
            } else {
                setTimeout(() => run(null), 0);
            }
        }

        flushQueues(deadline) {
            this.flushScheduled = false;
            const start = performance.now();
            let links = 0;
            let playlist = 0;
            let processedTotal = 0;
            const hasBudget = () => {
                if (processedTotal === 0) return true;
                if (performance.now() - start >= DOM_PROCESS_TIME_BUDGET) return false;
                if (deadline && typeof deadline.timeRemaining === 'function') return deadline.timeRemaining() > 3;
                return true;
            };
            const take = (set) => {
                const next = set.values().next().value;
                set.delete(next);
                return next;
            };

            while (this.pendingPlaylistItems.size > 0 && playlist < DOM_PLAYLIST_BATCH_SIZE && hasBudget()) {
                const item = take(this.pendingPlaylistItems);
                if (item && document.contains(item)) this.processPlaylistItem(item);
                playlist++;
                processedTotal++;
            }
            while (this.pendingLinks.size > 0 && links < DOM_LINK_BATCH_SIZE && hasBudget()) {
                const link = take(this.pendingLinks);
                if (link && document.contains(link)) this.processLink(link);
                links++;
                processedTotal++;
            }

            if (links > 0 || playlist > 0) {
                Utils.logEvery('domProcessBatches', 20, `mode=${this.pageMode}`, `links=${links}`, `playlist=${playlist}`, `pendingLinks=${this.pendingLinks.size}`, `pendingPlaylist=${this.pendingPlaylistItems.size}`, `cost=${(performance.now() - start).toFixed(1)}ms`);
            }
            if (this.pendingLinks.size > 0 || this.pendingPlaylistItems.size > 0) {
                this.scheduleQueueFlush();
            }
        }

        observeLink(el) {
            if (this.isSkippedHeaderNode(el)) return;
            if (!this.processedLinks.has(el) && this.isValidLink(el)) {
                this.processedLinks.add(el);
                this.intersectionObserver.observe(el);
                Utils.logEvery('observedLinks', 100, Utils.describeElement(el), el.href || '');
            }
        }

        scanExistingLinks() {
            const done = Utils.debugTime('DOMWatcher.scanExistingLinks');
            this._initialScanInProgress = true;
            try {
                this.refreshObserverRoots();
                const links = new Set();
                const playlistItems = new Set();
                const roots = Array.from(this.contentObservers.keys());
                roots.forEach(root => this.collectExistingFromRoot(root, links, playlistItems));
                this.enqueueLinks(links);
                this.enqueuePlaylistItems(playlistItems);
                this.refreshHeaderPopoverCards();
                done(`mode=${this.pageMode} roots=${this.contentObservers.size} links=${links.size} playlist=${playlistItems.size} visible=${this.visibleElements.size}`);
            } finally {
                this._initialScanInProgress = false;
            }
        }

        // 强制刷新所有播放列表项标签（绕过 processedLinks 检查）
        refreshPlaylistItems() {
            const done = Utils.debugTime('DOMWatcher.refreshPlaylistItems');
            const items = document.querySelectorAll(PLAYLIST_ITEM_SELECTOR);
            let processed = 0;
            items.forEach(item => {
                // 确保新节点也被纳入观察
                this.observePlaylistItem(item);
                this.pendingPlaylistItems.add(item);
                processed++;
            });
            this.scheduleQueueFlush();
            done(`items=${items.length} processed=${processed}`);
        }

        // 头部弹窗会复用卡片节点并改写 href / 图片 / 标题，必须绕过 WeakSet 直接刷新
        refreshHeaderPopoverCards() {
            const done = Utils.debugTime('DOMWatcher.refreshHeaderPopoverCards');
            const cards = document.querySelectorAll(HEADER_POPOVER_VIDEO_LINK_SELECTOR);
            let processed = 0;
            cards.forEach(card => {
                if (card.href) {
                    this.observeLink(card);
                    this.pendingLinks.add(card);
                    processed++;
                }
            });
            this.scheduleQueueFlush();
            done(`cards=${cards.length} processed=${processed}`);
        }

        getVideoKeyFromLink(el) {
            if (!el || !el.href) return '';
            return VideoKey.fromUrl(el.href);
        }

        removeExistingMark(el) {
            const existingTags = el.querySelectorAll('.bvh-tag, .bvh-tag-small, .bvh-tag-big');
            existingTags.forEach(tag => tag.remove());
            const existingBars = el.querySelectorAll('.bvh-progress-bar');
            existingBars.forEach(bar => bar.remove());
        }

        isValidLink(el) {
            const href = el.href;
            if (!href || !this.getVideoKeyFromLink(el)) return false;
            const isHeaderPopoverLink = this.isHeaderPopoverVideoLink(el);

            if (this.isHeaderPopoverNode(el) && !isHeaderPopoverLink) {
                return false;
            }

            if (el.closest(HEADER_SELECTOR) && !isHeaderPopoverLink) {
                return false;
            }

            if (el.closest('.bili-footer, #biliMainFooter')) {
                return false;
            }

            const historyCard = el.closest('.history-card');
            if (historyCard && !el.closest('.bili-video-card__cover, .bili-cover-card')) {
                return false;
            }

            // 排除头像链接（头像子元素可能尚未渲染，需多重判断）
            if (el.querySelector('.bili-avatar')) return false;
            if (el.classList.contains('header-dynamic-avatar')) return false;
            if (el.closest('.bili-avatar, .header-dynamic-avatar')) return false;
            // 排除指向用户空间 dynamic 的链接（头像/用户名链接）
            if (/space\.bilibili\.com\/\d+\/dynamic/.test(href)) return false;

            if (isHeaderPopoverLink) {
                return true;
            }

            // 直接包含封面图的链接
            if (el.querySelector('img') || el.querySelector('picture') || el.querySelector('.bili-dyn-card-video__cover .bili-awesome-img')) {
                return true;
            }

            // 视频页右侧推荐 / 各种卡片容器内的链接（图片可能在 <a> 外部或懒加载）
            if (el.closest('.history-card, .video-page-card-small, .video-page-card, .bili-video-card, .video-card, .card-box, .rcmd-list, .next-play, .rec-list')) {
                return true;
            }

            // 常见的卡片链接 class
            if (el.classList.contains('card-box') || el.classList.contains('bili-video-card__image--wrap')) {
                return true;
            }

            return false;
        }

        // --- 合集播放列表项处理 ---
        observePlaylistItem(el) {
            if (!this.processedLinks.has(el)) {
                if (this.getPlaylistItemInfo(el)) {
                    this.processedLinks.add(el);
                    this.intersectionObserver.observe(el);
                    Utils.logEvery('observedPlaylistItems', 50, Utils.describeElement(el));
                }
            }
        }

        getPlaylistItemInfo(el) {
            if (!el) return null;
            if (el.matches('.video-pod__list.section .simple-base-item.page-item')) {
                const parent = el.closest('.video-pod__item[data-key]');
                const baseKey = VideoKey.fromText(parent?.getAttribute('data-key'));
                if (!baseKey) return null;
                const pages = Array.from(parent.querySelectorAll('.page-list .simple-base-item.page-item'));
                const page = pages.indexOf(el) + 1;
                if (page < 1) return null;
                const key = VideoKey.withPage(baseKey, page);
                return {
                    el,
                    cid: key,
                    page,
                    base: VideoKey.base(key),
                    key,
                    title: (el.querySelector('.title-txt')?.innerText || el.querySelector('.title')?.getAttribute('title') || el.innerText || '').trim()
                };
            }
            if (el.matches('.video-pod__item[data-key], .bpx-player-ctrl-eplist-multi-menu-item[data-cid]')) {
                if (el.matches('.video-pod__list.section .video-pod__item[data-key]') && el.querySelector('.page-list .simple-base-item.page-item')) {
                    return null;
                }
                const items = EpisodeResolver.getItems();
                const cid = el.getAttribute('data-key') || el.getAttribute('data-cid');
                return items.find(item => item.cid === cid) || null;
            }
            if (el.matches('.action-list-item-wrap[data-key]')) {
                const key = VideoKey.fromText(el.getAttribute('data-key'));
                if (!key) return null;
                return {
                    el,
                    cid: `action-list:${key}`,
                    page: VideoKey.page(key),
                    base: VideoKey.base(key),
                    key,
                    title: (el.querySelector('.info .title')?.getAttribute('title') || el.querySelector('.info .title')?.innerText || el.innerText || '').trim()
                };
            }
            return null;
        }

        getRecordTagColorClass(record) {
            let tagColorClass = 'bvh-tag-visited';
            if (record.status === RECORD_STATUS.WATCHED && record.percent) {
                const p = parseInt(record.percent);
                if (!isNaN(p)) {
                    if (p < CONFIG.lowThreshold) tagColorClass = 'bvh-tag-low';
                    else if (p <= CONFIG.highThreshold) tagColorClass = 'bvh-tag-mid';
                    else tagColorClass = 'bvh-tag-high';
                }
            }
            return tagColorClass;
        }

        createEpisodeTag(record, compact = false) {
            const tagColorClass = this.getRecordTagColorClass(record);
            const tagEl = document.createElement('span');
            tagEl.className = `bvh-episode-tag ${tagColorClass}${compact ? ' bvh-episode-tag-grid' : ''}`;
            if (compact) {
                const p = parseInt(record.percent);
                if (record.status === RECORD_STATUS.WATCHED && !isNaN(p)) {
                    tagEl.innerText = `${p}%`;
                } else if (record.status === RECORD_STATUS.WATCHED) {
                    tagEl.innerText = '看';
                } else if (record.status === RECORD_STATUS.VISITED) {
                    tagEl.innerText = '访';
                } else {
                    tagEl.innerText = record.status.slice(1, 2) || '记';
                }
            } else {
                tagEl.innerText = `${record.status}${record.percent || ''}`;
            }
            tagEl.title = `${record.status}${record.percent || ''}${record.savedAt ? ` ${record.savedAt}` : ''}`;
            tagEl.style.opacity = String(Math.max(40, Math.min(100, CONFIG.tagOpacity)) / 100);
            return tagEl;
        }

        createPlaylistCoverTag(record) {
            const tagText = `${record.status}${record.percent || ''}`;
            const tagTitle = `${record.status}${record.percent || ''}${record.savedAt ? ` ${record.savedAt}` : ''}`;
            return UIComponent.createTag(tagText, tagTitle, `bvh-tag ${this.getRecordTagColorClass(record)} bvh-action-list-cover-tag`);
        }

        getRelatedKeysCached(bvBase) {
            if (!bvBase) return [];
            if (!this.relatedKeysCache.has(bvBase)) {
                this.relatedKeysCache.set(bvBase, StorageManager.getRelatedKeys(bvBase, { loadAll: true }));
            }
            return this.relatedKeysCache.get(bvBase) || [];
        }

        processPlaylistItem(el) {
            const start = performance.now();
            const item = this.getPlaylistItemInfo(el);
            if (!item?.key) return;

            let record = StorageManager.getRecord(item.key);
            const isActionListItem = el.matches(ACTION_LIST_ITEM_SELECTOR);
            el.querySelectorAll(isActionListItem ? '.bvh-episode-tag, .bvh-action-list-cover-tag' : '.bvh-episode-tag').forEach(tag => tag.remove());
            if (!record) {
                Utils.logSlow('DOMWatcher.processPlaylistItem no-record', start, `key=${item.key} el=${Utils.describeElement(el)}`, 30, 'log');
                return;
            }
            if (record.status === RECORD_STATUS.VISITED && !CONFIG.showVisitedTag) {
                Utils.logSlow('DOMWatcher.processPlaylistItem hidden-visited', start, `key=${item.key}`, 30, 'log');
                return;
            }

            if (isActionListItem) {
                const coverImg = el.querySelector('.cover .cover-img');
                const coverTarget = coverImg || el.querySelector('.cover');
                if (!coverTarget || (!coverImg && !coverTarget.querySelector('img, picture'))) {
                    if (!el._bvhActionListRetryCount) el._bvhActionListRetryCount = 0;
                    if (el._bvhActionListRetryCount < 5) {
                        el._bvhActionListRetryCount++;
                        Utils.log('DOMWatcher.processPlaylistItem retry action-list cover', `key=${item.key}`, `retry=${el._bvhActionListRetryCount}`);
                        setTimeout(() => this.processPlaylistItem(el), 600);
                    }
                    return;
                }
                el._bvhActionListRetryCount = 0;
                const tagEl = this.createPlaylistCoverTag(record);
                const firstMedia = coverTarget.querySelector('img, picture');
                if (firstMedia?.parentNode === coverTarget) {
                    coverTarget.insertBefore(tagEl, firstMedia);
                } else {
                    coverTarget.insertBefore(tagEl, coverTarget.firstChild);
                }
                Utils.logSlow('DOMWatcher.processPlaylistItem action-list', start, `key=${item.key}`, 30, 'log');
                return;
            }

            const isGridItem = el.classList.contains('page') || !!el.closest('.video-pod__list.grid');
            const tagEl = this.createEpisodeTag(record, isGridItem);
            const isSectionItem = !!el.closest('.video-pod__list.section');
            const target = isGridItem
                ? el
                : isSectionItem
                    ? (el.matches('.simple-base-item.page-item')
                        ? (el.querySelector(':scope > .title') || el.querySelector('.title') || el)
                        : (el.querySelector('.simple-base-item.normal > .title') || el.querySelector('.title') || el))
                    : (el.querySelector('.title-txt, .bpx-player-ctrl-eplist-multi-menu-item-text, .title') || el);
            target.appendChild(tagEl);
            Utils.logSlow('DOMWatcher.processPlaylistItem', start, `key=${item.key} record=${record.status}${record.percent || ''}`, 30, 'log');
        }

        processLink(el) {
            const start = performance.now();
            if (this.isSkippedHeaderNode(el)) return;

            // 合集播放列表项走专用处理（它们是 div 而非 a）
            if (el.matches && el.matches(PLAYLIST_ITEM_SELECTOR)) {
                return this.processPlaylistItem(el);
            }

            let bv = this.getVideoKeyFromLink(el);
            if (!bv) return;
            let bvBase = VideoKey.base(bv);
            const isHeaderPopoverLink = this.isHeaderPopoverVideoLink(el);
            const headerPopoverCover = this.getHeaderPopoverCover(el);
            const isHistoryCard = !!el.closest('.history-card, .header-history-card');
            const existingVideoKey = el._bvhLastVideoKey;
            const isSameVideoKey = existingVideoKey === bv;

            let record = StorageManager.getRecord(bv);
            let multiRecords = [];
            const shouldFindRelated = isHistoryCard || /\?p=[0-9]+/.test(bv) || el.closest('.action-list-item-wrap, .video-pod, .playlist-container, .list-box');

            if (!record) {
                const relatedKeys = shouldFindRelated ? this.getRelatedKeysCached(bvBase) : [];
                if (relatedKeys.length > 0) {
                    record = StorageManager.getRecord(relatedKeys[0]);
                    multiRecords = relatedKeys;
                }
            } else {
                multiRecords = this.getRelatedKeysCached(bvBase);
            }

            if (!record) {
                if (!isSameVideoKey || el.querySelector('.bvh-tag, .bvh-tag-small, .bvh-tag-big, .bvh-progress-bar')) {
                    this.removeExistingMark(el);
                }
                el._bvhLastVideoKey = bv;
                Utils.logSlow('DOMWatcher.processLink no-record', start, `key=${bv} el=${Utils.describeElement(el)}`, 30, 'log');
                return;
            }
            if (record.status === RECORD_STATUS.VISITED && !CONFIG.showVisitedTag) {
                this.removeExistingMark(el);
                el._bvhLastVideoKey = bv;
                Utils.logSlow('DOMWatcher.processLink hidden-visited', start, `key=${bv}`, 30, 'log');
                return;
            }

            const isMulti = multiRecords.length > 1;
            const tagText = isMulti ? "已记录 多P" : `${record.status}${record.percent || ''}`;

            let tagTitle = record.savedAt || "";
            if (isMulti) {
                tagTitle = "";
                multiRecords.forEach(k => {
                    const v = StorageManager.getRecord(k);
                    if (v) {
                        const pMatch = k.match(/\?p=([0-9]+)/);
                        const pStr = pMatch ? `P${pMatch[1]}` : 'P1';
                        tagTitle += `${v.savedAt} ${pStr} ${v.status}${v.percent || ''}\n`;
                    }
                });
                tagTitle = tagTitle.trim();
            }

            const existingTags = el.querySelectorAll('.bvh-tag, .bvh-tag-small, .bvh-tag-big');
            const existingBars = el.querySelectorAll('.bvh-progress-bar');
            if (existingTags.length > 0 || existingBars.length > 0) {
                if (existingTags.length === 1 && existingBars.length <= 1 && isSameVideoKey && existingTags[0].innerText === tagText) {
                    Utils.logSlow('DOMWatcher.processLink unchanged', start, `key=${bv}`, 30, 'log');
                    return;
                }
                this.removeExistingMark(el);
            }

            let img = headerPopoverCover
                ? (headerPopoverCover.querySelector('img') || headerPopoverCover.querySelector('picture'))
                : (el.querySelector('img') || el.querySelector('picture'));
            let isSmall = false;

            if (!img) {
                img = el.querySelector('.bili-dyn-card-video__cover .bili-awesome-img');
            }

            // 图片不在 <a> 内部时，向上查找最近的卡片容器中的封面图
            if (!img) {
                const card = el.closest('.video-page-card-small, .video-page-card, .bili-video-card, .video-card, .card-box');
                if (card) {
                    img = card.querySelector('img') || card.querySelector('picture') || card.querySelector('.b-img img');
                }
            }

            if (!img) {
                // 图片可能尚未懒加载完成，安排一次重试
                if (!el._bvhRetryCount) {
                    el._bvhRetryCount = 1;
                    Utils.log('DOMWatcher.processLink retry: image not ready', `key=${bv}`, `retry=${el._bvhRetryCount}`, Utils.describeElement(el));
                    setTimeout(() => this.processLink(el), 800);
                } else if (el._bvhRetryCount < 3) {
                    el._bvhRetryCount++;
                    Utils.log('DOMWatcher.processLink retry: image not ready', `key=${bv}`, `retry=${el._bvhRetryCount}`, Utils.describeElement(el));
                    setTimeout(() => this.processLink(el), 800);
                }
                return;
            }

            // 确保标签不会注入到头像图片上
            if (img.closest('.bili-avatar, .header-dynamic-avatar')) {
                Utils.logSlow('DOMWatcher.processLink skip avatar image', start, `key=${bv}`, 30, 'log');
                return;
            }

            if (img) {
                const width = img.width || img.getBoundingClientRect().width;
                if (width > 0 && width < 83) isSmall = true;
            }

            const markParent = headerPopoverCover || img.parentNode;
            let markBeforeNode = img;
            if (headerPopoverCover) {
                markBeforeNode = Array.from(headerPopoverCover.children).find(child => child === img || child.contains(img)) || headerPopoverCover.firstChild;
            }

            let tagColorClass = 'bvh-tag-visited';
            if (isMulti) {
                // 多P统一使用蓝色 (方案A)
                tagColorClass = 'bvh-tag-mid';
            } else if (record.status === RECORD_STATUS.WATCHED && record.percent) {
                const p = parseInt(record.percent);
                if (!isNaN(p)) {
                    if (p < CONFIG.lowThreshold) tagColorClass = 'bvh-tag-low';
                    else if (p <= CONFIG.highThreshold) tagColorClass = 'bvh-tag-mid';
                    else tagColorClass = 'bvh-tag-high';
                }
            }

            const tagEl = UIComponent.createTag(tagText, tagTitle, `bvh-tag ${tagColorClass} ${isSmall ? 'bvh-tag-small' : ''}`);
            markParent.insertBefore(tagEl, markBeforeNode);
            el._bvhLastVideoKey = bv;

            if (CONFIG.showProgressBar && record.percent && !isMulti) {
                const barEl = UIComponent.createProgressBar(record.percent);
                const statsNode = el.querySelector('.bili-video-card__stats');
                if (!isHeaderPopoverLink && statsNode && el.children.length > 0) {
                    el.children[0].insertBefore(barEl, el.children[0].firstChild);
                } else {
                    markParent.insertBefore(barEl, markBeforeNode);
                }
            }
            Utils.logSlow('DOMWatcher.processLink', start, `key=${bv} record=${record.status}${record.percent || ''} multi=${isMulti} el=${Utils.describeElement(el)}`, 30, 'log');
        }
    }

    // --- 核心调度层 ---
    class AppController {
        constructor() {
            this.currentUrl = location.href;
            this.currentVideoKey = '';
            this.playerObserver = null;
            this.domWatcher = null;
            this._domStarted = false;
        }

        start() {
            const done = Utils.debugTime('AppController.start');
            const currentVersion = typeof GM_info !== 'undefined' ? (GM_info.script?.version || 'unknown') : 'unknown';
            Utils.log(`Script started v${currentVersion}`, `url=${location.href}`, `readyState=${document.readyState}`, `debug=${CONFIG.debug}`);
            injectStyles();

            // 数据迁移（v1/v2 → v3 分片，仅首次执行）
            StorageManager.migrateIfNeeded();

            this.initMenuCommands();
            StorageManager.restoreFromLocalStorage();
            StorageManager.cleanupLocalStorageBackups();

            this.deferDomStart();
            done('scheduled DOM start');
        }

        deferDomStart() {
            Utils.log('AppController.deferDomStart', `readyState=${document.readyState}`);
            const startWhenIdle = (reason) => {
                if (this._domStarted) return;
                Utils.log('DOM phase scheduled:', reason);
                const start = () => this.startDomPhase();
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(start, { timeout: DOM_IDLE_TIMEOUT });
                } else {
                    setTimeout(start, 0);
                }
            };

            const waitForHeader = () => {
                if (this._domStarted) return;
                Utils.log('AppController.waitForHeader start', `hasHeader=${!!document.querySelector(HEADER_SELECTOR)}`);

                let rootObserver = null;
                let headerObserver = null;
                let fallbackTimer = null;
                let settleTimer = null;
                const cleanup = () => {
                    if (rootObserver) rootObserver.disconnect();
                    if (headerObserver) headerObserver.disconnect();
                    if (fallbackTimer) clearTimeout(fallbackTimer);
                    if (settleTimer) clearTimeout(settleTimer);
                };
                const scheduleStart = (reason) => {
                    Utils.log('AppController.waitForHeader scheduleStart', reason);
                    cleanup();
                    startWhenIdle(reason);
                };
                const scheduleSettledStart = (reason) => {
                    if (settleTimer) clearTimeout(settleTimer);
                    Utils.log('AppController.waitForHeader scheduleSettledStart', reason);
                    settleTimer = setTimeout(() => {
                        scheduleStart(reason);
                    }, HEADER_SETTLE_DELAY);
                };
                const observeHeaderSettle = (header) => {
                    if (!header) return false;
                    Utils.log('AppController.waitForHeader observe header', Utils.describeElement(header));
                    if (rootObserver) {
                        rootObserver.disconnect();
                        rootObserver = null;
                    }
                    if (headerObserver) headerObserver.disconnect();
                    headerObserver = new MutationObserver(() => {
                        Utils.logEvery('headerMutationBatches', 10, 'header mutation observed');
                        scheduleSettledStart('header settled');
                    });
                    headerObserver.observe(header, { childList: true, subtree: true });
                    scheduleSettledStart('header ready and settled');
                    return true;
                };

                if (!observeHeaderSettle(document.querySelector(HEADER_SELECTOR))) {
                    Utils.log('AppController.waitForHeader observe document root for header');
                    rootObserver = new MutationObserver(() => {
                        observeHeaderSettle(document.querySelector(HEADER_SELECTOR));
                    });
                    rootObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
                }

                fallbackTimer = setTimeout(() => {
                    if (document.querySelector(HEADER_SELECTOR)) {
                        scheduleSettledStart('header fallback settled');
                    } else {
                        scheduleStart('header wait timeout');
                    }
                }, DOM_START_FALLBACK_DELAY);
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', waitForHeader, { once: true });
            } else {
                waitForHeader();
            }
        }

        startDomPhase() {
            if (this._domStarted) return;
            const done = Utils.debugTime('AppController.startDomPhase');
            this._domStarted = true;
            Utils.log('AppController.startDomPhase begin', `url=${location.href}`);

            this.checkFirstRun();

            // 显示迁移完成通知（等 B 站头部挂载后再写入自定义 UI）
            if (StorageManager._migrationCount > 0) {
                UIComponent.toast(`数据迁移完成：${StorageManager._migrationCount} 条记录已优化为分片存储`, 'success', 5000);
            }

            this.domWatcher = new DOMWatcher();
            this.domWatcher.scanExistingLinks();

            this.checkAndInitVideoPage();
            UIComponent.showQuickEntry();
            this.hijackRouter();
            done('initialized watchers/player/router');

            // 标签页切回时基于版本号判断是否需要同步（避免盲目全量刷新）
            document.addEventListener('visibilitychange', () => {
                Utils.log('visibilitychange', document.visibilityState);
                if (document.visibilityState === 'visible') {
                    const stale = StorageManager._syncIfStale();
                    if (stale) {
                        StorageManager._notifyChange();
                    }
                }
            });
        }

        checkFirstRun() {
            const currentVersion = typeof GM_info !== 'undefined' ? (GM_info.script?.version || '2.1.0') : '2.1.0';
            const lastVersion = GM_getValue('bvh_last_version');
            Utils.log('AppController.checkFirstRun', `last=${lastVersion || 'none'}`, `current=${currentVersion}`);
            if (lastVersion !== currentVersion) {
                UIComponent.toast(`Bilibili视频观看历史记录 更新至 v${currentVersion}`, "success", 4000);
                GM_setValue('bvh_last_version', currentVersion);
            }
        }

        initMenuCommands() {
            if (typeof GM_registerMenuCommand === 'undefined') {
                Utils.warn('GM_registerMenuCommand unavailable');
                return;
            }
            Utils.log('AppController.initMenuCommands');

            GM_registerMenuCommand('打开设置与历史管理', () => {
                UIComponent.showManagerPanel({ activeTab: 'settings' });
            });

            GM_registerMenuCommand('导出历史记录', () => {
                const data = {};
                StorageManager.getAllRecords().forEach(({ key, record }) => data[key] = record);
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bilibili-history-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            GM_registerMenuCommand('恢复面板默认位置', () => {
                GM_deleteValue('bvh_panel_position');
                const panel = document.getElementById('bvh-view-panel');
                if (panel) {
                    panel.style.left = '15px';
                    panel.style.bottom = '15px';
                    panel.style.top = 'auto';
                }
                UIComponent.toast('面板位置已恢复默认', 'success', 2000);
            });

            GM_registerMenuCommand('导入历史记录', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                        try {
                            const data = JSON.parse(ev.target.result);
                            const result = StorageManager.importRecords(data);
                            UIComponent.toast(`成功导入 ${result.count} 条新记录 (跳过 ${result.skipCount} 条已有记录)`, 'success', 4000);
                        } catch (err) {
                            UIComponent.toast('导入失败：文件格式错误', 'error');
                        }
                    };
                    reader.readAsText(file);
                };
                input.click();
            });
        }

        getRouteVideoKey() {
            return VideoKey.fromUrl(location.href) || VideoKey.normalize(window.__INITIAL_STATE__?.bvid) || '';
        }

        checkAndInitVideoPage() {
            const isVideoPage = /\/(video|v|medialist\/play|list)\//.test(location.href) || window.__INITIAL_STATE__?.bvid || /[?&]bvid=/.test(location.href);
            const routeKey = this.getRouteVideoKey();
            const observerKey = this.playerObserver?.bvId ? VideoKey.normalize(this.playerObserver.bvId) : '';
            Utils.log('AppController.checkAndInitVideoPage', `isVideoPage=${!!isVideoPage}`, `routeKey=${routeKey || 'none'}`, `observerKey=${observerKey || 'none'}`, `url=${location.href}`, `stateBvid=${window.__INITIAL_STATE__?.bvid || 'none'}`);
            if (isVideoPage) {
                if (this.playerObserver && routeKey && observerKey === VideoKey.normalize(routeKey)) {
                    Utils.log('AppController.checkAndInitVideoPage skip: same video key');
                    this.currentVideoKey = routeKey;
                    return;
                }
                if (this.playerObserver) {
                    this.playerObserver.destroy();
                }
                this.currentVideoKey = routeKey;
                this.playerObserver = new VideoPlayerObserver();
                this.playerObserver.init();
            } else if (this.playerObserver) {
                Utils.log('AppController.checkAndInitVideoPage destroy: leave video page');
                this.playerObserver.destroy();
                this.playerObserver = null;
                this.currentVideoKey = '';
            }
        }

        hijackRouter() {
            if (!history.pushState.__bvh_patched) {
                Utils.log('AppController.hijackRouter patch history methods');
                const originalPushState = history.pushState;
                const originalReplaceState = history.replaceState;

                history.pushState = function (...args) {
                    originalPushState.apply(this, args);
                    window.dispatchEvent(new Event('pushstate'));
                    window.dispatchEvent(new Event('locationchange'));
                };

                history.replaceState = function (...args) {
                    originalReplaceState.apply(this, args);
                    window.dispatchEvent(new Event('replacestate'));
                    window.dispatchEvent(new Event('locationchange'));
                };
                history.pushState.__bvh_patched = true;
            }

            window.addEventListener('popstate', () => {
                window.dispatchEvent(new Event('locationchange'));
            });

            window.addEventListener('locationchange', () => {
                if (this.currentUrl !== location.href) {
                    this.currentUrl = location.href;
                    Utils.log('Route changed:', this.currentUrl);
                    setTimeout(() => {
                        const done = Utils.debugTime('AppController.locationchange delayed refresh');
                        this.checkAndInitVideoPage();
                        UIComponent.showQuickEntry();
                        if (this.domWatcher) {
                            this.domWatcher.refreshForRoute();
                        }
                        done(`url=${location.href}`);
                    }, 500);
                }
            });
        }
    }

    // --- 启动 ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const app = new AppController();
            app.start();
        });
    } else {
        const app = new AppController();
        app.start();
    }

})();
