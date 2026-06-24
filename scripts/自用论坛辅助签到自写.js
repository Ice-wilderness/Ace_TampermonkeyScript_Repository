// ==UserScript==
// @name         【自写】自用论坛辅助签到自写
// @namespace    bbshelperforme
// @version      2.11.5
// @description  论坛辅助签到工具 - 支持 limestart 签到控制台、控制台直签与多站点自动签到
// @author       Ice_wilderness
// @match        https://www.limestart.cn/*
// @match        https://limestart.cn/*
// @match        http*://bbs.wcccc.cc/*
// @match        http*://www.south-plus.net/*
// @match        http*://galge.fun/*
// @match        http*://2dfan.com/*
// @match        http*://2dfan.org/*
// @match        http*://www.sl-asmr.com/*
// @match        http*://bbs.kfpromax.com/*
// @match        http*://sjs47.com/*
// @match        http*://laowang.vip/*
// @match        http*://vv9b.vbrwd4qd356.com/*
// @match        http*://www.vikacg.com/*
// @match        http*://feixueacg.org/*
// @match        http*://www.galgamex.org/*
// @match        http*://www.acgndog.com/*
// @match        http*://www.galgamex.top/*
// @match        http*://zodgame.xyz/*
// @match        http*://www.uu-gg.one/*
// @match        http*://www.fufugal.com/*
// @match        *://sstm.moe/*
// @connect      feixueacg.org
// @connect      www.south-plus.net
// @connect      www.sl-asmr.com
// @connect      bbs.kfpromax.com
// @connect      sjs47.com
// @connect      www.galgamex.top
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.deleteValue
// @grant        GM_notification
// @grant        GM_info
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_getResourceText
// @grant        GM_setClipboard
// @grant        GM_unregisterMenuCommand
// @require      https://cdn.jsdelivr.net/npm/jquery@3.5.0/dist/jquery.min.js
// @run-at       document-end
// ==/UserScript==

(async function () {
    'use strict';

    // ================== 基础工具函数 ==================

    const STORAGE_KEYS = {
        successData: 'BBSSignHelperData',
        dashboardConfig: 'BBSSignHelperDashboardConfig',
        dashboardStatus: 'BBSSignHelperDashboardStatus',
        signDebugLogs: 'BBSSignHelperDebugLogs',
        pageToastSuppressed: 'BBSSignHelperPageToastSuppressed',
        autoClosePending: 'BBSSignHelperAutoClosePending'
    };

    const DEBUG_LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
    const DEBUG_LOG_TEXT_LIMIT = 6000;
    const DEBUG_LOG_MAX_SESSIONS = 80;
    const DEBUG_LOG_MAX_ENTRIES_PER_SESSION = 50;
    const DEBUG_SENSITIVE_KEY_RE = /authorization|cookie|set-cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey/i;
    const DEBUG_TEXT_RESPONSE_RE = /json|text|xml|html|javascript|form|plain|gbk|gb2312/i;
    const PAGE_COMPLETED_TOAST_AUTO_CLOSE_MS = 3000;
    const PAGE_COMPLETED_TOAST_DAILY_LIMIT = 3;
    const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 2000;
    const DASHBOARD_AUTO_REFRESH_DURATION_MS = 2 * 60 * 1000;
    const DIRECT_SIGN_RETRY_ATTEMPTS = 3;
    const DIRECT_SIGN_RETRY_DELAY_MS = 3000;
    const AUTO_CLOSE_PENDING_TTL_MS = 10 * 60 * 1000;
    const CLOSE_PAGE_AFTER_SIGN_ACTION = { closePageAfterSignAction: true };
    const AUTO_CLOSE_AFTER_LAUNCH_SITE_KEYS = new Set(['uugg', 'soushuba', 'ZodGame', 'laowang']);
    const TRACK_LAUNCHED_AUTO_CLOSE_SITE_KEYS = new Set([...AUTO_CLOSE_AFTER_LAUNCH_SITE_KEYS, 'sstm']);

    const STATUS_META = {
        'not-started': { label: '待开始', tone: 'neutral', message: '今日尚未处理' },
        running: { label: '执行中', tone: 'pending', message: '正在执行签到请求' },
        opened: { label: '已打开', tone: 'pending', message: '已打开，等待确认' },
        success: { label: '成功', tone: 'success', message: '今日已完成' },
        failed: { label: '失败', tone: 'danger', message: '本次未确认成功' },
        'needs-login': { label: '需登录', tone: 'warning', message: '需要先登录账号' },
        'needs-foreground': { label: '需前台', tone: 'warning', message: '需要前台页面处理' },
        skipped: { label: '已跳过', tone: 'muted', message: '今日已跳过' },
        disabled: { label: '已禁用', tone: 'muted', message: '该目标未启用' }
    };

    const OPEN_MODE_LABELS = {
        background: '后台',
        foreground: '前台',
        manual: '手动'
    };

    const RESULT_MODE_LABELS = {
        script: '脚本检测',
        opened: '打开待确认',
        manual: '手动确认'
    };

    const DEFAULT_DASHBOARD_CONFIG = {
        targetSettings: {},
        customTargets: [],
        preferences: {
            autoOpenDashboardOnAttention: false,
            autoClosePageAfterSign: false
        }
    };

    let dashboardSearchQuery = '';
    let settingsSearchQuery = '';
    let dashboardBodyScrollTop = 0;
    let settingsBodyScrollTop = 0;
    let autoOpenTimer = null;
    let autoOpenCountdownTimer = null;
    let autoOpenCountdownLeft = 0;
    let autoOpenReminderSignature = '';
    let autoOpenSuppressedSignature = '';
    let dashboardAutoRefreshTimer = null;
    let dashboardAutoRefreshUntil = 0;
    let launchedAutoCloseMonitorTimer = null;
    const launchedAutoCloseTabs = new Map();
    let activeSignDebugContext = null;
    let dismissedPageSignToastSignature = '';
    let pageSignToastAutoCloseTimer = null;
    let uuGgPageSubmitAttempted = false;

    // 获取格式化后的今天日期 (yyyy-MM-dd)
    function getToday() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function getTimeLabel(value) {
        if (!value) return '尚无记录';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '尚无记录';
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function getLocalDateTimeWithOffset(date = new Date()) {
        const offsetMinutes = -date.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const absOffset = Math.abs(offsetMinutes);
        const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
        const offsetMins = String(absOffset % 60).padStart(2, '0');
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${offsetHours}:${offsetMins}`;
    }

    function readObject(key, fallback = {}) {
        const value = GM_getValue(key);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return JSON.parse(JSON.stringify(fallback));
        }
        return value;
    }

    function readArray(key, fallback = []) {
        const value = GM_getValue(key);
        if (!Array.isArray(value)) {
            return JSON.parse(JSON.stringify(fallback));
        }
        return value;
    }

    function writeObject(key, value) {
        GM_setValue(key, value);
    }

    function getScopedStorageKey(baseKey, ...parts) {
        return [baseKey, ...parts.map(part => String(part))].join(':');
    }

    // 获取数据
    function getData(key) {
        if (key) {
            const scopedValue = GM_getValue(getScopedStorageKey(STORAGE_KEYS.successData, key));
            if (typeof scopedValue === 'string') return scopedValue;
        }
        const data = readObject(STORAGE_KEYS.successData);
        return data[key];
    }

    // 设置数据并标记今日已签到
    function markSignSuccess(key, message = '今日签到已确认') {
        const today = getToday();
        const data = readObject(STORAGE_KEYS.successData);
        data[key] = today;
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, key), today);
        writeObject(STORAGE_KEYS.successData, data);
        recordTargetStatus(key, 'success', {
            stage: 'verify',
            message,
            url: location.href
        });
        console.log(`[签到助手] ${key} 签到状态已更新为：${data[key]}`);
    }

    function clearSignSuccess(key, message = '已清除错误的今日成功记录') {
        const data = readObject(STORAGE_KEYS.successData);
        delete data[key];
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, key), '');
        writeObject(STORAGE_KEYS.successData, data);
        console.log(`[签到助手] ${key} ${message}`);
    }

    function completeSign(key, message, options = {}) {
        markSignSuccess(key, message);
        maybeAutoClosePageAfterSign(key, options);
        return true;
    }

    function getDashboardConfig() {
        const config = readObject(STORAGE_KEYS.dashboardConfig, DEFAULT_DASHBOARD_CONFIG);
        const preferences = config.preferences && typeof config.preferences === 'object' ? config.preferences : {};
        return {
            targetSettings: config.targetSettings && typeof config.targetSettings === 'object' ? config.targetSettings : {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: preferences.autoOpenDashboardOnAttention === true,
                autoClosePageAfterSign: preferences.autoClosePageAfterSign === true
            }
        };
    }

    function saveDashboardConfig(config) {
        writeObject(STORAGE_KEYS.dashboardConfig, {
            targetSettings: config.targetSettings || {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: config.preferences?.autoOpenDashboardOnAttention === true,
                autoClosePageAfterSign: config.preferences?.autoClosePageAfterSign === true
            }
        });
        updateDashboardReminderButton();
    }

    function updateDashboardPreference(patch) {
        const config = getDashboardConfig();
        config.preferences = { ...config.preferences, ...patch };
        saveDashboardConfig(config);
    }

    function getStatusStore() {
        return readObject(STORAGE_KEYS.dashboardStatus);
    }

    function saveStatusStore(store) {
        writeObject(STORAGE_KEYS.dashboardStatus, store);
    }

    function getTargetStatusStorageKey(day, key) {
        return getScopedStorageKey(STORAGE_KEYS.dashboardStatus, day, key);
    }

    function getPageSignToastSuppressionStore() {
        const today = getToday();
        const store = readObject(STORAGE_KEYS.pageToastSuppressed, { date: today, keys: {}, completedCounts: {} });
        return {
            date: today,
            keys: store.date === today && store.keys && typeof store.keys === 'object' ? store.keys : {},
            completedCounts: store.date === today && store.completedCounts && typeof store.completedCounts === 'object' ? store.completedCounts : {}
        };
    }

    function savePageSignToastSuppressionStore(store) {
        writeObject(STORAGE_KEYS.pageToastSuppressed, {
            date: store.date || getToday(),
            keys: store.keys || {},
            completedCounts: store.completedCounts || {}
        });
    }

    function isPageSignToastSuppressedToday(key, status, options = {}) {
        if (status !== 'success') return false;
        const store = getPageSignToastSuppressionStore();
        if (store.keys?.[key] === true) return true;
        if (options.countCompletedToast === true) {
            return Number(store.completedCounts?.[key] || 0) >= PAGE_COMPLETED_TOAST_DAILY_LIMIT;
        }
        return false;
    }

    function suppressPageSignToastToday(key) {
        const store = getPageSignToastSuppressionStore();
        store.keys[key] = true;
        savePageSignToastSuppressionStore(store);
    }

    function incrementCompletedPageSignToastCount(key) {
        const store = getPageSignToastSuppressionStore();
        const currentCount = Number(store.completedCounts?.[key] || 0);
        const nextCount = Math.min(PAGE_COMPLETED_TOAST_DAILY_LIMIT, currentCount + 1);
        store.completedCounts[key] = nextCount;
        savePageSignToastSuppressionStore(store);
        return nextCount;
    }

    function recordTargetStatus(key, status, options = {}) {
        if (!key) return;
        const today = getToday();
        const store = getStatusStore();
        const dayStatus = store[today] || {};
        const previous = dayStatus[key] || {};
        const nextStatus = {
            status,
            stage: options.stage || previous.stage || '',
            message: options.message || STATUS_META[status]?.message || previous.message || '',
            updatedAt: new Date().toISOString(),
            url: options.url || previous.url || location.href,
            attemptCount: options.incrementAttempt ? (previous.attemptCount || 0) + 1 : (previous.attemptCount || 0)
        };
        dayStatus[key] = nextStatus;
        store[today] = dayStatus;
        GM_setValue(getTargetStatusStorageKey(today, key), nextStatus);
        saveStatusStore(store);
        showPageSignToast(key, status, {
            ...nextStatus,
            autoCloseAfterMs: options.autoClosePageSignToastAfterMs || 0,
            countCompletedToast: options.countCompletedPageSignToast === true
        });
        updateDashboardReminderButton();
    }

    function addPageSignToastStyles() {
        if (document.getElementById('bbs-sign-page-toast-style')) return;
        const css = `
            #bbs-sign-page-toast {
                position: fixed;
                top: 18px;
                left: 50%;
                z-index: 2147483647;
                display: flex;
                align-items: flex-start;
                gap: 10px;
                width: min(520px, calc(100vw - 28px));
                box-sizing: border-box;
                border: 1px solid rgba(15, 23, 42, 0.12);
                border-radius: 12px;
                padding: 12px 14px;
                color: #0f172a;
                background: rgba(255, 255, 255, 0.96);
                box-shadow: 0 18px 52px rgba(15, 23, 42, 0.22);
                font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                transform: translateX(-50%);
                cursor: pointer;
                backdrop-filter: blur(12px);
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-dot {
                width: 10px;
                height: 10px;
                flex: 0 0 auto;
                border-radius: 999px;
                margin-top: 5px;
                background: #2563eb;
                box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-main {
                min-width: 0;
                flex: 1;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-title {
                font-weight: 800;
                line-height: 1.25;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-message {
                margin-top: 3px;
                color: #475569;
                font-size: 13px;
                overflow-wrap: anywhere;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-hint {
                color: #94a3b8;
                font-size: 12px;
                white-space: nowrap;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-actions {
                display: flex;
                align-items: center;
                flex: 0 0 auto;
                gap: 8px;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-suppress {
                border: 1px solid rgba(16, 185, 129, 0.38);
                border-radius: 999px;
                padding: 4px 10px;
                color: #047857;
                background: rgba(255, 255, 255, 0.72);
                font: inherit;
                font-size: 12px;
                line-height: 1.2;
                white-space: nowrap;
                cursor: pointer;
            }
            #bbs-sign-page-toast .bbs-sign-page-toast-suppress:hover {
                border-color: rgba(16, 185, 129, 0.62);
                background: rgba(255, 255, 255, 0.94);
            }
            #bbs-sign-page-toast.success {
                border-color: rgba(16, 185, 129, 0.35);
                background: rgba(240, 253, 244, 0.96);
            }
            #bbs-sign-page-toast.success .bbs-sign-page-toast-dot {
                background: #10b981;
                box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14);
            }
            #bbs-sign-page-toast.danger {
                border-color: rgba(244, 63, 94, 0.35);
                background: rgba(255, 241, 242, 0.97);
            }
            #bbs-sign-page-toast.danger .bbs-sign-page-toast-dot {
                background: #f43f5e;
                box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.14);
            }
            #bbs-sign-page-toast.warning {
                border-color: rgba(245, 158, 11, 0.42);
                background: rgba(255, 251, 235, 0.97);
            }
            #bbs-sign-page-toast.warning .bbs-sign-page-toast-dot {
                background: #f59e0b;
                box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.16);
            }
            #bbs-sign-page-toast.muted,
            #bbs-sign-page-toast.neutral {
                background: rgba(248, 250, 252, 0.97);
            }
            @media (max-width: 560px) {
                #bbs-sign-page-toast {
                    top: 10px;
                    align-items: flex-start;
                    padding: 11px 12px;
                }
                #bbs-sign-page-toast .bbs-sign-page-toast-hint {
                    display: none;
                }
                #bbs-sign-page-toast .bbs-sign-page-toast-actions {
                    align-items: flex-start;
                }
            }
        `;
        const style = document.createElement('style');
        style.id = 'bbs-sign-page-toast-style';
        style.textContent = css;
        (document.head || document.documentElement).append(style);
    }

    function getPageSignToastTitle(status) {
        if (status === 'running') return '签到中';
        if (status === 'success') return '签到成功';
        if (status === 'opened') return '等待确认';
        if (status === 'failed' || status === 'needs-login' || status === 'needs-foreground') return '签到失败';
        return STATUS_META[status]?.label || '签到状态';
    }

    function showPageSignToast(key, status, options = {}) {
        if (isLimestartHost()) return;
        const mount = document.body || document.documentElement;
        if (!mount) return;

        const message = options.message || STATUS_META[status]?.message || '';
        const signature = `${key}|${status}|${message}`;
        if (dismissedPageSignToastSignature === signature) return;
        const shouldCountCompletedToast = options.countCompletedToast === true && status === 'success';
        if (isPageSignToastSuppressedToday(key, status, { countCompletedToast: shouldCountCompletedToast })) return;
        const completedToastCount = shouldCountCompletedToast ? incrementCompletedPageSignToastCount(key) : 0;
        const autoCloseAfterMs = Math.max(0, Number(options.autoCloseAfterMs) || 0);
        if (pageSignToastAutoCloseTimer) {
            clearTimeout(pageSignToastAutoCloseTimer);
            pageSignToastAutoCloseTimer = null;
        }

        addPageSignToastStyles();
        let toast = document.getElementById('bbs-sign-page-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'bbs-sign-page-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            toast.addEventListener('click', () => {
                dismissedPageSignToastSignature = toast.dataset.signature || '';
                toast.remove();
            });
            mount.append(toast);
        }

        const meta = STATUS_META[status] || STATUS_META['not-started'];
        toast.className = meta.tone || 'neutral';
        toast.dataset.signature = signature;
        toast.title = status === 'success' ? '点击关闭，或今日不再提示' : '点击关闭';
        toast.innerHTML = '';

        const dot = document.createElement('span');
        dot.className = 'bbs-sign-page-toast-dot';
        const main = document.createElement('div');
        main.className = 'bbs-sign-page-toast-main';
        const title = document.createElement('div');
        title.className = 'bbs-sign-page-toast-title';
        title.textContent = getPageSignToastTitle(status);
        const messageNode = document.createElement('div');
        messageNode.className = 'bbs-sign-page-toast-message';
        messageNode.textContent = message;
        const actions = document.createElement('div');
        actions.className = 'bbs-sign-page-toast-actions';
        if (status === 'success') {
            const suppressButton = document.createElement('button');
            suppressButton.className = 'bbs-sign-page-toast-suppress';
            suppressButton.type = 'button';
            suppressButton.textContent = '今日不再提示';
            suppressButton.addEventListener('click', (event) => {
                event.stopPropagation();
                suppressPageSignToastToday(key);
                dismissedPageSignToastSignature = signature;
                toast.remove();
            });
            actions.append(suppressButton);
        }
        const hint = document.createElement('div');
        hint.className = 'bbs-sign-page-toast-hint';
        if (autoCloseAfterMs > 0) {
            const seconds = Math.ceil(autoCloseAfterMs / 1000);
            hint.textContent = completedToastCount
                ? `${seconds}秒后关闭 · 今日 ${completedToastCount}/${PAGE_COMPLETED_TOAST_DAILY_LIMIT}`
                : `${seconds}秒后关闭`;
        } else {
            hint.textContent = '点击关闭';
        }
        actions.append(hint);

        main.append(title, messageNode);
        toast.append(dot, main, actions);

        if (autoCloseAfterMs > 0) {
            pageSignToastAutoCloseTimer = setTimeout(() => {
                const currentToast = document.getElementById('bbs-sign-page-toast');
                if (currentToast?.dataset.signature === signature) {
                    currentToast.remove();
                }
                pageSignToastAutoCloseTimer = null;
            }, autoCloseAfterMs);
        }
    }

    function getRawTargetStatus(key) {
        const today = getToday();
        const scopedValue = GM_getValue(getTargetStatusStorageKey(today, key));
        if (scopedValue && typeof scopedValue === 'object' && !Array.isArray(scopedValue)) {
            return scopedValue;
        }
        const store = getStatusStore();
        const todayStatus = store[today] || {};
        return todayStatus[key] || null;
    }

    function getNormalizedTargetStatus(target) {
        if (!target.enabled) {
            return {
                status: 'disabled',
                stage: 'config',
                message: STATUS_META.disabled.message,
                updatedAt: '',
                attemptCount: 0
            };
        }

        const raw = getRawTargetStatus(target.id);
        if (raw?.stage === 'manual' && raw.status !== 'success') return raw;

        if (target.siteKey && getData(target.siteKey) === getToday()) {
            const rawSuccess = raw?.status === 'success' ? raw : null;
            return {
                status: 'success',
                stage: rawSuccess?.stage || 'legacy',
                message: rawSuccess?.message || '从既有签到记录同步为成功',
                updatedAt: rawSuccess?.updatedAt || raw?.updatedAt || '',
                url: rawSuccess?.url || raw?.url || target.url,
                attemptCount: raw?.attemptCount || 0
            };
        }

        if (raw) return raw;

        return {
            status: 'not-started',
            stage: '',
            message: STATUS_META['not-started'].message,
            updatedAt: '',
            url: target.url,
            attemptCount: 0
        };
    }

    function isLimestartHost(host = location.hostname) {
        return host === 'limestart.cn' || host === 'www.limestart.cn';
    }

    function isCurrentPageForSite(key) {
        const site = siteConfigs.find(item => item.key === key);
        return Boolean(site && site.matches.some(domain => location.hostname.includes(domain)));
    }

    function getAutoClosePendingStorageKey(key) {
        return getScopedStorageKey(STORAGE_KEYS.autoClosePending, key);
    }

    function markPendingAutoCloseAfterSignAction(key, source = 'action') {
        const config = getDashboardConfig();
        if (!config.preferences.autoClosePageAfterSign) return;
        if (isLimestartHost() || !isCurrentPageForSite(key)) return;
        GM_setValue(getAutoClosePendingStorageKey(key), {
            date: getToday(),
            source,
            url: location.href,
            expiresAt: Date.now() + AUTO_CLOSE_PENDING_TTL_MS
        });
    }

    function markPendingAutoCloseAfterDashboardLaunch(target) {
        const key = target?.siteKey;
        if (!key || !AUTO_CLOSE_AFTER_LAUNCH_SITE_KEYS.has(key)) return;
        const config = getDashboardConfig();
        if (!config.preferences.autoClosePageAfterSign) return;
        GM_setValue(getAutoClosePendingStorageKey(key), {
            date: getToday(),
            source: 'dashboard-launch',
            url: target.url,
            expiresAt: Date.now() + AUTO_CLOSE_PENDING_TTL_MS
        });
    }

    function consumePendingAutoCloseAfterSignAction(key) {
        const storageKey = getAutoClosePendingStorageKey(key);
        const pending = GM_getValue(storageKey);
        if (!pending || typeof pending !== 'object' || Array.isArray(pending)) {
            if (pending) GM_setValue(storageKey, '');
            return false;
        }

        const isValid = pending.date === getToday() &&
            Number(pending.expiresAt || 0) > Date.now();
        GM_setValue(storageKey, '');
        return isValid;
    }

    function maybeAutoClosePageAfterSign(key, options = {}) {
        const hasPendingAction = consumePendingAutoCloseAfterSignAction(key);
        const shouldClose = options.closePageAfterSignAction === true || hasPendingAction;
        if (!shouldClose) return;
        const config = getDashboardConfig();
        if (!config.preferences.autoClosePageAfterSign) return;
        if (isLimestartHost() || !isCurrentPageForSite(key)) return;

        console.log(`[签到助手] ${key} 本次签到动作已完成，准备自动关闭页面。`);
        setTimeout(() => {
            try {
                window.close();
            } catch (err) {
                console.log('[签到助手] 自动关闭页面失败，可能是浏览器限制。', err);
            }
        }, 800);
    }

    function safeUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
        } catch (e) {
            return '';
        }
        return '';
    }

    function truncateDebugText(value, limit = DEBUG_LOG_TEXT_LIMIT) {
        const text = String(value || '');
        if (text.length <= limit) return text;
        return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
    }

    function redactDebugText(value) {
        return String(value || '')
            .replace(/(^|\r?\n)(set-cookie\s*:\s*)[^\r\n]*/gi, '$1$2[REDACTED]')
            .replace(/("(?:[^"\\]|\\.)*(?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey)(?:[^"\\]|\\.)*"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
            .replace(/((?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
            .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
    }

    function stringifyDebugError(error) {
        if (!error) return '';
        if (typeof error === 'string') return redactDebugText(error);
        if (error.message) return redactDebugText(error.message);
        try {
            return truncateDebugText(redactDebugText(JSON.stringify(error)));
        } catch (err) {
            return redactDebugText(String(error));
        }
    }

    function sanitizeDebugUrl(value) {
        try {
            const url = new URL(String(value), location.href);
            for (const key of Array.from(url.searchParams.keys())) {
                if (DEBUG_SENSITIVE_KEY_RE.test(key)) {
                    url.searchParams.set(key, '[REDACTED]');
                }
            }
            return url.href;
        } catch (err) {
            return truncateDebugText(redactDebugText(value), 1000);
        }
    }

    function normalizeDebugHeaderValue(value, key = '') {
        if (DEBUG_SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
        return truncateDebugText(redactDebugText(value), 1000);
    }

    function debugHeadersToObject(headers) {
        const result = {};
        if (!headers) return result;
        try {
            const normalized = new Headers(headers);
            normalized.forEach((value, key) => {
                result[key] = normalizeDebugHeaderValue(value, key);
            });
        } catch (err) {
            if (headers && typeof headers === 'object') {
                for (const [key, value] of Object.entries(headers)) {
                    result[key] = normalizeDebugHeaderValue(value, key);
                }
            }
        }
        return result;
    }

    function debugBodyToText(body) {
        if (body === undefined || body === null) return '';
        const tag = Object.prototype.toString.call(body);
        if (typeof body === 'string') return truncateDebugText(redactDebugText(body));
        if (tag === '[object URLSearchParams]') return truncateDebugText(redactDebugText(body.toString()));
        if (tag === '[object FormData]') {
            const data = {};
            body.forEach((value, key) => {
                if (DEBUG_SENSITIVE_KEY_RE.test(key)) {
                    data[key] = '[REDACTED]';
                } else if (Object.prototype.toString.call(value) === '[object File]' || Object.prototype.toString.call(value) === '[object Blob]') {
                    data[key] = `[File type=${value.type || 'unknown'} size=${value.size}]`;
                } else {
                    data[key] = truncateDebugText(redactDebugText(value), 1000);
                }
            });
            return truncateDebugText(JSON.stringify(data));
        }
        if (tag === '[object Blob]' || tag === '[object File]') return `[${tag.slice(8, -1)} type=${body.type || 'unknown'} size=${body.size}]`;
        if (tag === '[object ArrayBuffer]') return `[ArrayBuffer byteLength=${body.byteLength}]`;
        if (ArrayBuffer.isView(body)) return `[${body.constructor?.name || 'TypedArray'} byteLength=${body.byteLength}]`;
        try {
            return truncateDebugText(redactDebugText(JSON.stringify(body)));
        } catch (err) {
            return `[${tag}]`;
        }
    }

    function getDebugResponseHeaderText(response) {
        return String(response?.responseHeaders || '');
    }

    function decodeDebugArrayBuffer(buffer, headers = '') {
        if (!buffer) return '';
        const encoding = /gbk|gb2312/i.test(headers) ? 'gbk' : 'utf-8';
        try {
            return new TextDecoder(encoding).decode(buffer);
        } catch (err) {
            try {
                return new TextDecoder().decode(buffer);
            } catch (fallbackErr) {
                return `[ArrayBuffer byteLength=${buffer.byteLength || 0}]`;
            }
        }
    }

    function getDebugGmResponseText(response) {
        if (response?.response instanceof ArrayBuffer) {
            return truncateDebugText(redactDebugText(decodeDebugArrayBuffer(response.response, getDebugResponseHeaderText(response))));
        }
        if (typeof response?.responseText === 'string') {
            return truncateDebugText(redactDebugText(response.responseText));
        }
        return '';
    }

    function startSignDebugCapture(siteKey, siteName, mode) {
        const context = {
            siteKey,
            siteName,
            mode,
            pageUrl: sanitizeDebugUrl(location.href),
            startedAt: getLocalDateTimeWithOffset(),
            parent: activeSignDebugContext,
            finished: false,
            entries: []
        };
        activeSignDebugContext = context;
        return context;
    }

    function finishSignDebugCapture(context) {
        context.finished = true;
        if (activeSignDebugContext === context) {
            let parent = context.parent || null;
            while (parent?.finished) {
                parent = parent.parent || null;
            }
            activeSignDebugContext = parent;
        }
        delete context.parent;
    }

    function addSignDebugEntry(entry, context = activeSignDebugContext) {
        if (!context || context.finished || context.entries.length >= DEBUG_LOG_MAX_ENTRIES_PER_SESSION) return null;
        const item = {
            ...entry,
            pageUrl: sanitizeDebugUrl(location.href),
            time: getLocalDateTimeWithOffset()
        };
        context.entries.push(item);
        console.log('[签到助手调试]', item.type || 'entry', item.method || '', item.url || '', item.status ?? item.error ?? '');
        return item;
    }

    function pruneSignDebugLogs(logs) {
        const cutoff = Date.now() - DEBUG_LOG_RETENTION_MS;
        return (Array.isArray(logs) ? logs : [])
            .filter(item => {
                const time = new Date(item.savedAt || item.startedAt || 0).getTime();
                return Number.isFinite(time) && time >= cutoff;
            })
            .slice(-DEBUG_LOG_MAX_SESSIONS);
    }

    function persistSignDebugFailure(context, reason = {}) {
        if (!context) return;
        const logs = pruneSignDebugLogs(readArray(STORAGE_KEYS.signDebugLogs, []));
        logs.push({
            siteKey: context.siteKey,
            siteName: context.siteName,
            mode: context.mode,
            pageUrl: context.pageUrl,
            startedAt: context.startedAt,
            savedAt: getLocalDateTimeWithOffset(),
            reason,
            entries: context.entries
        });
        writeObject(STORAGE_KEYS.signDebugLogs, pruneSignDebugLogs(logs));
    }

    function buildSignDebugExport() {
        const logs = pruneSignDebugLogs(readArray(STORAGE_KEYS.signDebugLogs, []));
        writeObject(STORAGE_KEYS.signDebugLogs, logs);
        return {
            tool: 'BBSSignHelperDebugLogs',
            exportedAt: getLocalDateTimeWithOffset(),
            retentionDays: 3,
            logs
        };
    }

    function downloadSignDebugLogs() {
        const text = JSON.stringify(buildSignDebugExport(), null, 2);
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bbs-sign-debug-${getLocalDateTimeWithOffset().replace(/[:.]/g, '-')}.json`;
        link.style.display = 'none';
        (document.body || document.documentElement).append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function clearSignDebugLogs() {
        writeObject(STORAGE_KEYS.signDebugLogs, []);
        console.log('[签到助手调试] 已清空失败请求调试日志');
    }

    // 等待元素出现 (替代原先的 setInterval 轮询)
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve) => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }
            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    // 延时函数
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    const SIGN_RECHECK_SCHEDULE = [
        { durationMs: 30000, intervalMs: 1000 },
        { durationMs: 60000, intervalMs: 3000 }
    ];

    function isSignSuccessRecorded(key) {
        return getData(key) === getToday() || getRawTargetStatus(key)?.status === 'success';
    }

    async function waitForSiteSuccessRecheck(site) {
        const startedAt = Date.now();
        let elapsedBeforePhase = 0;
        for (const phase of SIGN_RECHECK_SCHEDULE) {
            const phaseEndAt = startedAt + elapsedBeforePhase + phase.durationMs;
            while (Date.now() < phaseEndAt) {
                await delay(Math.min(phase.intervalMs, Math.max(0, phaseEndAt - Date.now())));

                if (isSignSuccessRecorded(site.key)) return true;

                const urlBeforeRun = location.href;
                try {
                    const isSuccess = await site.run();
                    if (isSuccess) {
                        if (getData(site.key) !== getToday()) {
                            markSignSuccess(site.key, '复查确认签到成功');
                        }
                        return true;
                    }
                    if (isSignSuccessRecorded(site.key)) return true;
                } catch (err) {
                    console.log(`[签到助手] ${site.name} 复查时发生异常:`, err);
                }

                if (location.href !== urlBeforeRun) {
                    return isSignSuccessRecorded(site.key);
                }
            }
            elapsedBeforePhase += phase.durationMs;
        }
        return false;
    }

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('当前脚本管理器不支持 GM_xmlhttpRequest'));
                return;
            }
            const method = details.method || 'GET';
            const startedAt = Date.now();
            const debugEntry = addSignDebugEntry({
                type: 'gmRequest',
                method,
                url: sanitizeDebugUrl(details.url),
                requestHeaders: debugHeadersToObject(details.headers || {}),
                requestBody: debugBodyToText(details.data),
                responseType: details.responseType || 'text',
                status: 'pending'
            }, details.debugContext || activeSignDebugContext);
            GM_xmlhttpRequest({
                method,
                url: details.url,
                headers: details.headers || {},
                data: details.data,
                responseType: details.responseType || 'text',
                anonymous: false,
                withCredentials: true,
                onload: (response) => {
                    if (debugEntry) {
                        debugEntry.status = response.status;
                        debugEntry.finalUrl = sanitizeDebugUrl(response.finalUrl || details.url);
                        debugEntry.responseHeaders = truncateDebugText(redactDebugText(getDebugResponseHeaderText(response)), 3000);
                        debugEntry.response = getDebugGmResponseText(response);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    resolve(response);
                },
                onerror: (err) => {
                    if (debugEntry) {
                        debugEntry.status = 'error';
                        debugEntry.error = stringifyDebugError(err);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    reject(err);
                },
                ontimeout: (err) => {
                    if (debugEntry) {
                        debugEntry.status = 'timeout';
                        debugEntry.error = stringifyDebugError(err);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    reject(err);
                }
            });
        });
    }

    async function debugPageFetch(label, fetchFn, url, options = {}, debugContext = activeSignDebugContext) {
        const startedAt = Date.now();
        const method = options.method || 'GET';
        const debugEntry = addSignDebugEntry({
            type: 'pageFetch',
            label,
            method,
            url: sanitizeDebugUrl(url),
            requestHeaders: debugHeadersToObject(options.headers || {}),
            requestBody: debugBodyToText(options.body),
            status: 'pending'
        }, debugContext);

        try {
            const response = await fetchFn(url, options);
            if (debugEntry) {
                debugEntry.status = response.status;
                debugEntry.ok = response.ok;
                debugEntry.responseType = response.headers?.get?.('content-type') || '';
                debugEntry.durationMs = Date.now() - startedAt;
                if (DEBUG_TEXT_RESPONSE_RE.test(debugEntry.responseType)) {
                    try {
                        const text = await response.clone().text();
                        debugEntry.response = truncateDebugText(redactDebugText(text));
                    } catch (err) {
                        debugEntry.responseError = err?.message || String(err);
                    }
                } else {
                    debugEntry.response = debugEntry.responseType ? `[${debugEntry.responseType} body omitted]` : '[body omitted]';
                }
            }
            return response;
        } catch (err) {
            if (debugEntry) {
                debugEntry.status = 'error';
                debugEntry.error = stringifyDebugError(err);
                debugEntry.durationMs = Date.now() - startedAt;
            }
            throw err;
        }
    }

    function extractCdata(text) {
        const match = String(text || '').match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
        return match ? match[1] : String(text || '');
    }

    function readFormFieldsFromHtml(html, selector) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector(selector);
        if (!form) return null;

        const params = new URLSearchParams();
        form.querySelectorAll('input, textarea, select').forEach(el => {
            const name = el.getAttribute('name');
            if (!name) return;
            let value = el.getAttribute('value') || '';
            if (el.tagName === 'TEXTAREA') {
                value = el.value || el.textContent || value;
            } else if (el.tagName === 'SELECT') {
                const selected = el.querySelector('option[selected]') || el.querySelector('option');
                value = selected?.getAttribute('value') || value;
            }
            params.set(name, value);
        });
        return params;
    }

    async function runFeixueApiSign(debugContext) {
        const modalRes = await gmRequest({
            url: 'https://feixueacg.org/plugin.php?id=dc_signin:sign&infloat=yes&handlekey=sign&inajax=1&ajaxtarget=fwin_content_sign',
            debugContext
        });
        const modalHtml = extractCdata(modalRes.responseText);

        if (/尚未登录|请先登录|member\.php\?mod=logging&action=login/.test(modalHtml)) {
            recordTargetStatus('fxacg', 'needs-login', {
                stage: 'login',
                message: '飞雪论坛需要先登录账号',
                url: 'https://feixueacg.org/plugin.php?id=dc_signin'
            });
            return false;
        }
        if (/已签到|已经签到|今日已/.test(modalHtml)) {
            return completeSign('fxacg', '接口返回今日已签到');
        }

        const params = readFormFieldsFromHtml(modalHtml, '#signform');
        if (!params) {
            console.log('[飞雪论坛] 未找到签到表单');
            return false;
        }

        params.set('signsubmit', params.get('signsubmit') || 'yes');
        params.set('handlekey', params.get('handlekey') || 'signin');
        params.set('emotid', params.get('emotid') || '3');
        params.set('referer', params.get('referer') || 'https://feixueacg.org/');
        params.set('content', params.get('content') || '为了维护宇宙和平，打起精神来！~~');

        const submitRes = await gmRequest({
            method: 'POST',
            url: 'https://feixueacg.org/plugin.php?id=dc_signin:sign&inajax=1',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: params.toString(),
            debugContext
        });
        const submitText = submitRes.responseText || '';

        if (/签到成功|随机奖励|succeedhandle_signin/.test(submitText)) {
            return completeSign('fxacg', '接口返回签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (/已签到|已经签到|今日已/.test(submitText)) {
            return completeSign('fxacg', '接口返回今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (/尚未登录|请先登录|member\.php\?mod=logging&action=login/.test(submitText)) {
            recordTargetStatus('fxacg', 'needs-login', {
                stage: 'login',
                message: '飞雪论坛需要先登录账号',
                url: 'https://feixueacg.org/plugin.php?id=dc_signin'
            });
            return false;
        }

        console.log('[飞雪论坛] 签到接口未返回成功标记', submitText);
        return false;
    }

    async function runSouthPlusApiSign(debugContext) {
        let completedByAction = false;
        const fetchTask = async (id) => {
            let res = await gmRequest({
                url: `https://www.south-plus.net/plugin.php?H_name=tasks&action=ajax&actions=job&cid=${id}`,
                debugContext
            });
            let text = res.responseText || '';
            if (text.includes('还没超过')) {
                console.log(`[南+] 任务${id} 刷新时间未到`);
                return true;
            }
            if (text.includes('已经申请')) {
                completedByAction = true;
                res = await gmRequest({
                    url: `https://www.south-plus.net/plugin.php?H_name=tasks&action=ajax&actions=job2&cid=${id}`,
                    debugContext
                });
                text = res.responseText || '';
                if (text.includes('已经完成')) {
                    console.log(`[南+] 成功完成任务${id}`);
                    return true;
                }
            }
            console.log(`[南+] 任务${id}提交异常`, text);
            return false;
        };

        const [w14, w15] = await Promise.all([
            fetchTask('14'),
            fetchTask('15')
        ]);
        if (w14 && w15) {
            return completeSign(
                'southplus',
                '接口返回任务已完成',
                completedByAction ? CLOSE_PAGE_AFTER_SIGN_ACTION : {}
            );
        }
        return false;
    }

    async function runSlAsmrApiSign(debugContext) {
        const res = await gmRequest({
            method: 'POST',
            url: 'https://www.sl-asmr.com/api/mission/fast',
            debugContext
        });
        const text = res.responseText || '';
        if (text.includes('签到成功')) {
            return completeSign('sl-asmr', '接口返回签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (text.includes('您已签到')) {
            return completeSign('sl-asmr', '接口返回今日已签到');
        }
        console.log('[夜世界] 签到接口异常', text);
        return false;
    }

    async function runKfpromaxApiSign(debugContext) {
        const isKfpromaxPage = location.hostname === 'bbs.kfpromax.com';
        const decodePageText = (buffer, headers = '') => {
            const encoding = /gbk|gb2312/i.test(headers) ? 'gbk' : 'utf-8';
            try {
                return new TextDecoder(encoding).decode(buffer);
            } catch (err) {
                return new TextDecoder().decode(buffer);
            }
        };
        const requestPage = async (url) => {
            const targetUrl = new URL(url, 'https://bbs.kfpromax.com/').href;
            if (isKfpromaxPage) {
                const pageFetch = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function'
                    ? unsafeWindow.fetch.bind(unsafeWindow)
                    : window.fetch.bind(window);
                const response = await debugPageFetch('kfpromax-page', pageFetch, targetUrl, {
                    credentials: 'include',
                    headers: {
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                }, debugContext);
                const contentType = response.headers?.get?.('content-type') || '';
                const buffer = await response.arrayBuffer();
                return {
                    status: response.status,
                    url: response.url || targetUrl,
                    text: decodePageText(buffer, contentType)
                };
            }

            const response = await gmRequest({
                url: targetUrl,
                responseType: 'arraybuffer',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                debugContext
            });
            const contentType = response.responseHeaders || '';
            let text = '';
            try {
                text = decodePageText(response.response, contentType);
            } catch (err) {
                text = response.responseText || new TextDecoder().decode(response.response);
            }
            return { status: response.status, url: response.finalUrl || targetUrl, text };
        };
        const isLoggedInPage = (text) => /login\.php\?action=quit|id=["']kf_topuser|id=["']kf_information|profile\.php\?action=show(?:&amp;|&)uid=/i.test(text);
        const isLoginPage = (text) => !isLoggedInPage(text) && (
            /<form[^>]+action=["'][^"']*login\.php|name=["']?pwpwd|您还没有登录|请先登录/.test(text)
        );

        const growthPage = await requestPage('https://bbs.kfpromax.com/kf_growup.php');
        if (isLoginPage(growthPage.text)) {
            recordTargetStatus('kfpromax', 'needs-login', {
                stage: 'login',
                message: '绯月需要先登录账号',
                url: growthPage.url
            });
            return false;
        }
        if (/领取成功|请明天继续|已经领过了|已领过/.test(growthPage.text)) {
            return completeSign('kfpromax', '页面显示成长奖励已领取');
        }

        const hrefMatch = growthPage.text.match(/href=["']([^"']*kf_growup\.php\?ok=3(?:&amp;|&)safeid=[^"']+)["']/i);
        const safeidMatch = growthPage.text.match(/kf_growup\.php\?ok=3(?:&amp;|&)safeid=([a-z0-9]+)/i);
        const signPath = hrefMatch?.[1]?.replace(/&amp;/g, '&') ||
            (safeidMatch ? `kf_growup.php?ok=3&safeid=${safeidMatch[1]}` : '');

        if (!signPath) {
            console.log('[绯月] 未找到成长奖励领取链接');
            return false;
        }

        const signPage = await requestPage(signPath);
        if (/领取成功|请明天继续|已经领过了|已领过/.test(signPage.text)) {
            return completeSign('kfpromax', '成长奖励接口返回领取成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (isLoginPage(signPage.text)) {
            recordTargetStatus('kfpromax', 'needs-login', {
                stage: 'login',
                message: '绯月登录状态失效，需要重新登录',
                url: signPage.url
            });
            return false;
        }

        console.log('[绯月] 成长奖励接口未返回成功标记', signPage.text);
        return false;
    }

    async function runSijisheApiSign(debugContext) {
        const requestText = async (url) => {
            const response = await gmRequest({
                url: new URL(url, 'https://sjs47.com/').href,
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                debugContext
            });
            return response.responseText || '';
        };

        const pageText = await requestText('https://sjs47.com/k_misign-sign.html');
        const uid = pageText.match(/discuz_uid\s*=\s*['"]?(\d+)['"]?/i)?.[1] || '';
        const hasLogoutLink = /member\.php\?mod=logging(?:&amp;|&)action=logout/i.test(pageText);
        if ((!uid || uid === '0') && !hasLogoutLink) {
            recordTargetStatus('sijishe', 'needs-login', {
                stage: 'login',
                message: '司机社需要先登录账号',
                url: 'https://sjs47.com/k_misign-sign.html'
            });
            return false;
        }

        if (/btnvisted|今日已签到|已经签到|您今日已经签到|已签到/.test(pageText)) {
            return completeSign('sijishe', '页面显示今日已签到');
        }

        const hrefMatch = pageText.match(/id=["']JD_sign["'][\s\S]*?href=["']([^"']+)["']/i) ||
            pageText.match(/href=["']([^"']*plugin\.php\?id=k_misign(?::|%3A)sign[^"']*operation=qiandao[^"']*)["']/i);
        const signPath = hrefMatch?.[1]?.replace(/&amp;/g, '&') || '';
        if (!signPath) {
            console.log('[司机社] 未找到签到链接');
            return false;
        }

        const signUrl = new URL(signPath, 'https://sjs47.com/');
        signUrl.searchParams.set('inajax', '1');
        signUrl.searchParams.set('ajaxtarget', 'JD_sign');
        await requestText(signUrl.href);

        const rankText = await requestText('https://sjs47.com/plugin.php?id=k_misign:sign&operation=list&inajax=1&ajaxtarget=ranklist');
        const uidPattern = new RegExp(`home\\.php\\?mod=space(?:&amp;|&)uid=${uid}[\\s\\S]{0,500}${getToday()}`);
        if (uidPattern.test(rankText)) {
            return completeSign('sijishe', '今日排行已确认签到记录', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        const verifyText = await requestText('https://sjs47.com/k_misign-sign.html');
        if (/btnvisted|今日已签到|已经签到|您今日已经签到|已签到/.test(verifyText)) {
            return completeSign('sijishe', '页面复查确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        console.log('[司机社] 签到接口未确认成功', rankText);
        return false;
    }

    async function runUuGgPageSign() {
        await delay(1200);

        const html = document.documentElement?.innerHTML || '';
        const bodyText = document.body?.innerText || '';
        const pageText = `${document.title || ''}\n${bodyText}`;
        const isSignPage = (() => {
            try {
                const url = new URL(location.href);
                return url.pathname.endsWith('/plugin.php') && url.searchParams.get('id') === 'dsu_paulsign:sign';
            } catch (err) {
                return /plugin\.php\?id=dsu_paulsign(?::|%3A)sign/i.test(location.href);
            }
        })();

        const hasExpectedUuGgContent = /今天签到了吗|写下今天最想说的话|开始签到|签到排行榜|签到服务台|签到中心|今日已签到/.test(pageText) ||
            Boolean(document.querySelector('#qiandao, form[name="qiandao"], input[name="qdxq"], input[name="todaysay"], textarea[name="todaysay"], a[href*="dsu_paulsign"]'));
        const hasCloudflareChallengeText = /Just a moment|Enable JavaScript and cookies to continue/i.test(pageText);
        const hasCloudflareChallengeMarkup = /_cf_chl_opt|cf-challenge|challenge-platform/i.test(html);

        if (!hasExpectedUuGgContent && (hasCloudflareChallengeText || hasCloudflareChallengeMarkup)) {
            recordTargetStatus('uugg', 'needs-foreground', {
                stage: 'cloudflare',
                message: '有叽叽论坛被 Cloudflare 验证页拦截，可能需要前台打开完成验证',
                url: location.href
            });
            return false;
        }

        const rawUid = typeof unsafeWindow !== 'undefined' ? unsafeWindow.discuz_uid : '';
        const uid = rawUid && rawUid !== '0'
            ? String(rawUid)
            : (html.match(/discuz_uid\s*=\s*['"]?(\d+)['"]?/i)?.[1] || '');
        const hasLogoutLink = Boolean(document.querySelector('a[href*="member.php?mod=logging"][href*="action=logout"]'));
        const hasLoginForm = Boolean(document.querySelector('#lsform, #ls_username, input[name="username"][id="ls_username"]'));
        const loginTextOnly = /请先登录|登录后|member\.php\?mod=logging(?:&amp;|&)action=login/i.test(pageText);

        if ((!uid || uid === '0') && !hasLogoutLink && (hasLoginForm || loginTextOnly)) {
            recordTargetStatus('uugg', 'needs-login', {
                stage: 'login',
                message: '有叽叽论坛需要先登录账号',
                url: location.href
            });
            return false;
        }

        if (!isSignPage) {
            window.location.href = 'https://www.uu-gg.one/plugin.php?id=dsu_paulsign:sign';
            return false;
        }

        const pageFetch = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function'
            ? unsafeWindow.fetch.bind(unsafeWindow)
            : window.fetch.bind(window);
        const readUuGgResponseText = async (response) => {
            const contentType = response.headers?.get?.('content-type') || '';
            const encoding = /gbk|gb2312/i.test(contentType) ? 'gbk' : 'utf-8';
            const buffer = await response.arrayBuffer();
            try {
                return new TextDecoder(encoding).decode(buffer);
            } catch (err) {
                return new TextDecoder().decode(buffer);
            }
        };
        const signForm = document.querySelector('#qiandao, form[name="qiandao"]');
        const hasSignForm = Boolean(signForm || document.querySelector('input[name="qdxq"], input[name="todaysay"], textarea[name="todaysay"], a[href*="operation=qiandao"]')) ||
            /今天签到了吗|写下今天最想说的话|我要签到|立即签到/.test(pageText);
        const getSignServiceText = (text) => {
            const signServiceIndex = text.indexOf('签到服务台');
            return signServiceIndex >= 0 ? text.slice(signServiceIndex, signServiceIndex + 900) : '';
        };
        const signedStateRe = /今天已签到|今日已签到|您今天已经签到|您今日已经签到/;
        const unsignedStateRe = /今天未签到|今日未签到/;
        const signSuccessMessageRe = /恭喜你签到成功|签到成功|获得随机奖励|获得[^<]*(?:叽币|奖励|积分)|已经签到过|签到过了|您今天已经签到|您今日已经签到/;
        const hasCurrentUserSignedRowInHtml = (sourceHtml) => uid && new RegExp(`home\\.php\\?mod=space(?:&amp;|&)uid=${uid}[\\s\\S]{0,800}(?:今天已签到|已签到|${getToday()})`).test(sourceHtml);
        const isConfirmedSignedPage = (text, sourceHtml) => {
            const serviceText = getSignServiceText(text);
            const hasUnsignedText = unsignedStateRe.test(serviceText);
            return !hasUnsignedText && (
                signedStateRe.test(serviceText) ||
                hasCurrentUserSignedRowInHtml(sourceHtml) ||
                signSuccessMessageRe.test(text)
            );
        };
        const fetchVerifyPage = async (label) => {
            const verifyUrl = new URL('plugin.php?id=dsu_paulsign:sign', location.href);
            verifyUrl.searchParams.set('_', String(Date.now()));
            const verifyResponse = await debugPageFetch(label, pageFetch, verifyUrl.href, {
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            const verifyHtml = await readUuGgResponseText(verifyResponse);
            const verifyDoc = new DOMParser().parseFromString(verifyHtml, 'text/html');
            const verifyPageText = `${verifyDoc.title || ''}\n${verifyDoc.body?.textContent || ''}`;
            return {
                html: verifyHtml,
                pageText: verifyPageText,
                signServiceText: getSignServiceText(verifyPageText)
            };
        };
        const verifySignedAfterSubmit = async (attemptCount = 1, firstDelayMs = 0) => {
            let lastSignServiceText = '';
            for (let i = 0; i < attemptCount; i++) {
                if (i === 0 && firstDelayMs) {
                    await delay(firstDelayMs);
                } else if (i > 0) {
                    await delay(Math.min(4000, 1000 + i * 1000));
                }
                const verifyPage = await fetchVerifyPage(`uugg-verify-page-${i + 1}`);
                lastSignServiceText = verifyPage.signServiceText;
                if (isConfirmedSignedPage(verifyPage.pageText, verifyPage.html)) {
                    return { confirmed: true, signServiceText: lastSignServiceText };
                }
            }
            return { confirmed: false, signServiceText: lastSignServiceText };
        };
        const signServiceText = getSignServiceText(pageText);
        const hasCurrentUserUnsignedText = unsignedStateRe.test(signServiceText);
        const hasCurrentUserSignedText = signedStateRe.test(signServiceText);
        if (hasCurrentUserUnsignedText && getData('uugg') === getToday()) {
            clearSignSuccess('uugg', '页面显示今天未签到，已清除错误的今日成功记录');
        }
        const hasCurrentUserSignedRow = hasCurrentUserSignedRowInHtml(html);
        const hasSignedMessage = signSuccessMessageRe.test(pageText);

        if (!hasCurrentUserUnsignedText && (hasCurrentUserSignedText || hasCurrentUserSignedRow || hasSignedMessage)) {
            return completeSign('uugg', '页面确认今日已签到');
        }

        if (signForm && !uuGgPageSubmitAttempted) {
            uuGgPageSubmitAttempted = true;
            const params = new URLSearchParams();
            signForm.querySelectorAll('input, textarea, select').forEach(el => {
                const name = el.getAttribute('name');
                if (!name || el.disabled) return;
                const type = String(el.type || '').toLowerCase();
                if ((type === 'checkbox' || type === 'radio') && !el.checked) return;
                let value = el.getAttribute('value') || el.value || '';
                if (el.tagName === 'TEXTAREA') {
                    value = el.value || el.textContent || value;
                } else if (el.tagName === 'SELECT') {
                    const selected = el.querySelector('option:checked') || el.querySelector('option');
                    value = selected?.value || selected?.getAttribute('value') || value;
                }
                params.set(name, value);
            });
            if (!params.get('qdxq')) params.set('qdxq', 'wl');

            if (!params.get('formhash')) {
                console.log('[有叽叽论坛] 未找到签到 formhash');
                recordTargetStatus('uugg', 'needs-foreground', {
                    stage: 'formhash',
                    message: '有叽叽论坛未找到签到 formhash，可能需要前台刷新签到页',
                    url: location.href
                });
                return false;
            }

            const signUrl = new URL(
                signForm.getAttribute('action') || 'plugin.php?id=dsu_paulsign:sign&operation=qiandao&infloat=1&inajax=1',
                location.href
            );
            signUrl.searchParams.set('operation', 'qiandao');
            signUrl.searchParams.set('infloat', '1');
            signUrl.searchParams.set('inajax', '1');
            recordTargetStatus('uugg', 'running', {
                stage: 'page-api',
                message: '正在从有叽叽页面内提交签到请求',
                url: signUrl.href,
                incrementAttempt: true
            });

            const response = await debugPageFetch('uugg-page-sign', pageFetch, signUrl.href, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: params.toString()
            });
            const resultText = extractCdata(await readUuGgResponseText(response));
            if (signSuccessMessageRe.test(resultText)) {
                return completeSign('uugg', '页面内 API 返回签到成功或今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
            }
            if (/请先登录|登录后|member\.php\?mod=logging(?:&amp;|&)action=login/i.test(resultText)) {
                recordTargetStatus('uugg', 'needs-login', {
                    stage: 'login',
                    message: '有叽叽论坛登录状态失效，需要重新登录',
                    url: location.href
                });
                return false;
            }

            const verifyResult = await verifySignedAfterSubmit(5, 1000);
            if (verifyResult.confirmed) {
                return completeSign('uugg', '提交后复查确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
            }
            if (unsignedStateRe.test(verifyResult.signServiceText)) {
                console.log('[有叽叽论坛] 提交后复查仍显示今天未签到', verifyResult.signServiceText);
            }
            console.log('[有叽叽论坛] 页面内签到接口未确认成功', resultText);
            recordTargetStatus('uugg', 'needs-foreground', {
                stage: 'page-api',
                message: '页面内签到请求已提交，但未确认成功，请前台检查结果',
                url: location.href
            });
            return false;
        }

        if (uuGgPageSubmitAttempted) {
            const verifyResult = await verifySignedAfterSubmit(1);
            if (verifyResult.confirmed) {
                return completeSign('uugg', '后续复查确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
            }
        }

        console.log('[有叽叽论坛] 已打开签到页，等待页面内签到结果确认');
        return false;
    }

    async function runAcgndogApiSign() {
        const checkAction = 'd2e5b56b75e2f3d4ab412a6d9561faee';
        const signAction = '5ced0113734a2bc46ecf3f30b0685b7b';
        const pageFetch = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function'
            ? unsafeWindow.fetch.bind(unsafeWindow)
            : window.fetch.bind(window);
        const withCacheBust = (url) => {
            const targetUrl = new URL(url);
            targetUrl.searchParams.set('_', String(Date.now()));
            return targetUrl.href;
        };
        const requestText = async (url, label = 'acgndog-api') => {
            const response = await debugPageFetch(label, pageFetch, withCacheBust(url), {
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json'
                }
            });
            return await response.text();
        };
        const parseApiJson = (text, label) => {
            try {
                return JSON.parse(text || '{}');
            } catch (err) {
                console.log(`[次元狗] ${label}返回非 JSON`, text);
                return null;
            }
        };
        const isSignedPayload = (payload) => {
            const signedValue = payload?.customPointSignDaily?.signed ?? payload?.data?.customPointSignDaily?.signed;
            return signedValue === true || signedValue === 1 || signedValue === '1' || signedValue === 'true';
        };
        const requestCheckJson = async (label = 'acgndog-check') => {
            const checkText = await requestText(
                `https://www.acgndog.com/wp-admin/admin-ajax.php?action=${checkAction}&${signAction}%5Btype%5D=checkSigned`,
                label
            );
            return parseApiJson(checkText, '签到状态接口');
        };

        const checkJson = await requestCheckJson('acgndog-check-before');
        if (!checkJson) return false;

        if (!checkJson.user || checkJson.user.isLoggedIn === false) {
            recordTargetStatus('acgndog', 'needs-login', {
                stage: 'login',
                message: '次元狗需要先登录账号',
                url: 'https://www.acgndog.com/'
            });
            return false;
        }
        if (!checkJson._nonce) {
            console.log('[次元狗] 未获取到签到 nonce', checkJson);
            return false;
        }
        if (isSignedPayload(checkJson)) {
            return completeSign('acgndog', '接口返回今日已签到');
        }

        const signText = await requestText(
            `https://www.acgndog.com/wp-admin/admin-ajax.php?_nonce=${encodeURIComponent(checkJson._nonce)}&action=${signAction}&type=goSign`,
            'acgndog-go-sign'
        );
        const signJson = parseApiJson(signText, '签到接口');
        if (!signJson) return false;

        if (signJson.code === 0 && /签到成功|获得/.test(signJson.msg || '')) {
            for (let i = 0; i < 3; i++) {
                await delay(1000);
                const verifyJson = await requestCheckJson(`acgndog-check-after-${i + 1}`);
                if (verifyJson && isSignedPayload(verifyJson)) {
                    return completeSign('acgndog', signJson.msg || '提交后复查确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
                }
            }
            console.log('[次元狗] 签到接口返回成功，但复查未确认完成', signJson);
            recordTargetStatus('acgndog', 'failed', {
                stage: 'verify',
                message: '次元狗接口返回成功，但复查未确认今日已签到，请前台检查',
                url: 'https://www.acgndog.com/'
            });
            return false;
        }
        if (/已签到|已经签到|今日已/.test(signJson.msg || '')) {
            return completeSign('acgndog', signJson.msg || '接口返回今日已签到');
        }

        console.log('[次元狗] API 返回异常:', signJson);
        return false;
    }

    function collectVikAuthTokensFromValue(value, keyHint = '', tokens = []) {
        if (!value) return tokens;
        const text = String(value).trim();
        const addToken = (token) => {
            const normalized = normalizeVikAuthToken(token);
            if (normalized && !tokens.includes(normalized)) {
                tokens.push(normalized);
            }
        };

        for (const match of text.matchAll(/Bearer\s+[A-Za-z0-9._-]+/ig)) {
            addToken(match[0]);
        }

        for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
            addToken(match[0]);
        }

        const keyLooksAuth = /token|auth|jwt|authorization/i.test(keyHint);
        if (keyLooksAuth && /^[A-Za-z0-9._-]{80,400}$/.test(text)) {
            addToken(text);
        }

        try {
            const parsed = JSON.parse(text);
            collectVikAuthTokensFromObject(parsed, tokens);
        } catch (err) {
            // Ignore non-JSON storage values.
        }
        return tokens;
    }

    function collectVikAuthTokensFromObject(value, tokens = []) {
        if (!value || typeof value !== 'object') return tokens;
        if (Array.isArray(value)) {
            for (const item of value) {
                collectVikAuthTokensFromObject(item, tokens);
            }
            return tokens;
        }

        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string') {
                collectVikAuthTokensFromValue(item, key, tokens);
            } else if (item && typeof item === 'object') {
                collectVikAuthTokensFromObject(item, tokens);
            }
        }
        return tokens;
    }

    function getVikAuthTokens() {
        const storages = [
            window.localStorage,
            window.sessionStorage,
            typeof unsafeWindow !== 'undefined' ? unsafeWindow.localStorage : null,
            typeof unsafeWindow !== 'undefined' ? unsafeWindow.sessionStorage : null
        ].filter(Boolean);

        const entries = [];
        for (const storage of storages) {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key) continue;
                entries.push([key, storage.getItem(key)]);
            }
        }

        const tokens = [];
        for (const authKeyOnly of [true, false]) {
            for (const [key, value] of entries) {
                if (authKeyOnly && !/token|auth|jwt|authorization/i.test(key)) continue;
                collectVikAuthTokensFromValue(value, key, tokens);
            }
        }
        return tokens;
    }

    function normalizeVikAuthToken(token) {
        const text = String(token || '').trim();
        if (!text) return '';
        if (/^Bearer\s+/i.test(text)) return text;
        if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
            return `Bearer ${text}`;
        }
        return text;
    }

    function isVikAuthError(payload) {
        if (!payload || typeof payload !== 'object') return false;
        const message = `${payload.message || ''}${payload.statusMessage || ''}`;
        return payload.code === 401 ||
            payload.statusCode === 401 ||
            /登录|登陆|授权|令牌|token|unauthorized/i.test(message);
    }

    function isVikTodayTimestamp(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return false;
        const timestamp = raw < 1e12 ? raw * 1000 : raw;
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return false;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}` === getToday();
    }

    async function runVikApiSign() {
        if (!location.href.includes('wallet/mission')) {
            console.log('[维咔] 前往任务页');
            window.location.href = '/wallet/mission';
            return false;
        }

        const authTokens = getVikAuthTokens();
        if (!authTokens.length) {
            recordTargetStatus('vik', 'needs-login', {
                stage: 'login',
                message: '维咔需要先登录账号，或前台打开一次任务页刷新登录凭据',
                url: location.href
            });
            return false;
        }

        const pageFetch = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function'
            ? unsafeWindow.fetch.bind(unsafeWindow)
            : window.fetch.bind(window);

        const requestApi = async (path, payload, authToken) => {
            const headers = {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Architecture: 'AixPot',
                'Client-Country-Access': 'US',
                'Client-Country-Origin': 'US',
                'X-Client-Name': 'VikACG Moonlight'
            };
            if (authToken) {
                headers.Authorization = authToken;
            }
            const requestUrl = `https://www.vikacg.com/api/vikacg/v1/${path}`;
            const res = await debugPageFetch(`vik-${path}`, pageFetch, requestUrl, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            try {
                return JSON.parse(text || '{}');
            } catch (err) {
                console.log(`[维咔] ${path} 接口返回非 JSON`, text);
                return null;
            }
        };

        let authToken = '';
        let userInfo = null;
        let lastAuthError = null;
        for (const candidateToken of authTokens) {
            const candidateUserInfo = await requestApi('getUserInfo', { detail: true }, candidateToken);
            if (candidateUserInfo?.status === 'success' && candidateUserInfo.data?.basic?.id) {
                authToken = candidateToken;
                userInfo = candidateUserInfo;
                break;
            }
            if (isVikAuthError(candidateUserInfo)) {
                lastAuthError = candidateUserInfo;
                continue;
            }
            userInfo = candidateUserInfo;
            break;
        }
        if ((!userInfo || userInfo.status !== 'success' || !userInfo.data?.basic?.id) && lastAuthError) {
            const cookieUserInfo = await requestApi('getUserInfo', { detail: true }, '');
            if (cookieUserInfo?.status === 'success' && cookieUserInfo.data?.basic?.id) {
                authToken = '';
                userInfo = cookieUserInfo;
                lastAuthError = null;
            }
        }
        if (!userInfo || userInfo.status !== 'success' || !userInfo.data?.basic?.id) {
            if (lastAuthError || isVikAuthError(userInfo)) {
                recordTargetStatus('vik', 'needs-login', {
                    stage: 'login',
                    message: `维咔登录凭据已失效，${authTokens.length} 个候选令牌均未通过验证，请前台刷新任务页或重新登录`,
                    url: location.href
                });
                return false;
            }
            console.log('[维咔] 用户信息接口异常', userInfo);
            return false;
        }

        if (isVikTodayTimestamp(userInfo.data?.credit?.sign_time)) {
            return completeSign('vik', '接口返回今日已签到');
        }

        const signJson = await requestApi('userMission', {}, authToken);
        if (isVikAuthError(signJson)) {
            recordTargetStatus('vik', 'needs-login', {
                stage: 'login',
                message: '维咔登录凭据已失效，需要前台刷新任务页或重新登录',
                url: location.href
            });
            return false;
        }
        if (signJson?.status === 'success' && isVikTodayTimestamp(signJson.data?.sign_time)) {
            return completeSign('vik', `API 签到成功，连续 ${signJson.data?.sign_days || 0} 天`, CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (/已签到|已经签到|今日已/.test(signJson?.message || '')) {
            return completeSign('vik', signJson.message || '接口返回今日已签到');
        }

        const missionList = await requestApi('getMissionList', {
            paged: 1,
            page_count: 20,
            order: 'created_at',
            sort: null
        }, authToken);
        if (isVikAuthError(missionList)) {
            recordTargetStatus('vik', 'needs-login', {
                stage: 'login',
                message: '维咔登录凭据已失效，需要前台刷新任务页或重新登录',
                url: location.href
            });
            return false;
        }
        const userId = String(userInfo.data.basic.id);
        const myMission = missionList?.data?.list?.find(item => String(item?.user?.id) === userId);
        if (isVikTodayTimestamp(myMission?.mission?.sign_time)) {
            return completeSign('vik', '任务列表确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        console.log('[维咔] API 返回异常:', signJson, missionList);
        recordTargetStatus('vik', 'failed', {
            stage: 'api',
            message: signJson?.message || '维咔 API 签到未返回成功标记',
            url: location.href
        });
        return false;
    }

    async function runGalgameXNewApiSign(debugContext) {
        const res = await gmRequest({
            method: 'POST',
            url: 'https://www.galgamex.top/api/user/checkin',
            debugContext
        });
        const text = res.responseText || '';
        if (text.includes('randomMoemoepoints')) {
            const json = JSON.parse(text);
            return completeSign('galGameXNew', `签到成功，获得 ${json.randomMoemoepoints} 萌点`, CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (text.includes('您今天已经签到过了')) {
            return completeSign('galGameXNew', '接口返回今日已经签到过了');
        }
        console.log('[GalgameX 新站] API 返回异常:', text);
        return false;
    }

    async function runFufugalPageSign() {
        const extractResultText = (text) => {
            const source = String(text || '');
            const reportMatch = source.match(/寻宝报告[\s\S]{0,700}(?:确定|$)/);
            if (reportMatch) return reportMatch[0].trim();
            const doneMatch = source.match(/今日已完成寻宝[^\n。]*(?:[。！!])?/);
            if (doneMatch) return doneMatch[0].trim();
            const scoreMatch = source.match(/(?:最终携带回了|携带回了)[^\n]*积分/);
            return scoreMatch ? scoreMatch[0].trim() : '';
        };
        const getNoticeText = () => {
            const texts = Array.from(document.querySelectorAll('.el-notification__content, .el-message__content, [role="dialog"]'))
                .map(node => extractResultText(node.innerText || node.textContent) || (node.innerText || node.textContent || '').trim())
                .filter(Boolean);
            const bodyResultText = extractResultText(document.body?.innerText || '');
            if (bodyResultText && !texts.includes(bodyResultText)) texts.push(bodyResultText);
            return texts.join('\n');
        };
        const waitForNoticeText = async (beforeText = '', timeout = 5000) => {
            const startedAt = Date.now();
            let lastText = '';
            while (Date.now() - startedAt < timeout) {
                const text = getNoticeText();
                if (text && text !== beforeText) return text;
                if (text) lastText = text;
                await delay(250);
            }
            return lastText;
        };
        const isAlreadyDoneText = (text) => /今日已完成寻宝|请明日再来|今日已.*寻宝|已经.*寻宝|明天再来/.test(text);
        const isSuccessText = (text) => isAlreadyDoneText(text) || /寻宝报告|寻宝成功|寻宝结束|休息状态|(?:最终携带回了|携带回了)[^\n]*积分|获得[^\n]*积分|等级提升|成功/.test(text);
        const isLoginText = (text) => /请先登录|登录后|登陆后|未登录|未登陆/.test(text);
        const isFailureText = (text) => /失败|错误|异常|无法|请稍后|error/i.test(text);

        const bodyText = document.body?.innerText || '';
        const hasLoginForm = Boolean(document.querySelector('input[type="password"], input[name="username"], input[name="password"]'));
        const hasUserPanel = Boolean(document.querySelector('#photo_wrap .user-infos, .user-infos'));
        if (!hasUserPanel && hasLoginForm && /登录|登陆/.test(bodyText)) {
            recordTargetStatus('fufugal', 'needs-login', {
                stage: 'login',
                message: '初音的青葱需要先登录账号',
                url: location.href
            });
            return false;
        }

        const btn = await waitForElement(
            '#photo_wrap > figure > div.user-infos > div.xbs.el-tooltip__trigger.el-tooltip__trigger, #photo_wrap .user-infos .xbs',
            5000
        );
        if (!btn) {
            console.log('[初音的青葱] 未找到寻宝按钮');
            return false;
        }

        const beforeNoticeText = getNoticeText();
        if (isAlreadyDoneText(beforeNoticeText)) {
            return completeSign('fufugal', beforeNoticeText);
        }

        btn.click();
        console.log('执行寻宝(签到)点击');
        const noticeText = await waitForNoticeText(beforeNoticeText);
        if (isSuccessText(noticeText)) {
            return completeSign('fufugal', noticeText || '寻宝按钮状态已确认', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (isLoginText(noticeText)) {
            recordTargetStatus('fufugal', 'needs-login', {
                stage: 'login',
                message: '初音的青葱需要先登录账号',
                url: location.href
            });
            return false;
        }
        if (isFailureText(noticeText)) {
            recordTargetStatus('fufugal', 'failed', {
                stage: 'notice',
                message: noticeText,
                url: location.href
            });
            return false;
        }
        if ((btn.innerText || '').includes('寻宝')) {
            return completeSign('fufugal', '已点击寻宝按钮，未检测到异常提示', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        console.log('[初音的青葱] 寻宝按钮点击后未识别站点提示', noticeText);
        return completeSign('fufugal', '寻宝按钮状态已确认', CLOSE_PAGE_AFTER_SIGN_ACTION);
    }

    // ================== 各站点签到策略配置 ==================

    const siteConfigs = [
        {
            name: "SS同盟",
            matches: ["sstm.moe"],
            key: "sstm",
            dashboard: {
                url: "https://sstm.moe/forum/72-%E5%90%8C%E7%9B%9F%E7%AD%BE%E5%88%B0%E5%8C%BA/",
                openMode: "foreground",
                resultMode: "script",
                note: "富文本回帖流程对后台标签较敏感"
            },
            async run() {
                // 1. 登录检查
                const isLogin = !document.querySelector('a[data-role="login"]') && !document.body.innerText.includes("现有用户? 登入");
                if (!isLogin) {
                    console.log('[签到助手] SS同盟：检测到未登录，等待用户手动登录...');
                    recordTargetStatus('sstm', 'needs-login', {
                        stage: 'login',
                        message: 'SS同盟需要先登录账号',
                        url: location.href
                    });
                    return false;
                }

                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;
                const date = now.getDate();
                const dateStr = `【${year}/${month}/${date}】`;

                // 2. 如果在签到区列表页，寻找今日贴
                if (location.href.includes('/forum/72-')) {
                    // 使用更通用的选择器，不再依赖 data-role="canEditTitle"
                    const threadLinks = document.querySelectorAll('.ipsDataItem_title a, a[href*="/topic/"]');
                    console.log(`[签到助手] 发现 ${threadLinks.length} 个可能的帖子链接，正在匹配：${dateStr}`);

                    for (const a of threadLinks) {
                        const title = a.innerText.trim();
                        if (title.includes("签到") && title.includes(dateStr)) {
                            console.log('[签到助手] 成功匹配今日贴：' + title);
                            recordTargetStatus('sstm', 'opened', {
                                stage: 'find-thread',
                                message: '已找到今日签到贴，正在进入帖子',
                                url: a.href
                            });
                            window.location.href = a.href;
                            return false;
                        }
                    }

                    // 如果还是没找到，尝试模糊匹配（不带中括号的日期）
                    const fuzzyDateStr = `${year}/${month}/${date}`;
                    for (const a of threadLinks) {
                        const title = a.innerText.trim();
                        if (title.includes("版主招募区签到") && title.includes(fuzzyDateStr)) {
                            console.log('[签到助手] 模糊匹配成功：' + title);
                            recordTargetStatus('sstm', 'opened', {
                                stage: 'find-thread',
                                message: '已模糊匹配今日签到贴，正在进入帖子',
                                url: a.href
                            });
                            window.location.href = a.href;
                            return false;
                        }
                    }

                    console.log('[签到助手] 未找到包含 ' + dateStr + ' 的今日贴。尝试刷新页面或手动检查。');
                    recordTargetStatus('sstm', 'failed', {
                        stage: 'find-thread',
                        message: `未找到 ${dateStr} 的今日签到贴`,
                        url: location.href
                    });
                    return false;
                }

                // 3. 如果在帖子详情页，执行回帖
                if (location.href.includes('/topic/')) {
                    // 校验是否为今日贴，防止跑错帖子
                    const pageTitle = document.querySelector('h1.ipsType_pageTitle')?.innerText || "";
                    if (!pageTitle.includes(dateStr) && !pageTitle.includes(`${year}/${month}/${date}`)) {
                        console.log('[签到助手] 当前帖子日期不匹配，跳转到签到区寻找新帖...');
                        recordTargetStatus('sstm', 'opened', {
                            stage: 'navigate',
                            message: '当前帖子不是今日签到贴，正在返回签到区',
                            url: location.href
                        });
                        window.location.href = "https://sstm.moe/forum/72-%E5%90%8C%E7%9B%9F%E7%AD%BE%E5%88%B0%E5%8C%BA/";
                        return false;
                    }

                    // 构建回复内容：2026年4月16日 21:02:16
                    const timeString = `${year}年${month}月${date}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                    // 改进防重复校验：必须是当前登录用户在今天发表的回帖，防止被其他包含日期的回帖误导
                    let hasSignedToday = false;
                    const currentUserLink = document.querySelector('#elUserLink');
                    const currentUserName = currentUserLink ? currentUserLink.textContent.trim() : '';
                    const currentUserUrl = currentUserLink ? currentUserLink.href.split('?')[0].replace(/\/$/, '') : '';

                    const comments = document.querySelectorAll('article.ipsComment, [data-role="commentFeed"] article');
                    for (const comment of comments) {
                        const authorLink = comment.querySelector('aside.cAuthorPane h3 a, .cAuthorPane_author a, .ipsComment_author a');
                        const authorName = authorLink ? authorLink.textContent.trim() : '';
                        const authorUrl = authorLink ? authorLink.href.split('?')[0].replace(/\/$/, '') : '';

                        const isMyComment = (authorUrl && currentUserUrl && authorUrl === currentUserUrl) ||
                                            (authorName && currentUserName && authorName === currentUserName);

                        if (isMyComment) {
                            const contentEl = comment.querySelector('.ipsComment_content, [data-role="commentContent"]') || comment;
                            if (contentEl.innerText.includes(`${year}年${month}月${date}日`)) {
                                hasSignedToday = true;
                                break;
                            }
                        }
                    }

                    if (hasSignedToday) {
                        console.log('[签到助手] 评论区已检测到您今日的回帖，判定为签到成功。');
                        return completeSign('sstm', '评论区已检测到今日回帖', CLOSE_PAGE_AFTER_SIGN_ACTION);
                    } else if (!currentUserLink) {
                        // 兼容极端情况：如果未能获取到当前用户信息，降级为检查严格的日期时间格式
                        const commentsArea = document.querySelector('[data-role="commentFeed"]');
                        const strictDateRegex = new RegExp(`${year}年${month}月${date}日\\s+\\d{2}:\\d{2}:\\d{2}`);
                        if (commentsArea && strictDateRegex.test(commentsArea.innerText)) {
                            console.log('[签到助手] 评论区检测到严格符合格式的回帖（防误判降级），判定为签到成功。');
                            return completeSign('sstm', '评论区检测到今日回帖格式', CLOSE_PAGE_AFTER_SIGN_ACTION);
                        }
                    }

                    const retryCount = GM_getValue('sstm_retry_count', 0);
                    if (retryCount >= 3) {
                        alert("【签到助手】SS同盟签到连续3次失败，请检查回帖权限或是否被禁言！");
                        GM_setValue('sstm_retry_count', 0);
                        recordTargetStatus('sstm', 'needs-foreground', {
                            stage: 'retry',
                            message: 'SS同盟连续多次未完成，请前台检查回帖权限或禁言状态',
                            url: location.href
                        });
                        return false;
                    }

                    console.log(`[签到助手] 准备回帖，当前重试次数：${retryCount}`);

                    // 1. 强力激活编辑器
                    const dummy = document.querySelector('.ipsComposeArea_dummy');
                    if (dummy) {
                        console.log('[签到助手] 发现占位符，执行强力激活...');
                        dummy.focus();
                        // 移除 view: window 以修复 TypeError
                        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
                        dummy.dispatchEvent(mousedownEvent);
                        dummy.click();
                        await delay(2000); // 给一点加载时间
                    }

                    // 2. 多策略寻找编辑器
                    let editorField = await (async () => {
                        // 策略 A: 直接找页面上可见的 contenteditable
                        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
                        for (let el of editables) {
                            if (el.offsetWidth > 0 || el.offsetHeight > 0) return el;
                        }

                        // 策略 B: 找 iframe 内部
                        const iframe = document.querySelector('iframe.cke_wysiwyg_frame, .ipsComposeArea iframe');
                        if (iframe && iframe.contentDocument) return iframe.contentDocument.body;

                        // 策略 C: 轮询等待（处理异步加载）
                        return await waitForElement('[contenteditable="true"], .cke_wysiwyg_div', 5000);
                    })();

                    if (editorField) {
                        console.log('[签到助手] 编辑器已定位，准备输入内容...');
                        editorField.focus();

                        // 确保清空并填入
                        try {
                            // 针对某些编辑器，直接赋值比 execCommand 更稳
                            editorField.innerHTML = `<p>${timeString}</p>`;
                            // 触发 input 事件通知编辑器内容已变
                            editorField.dispatchEvent(new Event('input', { bubbles: true }));
                        } catch (e) {
                            document.execCommand('insertText', false, timeString);
                        }

                        await delay(1500);

                        // 3. 多重策略寻找提交按钮
                        const submitBtn = document.querySelector('button[type="submit"].ipsButton_primary, [data-action="submitReply"], .ipsComposeArea_submit button');
                        if (submitBtn) {
                            console.log('[签到助手] 点击提交按钮...');
                            markPendingAutoCloseAfterSignAction('sstm', 'reply-submit');
                            submitBtn.click();

                            // 4. 等待并校验
                            await delay(5000);
                            const commentsArea = document.querySelector('[data-role="commentFeed"], #elPostFeed, .ipsType_richText');
                            if (document.body.innerText.includes(timeString)) {
                                console.log('[签到助手] 校验成功！');
                                GM_setValue('sstm_retry_count', 0);
                                return completeSign('sstm', '回帖提交后已校验成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
                            }
                        }
                    }

                    console.log('[签到助手] 编辑器或按钮未就绪，准备刷新重试...');
                    recordTargetStatus('sstm', 'needs-foreground', {
                        stage: 'editor',
                        message: '编辑器或提交按钮未就绪，建议保持页面前台后重试',
                        url: location.href,
                        incrementAttempt: true
                    });
                    GM_setValue('sstm_retry_count', retryCount + 1);
                    location.reload();
                    return false;
                }

                // 4. 如果在主域首页或其他页面，引导至签到区
                if (location.hostname === 'sstm.moe' && !location.href.includes('/forum/72-') && !location.href.includes('/topic/')) {
                    console.log('[签到助手] 自动前往签到区...');
                    recordTargetStatus('sstm', 'opened', {
                        stage: 'navigate',
                        message: '已打开 SS同盟，正在前往签到区',
                        url: location.href
                    });
                    window.location.href = "https://sstm.moe/forum/72-%E5%90%8C%E7%9B%9F%E7%AD%BE%E5%88%B0%E5%8C%BA/";
                }

                return false;
            }
        },
        {
            name: "月曦论坛",
            matches: ["bbs.wcccc.cc"],
            key: "wcccc",
            dashboard: {
                url: "https://bbs.wcccc.cc/plugin.php?id=k_misign:sign",
                openMode: "background",
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('k_misign:sign')) {
                    if (!$('#ls_username').length) {
                        window.location.href = "plugin.php?id=k_misign:sign";
                    }
                    return false; // 等待跳转
                }
                const btnSign = await waitForElement('#JD_sign', 2000);
                const btnVisited = document.querySelector('.btnvisted');
                if (btnVisited) {
                    console.log('已签到!');
                    return completeSign('wcccc', '页面显示今日已签到');
                } else if (btnSign) {
                    btnSign.click();
                    console.log('签到成功!');
                    return completeSign('wcccc', '已点击签到按钮', CLOSE_PAGE_AFTER_SIGN_ACTION);
                }
                return false;
            }
        },
        {
            name: "老王论坛",
            matches: ["laowang.vip"],
            key: "laowang",
            dashboard: {
                url: "https://laowang.vip/plugin.php?id=k_misign:sign",
                openMode: "foreground",
                resultMode: "script",
                note: "签到提交需要站点点击验证，需前台完成"
            },
            async run() {
                const bodyText = document.body?.innerText || '';
                const isLoginPage = /member\.php\?mod=logging(?:&|&amp;)action=login/i.test(location.href) ||
                    /登录老王论坛|立即登录|用户名|找回密码/.test(bodyText);
                if (isLoginPage) {
                    recordTargetStatus('laowang', 'needs-login', {
                        stage: 'login',
                        message: '老王论坛需要先登录账号',
                        url: location.href
                    });
                    return false;
                }

                if (!/plugin\.php\?id=k_misign(?::|%3A)sign/i.test(location.href)) {
                    window.location.href = 'https://laowang.vip/plugin.php?id=k_misign:sign';
                    return false;
                }

                const isSigned = () => {
                    const text = document.body?.innerText || '';
                    return Boolean(document.querySelector('.btnvisted')) ||
                        /签到成功|恭喜你签到成功|今日已签到|您今日已经签到|已经签到/.test(text);
                };
                if (isSigned()) {
                    return completeSign('laowang', '页面显示今日已签到');
                }

                const isCaptchaPage = () => Boolean(document.querySelector('#v2_captcha_form, #tncode, input[name="clicaptcha-submit-info"]')) ||
                    /请点击下面的按钮验证|点击进行验证/.test(document.body?.innerText || '');
                if (isCaptchaPage()) {
                    recordTargetStatus('laowang', 'needs-foreground', {
                        stage: 'captcha',
                        message: '老王论坛需要在前台完成点击验证后再确认',
                        url: location.href
                    });
                    return false;
                }

                const btn = await waitForElement('a[href*="operation=qiandao"], #JD_sign, .qdleft a.btn', 5000);
                if (btn) {
                    markPendingAutoCloseAfterSignAction('laowang', 'sign-click');
                    btn.click();
                    console.log('[老王论坛] 已点击签到按钮，等待验证和结果确认...');

                    for (let i = 0; i < 20; i++) {
                        await delay(500);
                        if (isSigned()) {
                            return completeSign('laowang', '前台验证后确认签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
                        }
                        if (isCaptchaPage()) {
                            recordTargetStatus('laowang', 'needs-foreground', {
                                stage: 'captcha',
                                message: '老王论坛需要在前台完成点击验证后再确认',
                                url: location.href
                            });
                            return false;
                        }
                    }

                    return false;
                }

                return false;
            }
        },
        {
            name: "飞雪论坛",
            matches: ["feixueacg.org"],
            key: "fxacg",
            dashboard: {
                url: "https://feixueacg.org/plugin.php?id=dc_signin",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runFeixueApiSign,
            async run() {
                try {
                    return await runFeixueApiSign();
                } catch (err) {
                    console.log('[飞雪论坛] API 签到异常', err);
                }
                return false;
            }
        },
        {
            name: "South-Plus",
            matches: ["www.south-plus.net"],
            key: "southplus",
            dashboard: {
                url: "https://www.south-plus.net/",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runSouthPlusApiSign,
            async run() {
                return await runSouthPlusApiSign();
            }
        },
        {
            name: "2dfan",
            matches: ["galge.fun", "2dfan.com", "2dfan.org"],
            key: "2dfan",
            dashboard: {
                url: "https://2dfan.com/users/177256/recheckin",
                openMode: "foreground",
                resultMode: "script",
                note: "签到提交需要阿里云验证码校验，需前台完成"
            },
            async run() {
                if (location.href.includes('not_authenticated') || location.href.includes('sign_in')) {
                    recordTargetStatus('2dfan', 'needs-login', {
                        stage: 'login',
                        message: '2dfan 需要先登录账号',
                        url: location.href
                    });
                    return false;
                }

                if (!location.href.includes('recheckin')) {
                    window.location.href = "/users/177256/recheckin";
                    return false;
                }

                const isSigned = () => {
                    const signFlag = document.querySelector('#checkin');
                    const signFlag2 = document.querySelector('.checkin-info .pull-right');
                    const bodyText = document.body?.innerText || '';
                    return (signFlag && /已签到|已连续签到/.test(signFlag.innerText)) ||
                        (signFlag2 && /已签到|已连续签到/.test(signFlag2.innerText)) ||
                        /已连续签到|今日已签到/.test(bodyText);
                };

                if (isSigned()) {
                    return completeSign('2dfan', '页面显示今日已签到');
                }

                const btn = await waitForElement('#do_checkin, #checkin', 5000);
                if (btn && /签到|今日签到/.test(btn.innerText || '')) {
                    btn.click();
                    console.log('[2dfan] 已点击签到按钮，等待页面验证和结果确认...');

                    for (let i = 0; i < 20; i++) {
                        await delay(500);
                        if (isSigned()) {
                            return completeSign('2dfan', '前台验证后确认签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
                        }
                    }

                    recordTargetStatus('2dfan', 'needs-foreground', {
                        stage: 'captcha',
                        message: '2dfan 可能需要在前台完成阿里云验证码后再确认',
                        url: location.href
                    });
                    return false;
                }

                return false;
            }
        },
        {
            name: "夜世界",
            matches: ["www.sl-asmr.com"],
            key: "sl-asmr",
            dashboard: {
                url: "https://www.sl-asmr.com/",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runSlAsmrApiSign,
            async run() {
                return await runSlAsmrApiSign();
            }
        },
        {
            name: "GalgameX",
            matches: ["galgamex.org"],
            key: "galgamex",
            dashboard: {
                url: "https://galgamex.org/circle",
                openMode: "background",
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes("circle")) {
                    window.location.href = "circle";
                    return false;
                }
                const btn = await waitForElement('.user-w-qd > div', 5000);
                if (btn) {
                    if (!btn.innerText.includes('恭喜')) {
                        btn.click();
                        console.log('执行签到点击');
                        return completeSign('galgamex', '签到按钮状态已确认', CLOSE_PAGE_AFTER_SIGN_ACTION);
                    } else {
                        console.log('已签到');
                        return completeSign('galgamex', '签到按钮状态已确认');
                    }
                }
                return false;
            }
        },
        {
            name: "次元狗",
            matches: ["www.acgndog.com"],
            key: "acgndog",
            dashboard: {
                url: "https://www.acgndog.com/",
                openMode: "background",
                resultMode: "script",
                note: "后台打开页面后自动 API 签到"
            },
            async run() {
                try {
                    return await runAcgndogApiSign();
                } catch (err) {
                    console.log('[次元狗] API 签到异常', err);
                }
                return false;
            }
        },
        {
            name: "绯月",
            matches: ["bbs.kfpromax.com"],
            key: "kfpromax",
            dashboard: {
                url: "https://bbs.kfpromax.com/kf_growup.php",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runKfpromaxApiSign,
            async run() {
                if (!location.href.includes('kf_growup.php')) {
                    window.location.href = 'kf_growup.php';
                    return false;
                }

                try {
                    return await runKfpromaxApiSign();
                } catch (err) {
                    console.log('[绯月] API 签到异常', err);
                }
                return false;
            }
        },
        {
            name: "维咔",
            matches: ["www.vikacg.com"],
            key: "vik",
            dashboard: {
                url: "https://www.vikacg.com/wallet/mission",
                openMode: "background",
                resultMode: "script",
                note: "后台打开任务页后自动 API 签到"
            },
            async run() {
                try {
                    return await runVikApiSign();
                } catch (err) {
                    console.log('[维咔] API 签到异常', err);
                }
                return false;
            }
        },
        {
            name: "司机社",
            matches: ["sjs47.com"],
            key: "sijishe",
            dashboard: {
                url: "https://sjs47.com/k_misign-sign.html",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runSijisheApiSign,
            async run() {
                try {
                    return await runSijisheApiSign();
                } catch (err) {
                    console.log('[司机社] API 签到异常', err);
                }
                return false;
            }
        },
        {
            name: "有叽叽论坛",
            matches: ["www.uu-gg.one"],
            key: "uugg",
            dashboard: {
                url: "https://www.uu-gg.one/plugin.php?id=dsu_paulsign:sign",
                openMode: "background",
                resultMode: "script",
                note: "后台打开签到页后由页面内 API 提交，Cloudflare 验证需前台完成"
            },
            async run() {
                return await runUuGgPageSign();
            }
        },
        {
            name: "搜书吧",
            matches: ["vv9b.vbrwd4qd356.com"],
            key: "soushuba",
            dashboard: {
                url: "https://vv9b.vbrwd4qd356.com/",
                openMode: "background",
                resultMode: "script",
                note: "登录访问即自动获得 2 银币"
            },
            async run() {
                await delay(1000);

                const getDiscuzUid = () => {
                    const rawUid = typeof unsafeWindow !== 'undefined' ? unsafeWindow.discuz_uid : '';
                    if (rawUid && rawUid !== '0') return String(rawUid);
                    const scripts = Array.from(document.scripts || []);
                    for (const script of scripts) {
                        const match = (script.textContent || '').match(/discuz_uid\s*=\s*['"]([^'"]+)['"]/);
                        if (match) return match[1];
                    }
                    return '';
                };

                const uid = getDiscuzUid();
                const hasLoginForm = document.querySelector('#lsform, #ls_username, input[name="username"][id="ls_username"]');
                const hasLogoutLink = document.querySelector('a[href*="member.php?mod=logging"][href*="action=logout"]');
                const hasUserSpaceLink = document.querySelector('a[href*="home.php?mod=space&uid="]');

                if ((uid && uid !== '0') || hasLogoutLink || (hasUserSpaceLink && !hasLoginForm)) {
                    return completeSign('soushuba', '已登录访问，站点自动获得 2 银币');
                }

                recordTargetStatus('soushuba', 'needs-login', {
                    stage: 'login',
                    message: '搜书吧需要先登录；登录成功访问首页会自动获得 2 银币',
                    url: location.href
                });
                return false;
            }
        },
        {
            name: "GalgameX 新站",
            matches: ["www.galgamex.top"],
            key: "galGameXNew",
            dashboard: {
                url: "https://www.galgamex.top/",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runGalgameXNewApiSign,
            async run() {
                return await runGalgameXNewApiSign();
            }
        },
        {
            name: "ZodGame",
            matches: ["zodgame.xyz"],
            key: "ZodGame",
            dashboard: {
                url: "https://zodgame.xyz/plugin.php?id=dsu_paulsign:sign",
                openMode: "background",
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('plugin.php?id=dsu_paulsign:sign')&&!location.href.includes('member.php?mod=logging&action=login')) {
                    if (document.body.innerText.includes("签到")) { // 弱校验是否包含入口
                        window.location.href = "plugin.php?id=dsu_paulsign:sign";
                    }
                    return false;
                }

                // 已经处于签到页
                await delay(1000);

                const signedMsg = document.querySelector("#ct > div.mn > h1:nth-child(1)");
                if (signedMsg && signedMsg.innerText.includes("已经签到过了")) {
                    console.log('已签到!');
                    return completeSign('ZodGame', '页面显示今日已签到');
                }

                if (document.body.innerText.includes("今天签到了吗") && document.body.innerText.includes("写下今天最想说的话")) {
                    const emoji = document.querySelector('#fd_s');
                    if (emoji) emoji.checked = true;

                    const say = document.querySelector('#todaysay');
                    if (say) say.value = "每天签到水一发。。。";

                    const form = document.querySelector('#qiandao');
                    if (form) markPendingAutoCloseAfterSignAction('ZodGame', 'sign-form-submit');
                    if (form) form.submit();
                    markSignSuccess('ZodGame', '已提交签到表单');

                    return true;
                }
                return false;
            }
        },
        {
            name: "初音的青葱",
            matches: ["www.fufugal.com"],
            key: "fufugal",
            dashboard: {
                url: "https://www.fufugal.com/",
                openMode: "background",
                resultMode: "script",
                note: "后台打开页面后点击寻宝按钮"
            },
            async run() {
                try {
                    return await runFufugalPageSign();
                } catch (err) {
                    console.log('[初音的青葱] 页面寻宝异常', err);
                }
                return false;
            }
        }
    ];

    // ================== 签到控制台数据与 UI ==================

    function getBuiltInTargets() {
        const config = getDashboardConfig();
        return siteConfigs
            .filter(site => site.dashboard && site.dashboard.url)
            .map(site => {
                const setting = config.targetSettings[site.key] || {};
                return {
                    id: site.key,
                    siteKey: site.key,
                    builtIn: true,
                    name: site.name,
                    url: setting.url || site.dashboard.url,
                    enabled: setting.enabled !== false,
                    directApi: typeof site.directRun === 'function',
                    openMode: setting.openMode || site.dashboard.openMode || 'background',
                    resultMode: setting.resultMode || site.dashboard.resultMode || 'script',
                    note: site.dashboard.note || ''
                };
            });
    }

    function getCustomTargets() {
        const config = getDashboardConfig();
        return config.customTargets
            .map(target => ({
                id: target.id,
                builtIn: false,
                name: target.name || '未命名站点',
                url: safeUrl(target.url),
                enabled: target.enabled !== false,
                openMode: target.openMode || 'background',
                resultMode: target.resultMode || 'opened',
                note: target.note || ''
            }))
            .filter(target => target.id && target.url);
    }

    function getAllTargets() {
        return [...getBuiltInTargets(), ...getCustomTargets()];
    }

    function normalizeSearchText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function targetMatchesSearch(target, query) {
        const keyword = normalizeSearchText(query);
        if (!keyword) return true;
        return [
            target.name,
            target.url,
            target.note,
            target.id,
            OPEN_MODE_LABELS[target.openMode],
            RESULT_MODE_LABELS[target.resultMode]
        ].some(value => normalizeSearchText(value).includes(keyword));
    }

    function updateBuiltInTargetSetting(key, patch) {
        const config = getDashboardConfig();
        const current = config.targetSettings[key] || {};
        config.targetSettings[key] = { ...current, ...patch };
        saveDashboardConfig(config);
    }

    function saveCustomTarget(target) {
        const config = getDashboardConfig();
        const cleanTarget = {
            id: target.id || `custom-${Date.now().toString(36)}`,
            name: target.name.trim(),
            url: safeUrl(target.url),
            enabled: target.enabled !== false,
            openMode: target.openMode || 'background',
            resultMode: target.resultMode || 'opened',
            note: (target.note || '').trim()
        };
        if (!cleanTarget.name || !cleanTarget.url) {
            alert('请填写有效的站点名称和 http/https 网址。');
            return false;
        }
        const index = config.customTargets.findIndex(item => item.id === cleanTarget.id);
        if (index >= 0) {
            config.customTargets[index] = cleanTarget;
        } else {
            config.customTargets.push(cleanTarget);
        }
        saveDashboardConfig(config);
        return true;
    }

    function deleteCustomTarget(id) {
        const config = getDashboardConfig();
        config.customTargets = config.customTargets.filter(item => item.id !== id);
        saveDashboardConfig(config);
    }

    function getLaunchedAutoCloseKey(target) {
        return target?.siteKey || target?.id || '';
    }

    function stopLaunchedAutoCloseMonitor() {
        if (launchedAutoCloseMonitorTimer) {
            clearInterval(launchedAutoCloseMonitorTimer);
            launchedAutoCloseMonitorTimer = null;
        }
    }

    function closeLaunchedAutoCloseTab(key, entry, reason) {
        try {
            entry.tab.close();
            console.log(`[签到助手] ${key} 已由控制台关闭签到页面：${reason}`);
        } catch (err) {
            console.log(`[签到助手] ${key} 控制台关闭签到页面失败，可能是浏览器限制。`, err);
        }
        launchedAutoCloseTabs.delete(key);
    }

    function syncLaunchedAutoCloseTabs(targets = getAllTargets()) {
        const config = getDashboardConfig();
        const now = Date.now();

        for (const [key, entry] of launchedAutoCloseTabs) {
            if (!config.preferences.autoClosePageAfterSign) {
                launchedAutoCloseTabs.delete(key);
                continue;
            }
            if (!entry?.tab || typeof entry.tab.close !== 'function') {
                launchedAutoCloseTabs.delete(key);
                continue;
            }
            if (entry.tab.closed || now - entry.openedAt > AUTO_CLOSE_PENDING_TTL_MS) {
                launchedAutoCloseTabs.delete(key);
                continue;
            }

            const target = targets.find(item => getLaunchedAutoCloseKey(item) === key);
            if (!target) {
                launchedAutoCloseTabs.delete(key);
                continue;
            }

            const status = getNormalizedTargetStatus(target);
            if (status.status === 'success') {
                closeLaunchedAutoCloseTab(key, entry, status.message || '已确认签到成功');
            }
        }

        if (!launchedAutoCloseTabs.size) stopLaunchedAutoCloseMonitor();
    }

    function startLaunchedAutoCloseMonitor() {
        if (launchedAutoCloseMonitorTimer) return;
        launchedAutoCloseMonitorTimer = setInterval(() => {
            syncLaunchedAutoCloseTabs();
        }, 1000);
    }

    function trackLaunchedAutoCloseTab(target, tab, beforeStatus) {
        if (isTargetDone(beforeStatus)) return;
        if (!target?.siteKey || !tab || typeof tab.close !== 'function') return;
        if (!TRACK_LAUNCHED_AUTO_CLOSE_SITE_KEYS.has(target.siteKey)) return;
        const config = getDashboardConfig();
        if (!config.preferences.autoClosePageAfterSign) return;

        const key = getLaunchedAutoCloseKey(target);
        if (!key) return;
        launchedAutoCloseTabs.set(key, {
            tab,
            openedAt: Date.now(),
            url: target.url
        });
        startLaunchedAutoCloseMonitor();
    }

    function openUrl(url, openMode = 'background') {
        if (typeof GM_openInTab === 'function') {
            return GM_openInTab(url, {
                active: openMode === 'foreground',
                insert: true,
                setParent: true
            });
        }
        return window.open(url, openMode === 'foreground' ? '_self' : '_blank', 'noopener');
    }

    function launchTarget(target) {
        const beforeStatus = getNormalizedTargetStatus(target).status;
        markPendingAutoCloseAfterDashboardLaunch(target);
        const tab = openUrl(target.url, target.openMode);
        trackLaunchedAutoCloseTab(target, tab, beforeStatus);
        const message = target.resultMode === 'script'
            ? '已打开，等待站点脚本确认签到结果'
            : '已打开，等待手动确认签到结果';
        recordTargetStatus(target.id, 'opened', {
            stage: 'launch',
            message,
            url: target.url,
            incrementAttempt: true
        });
    }

    async function runDirectTargetOnce(target, site, attempt, totalAttempts) {
        recordTargetStatus(target.id, 'running', {
            stage: 'direct-api',
            message: `正在从控制台发送 API 签到请求（${attempt}/${totalAttempts}）`,
            url: target.url,
            incrementAttempt: true
        });

        const debugContext = startSignDebugCapture(target.id, target.name, 'direct-api');
        try {
            const isSuccess = await site.directRun(debugContext);
            if (!isSuccess) {
                const status = getNormalizedTargetStatus(target);
                const reason = status.status === 'running'
                    ? {
                        outcome: 'failed',
                        status: 'failed',
                        stage: 'direct-api',
                        message: 'API 签到未返回成功标记'
                    }
                    : {
                        outcome: 'failed',
                        status: status.status,
                        stage: status.stage || 'direct-api',
                        message: status.message || '控制台直签未确认成功'
                    };
                return {
                    isSuccess: false,
                    debugContext,
                    reason
                };
            }
            return { isSuccess: true, debugContext, reason: null };
        } catch (err) {
            console.log(`[签到助手] ${target.name} 控制台直签异常`, err);
            return {
                isSuccess: false,
                debugContext,
                reason: {
                    outcome: 'error',
                    status: 'failed',
                    stage: 'direct-api',
                    message: stringifyDebugError(err)
                }
            };
        } finally {
            finishSignDebugCapture(debugContext);
        }
    }

    async function runDirectTarget(target, onProgress) {
        const site = siteConfigs.find(item => item.key === target.siteKey && typeof item.directRun === 'function');
        if (!site) return false;

        let lastResult = null;
        for (let attempt = 1; attempt <= DIRECT_SIGN_RETRY_ATTEMPTS; attempt++) {
            lastResult = await runDirectTargetOnce(target, site, attempt, DIRECT_SIGN_RETRY_ATTEMPTS);
            if (lastResult.isSuccess) return true;

            if (attempt < DIRECT_SIGN_RETRY_ATTEMPTS) {
                const status = getNormalizedTargetStatus(target);
                recordTargetStatus(target.id, 'running', {
                    stage: 'retry',
                    message: `第 ${attempt} 次未确认成功，${DIRECT_SIGN_RETRY_DELAY_MS / 1000} 秒后自动重试（${attempt + 1}/${DIRECT_SIGN_RETRY_ATTEMPTS}）`,
                    url: status.url || target.url
                });
                if (typeof onProgress === 'function') onProgress();
                await delay(DIRECT_SIGN_RETRY_DELAY_MS);
            }
        }

        if (lastResult?.debugContext && lastResult?.reason) {
            recordTargetStatus(target.id, lastResult.reason.status || 'failed', {
                stage: lastResult.reason.stage || 'direct-api',
                message: lastResult.reason.message || '控制台直签未确认成功',
                url: target.url
            });
            persistSignDebugFailure(lastResult.debugContext, lastResult.reason);
        }
        return false;
    }

    async function runDirectTargets(targets, rerender) {
        const runnableTargets = targets.filter(target => {
            if (!target.enabled || !target.directApi) return false;
            return !isTargetDone(getNormalizedTargetStatus(target).status);
        });
        if (!runnableTargets.length) return;

        if (typeof rerender === 'function') rerender();

        await Promise.all(runnableTargets.map(async target => {
            const promise = runDirectTarget(target, rerender);
            if (typeof rerender === 'function') rerender();
            await promise;
            if (typeof rerender === 'function') rerender();
        }));
    }

    function isTargetDone(status) {
        return status === 'success' || status === 'skipped';
    }

    function getLaunchableTargets() {
        return getAllTargets().filter(target => {
            if (!target.enabled || target.openMode === 'manual' || target.directApi) return false;
            const targetStatus = getNormalizedTargetStatus(target).status;
            return !isTargetDone(targetStatus);
        });
    }

    function getDirectRunnableTargets() {
        return getAllTargets().filter(target => {
            if (!target.enabled || !target.directApi) return false;
            const targetStatus = getNormalizedTargetStatus(target).status;
            return !isTargetDone(targetStatus);
        });
    }

    function getAttentionTargets() {
        return getAllTargets().filter(target => {
            if (!target.enabled) return false;
            return !isTargetDone(getNormalizedTargetStatus(target).status);
        });
    }

    function getAttentionSignature(targets = getAttentionTargets()) {
        const parts = targets
            .map(target => `${target.id}:${getNormalizedTargetStatus(target).status}`)
            .sort();
        return `${getToday()}|${parts.join(',')}`;
    }

    function getDashboardAutoRefreshLeftSeconds() {
        if (!dashboardAutoRefreshUntil) return 0;
        return Math.max(0, Math.ceil((dashboardAutoRefreshUntil - Date.now()) / 1000));
    }

    function isDashboardAutoRefreshActive() {
        return getDashboardAutoRefreshLeftSeconds() > 0;
    }

    function stopDashboardAutoRefresh() {
        if (dashboardAutoRefreshTimer) {
            clearInterval(dashboardAutoRefreshTimer);
            dashboardAutoRefreshTimer = null;
        }
        dashboardAutoRefreshUntil = 0;
    }

    function startDashboardAutoRefresh(rerender, durationMs = DASHBOARD_AUTO_REFRESH_DURATION_MS) {
        stopDashboardAutoRefresh();
        dashboardAutoRefreshUntil = Date.now() + durationMs;
        dashboardAutoRefreshTimer = setInterval(() => {
            const overlay = document.getElementById('bbs-sign-dashboard-overlay');
            const shouldRerender = overlay?.dataset?.view === 'dashboard';
            if (!shouldRerender || !isDashboardAutoRefreshActive()) {
                stopDashboardAutoRefresh();
                if (shouldRerender && typeof rerender === 'function') rerender();
                return;
            }
            if (typeof rerender === 'function') rerender();
        }, DASHBOARD_AUTO_REFRESH_INTERVAL_MS);
    }

    function clearAutoOpenCountdown(suppressCurrent = false) {
        if (autoOpenTimer) {
            clearTimeout(autoOpenTimer);
            autoOpenTimer = null;
        }
        if (autoOpenCountdownTimer) {
            clearInterval(autoOpenCountdownTimer);
            autoOpenCountdownTimer = null;
        }
        if (suppressCurrent) {
            autoOpenSuppressedSignature = getAttentionSignature();
        }
        autoOpenCountdownLeft = 0;
        autoOpenReminderSignature = '';
    }

    function startAutoOpenCountdown(signature) {
        clearAutoOpenCountdown(false);
        autoOpenReminderSignature = signature;
        autoOpenCountdownLeft = 3;
        autoOpenCountdownTimer = setInterval(() => {
            autoOpenCountdownLeft = Math.max(0, autoOpenCountdownLeft - 1);
            updateDashboardReminderButton();
        }, 1000);
        autoOpenTimer = setTimeout(() => {
            const currentSignature = getAttentionSignature();
            const config = getDashboardConfig();
            clearAutoOpenCountdown(false);
            if (
                currentSignature &&
                currentSignature === signature &&
                config.preferences.autoOpenDashboardOnAttention &&
                !document.getElementById('bbs-sign-dashboard-overlay')
            ) {
                autoOpenSuppressedSignature = currentSignature;
                showDashboard('dashboard');
            } else {
                updateDashboardReminderButton();
            }
        }, 3000);
    }

    function syncAutoOpenCountdown(attentionTargets, autoOpenEnabled) {
        const signature = getAttentionSignature(attentionTargets);
        const overlayOpen = Boolean(document.getElementById('bbs-sign-dashboard-overlay'));
        if (!attentionTargets.length || !autoOpenEnabled || overlayOpen) {
            clearAutoOpenCountdown(false);
            return;
        }
        if (signature === autoOpenSuppressedSignature) {
            clearAutoOpenCountdown(false);
            return;
        }
        if (autoOpenTimer && autoOpenReminderSignature === signature) return;
        startAutoOpenCountdown(signature);
    }

    function setManualTargetStatus(target, status) {
        if (status === 'success' && target.siteKey) {
            markSignSuccess(target.siteKey, '已从控制台手动标记成功');
            return;
        }
        recordTargetStatus(target.id, status, {
            stage: 'manual',
            message: STATUS_META[status]?.message || '已手动更新状态',
            url: target.url
        });
    }

    function el(tag, options = {}, children = []) {
        const node = document.createElement(tag);
        if (options.className) node.className = options.className;
        if (options.text !== undefined) node.textContent = options.text;
        if (options.title) node.title = options.title;
        if (options.type) node.type = options.type;
        if (options.value !== undefined) node.value = options.value;
        if (options.placeholder) node.placeholder = options.placeholder;
        if (options.autocomplete) node.autocomplete = options.autocomplete;
        if (options.href) node.href = options.href;
        if (options.target) node.target = options.target;
        if (options.checked !== undefined) node.checked = options.checked;
        if (options.onClick) node.addEventListener('click', options.onClick);
        if (options.onChange) node.addEventListener('change', options.onChange);
        if (options.onInput) node.addEventListener('input', options.onInput);
        if (options.onFocus) node.addEventListener('focus', options.onFocus);
        if (options.onKeyDown) node.addEventListener('keydown', options.onKeyDown);
        for (const child of children) {
            if (child) node.append(child);
        }
        return node;
    }

    function shieldDashboardInput(input) {
        const stop = (event) => {
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
        };
        for (const eventName of ['keydown', 'keypress', 'keyup', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
            input.addEventListener(eventName, stop);
        }
        input.addEventListener('focus', (event) => {
            event.stopPropagation();
            setTimeout(() => input.focus(), 0);
        });
        return input;
    }

    function createSearchField(value, placeholder, onInput) {
        return shieldDashboardInput(el('input', {
            className: 'bbs-sign-field bbs-sign-search',
            type: 'search',
            value,
            placeholder,
            autocomplete: 'off',
            onInput
        }));
    }

    function createSelect(value, options, onChange) {
        const select = el('select', { className: 'bbs-sign-field', onChange });
        for (const option of options) {
            const item = el('option', { value: option.value, text: option.label });
            if (option.value === value) item.selected = true;
            select.append(item);
        }
        return shieldDashboardInput(select);
    }

    function addDashboardStyles() {
        if (document.getElementById('bbs-sign-dashboard-style')) return;
        GM_addStyle(`
            #bbs-sign-dashboard-button {
                position: fixed;
                right: 22px;
                bottom: 22px;
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                border: 1px solid rgba(15, 23, 42, 0.12);
                border-radius: 999px;
                padding: 11px 16px;
                color: #0f172a;
                background: rgba(255, 255, 255, 0.92);
                box-shadow: 0 16px 42px rgba(15, 23, 42, 0.18);
                font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                backdrop-filter: blur(14px);
            }
            #bbs-sign-dashboard-button.needs-attention {
                border-color: rgba(245, 158, 11, 0.7);
                color: #7c2d12;
                background: #fff7ed;
                box-shadow: 0 18px 50px rgba(217, 119, 6, 0.32);
                animation: bbs-sign-attention 1.9s ease-in-out infinite;
            }
            #bbs-sign-dashboard-button.needs-attention::after {
                content: "";
                position: absolute;
                inset: -7px;
                border: 2px solid rgba(245, 158, 11, 0.32);
                border-radius: 999px;
                animation: bbs-sign-pulse-ring 1.9s ease-out infinite;
                pointer-events: none;
            }
            #bbs-sign-dashboard-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 18px 48px rgba(15, 23, 42, 0.24);
            }
            #bbs-sign-dashboard-button.needs-attention:hover {
                box-shadow: 0 20px 54px rgba(217, 119, 6, 0.38);
            }
            .bbs-sign-dot {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: inline-grid;
                place-items: center;
                color: #ffffff;
                background: #2563eb;
                font-size: 13px;
            }
            #bbs-sign-dashboard-button.needs-attention .bbs-sign-dot {
                background: #f97316;
            }
            .bbs-sign-reminder-badge {
                position: absolute;
                top: -8px;
                right: -7px;
                min-width: 22px;
                height: 22px;
                box-sizing: border-box;
                display: inline-grid;
                place-items: center;
                border: 2px solid #ffffff;
                border-radius: 999px;
                padding: 0 6px;
                color: #ffffff;
                background: #ef4444;
                font-size: 12px;
                font-weight: 900;
                line-height: 1;
                box-shadow: 0 8px 22px rgba(239, 68, 68, 0.38);
            }
            .bbs-sign-reminder-badge[hidden] {
                display: none;
            }
            .bbs-sign-countdown {
                min-width: 32px;
                height: 24px;
                box-sizing: border-box;
                display: inline-grid;
                place-items: center;
                border-radius: 999px;
                padding: 0 8px;
                color: #9a3412;
                background: #ffedd5;
                font-size: 12px;
                font-weight: 900;
                line-height: 1;
            }
            .bbs-sign-auto-cancel {
                display: inline-flex;
                align-items: center;
                min-height: 24px;
                border: 1px solid rgba(251, 146, 60, 0.45);
                border-radius: 999px;
                padding: 3px 8px;
                color: #9a3412;
                background: rgba(255, 255, 255, 0.82);
                font-size: 12px;
                font-weight: 850;
            }
            .bbs-sign-auto-cancel:hover {
                background: #ffffff;
            }
            .bbs-sign-countdown[hidden],
            .bbs-sign-auto-cancel[hidden] {
                display: none;
            }
            @keyframes bbs-sign-attention {
                0%, 62%, 100% { transform: translateY(0) rotate(0deg); }
                68% { transform: translateY(-2px) rotate(-1.5deg); }
                74% { transform: translateY(1px) rotate(1.5deg); }
                80% { transform: translateY(-1px) rotate(-1deg); }
                86% { transform: translateY(0) rotate(0deg); }
            }
            @keyframes bbs-sign-pulse-ring {
                0% { opacity: 0.72; transform: scale(0.94); }
                72%, 100% { opacity: 0; transform: scale(1.18); }
            }
            @media (prefers-reduced-motion: reduce) {
                #bbs-sign-dashboard-button.needs-attention,
                #bbs-sign-dashboard-button.needs-attention::after {
                    animation: none;
                }
            }
            #bbs-sign-dashboard-overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: grid;
                place-items: center;
                padding: 24px;
                background: rgba(15, 23, 42, 0.36);
                backdrop-filter: blur(10px);
                animation: bbs-sign-overlay-in 180ms ease-out both;
            }
            .bbs-sign-panel {
                --bbs-sign-panel-radius: 18px;
                width: min(1060px, 100%);
                max-height: min(780px, calc(100vh - 48px));
                overflow: hidden;
                display: flex;
                flex-direction: column;
                color: #111827;
                background: #f8fafc;
                border: 1px solid rgba(148, 163, 184, 0.38);
                border-radius: var(--bbs-sign-panel-radius);
                box-shadow: 0 28px 90px rgba(15, 23, 42, 0.32);
                font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                transform-origin: center;
                will-change: transform, opacity, border-radius;
                animation: bbs-sign-panel-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .bbs-sign-panel.bbs-sign-panel-from-button {
                animation: bbs-sign-panel-from-button 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .bbs-sign-panel.bbs-sign-panel-from-button .bbs-sign-header,
            .bbs-sign-panel.bbs-sign-panel-from-button .bbs-sign-body {
                animation: bbs-sign-content-from-button 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            #bbs-sign-dashboard-overlay.bbs-sign-no-enter,
            #bbs-sign-dashboard-overlay.bbs-sign-no-enter .bbs-sign-panel {
                animation: none;
            }
            @keyframes bbs-sign-overlay-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes bbs-sign-panel-in {
                from {
                    opacity: 0;
                    transform: translateY(10px) scale(0.985);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            @keyframes bbs-sign-panel-from-button {
                0% {
                    opacity: 0.86;
                    border-radius: var(--bbs-sign-enter-radius, 999px);
                    transform:
                        translate3d(var(--bbs-sign-enter-x, 0), var(--bbs-sign-enter-y, 0), 0)
                        scale(var(--bbs-sign-enter-scale-x, 0.12), var(--bbs-sign-enter-scale-y, 0.08));
                }
                58% {
                    opacity: 1;
                    border-radius: calc(var(--bbs-sign-panel-radius, 18px) + 4px);
                }
                100% {
                    opacity: 1;
                    border-radius: var(--bbs-sign-panel-radius, 18px);
                    transform: translate3d(0, 0, 0) scale(1);
                }
            }
            @keyframes bbs-sign-content-from-button {
                0%, 42% {
                    opacity: 0;
                    transform: translateY(8px);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            .bbs-sign-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 20px 22px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.32);
                background: #ffffff;
            }
            .bbs-sign-title {
                margin: 0;
                font-size: 20px;
                line-height: 1.2;
                letter-spacing: 0;
            }
            .bbs-sign-subtitle {
                margin-top: 4px;
                color: #64748b;
                font-size: 13px;
            }
            .bbs-sign-close {
                min-width: 38px;
                height: 38px;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                background: #ffffff;
                color: #475569;
                cursor: pointer;
            }
            .bbs-sign-body {
                padding: 0 22px 22px;
                overflow: auto;
            }
            .bbs-sign-summary {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 12px;
                margin: 18px 0 16px;
            }
            .bbs-sign-card {
                min-width: 0;
                border: 1px solid #e2e8f0;
                border-radius: 14px;
                padding: 14px;
                background: #ffffff;
            }
            .bbs-sign-card-label {
                color: #64748b;
                font-size: 12px;
            }
            .bbs-sign-card-value {
                margin-top: 4px;
                font-size: 24px;
                font-weight: 800;
                line-height: 1.1;
            }
            .bbs-sign-toolbar,
            .bbs-sign-actions,
            .bbs-sign-row-actions,
            .bbs-sign-form-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .bbs-sign-toolbar {
                position: sticky;
                top: 0;
                z-index: 4;
                justify-content: space-between;
                margin: 0 -22px 14px;
                padding: 10px 22px;
                border-bottom: 1px solid rgba(226, 232, 240, 0.9);
                background: #f8fafc;
                box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
            }
            .bbs-sign-search-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: min(360px, 100%);
                flex: 1 1 320px;
            }
            .bbs-sign-search-wrap .bbs-sign-field {
                max-width: 420px;
            }
            .bbs-sign-button {
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 8px 11px;
                color: #0f172a;
                background: #ffffff;
                cursor: pointer;
                font-weight: 650;
                line-height: 1.2;
                white-space: nowrap;
            }
            .bbs-sign-button.primary {
                color: #ffffff;
                border-color: #2563eb;
                background: #2563eb;
            }
            .bbs-sign-button.danger {
                color: #be123c;
                border-color: #fecdd3;
                background: #fff1f2;
            }
            .bbs-sign-button.ghost {
                color: #475569;
                background: #f8fafc;
            }
            .bbs-sign-button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }
            .bbs-sign-list {
                display: grid;
                gap: 10px;
            }
            .bbs-sign-row,
            .bbs-sign-setting-row {
                display: grid;
                grid-template-columns: minmax(220px, 1fr) auto;
                gap: 12px;
                align-items: center;
                border: 1px solid #e2e8f0;
                border-radius: 14px;
                padding: 14px;
                background: #ffffff;
            }
            .bbs-sign-row-main {
                min-width: 0;
            }
            .bbs-sign-name-line {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 4px;
            }
            .bbs-sign-name {
                font-size: 15px;
                font-weight: 800;
                color: #0f172a;
            }
            .bbs-sign-url,
            .bbs-sign-message,
            .bbs-sign-meta {
                color: #64748b;
                font-size: 12px;
                overflow-wrap: anywhere;
            }
            .bbs-sign-message {
                margin-top: 3px;
                color: #334155;
            }
            .bbs-sign-badge {
                display: inline-flex;
                align-items: center;
                border-radius: 999px;
                padding: 3px 8px;
                font-size: 12px;
                font-weight: 800;
            }
            .bbs-sign-badge.success { color: #047857; background: #d1fae5; }
            .bbs-sign-badge.pending { color: #0369a1; background: #e0f2fe; }
            .bbs-sign-badge.warning { color: #b45309; background: #fef3c7; }
            .bbs-sign-badge.danger { color: #be123c; background: #ffe4e6; }
            .bbs-sign-badge.neutral { color: #475569; background: #e2e8f0; }
            .bbs-sign-badge.muted { color: #64748b; background: #f1f5f9; }
            .bbs-sign-section-title {
                margin: 18px 0 10px;
                font-size: 15px;
                font-weight: 800;
            }
            .bbs-sign-section-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin: 18px 0 10px;
                flex-wrap: wrap;
            }
            .bbs-sign-section-head .bbs-sign-section-title {
                margin: 0;
            }
            .bbs-sign-section-count {
                color: #64748b;
                font-size: 12px;
                font-weight: 750;
            }
            .bbs-sign-form {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
                border: 1px solid #e2e8f0;
                border-radius: 14px;
                padding: 14px;
                background: #ffffff;
                margin-bottom: 14px;
            }
            .bbs-sign-field-wrap {
                display: grid;
                gap: 5px;
                min-width: 0;
            }
            .bbs-sign-field-wrap.full {
                grid-column: 1 / -1;
            }
            .bbs-sign-label {
                color: #475569;
                font-size: 12px;
                font-weight: 750;
            }
            .bbs-sign-field {
                min-width: 0;
                width: 100%;
                box-sizing: border-box;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 8px 10px;
                color: #0f172a;
                background: #ffffff;
                font: inherit;
            }
            .bbs-sign-field:focus {
                border-color: #2563eb;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
                outline: none;
            }
            .bbs-sign-search {
                padding-left: 12px;
                background: #ffffff;
            }
            .bbs-sign-check {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                color: #334155;
                font-weight: 650;
            }
            @media (max-width: 760px) {
                #bbs-sign-dashboard-overlay {
                    padding: 10px;
                }
                .bbs-sign-panel {
                    --bbs-sign-panel-radius: 14px;
                    max-height: calc(100vh - 20px);
                }
                .bbs-sign-header,
                .bbs-sign-body {
                    padding-left: 14px;
                    padding-right: 14px;
                }
                .bbs-sign-summary {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
                .bbs-sign-toolbar,
                .bbs-sign-row,
                .bbs-sign-setting-row,
                .bbs-sign-form {
                    grid-template-columns: 1fr;
                }
                .bbs-sign-toolbar {
                    align-items: stretch;
                    margin-left: -14px;
                    margin-right: -14px;
                    padding-left: 14px;
                    padding-right: 14px;
                }
                .bbs-sign-actions,
                .bbs-sign-row-actions {
                    justify-content: flex-start;
                }
                .bbs-sign-button {
                    white-space: normal;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                #bbs-sign-dashboard-overlay,
                #bbs-sign-dashboard-overlay .bbs-sign-panel {
                    animation: none;
                }
            }
        `);
    }

    function createSummaryCard(label, value) {
        return el('div', { className: 'bbs-sign-card' }, [
            el('div', { className: 'bbs-sign-card-label', text: label }),
            el('div', { className: 'bbs-sign-card-value', text: String(value) })
        ]);
    }

    function createStatusBadge(status) {
        const meta = STATUS_META[status] || STATUS_META['not-started'];
        return el('span', { className: `bbs-sign-badge ${meta.tone}`, text: meta.label });
    }

    function createTargetRow(target, rerender) {
        const status = getNormalizedTargetStatus(target);
        const row = el('div', { className: 'bbs-sign-row' });
        const main = el('div', { className: 'bbs-sign-row-main' });
        main.append(
            el('div', { className: 'bbs-sign-name-line' }, [
                el('span', { className: 'bbs-sign-name', text: target.name }),
                createStatusBadge(status.status)
            ]),
            el('div', { className: 'bbs-sign-url', text: target.url }),
            el('div', { className: 'bbs-sign-message', text: status.message || STATUS_META[status.status]?.message || '' }),
            el('div', {
                className: 'bbs-sign-meta',
                text: `${target.directApi ? '控制台直签 · ' : ''}${OPEN_MODE_LABELS[target.openMode] || target.openMode} · ${RESULT_MODE_LABELS[target.resultMode] || target.resultMode} · 更新 ${getTimeLabel(status.updatedAt)}`
            })
        );
        if (target.note) {
            main.append(el('div', { className: 'bbs-sign-meta', text: target.note }));
        }

        const actions = el('div', { className: 'bbs-sign-row-actions' });
        const directBtn = target.directApi ? el('button', {
            className: 'bbs-sign-button primary',
            type: 'button',
            text: '直签',
            onClick: async () => {
                const promise = runDirectTarget(target, rerender);
                rerender();
                await promise;
                rerender();
            }
        }) : null;
        if (directBtn) directBtn.disabled = !target.enabled || status.status === 'running';

        const openBtn = el('button', {
            className: target.directApi ? 'bbs-sign-button ghost' : 'bbs-sign-button primary',
            type: 'button',
            text: target.openMode === 'foreground' ? '前台打开' : '打开',
            onClick: () => {
                launchTarget(target);
                rerender();
            }
        });
        openBtn.disabled = !target.enabled;
        const rowActions = [
            ...(directBtn ? [directBtn] : []),
            openBtn,
            el('button', {
                className: 'bbs-sign-button',
                type: 'button',
                text: '成功',
                onClick: () => {
                    setManualTargetStatus(target, 'success');
                    rerender();
                }
            }),
            el('button', {
                className: 'bbs-sign-button',
                type: 'button',
                text: '失败',
                onClick: () => {
                    setManualTargetStatus(target, 'failed');
                    rerender();
                }
            }),
            el('button', {
                className: 'bbs-sign-button ghost',
                type: 'button',
                text: '跳过',
                onClick: () => {
                    setManualTargetStatus(target, 'skipped');
                    rerender();
                }
            })
        ];
        actions.append(...rowActions);

        row.append(main, actions);
        return row;
    }

    function getDashboardSummary(targets) {
        const enabledTargets = targets.filter(target => target.enabled);
        const summary = { total: enabledTargets.length, success: 0, pending: 0, failed: 0, todo: 0 };
        for (const target of enabledTargets) {
            const status = getNormalizedTargetStatus(target).status;
            if (status === 'success') {
                summary.success += 1;
            } else if (status === 'failed') {
                summary.failed += 1;
            } else if (status === 'running' || status === 'opened' || status === 'needs-login' || status === 'needs-foreground') {
                summary.pending += 1;
            } else if (status !== 'skipped') {
                summary.todo += 1;
            }
        }
        return summary;
    }

    function splitDashboardTargets(targets) {
        const groups = {
            unopened: [],
            openedPending: [],
            completed: []
        };

        for (const target of targets) {
            const status = getNormalizedTargetStatus(target).status;
            if (status === 'not-started') {
                groups.unopened.push(target);
            } else if (status === 'success' || status === 'skipped') {
                groups.completed.push(target);
            } else {
                groups.openedPending.push(target);
            }
        }

        return groups;
    }

    function markTargetsSuccess(targets) {
        for (const target of targets) {
            setManualTargetStatus(target, 'success');
        }
    }

    function createDashboardSection(title, targets, rerender, options = {}) {
        const section = el('section', { className: 'bbs-sign-section' });
        const headActions = [];
        if (options.showBatchSuccess && targets.length) {
            headActions.push(el('button', {
                className: 'bbs-sign-button primary',
                type: 'button',
                text: '全部标记成功',
                onClick: () => {
                    markTargetsSuccess(targets);
                    rerender();
                }
            }));
        }
        section.append(el('div', { className: 'bbs-sign-section-head' }, [
            el('div', { className: 'bbs-sign-name-line' }, [
                el('div', { className: 'bbs-sign-section-title', text: title }),
                el('span', { className: 'bbs-sign-section-count', text: `${targets.length} 个` })
            ]),
            headActions.length ? el('div', { className: 'bbs-sign-row-actions' }, headActions) : null
        ]));

        if (!targets.length) {
            section.append(el('div', { className: 'bbs-sign-card', text: options.emptyText || '暂无站点。' }));
            return section;
        }

        const list = el('div', { className: 'bbs-sign-list' });
        for (const target of targets) {
            list.append(createTargetRow(target, rerender));
        }
        section.append(list);
        return section;
    }

    function renderDashboardView(body, rerender) {
        const targets = getAllTargets().filter(target => target.enabled);
        syncLaunchedAutoCloseTabs(targets);
        const visibleTargets = targets.filter(target => targetMatchesSearch(target, dashboardSearchQuery));
        const summary = getDashboardSummary(targets);
        const launchableTargets = getLaunchableTargets();
        const directRunnableTargets = getDirectRunnableTargets();
        const groups = splitDashboardTargets(visibleTargets);
        const autoRefreshLeft = getDashboardAutoRefreshLeftSeconds();
        const searchInput = createSearchField(dashboardSearchQuery, '搜索站点名称、网址或备注', (event) => {
            dashboardSearchQuery = event.target.value;
            showDashboard('dashboard');
        });

        body.append(
            el('div', { className: 'bbs-sign-summary' }, [
                createSummaryCard('已成功', summary.success),
                createSummaryCard('失败', summary.failed),
                createSummaryCard('待处理', summary.pending),
                createSummaryCard('未开始', summary.todo)
            ]),
            el('div', { className: 'bbs-sign-toolbar' }, [
                el('div', { className: 'bbs-sign-search-wrap' }, [
                    searchInput,
                    el('span', { className: 'bbs-sign-message', text: `${visibleTargets.length}/${targets.length}` })
                ]),
                el('div', { className: 'bbs-sign-actions' }, [
                    el('button', {
                        className: 'bbs-sign-button primary',
                        type: 'button',
                        text: '一键处理未完成',
                        onClick: async () => {
                            startDashboardAutoRefresh(rerender);
                            rerender();
                            const directSignPromise = runDirectTargets(getDirectRunnableTargets(), rerender);
                            for (const target of getLaunchableTargets()) {
                                launchTarget(target);
                            }
                            rerender();
                            await directSignPromise;
                            startDashboardAutoRefresh(rerender);
                            rerender();
                        }
                    }),
                    el('button', {
                        className: 'bbs-sign-button',
                        type: 'button',
                        text: '一键直签',
                        onClick: async () => {
                            startDashboardAutoRefresh(rerender);
                            rerender();
                            await runDirectTargets(getDirectRunnableTargets(), rerender);
                            startDashboardAutoRefresh(rerender);
                            rerender();
                        }
                    }),
                    el('button', {
                        className: 'bbs-sign-button',
                        type: 'button',
                        text: '刷新状态',
                        onClick: rerender
                    }),
                    el('button', {
                        className: 'bbs-sign-button',
                        type: 'button',
                        text: '配置清单',
                        onClick: () => showDashboard('settings')
                    })
                ])
            ])
        );

        body.append(el('div', {
            className: 'bbs-sign-message',
            text: `今天 ${getToday()}，还有 ${directRunnableTargets.length} 个目标可控制台直签，${launchableTargets.length} 个目标需要打开页面。${autoRefreshLeft ? `自动刷新状态中，约 ${autoRefreshLeft} 秒后停止。` : '已禁用站点已从控制台隐藏，可在配置清单中管理。'}`
        }));

        if (!targets.length) {
            body.append(el('div', { className: 'bbs-sign-card', text: '暂无启用的签到目标，请到配置清单启用或添加自定义目标。' }));
            return;
        }

        if (!visibleTargets.length) {
            body.append(el('div', { className: 'bbs-sign-card', text: '没有匹配当前搜索的启用站点。' }));
            return;
        }

        body.append(
            createDashboardSection('未打开', groups.unopened, rerender, {
                emptyText: '所有匹配站点都已经打开或处理过。'
            }),
            createDashboardSection('已打开但未标记成功', groups.openedPending, rerender, {
                showBatchSuccess: true,
                emptyText: '暂无需要确认的已打开站点。'
            }),
            createDashboardSection('已完成', groups.completed, rerender, {
                emptyText: '暂无已完成站点。'
            })
        );
    }

    function createField(label, input, full = false) {
        return el('label', { className: `bbs-sign-field-wrap${full ? ' full' : ''}` }, [
            el('span', { className: 'bbs-sign-label', text: label }),
            input
        ]);
    }

    function renderSettingsView(body, editingId = '') {
        const config = getDashboardConfig();
        const allBuiltInTargets = getBuiltInTargets();
        const allCustomTargets = getCustomTargets();
        const builtInTargets = allBuiltInTargets.filter(target => targetMatchesSearch(target, settingsSearchQuery));
        const customTargets = allCustomTargets.filter(target => targetMatchesSearch(target, settingsSearchQuery));
        const editingTarget = allCustomTargets.find(target => target.id === editingId) || null;
        const searchInput = createSearchField(settingsSearchQuery, '搜索配置项、网址或备注', (event) => {
            settingsSearchQuery = event.target.value;
            showDashboard('settings', editingId);
        });

        body.append(
            el('div', { className: 'bbs-sign-toolbar' }, [
                el('div', { className: 'bbs-sign-search-wrap' }, [
                    searchInput,
                    el('span', { className: 'bbs-sign-message', text: `${builtInTargets.length + customTargets.length}/${allBuiltInTargets.length + allCustomTargets.length}` })
                ]),
                el('div', { className: 'bbs-sign-actions' }, [
                    el('button', {
                        className: 'bbs-sign-button',
                        type: 'button',
                        text: '返回控制台',
                        onClick: () => showDashboard('dashboard')
                    })
                ])
            ])
        );

        body.append(el('div', { className: 'bbs-sign-message', text: '维护每日需要打开的签到站点。脚本检测目标会自动更新结果，自定义目标默认需要手动确认。' }));
        const autoOpenInput = el('input', {
            type: 'checkbox',
            checked: config.preferences.autoOpenDashboardOnAttention,
            onChange: (event) => {
                updateDashboardPreference({ autoOpenDashboardOnAttention: event.target.checked });
                showDashboard('settings', editingId);
            }
        });
        const autoCloseInput = el('input', {
            type: 'checkbox',
            checked: config.preferences.autoClosePageAfterSign,
            onChange: (event) => {
                updateDashboardPreference({ autoClosePageAfterSign: event.target.checked });
                showDashboard('settings', editingId);
            }
        });
        body.append(
            el('div', { className: 'bbs-sign-section-title', text: '控制台选项' }),
            el('div', { className: 'bbs-sign-card' }, [
                el('label', { className: 'bbs-sign-check' }, [
                    autoOpenInput,
                    el('span', { text: '提醒状态下 3 秒后自动展开控制台' })
                ]),
                el('label', { className: 'bbs-sign-check' }, [
                    autoCloseInput,
                    el('span', { text: '签到动作完成后自动关闭站点页面' })
                ]),
                el('div', { className: 'bbs-sign-meta', text: '倒计时会显示在悬浮按钮上，可点击“取消”停止本次自动展开；自动关闭仅在脚本本次完成点击、提交或接口签到后尝试执行，打开时已签到不会关闭。' })
            ])
        );

        body.append(el('div', { className: 'bbs-sign-section-title', text: '内置签到站点' }));
        const builtInList = el('div', { className: 'bbs-sign-list' });
        if (!builtInTargets.length) {
            builtInList.append(el('div', { className: 'bbs-sign-card', text: '没有匹配当前搜索的内置站点。' }));
        }
        for (const target of builtInTargets) {
            const row = el('div', { className: 'bbs-sign-setting-row' });
            const checkbox = el('input', {
                type: 'checkbox',
                checked: target.enabled,
                onChange: (event) => updateBuiltInTargetSetting(target.id, { enabled: event.target.checked })
            });
            const openSelect = createSelect(target.openMode, [
                { value: 'background', label: '后台打开' },
                { value: 'foreground', label: '前台打开' },
                { value: 'manual', label: '手动打开' }
            ], (event) => updateBuiltInTargetSetting(target.id, { openMode: event.target.value }));
            const resultSelect = createSelect(target.resultMode, [
                { value: 'script', label: '脚本检测' },
                { value: 'opened', label: '打开待确认' },
                { value: 'manual', label: '手动确认' }
            ], (event) => updateBuiltInTargetSetting(target.id, { resultMode: event.target.value }));
            row.append(
                el('div', { className: 'bbs-sign-row-main' }, [
                    el('label', { className: 'bbs-sign-check' }, [
                        checkbox,
                        el('span', { className: 'bbs-sign-name', text: target.name })
                    ]),
                    el('div', { className: 'bbs-sign-url', text: target.url }),
                    target.note ? el('div', { className: 'bbs-sign-meta', text: target.note }) : null
                ]),
                el('div', { className: 'bbs-sign-row-actions' }, [
                    openSelect,
                    resultSelect
                ])
            );
            builtInList.append(row);
        }
        body.append(builtInList);

        body.append(el('div', { className: 'bbs-sign-section-title', text: editingTarget ? '编辑自定义站点' : '添加自定义站点' }));
        const nameInput = shieldDashboardInput(el('input', { className: 'bbs-sign-field', value: editingTarget?.name || '', placeholder: '站点名称', autocomplete: 'off' }));
        const urlInput = shieldDashboardInput(el('input', { className: 'bbs-sign-field', value: editingTarget?.url || '', placeholder: 'https://example.com/checkin', autocomplete: 'off' }));
        const noteInput = shieldDashboardInput(el('input', { className: 'bbs-sign-field', value: editingTarget?.note || '', placeholder: '备注，可选', autocomplete: 'off' }));
        const enabledInput = el('input', { type: 'checkbox', checked: editingTarget ? editingTarget.enabled : true });
        const openSelect = createSelect(editingTarget?.openMode || 'background', [
            { value: 'background', label: '后台打开' },
            { value: 'foreground', label: '前台打开' },
            { value: 'manual', label: '手动打开' }
        ]);
        const resultSelect = createSelect(editingTarget?.resultMode || 'opened', [
            { value: 'opened', label: '打开待确认' },
            { value: 'manual', label: '手动确认' }
        ]);

        body.append(el('div', { className: 'bbs-sign-form' }, [
            createField('名称', nameInput),
            createField('签到网址', urlInput),
            createField('打开方式', openSelect),
            createField('结果确认', resultSelect),
            createField('备注', noteInput, true),
            el('label', { className: 'bbs-sign-check' }, [
                enabledInput,
                el('span', { text: '启用这个目标' })
            ]),
            el('div', { className: 'bbs-sign-form-actions' }, [
                el('button', {
                    className: 'bbs-sign-button primary',
                    type: 'button',
                    text: editingTarget ? '保存修改' : '添加目标',
                    onClick: () => {
                        const ok = saveCustomTarget({
                            id: editingTarget?.id,
                            name: nameInput.value,
                            url: urlInput.value,
                            enabled: enabledInput.checked,
                            openMode: openSelect.value,
                            resultMode: resultSelect.value,
                            note: noteInput.value
                        });
                        if (ok) showDashboard('settings');
                    }
                }),
                editingTarget ? el('button', {
                    className: 'bbs-sign-button',
                    type: 'button',
                    text: '取消编辑',
                    onClick: () => showDashboard('settings')
                }) : null
            ])
        ]));

        body.append(el('div', { className: 'bbs-sign-section-title', text: '自定义站点' }));
        const customList = el('div', { className: 'bbs-sign-list' });
        if (!allCustomTargets.length) {
            customList.append(el('div', { className: 'bbs-sign-card', text: '还没有自定义目标。可以添加那些打开后自动签到、或需要每日手动确认的网站。' }));
        } else if (!customTargets.length) {
            customList.append(el('div', { className: 'bbs-sign-card', text: '没有匹配当前搜索的自定义站点。' }));
        }
        for (const target of customTargets) {
            customList.append(el('div', { className: 'bbs-sign-setting-row' }, [
                el('div', { className: 'bbs-sign-row-main' }, [
                    el('div', { className: 'bbs-sign-name-line' }, [
                        el('span', { className: 'bbs-sign-name', text: target.name }),
                        createStatusBadge(target.enabled ? 'opened' : 'disabled')
                    ]),
                    el('div', { className: 'bbs-sign-url', text: target.url }),
                    el('div', { className: 'bbs-sign-meta', text: `${OPEN_MODE_LABELS[target.openMode]} · ${RESULT_MODE_LABELS[target.resultMode]}${target.note ? ` · ${target.note}` : ''}` })
                ]),
                el('div', { className: 'bbs-sign-row-actions' }, [
                    el('button', {
                        className: 'bbs-sign-button',
                        type: 'button',
                        text: '编辑',
                        onClick: () => showDashboard('settings', target.id)
                    }),
                    el('button', {
                        className: 'bbs-sign-button danger',
                        type: 'button',
                        text: '删除',
                        onClick: () => {
                            if (confirm(`删除自定义目标「${target.name}」？`)) {
                                deleteCustomTarget(target.id);
                                showDashboard('settings');
                            }
                        }
                    })
                ])
            ]));
        }
        body.append(customList);
    }

    function prepareDashboardOpenAnimation(panel, sourceRect) {
        if (!sourceRect) return false;
        const panelRect = panel.getBoundingClientRect();
        if (!panelRect.width || !panelRect.height || !sourceRect.width || !sourceRect.height) return false;

        const sourceCenterX = sourceRect.left + sourceRect.width / 2;
        const sourceCenterY = sourceRect.top + sourceRect.height / 2;
        const panelCenterX = panelRect.left + panelRect.width / 2;
        const panelCenterY = panelRect.top + panelRect.height / 2;
        const scaleX = Math.min(1, Math.max(0.08, sourceRect.width / panelRect.width));
        const scaleY = Math.min(1, Math.max(0.06, sourceRect.height / panelRect.height));

        panel.style.setProperty('--bbs-sign-enter-x', `${sourceCenterX - panelCenterX}px`);
        panel.style.setProperty('--bbs-sign-enter-y', `${sourceCenterY - panelCenterY}px`);
        panel.style.setProperty('--bbs-sign-enter-scale-x', String(scaleX));
        panel.style.setProperty('--bbs-sign-enter-scale-y', String(scaleY));
        panel.style.setProperty('--bbs-sign-enter-radius', '999px');
        panel.classList.add('bbs-sign-panel-from-button');
        return true;
    }

    function closeDashboardOverlay(overlay) {
        stopDashboardAutoRefresh();
        overlay.remove();
        updateDashboardReminderButton();
    }

    function showDashboard(view = 'dashboard', editingId = '') {
        addDashboardStyles();
        if (view !== 'dashboard') stopDashboardAutoRefresh();
        const existing = document.getElementById('bbs-sign-dashboard-overlay');
        const hadExisting = Boolean(existing);
        const launcherRect = !hadExisting
            ? document.getElementById('bbs-sign-dashboard-button')?.getBoundingClientRect()
            : null;
        clearAutoOpenCountdown(true);
        const shouldRefocusSearch = existing?.contains(document.activeElement) &&
            document.activeElement?.classList?.contains('bbs-sign-search');
        const searchSelectionStart = shouldRefocusSearch ? document.activeElement.selectionStart : null;
        const existingView = existing?.dataset?.view || view;
        const existingBody = existing?.querySelector('.bbs-sign-body');
        if (existingBody) {
            if (existingView === 'settings') {
                settingsBodyScrollTop = existingBody.scrollTop;
            } else {
                dashboardBodyScrollTop = existingBody.scrollTop;
            }
        }
        if (existing) existing.remove();

        const overlay = el('div', { className: hadExisting ? 'bbs-sign-no-enter' : '', onClick: (event) => {
            if (event.target === overlay) closeDashboardOverlay(overlay);
        }});
        overlay.id = 'bbs-sign-dashboard-overlay';
        overlay.dataset.view = view;

        const panel = el('section', { className: 'bbs-sign-panel' });
        if (launcherRect) {
            panel.style.visibility = 'hidden';
            panel.style.animation = 'none';
        }
        for (const eventName of ['keydown', 'keypress', 'keyup', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
            panel.addEventListener(eventName, (event) => {
                if (event.target.closest('input, textarea, select')) {
                    event.stopPropagation();
                }
            }, true);
        }
        const body = el('div', { className: 'bbs-sign-body' });
        const rerender = () => showDashboard(view, editingId);
        panel.append(
            el('header', { className: 'bbs-sign-header' }, [
                el('div', {}, [
                    el('h2', { className: 'bbs-sign-title', text: view === 'settings' ? '签到清单配置' : '每日签到控制台' }),
                    el('div', { className: 'bbs-sign-subtitle', text: '集中打开、查看和确认每日论坛签到状态' })
                ]),
                el('button', {
                    className: 'bbs-sign-close',
                    type: 'button',
                    text: '关闭',
                    onClick: () => closeDashboardOverlay(overlay)
                })
            ]),
            body
        );

        if (view === 'settings') {
            renderSettingsView(body, editingId);
        } else {
            renderDashboardView(body, rerender);
        }

        overlay.append(panel);
        document.body.append(overlay);
        if (launcherRect) {
            const hasLauncherAnimation = prepareDashboardOpenAnimation(panel, launcherRect);
            requestAnimationFrame(() => {
                if (!hasLauncherAnimation) {
                    panel.classList.remove('bbs-sign-panel-from-button');
                }
                panel.style.visibility = '';
                panel.style.animation = '';
            });
        }
        body.scrollTop = view === 'settings' ? settingsBodyScrollTop : dashboardBodyScrollTop;
        if (shouldRefocusSearch) {
            const searchInput = body.querySelector('.bbs-sign-search');
            if (searchInput) {
                setTimeout(() => {
                    searchInput.focus();
                    const caret = Number.isFinite(searchSelectionStart) ? searchSelectionStart : searchInput.value.length;
                    searchInput.setSelectionRange(caret, caret);
                }, 0);
            }
        }
        updateDashboardReminderButton();
    }

    function initDashboardEntry() {
        addDashboardStyles();
        if (!document.getElementById('bbs-sign-dashboard-button')) {
            const btn = el('button', {
                className: '',
                type: 'button',
                title: '打开每日签到控制台',
                onClick: () => {
                    clearAutoOpenCountdown(true);
                    showDashboard();
                }
            }, [
                el('span', { className: 'bbs-sign-dot', text: '签' }),
                el('span', { className: 'bbs-sign-button-label', text: '签到控制台' }),
                el('span', { className: 'bbs-sign-countdown', text: '3s' }),
                el('span', {
                    className: 'bbs-sign-auto-cancel',
                    text: '取消',
                    onClick: (event) => {
                        event.stopPropagation();
                        clearAutoOpenCountdown(true);
                        updateDashboardReminderButton();
                    }
                }),
                el('span', { className: 'bbs-sign-reminder-badge', text: '0' })
            ]);
            btn.id = 'bbs-sign-dashboard-button';
            document.body.append(btn);
        }
        updateDashboardReminderButton();
    }

    function updateDashboardReminderButton() {
        if (!isLimestartHost()) return;
        const btn = document.getElementById('bbs-sign-dashboard-button');
        if (!btn) return;

        const attentionTargets = getAttentionTargets();
        const attentionCount = attentionTargets.length;
        const config = getDashboardConfig();
        const badge = btn.querySelector('.bbs-sign-reminder-badge');
        const label = btn.querySelector('.bbs-sign-button-label');
        const countdown = btn.querySelector('.bbs-sign-countdown');
        const cancelAuto = btn.querySelector('.bbs-sign-auto-cancel');
        const hasAttention = attentionCount > 0;

        syncAutoOpenCountdown(attentionTargets, config.preferences.autoOpenDashboardOnAttention);
        const hasCountdown = hasAttention && config.preferences.autoOpenDashboardOnAttention && autoOpenCountdownLeft > 0;

        btn.classList.toggle('needs-attention', hasAttention);
        btn.classList.toggle('auto-open-pending', hasCountdown);
        btn.title = hasAttention
            ? (hasCountdown
                ? `还有 ${attentionCount} 个启用站点今日未完成，${autoOpenCountdownLeft} 秒后自动展开`
                : `还有 ${attentionCount} 个启用站点今日未完成`)
            : '打开每日签到控制台';

        if (label) {
            label.textContent = hasAttention ? `待处理 ${attentionCount}` : '签到控制台';
        }
        if (countdown) {
            countdown.hidden = !hasCountdown;
            countdown.textContent = `${autoOpenCountdownLeft}s`;
        }
        if (cancelAuto) {
            cancelAuto.hidden = !hasCountdown;
        }
        if (badge) {
            badge.hidden = !hasAttention;
            badge.textContent = attentionCount > 99 ? '99+' : String(attentionCount);
        }
    }

    function registerSignDebugMenus() {
        GM_registerMenuCommand('下载签到失败调试日志（保留3天）', downloadSignDebugLogs);
        GM_registerMenuCommand('清空签到失败调试日志', clearSignDebugLogs);
    }

    function registerDashboardMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        registerSignDebugMenus();
        if (isLimestartHost()) {
            GM_registerMenuCommand('打开签到控制台', () => showDashboard());
            return;
        }
        GM_registerMenuCommand('打开签到控制台主页', () => {
            openUrl('https://www.limestart.cn/', 'foreground');
        });
    }

    // ================== 主引擎核心 ==================

    const todayStr = getToday();
    const currentHost = window.location.hostname;

    registerDashboardMenu();

    if (isLimestartHost(currentHost)) {
        initDashboardEntry();
        return;
    }

    for (const site of siteConfigs) {
        // 匹配域名
        const isMatch = site.matches.some(domain => currentHost.includes(domain));
        if (isMatch) {
            console.log(`[签到助手] 进入 ${site.name} 模块`);

            const lastSignDate = getData(site.key);
            const shouldRecheckUuGgSignPage = site.key === 'uugg' && /plugin\.php\?id=dsu_paulsign(?::|%3A)sign/i.test(location.href);
            if (lastSignDate === todayStr && !shouldRecheckUuGgSignPage) {
                console.log(`[签到助手] ${site.name} 今日已完成，跳过。`);
                recordTargetStatus(site.key, 'success', {
                    stage: 'skip',
                    message: '今日已完成，跳过执行',
                    url: location.href,
                    autoClosePageSignToastAfterMs: PAGE_COMPLETED_TOAST_AUTO_CLOSE_MS,
                    countCompletedPageSignToast: true
                });
                maybeAutoClosePageAfterSign(site.key);
                return; // 当日已执行，退出
            }

            const debugContext = startSignDebugCapture(site.key, site.name, 'site-run');
            try {
                recordTargetStatus(site.key, 'running', {
                    stage: 'run',
                    message: `${site.name} 签到处理中`,
                    url: location.href
                });
                const beforeStatus = getRawTargetStatus(site.key);
                // 运行该站点的特定逻辑，如果执行完成返回 true，则保存今天的日期
                let isSuccess = await site.run();
                if (!isSuccess) {
                    isSuccess = await waitForSiteSuccessRecheck(site);
                }
                if (isSuccess) {
                    if (getData(site.key) !== todayStr) {
                        markSignSuccess(site.key);
                    }
                } else {
                    const rawAfterStatus = getRawTargetStatus(site.key);
                    if (!rawAfterStatus || rawAfterStatus.updatedAt === beforeStatus?.updatedAt) {
                        const isSstm = site.key === 'sstm';
                        recordTargetStatus(site.key, isSstm ? 'needs-foreground' : 'opened', {
                            stage: 'run',
                            message: isSstm
                                ? '本次未确认成功，SS同盟可能需要前台页面继续处理'
                                : '本次未确认成功，可能正在跳转或等待页面确认',
                            url: location.href
                        });
                    }
                    const afterStatus = getRawTargetStatus(site.key);
                    persistSignDebugFailure(debugContext, {
                        outcome: 'failed',
                        status: afterStatus?.status || 'opened',
                        stage: afterStatus?.stage || 'run',
                        message: afterStatus?.message || '站点脚本未确认签到成功'
                    });
                }
            } catch (err) {
                console.error(`[签到助手] ${site.name} 执行时发生错误:`, err);
                recordTargetStatus(site.key, 'failed', {
                    stage: 'error',
                    message: `执行异常：${stringifyDebugError(err) || '未知错误'}`,
                    url: location.href
                });
                persistSignDebugFailure(debugContext, {
                    outcome: 'error',
                    status: 'failed',
                    stage: 'error',
                    message: stringifyDebugError(err)
                });
            } finally {
                finishSignDebugCapture(debugContext);
            }
            break; // 匹配到一个站点后就不再往下走了
        }
    }

})();
