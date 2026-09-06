// ==UserScript==
// @name         Bilibili视频观看历史记录
// @namespace    Bilibili-video-History
// @version      4.0.1
// @description  记录并提示Bilibili已观看或已访问但未观看视频记录。支持历史搜索、统计图表、历史页同步和保留周期清理。
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
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
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

    const FLOATING_BUTTON_VISIBILITY = {
        SHOW_ALL: 'show-all',
        HIDE_VIDEO: 'hide-video',
        HIDE_NON_VIDEO: 'hide-non-video',
        HIDE_ALL: 'hide-all'
    };
    const FLOATING_BUTTON_VISIBILITY_VALUES = Object.values(FLOATING_BUTTON_VISIBILITY);

    const DEFAULT_CONFIG = {
        showProgressBar: true,
        showVisitedTag: true,
        debug: false,
        tagOpacity: 100,
        tagPosition: 'top-left',
        lowThreshold: 30,
        highThreshold: 80,
        autoResumePrompt: true,
        floatingButtonVisibility: FLOATING_BUTTON_VISIBILITY.SHOW_ALL
    };

    const CONFIG = Object.assign({}, DEFAULT_CONFIG, GM_getValue('bvh_settings', {}));

    const getFloatingButtonVisibility = () => (
        FLOATING_BUTTON_VISIBILITY_VALUES.includes(CONFIG.floatingButtonVisibility)
            ? CONFIG.floatingButtonVisibility
            : FLOATING_BUTTON_VISIBILITY.SHOW_ALL
    );
    const shouldHideVideoPageFloat = () => {
        const visibility = getFloatingButtonVisibility();
        return visibility === FLOATING_BUTTON_VISIBILITY.HIDE_VIDEO
            || visibility === FLOATING_BUTTON_VISIBILITY.HIDE_ALL;
    };
    const shouldHideNonVideoPageFloat = () => {
        const visibility = getFloatingButtonVisibility();
        return visibility === FLOATING_BUTTON_VISIBILITY.HIDE_NON_VIDEO
            || visibility === FLOATING_BUTTON_VISIBILITY.HIDE_ALL;
    };
    const isVideoPageRoute = () => /\/(video|v|medialist\/play|list)\//.test(location.href)
        || !!window.__INITIAL_STATE__?.bvid
        || /[?&]bvid=/.test(location.href);

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
        .bvh-progress-toast.is-pending .bvh-toast-progress-fill { width: 35%; animation: bvh-undo-pending 1.2s ease-in-out infinite alternate; }
        @keyframes bvh-undo-pending { from { transform: translateX(0); } to { transform: translateX(185%); } }
        @media (prefers-reduced-motion: reduce) { .bvh-progress-toast.is-pending .bvh-toast-progress-fill { animation: none; } }
        .bvh-view-panel { position: fixed; text-align: center; border-left: 6px solid #2196F3; background-color: #aeffff; font-family: 'Segoe UI', sans-serif; font-weight: 600; padding: 5px; z-index: 9999; cursor: move; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border-radius: 0 4px 4px 0; user-select: none; }
        .bvh-quick-entry { position: fixed; left: 15px; bottom: 15px; z-index: 9998; border: 1px solid #00aeec; background: #fff; color: #00aeec; border-radius: 6px; padding: 7px 10px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.16); }
        .bvh-history-sync-float { position: fixed; right: 22px; bottom: 86px; z-index: 9998; border: 1px solid #00aeec; background: #00aeec; color: #fff; border-radius: 6px; padding: 9px 13px; cursor: pointer; font-weight: 800; font-size: 13px; line-height: 1.2; box-shadow: 0 4px 16px rgba(0,174,236,.28); transition: opacity .18s ease, transform .18s ease, background .18s ease; }
        .bvh-history-sync-float:hover { background: #0097d8; transform: translateY(-1px); }
        .bvh-history-sync-float.loading, .bvh-history-sync-float:disabled { opacity: .72; cursor: wait; transform: none; }
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
        save: async (patch = {}) => {
            const next = Object.assign({}, CONFIG, patch);
            await HistoryStoreIO.set('bvh_settings', next);
            Object.assign(CONFIG, next);
            if (patch.debug) Utils.installIssueHooks();
            const needsDomRefresh = Object.keys(patch).some(key => DISPLAY_SETTINGS.has(key));
            if (needsDomRefresh) {
                StorageManager._notifyChange({ settingsChanged: true });
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

    // --- 不可变提交协议；旧分片仅作为兼容读取基线 ---
    const HistoryStoreIO = {
        async call(name, ...args) {
            const modern = typeof GM !== 'undefined' && GM[name];
            if (typeof modern === 'function') return await modern.apply(GM, args);
            const legacy = { getValue: typeof GM_getValue === 'function' && GM_getValue,
                setValue: typeof GM_setValue === 'function' && GM_setValue,
                deleteValue: typeof GM_deleteValue === 'function' && GM_deleteValue,
                listValues: typeof GM_listValues === 'function' && GM_listValues }[name];
            if (!legacy) throw new Error(`当前脚本环境缺少存储能力：${name}`);
            return await legacy(...args);
        },
        get(key, fallback) { return this.call('getValue', key, fallback); },
        set(key, value) { return this.call('setValue', key, value); },
        list() { return this.call('listValues'); },
        delete(key) { return this.call('deleteValue', key); }
    };

    // 只读请求有限并发；所有写入仍沿用原事务顺序。
    async function readHistoryBatch(items, read) {
        const results = [];
        for (let offset = 0; offset < items.length; offset += 4) {
            const batch = await Promise.allSettled(items.slice(offset, offset + 4).map(read));
            const failure = batch.find(result => result.status === 'rejected');
            if (failure) throw failure.reason;
            results.push(...batch.map(result => result.value));
        }
        return results;
    }

    class HistoryCommitStore {
        constructor(io = HistoryStoreIO) {
            this.io = io;
            this.writer = crypto.randomUUID();
            this.sequence = 0;
            this.clock = 0;
            this.entries = new Map();
            this.commits = new Map();
            this.baseline = new Map();
            this.initialized = false;
            this.syncing = null;
            this.scope = null;
            this.headers = new Map();
        }
        version(time = Date.now()) {
            this.clock = Math.max(this.clock + 1, time);
            return [this.clock, this.writer, ++this.sequence];
        }
        static compare(a, b) {
            return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2];
        }
        static checksum(value) {
            const text = JSON.stringify(value);
            let hash = 2166136261;
            for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
            return `${text.length}:${hash >>> 0}`;
        }
        async readCommit(key, knownManifest) {
            const manifest = knownManifest || await this.io.get(key);
            if (!manifest || manifest.protocol !== 1 || !Array.isArray(manifest.blocks) || !manifest.blocks.length) return null;
            const entries = [];
            const blocks = await readHistoryBatch(manifest.blocks, ref => this.io.get(ref.key));
            for (let index = 0; index < manifest.blocks.length; index++) {
                const ref = manifest.blocks[index];
                if (typeof ref.key !== 'string' || !ref.key.startsWith(manifest.kind === 'checkpoint' ? 'bvh_checkpoint_' : 'bvh_tx_')) return null;
                const block = blocks[index];
                const segmentStart = performance.now();
                if (!block || block.id !== manifest.id || !Array.isArray(block.entries)
                    || block.entries.length !== ref.count || HistoryCommitStore.checksum(block) !== ref.checksum) return null;
                for (const entry of block.entries) {
                    if (!entry || !VideoKey.isValid(entry.key) || !Array.isArray(entry.version)
                        || !Number.isFinite(entry.version[0]) || typeof entry.version[1] !== 'string'
                        || !Number.isFinite(entry.version[2]) || (!entry.deleted && !entry.record)) return null;
                    entries.push(entry);
                }
                HistoryQueries.recordSegment(performance.now() - segmentStart);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            return entries.length === manifest.count ? { manifest, entries } : null;
        }
        async sync() {
            if (this.syncing) return this.syncing;
            this.syncing = this._sync();
            try { return await this.syncing; } finally { this.syncing = null; }
        }
        async _sync() {
            const keys = await this.io.list();
            const commitKeys = keys.filter(key => key.startsWith('bvh_commit_'));
            if (this._hasView && !this._incomplete && this.seenKeys && commitKeys.length === this.seenKeys.size && commitKeys.every(key => this.seenKeys.has(key))) return new Set();
            const index = this.scope ? await this.io.get(StorageManager._BASE_INDEX_KEY) : null;
            const covered = new Set(index?.complete ? index.coverage || [] : []);
            const targetShards = new Set();
            if (this.scope) for (const base of this.scope) {
                for (const shard of index?.index?.[base] || []) targetShards.add(shard);
                for (const key of this.requestedKeys || []) if (VideoKey.base(key) === base) targetShards.add(StorageManager._getShardId(key));
            }
            let segmentStart = performance.now();
            const yieldIfNeeded = async () => {
                if (performance.now() - segmentStart < 8) return;
                await new Promise(resolve => setTimeout(resolve, 0)); segmentStart = performance.now();
            };
            if (!this.initialized) {
                const shardKeys = Array.from({ length: SHARD_COUNT }, (_, shard) => shard)
                    .filter(shard => !this.scope || !index?.complete || targetShards.has(shard))
                    .map(shard => `bvh_shard_${shard}`).filter(key => keys.includes(key));
                const shards = await readHistoryBatch(shardKeys, key => this.io.get(key, {}));
                for (const data of shards) {
                    for (const [key, record] of Object.entries(data || {})) this.addBaseline(key, record);
                    await yieldIfNeeded();
                }
                // 旧版独立 key 直接参与兼容视图，不删除升级前的唯一副本。
                const legacyKeys = keys.filter(key => /^(?:BV[a-zA-Z0-9]{10}|av\d+)(?:\?p=\d+)?$/.test(key) && (!this.scope || this.scope.has(VideoKey.base(key))));
                const legacyValues = await readHistoryBatch(legacyKeys, key => this.io.get(key));
                for (let index = 0; index < legacyKeys.length; index++) {
                    const key = legacyKeys[index], value = legacyValues[index];
                    if (value) this.addBaseline(key, value);
                }
                this.initialized = true;
            }
            const commits = new Map();
            this._incomplete = false;
            const skippedLegacy = new Map();
            const intersectsShards = header => header.blocks.some(ref => {
                const shard = header.kind === 'checkpoint' ? Number(ref.key.split('_')[2]) : Number(ref.key.split('_').at(-1));
                return targetShards.has(shard);
            });
            const loadedCommits = await readHistoryBatch(commitKeys, async key => {
                if (this.commits.has(key)) return this.commits.get(key);
                if (!this.scope) { const commit = await this.readCommit(key); if (!commit) this._incomplete = true; return commit; }
                if (!this.scope.size) return null;
                const route = covered.has(key) && index.routes?.[key];
                if (Array.isArray(route) && !route.some(base => this.scope.has(base))) return null;
                const header = this.headers.get(key) || await this.io.get(key);
                if (!header) { this._incomplete = true; return null; }
                this.headers.set(key, header);
                if (Array.isArray(header.bases)) {
                    if (!header.bases.some(base => this.scope.has(base))) return null;
                } else if (covered.has(key) && Array.isArray(header.blocks) && !intersectsShards(header)) { skippedLegacy.set(key, header); return null; }
                // 命中一个视频也校验整个事务，缺失其他块的批次仍然不可见。
                const commit = await this.readCommit(key, header);
                if (!commit) this._incomplete = true;
                return commit;
            });
            for (let index = 0; index < commitKeys.length; index++) {
                const key = commitKeys[index], commit = loadedCommits[index];
                if (commit) commits.set(key, commit);
                await yieldIfNeeded();
            }
            // 旧索引不包含已删除的 P。批次带出的其他 P 必须追查其分片里的删除标记。
            if (this.scope) for (;;) {
                for (const commit of commits.values()) for (const entry of commit.entries) {
                    if (this.scope.has(VideoKey.base(entry.key))) targetShards.add(StorageManager._getShardId(entry.key));
                }
                const extra = [...skippedLegacy].filter(([, header]) => intersectsShards(header));
                if (!extra.length) break;
                const loaded = await readHistoryBatch(extra, ([key, header]) => this.readCommit(key, header));
                extra.forEach(([key], index) => {
                    skippedLegacy.delete(key);
                    if (loaded[index]) commits.set(key, loaded[index]); else this._incomplete = true;
                });
            }
            const afterKeys = (await this.io.list()).filter(k => k.startsWith('bvh_commit_')).sort();
            if (JSON.stringify(afterKeys) !== JSON.stringify(keys.filter(k => k.startsWith('bvh_commit_')).sort())) return this._sync();
            const removed = [...this.commits.keys()].some(key => !commits.has(key));
            const rebuild = !this._hasView || removed;
            const entries = new Map(rebuild ? this.baseline : this.entries), candidates = new Set(rebuild ? entries.keys() : []);
            let processed = 0;
            for (const [container, commit] of commits) if (rebuild || !this.commits.has(container)) for (const entry of commit.entries) {
                if (this.scope && !this.scope.has(VideoKey.base(entry.key))) continue;
                candidates.add(entry.key);
                const previous = entries.get(entry.key);
                this.clock = Math.max(this.clock, entry.version[0]);
                const cmp = previous ? HistoryCommitStore.compare(entry.version, previous.version) : 1;
                if (cmp > 0 || (cmp === 0 && container > (previous.container || ''))) entries.set(entry.key, { ...entry, container });
                if (++processed % 128 === 0) await yieldIfNeeded();
            }
            const changed = new Set();
            for (const key of candidates) {
                const entry = entries.get(key);
                const old = this.entries.get(key);
                if (!old || HistoryCommitStore.compare(old.version, entry.version) !== 0 || old.deleted !== entry.deleted) changed.add(key);
            }
            if (rebuild) for (const key of this.entries.keys()) if (!entries.has(key)) changed.add(key);
            this.entries = entries;
            this.commits = commits;
            this._hasView = true;
            this.seenKeys = new Set(commitKeys);
            for (const key of this.headers.keys()) if (!this.seenKeys.has(key)) this.headers.delete(key);
            return changed;
        }
        addBaseline(rawKey, value) {
            const key = VideoKey.normalize(rawKey);
            if (!key || !value) return;
            if (this.scope && !this.scope.has(VideoKey.base(key))) return;
            let record = StorageManager._compact(value);
            const time = Array.isArray(value) ? Date.parse(value[3]) : value.a !== undefined ? value.a * 1000 : Date.parse(value.savedAt);
            if (!Number.isFinite(time)) record = { ...record, a: null };
            const entry = { key, record, deleted: false, source: 'legacy', version: [Number.isFinite(time) ? time : 0, '', 0] };
            const old = this.baseline.get(key);
            if (!old || HistoryCommitStore.compare(entry.version, old.version) > 0) this.baseline.set(key, entry);
        }
        transactionId() { return `${String(Date.now()).padStart(16, '0')}_${this.writer}_${String(++this.sequence).padStart(12, '0')}`; }
        async prepare(entries, kind = 'tx', identity, createdAt = Date.now()) {
            const id = identity || this.transactionId();
            const grouped = new Map();
            await HistoryQueries.each(entries, entry => {
                const shard = StorageManager._getShardId(entry.key);
                if (!grouped.has(shard)) grouped.set(shard, []);
                // 深拷贝后重试沿用原采样版本，外部修改不会改变不可变块。
                const copy = JSON.parse(JSON.stringify(entry)); delete copy.container;
                grouped.get(shard).push(copy);
            });
            const blocks = [...grouped].map(([shard, entries]) => ({
                key: kind === 'checkpoint' ? `bvh_checkpoint_${shard}_${id}` : `bvh_tx_${id}_${shard}`,
                value: { id, createdAt, entries }
            }));
            const manifest = { protocol: 1, kind, id, createdAt, count: entries.length,
                bases: [...new Set(entries.map(entry => VideoKey.base(entry.key)))].sort(),
                blocks: blocks.map(block => ({ key: block.key, count: block.value.entries.length, checksum: HistoryCommitStore.checksum(block.value) })) };
            return { key: `bvh_commit_${id}`, blocks, manifest };
        }
        async publish(transaction, guard, deferSync = false) {
            if (!transaction.blocks.length) return new Set();
            // 重试前检查并补齐块，沿用原事务身份。
            for (const block of transaction.blocks) {
                const current = await this.io.get(block.key);
                if (!current) await this.io.set(block.key, block.value);
                else if (HistoryCommitStore.checksum(current) !== HistoryCommitStore.checksum(block.value)) throw new Error('提交身份冲突，已保留原数据');
                const confirmed = await this.io.get(block.key);
                const segmentStart = performance.now();
                if (HistoryCommitStore.checksum(confirmed) !== HistoryCommitStore.checksum(block.value)) throw new Error('历史数据块写入未确认，请重试');
                HistoryQueries.recordSegment(performance.now() - segmentStart);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (guard && !await guard()) { const error = new Error('准备期间记录发生变化，重新评估'); error.code = 'BVH_RETRY'; throw error; }
            const prior = await this.io.get(transaction.key);
            const comparable = prior && !prior.bases ? { ...transaction.manifest, bases: undefined } : transaction.manifest;
            if (prior && HistoryCommitStore.checksum(prior) !== HistoryCommitStore.checksum(comparable)) throw new Error('提交清单身份冲突');
            if (!prior) await this.io.set(transaction.key, transaction.manifest);
            if (!await this.readCommit(transaction.key)) throw new Error('历史提交未确认，请保留备份并重试');
            if (deferSync) return new Set();
            const changed = await this.sync();
            // 提示失败不把已经完整发布的事务伪报为失败；枚举会补齐丢失信号。
            try { await this.io.set('bvh_change_signal', { id: transaction.manifest.id, keys: [...changed] }); }
            catch (error) { Utils.warn('历史已提交，跨页提示稍后通过枚举补齐', error); }
            return changed;
        }
        async compact({ resume = false } = {}) {
            if (this.scope) throw new Error('内部整理需要先加载完整历史');
            await this.sync();
            if (!this.entries.size) return { before: this.commits.size, after: this.commits.size };
            const before = this.commits.size;
            // 每个 base 固定进入一个整理组，避免一个全量检查点迫使视频页读取全部历史。
            const groups = new Map();
            for (const entry of this.entries.values()) {
                const group = StorageManager._getShardId(VideoKey.base(entry.key));
                if (!groups.has(group)) groups.set(group, []);
                groups.get(group).push(entry);
            }
            const replacements = [];
            const checkpointTime = [...this.commits.values()].reduce((time, commit) => Math.max(time, Number(commit.manifest.id.split('_')[0]) || 0), Date.now()) + 1;
            for (const entries of groups.values()) {
                // 已完成的组本身就是持久进度；中断重启后验证并复用，不依赖易失游标。
                const groupKeys = new Set(entries.map(entry => entry.key));
                const matching = resume && [...this.commits].find(([key, commit]) =>
                    commit.manifest.kind === 'checkpoint' && commit.entries.length === entries.length
                    && commit.entries.every(entry => {
                        const current = this.entries.get(entry.key);
                        return groupKeys.has(entry.key) && current?.container === key && HistoryCommitStore.compare(current.version, entry.version) === 0;
                    }));
                if (matching) { replacements.push(matching[0]); continue; }
                // 同毫秒的跨页提交也必须能被严格更新的物理副本覆盖，业务版本保持不变。
                const identity = `${String(checkpointTime).padStart(16, '0')}_${this.writer}_${String(++this.sequence).padStart(12, '0')}`;
                const transaction = await this.prepare(entries, 'checkpoint', identity);
                await this.publish(transaction, null, true); replacements.push(transaction.key);
            }
            await this.sync();
            const byKey = new Map(), retained = new Set(replacements);
            for (const key of replacements) {
                const replacement = await this.readCommit(key);
                for (const entry of replacement?.entries || []) byKey.set(entry.key, { ...entry, container: key });
            }
            // 每个旧清单整体判断，禁止先删多分片事务的一部分数据块。
            // 替代副本若被其他整理回收，其严格更高的替代链仍完整保留这些版本。
            for (const [key, commit] of [...this.commits]) {
                if (retained.has(key)) continue;
                const covered = commit.entries.every(entry => {
                    const next = byKey.get(entry.key);
                    if (!next) return false;
                    const cmp = HistoryCommitStore.compare(next.version, entry.version);
                    return cmp > 0 || (cmp === 0 && next.container > key);
                });
                if (!covered) continue;
                await this.io.delete(key);
                for (const ref of commit.manifest.blocks) await this.io.delete(ref.key);
            }
            await this.sync();
            return { before, after: this.commits.size };
        }
        async stagingInfo() {
            const keys = await this.io.list(), referenced = new Set();
            for (const key of keys.filter(k => k.startsWith('bvh_commit_'))) {
                const manifest = await this.io.get(key);
                for (const ref of manifest?.blocks || []) referenced.add(ref.key);
            }
            let count = 0, bytes = 0;
            for (const key of keys.filter(k => /^(bvh_tx_|bvh_checkpoint_)/.test(k) && !referenced.has(k))) {
                const value = await this.io.get(key); count++; bytes += new TextEncoder().encode(JSON.stringify(value)).length;
            }
            return { count, bytes };
        }
        async cleanupStaging({ writersStopped = false } = {}) {
            if (!writersStopped) throw new Error('请先停止所有写入页面，再执行离线清理');
            const keys = await this.io.list();
            const protectedBlocks = new Set();
            for (const key of keys.filter(key => key.startsWith('bvh_commit_'))) {
                const manifest = await this.io.get(key);
                for (const ref of manifest?.blocks || []) protectedBlocks.add(ref.key);
            }
            let removed = 0;
            for (const key of keys.filter(key => key.startsWith('bvh_tx_') || key.startsWith('bvh_checkpoint_'))) {
                if (protectedBlocks.has(key)) continue;
                const block = await this.io.get(key);
                if (!block || Date.now() - block.createdAt <= 86400000) continue;
                // 清单可能在枚举之后发布；删除前再次检查该事务身份。
                if (await this.io.get(`bvh_commit_${block.id}`)) continue;
                await this.io.delete(key); removed++;
            }
            return removed;
        }
    }

    const SHARD_COUNT = 64;
    const STATUS_MAP = { 0: '已访问', 1: '已观看', 2: '已删除' };
    const STATUS_REVERSE = { '已访问': 0, '已观看': 1, '已删除': 2 };
    const StorageManager = {
        _store: new HistoryCommitStore(),
        _ready: null, _queue: Promise.resolve(), _dataVersion: 0, _migrationCount: 0,
        _shardCache: new Map(), _bvBaseIndex: new Map(), _shardForBase: new Map(),
        _allKeysCache: null, _changeCallbacks: new Set(), _pendingChange: null, _changeTimer: null,
        _BASE_INDEX_KEY: 'bvh_base_index',
        _getShardId(id) {
            let hash = 0x811c9dc5;
            for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = (hash * 0x01000193) | 0; }
            return Math.abs(hash) % SHARD_COUNT;
        },
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
            const savedAt = Number.isFinite(compact.a) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '';
            return {
                v: 3,
                status: STATUS_MAP[compact.s] || '已访问',
                currentTime: compact.t || '',
                percent: compact.p ? compact.p + '%' : '',
                savedAt: savedAt,
                title: compact.n || ''
            };
        },


        onDataChange(cb) {
            StorageManager._changeCallbacks.add(cb);
            return () => StorageManager._changeCallbacks.delete(cb);
        },
        _notifyChange(event = { fullReset: true }) {
            const s = StorageManager;
            const pending = s._pendingChange ||= { changedKeys: new Set(), changedBases: new Set(), settingsChanged: false, fullReset: false };
            for (const key of event.changedKeys || []) { pending.changedKeys.add(key); pending.changedBases.add(VideoKey.base(key)); }
            for (const base of event.changedBases || []) pending.changedBases.add(base);
            pending.settingsChanged ||= !!event.settingsChanged; pending.fullReset ||= !!event.fullReset;
            if (s._changeTimer) clearTimeout(s._changeTimer);
            s._changeTimer = setTimeout(() => {
                const change = s._pendingChange; s._pendingChange = null; s._changeTimer = null;
                change.dataVersion = s._dataVersion;
                for (const cb of [...s._changeCallbacks]) { try { cb(change); } catch (error) { Utils.error('历史更新回调失败', error); } }
            }, 150);
        },
        initialize() {
            const s = StorageManager;
            if (!s._ready) s._ready = (async () => {
                await s._loadScope(null);
                await s._persistBaseIndex();
                await HistoryStoreIO.set('bvh_protocol', { version: 1, legacyRetained: true });
                s._scheduleCompaction();
                if (s._listener === undefined && typeof GM_addValueChangeListener === 'function') s._listener = GM_addValueChangeListener('bvh_change_signal', (_key, _old, _next, remote) => {
                    if (remote) s._syncIfStale().catch(error => Utils.error('跨页历史同步失败', error));
                });
            })().catch(error => { s._ready = null; throw error; });
            return s._ready;
        },
        _loadScope(keys) {
            const s = StorageManager;
            const pending = (s._viewQueue || Promise.resolve()).then(async () => {
                if (s._store.syncing) await s._store.syncing;
                const full = keys === null || s._fullRequested;
                if (full) s._fullRequested = true;
                const scope = full ? null : new Set([...(s._store.scope || []), ...keys.map(VideoKey.base)]);
                const requested = new Set([...(s._store.requestedKeys || []), ...(keys || []).map(VideoKey.normalize)]);
                const changedScope = full ? s._store.scope !== null : s._store.scope === null || scope.size !== s._store.scope.size || requested.size !== (s._store.requestedKeys?.size || 0);
                if (changedScope) { s._store.initialized = false; s._store.baseline.clear(); s._store._hasView = false; }
                s._store.scope = scope; s._store.requestedKeys = requested;
                const changed = await s._store.sync(); s._accept(changed);
                s._scheduleCompaction();
                if (s._listener === undefined && typeof GM_addValueChangeListener === 'function') s._listener = GM_addValueChangeListener('bvh_change_signal', (_key, _old, _next, remote) => {
                    if (remote) s._syncIfStale().catch(error => Utils.warn('跨页同步失败', error));
                });
            });
            s._viewQueue = pending.catch(() => {}); return pending;
        },
        initializeForKeys(keys) { return StorageManager._ready || StorageManager._loadScope(keys); },
        _requestBase(key) {
            const s = StorageManager;
            if (!s._store.scope || s._store.scope.has(VideoKey.base(key))) return;
            (s._pendingBases ||= new Set()).add(key);
            if (s._baseTimer) return;
            s._baseTimer = setTimeout(() => {
                s._baseTimer = null; const keys = [...s._pendingBases]; s._pendingBases.clear();
                s.initializeForKeys(keys).catch(error => Utils.warn('视频历史读取失败', error));
            }, 80);
        },
        migrateIfNeeded() { return StorageManager.initialize(); },
        _accept(changed) {
            const s = StorageManager;
            if (!changed.size) return;
            for (const key of changed) {
                const base = VideoKey.base(key), entry = s._store.entries.get(key);
                const keys = s._bvBaseIndex.get(base) || new Set();
                if (keys.has(key) !== !!(entry && !entry.deleted)) s._allKeysCache = null;
                if (!entry || entry.deleted) keys.delete(key); else keys.add(key);
                if (keys.size) s._bvBaseIndex.set(base, keys); else s._bvBaseIndex.delete(base);
            }
            HistoryQueries.invalidate(changed);
            s._dataVersion++; s._notifyChange({ changedKeys: changed });
        },
        async _syncIfStale() {
            if (!StorageManager._ready && StorageManager._store.scope) {
                const before = StorageManager._dataVersion;
                await StorageManager._loadScope([]); return StorageManager._dataVersion !== before;
            }
            await StorageManager.initialize();
            const changed = await StorageManager._store.sync();
            StorageManager._accept(changed); return changed.size > 0;
        },
        async _persistBaseIndex(store = StorageManager._store) {
            const s = StorageManager, index = {};
            if (store.scope) return;
            for (const [key, entry] of store.entries) if (!entry.deleted) {
                const base = VideoKey.base(key), shard = s._getShardId(key);
                if (!index[base]) index[base] = [];
                if (!index[base].includes(shard)) index[base].push(shard);
            }
            await HistoryStoreIO.set(s._BASE_INDEX_KEY, { version: 2, complete: true,
                coverage: [...store.commits.keys()].sort(), index,
                routes: Object.fromEntries([...store.commits].map(([key, commit]) => [key, [...new Set(commit.entries.map(entry => VideoKey.base(entry.key)))]])) });
        },
        async _rebuildBaseIndex() {
            await StorageManager.initialize();
            StorageManager._bvBaseIndex.clear();
            StorageManager._accept(new Set(StorageManager._store.entries.keys()));
            await StorageManager._persistBaseIndex();
        },
        invalidateCache() { return StorageManager._syncIfStale(); },
        getRecord(id) {
            StorageManager._requestBase(id);
            const entry = StorageManager._store.entries.get(VideoKey.normalize(id));
            return entry && !entry.deleted ? StorageManager._expand(entry.record) : null;
        },
        getAllKeys() { return StorageManager._allKeysCache ||= [...StorageManager._bvBaseIndex.values()].flatMap(keys => [...keys]); },
        getRelatedKeys(base) {
            StorageManager._requestBase(base);
            return [...(StorageManager._bvBaseIndex.get(VideoKey.base(base)) || [])].sort((a, b) => VideoKey.page(a) - VideoKey.page(b));
        },
        getAllRecords() { return StorageManager.getAllKeys().map(key => ({ key, record: StorageManager.getRecord(key) })); },
        validateImport(data) {
            if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('文件必须是视频 key 对应记录的对象');
            const result = [], seen = new Set();
            for (const [rawKey, input] of Object.entries(data)) {
                const fail = field => { throw new Error(rawKey + '：' + field + ' 无效'); };
                if (!/^(?:[Bb][Vv][A-Za-z0-9]{10}|av[0-9]+)(?:\?p=[1-9][0-9]*)?$/.test(rawKey)) fail('视频 key');
                const key = VideoKey.normalize(rawKey);
                if (seen.has(key)) fail('规范化后的视频 key 重复'); seen.add(key);
                if (!input || typeof input !== 'object') fail('记录');
                const v = Array.isArray(input) ? { status: input[0], currentTime: input[1], percent: input[2], savedAt: input[3], title: input[4] } : input;
                const compact = v.s !== undefined;
                const status = compact ? v.s : v.status;
                if (status !== undefined && !(compact ? [0, 1, 2].includes(status) : Object.values(RECORD_STATUS).includes(status))) fail('状态');
                const percent = compact ? v.p : v.percent;
                if (percent !== undefined && percent !== '' && !(typeof percent === 'number' && Number.isFinite(percent) || typeof percent === 'string' && /^\d+(?:\.\d+)?%?$/.test(percent))) fail('百分比');
                const numeric = parseFloat(percent || 0);
                if (numeric < 0 || numeric > 100) fail('百分比范围');
                const time = compact ? v.a : v.savedAt;
                if (time !== undefined && time !== '' && !(compact ? typeof time === 'number' && Number.isFinite(time) && Number.isFinite(new Date(time * 1000).getTime()) : typeof time === 'string' && Number.isFinite(Date.parse(time)))) fail('保存时间');
                for (const field of compact ? ['t', 'n'] : ['currentTime', 'title']) if (v[field] !== undefined && typeof v[field] !== 'string') fail(field);
                result.push({ key, record: StorageManager._compact(v) });
            }
            return result;
        },
        sampleVersion() { return StorageManager._store.version(); },
        dispose() {
            StorageManager._disposed = true;
            clearTimeout(StorageManager._compactionTimer); StorageManager._compactionTimer = null;
            if (StorageManager._listener !== undefined && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(StorageManager._listener);
            StorageManager._listener = undefined;
            clearTimeout(StorageManager._baseTimer); StorageManager._baseTimer = null; StorageManager._pendingBases?.clear();
        },
        _enqueue(operation) {
            const s = StorageManager;
            const promise = s._queue.then(operation); s._queue = promise.catch(() => {}); return promise;
        },
        saveRecord(key, record, notify = true, options = {}) {
            return StorageManager.saveRecords([{ key, record }], notify, options);
        },
        saveRecords(records, notify = true, options = {}) {
            const s = StorageManager;
            // 采样身份在入队前确定；等待或重试不把旧采样变成新采样。
            const version = options.version || s.sampleVersion();
            return s._enqueue(async () => {
                for (;;) {
                await s.initializeForKeys(records.map(item => item.key)); await s._syncIfStale();
                const entries = [], source = options.source || 'playback';
                const observed = new Map(records.map(item => { const key = VideoKey.normalize(item.key); return [key, JSON.stringify(s._store.entries.get(key)?.version)]; }));
                for (const item of records) {
                    const key = VideoKey.normalize(item.key); if (!key) throw new Error('视频 key 无效');
                    const current = s._store.entries.get(key), record = s._compact(item.record);
                    if ((source === 'import' || source === 'visit') && current && !current.deleted) continue;
                    if (source === 'visit' && current && HistoryCommitStore.compare(version, current.version) <= 0) continue;
                    if (source === 'title') {
                        if (!current || current.deleted || current.record.n || !record.n?.trim()) continue;
                        const title = record.n.trim();
                        Object.assign(record, current.record, { n: title });
                    }
                    if (source === 'history' && current && !current.deleted) {
                        if (record.p - current.record.p <= 5) continue;
                        if (!record.t) record.t = current.record.t;
                        if (!record.n) record.n = current.record.n;
                    }
                    if (source === 'backup' && current && HistoryCommitStore.compare(version, current.version) <= 0) continue;
                    if (source === 'undo' && (!current?.deleted || current.deleteId !== options.deleteId)) continue;
                    entries.push({ key, record, deleted: false, source: options.transactionId ? 'playback' : source, version: ['playback', 'backup', 'visit'].includes(source) ? version : s.sampleVersion() });
                }
                if (!entries.length) return options.details ? { count: 0, created: 0, updated: 0 } : 0;
                const created = entries.filter(entry => !s.getRecord(entry.key)).length;
                const transaction = await s._store.prepare(entries, 'tx', options.transactionId, options.transactionId ? version[0] : Date.now());
                let changed;
                try {
                    changed = await s._store.publish(transaction, source === 'playback' ? null : async () => {
                        const changes = await s._store.sync(); s._accept(changes);
                        return [...observed].every(([key, version]) => JSON.stringify(s._store.entries.get(key)?.version) === version);
                    });
                } catch (error) { if (error.code === 'BVH_RETRY') continue; throw error; }
                s._accept(new Set([...changed, ...entries.map(e => e.key)]));
                // 新提交自带 bases；旧索引 coverage 之外的提交会独立读取，无需每次保存重写全量索引。
                // 完整派生索引由显式全量初始化、重建或后台整理维护。
                s._scheduleCompaction();
                return options.details ? { count: entries.length, created, updated: entries.length - created } : entries.length;
                }
            });
        },
        async importRecords(data) {
            const rows = StorageManager.validateImport(data);
            const count = await StorageManager.saveRecords(rows, true, { source: 'import' });
            return { count, skipCount: rows.length - count };
        },
        deleteRecord(key, notify = true) { return StorageManager.deleteRecords([key], notify); },
        deleteRecords(keys, notify = true, options = {}) {
            const s = StorageManager;
            return s._enqueue(async () => {
                await s.initialize(); await s._syncIfStale();
                const deleteId = crypto.randomUUID(), backups = [], entries = [];
                for (const rawKey of new Set(keys)) {
                    const key = VideoKey.normalize(rawKey), record = s.getRecord(key);
                    if (!record) continue;
                    backups.push({ key, record }); entries.push({ key, deleted: true, version: s.sampleVersion(), source: 'delete', deleteId });
                }
                if (entries.length) {
                    const changed = await s._store.publish(await s._store.prepare(entries)); s._accept(new Set([...changed, ...entries.map(e => e.key)]));
                    for (const { key } of entries) { try { localStorage.removeItem(BACKUP_PREFIX + key); } catch {} }
                    try { await s._persistBaseIndex(); } catch (error) { Utils.warn('删除已提交，索引可重建', error); }
                }
                const result = { count: entries.length, deleteId, backups };
                return options.details ? result : result.count;
            });
        },
        async deleteRecordsWithProgress(keys, callback, notify = true) {
            callback?.({ processed: 0, total: keys.length, deleted: 0, shardsDone: 0, shardsTotal: 1 });
            const count = await StorageManager.deleteRecords(keys, notify);
            callback?.({ processed: keys.length, total: keys.length, deleted: count, shardsDone: 1, shardsTotal: 1 }); return count;
        },
        undoDelete(result) { return StorageManager.saveRecords(result.backups, true, { source: 'undo', deleteId: result.deleteId }); },
        _scheduleCompaction() {
            const s = StorageManager;
            if (s._disposed || s._compactionTimer || s._maintenance) return;
            s._compactionTimer = setTimeout(() => {
                s._compactionTimer = null;
                s._maintenance = s._maintainHistory().catch(error => Utils.warn('后台整理未完成，下次访问自动继续', error))
                    .finally(() => { s._maintenance = null; });
            }, 2000);
        },
        async _maintainHistory() {
            const s = StorageManager;
            // 独立实例且每次存储操作让出事件循环，不占用前台保存队列或升级局部缓存。
            const io = Object.fromEntries(['get', 'set', 'list', 'delete'].map(name => [name, async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (s._disposed) throw new Error('页面已关闭');
                return HistoryStoreIO[name](...args);
            }]));
            const keys = (await io.list()).filter(key => key.startsWith('bvh_commit_'));
            const done = await io.get('bvh_grouping_complete_v1');
            const covered = new Set(done?.coverage || []), pending = keys.filter(key => !covered.has(key));
            if (done && pending.length < 128) {
                let wide = false;
                for (const key of pending) {
                    const manifest = await io.get(key);
                    if (!Array.isArray(manifest?.bases) || new Set(manifest.bases.map(s._getShardId)).size > 1) { wide = true; break; }
                }
                if (!wide) return;
            }
            const worker = new HistoryCommitStore(io);
            await worker.sync();
            if (worker._incomplete) throw new Error('存在未通过完整性校验的提交');
            const result = await worker.compact({ resume: true });
            if (worker._incomplete) throw new Error('整理期间存在未通过完整性校验的提交');
            await s._persistBaseIndex(worker);
            // 只覆盖实际整理过的清单，并发产生的新提交仍会在后续检查中被识别。
            const coverage = [...worker.commits].filter(([, commit]) => commit.manifest.kind === 'checkpoint'
                && new Set(commit.entries.map(entry => s._getShardId(VideoKey.base(entry.key)))).size <= 1).map(([key]) => key);
            await io.set('bvh_grouping_complete_v1', { coverage });
            await io.set('bvh_change_signal', { writer: worker.writer, time: Date.now() });
            await s._syncIfStale();
            Utils.log('历史后台分组整理完成', `提交数=${result.before}→${result.after}`);
        },
        async createLegacySnapshot({ writersStopped = false } = {}) {
            if (!writersStopped) throw new Error('请先停止所有其他页面写入');
            await StorageManager.initialize();
            await StorageManager._syncIfStale();
            const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
            for (const [key, entry] of StorageManager._store.entries) if (!entry.deleted) shards[StorageManager._getShardId(key)][key] = entry.record;
            for (let i = 0; i < SHARD_COUNT; i++) {
                await HistoryStoreIO.set('bvh_shard_' + i, shards[i]);
                if (HistoryCommitStore.checksum(await HistoryStoreIO.get('bvh_shard_' + i)) !== HistoryCommitStore.checksum(shards[i])) throw new Error('兼容快照写入未确认');
            }
            await HistoryStoreIO.set('bvh_meta', { version: 3, shardCount: SHARD_COUNT });
            return StorageManager.getAllKeys().length;
        },
        writeBackup(snapshot) {
            try { localStorage.setItem(BACKUP_PREFIX + snapshot.key, JSON.stringify({ ...snapshot, savedAt: snapshot.version?.[0] || Date.now() })); }
            catch (error) { Utils.error('临时备份无法写入', error); }
        },
        async restoreFromLocalStorage() {
            let keys;
            try { keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k?.startsWith(BACKUP_PREFIX)); }
            catch (error) { Utils.warn('无法读取临时备份', error); return; }
            for (const key of keys) {
                try {
                    const backup = JSON.parse(localStorage.getItem(key));
                    const time = backup?.savedAt || Date.parse(backup?.value?.savedAt);
                    if (!Number.isFinite(time) || Date.now() - time > BACKUP_MAX_AGE) { localStorage.removeItem(key); continue; }
                    const rows = StorageManager.validateImport({ [backup.key]: backup.value });
                    const version = backup.version || [Date.parse(backup.value.savedAt) || 0, '', 0];
                    await StorageManager.saveRecords(rows, true, { source: 'backup', version, transactionId: backup.transactionId });
                    localStorage.removeItem(key);
                } catch (error) { Utils.warn('备份未恢复，保留以便重试', error); }
            }
        },
        cleanupLocalStorageBackups() {
            try {
                const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k?.startsWith(BACKUP_PREFIX));
                for (const key of keys) { const value = JSON.parse(localStorage.getItem(key)); const time = value?.savedAt || Date.parse(value?.value?.savedAt); if (time && Date.now() - time > BACKUP_MAX_AGE) localStorage.removeItem(key); }
            } catch (error) { Utils.warn('备份清理未完成', error); }
        },
        cleanupLocalStorageBackupsThrottled: null,
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
                UIComponent.toastContainer.setAttribute('aria-live', 'polite');
                injectWorkbenchStyles();
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
            const button = document.createElement('button'); button.textContent = '撤销'; el.appendChild(button);
            button.addEventListener('click', async () => {
                if (button.disabled) return; button.disabled = true; button.textContent = '正在撤销…';
                const progress = UIComponent.progressToast('正在撤销，恢复记录中…', { indeterminate: true });
                try { const message = await onUndo(); progress.close(message || '撤销完成', 'success'); el.remove(); }
                catch (error) {
                    progress.close('撤销失败：' + error.message, 'error', 5000);
                    button.disabled = false; button.textContent = '重试撤销';
                    if (!el.isConnected || !el.classList.contains('show')) {
                        el.remove(); UIComponent.toastUndo('记录恢复失败，可以重试', 5000, onUndo);
                    }
                }
            });
            return el;
        },
        progressToast: (msg, { indeterminate = false } = {}) => {
            UIComponent.initToastContainer();
            const el = document.createElement('div');
            el.className = 'bvh-toast success bvh-progress-toast';
            if (indeterminate) el.classList.add('is-pending', 'show');

            const text = document.createElement('div');
            text.className = 'bvh-toast-progress-text';
            text.innerText = msg;

            const track = document.createElement('div');
            track.className = 'bvh-toast-progress-track';
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-label', msg);
            if (!indeterminate) track.setAttribute('aria-valuenow', '0');
            const fill = document.createElement('div');
            fill.className = 'bvh-toast-progress-fill';
            track.appendChild(fill);

            el.appendChild(text);
            el.appendChild(track);
            UIComponent.toastContainer.appendChild(el);
            setTimeout(() => el.classList.add('show'), 10);

            const close = (message, type = 'success', duration = 2500) => {
                el.classList.remove('is-pending');
                track.setAttribute('aria-label', message);
                if (type === 'error') track.removeAttribute('aria-valuenow');
                else track.setAttribute('aria-valuenow', '100');
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
                    el.classList.remove('is-pending');
                    const safePercent = Math.max(0, Math.min(100, Math.round(percent) || 0));
                    track.setAttribute('aria-valuenow', String(safePercent));
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

            if (shouldHideVideoPageFloat()) return;
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
            const isVideoPage = isVideoPageRoute();
            if (shouldHideNonVideoPageFloat() || (isVideoPage && shouldHideVideoPageFloat())) {
                if (el) el.remove();
                return;
            }

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
        refreshFloatingButtons: () => {
            const panel = document.getElementById('bvh-view-panel');
            const quickEntry = document.getElementById('bvh-quick-entry');
            const isVideoPage = isVideoPageRoute();

            if (isVideoPage) {
                if (shouldHideVideoPageFloat()) {
                    if (panel) panel.remove();
                    if (quickEntry) quickEntry.remove();
                    return;
                }

                const currentKey = EpisodeResolver.getCurrentKey()
                    || VideoKey.fromUrl(location.href)
                    || VideoKey.normalize(window.__INITIAL_STATE__?.bvid);
                const record = currentKey ? StorageManager.getRecord(currentKey) : null;
                if (record) UIComponent.showViewPanel(record, currentKey);
                else UIComponent.showQuickEntry();
                return;
            }

            if (panel) panel.remove();
            if (shouldHideNonVideoPageFloat()) {
                if (quickEntry) quickEntry.remove();
                return;
            }
            UIComponent.showQuickEntry();
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
        applyPendingSeek: (currentKey, video, isValid = () => EpisodeResolver.getCurrentKey() === currentKey) => {
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
                if (!isValid()) return;
                Utils.log('UIComponent.applyPendingSeek seek', `key=${currentKey}`, `time=${pending.currentTime}`);
                video.currentTime = Utils.timeToSeconds(pending.currentTime);
                video.play();
                sessionStorage.removeItem(PENDING_SEEK_KEY);
                UIComponent.toast(`已跳转到 ${EpisodeResolver.getPageLabel(currentKey)} ${pending.currentTime}`, 'success', 2500);
            };
            if (video.readyState >= 1) seek();
            else video.addEventListener('loadedmetadata', seek, { once: true });
            return () => video.removeEventListener('loadedmetadata', seek);
        },
        showResumePrompt: (target, onStartFresh, isValid = () => true) => {
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
                if (!isValid()) { el.remove(); return; }
                if (action === 'resume') UIComponent.resumeToRecord(target?.record ? target : { record });
                if (action === 'fresh' && onStartFresh) onStartFresh();
                el.remove();
            });
            document.body.appendChild(el);
            const timer = setTimeout(() => el.remove(), 15000);
            return () => { clearTimeout(timer); el.remove(); };
        },
        showManagerPanel: (options = {}) => HistoryManagerPanel.show(options)
    };

    // 数据模型与查询任务独立于面板，翻页不重新读取或排序。
    const HistoryQueries = {
        version: -1, rows: [], building: null, results: new Map(), statsCache: new Map(),
        rowMap: new Map(), dirtyKeys: new Set(),
        invalidate(keys) { for (const key of keys) this.dirtyKeys.add(key); },
        metrics: { builds: 0, sorts: 0, segments: [] },
        recordSegment(ms) {
            this.metrics.maxSegment = Math.max(this.metrics.maxSegment || 0, ms);
            if (this.metrics.segments.length >= 512) this.metrics.segments.shift();
            this.metrics.segments.push(ms);
        },
        async each(items, fn, cancelled = () => false) {
            let start = performance.now();
            for (let i = 0; i < items.length; i++) {
                if (cancelled()) { const error = new Error('查询已取消'); error.name = 'AbortError'; throw error; }
                fn(items[i], i);
                if (performance.now() - start >= 8) {
                    this.recordSegment(performance.now() - start);
                    await new Promise(resolve => setTimeout(resolve, 0)); start = performance.now();
                }
            }
            this.recordSegment(performance.now() - start);
        },
        async model() {
            await StorageManager.initialize();
            const version = StorageManager._dataVersion;
            if (this.version === version) return this.rows;
            if (this.building?.version === version) return this.building.promise;
            const promise = (async () => {
                const rowMap = new Map(this.rowMap); this.metrics.builds++;
                const keys = this.version < 0 ? StorageManager.getAllKeys().slice() : [...this.dirtyKeys];
                await this.each(keys, key => {
                    const record = StorageManager.getRecord(key);
                    if (record) rowMap.set(key, { key, record, search: (key + ' ' + record.title).toLowerCase(), percent: parseInt(record.percent) || 0, time: Date.parse(record.savedAt) });
                    else rowMap.delete(key);
                });
                if (version !== StorageManager._dataVersion) return this.model();
                const rows = [...rowMap.values()]; this.rowMap = rowMap; this.dirtyKeys.clear();
                this.rows = rows; this.version = version; this.results.clear(); this.statsCache.clear(); return rows;
            })();
            this.building = { version, promise }; return promise;
        },
        async query({ query = '', status = 'all', sort = 'savedAt-desc' } = {}, { cancelled = () => false } = {}) {
            const rows = await this.model(), version = this.version;
            const text = query.trim().toLowerCase(), cacheKey = JSON.stringify([version, text, status, sort]);
            if (this.results.has(cacheKey)) return this.results.get(cacheKey);
            const promise = (async () => {
                const selected = [];
                await this.each(rows, row => { if ((!text || row.search.includes(text)) && (status === 'all' || row.record.status === status)) selected.push(row); }, cancelled);
                const compare = (a, b) => (sort === 'percent-desc' ? b.percent - a.percent : sort === 'percent-asc' ? a.percent - b.percent : sort === 'title-asc' ? a.record.title.localeCompare(b.record.title) : sort === 'savedAt-asc' ? a.time - b.time : b.time - a.time) || a.key.localeCompare(b.key);
                this.metrics.sorts++;
                let runs = [];
                for (let i = 0; i < selected.length; i += 256) {
                    runs.push(selected.slice(i, i + 256).sort(compare));
                    if (i % 1024 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
                while (runs.length > 1) {
                    if (cancelled()) { const error = new Error('查询已取消'); error.name = 'AbortError'; throw error; }
                    const next = [];
                    for (let r = 0; r < runs.length; r += 2) {
                        const a = runs[r], b = runs[r + 1] || [], merged = []; let i = 0, j = 0, start = performance.now();
                        while (i < a.length || j < b.length) {
                            merged.push(j >= b.length || i < a.length && compare(a[i], b[j]) <= 0 ? a[i++] : b[j++]);
                            if (performance.now() - start >= 8) { this.recordSegment(performance.now() - start); await new Promise(resolve => setTimeout(resolve, 0)); start = performance.now(); }
                        }
                        next.push(merged);
                    }
                    runs = next;
                }
                if (version !== StorageManager._dataVersion) return this.query({ query, status, sort }, { cancelled });
                return runs[0] || [];
            })();
            const result = await promise;
            if (!cancelled() && version === StorageManager._dataVersion) this.results.set(cacheKey, result);
            if (this.results.size > 24) this.results.delete(this.results.keys().next().value);
            return result;
        },
        async stats(days) {
            const rows = await this.model(), version = this.version;
            const cacheKey = JSON.stringify([version, days, CONFIG.lowThreshold, CONFIG.highThreshold, Math.floor(Date.now() / 60000)]);
            if (this.statsCache.has(cacheKey)) return this.statsCache.get(cacheKey);
            const now = Date.now(), counts = { total: rows.length, watched: 0, visited: 0, recent7Days: 0, low: 0, mid: 0, high: 0, unfinished: 0 }, daily = new Map();
            const md = ts => { const d = new Date(ts); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
            await this.each(rows, row => {
                if (row.record.status === RECORD_STATUS.WATCHED) counts.watched++;
                if (row.record.status === RECORD_STATUS.VISITED) counts.visited++;
                if (row.record.percent !== '') {
                    counts[row.percent < CONFIG.lowThreshold ? 'low' : row.percent <= CONFIG.highThreshold ? 'mid' : 'high']++;
                    if (row.percent < CONFIG.highThreshold) counts.unfinished++;
                }
                if (row.time >= now - 7 * 86400000) counts.recent7Days++;
                if (row.time >= now - days * 86400000) daily.set(md(row.time), (daily.get(md(row.time)) || 0) + 1);
            });
            const result = { counts, days: Array.from({ length: days }, (_, i) => { const date = md(now - (days - 1 - i) * 86400000); return { date, value: daily.get(date) || 0 }; }) };
            if (version !== StorageManager._dataVersion) return this.stats(days);
            this.statsCache.set(cacheKey, result); return result;
        }
    };

    const WorkbenchLayers = {
        stack: [],
        open(root, onEscape) {
            const trigger = document.activeElement;
            if (!this.stack.length) { this.overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', this.keydown, true); }
            const previous = this.stack.at(-1);
            if (previous) previous.root.inert = true;
            const layer = { root, trigger, onEscape }; this.stack.push(layer);
            const first = root.querySelector('[autofocus],button,input,select,[tabindex="-1"]'); first?.focus();
            return () => {
                const index = this.stack.indexOf(layer); if (index < 0) return;
                this.stack.splice(index, 1); root.remove();
                const top = this.stack.at(-1); if (top) top.root.inert = false;
                if (!this.stack.length) { document.body.style.overflow = this.overflow; document.removeEventListener('keydown', this.keydown, true); }
                if (trigger?.isConnected) trigger.focus();
            };
        },
        keydown(event) {
            const top = WorkbenchLayers.stack.at(-1); if (!top) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); top.onEscape(); }
            if (event.key === 'Tab') {
                const feedback = top.root.classList.contains('bvh-manager-mask') ? [...document.querySelectorAll('.bvh-toast button:not(:disabled)')] : [];
                const items = [...top.root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]'), ...feedback].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
                if (!items.length) { event.preventDefault(); return; }
                const index = items.indexOf(document.activeElement);
                event.preventDefault();
                items[index < 0 ? (event.shiftKey ? items.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
            }
        },
        confirm(title, message, choices = [{ value: 'cancel', label: '取消' }, { value: 'confirm', label: '确认删除', danger: true }]) {
            return new Promise(resolve => {
                const root = document.createElement('div'); root.className = 'bvh-workbench bvh-dialog-mask';
                root.innerHTML = `<section class="bvh-confirm" role="dialog" aria-modal="true" aria-labelledby="bvh-confirm-title"><div class="bvh-eyebrow">操作确认</div><h2 id="bvh-confirm-title">${Utils.escapeHTML(title)}</h2><p class="bvh-confirm-message">${Utils.escapeHTML(message)}</p><div class="bvh-dialog-actions">${choices.map(c => `<button data-choice="${c.value}" class="${c.danger ? 'danger' : c.primary ? 'primary' : ''}">${c.label}</button>`).join('')}</div></section>`;
                document.body.append(root);
                const finish = value => { close(); resolve(value); };
                const close = this.open(root, () => finish('cancel'));
                root.addEventListener('click', event => { const button = event.target.closest('[data-choice]'); if (button) finish(button.dataset.choice); else if (event.target === root) finish('cancel'); });
            });
        }
    };

    const workbenchIcon = name => {
        const paths = { settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>', history: '<path d="M4 4v5h5M4 9a8 8 0 1 1 0 7M12 7v5l3 2"/>', stats: '<path d="M4 20h16M7 16V9M12 16V4M17 16v-5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', mark: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>' };
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mark}</svg>`;
    };

    class HistoryManagerPanel {
        static active = null;
        static show(options = {}) {
            if (this.active && !this.active.disposed) { this.active.root.querySelector('[data-close]').focus(); return this.active; }
            this.active = new this(options); return this.active;
        }
        constructor(options) {
            this.options = options; this.draft = { ...CONFIG }; this.saved = { ...CONFIG }; this.tab = options.activeTab || 'settings';
            this.state = { query: '', status: 'all', sort: 'savedAt-desc', page: 1, pageSize: 20, range: 30 };
            this.selected = new Set(); this.generation = 0; this.previewState = 'mid'; this.busy = false; this.disposed = false;
            this.root = document.createElement('div'); this.root.id = 'bvh-modal-mask'; this.root.className = 'bvh-workbench bvh-manager-mask';
            this.root.innerHTML = `<section class="bvh-shell" role="dialog" aria-modal="true" aria-labelledby="bvh-page-title">
                <aside class="bvh-nav"><div class="bvh-brand">${workbenchIcon('mark')}<span>观看记录<small>YOUR WATCH ARCHIVE</small></span></div><div class="bvh-nav-label">我的工作台</div><nav aria-label="管理面板">${[['settings', '偏好设置'], ['history', '历史管理'], ['stats', '数据统计']].map(([key, label]) => `<button data-tab="${key}">${workbenchIcon(key)}<span>${label}</span></button>`).join('')}</nav><div class="bvh-nav-note"><span class="bvh-dot"></span>记录每一次观看<small>数据保存在当前浏览器</small></div></aside>
                <div class="bvh-main"><header class="bvh-page-header"><div><div class="bvh-eyebrow">BILIBILI · WATCH HISTORY</div><h1 id="bvh-page-title"></h1><p data-subtitle></p></div><button data-close class="bvh-close" aria-label="关闭管理面板">${workbenchIcon('close')}</button></header><main class="bvh-content"><section data-pane="settings"></section><section data-pane="history" hidden></section><section data-pane="stats" hidden></section></main><footer class="bvh-footer"></footer></div></section>`;
            injectWorkbenchStyles(); document.body.append(this.root);
            this.renderSettings(); this.historyShell(); this.renderTab();
            this.closeLayer = WorkbenchLayers.open(this.root, () => this.requestClose());
            this.root.addEventListener('click', event => this.click(event));
            this.root.addEventListener('input', event => this.input(event));
            this.root.addEventListener('change', event => this.change(event));
            this.unsubscribe = StorageManager.onDataChange(change => {
                if (this.disposed) return;
                for (const key of this.selected) if (!StorageManager.getRecord(key)) this.selected.delete(key);
                if (this.tab !== 'settings') this.refresh();
            });
        }
        q(selector) { return this.root.querySelector(selector); }
        get dirty() { return JSON.stringify(this.draft) !== JSON.stringify(this.saved); }
        renderTab() {
            const meta = { settings: ['偏好设置', '让观看记录，按照你的习惯呈现。'], history: ['历史管理', '找回看过的视频，继续尚未完成的内容。'], stats: ['数据统计', '从最近保存的记录，了解你的观看概况。'] }[this.tab];
            this.q('#bvh-page-title').textContent = meta[0]; this.q('[data-subtitle]').textContent = meta[1];
            this.root.querySelectorAll('[data-tab]').forEach(el => { el.setAttribute('aria-current', el.dataset.tab === this.tab ? 'page' : 'false'); });
            this.root.querySelectorAll('[data-pane]').forEach(el => el.hidden = el.dataset.pane !== this.tab);
            this.renderFooter(); this.refresh();
        }
        renderFooter(message = '') {
            const settingsNav = this.q('[data-tab="settings"]');
            settingsNav.dataset.dirty = String(this.dirty); settingsNav.title = this.dirty ? '偏好设置：有未保存的修改' : '偏好设置';
            const footer = this.q('.bvh-footer');
            if (this.tab === 'settings') footer.innerHTML = `<button data-action="defaults">恢复默认</button><span class="bvh-save-status" role="status">${Utils.escapeHTML(message || (this.dirty ? '有未保存的修改' : '设置已同步'))}</span><button class="primary" data-action="save" ${this.saving ? 'disabled' : ''}>${this.saving ? '正在保存…' : '保存设置'}</button>`;
            else if (this.tab === 'history') footer.innerHTML = `<span data-page-info>正在准备记录…</span><label class="bvh-page-size">每页 <select data-page-size aria-label="每页记录数量">${[20, 30, 50, 100].map(n => `<option ${n === this.state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select> 条</label><button data-action="prev" aria-label="上一页">上一页</button><button data-action="next" aria-label="下一页">下一页</button>`;
            else footer.innerHTML = '<span>统计依据：每个视频 / 分 P 的最近保存记录，不代表累计观看时长。</span>';
        }
        renderSettings() {
            const d = this.draft, esc = Utils.escapeHTML;
            const toggle = (key, label, note) => `<div class="bvh-setting-row"><label for="bvh-setting-${key}">${label}<small>${note}</small></label><input class="bvh-switch" id="bvh-setting-${key}" data-setting="${key}" type="checkbox" ${d[key] ? 'checked' : ''}></div>`;
            const threshold = (key, label) => `<label class="bvh-number-field">${label}<div><input id="bvh-setting-${key}" data-setting="${key}" type="number" min="1" max="99" value="${esc(d[key])}" aria-describedby="bvh-error-${key}"><span>%</span></div><small class="bvh-field-error" id="bvh-error-${key}"></small></label>`;
            this.q('[data-pane="settings"]').innerHTML = `<div class="bvh-settings-layout"><div class="bvh-setting-groups">
                <section class="bvh-section"><div class="bvh-section-heading"><span>01</span><h2>播放与提示</h2></div>${toggle('autoResumePrompt', '续播提示', '再次打开视频时，提示上次观看的位置。')}<div class="bvh-setting-row"><label for="bvh-setting-floatingButtonVisibility">悬浮入口<small>选择在哪些页面显示快捷入口。</small></label><select id="bvh-setting-floatingButtonVisibility" data-setting="floatingButtonVisibility">${[['show-all', '所有页面显示'], ['hide-video', '仅非视频页显示'], ['hide-non-video', '仅视频页显示'], ['hide-all', '全部隐藏']].map(([value, text]) => `<option value="${value}" ${d.floatingButtonVisibility === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div></section>
                <section class="bvh-section"><div class="bvh-section-heading"><span>02</span><h2>页面标记</h2></div>${toggle('showProgressBar', '观看进度条', '在视频封面上显示已观看的进度。')}${toggle('showVisitedTag', '已访问标签', '标记打开过、但还未开始观看的视频。')}</section>
                <section class="bvh-section"><div class="bvh-section-heading"><span>03</span><h2>标签样式</h2></div><fieldset class="bvh-position"><legend>标签位置</legend><div>${[['top-left', '左上'], ['top-right', '右上'], ['bottom-left', '左下'], ['bottom-right', '右下']].map(([value, label]) => `<label><input type="radio" name="bvh-position" data-setting="tagPosition" value="${value}" ${d.tagPosition === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset><div class="bvh-setting-row"><label for="bvh-opacity-number">标签透明度<small>数值越高，标签越清晰。</small></label><div class="bvh-opacity"><input aria-label="标签透明度滑块" type="range" data-setting="tagOpacity" min="40" max="100" value="${d.tagOpacity}"><input id="bvh-opacity-number" type="number" data-setting="tagOpacity" min="40" max="100" value="${d.tagOpacity}"><span>%</span></div></div><div class="bvh-thresholds">${threshold('lowThreshold', '低进度分界')}${threshold('highThreshold', '高进度分界')}</div><p class="bvh-help">低于低分界为低进度；超过高分界为高进度。</p></section>
                <section class="bvh-section"><div class="bvh-section-heading"><span>04</span><h2>诊断与维护</h2></div>${toggle('debug', '调试日志', '需要排查问题时开启，记录脚本运行信息。')}<div class="bvh-maintenance-links"><button data-action="download-log">下载日志</button><button data-action="clear-log">清空日志</button><button data-action="reset-position">恢复悬浮位置</button>${this.options.currentKey && StorageManager.getRecord(this.options.currentKey)?.currentTime ? '<button data-action="jump">跳转到已记录进度</button>' : ''}</div><details class="bvh-storage-tools"><summary>存储维护</summary><p class="bvh-help">以下离线操作需要先关闭其他所有运行本脚本的页面。</p><button data-action="staging-info">检查暂存数据</button><button data-action="cleanup-staging">离线清理暂存数据</button><button data-action="legacy-snapshot">生成旧版兼容快照</button><p data-storage-info role="status"></p></details></section>
                </div><aside class="bvh-preview-panel"><div class="bvh-eyebrow">LIVE PREVIEW</div><h2>标记效果预览</h2><p>调整左侧选项，即时查看效果。</p><div class="bvh-preview-cover"><div class="bvh-preview-art">${workbenchIcon('mark')}<span>每一段观看，都有迹可循。</span><small>WATCH · PAUSE · CONTINUE</small></div><div data-preview-tag></div><div data-preview-bar></div><span class="bvh-preview-duration">12:48</span></div><h3>下一次，从这里继续</h3><p class="bvh-preview-caption">演示画幅 · 仅用于样式预览</p><div class="bvh-preview-states" aria-label="预览记录类型">${[['visited', '已访问'], ['low', '低进度'], ['mid', '中进度'], ['high', '高进度'], ['multi', '多 P']].map(([v, l]) => `<button data-preview="${v}" aria-pressed="${v === this.previewState}">${l}</button>`).join('')}</div><div class="bvh-preview-note"><span class="bvh-dot"></span>预览不会修改实际记录<br><small>保存设置后，页面上的标记才会更新。</small></div></aside></div>`;
            this.renderPreview();
        }
        renderPreview() {
            const d = this.draft, state = this.previewState, p = { low: 15, mid: 55, high: 95, multi: 55 }[state];
            const tag = this.q('[data-preview-tag]'), bar = this.q('[data-preview-bar]');
            tag.className = 'bvh-preview-tag';
            tag.textContent = state === 'visited' ? '已访问' : state === 'multi' ? '已记录 多P' : `已观看 ${p}%`;
            const color = state === 'visited' ? '#626D78' : state === 'multi' ? '#007EAD' : p < Number(d.lowThreshold) ? '#93611A' : p <= Number(d.highThreshold) ? '#007EAD' : '#23734E';
            tag.style.cssText = `background:${color};opacity:${Number(d.tagOpacity) / 100};${d.tagPosition.includes('top') ? 'top' : 'bottom'}:12px;${d.tagPosition.includes('left') ? 'left' : 'right'}:12px`;
            tag.hidden = state === 'visited' && !d.showVisitedTag;
            bar.className = 'bvh-preview-bar'; bar.style.width = `${p || 0}%`; bar.style.background = color; bar.hidden = !d.showProgressBar || state === 'visited' || state === 'multi';
            this.root.querySelectorAll('[data-preview]').forEach(el => el.setAttribute('aria-pressed', el.dataset.preview === state));
        }
        historyShell() {
            this.q('[data-pane="history"]').innerHTML = `<div class="bvh-search-row"><label class="bvh-search">${workbenchIcon('history')}<input data-query aria-label="搜索标题或视频编号" placeholder="搜索视频标题、BV / AV 编号…"></label><button data-action="clear-query">清除</button></div><div class="bvh-history-tools"><label>状态 <select data-filter="status"><option value="all">全部记录</option><option>已观看</option><option>已访问</option></select></label><label>排序 <select data-filter="sort"><option value="savedAt-desc">最近保存优先</option><option value="savedAt-asc">最早保存优先</option><option value="percent-desc">进度从高到低</option><option value="percent-asc">进度从低到高</option><option value="title-asc">标题顺序</option></select></label><div class="bvh-tool-spacer"></div><button data-action="import">导入</button><button data-action="export">导出记录</button></div><div class="bvh-selection-bar"><span data-selection-info>选择记录后可批量操作</span><button data-action="clear-selection">取消选择</button><button class="danger" data-action="delete-selected" disabled>删除选中</button></div><div data-results aria-live="polite"></div><details class="bvh-retention"><summary>数据维护 · 清理久远记录</summary><div><label>保留最近 <input data-retention-value type="number" min="1" step="1" value="6" aria-label="保留数量"></label><select data-retention-unit aria-label="保留时间单位"><option value="months">个月</option><option value="days">天</option><option value="years">年</option></select><button class="danger" data-action="retention">检查清理范围</button></div><p>清理全部历史中的过期记录，不受搜索、筛选或勾选范围影响；确认前会显示截止时间和记录数量。</p></details>`;
        }
        async refresh() {
            if (this.tab === 'settings' || this.disposed) return;
            const generation = ++this.generation, tab = this.tab;
            const target = this.q(tab === 'history' ? '[data-results]' : '[data-pane="stats"]');
            target.innerHTML = '<div class="bvh-empty" role="status"><span class="bvh-loader"></span><h3>正在整理记录…</h3><p>你可以继续搜索、切换页签或关闭面板。</p></div>';
            try {
                const result = tab === 'history' ? await HistoryQueries.query(this.state, { cancelled: () => this.disposed || generation !== this.generation }) : await HistoryQueries.stats(this.state.range);
                if (this.disposed || generation !== this.generation || tab !== this.tab) return;
                if (tab === 'history') { this.filtered = result; this.renderHistory(); } else this.renderStats(result);
            } catch (error) {
                if (this.disposed || generation !== this.generation) return;
                target.innerHTML = `<div class="bvh-empty"><h3>记录暂时无法加载</h3><p>${Utils.escapeHTML(error.message)}</p><button data-action="retry">重试</button></div>`;
            }
        }
        renderHistory() {
            const rows = this.filtered || [], pages = Math.max(1, Math.ceil(rows.length / this.state.pageSize));
            this.state.page = Math.min(pages, Math.max(1, this.state.page));
            this.pageRows = rows.slice((this.state.page - 1) * this.state.pageSize, this.state.page * this.state.pageSize);
            const esc = Utils.escapeHTML;
            this.q('[data-results]').innerHTML = rows.length ? `<div class="bvh-table-scroll"><table><thead><tr><th><input data-select-page type="checkbox" aria-label="选择当前页全部记录"></th><th>视频记录</th><th>观看进度</th><th>最近保存</th><th><span class="bvh-sr-only">操作</span></th></tr></thead><tbody>${this.pageRows.map(row => `<tr><td><input type="checkbox" data-select="${row.key}" ${this.selected.has(row.key) ? 'checked' : ''} aria-label="选择 ${esc(row.record.title || row.key)}"></td><td class="bvh-title-cell"><a href="https://www.bilibili.com/video/${row.key}" target="_blank" rel="noopener" title="${esc(row.record.title)}">${esc(row.record.title || '未记录标题')}</a><small>${esc(row.key)} <span class="bvh-status-badge">${esc(row.record.status)}</span></small></td><td><span class="bvh-progress-number">${esc(row.record.percent || '—')}</span><div class="bvh-row-progress"><i style="width:${row.percent}%"></i></div></td><td class="bvh-time-cell">${esc(row.record.savedAt)}</td><td><button class="bvh-text-danger" data-delete="${row.key}" aria-label="删除 ${esc(row.record.title || row.key)}">删除</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="bvh-empty">${workbenchIcon('history')}<h3>${StorageManager.getAllKeys().length ? '没有匹配的记录' : '你的观看记录，从下一次播放开始'}</h3><p>${StorageManager.getAllKeys().length ? '试试其他关键词，或清除当前筛选条件。' : '观看视频后会自动记录，也可以导入已有备份。'}</p><button data-action="${StorageManager.getAllKeys().length ? 'clear-query' : 'import'}">${StorageManager.getAllKeys().length ? '清除筛选' : '导入历史备份'}</button></div>`;
            this.q('[data-page-info]').textContent = `共 ${rows.length.toLocaleString()} 条 · ${this.state.page} / ${pages} 页`;
            this.q('[data-action="prev"]').disabled = this.state.page <= 1;
            this.q('[data-action="next"]').disabled = this.state.page >= pages;
            this.selectionState();
        }
        selectionState() {
            const count = (this.pageRows || []).filter(row => this.selected.has(row.key)).length;
            const all = this.q('[data-select-page]'); if (all) { all.checked = count > 0 && count === this.pageRows.length; all.indeterminate = count > 0 && count < this.pageRows.length; }
            this.q('[data-selection-info]').textContent = this.selected.size ? `已选择 ${this.selected.size} 条记录（保留跨页选择）` : '选择记录后可批量操作';
            this.q('[data-action="delete-selected"]').disabled = !this.selected.size || this.busy;
        }
        renderStats({ counts: c, days }) {
            const ratio = c.total ? Math.round(c.high / c.total * 100) : 0, max = Math.max(1, ...days.map(d => d.value));
            const distribution = (title, items) => `<section class="bvh-section bvh-chart-card"><h2>${title}</h2>${items.map(([label, value, color]) => `<div class="bvh-distribution"><div><span>${label}</span><strong>${value.toLocaleString()}</strong></div><div><i style="width:${c.total ? value / c.total * 100 : 0}%;background:${color}"></i></div></div>`).join('')}</section>`;
            this.q('[data-pane="stats"]').innerHTML = `<div class="bvh-stat-summary">${[['全部记录', c.total], ['已观看', c.watched], ['已访问', c.visited], ['近七天记录', c.recent7Days]].map(([l, n], i) => `<section class="${i === 0 ? 'featured' : ''}"><span>${l}</span><strong>${n.toLocaleString()}</strong><small>${i === 0 ? '视频与分 P 独立计数' : i === 3 ? '按最近保存时间' : '条记录'}</small></section>`).join('')}</div>${!c.total ? '<p class="bvh-empty-inline">还没有历史记录。开始观看后，这里会展示你的记录概况。</p>' : ''}<div class="bvh-stats-grid"><section class="bvh-section bvh-chart-card"><h2>高进度占比</h2><div class="bvh-donut"><svg viewBox="0 0 160 160" role="img" aria-label="高进度占比 ${ratio}%"><circle cx="80" cy="80" r="61" fill="none" stroke="#E8EDEB" stroke-width="12"/><circle cx="80" cy="80" r="61" fill="none" stroke="#23734E" stroke-width="12" pathLength="100" stroke-dasharray="${ratio} 100" transform="rotate(-90 80 80)"/><text x="80" y="85" text-anchor="middle" fill="#20262E" font-size="30" font-weight="600">${ratio}%</text><text x="80" y="105" text-anchor="middle" fill="#626D78" font-size="10">${c.high} / ${c.total} 条</text></svg></div><p class="bvh-help">进度超过 ${CONFIG.highThreshold}% 的记录 ÷ 全部记录</p></section>${distribution('记录状态', [['已观看', c.watched, '#007EAD'], ['已访问', c.visited, '#A1ADB4']])}${distribution('观看进度分布', [['低进度', c.low, '#93611A'], ['中进度', c.mid, '#007EAD'], ['高进度', c.high, '#23734E']])}</div><section class="bvh-section bvh-trend"><div class="bvh-trend-heading"><div><h2>近期记录趋势</h2><p>最近 ${this.state.range} 天 · 按最近保存时间统计</p></div><div class="bvh-range-buttons">${[7, 30, 90].map(n => `<button data-range="${n}" aria-pressed="${n === this.state.range}">${n} 天</button>`).join('')}</div></div><div class="bvh-chart-scroll"><svg viewBox="0 0 720 180" role="img" aria-label="近 ${days.length} 天记录趋势，最多每天 ${max} 条"><path d="M16 140H704M16 80H704M16 20H704" stroke="#DFE4E8" stroke-dasharray="3 5"/>${days.map((d, i) => { const width = 680 / days.length, height = d.value / max * 110; return `<g><rect x="${20 + i * width}" y="${140 - height}" width="${Math.max(2, width - 3)}" height="${height}" rx="2" fill="#007EAD"><title>${d.date}：${d.value} 条</title></rect>${i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 6) === 0 ? `<text x="${20 + i * width}" y="165" fill="#626D78" font-size="10">${d.date}</text>` : ''}</g>`; }).join('')}</svg></div><details><summary>查看每日数值</summary><div class="bvh-daily-values">${days.map(d => `<span>${d.date}<strong>${d.value} 条</strong></span>`).join('')}</div></details></section>`;
        }
        input(event) {
            const el = event.target;
            if (el.matches('[data-query]')) { this.state.query = el.value; this.state.page = 1; clearTimeout(this.searchTimer); this.generation++; this.searchTimer = setTimeout(() => this.refresh(), 180); }
            if (el.dataset.setting) {
                const key = el.dataset.setting; this.draft[key] = el.type === 'checkbox' ? el.checked : el.value;
                if (key === 'tagOpacity') this.root.querySelectorAll('[data-setting="tagOpacity"]').forEach(other => { if (other !== el) other.value = el.value; });
                this.renderPreview(); this.renderFooter();
            }
        }
        change(event) {
            const el = event.target;
            if (el.dataset.setting) this.input(event);
            if (el.dataset.filter) { this.state[el.dataset.filter] = el.value; this.state.page = 1; this.refresh(); }
            if (el.hasAttribute('data-page-size')) { this.state.pageSize = Number(el.value); this.state.page = 1; if (this.filtered) this.renderHistory(); }
            if (el.dataset.select) { el.checked ? this.selected.add(el.dataset.select) : this.selected.delete(el.dataset.select); this.selectionState(); }
            if (el.hasAttribute('data-select-page')) { for (const row of this.pageRows) el.checked ? this.selected.add(row.key) : this.selected.delete(row.key); this.renderHistory(); }
        }
        async click(event) {
            const button = event.target.closest('button');
            if (event.target === this.root || button?.hasAttribute('data-close')) { await this.requestClose(); return; }
            if (!button) return;
            if (button.dataset.tab) { this.tab = button.dataset.tab; this.generation++; this.renderTab(); return; }
            if (button.dataset.preview) { this.previewState = button.dataset.preview; this.renderPreview(); return; }
            if (button.dataset.range) { this.state.range = Number(button.dataset.range); this.refresh(); return; }
            if (button.dataset.delete) { await this.deleteKeys([button.dataset.delete]); return; }
            const action = button.dataset.action;
            try {
                if (action === 'save') await this.save();
                if (action === 'defaults') { this.draft = { ...DEFAULT_CONFIG }; this.renderSettings(); this.renderFooter(); }
                if (action === 'retry') this.refresh();
                if ((action === 'prev' || action === 'next') && this.filtered) { this.state.page += action === 'prev' ? -1 : 1; this.renderHistory(); }
                if (action === 'clear-selection') { this.selected.clear(); this.renderHistory(); }
                if (action === 'clear-query') { this.state.query = ''; this.state.status = 'all'; this.q('[data-query]').value = ''; this.q('[data-filter="status"]').value = 'all'; this.state.page = 1; this.refresh(); }
                if (action === 'delete-selected') await this.deleteKeys([...this.selected]);
                if (action === 'retention') await this.retention();
                if (action === 'export') await this.export();
                if (action === 'import') this.import();
                if (action === 'download-log') Utils.downloadDebugLog();
                if (action === 'clear-log') { Utils.clearDebugLogs(); UIComponent.toast('日志已清空', 'success'); }
                if (action === 'reset-position') { GM_deleteValue('bvh_panel_position'); const panel = document.getElementById('bvh-view-panel'); if (panel) Object.assign(panel.style, { left: '15px', bottom: '15px', top: 'auto' }); UIComponent.toast('悬浮位置已恢复', 'success'); }
                if (action === 'jump') {
                    if (EpisodeResolver.getCurrentKey() === this.options.currentKey) UIComponent.jumpToProgress(StorageManager.getRecord(this.options.currentKey));
                    else UIComponent.toast('视频已切换，请重新打开当前视频的管理面板', 'info');
                }
                if (action === 'staging-info') { const info = await StorageManager._store.stagingInfo(); this.q('[data-storage-info]').textContent = `未提交暂存块 ${info.count} 个，占用约 ${(info.bytes / 1024).toFixed(1)} KB；不会参与历史查询。`; }
                if (action === 'cleanup-staging' || action === 'legacy-snapshot') {
                    const choice = await WorkbenchLayers.confirm('确认所有其他写入页面已关闭', action === 'cleanup-staging' ? '只清理未提交的暂存块。请先关闭其他运行本脚本的页面，避免中断正在提交的记录。' : '将当前完整记录写成旧版可读快照。请先关闭其他运行本脚本的页面，并保存一份导出备份。', [{ value: 'cancel', label: '取消' }, { value: 'confirm', label: '已关闭其他页面，继续', primary: true }]);
                    if (choice === 'confirm') { await StorageManager._enqueue(async () => { if (action === 'cleanup-staging') await StorageManager._store.cleanupStaging({ writersStopped: true }); else await StorageManager.createLegacySnapshot({ writersStopped: true }); }); UIComponent.toast('离线维护完成', 'success'); }
                }
            } catch (error) { UIComponent.toast(error.message || '操作失败，请重试', 'error', 5000); }
        }
        async save() {
            if (this.saving) return false;
            const errors = {}, next = { ...this.draft };
            for (const key of ['lowThreshold', 'highThreshold', 'tagOpacity']) {
                const raw = String(next[key]).trim(), number = Number(raw), min = key === 'tagOpacity' ? 40 : 1, max = key === 'tagOpacity' ? 100 : 99;
                if (!raw || !Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) errors[key] = `请输入 ${min}–${max} 的整数`;
                else next[key] = number;
            }
            if (!errors.lowThreshold && !errors.highThreshold && next.lowThreshold >= next.highThreshold) errors.highThreshold = '高分界必须大于低分界';
            for (const key of ['lowThreshold', 'highThreshold']) { const input = this.q(`[data-setting="${key}"]`); input.setAttribute('aria-invalid', !!errors[key]); this.q(`#bvh-error-${key}`).textContent = errors[key] || ''; }
            if (Object.keys(errors).length) { this.tab = 'settings'; this.renderTab(); this.renderFooter(Object.values(errors)[0]); this.q(`[data-setting="${Object.keys(errors)[0]}"]`).focus(); return false; }
            this.saving = true; this.renderFooter();
            try {
                await SettingsManager.save(next); this.saved = { ...next }; this.draft = { ...next };
                UIComponent.refreshFloatingButtons(); this.renderFooter('已保存'); return true;
            } catch (error) { this.renderFooter('保存失败：' + error.message); UIComponent.toast('设置保存失败，输入已保留', 'error'); return false; }
            finally { this.saving = false; const button = this.q('[data-action="save"]'); if (button) { button.disabled = false; button.textContent = '保存设置'; } }
        }
        async requestClose() {
            if (this.closing || this.disposed) return; this.closing = true;
            try {
                if (this.dirty) {
                    const choice = await WorkbenchLayers.confirm('保存这次设置修改？', '你的设置草稿尚未应用。可以保存后关闭，或放弃本次修改。', [{ value: 'cancel', label: '继续编辑' }, { value: 'discard', label: '放弃修改' }, { value: 'save', label: '保存后关闭', primary: true }]);
                    if (choice === 'cancel' || choice === 'save' && !await this.save()) return;
                }
                this.dispose();
            } finally { this.closing = false; }
        }
        dispose() { if (this.disposed) return; this.disposed = true; this.generation++; clearTimeout(this.searchTimer); this.unsubscribe?.(); this.closeLayer?.(); if (HistoryManagerPanel.active === this) HistoryManagerPanel.active = null; }
        async export() {
            await StorageManager.initialize();
            const data = Object.fromEntries(StorageManager.getAllRecords().map(({ key, record }) => [key, record]));
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = `bilibili-history-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        import() {
            if (this.busy) return;
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.onchange = async () => {
                if (!input.files[0]) return; this.busy = true;
                const feedback = UIComponent.progressToast('正在校验并导入记录…');
                try { const result = await StorageManager.importRecords(JSON.parse(await input.files[0].text())); feedback.close(`导入 ${result.count} 条，跳过 ${result.skipCount} 条已有记录`, 'success', 4000); if (!this.disposed) this.refresh(); }
                catch (error) { feedback.close('导入失败：' + error.message, 'error', 6000); }
                finally { this.busy = false; }
            }; input.click();
        }
        async deleteKeys(keys, confirmed = false) {
            if (this.busy || !keys.length) return;
            if (!confirmed && await WorkbenchLayers.confirm('删除选中的记录？', `预计删除 ${keys.length} 条记录。成功后 5 秒内可以撤销。`) !== 'confirm') return;
            this.busy = true; this.selectionState(); const progress = UIComponent.progressToast(`正在提交 ${keys.length} 条删除…`);
            try {
                const result = await StorageManager.deleteRecords(keys, true, { details: true });
                progress.close(`已删除 ${result.count} 条记录`, 'success', 1800);
                UIComponent.toastUndo(`已删除 ${result.count} 条记录`, 5000, async () => { const count = await StorageManager.undoDelete(result); return `撤销完成：恢复 ${count} 条，跳过 ${result.count - count} 条已变化记录`; });
                for (const key of keys) this.selected.delete(key); if (!this.disposed) this.refresh();
            } catch (error) { progress.close('删除失败：' + error.message, 'error', 5000); }
            finally { this.busy = false; if (!this.disposed) this.selectionState(); }
        }
        async retention() {
            const raw = this.q('[data-retention-value]').value, amount = Number(raw), unit = this.q('[data-retention-unit]').value;
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(amount) || amount < 1) throw new Error('保留数量必须为正整数');
            const cutoff = new Date(); if (unit === 'months') cutoff.setMonth(cutoff.getMonth() - amount); else if (unit === 'years') cutoff.setFullYear(cutoff.getFullYear() - amount); else cutoff.setDate(cutoff.getDate() - amount);
            if (!Number.isFinite(cutoff.getTime())) throw new Error('保留范围过大，无法计算截止时间');
            const rows = await HistoryQueries.model(), keys = rows.filter(row => Number.isFinite(row.time) && row.time < cutoff.getTime()).map(row => row.key);
            if (!keys.length) { UIComponent.toast('没有需要清理的记录', 'success'); return; }
            const period = amount + { days: '天', months: '个月', years: '年' }[unit];
            const result = await WorkbenchLayers.confirm('清理久远的历史记录', `保留最近 ${period} 的记录。\n截止时间：${cutoff.toLocaleString('zh-CN', { hour12: false })}\n删除范围：全部历史中保存时间早于截止时间的记录（不受搜索、筛选或勾选影响）。\n预计删除：${keys.length} 条。`);
            if (result === 'confirm') await this.deleteKeys(keys, true);
        }
    }

    let workbenchStylesInjected = false;
    function injectWorkbenchStyles() {
        if (workbenchStylesInjected) return; workbenchStylesInjected = true;
        GM_addStyle(`
        .bvh-workbench{--bvh-ink:#20262E;--bvh-muted:#626D78;--bvh-line:#DFE4E8;--bvh-blue:#007EAD;--bvh-paper:#F5F4F0;color:var(--bvh-ink);font:14px/1.6 "HarmonyOS Sans SC","Source Han Sans SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;text-align:left;color-scheme:light}
        .bvh-workbench *{box-sizing:border-box}.bvh-workbench [hidden]{display:none!important}.bvh-workbench h1,.bvh-workbench h2,.bvh-workbench h3,.bvh-workbench p{margin:0}.bvh-workbench h1{font-size:24px;line-height:1.4;font-weight:650}.bvh-workbench h2{font-size:15px;font-weight:650}.bvh-workbench h3{font-size:14px;font-weight:600}.bvh-workbench small{font-size:12px}.bvh-workbench button,.bvh-workbench input,.bvh-workbench select{font:inherit;color:inherit}.bvh-workbench button,.bvh-workbench select,.bvh-workbench input:not([type=checkbox]):not([type=radio]):not([type=range]){border:1px solid var(--bvh-line);border-radius:8px;background:white;min-height:40px;padding:8px 12px;line-height:1.4}.bvh-workbench button{cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}.bvh-workbench button:hover{background:#EBF3F6;border-color:#B5CFDA}.bvh-workbench button:disabled{opacity:.45;cursor:default}.bvh-workbench button.primary{background:var(--bvh-blue);border-color:var(--bvh-blue);color:white}.bvh-workbench button.primary:hover{background:#00698F}.bvh-workbench button.danger{color:#BF414B;border-color:#E8BEC2;background:#FFF8F8}.bvh-workbench :focus-visible{outline:3px solid #007EAD;outline-offset:3px}.bvh-workbench input[type=checkbox],.bvh-workbench input[type=radio],.bvh-workbench input[type=range]{accent-color:var(--bvh-blue)}.bvh-workbench input[type=checkbox]{width:17px;height:17px;cursor:pointer}.bvh-workbench input[type=number]{width:80px}.bvh-workbench a{color:inherit;text-decoration:none}.bvh-workbench a:hover{color:var(--bvh-blue)}
        .bvh-manager-mask,.bvh-dialog-mask{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(21,30,39,.48);z-index:2147483000;isolation:isolate}.bvh-shell{display:grid;grid-template-columns:184px minmax(0,1fr);width:min(1120px,100%);height:min(840px,calc(100dvh - 48px));background:var(--bvh-paper);border-radius:18px;overflow:hidden;box-shadow:0 24px 100px #0D192D55}.bvh-nav{padding:32px 16px 24px;background:#20262E;color:#F7F8FA;display:flex;flex-direction:column}.bvh-brand{display:flex;align-items:center;gap:10px;padding:0 8px;font-size:17px;font-weight:600}.bvh-brand>svg{width:28px;height:28px;color:#56CCF3}.bvh-brand small{display:block;font-size:8px;letter-spacing:1.3px;color:#AAB4BD;margin-top:3px}.bvh-nav-label{font-size:10px;letter-spacing:2px;color:#9BA7B1;margin:44px 12px 12px}.bvh-nav nav{display:grid;gap:8px}.bvh-nav button{display:flex;align-items:center;gap:12px;text-align:left;background:transparent;border-color:transparent;color:#C0C9D0;border-radius:8px;padding:12px;min-height:46px}.bvh-nav button:hover{color:white;background:#2B3540;border-color:transparent}.bvh-nav button[aria-current=page]{color:#F7F8FA;background:#344551;box-shadow:inset 3px 0 #00AEEC}.bvh-nav button[aria-current=page] svg{color:#72D4F6}.bvh-nav-note{margin-top:auto;padding:20px 8px 0;font-size:11px;color:#C0C9D0}.bvh-nav-note small{display:block;font-size:10px;color:#9AA7B2;margin-top:6px}.bvh-dot{display:inline-block;width:6px;height:6px;background:#58C19D;border-radius:50%;margin-right:7px;vertical-align:middle}.bvh-main{display:flex;min-width:0;min-height:0;flex-direction:column}.bvh-page-header{display:flex;justify-content:space-between;gap:20px;padding:28px 32px 24px;border-bottom:1px solid var(--bvh-line);flex-shrink:0}.bvh-eyebrow{font-size:9px;font-weight:600;letter-spacing:2px;color:var(--bvh-muted);margin-bottom:8px}.bvh-page-header p{font-size:12px;color:var(--bvh-muted);margin-top:8px}.bvh-workbench .bvh-close{border-color:transparent;background:transparent;width:36px;min-height:36px;height:36px;display:grid;place-items:center;padding:8px}.bvh-content{overflow-y:auto;min-height:0;padding:24px 32px;flex:1;scrollbar-width:thin;overscroll-behavior:contain}.bvh-footer{padding:16px 32px;min-height:73px;border-top:1px solid var(--bvh-line);background:#FFFEFC;display:flex;align-items:center;gap:12px;flex-shrink:0;font-size:12px}.bvh-footer>span:first-child{margin-right:auto}.bvh-save-status{margin-left:auto;color:var(--bvh-muted)}.bvh-settings-layout{display:grid;grid-template-columns:minmax(0,1fr) 246px;gap:24px;align-items:start}.bvh-setting-groups{min-width:0;display:grid;gap:20px}.bvh-section{padding:20px;background:white;border:1px solid var(--bvh-line);border-radius:12px}.bvh-section-heading{display:flex;gap:10px;align-items:center;margin-bottom:8px}.bvh-section-heading>span{font-size:10px;color:#8C9BA5;letter-spacing:1px}.bvh-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid #EEF0F2}.bvh-setting-row:last-child{border-bottom:0;padding-bottom:0}.bvh-setting-row label{font-size:13px;flex:1;min-width:0}.bvh-setting-row label small{display:block;color:var(--bvh-muted);font-size:11px;margin-top:4px}.bvh-setting-row select{max-width:160px;font-size:12px}.bvh-workbench input.bvh-switch{appearance:none;width:36px;height:21px;border:0;border-radius:14px;background:#C7CFD5;position:relative;flex-shrink:0;margin:0;transition:background .15s}.bvh-switch:before{content:"";position:absolute;width:15px;height:15px;top:3px;left:3px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .15s}.bvh-workbench input.bvh-switch:checked{background:var(--bvh-blue)}.bvh-switch:checked:before{transform:translateX(15px)}.bvh-position{border:0;padding:12px 0;margin:0}.bvh-position legend{font-size:12px;padding:0;margin:0 0 8px}.bvh-position>div{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.bvh-position label{cursor:pointer;position:relative}.bvh-position input{position:absolute;opacity:0;width:100%;height:100%;margin:0}.bvh-position span{display:block;text-align:center;border:1px solid var(--bvh-line);border-radius:7px;padding:9px 2px;font-size:12px}.bvh-position input:checked+span{border-color:var(--bvh-blue);color:var(--bvh-blue);background:#EFF8FB}.bvh-position input:focus-visible+span{outline:3px solid var(--bvh-blue);outline-offset:2px}.bvh-opacity{display:flex;align-items:center;gap:7px}.bvh-opacity input[type=range]{width:74px}.bvh-opacity input[type=number]{width:64px!important;padding:8px!important}.bvh-thresholds{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px}.bvh-number-field{font-size:12px}.bvh-number-field>div{display:flex;align-items:center;gap:8px;margin-top:8px}.bvh-field-error{display:block;color:#BF414B;min-height:16px;padding-top:3px}.bvh-workbench [aria-invalid=true]{border-color:#BF414B!important}.bvh-help{font-size:11px;color:var(--bvh-muted);line-height:1.7}.bvh-maintenance-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.bvh-maintenance-links button{font-size:11px;padding:7px 10px;min-height:34px}.bvh-storage-tools{font-size:11px;margin-top:16px}.bvh-storage-tools button{font-size:11px;margin:8px 4px 0 0}.bvh-workbench summary{cursor:pointer;padding:8px 0}.bvh-preview-panel{position:sticky;top:0;min-width:0;padding-top:4px}.bvh-preview-panel>p{font-size:11px;color:var(--bvh-muted);margin-top:8px}.bvh-preview-cover{position:relative;aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:#DDE6E9;margin:20px 0 12px}.bvh-preview-art{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(135deg,#D9E5E8,#EAEDEA);color:#576C76}.bvh-preview-art:before,.bvh-preview-art:after{content:"";position:absolute;border:1px solid #FFF8;border-radius:50%;width:190px;height:190px;right:-65px;top:-100px}.bvh-preview-art:after{width:140px;height:140px;right:-40px;top:-74px}.bvh-preview-art svg{width:36px;height:36px;margin-bottom:12px;color:#64818D}.bvh-preview-art span{font-size:11px}.bvh-preview-art small{font-size:7px;letter-spacing:2px;margin-top:7px}.bvh-preview-tag{position:absolute;border-radius:4px;font-size:10px;color:white;padding:4px 7px}.bvh-preview-bar{position:absolute;left:0;bottom:0;height:4px}.bvh-preview-duration{position:absolute;bottom:10px;right:10px;font-size:9px;color:#54636B}.bvh-preview-caption{font-size:10px!important}.bvh-preview-states{display:flex;flex-wrap:wrap;gap:6px;margin-top:18px}.bvh-preview-states button{font-size:10px;padding:6px 9px;min-height:30px;background:transparent}.bvh-workbench button[aria-pressed=true]{border-color:var(--bvh-blue);color:var(--bvh-blue);background:#EAF5F9}.bvh-preview-note{border-top:1px solid var(--bvh-line);font-size:11px;color:var(--bvh-muted);margin-top:24px;padding-top:16px;line-height:2}.bvh-preview-note small{font-size:10px;margin-left:13px}
        .bvh-search-row{display:flex;gap:10px}.bvh-search{display:flex;align-items:center;gap:10px;flex:1;background:white;border:1px solid var(--bvh-line);border-radius:9px;padding:0 12px;min-width:0;color:var(--bvh-muted)}.bvh-search input{border:0!important;outline:none!important;min-width:0;width:100%;background:transparent!important;padding-left:0!important}.bvh-search:focus-within{outline:2px solid var(--bvh-blue);outline-offset:2px}.bvh-history-tools{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:14px 0 20px;font-size:12px}.bvh-history-tools label{display:flex;align-items:center;gap:8px}.bvh-history-tools select{font-size:12px}.bvh-tool-spacer{flex:1}.bvh-selection-bar{padding:10px 12px;display:flex;align-items:center;gap:8px;background:#EBF0F1;border-radius:8px 8px 0 0;font-size:11px}.bvh-selection-bar>span{margin-right:auto}.bvh-selection-bar button{font-size:11px;min-height:32px;padding:5px 9px}.bvh-table-scroll{overflow:auto;background:white;border:1px solid var(--bvh-line);border-radius:0 0 10px 10px}.bvh-workbench table{border-collapse:collapse;width:100%;min-width:620px;table-layout:fixed;font-size:12px}.bvh-workbench th{position:sticky;top:0;background:#F9FAFA;color:var(--bvh-muted);font-size:10px;font-weight:500;text-align:left;z-index:1}.bvh-workbench td,.bvh-workbench th{padding:14px 10px;border-bottom:1px solid #EDF0F1;vertical-align:middle}.bvh-workbench th:first-child{width:36px}.bvh-workbench th:nth-child(2){width:43%}.bvh-workbench th:nth-child(3){width:100px}.bvh-workbench th:nth-child(4){width:134px}.bvh-workbench th:last-child{width:56px}.bvh-workbench tbody tr:last-child td{border-bottom:0}.bvh-workbench tr:has(input:checked){background:#F0F8FB}.bvh-title-cell a{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}.bvh-title-cell small{display:flex;align-items:center;flex-wrap:wrap;gap:6px;color:var(--bvh-muted);font-size:10px;margin-top:6px}.bvh-status-badge{padding:1px 5px;border-radius:4px;background:#EEF3F5;color:#5D7480;font-size:9px}.bvh-row-progress{height:3px;background:#E6EDF0;border-radius:3px;overflow:hidden;margin-top:6px}.bvh-row-progress i{display:block;height:100%;background:#007EAD}.bvh-progress-number{font-size:11px}.bvh-time-cell{color:var(--bvh-muted);font-size:10px}.bvh-workbench .bvh-text-danger{background:transparent;border:0;color:#BF414B;font-size:11px;padding:4px;min-height:30px}.bvh-retention{margin-top:20px;font-size:12px;color:var(--bvh-muted)}.bvh-retention>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.bvh-retention p{font-size:11px;margin-top:8px}.bvh-retention input{width:70px!important}.bvh-page-size{white-space:nowrap}.bvh-page-size select{min-height:32px;padding:5px 7px}.bvh-empty{padding:48px 12px;text-align:center;color:var(--bvh-muted);background:#FFF9;border-radius:10px}.bvh-empty>svg{width:32px;height:32px;margin-bottom:12px}.bvh-empty h3{color:var(--bvh-ink);margin-bottom:8px}.bvh-empty p{font-size:12px;margin-bottom:18px}.bvh-loader{display:inline-block;width:22px;height:22px;border:2px solid #DBE7EB;border-top-color:#007EAD;border-radius:50%;animation:bvh-spin 1s linear infinite;margin-bottom:12px}.bvh-empty-inline{padding:16px 0;font-size:12px;color:var(--bvh-muted)}
        .bvh-stat-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.bvh-stat-summary section{padding:18px;border-radius:12px;background:white;border:1px solid var(--bvh-line)}.bvh-stat-summary span{font-size:11px;color:var(--bvh-muted)}.bvh-stat-summary strong{display:block;font-size:28px;letter-spacing:-1px;line-height:1.2;margin:12px 0 10px;font-weight:600}.bvh-stat-summary small{font-size:9px;color:var(--bvh-muted)}.bvh-stat-summary section.featured{background:#263D49;color:white;border-color:#263D49}.bvh-stat-summary .featured span,.bvh-stat-summary .featured small{color:#CCDDE5}.bvh-stats-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.bvh-chart-card{padding:18px}.bvh-chart-card h2{font-size:13px}.bvh-donut{max-width:160px;margin:10px auto 0}.bvh-donut svg{display:block;width:100%}.bvh-chart-card .bvh-help{font-size:9px}.bvh-distribution{margin-top:24px;font-size:11px}.bvh-distribution>div:first-child{display:flex;justify-content:space-between;margin-bottom:8px}.bvh-distribution>div:last-child{height:5px;background:#EDF1F2;border-radius:5px;overflow:hidden}.bvh-distribution i{display:block;height:100%;border-radius:5px}.bvh-trend{margin-top:20px}.bvh-trend-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.bvh-trend-heading p{font-size:10px;color:var(--bvh-muted);margin-top:4px}.bvh-range-buttons{display:flex;gap:5px}.bvh-range-buttons button{font-size:10px;min-height:32px;padding:6px 9px}.bvh-chart-scroll{overflow-x:auto;padding-top:18px}.bvh-chart-scroll svg{min-width:440px;width:100%;display:block}.bvh-trend summary{font-size:10px;color:var(--bvh-muted)}.bvh-daily-values{display:grid;grid-template-columns:repeat(auto-fill,minmax(85px,1fr));gap:10px;font-size:10px}.bvh-daily-values strong{display:block;font-weight:500}.bvh-dialog-mask{z-index:2147483100;background:#15202E66}.bvh-confirm{width:min(460px,100%);padding:28px;background:var(--bvh-paper);border:1px solid white;border-radius:16px;box-shadow:0 24px 100px #0004}.bvh-confirm h2{font-size:20px}.bvh-confirm-message{white-space:pre-line;overflow-wrap:anywhere;color:var(--bvh-muted);font-size:13px;margin:16px 0 24px!important}.bvh-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}.bvh-dialog-actions button{font-size:12px}.bvh-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
        .bvh-toast-container{z-index:2147483200!important;max-width:calc(100vw - 32px)!important}.bvh-toast{font:13px/1.6 "Microsoft YaHei",sans-serif!important;border-radius:10px!important;box-shadow:0 8px 32px #14212F33!important;max-width:min(460px,calc(100vw - 32px))!important;overflow-wrap:anywhere}.bvh-toast button{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:5px;padding:3px 10px;margin-left:14px;cursor:pointer}.bvh-resume{z-index:2147482900!important}.bvh-toast button:focus-visible{outline:3px solid #007EAD;outline-offset:3px}
        @keyframes bvh-spin{to{transform:rotate(360deg)}}
        @media(max-width:1050px){.bvh-settings-layout{grid-template-columns:minmax(0,1fr) 210px;gap:18px}.bvh-shell{grid-template-columns:164px minmax(0,1fr)}.bvh-page-header{padding:24px}.bvh-content{padding:20px 24px}.bvh-footer{padding:14px 24px}.bvh-section{padding:16px}.bvh-setting-row{gap:10px}.bvh-setting-row select{max-width:135px}.bvh-opacity input[type=range]{width:45px}.bvh-stat-summary section{padding:14px}.bvh-stat-summary strong{font-size:25px}}
        @media(max-width:779px){.bvh-manager-mask{padding:12px}.bvh-shell{display:flex;flex-direction:column;height:calc(100dvh - 24px);border-radius:14px}.bvh-nav{padding:12px 16px;flex-direction:row;align-items:center;gap:16px;flex-shrink:0}.bvh-brand{padding:0}.bvh-brand>svg{width:24px}.bvh-brand>span{font-size:12px}.bvh-brand small,.bvh-nav-label,.bvh-nav-note{display:none}.bvh-nav nav{display:flex;gap:4px;flex:1;justify-content:flex-end}.bvh-nav button{padding:8px;gap:5px;min-height:44px;font-size:12px}.bvh-nav button svg{width:16px;height:16px}.bvh-nav button[aria-current=page]{box-shadow:inset 0 -2px #00AEEC}.bvh-main{flex:1}.bvh-page-header{padding:20px}.bvh-content{padding:18px 20px}.bvh-footer{padding:12px 20px}.bvh-settings-layout{grid-template-columns:minmax(0,1fr) 220px}.bvh-setting-row{flex-wrap:wrap}.bvh-stats-grid{grid-template-columns:1fr 1fr}.bvh-stats-grid>.bvh-section:first-child{grid-row:span 2}.bvh-workbench button,.bvh-workbench select{min-height:44px}}
        @media(max-width:600px){.bvh-manager-mask{padding:8px}.bvh-shell{height:calc(100dvh - 16px)}.bvh-nav{padding:8px 12px;gap:8px}.bvh-brand>span{display:none}.bvh-nav nav{justify-content:space-between}.bvh-nav button{font-size:11px;padding:8px 9px}.bvh-nav button svg{display:none}.bvh-page-header{padding:18px 16px}.bvh-page-header h1{font-size:22px}.bvh-page-header p{font-size:11px}.bvh-eyebrow{font-size:8px}.bvh-content{padding:16px}.bvh-settings-layout{display:flex;flex-direction:column}.bvh-setting-groups{width:100%}.bvh-preview-panel{position:static;order:-1;width:100%;padding:16px;background:#EAEFEC;border-radius:10px}.bvh-preview-cover{margin-top:12px;aspect-ratio:16/8}.bvh-preview-note{margin-top:14px;padding-top:10px}.bvh-preview-panel>h3,.bvh-preview-caption{display:none}.bvh-preview-states{margin-top:12px;gap:5px}.bvh-preview-states button{min-height:44px;font-size:10px;padding:6px 8px}.bvh-setting-row{flex-wrap:nowrap}.bvh-setting-row select{max-width:132px}.bvh-opacity input[type=range]{width:48px}.bvh-footer{padding:12px 16px;gap:8px;flex-wrap:wrap;font-size:10px}.bvh-footer button{font-size:11px;padding:8px 10px}.bvh-save-status{font-size:10px}.bvh-footer:has([data-page-info])>span{width:100%}.bvh-history-tools{gap:8px}.bvh-history-tools label{font-size:10px}.bvh-history-tools select{font-size:11px;padding:7px}.bvh-tool-spacer{display:none}.bvh-selection-bar{flex-wrap:wrap}.bvh-selection-bar>span{width:100%}.bvh-selection-bar button{min-height:44px}.bvh-stat-summary{grid-template-columns:1fr 1fr;gap:10px}.bvh-stat-summary strong{font-size:28px}.bvh-stats-grid{grid-template-columns:1fr}.bvh-stats-grid>.bvh-section:first-child{grid-row:auto}.bvh-chart-card .bvh-help{text-align:center}.bvh-distribution{margin-top:18px}.bvh-trend-heading{flex-wrap:wrap}.bvh-confirm{padding:22px}.bvh-dialog-mask{padding:16px}.bvh-dialog-actions{justify-content:stretch}.bvh-dialog-actions button{flex:1}}
        .bvh-nav button[data-dirty=true]:after{content:"";width:6px;height:6px;border-radius:50%;background:#F0BD62;margin-left:auto;flex-shrink:0}
        .bvh-table-scroll{max-height:calc(100dvh - 390px);min-height:180px}
        @media(max-width:600px){.bvh-settings-layout>.bvh-setting-groups{display:contents}.bvh-setting-groups>.bvh-section{width:100%}.bvh-setting-groups>.bvh-section:nth-child(1){order:0}.bvh-setting-groups>.bvh-section:nth-child(2){order:1}.bvh-setting-groups>.bvh-section:nth-child(3){order:2}.bvh-settings-layout>.bvh-preview-panel{order:3}.bvh-setting-groups>.bvh-section:nth-child(4){order:4}.bvh-table-scroll{max-height:calc(100dvh - 460px)}}
        @media(prefers-reduced-motion:reduce){.bvh-workbench *{animation:none!important;transition:none!important}.bvh-loader{border-color:#007EAD}}
        `);
    }

    const HistoryPageSync = {
        _button: null,
        _hasSynced: false,
        _syncing: false,
        _lastCardCount: 0,

        isHistoryPage: () => {
            if (location.hostname !== 'www.bilibili.com') return false;
            return /^\/(?:history|account\/history)(?:\/|$)/.test(location.pathname);
        },

        refreshControl: () => {
            if (!document.body) return;
            if (!HistoryPageSync.isHistoryPage()) {
                HistoryPageSync.removeButton();
                HistoryPageSync._hasSynced = false;
                HistoryPageSync._lastCardCount = 0;
                return;
            }
            HistoryPageSync.ensureButton();
        },

        ensureButton: () => {
            let button = document.getElementById('bvh-history-sync-float');
            if (!button) {
                button = document.createElement('button');
                button.id = 'bvh-history-sync-float';
                button.className = 'bvh-history-sync-float';
                button.type = 'button';
                button.addEventListener('click', () => HistoryPageSync.handleClick());
                document.body.appendChild(button);
            }
            HistoryPageSync._button = button;
            HistoryPageSync.updateButton();
        },

        removeButton: () => {
            const button = document.getElementById('bvh-history-sync-float');
            if (button) button.remove();
            HistoryPageSync._button = null;
            HistoryPageSync._syncing = false;
        },

        updateButton: (label, loading = false) => {
            const button = HistoryPageSync._button || document.getElementById('bvh-history-sync-float');
            if (!button) return;
            button.innerText = label || (HistoryPageSync._hasSynced ? '继续同步历史' : '同步当前历史');
            button.title = HistoryPageSync._hasSynced
                ? '滚动到底部，等待加载更多 Bilibili 历史卡片后继续同步'
                : '同步当前已加载的 Bilibili 历史卡片';
            button.disabled = !!loading;
            button.classList.toggle('loading', !!loading);
        },

        handleClick: async () => {
            if (HistoryPageSync._syncing) return;
            if (!HistoryPageSync.isHistoryPage()) {
                UIComponent.toast('请先打开 Bilibili 历史记录页面再同步', 'error', 2500);
                HistoryPageSync.refreshControl();
                return;
            }
            await HistoryPageSync.runSync(HistoryPageSync._hasSynced);
        },

        runSync: async (continueMode = false) => {
            HistoryPageSync._syncing = true;
            const progress = UIComponent.progressToast(continueMode ? '准备继续同步历史...' : '正在同步当前历史...');
            const beforeCount = HistoryPageSync.countCards();
            try {
                if (continueMode) {
                    HistoryPageSync.updateButton('加载更多...', true);
                    progress.update(10, `正在滚动到底部，当前已加载 ${beforeCount} 条...`);
                    await HistoryPageSync.scrollAndWaitForMore(beforeCount, progress);
                }

                HistoryPageSync.updateButton('同步中...', true);
                progress.update(continueMode ? 55 : 25, `正在解析 ${HistoryPageSync.countCards()} 条历史卡片...`);
                const result = await HistoryPageSync.syncLoadedCards();
                result.beforeCardCount = beforeCount;
                result.afterCardCount = HistoryPageSync.countCards();
                result.newLoaded = Math.max(0, result.afterCardCount - beforeCount);

                HistoryPageSync._hasSynced = true;
                HistoryPageSync._lastCardCount = result.afterCardCount;
                const message = HistoryPageSync.formatSummary(result, continueMode);
                progress.close(message, 'success', 3200);
            } catch (e) {
                Utils.error('HistoryPageSync.runSync failed', e);
                progress.close('同步失败，请稍后重试或查看调试日志', 'error', 3200);
            } finally {
                HistoryPageSync._syncing = false;
                HistoryPageSync.updateButton();
            }
        },

        countCards: () => document.querySelectorAll('.history-card').length,

        scrollAndWaitForMore: (beforeCount, progress) => new Promise(resolve => {
            const startedAt = Date.now();
            let lastCount = beforeCount;
            let lastHeight = HistoryPageSync.getPageHeight();
            let stableSince = Date.now();

            const tick = () => {
                window.scrollTo({ top: HistoryPageSync.getPageHeight(), behavior: 'smooth' });
                const count = HistoryPageSync.countCards();
                const height = HistoryPageSync.getPageHeight();
                if (count !== lastCount || height !== lastHeight) {
                    lastCount = count;
                    lastHeight = height;
                    stableSince = Date.now();
                }

                const elapsed = Date.now() - startedAt;
                const stableFor = Date.now() - stableSince;
                const percent = Math.min(50, 12 + elapsed / 120);
                progress.update(percent, `等待加载更多历史... 当前 ${count} 条`);

                if ((elapsed >= 1200 && stableFor >= 900) || elapsed >= 6500) {
                    resolve(count);
                    return;
                }
                setTimeout(tick, 300);
            };

            setTimeout(tick, 120);
        }),

        getPageHeight: () => Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0
        ),

        syncLoadedCards: async () => {
            await StorageManager._syncIfStale();
            const result = {
                scanned: 0,
                candidates: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                saved: 0
            };
            const candidates = new Map();
            const cards = Array.from(document.querySelectorAll('.history-card'));
            result.scanned = cards.length;

            cards.forEach(card => {
                try {
                    const parsed = HistoryPageSync.parseCard(card);
                    if (!parsed) {
                        result.skipped++;
                        return;
                    }
                    const existing = candidates.get(parsed.key);
                    if (existing && existing.percentNumber >= parsed.percentNumber) {
                        result.skipped++;
                        return;
                    }
                    if (existing) result.skipped++;
                    candidates.set(parsed.key, parsed);
                } catch (e) {
                    result.failed++;
                    Utils.warn('HistoryPageSync.parseCard failed', e);
                }
            });

            result.candidates = candidates.size;
            const writes = [];
            candidates.forEach(candidate => {
                const merge = HistoryPageSync.mergeCandidate(candidate);
                if (merge.action === 'create') result.created++;
                else if (merge.action === 'update') result.updated++;
                else result.skipped++;
                if (merge.record) writes.push({ key: candidate.key, record: merge.record });
            });

            if (writes.length > 0) {
                const committed = await StorageManager.saveRecords(writes, false, { source: 'history', details: true });
                result.saved = committed.count; result.created = committed.created; result.updated = committed.updated;
                result.skipped += writes.length - committed.count;
            }
            return result;
        },

        mergeCandidate: (candidate) => {
            const existing = StorageManager.getRecord(candidate.key);
            const nextPercent = Math.max(0, Math.min(100, Math.round(candidate.percentNumber)));
            if (!existing) {
                return {
                    action: 'create',
                    record: {
                        v: 3,
                        status: RECORD_STATUS.WATCHED,
                        currentTime: candidate.currentTime || '',
                        percent: `${nextPercent}%`,
                        savedAt: candidate.savedAt,
                        title: candidate.title || ''
                    }
                };
            }

            const localPercent = parseInt(existing.percent, 10) || 0;
            const diff = nextPercent - localPercent;
            if (Math.abs(diff) <= 5 || diff <= 0) {
                return { action: 'skip', record: null };
            }

            return {
                action: 'update',
                record: {
                    v: 3,
                    status: RECORD_STATUS.WATCHED,
                    currentTime: candidate.currentTime || existing.currentTime || '',
                    percent: `${nextPercent}%`,
                    savedAt: candidate.savedAt,
                    title: candidate.title || existing.title || ''
                }
            };
        },

        parseCard: (card) => {
            if (!card) return null;
            const key = HistoryPageSync.extractKey(card);
            if (!key) return null;
            const progress = HistoryPageSync.extractProgress(card);
            if (!progress || !Number.isFinite(progress.percentNumber)) return null;
            const rawWatchTime = HistoryPageSync.extractWatchTimeText(card);
            const savedAt = HistoryPageSync.parseWatchTime(rawWatchTime);
            if (!savedAt) return null;
            return {
                key,
                title: HistoryPageSync.extractTitle(card),
                percentNumber: Math.max(0, Math.min(100, Math.round(progress.percentNumber))),
                currentTime: progress.currentTime || '',
                savedAt,
                rawWatchTime
            };
        },

        extractKey: (card) => {
            const link = card.querySelector('.bili-cover-card[href*="/video/"], a[href*="/video/"], a[href*="/v/"], a[href*="bvid="]');
            const href = link?.href || link?.getAttribute?.('href') || '';
            const hrefKey = VideoKey.fromUrl(href);
            const attrKey = VideoKey.fromText(card.getAttribute('data-bsb-bvid') || '');
            const base = VideoKey.base(hrefKey || attrKey);
            if (!base) return '';

            try {
                const url = new URL(href, location.href);
                const page = parseInt(url.searchParams.get('p'), 10);
                if (page > 1) return VideoKey.withPage(base, page);
            } catch (e) { }
            return hrefKey || attrKey || base;
        },

        extractTitle: (card) => {
            return (
                card.querySelector('.bili-video-card__title a')?.textContent ||
                card.querySelector('.bili-video-card__title')?.getAttribute('title') ||
                card.querySelector('.bili-cover-card img')?.getAttribute('alt') ||
                ''
            ).trim();
        },

        extractWatchTimeText: (card) => {
            return (card.querySelector('.bili-video-card__corner span')?.textContent || '').trim();
        },

        extractProgress: (card) => {
            const statText = HistoryPageSync.collectTexts(card, '.bili-cover-card__stats span, .bili-cover-card__stat span').join(' ');
            const timePair = statText.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
            if (timePair) {
                const currentSeconds = Utils.timeToSeconds(timePair[1]);
                const totalSeconds = Utils.timeToSeconds(timePair[2]);
                if (totalSeconds > 0 && currentSeconds >= 0) {
                    return {
                        percentNumber: (currentSeconds / totalSeconds) * 100,
                        currentTime: HistoryPageSync.normalizeTimeText(timePair[1])
                    };
                }
            }

            if (/已看完/.test(statText)) {
                return { percentNumber: 100, currentTime: '' };
            }

            const cssPercent = HistoryPageSync.extractProgressCssPercent(card);
            if (Number.isFinite(cssPercent)) {
                return { percentNumber: cssPercent, currentTime: '' };
            }

            const progressText = HistoryPageSync.collectTexts(card, '.bili-cover-card__tag span, .bili-cover-card__stats span, .bili-cover-card__stat span').join(' ');
            const percentMatch = progressText.match(/(?:已观看|观看)?\s*(\d+(?:\.\d+)?)\s*%/);
            if (percentMatch) {
                return { percentNumber: parseFloat(percentMatch[1]), currentTime: '' };
            }

            return null;
        },

        collectTexts: (root, selector) => Array.from(root.querySelectorAll(selector))
            .filter(el => !el.closest('.bvh-tag, .bvh-episode-tag'))
            .map(el => (el.textContent || '').trim())
            .filter(Boolean),

        extractProgressCssPercent: (card) => {
            const el = card.querySelector('.bili-cover-card__progress');
            if (!el) return NaN;
            const value = el.style.getPropertyValue('--bili-cover-card-progress-value')
                || (el.getAttribute('style') || '').match(/--bili-cover-card-progress-value:\s*([^;]+)/)?.[1]
                || '';
            const percent = parseFloat(value);
            return Number.isFinite(percent) ? percent : NaN;
        },

        normalizeTimeText: (value) => {
            const parts = String(value || '').trim().split(':').map(part => parseInt(part, 10));
            if (parts.some(part => Number.isNaN(part))) return '';
            const pad = v => String(v).padStart(2, '0');
            if (parts.length === 2) return `${pad(parts[0])}:${pad(parts[1])}`;
            if (parts.length === 3) return `${pad(parts[0])}:${pad(parts[1])}:${pad(parts[2])}`;
            return '';
        },

        parseWatchTime: (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const now = new Date();
            const makeDate = (year, month, day, hour, minute, second = 0, adjustFuture = false) => {
                const date = new Date(year, month - 1, day, hour, minute, second);
                if (
                    date.getFullYear() !== year ||
                    date.getMonth() !== month - 1 ||
                    date.getDate() !== day ||
                    date.getHours() !== hour ||
                    date.getMinutes() !== minute
                ) {
                    return '';
                }
                if (adjustFuture && date.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
                    date.setFullYear(date.getFullYear() - 1);
                }
                return HistoryPageSync.formatDateTime(date);
            };

            let match = raw.match(/^今天\s*(\d{1,2}):(\d{2})$/);
            if (match) {
                return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), parseInt(match[1], 10), parseInt(match[2], 10));
            }

            match = raw.match(/^昨天\s*(\d{1,2}):(\d{2})$/);
            if (match) {
                const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, parseInt(match[1], 10), parseInt(match[2], 10), 0);
                return HistoryPageSync.formatDateTime(date);
            }

            match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (match) {
                return makeDate(
                    parseInt(match[1], 10),
                    parseInt(match[2], 10),
                    parseInt(match[3], 10),
                    parseInt(match[4], 10),
                    parseInt(match[5], 10),
                    parseInt(match[6] || '0', 10)
                );
            }

            match = raw.match(/^(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (match) {
                return makeDate(
                    now.getFullYear(),
                    parseInt(match[1], 10),
                    parseInt(match[2], 10),
                    parseInt(match[3], 10),
                    parseInt(match[4], 10),
                    parseInt(match[5] || '0', 10),
                    true
                );
            }

            return '';
        },

        formatDateTime: (date) => {
            const pad = n => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        },

        formatSummary: (result, continueMode) => {
            const loadedText = continueMode
                ? `，加载前 ${result.beforeCardCount} 条，当前 ${result.afterCardCount} 条${result.newLoaded > 0 ? `，新增加载 ${result.newLoaded} 条` : '，未发现新增卡片'}`
                : `，当前 ${result.afterCardCount} 条`;
            const writeText = result.created + result.updated > 0
                ? `同步完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}`
                : `没有需要同步的记录：跳过 ${result.skipped}，失败 ${result.failed}`;
            return `${writeText}${loadedText}`;
        }
    };

    // --- 播放器监控层 ---
    class VideoPlayerObserver {
        static retired = new WeakMap();
        constructor(onIdentityChange = null) {
            this.generation = crypto.randomUUID(); this.state = 'waiting'; this.destroyed = false;
            this.onIdentityChange = onIdentityChange; this.cid = null;
            this.bvId = null; this.title = ''; this.videoEl = null; this.hasPlayed = false;
            this._lastKnownState = null; this._source = ''; this._metadataSeen = false;
            this._onPlay = () => { this.hasPlayed = true; this.saveProgressDebounced(); };
            this._onTimeUpdate = () => { if (this.videoEl?.currentTime > 0) this.hasPlayed = true; this.capture(); this.saveProgressDebounced(); };
            this._onPause = () => { this.capture(); this.persistSnapshot(); };
            this._onBeforeUnload = () => { this.capture(); this.persistSnapshot(); };
            this._onLoadStart = () => { this.state = 'switching'; this._metadataSeen = false; this._cancelSeek?.(); };
            this._onMetadata = () => {
                this._metadataSeen = true;
                if (this._metadataTimer) clearTimeout(this._metadataTimer);
                this._metadataTimer = setTimeout(() => this.confirmMedia(), 500);
            };
            this.saveProgressDebounced = Utils.throttle(() => this.saveProgress(), 5000);
        }
        init() {
            this.bvId = EpisodeResolver.getCurrentKey() || VideoKey.fromUrl(location.href);
            this.startVideoWatch();
            if (this.bvId) this.setupRecord();
        }
        identityMatches() {
            if (this.destroyed || !this.bvId || EpisodeResolver.getCurrentKey() !== this.bvId) return false;
            const data = window.__INITIAL_STATE__?.videoData;
            if (data?.bvid && VideoKey.base(data.bvid) !== VideoKey.base(this.bvId)) return false;
            const cid = window.__INITIAL_STATE__?.cid;
            if (this.cid && cid && String(cid) !== this.cid) return false;
            return true;
        }
        setupRecord() {
            if (this.destroyed) return;
            const data = window.__INITIAL_STATE__?.videoData;
            this.title = data?.bvid && VideoKey.base(data.bvid) === VideoKey.base(this.bvId) ? data.title || '' : '';
            const record = StorageManager.getRecord(this.bvId);
            if (record) UIComponent.showViewPanel(record, this.bvId);
            this.ensureVisitedRecord();
            this.completeMissingTitle();
            this.waitForVideo().then(video => {
                if (!this.destroyed) this.bindVideo(video);
            }).catch(error => { if (!this.destroyed) Utils.warn('媒体尚未就绪，继续低频发现', error); });
        }
        getCurrentVideo() { return document.querySelector('#bilibili-player video') || document.querySelector('bwp-video'); }
        waitForVideo(timeout = 10000) {
            return new Promise((resolve, reject) => {
                const video = this.getCurrentVideo(); if (video) { resolve(video); return; }
                let settled = false;
                const finish = (video, error) => {
                    if (settled) return; settled = true; observer.disconnect(); clearTimeout(timer); this._cancelWait = null;
                    if (error) reject(error); else resolve(video);
                };
                const observer = new MutationObserver(() => { const video = this.getCurrentVideo(); if (video) finish(video); });
                const timer = setTimeout(() => finish(null, new Error('等待媒体超时')), timeout);
                this._cancelWait = () => finish(null, new Error('会话已结束'));
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
        bindVideo(video) {
            if (!video || this.destroyed || video === this.videoEl) return;
            this.ensureVisitedRecord();
            this.persistSnapshot(); this.unbindVideoEvents(this.videoEl);
            this.videoEl = video; this._metadataSeen = false; this.state = 'waiting';
            this.bindEvents();
            const retired = VideoPlayerObserver.retired.get(video);
            if (!retired || (retired.key === this.bvId && retired.source === (video.currentSrc || video.src || ''))) this.confirmMedia();
        }
        confirmMedia() {
            if (!this.identityMatches() || !this.videoEl || this.videoEl.readyState < 1) return false;
            const source = this.videoEl.currentSrc || this.videoEl.src || '';
            const retired = VideoPlayerObserver.retired.get(this.videoEl);
            if (retired && retired.key !== this.bvId && !this._metadataSeen && source === retired.source) return false;
            if (this.state === 'switching' && !this._metadataSeen) return false;
            this.state = 'bound'; this._source = source;
            this.cid = window.__INITIAL_STATE__?.cid ? String(window.__INITIAL_STATE__.cid) : null;
            const data = window.__INITIAL_STATE__?.videoData;
            this.title = data?.title || document.title || this.title;
            this.ensureVisitedRecord();
            this.completeMissingTitle();
            if (!this._resumeShown) {
                this._resumeShown = true;
                const valid = () => this.state === 'bound' && this.identityMatches() && this.videoEl === this.getCurrentVideo();
                const latest = EpisodeResolver.getLatestRecord(VideoKey.base(this.bvId));
                if (latest) this._cancelPrompt = UIComponent.showResumePrompt(latest, () => {
                    if (valid()) { this.videoEl.currentTime = 0; this.videoEl.play(); }
                }, valid);
                this._cancelSeek = UIComponent.applyPendingSeek(this.bvId, this.videoEl, valid);
            }
            return true;
        }
        ensureVisitedRecord() {
            // 访问身份来自当前路由，不等待媒体确认，也不读取旧媒体的时间或标题。
            if (this.destroyed || !this.bvId || EpisodeResolver.getCurrentKey() !== this.bvId || this._visitedSaved || StorageManager.getRecord(this.bvId)) return;
            this._visitedSaved = true;
            const title = this.getConfirmedTitle();
            const visited = { status: RECORD_STATUS.VISITED, currentTime: '', percent: '', savedAt: Utils.formatTime(), title };
            UIComponent.showViewPanel({ ...visited, status: '正在保存访问记录…' }, this.bvId);
            StorageManager.saveRecord(this.bvId, visited, true, { source: 'visit' })
                .then(() => {
                    if (!this.destroyed && EpisodeResolver.getCurrentKey() === this.bvId) {
                        const record = StorageManager.getRecord(this.bvId);
                        if (record) UIComponent.showViewPanel(record, this.bvId);
                        this.completeMissingTitle();
                    }
                })
                .catch(error => {
                    this._visitedSaved = false; Utils.warn('访问记录保存失败', error);
                    if (!this.destroyed && EpisodeResolver.getCurrentKey() === this.bvId) UIComponent.showViewPanel({ ...visited, status: '访问记录保存失败，等待重试', savedAt: '' }, this.bvId);
                });
        }
        completeMissingTitle() {
            if (this.destroyed || !this.bvId || EpisodeResolver.getCurrentKey() !== this.bvId || this._titlePending) return;
            const title = this.getConfirmedTitle();
            if (!title) return;
            this.title = title;
            const current = StorageManager.getRecord(this.bvId);
            if (!current || current.title) return;
            // 提交时只补最新记录的空标题，不重写旧进度、保存时间，也不复活删除记录。
            this._titlePending = StorageManager.saveRecord(this.bvId, { title }, true, { source: 'title' })
                .then(() => {
                    if (!this.destroyed && EpisodeResolver.getCurrentKey() === this.bvId) {
                        const record = StorageManager.getRecord(this.bvId);
                        if (record) UIComponent.showViewPanel(record, this.bvId);
                    }
                })
                .catch(error => Utils.warn('标题补全失败，稍后重试', error))
                .finally(() => { this._titlePending = null; });
            return this._titlePending;
        }
        getConfirmedTitle() {
            if (this.destroyed || EpisodeResolver.getCurrentKey() !== this.bvId) return '';
            const base = VideoKey.base(this.bvId);
            // 油猴沙箱 window 不一定暴露站点数据；部分页面的 bvid 只在状态顶层。
            for (const state of [Utils._getPageWindow()?.__INITIAL_STATE__, window.__INITIAL_STATE__]) {
                const data = state?.videoData;
                const id = data?.bvid || state?.bvid;
                if (id && VideoKey.base(id) === base && typeof data?.title === 'string' && data.title.trim()) return data.title.trim();
            }
            // 无页面全局数据时，用带视频身份的页面元信息核对标题；不直接采用 document.title。
            const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute?.('href');
            const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute?.('content');
            const identityUrl = ogUrl || canonical;
            if (!identityUrl || VideoKey.base(VideoKey.fromUrl(identityUrl)) !== base) return '';
            const heading = document.querySelector('h1.video-title, h1[title]');
            const title = heading?.getAttribute?.('title') || heading?.textContent
                || document.querySelector('meta[property="og:title"]')?.getAttribute?.('content');
            return typeof title === 'string' ? title.trim() : '';
        }
        capture() {
            if (this.state !== 'bound' || !this.identityMatches() || !this.videoEl || !this.hasPlayed) return null;
            if ((this.videoEl.currentSrc || this.videoEl.src || '') !== this._source) { this.state = 'switching'; return null; }
            const current = this.videoEl.currentTime, duration = this.videoEl.duration;
            if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0 || current < MIN_WATCH_SAVE_SECONDS) return null;
            if (this._lastKnownState?.seconds === current) return this._lastKnownState;
            const pad = n => String(n).padStart(2, '0');
            const seconds = Math.floor(current), h = Math.floor(seconds / 3600);
            const time = (h ? pad(h) + ':' : '') + pad(Math.floor(seconds % 3600 / 60)) + ':' + pad(seconds % 60);
            this._lastKnownState = { key: this.bvId, seconds: current, transactionId: StorageManager._store.transactionId(), version: StorageManager.sampleVersion(), value: {
                v: 3, status: RECORD_STATUS.WATCHED, currentTime: time, percent: Math.min(100, Math.round(current / duration * 100)) + '%',
                savedAt: Utils.formatTime(), title: this.title
            } };
            return this._lastKnownState;
        }
        persistSnapshot() {
            const snapshot = this._lastKnownState;
            if (!snapshot || snapshot === this._savedSnapshot || snapshot === this._savingSnapshot) return Promise.resolve();
            StorageManager.writeBackup(snapshot); this._savingSnapshot = snapshot;
            return StorageManager.saveRecord(snapshot.key, snapshot.value, true, { version: snapshot.version, transactionId: snapshot.transactionId }).then(() => {
                this._savedSnapshot = snapshot;
                if (this._lastKnownState === snapshot && !this.destroyed) UIComponent.updateViewPanelProgress(snapshot.value);
            }).catch(error => { Utils.error('播放进度保存失败，保留原采样备份', error); }).finally(() => { if (this._savingSnapshot === snapshot) this._savingSnapshot = null; });
        }
        saveProgress() { this.capture(); return this.persistSnapshot(); }
        startVideoWatch() {
            if (this.videoWatchInterval) return;
            this.videoWatchInterval = setInterval(() => {
                if (this.destroyed) return;
                const activeKey = EpisodeResolver.getCurrentKey();
                if (this.bvId && activeKey && activeKey !== this.bvId) { this.state = 'switching'; this.onIdentityChange?.(); return; }
                if (!this.bvId) { this.bvId = EpisodeResolver.getCurrentKey(); if (this.bvId) this.setupRecord(); }
                this.completeMissingTitle();
                const video = this.getCurrentVideo();
                if (video !== this.videoEl) this.bindVideo(video);
                if (this.state === 'waiting') this.confirmMedia();
                if (video && !video.paused) { this.hasPlayed = true; this.saveProgress(); }
            }, 5000);
        }
        bindEvents() {
            for (const [event, fn] of this.events()) this.videoEl.addEventListener(event, fn);
            window.addEventListener('beforeunload', this._onBeforeUnload);
        }
        events() { return [['play', this._onPlay], ['timeupdate', this._onTimeUpdate], ['pause', this._onPause], ['loadstart', this._onLoadStart], ['emptied', this._onLoadStart], ['loadedmetadata', this._onMetadata]]; }
        unbindVideoEvents(video) { if (video) for (const [event, fn] of this.events()) video.removeEventListener(event, fn); }
        destroy() {
            if (this.destroyed) return;
            this.destroyed = true; this.state = 'destroyed';
            if (this.videoEl) VideoPlayerObserver.retired.set(this.videoEl, { key: this.bvId, source: this._source });
            this.persistSnapshot(); this.unbindVideoEvents(this.videoEl);
            window.removeEventListener('beforeunload', this._onBeforeUnload);
            this._cancelWait?.(); this._cancelSeek?.(); this._cancelPrompt?.();
            clearInterval(this.videoWatchInterval); clearTimeout(this._metadataTimer);
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
            this.observedElements = new Set();
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
            this._unsubscribe = StorageManager.onDataChange((change) => {
                const start = performance.now();
                let processed = 0;
                let removed = 0;
                this.relatedKeysCache.clear();
                this.visibleElements.forEach(el => {
                    if (document.contains(el)) {
                        const base = VideoKey.base(this.getVideoKeyFromLink(el) || el._bvhLastVideoKey);
                        if (change.fullReset || change.settingsChanged || change.changedBases.has(base)) this.enqueueElement(el);
                        processed++;
                    } else {
                        this.visibleElements.delete(el);
                        this.intersectionObserver.unobserve(el);
                        this.pendingLinks.delete(el); this.pendingPlaylistItems.delete(el);
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
            this.pruneDisconnected();
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
                    if (m.removedNodes.length) this.pruneDisconnected();
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
                this.observedElements.add(el);
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
            el._bvhTag?.remove(); el._bvhBar?.remove();
            el._bvhTag = null; el._bvhBar = null; el._bvhMarkParent = null; el._bvhSignature = null;
            const existingTags = el.querySelectorAll('.bvh-tag, .bvh-tag-small, .bvh-tag-big');
            existingTags.forEach(tag => tag.remove());
            const existingBars = el.querySelectorAll('.bvh-progress-bar');
            existingBars.forEach(bar => bar.remove());
        }

        pruneDisconnected() {
            for (const set of [this.visibleElements, this.observedElements, this.pendingLinks, this.pendingPlaylistItems]) {
                for (const el of set) if (!el.isConnected) { set.delete(el); this.intersectionObserver.unobserve(el); }
            }
            for (const root of this.pendingRescanRoots.keys()) if (!root.isConnected) this.pendingRescanRoots.delete(root);
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
                    this.observedElements.add(el);
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
            el._bvhLastVideoKey = item.key;

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
            const signature = JSON.stringify([bv, tagText, tagTitle, record.percent, CONFIG.showProgressBar, CONFIG.tagPosition, CONFIG.tagOpacity, CONFIG.lowThreshold, CONFIG.highThreshold]);
            if (!CONFIG.showProgressBar && existingBars.length) {
                existingBars.forEach(bar => bar.remove?.());
                if (!existingBars[0].remove) this.removeExistingMark(el);
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

            if (el._bvhSignature === signature && el._bvhMarkParent === markParent && el._bvhTag?.isConnected) return;
            const template = UIComponent.createTag(tagText, tagTitle, `bvh-tag ${tagColorClass} ${isSmall ? 'bvh-tag-small' : ''}`);
            let tagEl = el._bvhTag;
            if (tagEl?.parentNode === markParent) {
                tagEl.className = template.className; tagEl.style.cssText = template.style.cssText;
                tagEl.textContent = tagText; tagEl.title = tagTitle;
            } else {
                this.removeExistingMark(el); tagEl?.remove(); tagEl = template;
                markParent.insertBefore(tagEl, markBeforeNode);
            }
            el._bvhTag = tagEl; el._bvhMarkParent = markParent; el._bvhSignature = signature;
            el._bvhBar?.remove(); el._bvhBar = null;
            el._bvhLastVideoKey = bv;

            if (CONFIG.showProgressBar && record.percent && !isMulti) {
                const barEl = UIComponent.createProgressBar(record.percent);
                el._bvhBar = barEl;
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

        async start() {
            const done = Utils.debugTime('AppController.start');
            const currentVersion = typeof GM_info !== 'undefined' ? (GM_info.script?.version || 'unknown') : 'unknown';
            Utils.log(`Script started v${currentVersion}`, `url=${location.href}`, `readyState=${document.readyState}`, `debug=${CONFIG.debug}`);
            injectStyles();

            const initialKey = VideoKey.fromUrl(location.href);
            if (initialKey) UIComponent.showViewPanel({ status: '正在读取历史记录…', currentTime: '', percent: '', savedAt: '' }, initialKey);
            const storageStarted = performance.now();

            // 数据迁移（v1/v2 → v3 分片，仅首次执行）
            try { await StorageManager.initializeForKeys(initialKey ? [initialKey] : []); }
            catch (error) {
                Utils.error('历史存储初始化失败', error);
                if (initialKey) UIComponent.showViewPanel({ status: '历史读取失败，请刷新重试', currentTime: '', percent: '', savedAt: '' }, initialKey);
                UIComponent.toast('历史存储初始化失败，请重试刷新页面', 'error'); return;
            }
            Utils.log('启动历史读取完成', `耗时=${Math.round(performance.now() - storageStarted)}ms`, `提交数=${StorageManager._store.commits.size}`);

            this.initMenuCommands();
            window.addEventListener('pagehide', event => { if (!event.persisted) StorageManager.dispose(); });
            this.deferDomStart();
            // 备份按原版本条件恢复，不再阻塞当前视频界面与媒体监听。
            const restoreStarted = performance.now();
            StorageManager.restoreFromLocalStorage()
                .then(() => StorageManager.cleanupLocalStorageBackups())
                .catch(error => Utils.warn('启动备份恢复失败，已保留备份', error))
                .finally(() => Utils.log('启动备份恢复结束', `耗时=${Math.round(performance.now() - restoreStarted)}ms`));
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
                // 播放记录和悬浮进度框只依赖 DOM 就绪，不等待头部动画或卡片扫描。
                this.checkAndInitVideoPage();
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
                    scheduleStart('header wait timeout');
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
            HistoryPageSync.refreshControl();
            this.hijackRouter();
            done('initialized watchers/player/router');

            // 标签页切回时基于版本号判断是否需要同步（避免盲目全量刷新）
            document.addEventListener('visibilitychange', async () => {
                Utils.log('visibilitychange', document.visibilityState);
                if (document.visibilityState === 'visible') {
                    const stale = await StorageManager._syncIfStale().catch(error => { Utils.warn('历史同步失败', error); return false; });
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

            GM_registerMenuCommand('导出历史记录', async () => {
                await StorageManager.initialize();
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
                    reader.onload = async ev => {
                        try {
                            const data = JSON.parse(ev.target.result);
                            const result = await StorageManager.importRecords(data);
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

        async checkAndInitVideoPage() {
            const isVideoPage = isVideoPageRoute();
            const routeKey = this.getRouteVideoKey();
            const observerKey = this.playerObserver?.bvId ? VideoKey.normalize(this.playerObserver.bvId) : '';
            Utils.log('AppController.checkAndInitVideoPage', `isVideoPage=${!!isVideoPage}`, `routeKey=${routeKey || 'none'}`, `observerKey=${observerKey || 'none'}`, `url=${location.href}`, `stateBvid=${window.__INITIAL_STATE__?.bvid || 'none'}`);
            if (isVideoPage) {
                if (this.playerObserver && !this.playerObserver.destroyed && routeKey && observerKey === VideoKey.normalize(routeKey)) {
                    Utils.log('AppController.checkAndInitVideoPage skip: same video key');
                    this.currentVideoKey = routeKey;
                    return;
                }
                if (this.playerObserver) {
                    this.playerObserver.destroy();
                }
                const generation = this._videoInitGeneration = (this._videoInitGeneration || 0) + 1;
                try { await StorageManager.initializeForKeys(routeKey ? [routeKey] : []); }
                catch (error) { Utils.warn('当前视频历史读取失败', error); return; }
                if (generation !== this._videoInitGeneration || routeKey !== this.getRouteVideoKey()) return;
                this.currentVideoKey = routeKey;
                this.playerObserver = new VideoPlayerObserver(() => this.checkAndInitVideoPage());
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
                    this.playerObserver?.destroy(); this.playerObserver = null;
                    this.currentUrl = location.href;
                    Utils.log('Route changed:', this.currentUrl);
                    setTimeout(() => {
                        const done = Utils.debugTime('AppController.locationchange delayed refresh');
                        this.checkAndInitVideoPage();
                        UIComponent.showQuickEntry();
                        HistoryPageSync.refreshControl();
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
