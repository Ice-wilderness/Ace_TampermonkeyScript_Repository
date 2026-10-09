// ==UserScript==
// @name         【自写】自用论坛辅助签到自写
// @namespace    bbshelperforme
// @version      2.20.0
// @description  论坛辅助签到工具 - 支持 limestart 签到控制台、多站独立签到、状态复查与配置备份恢复
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
// @match        http*://sjs96.com/*
// @match        http*://laowang.vip/*
// @match        *://sp6m.fwsefwef66s.com/*
// @match        http*://www.vikacg.com/*
// @match        http*://feixueacg.org/*
// @match        http*://www.acgndog.com/*
// @match        http*://www.galgamex.net/*
// @match        http*://zodgame.xyz/*
// @match        http*://www.uu-gg.one/*
// @match        http*://www.fufugal.com/*
// @match        https://www.sehuatang.org/*
// @match        *://sstm.moe/*
// @connect      feixueacg.org
// @connect      www.south-plus.net
// @connect      www.sl-asmr.com
// @connect      bbs.kfpromax.com
// @connect      sjs96.com
// @connect      www.galgamex.net
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_listValues
// @grant        GM_deleteValue
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
        autoClosePending: 'BBSSignHelperAutoClosePending',
        mutation: 'BBSSignHelperMutation',
        task: 'BBSSignHelperTask',
        recovery: 'BBSSignHelperRecovery',
        importPending: 'BBSSignHelperImportPending'
    };

    const DEBUG_LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
    const DEBUG_LOG_TEXT_LIMIT = 6000;
    const DEBUG_LOG_MAX_SESSIONS = 80;
    const DEBUG_LOG_MAX_ENTRIES_PER_SESSION = 50;
    const DEBUG_SENSITIVE_KEY_RE = /authorization|cookie|set-cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey|_?nonce/i;
    const DEBUG_TEXT_RESPONSE_RE = /json|text|xml|html|javascript|form|plain|gbk|gb2312/i;
    const PAGE_COMPLETED_TOAST_AUTO_CLOSE_MS = 3000;
    const PAGE_COMPLETED_TOAST_DAILY_LIMIT = 3;
    const DIRECT_SIGN_RETRY_ATTEMPTS = 3;
    const DIRECT_SIGN_RETRY_DELAY_MS = 3000;
    const REQUEST_TIMEOUT_MS = 20000;
    const AUTO_CLOSE_PENDING_TTL_MS = 10 * 60 * 1000;
    const CLOSE_PAGE_AFTER_SIGN_ACTION = { closePageAfterSignAction: true };

    const STATUS_META = {
        'not-started': { label: '待开始', tone: 'neutral', message: '今日尚未处理' },
        running: { label: '执行中', tone: 'pending', message: '正在执行签到请求' },
        queued: { label: '排队中', tone: 'pending', message: '等待执行名额' },
        'result-unknown': { label: '待检查', tone: 'warning', message: '已提交但结果未确认，请重新检查' },
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
    let launchedAutoCloseMonitorTimer = null;
    const launchedAutoCloseTabs = new Map();
    let dismissedPageSignToastSignature = '';
    let pageSignToastAutoCloseTimer = null;
    let uuGgPageSubmitAttempted = false;
    const captchaAutoSubmitStates = new Map();
    const pageObserverStops = new Set();
    const pageOperations = new Map();
    const requestContexts = new Map();
    const executionOwnerId = newOperationId();
    const directTasks = new Map();
    let manualUndo = null;
    let manualUndoTimer = null;
    let reminderDismissedDay = '';
    let dashboardMounted = null;
    let syncListenerIds = [];
    let syncPollTimer = null;
    let midnightTimer = null;
    let syncRefreshTimer = null;
    let syncDay = '';
    let syncStarted = false;

    function newOperationId() {
        return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function captureOperation(key) {
        return { key, date: getToday(), mutationId: GM_getValue(getScopedStorageKey(STORAGE_KEYS.mutation, key), '') };
    }

    function isOperationCurrent(context, allowFinished = false) {
        return !context || (context.date === getToday() && context.mutationId === GM_getValue(getScopedStorageKey(STORAGE_KEYS.mutation, context.key), '') &&
            (!context.taskId || (getTaskLease(context.key)?.taskId === context.taskId && (getTaskLease(context.key).expiresAt > Date.now() || (allowFinished && getTaskLease(context.key).expiresAt === 0)))));
    }

    function taskActions(debugContext) {
        return {
            completeSign: (key, message, options = {}) => completeSign(key, message, { ...options, evidence: { kind: 'site-result', date: (debugContext?.operation || pageOperations.get(key))?.date || getToday(), summary: message }, context: debugContext?.operation || pageOperations.get(key) }),
            recordTargetStatus: (key, status, options = {}) => recordTargetStatus(key, status, { ...options, context: debugContext?.operation || pageOperations.get(key) })
        };
    }

    function requestContextForUrl(url) {
        try {
            const host = new URL(url, location.href).hostname;
            const site = siteConfigs.find(item => item.matches.some(domain => host === domain || host.endsWith('.' + domain)));
            return site ? requestContexts.get(site.key) : null;
        } catch (err) { return null; }
    }

    function getSstmUser() {
        const link = document.querySelector('#elUserLink');
        const profileLink = document.querySelector('#elUserLink_menu a[href*="/profile/"], [data-role="replyArea"] a.ipsUserPhoto[href*="/profile/"]');
        const href = profileLink?.getAttribute('href') || link?.getAttribute('href') || '';
        const profile = href.match(/\/profile\/(\d+)(?:-|\/|$)/)?.[1] || '';
        return { id: profile, profile: href.match(/\/profile\/[^?#]+/)?.[0].replace(/\/$/, '') || '', name: link?.textContent.trim() || profileLink?.querySelector('img')?.getAttribute('alt') || '' };
    }

    function findSstmDailyComment(root = document, user = getSstmUser()) {
        if (!user.id && !user.name) return null;
        const now = new Date();
        const title = root.querySelector('h1.ipsType_pageTitle')?.textContent || '';
        const today = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        if (!new RegExp(today + '(?![0-9])').test(title)) return null;
        return Array.from(root.querySelectorAll('article.ipsComment, [data-role="commentFeed"] article')).find(comment => {
            const author = comment.querySelector('aside.cAuthorPane h3 a, .cAuthorPane_author a, .ipsComment_author a');
            if (!author) return false;
            const authorId = (author.getAttribute('href') || '').match(/\/profile\/(\d+)(?:-|\/|$)/)?.[1];
            const authorProfile = (author.getAttribute('href') || '').match(/\/profile\/[^?#]+/)?.[0].replace(/\/$/, '');
            const isMine = user.id && authorId ? user.id === authorId : (user.profile && user.profile === authorProfile) || (user.name && author.textContent.trim() === user.name);
            if (!isMine) return false;
            const content = comment.querySelector('[data-role="commentContent"], .ipsComment_content') || comment;
            const published = content.cloneNode(true);
            published.querySelectorAll('.ipsComposeArea, [contenteditable], .cke, iframe, form, textarea, .ipsComment_edit').forEach(node => node.remove());
            const postedAt = comment.querySelector('time[datetime]')?.getAttribute('datetime');
            const date = postedAt ? new Date(postedAt) : null;
            return published.textContent.includes(`${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`) ||
                Boolean(date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate());
        }) || null;
    }

    function isSstmSignedToday() {
        return Boolean(findSstmDailyComment());
    }

    async function checkSstmPublished(debugContext, user = getSstmUser()) {
        if (findSstmDailyComment(document, user)) return true;
        // 论坛提供“只看该作者”，一次过滤请求即可检查本人评论，不逐页遍历。
        const authorLink = document.querySelector('a[href*="view_author="]');
        if (!user.id || !authorLink) return false;
        const url = new URL(authorLink.href, location.href);
        url.pathname = url.pathname.replace(/\/page\/\d+\/?$/, '/');
        url.searchParams.set('view_author', user.id);
        url.searchParams.delete('page');
        url.hash = '';
        if (url.origin !== location.origin) return false;
        const pageFetch = typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch ? unsafeWindow.fetch.bind(unsafeWindow) : fetch.bind(window);
        const response = await debugPageFetch('SS同盟检查本人今日评论', pageFetch, url.href, { credentials: 'same-origin', cache: 'no-store' }, debugContext);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const now = new Date();
        const today = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        if (!new RegExp(today + '(?![0-9])').test(doc.querySelector('h1.ipsType_pageTitle')?.textContent || '')) throw signRequestError('adaptation', '本人评论检查未返回当前签到帖');
        return Boolean(findSstmDailyComment(doc, user));
    }

    async function runSstmPageSign(debugContext) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        const now = new Date();
        const today = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        const datePattern = new RegExp(today + '(?![0-9])');
        const forumUrl = 'https://sstm.moe/forum/72-%E5%90%8C%E7%9B%9F%E7%AD%BE%E5%88%B0%E5%8C%BA/';
        const visible = node => Boolean(node?.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        const waitFor = async (read, timeout = 12000) => {
            const deadline = Date.now() + timeout;
            do {
                if (!isOperationCurrent(debugContext.operation)) return null;
                const value = read();
                if (value) return value;
                await delay(200);
            } while (Date.now() < deadline);
            return null;
        };
        const status = (state, stage, message) => recordTargetStatus('sstm', state, { stage, message, url: location.href });
        const retry = message => {
            const count = Math.max(0, Number(GM_getValue('sstm_retry_count', 0)) || 0);
            if (count >= 3) {
                GM_setValue('sstm_retry_count', 0);
                status('needs-foreground', 'retry', `${message}；已重试3次，请检查页面或回帖权限`);
            } else {
                GM_setValue('sstm_retry_count', count + 1);
                status('needs-foreground', 'editor', `${message}，正在刷新重试（${count + 1}/3）`);
                location.reload();
            }
            return false;
        };

        // 等待 IPS 页面初始化；登录入口可能在已登录页面的隐藏弹窗中，不能全页搜“登入”。
        await waitFor(() => document.querySelector('h1.ipsType_pageTitle, [data-role="replyArea"], #elUserLink'));
        const user = await waitFor(() => { const value = getSstmUser(); return value.id || value.name ? value : null; }, 8000);
        if (!user) {
            status('needs-login', 'login', 'SS同盟需要先登录账号');
            return false;
        }
        if (/\/forum\/72-/.test(location.pathname)) {
            status('running', 'find-thread', '正在查找今日签到帖');
            const link = await waitFor(() => Array.from(document.querySelectorAll('.ipsDataItem_title a, a[href*="/topic/"]')).find(a => /签到/.test(a.textContent) && datePattern.test(a.textContent) && new URL(a.href, location.href).hostname === location.hostname));
            if (!link) { status('failed', 'find-thread', `未找到 ${today} 的签到帖`); return false; }
            status('opened', 'navigate', '已找到今日签到帖，正在进入');
            location.href = link.href;
            return false;
        }
        if (!/\/topic\//.test(location.pathname) || !datePattern.test(document.querySelector('h1.ipsType_pageTitle')?.textContent || '')) {
            status('opened', 'navigate', '正在前往签到区寻找今日帖子');
            location.href = forumUrl;
            return false;
        }

        const topic = location.pathname.match(/\/topic\/([^/]+)/)?.[1] || '';
        const receiptKey = 'BBSSignHelperSstmSubmission';
        let receipt;
        try { receipt = JSON.parse(sessionStorage.getItem(receiptKey) || 'null'); } catch (err) { /* 兼容损坏的旧标签记录。 */ }
        const pending = receipt?.date === getToday() && receipt.topic === topic && receipt.user === (user.id || user.name);
        const finish = () => {
            sessionStorage.removeItem(receiptKey);
            GM_setValue('sstm_retry_count', 0);
            return completeSign('sstm', '已确认本人今日发布的签到评论', CLOSE_PAGE_AFTER_SIGN_ACTION);
        };
        if (findSstmDailyComment(document, user)) return finish();

        status('running', 'verify', '正在检查本人今日是否已经回帖');
        if (await checkSstmPublished(debugContext, user)) return finish();
        if (pending) {
            status('result-unknown', 'verify', '本标签已提交过评论，尚未查到发布结果；重新检查不会重复发帖');
            return false;
        }

        let area = await waitFor(() => document.querySelector('[data-role="replyArea"], #elReplyForm, form[data-role="replyForm"], .ipsComposeArea, form:has(iframe.cke_wysiwyg_frame), form:has([contenteditable="true"])'));
        const findEditor = () => {
            area = document.querySelector('[data-role="replyArea"], #elReplyForm, form[data-role="replyForm"]') || area;
            const form = area?.matches('form') ? area : area?.closest('form') || area?.querySelector('form');
            const scope = area || form;
            if (!scope) return null;
            const instances = typeof unsafeWindow !== 'undefined' ? unsafeWindow.CKEDITOR?.instances : window.CKEDITOR?.instances;
            for (const api of Object.values(instances || {})) {
                if (api.status !== 'ready' || api.readOnly) continue;
                const field = api.editable?.()?.$;
                const textarea = api.element?.$;
                if (visible(field) && (scope.contains(field) || scope.contains(textarea))) return { api, field, textarea, form: textarea?.form || form, scope };
            }
            const field = Array.from(scope.querySelectorAll('[contenteditable="true"]')).find(visible);
            if (field) return { field, form: field.closest('form') || form, scope };
            for (const frame of scope.querySelectorAll('iframe.cke_wysiwyg_frame, iframe')) {
                if (!visible(frame)) continue;
                try {
                    const body = frame.contentDocument?.body;
                    if (body && (body.isContentEditable || body.getAttribute('contenteditable') === 'true' || frame.matches('.cke_wysiwyg_frame'))) return { field: body, form, scope };
                } catch (err) { /* 不读取跨域 iframe。 */ }
            }
            return null;
        };
        status('running', 'editor', '正在激活回复编辑器');
        const dummy = area?.querySelector('.ipsComposeArea_dummy');
        if (visible(dummy)) {
            dummy.scrollIntoView({ block: 'center' });
            dummy.focus();
            dummy.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            dummy.click();
        }
        const editor = await waitFor(findEditor);
        if (!editor) return retry('回复编辑器尚未就绪');

        const message = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const html = `<p>${message}</p>`;
        status('running', 'fill', '正在填写并同步签到评论');
        editor.field.focus();
        if (editor.api) {
            // CKEditor 的 setData 是异步操作，必须等回调后再同步隐藏 textarea。
            let timer;
            try {
                await new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(signRequestError('adaptation', '回复编辑器写入超时')), 6000);
                    editor.api.setData(html, { callback: resolve });
                });
                editor.api.fire('change');
                editor.api.updateElement();
            } finally { clearTimeout(timer); }
            if (!editor.api.getData().includes(message) || (editor.textarea?.matches('textarea') && !editor.textarea.value.includes(message))) return retry('编辑器内容未同步到回复表单');
        } else {
            editor.field.innerHTML = html;
        }
        const EventType = editor.field.ownerDocument.defaultView.Event;
        editor.field.dispatchEvent(new EventType('input', { bubbles: true }));
        editor.field.dispatchEvent(new EventType('change', { bubbles: true }));

        const button = await waitFor(() => Array.from((editor.form || editor.scope).querySelectorAll('button[type="submit"], input[type="submit"], [data-action="submitReply"]')).find(node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'), 6000);
        if (!button) return retry('回复提交按钮尚未就绪');
        if (!isOperationCurrent(debugContext.operation) || !markPendingAutoCloseAfterSignAction('sstm', 'reply-submit')) return false;
        // 新记录只代表本逻辑真正点击过可用的回复按钮；旧版泛用动作标记不阻断本次执行。
        sessionStorage.setItem(receiptKey, JSON.stringify({ date: getToday(), topic, user: user.id || user.name, message }));
        status('running', 'submit', '已提交签到评论，正在确认发布结果');
        button.click();
        if (await waitFor(() => findSstmDailyComment(document, user), 8000)) return finish();
        if (await checkSstmPublished(debugContext, user)) return finish();
        status('result-unknown', 'verify', '回复已提交，尚未获得本人已发布评论；请重新检查结果');
        return false;
    }

    function getFufugalNotice() {
        const texts = Array.from(document.querySelectorAll('.el-notification__content, .el-message__content, .el-dialog__body, .el-message-box__message, [role="dialog"]'))
            .filter(node => node.getClientRects().length > 0 && !node.closest('#bbs-sign-page-toast, #bbs-sign-dashboard-overlay'))
            .map(node => (node.innerText || node.textContent || '').trim()).filter(Boolean);
        // 站点自绘的寻宝报告没有 role="dialog"；恢复原有的有界正文提取。
        let body = document.body?.innerText || '';
        for (const node of document.querySelectorAll('#bbs-sign-page-toast, #bbs-sign-dashboard-overlay, #bbs-sign-dashboard-button')) {
            const ownText = node.innerText || '';
            if (ownText) body = body.replace(ownText, '');
        }
        const report = body.match(/寻宝报告[\s\S]{0,700}?(?:确定|$)/)?.[0];
        const done = body.match(/今日已完成寻宝[^\n。]*(?:[。！!])?/)?.[0];
        const result = report || done;
        if (result && !texts.includes(result)) texts.push(result.trim());
        return texts.join('\n');
    }

    function isFufugalConfirmed(text) {
        // 探险中途的战斗失败不代表签到失败，以已结束的寻宝报告为准。
        if (/寻宝报告/.test(text) && /寻宝结束|进入休息状态/.test(text) && !/请求失败|接口错误|系统异常|error/i.test(text)) return true;
        return !/失败|错误|异常|无法|error/i.test(text) && /今日已完成寻宝|请明日再来|明天再来|寻宝成功|寻宝结束|(?:最终携带回了|携带回了)[^\n]*积分/.test(text);
    }

    async function checkSiteResult(site, debugContext) {
        debugContext = debugContext || { operation: pageOperations.get(site.key) || captureOperation(site.key) };
        debugContext.unsignedConfirmed = false;
        const actions = taskActions(debugContext);
        const text = selector => document.querySelector(selector)?.textContent || '';
        let signed = false;
        switch (site.key) {
            case 'sstm': signed = await checkSstmPublished(debugContext); break;
            case 'wcccc':
            case 'laowang': signed = Boolean(document.querySelector('.qdleft .btnvisted, #JD_sign.btnvisted, .btnvisted'));
                debugContext.unsignedConfirmed = !signed && !debugContext.submitted && !hasPageSubmittedAction(site.key, debugContext.operation) && /今日未签到|今天未签到/.test(text('#JD_sign, .qdleft .btn')); break;
            case 'ZodGame': signed = /已经签到过了|今日已签到/.test(text('#ct > div.mn > h1:nth-child(1)')); debugContext.unsignedConfirmed = !signed && !debugContext.submitted && !hasPageSubmittedAction(site.key, debugContext.operation) && Boolean(document.querySelector('#qiandao')) && /今天签到了吗/.test(document.body?.innerText || ''); break;
            case '2dfan': signed = Array.from(document.querySelectorAll('.checkin-action button')).some(button => button.textContent.trim() === '今日已签到') || /今日已签到|今天已签到/.test(text('.checkin-info .pull-right')); break;
            case 'sehuatang': signed = isSehuatangSignPage() && getSehuatangSignControlState().isSigned; break;
            case 'fufugal': signed = isFufugalConfirmed(getFufugalNotice()); break;
            case 'uugg': signed = await runUuGgPageSign(debugContext, true); break;
            case 'acgndog': signed = await runAcgndogApiSign(debugContext, true); break;
            case 'vik': signed = await runVikApiSign(debugContext, true); break;
            case 'kfpromax': signed = await runKfpromaxApiSign(debugContext, true); break;
            case 'sijishe': signed = await runSijisheApiSign(debugContext, true); break;
            case 'fxacg': signed = await runFeixueApiSign(debugContext, true); break;
            case 'galGameXNew': signed = Boolean(getGalgameXNewSignedText()); break;
            case 'southplus':
            case 'sl-asmr': actions.recordTargetStatus(site.key, 'result-unknown', { stage: 'verify', reasonCode: 'readonly-unavailable', message: '此站点暂无可靠的只读结果入口；请前台核对并人工确认，不重复领取奖励' }); break;
            case 'soushuba': signed = Boolean(document.querySelector('a[href*="member.php?mod=logging"][href*="action=logout"]')) || Number(unsafeWindow.discuz_uid) > 0; break;
        }
        if (signed && !(getRawTargetStatus(site.key)?.status === 'success' && getRawTargetStatus(site.key)?.confirmationSource === 'automatic' && getRawTargetStatus(site.key)?.taskId === (debugContext.operation?.taskId || ''))) actions.completeSign(site.key, '重新检查确认今日已完成');
        else if (debugContext.unsignedConfirmed) actions.recordTargetStatus(site.key, 'not-started', { stage: 'verify', reasonCode: 'confirmed-unsigned', message: '已确认今日尚未完成，可再次执行签到' });
        return { outcome: signed ? 'success' : debugContext.unsignedConfirmed ? 'not-completed' : 'unknown', evidenceDate: getToday() };
    }

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
    function markSignSuccess(key, message, options = {}) {
        const context = options.context || pageOperations.get(key);
        if (!isOperationCurrent(context)) return false;
        const today = getToday();
        if (options.source !== 'manual' && (!options.evidence || options.evidence.date !== today || !options.evidence.summary || options.evidence.kind !== 'site-result')) return false;
        const data = readObject(STORAGE_KEYS.successData);
        data[key] = today;
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, key), today);
        writeObject(STORAGE_KEYS.successData, data);
        recordTargetStatus(key, 'success', {
            stage: options.source === 'manual' ? 'manual' : 'verify',
            confirmationSource: options.source || 'automatic',
            evidence: options.evidence?.summary || message,
            context,
            message,
            url: location.href
        });
        console.log(`[签到助手] ${key} 签到状态已更新为：${data[key]}`);
        return true;
    }

    function clearSignSuccess(key, message = '已清除错误的今日成功记录', context = pageOperations.get(key)) {
        if (!isOperationCurrent(context)) return false;
        const data = readObject(STORAGE_KEYS.successData);
        delete data[key];
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, key), '');
        writeObject(STORAGE_KEYS.successData, data);
        console.log(`[签到助手] ${key} ${message}`);
    }

    function completeSign(key, message, options = {}) {
        if (!markSignSuccess(key, message, { ...options, evidence: options.evidence || (message ? { kind: 'site-result', date: options.context?.date || pageOperations.get(key)?.date || getToday(), summary: message } : null) })) return false;
        maybeAutoClosePageAfterSign(key, options);
        return true;
    }

    function getDashboardConfig() {
        return normalizeDashboardConfig(readObject(STORAGE_KEYS.dashboardConfig, DEFAULT_DASHBOARD_CONFIG));
    }

    function normalizeDashboardConfig(config) {
        const preferences = config.preferences && typeof config.preferences === 'object' ? config.preferences : {};
        return {
            targetSettings: config.targetSettings && typeof config.targetSettings === 'object' ? config.targetSettings : {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: preferences.autoOpenDashboardOnAttention === true,
                autoClosePageAfterSign: preferences.autoClosePageAfterSign === true,
                historyRetentionDays: [7, 30, 90].includes(preferences.historyRetentionDays) ? preferences.historyRetentionDays : 0
            }
        };
    }

    function saveDashboardConfig(config) {
        writeObject(STORAGE_KEYS.dashboardConfig, {
            targetSettings: config.targetSettings || {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: config.preferences?.autoOpenDashboardOnAttention === true,
                autoClosePageAfterSign: config.preferences?.autoClosePageAfterSign === true,
                historyRetentionDays: [7, 30, 90].includes(config.preferences?.historyRetentionDays) ? config.preferences.historyRetentionDays : 0
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
        const context = options.context || pageOperations.get(key);
        if (!isOperationCurrent(context)) return null;
        const today = getToday();
        const store = getStatusStore();
        const dayStatus = store[today] || {};
        const previous = getRawTargetStatus(key) || {};
        const nextStatus = {
            schemaVersion: 1,
            confirmationSource: options.confirmationSource || (status === 'success' ? previous.confirmationSource || 'legacy' : ''),
            mutationId: GM_getValue(getScopedStorageKey(STORAGE_KEYS.mutation, key), ''),
            writeId: newOperationId(),
            taskId: options.taskId || context?.taskId || '',
            reasonCode: options.reasonCode || '',
            evidence: truncateDebugText(redactDebugText(options.evidence || ''), 500),
            status,
            stage: options.stage || previous.stage || '',
            message: truncateDebugText(redactDebugText(options.message || STATUS_META[status]?.message || previous.message || ''), 1000),
            updatedAt: new Date().toISOString(),
            url: sanitizeDebugUrl(options.url || previous.url || location.href),
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
        return nextStatus;
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
        if (status === 'needs-login') return '等待登录';
        if (status === 'needs-foreground') return '等待人工验证';
        if (status === 'result-unknown') return '等待检查结果';
        if (status === 'failed') return '签到失败';
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
        if (scopedValue && typeof scopedValue === 'object' && !Array.isArray(scopedValue) && STATUS_META[scopedValue.status]) {
            return scopedValue;
        }
        const store = getStatusStore();
        const todayStatus = store[today] || {};
        const value = todayStatus[key];
        return value && STATUS_META[value.status] ? value : null;
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
        if (raw && ['running', 'queued', 'opened'].includes(raw.status) && !hasActiveTask(target.id) && !directTasks.has(target.id) && !(target.siteKey && getData(target.siteKey) === getToday() && !raw.schemaVersion)) return { ...raw, status: 'result-unknown', message: '上次任务已结束或超期，请先检查结果', reasonCode: 'expired' };
        if (raw?.schemaVersion === 1 || raw?.stage === 'manual') {
            return raw;
        }

        if (target.siteKey && getData(target.siteKey) === getToday()) {
            const rawSuccess = raw?.status === 'success' ? raw : null;
            return {
                status: 'success',
                confirmationSource: rawSuccess?.confirmationSource || 'legacy',
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

    function bindPageTask(key) {
        const url = new URL(location.href);
        const token = url.searchParams.get('__bbs_task');
        const sessionKey = `BBSSignHelperPageTask:${key}`;
        const stored = sessionStorage.getItem(sessionKey);
        const lease = getTaskLease(key);
        if (token && lease?.taskId === token && lease.date === getToday() && lease.expiresAt > Date.now()) {
            sessionStorage.setItem(sessionKey, token);
            url.searchParams.delete('__bbs_task');
            try { history.replaceState(history.state, '', url.href); } catch (err) { /* 管理器可能禁止改写 URL。 */ }
        }
        const taskId = token || stored;
        if (!taskId || lease?.taskId !== taskId || lease.date !== getToday() || lease.expiresAt <= Date.now()) return null;
        // 旧版会把结果未知或页面跳转隐式改成只读；升级后恢复正常页面流程。
        const checkOnly = lease.checkOnly === true && ['explicit', 'manual'].includes(lease.checkOnlySource);
        return { ...captureOperation(key), taskId, pageTask: true, checkOnly };
    }

    function markPendingAutoCloseAfterSignAction(key, source = 'action') {
        if (!isCurrentPageForSite(key)) return false;
        const operation = pageOperations.get(key);
        if (!operation || !isOperationCurrent(operation)) return false;
        // 动作和关闭许可只属于当前标签的任务，不能由同站其他页面消费。
        sessionStorage.setItem(`BBSSignHelperPageAction:${key}`, JSON.stringify({ ...operation, source }));
        const context = requestContexts.get(key);
        if (context?.operation?.mutationId === operation.mutationId && context?.operation?.taskId === operation.taskId) context.submitted = true;
        return true;
    }

    function hasPageSubmittedAction(key, operation) {
        try {
            const value = JSON.parse(sessionStorage.getItem(`BBSSignHelperPageAction:${key}`) || 'null');
            return Boolean(operation && value?.date === operation.date && value?.taskId === operation.taskId && value?.mutationId === operation.mutationId);
        } catch (err) { return false; }
    }

    function maybeAutoClosePageAfterSign(key, options = {}) {
        if (options.source === 'manual' || !getDashboardConfig().preferences.autoClosePageAfterSign || !isCurrentPageForSite(key)) return;
        const operation = options.context || pageOperations.get(key);
        if (!operation || !isOperationCurrent(operation)) return;
        let action;
        try { action = JSON.parse(sessionStorage.getItem(`BBSSignHelperPageAction:${key}`) || 'null'); } catch (err) { return; }
        if (!operation.pageTask && (!action || action.date !== operation.date || action.mutationId !== operation.mutationId)) return;
        if (operation.pageTask && sessionStorage.getItem(`BBSSignHelperPageTask:${key}`) !== operation.taskId) return;
        sessionStorage.removeItem(`BBSSignHelperPageAction:${key}`);
        setTimeout(() => {
            if (!isOperationCurrent(operation, true) || getRawTargetStatus(key)?.confirmationSource !== 'automatic') return;
            try { window.close(); } catch (err) { /* 下方提示手动关闭。 */ }
            showPageSignToast(key, 'success', { message: '已确认成功；若页面未关闭，可手动关闭' });
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
            .replace(/(^|\r?\n)((?:set-cookie|cookie|authorization)\s*:\s*)[^\r\n]*/gi, '$1$2[REDACTED]')
            .replace(/(["'][^"'\n]*(?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey|_?nonce)[^"'\n]*["']\s*:\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,}\]]+)/gi, '$1"[REDACTED]"')
            .replace(/((?:[\w.-]*(?:authorization|cookie|token|secret|password|passwd|csrf|xsrf|session|jwt|bearer|formhash|safeid|authkey|_?nonce)[\w.-]*)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
            .replace(/(<input\b[^>]*\bname=["'][^"']*(?:token|formhash|safeid|nonce|password|csrf|session)[^"']*["'][^>]*\bvalue=["'])[^"']*/gi, '$1[REDACTED]')
            .replace(/(<input\b[^>]*\bvalue=["'])[^"']*(["'][^>]*\bname=["'][^"']*(?:token|formhash|safeid|nonce|password|csrf|session)[^"']*["'])/gi, '$1[REDACTED]$2')
            .replace(/(\b[\w.-]*(?:token|secret|password|csrf|session|formhash|safeid|authkey|nonce)[\w.-]*\s*=\s*)(["'])(.*?)\2/gi, '$1$2[REDACTED]$2')
            .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
    }

    function sanitizeDebugValue(value, key = '') {
        if (DEBUG_SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
        if (Array.isArray(value)) return value.slice(0, key === 'entries' ? DEBUG_LOG_MAX_ENTRIES_PER_SESSION : DEBUG_LOG_MAX_SESSIONS).map(item => sanitizeDebugValue(item));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeDebugValue(item, name)]));
        if (typeof value === 'string') return truncateDebugText(/url$/i.test(key) ? sanitizeDebugUrl(value) : redactDebugText(value));
        return value;
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
            if (url.username) url.username = '[REDACTED]';
            if (url.password) url.password = '[REDACTED]';
            url.hash = redactDebugText(url.hash);
            for (const key of Array.from(url.searchParams.keys())) {
                if (DEBUG_SENSITIVE_KEY_RE.test(key) || key === '__bbs_task') {
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
            operation: pageOperations.get(siteKey) || captureOperation(siteKey),
            pageUrl: sanitizeDebugUrl(location.href),
            startedAt: getLocalDateTimeWithOffset(),
            finished: false,
            entries: []
        };
        requestContexts.set(siteKey, context);
        return context;
    }

    function finishSignDebugCapture(context) {
        context.finished = true;
        if (requestContexts.get(context.siteKey) === context) requestContexts.delete(context.siteKey);
    }

    function addSignDebugEntry(entry, context) {
        if (!context || context.finished || context.entries.length >= DEBUG_LOG_MAX_ENTRIES_PER_SESSION) return null;
        const item = {
            ...entry,
            pageUrl: sanitizeDebugUrl(location.href),
            attempt: context.attempt || 1,
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
            .slice(-DEBUG_LOG_MAX_SESSIONS).map(item => sanitizeDebugValue(item));
    }

    function persistSignDebugFailure(context, reason = {}) {
        if (!context) return;
        const logs = pruneSignDebugLogs(readArray(STORAGE_KEYS.signDebugLogs, []));
        logs.push(sanitizeDebugValue({
            siteKey: context.siteKey,
            siteName: context.siteName,
            mode: context.mode,
            pageUrl: context.pageUrl,
            startedAt: context.startedAt,
            savedAt: getLocalDateTimeWithOffset(),
            reason,
            taskId: context.operation?.taskId || '',
            entries: context.entries
        }));
        writeObject(STORAGE_KEYS.signDebugLogs, pruneSignDebugLogs(logs));
    }

    function buildSignDebugExport(siteKey = '') {
        const logs = pruneSignDebugLogs(readArray(STORAGE_KEYS.signDebugLogs, []));
        writeObject(STORAGE_KEYS.signDebugLogs, logs);
        return {
            tool: 'BBSSignHelperDebugLogs',
            exportedAt: getLocalDateTimeWithOffset(),
            retentionDays: 3,
            logs: siteKey ? logs.filter(item => item.siteKey === siteKey) : logs
        };
    }

    function showTargetDiagnostics(target) {
        const status = getNormalizedTargetStatus(target);
        const data = buildSignDebugExport(target.id);
        const dialog = el('dialog', { className: 'bbs-sign-diagnostics' });
        dialog.style.cssText = 'max-width:min(90vw,900px);max-height:85vh;overflow:auto;z-index:2147483647';
        dialog.append(el('h3', { text: `${target.name} · 单站诊断` }),
            el('p', { text: `状态：${STATUS_META[status.status]?.label}；阶段：${status.stage || '未开始'}；原因：${status.message || '暂无请求'}。${data.logs.length ? '' : '没有保存失败请求日志；打开、人工等待或尚未请求时仅显示阶段说明。'}` }),
            el('pre', { text: JSON.stringify(data, null, 2) }),
            el('button', { text: '导出本站日志', onClick: () => downloadJson(data, `bbs-sign-debug-${target.id}-${getToday()}.json`) }),
            el('button', { text: '清空本站日志', onClick: () => { writeObject(STORAGE_KEYS.signDebugLogs, buildSignDebugExport().logs.filter(item => item.siteKey !== target.id)); dialog.remove(); } }),
            el('button', { text: '关闭', onClick: () => dialog.remove() }));
        document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove());
        dialog.showModal();
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

    function ensureCaptchaAutoSubmitMonitor(options) {
        const existingState = captchaAutoSubmitStates.get(options.siteKey);
        if (existingState) {
            existingState.check();
            return existingState;
        }

        const operation = pageOperations.get(options.siteKey) || captureOperation(options.siteKey);
        const state = { submitted: false, finished: false, timer: null, timeout: null, check: null };
        const stop = () => {
            clearInterval(state.timer);
            clearTimeout(state.timeout);
            state.finished = true;
            captchaAutoSubmitStates.delete(options.siteKey);
        };
        state.stop = stop;
        const check = () => {
            if (state.finished) return;
            if (!isOperationCurrent(operation)) { stop(); return; }
            if (options.isSigned()) {
                state.finished = true;
                stop();
                options.onSuccess();
                return;
            }
            if (state.submitted || !options.isVerified()) return;

            const button = options.getSubmitButton();
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

            if (!markPendingAutoCloseAfterSignAction(options.siteKey, 'captcha-submit')) return false;
            state.submitted = true;
            recordTargetStatus(options.siteKey, 'running', {
                stage: 'submit',
                message: `${options.siteName} 验证已通过，已自动点击${options.actionLabel}`,
                url: location.href
            });
            console.log(`[${options.siteName}] 验证已通过，自动点击${options.actionLabel}...`);
            button.click();
        };

        state.check = check;
        captchaAutoSubmitStates.set(options.siteKey, state);
        state.timer = setInterval(check, 500);
        state.timeout = setTimeout(stop, 10 * 60 * 1000);
        check();
        return state;
    }

    const SIGN_RECHECK_SCHEDULE = [
        { durationMs: 30000, intervalMs: 1000 },
        { durationMs: 60000, intervalMs: 3000 }
    ];

    function isSignSuccessRecorded(key) {
        return getNormalizedTargetStatus({ id: key, siteKey: key, enabled: true }).status === 'success';
    }

    async function waitForSiteSuccessRecheck(site) {
        const startedAt = Date.now();
        let elapsedBeforePhase = 0;
        let requestChecks = 0;
        const remote = ['uugg', 'acgndog', 'vik', 'kfpromax', 'sijishe', 'fxacg'].includes(site.key);
        const context = requestContexts.get(site.key);
        for (const phase of SIGN_RECHECK_SCHEDULE) {
            const phaseEndAt = startedAt + elapsedBeforePhase + phase.durationMs;
            while (Date.now() < phaseEndAt) {
                await delay(Math.min(phase.intervalMs, Math.max(0, phaseEndAt - Date.now())));
                if (!isOperationCurrent(context?.operation || pageOperations.get(site.key))) return false;
                if (isSignSuccessRecorded(site.key)) return true;
                if (remote && requestChecks++ >= 3) return false;
                try {
                    const result = await site.check(context);
                    if (result.outcome === 'success') return true;
                    if (['needs-login', 'needs-verification'].includes(result.outcome) || result.reasonCode === 'readonly-unavailable') return false;
                } catch (err) {
                    const code = err.reasonCode || 'adaptation';
                    if (!['network', 'timeout', 'temporary'].includes(code)) {
                        recordTargetStatus(site.key, code === 'login' ? 'needs-login' : code === 'captcha' ? 'needs-foreground' : 'result-unknown', { context: context?.operation, reasonCode: code, stage: 'verify', message: stringifyDebugError(err) });
                        return false;
                    }
                    if (remote && requestChecks < 3) await delay(Math.max(requestChecks * 3000, err.retryAfterMs || 0));
                }
            }
            elapsedBeforePhase += phase.durationMs;
        }
        return false;
    }

    async function runPageTask(site, context, checkOnly) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            context.attempt = attempt;
            if (!isOperationCurrent(context.operation)) return { outcome: 'cancelled' };
            try { return checkOnly ? await site.check(context) : await site.execute(context); }
            catch (err) {
                if (context.submitted || !err.retryable || attempt === 3) throw err;
                persistSignDebugFailure(context, { status: 'failed', reasonCode: err.reasonCode, message: stringifyDebugError(err), attempt });
                const wait = Math.max(attempt * 3000, err.retryAfterMs || 0);
                recordTargetStatus(site.key, 'running', { context: context.operation, stage: 'retry', message: `第 ${attempt} 次临时失败，${Math.ceil(wait / 1000)} 秒后重试（${attempt + 1}/3）` });
                await delay(wait);
            }
        }
        return { outcome: 'unknown' };
    }

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('当前脚本管理器不支持 GM_xmlhttpRequest'));
                return;
            }
            const method = details.method || 'GET';
            const debugContext = details.debugContext || requestContextForUrl(details.url);
            if (!isOperationCurrent(debugContext?.operation)) { reject(signRequestError('cancelled', '本次任务已重置')); return; }
            const action = isSignActionRequest(details.url, method);
            if (action && debugContext) { debugContext.submitted = true; markPendingAutoCloseAfterSignAction(debugContext.siteKey, 'request'); }
            const startedAt = Date.now();
            let settled = false;
            let request;
            const finish = (error, response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                if (error) reject(error); else resolve(response);
            };
            const timeoutId = setTimeout(() => {
                finish(signRequestError('timeout', '请求超时'));
                request?.abort?.();
            }, details.timeout || REQUEST_TIMEOUT_MS);
            const debugEntry = addSignDebugEntry({
                type: 'gmRequest',
                method,
                url: sanitizeDebugUrl(details.url),
                requestHeaders: debugHeadersToObject(details.headers || {}),
                requestBody: debugBodyToText(details.data),
                responseType: details.responseType || 'text',
                status: 'pending'
            }, debugContext);
            try { request = GM_xmlhttpRequest({
                method,
                timeout: details.timeout || REQUEST_TIMEOUT_MS,
                url: details.url,
                headers: details.headers || {},
                data: details.data,
                responseType: details.responseType || 'text',
                anonymous: false,
                withCredentials: true,
                onload: (response) => {
                    if (settled) return;
                    if (debugEntry) {
                        debugEntry.status = response.status;
                        debugEntry.finalUrl = sanitizeDebugUrl(response.finalUrl || details.url);
                        debugEntry.responseHeaders = truncateDebugText(redactDebugText(getDebugResponseHeaderText(response)), 3000);
                        debugEntry.response = getDebugGmResponseText(response);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    const error = classifyHttpResponse(response.status, getDebugGmResponseText(response), response.responseHeaders, response.finalUrl || details.url);
                    finish(error, response);
                },
                onerror: (err) => {
                    if (debugEntry) {
                        debugEntry.status = 'error';
                        debugEntry.error = stringifyDebugError(err);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    finish(signRequestError('network', '网络请求失败'));
                },
                ontimeout: (err) => {
                    if (debugEntry) {
                        debugEntry.status = 'timeout';
                        debugEntry.error = stringifyDebugError(err);
                        debugEntry.durationMs = Date.now() - startedAt;
                    }
                    finish(signRequestError('timeout', '请求超时'));
                },
                onabort: () => finish(signRequestError('cancelled', '请求已取消'))
            }); } catch (err) { finish(signRequestError('network', stringifyDebugError(err))); }
        });
    }

    function signRequestError(reasonCode, message, retryAfterMs = 0) {
        return Object.assign(new Error(message), { reasonCode, retryAfterMs, retryable: ['network', 'timeout', 'temporary'].includes(reasonCode) });
    }

    function classifyHttpResponse(status, text = '', headers = '', finalUrl = '') {
        if (/Just a moment|Enable JavaScript and cookies to continue/i.test(text)) return signRequestError('captcha', '站点要求前台完成人工验证');
        if (status === 401 || /\/(?:login|sign_in)(?:[/?#]|$)|[?&](?:mod=logging&action=login|action=login)(?:&|$)/i.test(finalUrl)) return signRequestError('login', '登录状态已失效，请先登录');
        if (status === 403) return signRequestError(/cloudflare|challenge|captcha/i.test(text) ? 'captcha' : 'permission', '访问受限，请前台检查验证或权限');
        if (status === 429 || status >= 500) {
            const value = String(headers).match(/retry-after:\s*([^\r\n]+)/i)?.[1] || '';
            const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, new Date(value).getTime() - Date.now());
            return signRequestError('temporary', `站点暂时不可用（HTTP ${status}）`, Math.min(60000, seconds || 0));
        }
        if (status >= 400) return signRequestError('adaptation', `请求失败（HTTP ${status}），请检查站点适配`);
        return null;
    }

    function isSignActionRequest(url, method) {
        if (/getUserInfo|getMissionList/.test(url)) return false;
        return method.toUpperCase() === 'POST' || /[?&](?:actions=job2?|ok=3|operation=qiandao)(?:&|$)|type=goSign/.test(url);
    }

    async function fetchBuffered(fetchFn, url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
        const Controller = typeof unsafeWindow !== 'undefined' && unsafeWindow.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
        const controller = Controller ? new Controller() : null;
        let timeoutId;
        try {
            return await Promise.race([
                (async () => {
                    const response = await fetchFn(url, { ...options, signal: controller?.signal });
                    const buffer = await response.arrayBuffer();
                    const result = new Response([204, 205, 304].includes(response.status) ? null : buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
                    Object.defineProperty(result, 'url', { value: response.url || String(url) });
                    const error = classifyHttpResponse(response.status, await result.clone().text(), [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\n'), response.url || String(url));
                    if (error) throw error;
                    return result;
                })(),
                new Promise((resolve, reject) => {
                    timeoutId = setTimeout(() => { reject(signRequestError('timeout', '页面请求或响应体读取超时')); controller?.abort(); }, timeoutMs);
                })
            ]);
        } finally { clearTimeout(timeoutId); }
    }

    async function debugPageFetch(label, fetchFn, url, options = {}, debugContext = requestContextForUrl(url)) {
        if (!isOperationCurrent(debugContext?.operation)) throw signRequestError('cancelled', '本次任务已重置');
        if (isSignActionRequest(url, options.method || 'GET') && debugContext) { debugContext.submitted = true; markPendingAutoCloseAfterSignAction(debugContext.siteKey, 'request'); }
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
            const response = await fetchBuffered(fetchFn, url, options);
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
            if (!err.reasonCode) err = signRequestError('network', stringifyDebugError(err));
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

    function hasUserDailyRecord(html, uid, marker) {
        if (!uid) return false;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return Array.from(doc.querySelectorAll('a[href*="uid="]')).some(link => {
            try {
                if (new URL(link.getAttribute('href'), location.href).searchParams.get('uid') !== String(uid)) return false;
                const row = link.closest('tr, li, article, .sign-row');
                return Boolean(row && marker.test(row.textContent || ''));
            } catch (err) { return false; }
        });
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

    async function runFeixueApiSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
        if (/(?:您|你)(?:今天|今日)?(?:已经|已)签到|(?:今日|今天)已签到(?!人数|用户)/.test(modalHtml)) {
            return completeSign('fxacg', '接口返回今日已签到');
        }

        if (checkOnly) { debugContext.unsignedConfirmed = /您(?:今日|今天)(?:尚未|还未)签到/.test(modalHtml); return false; }

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

        if (/签到成功|succeedhandle_signin/.test(submitText)) {
            return completeSign('fxacg', '接口返回签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (/(?:您|你)(?:今天|今日)?(?:已经|已)签到|(?:今日|今天)已签到(?!人数|用户)/.test(submitText)) {
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
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        let completedByAction = false;
        const fetchTask = async (id) => {
            let res = await gmRequest({
                url: `https://www.south-plus.net/plugin.php?H_name=tasks&action=ajax&actions=job&cid=${id}`,
                debugContext
            });
            let text = res.responseText || '';
            if (/请先登录|您还没有登录|尚未登录/.test(text)) { recordTargetStatus('southplus', 'needs-login', { stage: 'login', message: 'South-Plus 需要先登录账号' }); return false; }
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
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        const res = await gmRequest({
            method: 'POST',
            url: 'https://www.sl-asmr.com/api/mission/fast',
            debugContext
        });
        const text = res.responseText || '';
        if (/请先登录|未登录|尚未登录/.test(text)) { recordTargetStatus('sl-asmr', 'needs-login', { stage: 'login', message: '夜世界需要先登录账号' }); return false; }
        if (text.includes('签到成功')) {
            return completeSign('sl-asmr', '接口返回签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (text.includes('您已签到')) {
            return completeSign('sl-asmr', '接口返回今日已签到');
        }
        console.log('[夜世界] 签到接口异常', text);
        return false;
    }

    async function runKfpromaxApiSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
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

        if (checkOnly) { debugContext.unsignedConfirmed = isLoggedInPage(growthPage.text) && /kf_growup\.php\?ok=3(?:&amp;|&)safeid=/i.test(growthPage.text); return false; }

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

    async function runSijisheApiSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        const requestText = async (url) => {
            const response = await gmRequest({
                url: new URL(url, 'https://sjs96.com/').href,
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                debugContext
            });
            return response.responseText || '';
        };

        const pageText = await requestText('https://sjs96.com/k_misign-sign.html');
        const uid = pageText.match(/discuz_uid\s*=\s*['"]?(\d+)['"]?/i)?.[1] || '';
        const hasLogoutLink = /member\.php\?mod=logging(?:&amp;|&)action=logout/i.test(pageText);
        if ((!uid || uid === '0') && !hasLogoutLink) {
            recordTargetStatus('sijishe', 'needs-login', {
                stage: 'login',
                message: '司机社需要先登录账号',
                url: 'https://sjs96.com/k_misign-sign.html'
            });
            return false;
        }

        if (/<[^>]+(?:class=["'][^"']*btnvisted|id=["']JD_sign["'][^>]*>[^<]*今日已签到)/i.test(pageText)) {
            return completeSign('sijishe', '页面显示今日已签到');
        }

        if (checkOnly) { debugContext.unsignedConfirmed = /id=["']JD_sign["'][^>]*href=["'][^"']*operation=qiandao/i.test(pageText); return false; }

        const hrefMatch = pageText.match(/id=["']JD_sign["'][\s\S]*?href=["']([^"']+)["']/i) ||
            pageText.match(/href=["']([^"']*plugin\.php\?id=k_misign(?::|%3A)sign[^"']*operation=qiandao[^"']*)["']/i);
        const signPath = hrefMatch?.[1]?.replace(/&amp;/g, '&') || '';
        if (!signPath) {
            console.log('[司机社] 未找到签到链接');
            return false;
        }

        const signUrl = new URL(signPath, 'https://sjs96.com/');
        signUrl.searchParams.set('inajax', '1');
        signUrl.searchParams.set('ajaxtarget', 'JD_sign');
        await requestText(signUrl.href);

        const rankText = await requestText('https://sjs96.com/plugin.php?id=k_misign:sign&operation=list&inajax=1&ajaxtarget=ranklist');
        if (hasUserDailyRecord(rankText, uid, new RegExp(getToday()))) {
            return completeSign('sijishe', '今日排行已确认签到记录', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        const verifyText = await requestText('https://sjs96.com/k_misign-sign.html');
        if (/<[^>]+class=["'][^"']*btnvisted/i.test(verifyText)) {
            return completeSign('sijishe', '页面复查确认今日已签到', CLOSE_PAGE_AFTER_SIGN_ACTION);
        }

        console.log('[司机社] 签到接口未确认成功', rankText);
        return false;
    }

    async function runUuGgPageSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
            if (checkOnly) return false;
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
        const hasCurrentUserSignedRowInHtml = sourceHtml => hasUserDailyRecord(sourceHtml, uid, new RegExp(`今天已签到|已签到|${getToday()}`));
        const isConfirmedSignedPage = (text, sourceHtml) => {
            const serviceText = getSignServiceText(text);
            const hasUnsignedText = unsignedStateRe.test(serviceText);
            return !hasUnsignedText && (
                signedStateRe.test(serviceText) ||
                hasCurrentUserSignedRowInHtml(sourceHtml)
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
            clearSignSuccess('uugg', '页面显示今天未签到，已清除错误的今日成功记录', debugContext?.operation);
        }
        const hasCurrentUserSignedRow = hasCurrentUserSignedRowInHtml(html);
        const hasSignedMessage = signSuccessMessageRe.test(document.querySelector('#messagetext, #succeedlocation, .alert_right')?.textContent || '');

        if (!hasCurrentUserUnsignedText && (hasCurrentUserSignedText || hasCurrentUserSignedRow || hasSignedMessage)) {
            return completeSign('uugg', '页面确认今日已签到');
        }

        if (checkOnly) {
            if (hasCurrentUserUnsignedText && (uid || hasLogoutLink)) { debugContext.unsignedConfirmed = true; return false; }
            const verified = await verifySignedAfterSubmit(1);
            return verified.confirmed ? completeSign('uugg', '复查确认今日已签到') : false;
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

    async function runAcgndogApiSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
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

        if (checkOnly) { const value = checkJson.customPointSignDaily?.signed ?? checkJson.data?.customPointSignDaily?.signed; debugContext.unsignedConfirmed = [false, 0, '0', 'false'].includes(value); return false; }

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

    async function runVikApiSign(debugContext, checkOnly = false) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        if (!location.href.includes('wallet/mission')) {
            if (checkOnly) return false;
            console.log('[维咔] 前往任务页');
            window.location.href = '/wallet/mission';
            return false;
        }

        const authTokens = getVikAuthTokens();

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
            let res;
            try {
                res = await debugPageFetch(`vik-${path}`, pageFetch, requestUrl, {
                    method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload)
                });
            } catch (err) {
                // 单个旧令牌的 HTTP 401 不能中断其他令牌及 Cookie 的验证。
                if (err.reasonCode === 'login') return { status: 'error', code: 401, message: err.message };
                throw err;
            }
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
        if (!userInfo || userInfo.status !== 'success' || !userInfo.data?.basic?.id) {
            const cookieUserInfo = await requestApi('getUserInfo', { detail: true }, '');
            if (cookieUserInfo?.status === 'success' && cookieUserInfo.data?.basic?.id) {
                authToken = '';
                userInfo = cookieUserInfo;
                lastAuthError = null;
            } else if (isVikAuthError(cookieUserInfo)) lastAuthError = cookieUserInfo;
            else userInfo = cookieUserInfo;
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

        if (checkOnly) { debugContext.unsignedConfirmed = Number.isFinite(Number(userInfo.data?.credit?.sign_time)) && userInfo.data?.credit?.sign_time !== undefined; return false; }

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

    function isGalgameXNewSignedText(text) {
        return /今日已签到|今天已签到|已完成今日签到/.test(String(text || ''));
    }

    function getGalgameXNewSignedText() {
        const bodyText = document.body?.innerText || '';
        const taskButtonText = Array.from(document.querySelectorAll('button'))
            .map(btn => (btn.innerText || btn.textContent || '').trim())
            .find(text => isGalgameXNewSignedText(text));
        if (taskButtonText) return taskButtonText;
        return '';
    }

    async function runGalgameXNewApiSign(debugContext) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        const res = await gmRequest({
            method: 'POST',
            url: 'https://www.galgamex.net/api/user/checkin',
            debugContext
        });
        const text = res.responseText || '';

        if (res.status === 401 || res.status === 403 || /无权限|未登录|请先登录|登录已过期/.test(text)) {
            recordTargetStatus('galGameXNew', 'needs-login', {
                stage: 'login',
                message: 'GalgameX 新站需要先登录账号',
                url: 'https://www.galgamex.net/'
            });
            return false;
        }

        if (text.includes('randomMoemoepoints')) {
            const json = JSON.parse(text);
            if (json.success === false || ['error', 'failed'].includes(json.status) || !Number.isFinite(Number(json.randomMoemoepoints))) return false;
            return completeSign('galGameXNew', `签到成功，获得 ${json.randomMoemoepoints} 萌点`, CLOSE_PAGE_AFTER_SIGN_ACTION);
        }
        if (text.includes('您今天已经签到过了')) {
            return completeSign('galGameXNew', '接口返回今日已经签到过了');
        }

        try {
            const json = JSON.parse(text);
            const data = json?.data;
            const pointResult = data?.pointResult || {};
            const hasNewCheckinResult = data && (
                Object.prototype.hasOwnProperty.call(data, 'granted') ||
                Object.prototype.hasOwnProperty.call(data, 'exp') ||
                Object.prototype.hasOwnProperty.call(data, 'totalExp') ||
                Object.prototype.hasOwnProperty.call(pointResult, 'granted') ||
                Object.prototype.hasOwnProperty.call(pointResult, 'points') ||
                Object.prototype.hasOwnProperty.call(pointResult, 'totalPoints')
            );

            if (hasNewCheckinResult && json.success !== false && !['error', 'failed'].includes(json.status) && (json.code === undefined || json.code === 0 || json.code === 200) && res.status >= 200 && res.status < 300) {
                const exp = Number(data.exp || 0);
                const points = Number(pointResult.points || 0);
                const gained = [];
                if (data.granted === true && exp > 0) gained.push(`${exp} 经验`);
                if (pointResult.granted === true && points > 0) gained.push(`${points} 积分`);
                const message = gained.length
                    ? `签到成功，获得 ${gained.join('、')}`
                    : '新版接口确认今日已签到';
                return completeSign('galGameXNew', message, CLOSE_PAGE_AFTER_SIGN_ACTION);
            }
        } catch (err) {
            console.log('[GalgameX 新站] 接口响应不是 JSON:', text, err);
        }

        console.log('[GalgameX 新站] API 返回异常:', text);
        return false;
    }

    async function runFufugalPageSign(debugContext) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        const getNoticeText = getFufugalNotice;
        const waitForNoticeText = async (beforeText = '', timeout = 5000) => {
            const startedAt = Date.now();
            let lastText = '';
            while (Date.now() - startedAt < timeout) {
                const text = getNoticeText();
                if (text && text !== beforeText && (isSuccessText(text) || isLoginText(text) || isFailureText(text))) return text;
                if (text) lastText = text;
                await delay(250);
            }
            return lastText;
        };
        const isSuccessText = isFufugalConfirmed;
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

        const beforeNoticeText = getNoticeText();
        if (isSuccessText(beforeNoticeText)) {
            return completeSign('fufugal', beforeNoticeText);
        }

        const btn = await waitForElement(
            '#photo_wrap > figure > div.user-infos > div.xbs.el-tooltip__trigger.el-tooltip__trigger, #photo_wrap .user-infos .xbs',
            5000
        );
        if (!btn) {
            console.log('[初音的青葱] 未找到寻宝按钮');
            return false;
        }

        if (!markPendingAutoCloseAfterSignAction('fufugal', 'hunt-click')) return false;
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
        recordTargetStatus('fufugal', 'result-unknown', { stage: 'verify', message: '寻宝已点击但结果未确认，请重新检查' });
        return false;
    }

    function isSehuatangSignPage() {
        const pluginId = new URLSearchParams(location.search).get('id') || '';
        return location.pathname.endsWith('/plugin.php') && /^dd_sign(?::index)?$/i.test(pluginId);
    }

    function getSehuatangSignControlState() {
        const control = document.querySelector('.ddpc_sign_btna .ddpc_sign_btn_grey') ||
            document.querySelector('.ddpc_sign_btna #signin-btn, .ddpc_sign_btna > a');
        const text = (control?.innerText || control?.textContent || '').trim();
        return {
            isSigned: control?.classList.contains('ddpc_sign_btn_grey') || text === '今日已签到',
            canSign: control?.id === 'signin-btn' || text.includes('今日未签到')
        };
    }

    function monitorSehuatangManualSign(debugContext) {
        const container = document.querySelector('.ddpc_sign_btna');
        if (!container || container.dataset.bbsSignMonitor === '1') return;
        const operation = debugContext?.operation || pageOperations.get('sehuatang') || captureOperation('sehuatang');
        const actions = taskActions({ operation });
        container.dataset.bbsSignMonitor = '1';
        let timeout;
        const stop = () => { observer.disconnect(); clearTimeout(timeout); delete container.dataset.bbsSignMonitor; pageObserverStops.delete(stop); };
        const observer = new MutationObserver(() => {
            if (!isOperationCurrent(operation)) { stop(); return; }
            if (!getSehuatangSignControlState().isSigned) return;
            stop(); actions.completeSign('sehuatang', '页面显示今日已签到');
        });
        observer.observe(container, { attributes: true, attributeFilter: ['class', 'id'], childList: true, characterData: true, subtree: true });
        timeout = setTimeout(stop, AUTO_CLOSE_PENDING_TTL_MS);
        pageObserverStops.add(stop);
    }

    async function runSehuatangPageSign(debugContext) {
        const { completeSign, recordTargetStatus } = taskActions(debugContext);
        if (!isSehuatangSignPage()) {
            recordTargetStatus('sehuatang', 'needs-foreground', {
                stage: 'prerequisite',
                message: '请先在 98堂 回复 1 次，再手动进入签到页完成验证码',
                url: location.href
            });
            return false;
        }

        await delay(500);
        const signState = getSehuatangSignControlState();
        if (signState.isSigned) {
            return completeSign('sehuatang', '页面显示今日已签到');
        }
        if (signState.canSign) {
            monitorSehuatangManualSign(debugContext);
            recordTargetStatus('sehuatang', 'needs-foreground', {
                stage: 'captcha',
                message: '请手动点击签到并完成验证码，成功后脚本会自动识别',
                url: location.href
            });
            return false;
        }

        const bodyText = document.body?.innerText || '';
        const hasLoginForm = Boolean(document.querySelector('#lsform, #ls_username, input[name="username"], input[name="password"]'));
        const hasLogoutLink = Boolean(document.querySelector('a[href*="member.php?mod=logging"][href*="action=logout"]'));
        if (hasLoginForm || (!hasLogoutLink && /请先登录|登录后|您需要先登录/.test(bodyText))) {
            recordTargetStatus('sehuatang', 'needs-login', {
                stage: 'login',
                message: '98堂需要先登录账号',
                url: location.href
            });
            return false;
        }

        recordTargetStatus('sehuatang', 'opened', {
            stage: 'detect',
            message: '未识别到签到控件，请刷新签到页后重试',
            url: location.href
        });
        return false;
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
            async run(debugContext) {
                return await runSstmPageSign(debugContext);
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
                    if (!markPendingAutoCloseAfterSignAction('wcccc', 'sign-click')) return false;
                    btnSign.click();
                    recordTargetStatus('wcccc', 'result-unknown', { stage: 'verify', message: '已点击签到，等待站点确认' });
                    return false;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
                    return Boolean(document.querySelector('.qdleft .btnvisted, #JD_sign.btnvisted, .btnvisted'));
                };
                if (isSigned()) {
                    return completeSign('laowang', '页面显示今日已签到');
                }

                const isCaptchaVerified = () => {
                    const captchaResult = document.querySelector('#clicaptcha-submit-info')?.value?.trim() || '';
                    if (captchaResult.endsWith('_ok')) return true;

                    try {
                        const captchaApi = unsafeWindow.TN || unsafeWindow.tncode;
                        return typeof captchaApi?.result === 'function' && captchaApi.result() === true;
                    } catch (err) {
                        return false;
                    }
                };
                const getSignButton = () => {
                    const captchaForm = document.querySelector('#v2_captcha_form');
                    return captchaForm?.querySelector('#submit-btn, button[type="submit"], input[type="submit"]') ||
                        document.querySelector('a[href*="operation=qiandao"], #JD_sign, .qdleft a.btn');
                };
                const captchaMonitor = ensureCaptchaAutoSubmitMonitor({
                    siteKey: 'laowang',
                    siteName: '老王论坛',
                    actionLabel: '签到',
                    isSigned,
                    isVerified: isCaptchaVerified,
                    getSubmitButton: getSignButton,
                    onSuccess: () => completeSign('laowang', '人工验证后已自动签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION)
                });
                const isCaptchaPage = () => Array.from(document.querySelectorAll('#v2_captcha_form, #tncode, #tncode_div, #tncode_div_bg'))
                    .some(element => element.getClientRects().length > 0) ||
                    /请点击下面的按钮验证|点击进行验证/.test(document.body?.innerText || '');
                if (isCaptchaPage() && !isCaptchaVerified()) {
                    recordTargetStatus('laowang', 'needs-foreground', {
                        stage: 'captcha',
                        message: '老王论坛需要在前台完成点击验证，验证通过后将自动签到',
                        url: location.href
                    });
                    return false;
                }

                const btn = await waitForElement('a[href*="operation=qiandao"], #JD_sign, .qdleft a.btn', 5000);
                if (btn && !captchaMonitor.submitted) {
                    if (!markPendingAutoCloseAfterSignAction('laowang', 'sign-click')) return false;
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
                                message: '老王论坛需要在前台完成点击验证，验证通过后将自动签到',
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                try {
                    return await runFeixueApiSign(debugContext);
                } catch (err) {
                    console.log('[飞雪论坛] API 签到异常', err);
                    throw err;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                return await runSouthPlusApiSign(debugContext);
            }
        },
        {
            name: "2dfan",
            matches: ["galge.fun", "2dfan.com", "2dfan.org"],
            key: "2dfan",
            dashboard: {
                url: "https://2dfan.com/checkin",
                openMode: "foreground",
                resultMode: "script",
                note: "签到提交需要验证码校验，需前台完成"
            },
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                if (/^\/login\/?$/.test(location.pathname) || location.href.includes('not_authenticated') ||
                    location.href.includes('sign_in') || document.querySelector('a[href="/login"]')) {
                    recordTargetStatus('2dfan', 'needs-login', {
                        stage: 'login',
                        message: '2dfan 需要先登录账号',
                        url: location.href
                    });
                    return false;
                }

                if (!/^\/checkin\/?$/.test(location.pathname) && !location.href.includes('recheckin')) {
                    window.location.href = "/checkin";
                    return false;
                }

                if (/^\/checkin\/?$/.test(location.pathname)) {
                    const isCheckinPage = () => /^\/checkin\/?$/.test(location.pathname);
                    const isSigned = () => isCheckinPage() &&
                        Array.from(document.querySelectorAll('.checkin-action button'))
                            .some(button => button.textContent.trim() === '今日已签到');
                    // 新版是异步渲染页面；日历图例中的“已签到”不能作为今日成功标记。
                    const btn = await waitForElement('.checkin-action button', 10000);
                    if (isSigned()) {
                        return completeSign('2dfan', '页面显示今日已签到');
                    }
                    if (!isCheckinPage() || !btn) return false;

                    const getCaptchaDialog = () => isCheckinPage()
                        ? Array.from(document.querySelectorAll('[role="dialog"], .n-modal')).find(dialog =>
                            dialog.getClientRects().length > 0 && dialog.querySelector('.captcha-modal-body') &&
                            /人机验证/.test(dialog.textContent))
                        : null;
                    const getCaptchaConfirmButton = () => Array.from(getCaptchaDialog()?.querySelectorAll('button') || [])
                        .find(button => button.textContent.trim() === '确认');
                    const captchaMonitor = ensureCaptchaAutoSubmitMonitor({
                        siteKey: '2dfan',
                        siteName: '2dfan',
                        actionLabel: '确认签到',
                        isSigned,
                        // 新版在组件内部保存验证结果，阿里云验证不会写入 Turnstile 隐藏字段。
                        // 站点仅在 captchaReady 为真时启用确认按钮，以此兼容两种验证方式。
                        isVerified: () => {
                            const button = getCaptchaConfirmButton();
                            return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
                        },
                        getSubmitButton: getCaptchaConfirmButton,
                        onSuccess: () => completeSign('2dfan', '人工验证后已自动签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION)
                    });
                    if (captchaMonitor.finished) return true;
                    if (captchaMonitor.submitted) return false;

                    // 复查期间只打开一次，避免弹窗关闭或请求未完成时重复签到。
                    if (!getCaptchaDialog() && !captchaMonitor.dialogOpened && !btn.disabled &&
                        btn.textContent.trim() === '签到') {
                        captchaMonitor.dialogOpened = true;
                        if (!markPendingAutoCloseAfterSignAction('2dfan', 'sign-click')) return false;
                        btn.click();
                    }
                    recordTargetStatus('2dfan', 'needs-foreground', {
                        stage: 'captcha',
                        message: '2dfan 需要在前台完成人机验证，验证通过后将自动确认签到',
                        url: location.href
                    });
                    return false;
                }

                const isSigned = () => {
                    const signFlag = document.querySelector('#checkin');
                    const signFlag2 = document.querySelector('.checkin-info .pull-right');
                    const bodyText = document.body?.innerText || '';
                    return (signFlag && /今日已签到|今天已签到/.test(signFlag.innerText)) ||
                        (signFlag2 && /今日已签到|今天已签到/.test(signFlag2.innerText)) ||
                        false;
                };

                if (isSigned()) {
                    return completeSign('2dfan', '页面显示今日已签到');
                }

                const isCaptchaVerified = () => {
                    const turnstileToken = document.querySelector('input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"]');
                    const aliyunToken = document.querySelector('#aliyun-captcha-param, input[name="aliyun_captcha_verify_param"]');
                    return Boolean(turnstileToken?.value || aliyunToken?.value);
                };
                const getSignButton = () => {
                    const captchaForm = document.querySelector('#captcha-wrapper')?.closest('form');
                    return captchaForm?.querySelector('#do_checkin, #checkin, button[type="submit"], input[type="submit"]') ||
                        document.querySelector('#do_checkin, #checkin');
                };
                const btn = await waitForElement('#do_checkin, #checkin', 5000);
                const hasCaptcha = Boolean(document.querySelector('#captcha-wrapper, #turnstile-container, #aliyun-captcha-container'));
                if (btn && /签到|今日签到/.test(btn.innerText || btn.value || '')) {
                    if (hasCaptcha) {
                        ensureCaptchaAutoSubmitMonitor({
                            siteKey: '2dfan',
                            siteName: '2dfan',
                            actionLabel: '提交签到',
                            isSigned,
                            isVerified: isCaptchaVerified,
                            getSubmitButton: getSignButton,
                            onSuccess: () => completeSign('2dfan', '人工验证后已自动签到成功', CLOSE_PAGE_AFTER_SIGN_ACTION)
                        });

                        if (!isCaptchaVerified()) {
                            recordTargetStatus('2dfan', 'needs-foreground', {
                                stage: 'captcha',
                                message: '2dfan 需要在前台完成验证码，验证通过后将自动提交签到',
                                url: location.href
                            });
                            return false;
                        }
                        return false;
                    }

                    if (!markPendingAutoCloseAfterSignAction('2dfan', 'sign-click')) return false;
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
                        message: '2dfan 可能需要在前台完成验证码，验证通过后将自动提交签到',
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                return await runSlAsmrApiSign(debugContext);
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                try {
                    return await runAcgndogApiSign(debugContext);
                } catch (err) {
                    console.log('[次元狗] API 签到异常', err);
                    throw err;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                if (!location.href.includes('kf_growup.php')) {
                    window.location.href = 'kf_growup.php';
                    return false;
                }

                try {
                    return await runKfpromaxApiSign(debugContext);
                } catch (err) {
                    console.log('[绯月] API 签到异常', err);
                    throw err;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                try {
                    return await runVikApiSign(debugContext);
                } catch (err) {
                    console.log('[维咔] API 签到异常', err);
                    throw err;
                }
                return false;
            }
        },
        {
            name: "司机社",
            matches: ["sjs96.com"],
            key: "sijishe",
            dashboard: {
                url: "https://sjs96.com/k_misign-sign.html",
                openMode: "background",
                resultMode: "script",
                note: "支持控制台 API 直签"
            },
            directRun: runSijisheApiSign,
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                try {
                    return await runSijisheApiSign(debugContext);
                } catch (err) {
                    console.log('[司机社] API 签到异常', err);
                    throw err;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                return await runUuGgPageSign(debugContext);
            }
        },
        {
            name: "搜书吧",
            matches: ["sp6m.fwsefwef66s.com"],
            key: "soushuba",
            dashboard: {
                url: "https://sp6m.fwsefwef66s.com/",
                openMode: "background",
                resultMode: "script",
                note: "登录访问即自动获得 2 银币"
            },
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
            matches: ["www.galgamex.net"],
            key: "galGameXNew",
            dashboard: {
                url: "https://www.galgamex.net/",
                openMode: "background",
                resultMode: "script",
                note: "新版站点登录后自动签到，脚本调用接口并复查状态"
            },
            directRun: runGalgameXNewApiSign,
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                await delay(1000);

                const signedText = getGalgameXNewSignedText();
                if (signedText) {
                    return completeSign('galGameXNew', `页面显示${signedText}`, CLOSE_PAGE_AFTER_SIGN_ACTION);
                }

                try {
                    return await runGalgameXNewApiSign(debugContext);
                } catch (err) {
                    console.log('[GalgameX 新站] API 签到异常', err);
                    throw err;
                }
                return false;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
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
                    if (!form) {
                        recordTargetStatus('ZodGame', 'failed', { stage: 'form', reasonCode: 'adaptation', message: '未识别到签到表单，请前台检查' });
                        return false;
                    }
                    if (!markPendingAutoCloseAfterSignAction('ZodGame', 'sign-form-submit')) return false;
                    recordTargetStatus('ZodGame', 'result-unknown', { stage: 'verify', message: '已提交签到表单，等待结果页确认' });
                    form.submit();
                    return false;
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
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                try {
                    return await runFufugalPageSign(debugContext);
                } catch (err) {
                    console.log('[初音的青葱] 页面寻宝异常', err);
                }
                return false;
            }
        },
        {
            name: "98堂",
            matches: ["www.sehuatang.org"],
            key: "sehuatang",
            dashboard: {
                url: "https://www.sehuatang.org/forum.php",
                openMode: "foreground",
                resultMode: "script",
                note: "需先回复 1 次，再手动进入签到页完成点选验证码；脚本只检测结果"
            },
            async run(debugContext) {
                const { completeSign, recordTargetStatus } = taskActions(debugContext);
                return await runSehuatangPageSign(debugContext);
            }
        }
    ];

    function siteOutcome(site, context, value) {
        const status = getRawTargetStatus(site.key);
        const confirmed = status?.status === 'success' && isOperationCurrent(context?.operation) && (value === true || value?.outcome === 'success');
        return { outcome: confirmed ? 'success' : status?.status === 'needs-login' ? 'needs-login' : status?.status === 'needs-foreground' ? 'needs-verification' : value?.outcome === 'not-completed' ? 'not-completed' : context?.submitted ? 'waiting-result' : status?.status === 'failed' ? 'adaptation-error' : 'unknown',
            reasonCode: status?.reasonCode || '', message: status?.message || '未获得明确结果', evidence: confirmed ? status.evidence : '',
            evidenceDate: context?.operation?.date || getToday(), submitted: context?.submitted === true };
    }

    for (const site of siteConfigs) {
        site.check = async context => siteOutcome(site, context, await checkSiteResult(site, context));
        site.execute = async (context, direct = false) => siteOutcome(site, context, await (direct ? site.directRun(context) : site.run(context)));
    }

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
            recordTargetStatus(key, 'success', { context: entry.operation, stage: 'close', message: `${reason}；自动关闭受限，请手动关闭对应页面` });
        }
        launchedAutoCloseTabs.delete(key);
    }

    function syncLaunchedAutoCloseTabs(targets = getAllTargets()) {
        for (const [key, entry] of launchedAutoCloseTabs) {
            const status = getRawTargetStatus(key);
            const current = isOperationCurrent(entry.operation);
            if (entry.tab?.closed || Date.now() - entry.openedAt > AUTO_CLOSE_PENDING_TTL_MS || !current) {
                if (current && !isTargetDone(status?.status)) recordTargetStatus(key, 'result-unknown', {
                    context: entry.operation, stage: 'page-recovery', reasonCode: 'page-ended', message: '页面已关闭或任务超期，请先重新检查结果'
                });
                finishTaskLease(entry.operation);
                launchedAutoCloseTabs.delete(key);
                continue;
            }
            if (status?.status === 'success' && status.taskId === entry.operation.taskId && status.confirmationSource === 'automatic') {
                if (getDashboardConfig().preferences.autoClosePageAfterSign && typeof entry.tab?.close === 'function') {
                    closeLaunchedAutoCloseTab(key, entry, '对应任务已自动确认成功');
                } else launchedAutoCloseTabs.delete(key);
                finishTaskLease(entry.operation);
            }
        }
        if (!launchedAutoCloseTabs.size) stopLaunchedAutoCloseMonitor();
    }

    function startLaunchedAutoCloseMonitor() {
        if (!launchedAutoCloseMonitorTimer) launchedAutoCloseMonitorTimer = setInterval(syncLaunchedAutoCloseTabs, 1000);
    }

    function trackLaunchedAutoCloseTab(target, tab, operation) {
        launchedAutoCloseTabs.set(target.id, { tab, operation, openedAt: Date.now(), url: target.url });
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
        const tab = window.open(url, '_blank');
        if (tab) { try { tab.opener = null; } catch (err) { /* 管理器可能限制句柄。 */ } }
        return tab;
    }

    function showPageTaskInfo(target) {
        const entry = launchedAutoCloseTabs.get(target.id);
        if (typeof entry?.tab?.focus === 'function') { entry.tab.focus(); return; }
        const lease = getTaskLease(target.id);
        const dialog = el('dialog');
        dialog.style.cssText = 'max-width:min(90vw,600px);z-index:2147483647';
        dialog.append(el('h3', { text: `${target.name} · 当前任务` }),
            el('p', { text: hasActiveTask(target.id) ? `已存在有效任务，期限至 ${new Date(lease.expiresAt).toLocaleTimeString()}。请切回已打开的 ${target.name} 标签页；当前管理器无法直接激活它。` : '当前没有有效任务，可从目标行重新检查或打开。' }),
            el('p', { text: target.url }),
            el('button', { text: '关闭', onClick: () => dialog.remove() }));
        document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
    }

    function releaseLegacyQueuedTask(key) {
        const raw = getRawTargetStatus(key);
        if (raw?.status !== 'queued') return;
        const lease = getTaskLease(key);
        if (lease) finishTaskLease(lease);
        recordTargetStatus(key, 'not-started', { context: captureOperation(key), stage: 'queue-removed', message: '已取消旧排队，可立即执行' });
    }

    function launchTarget(target, checkOnly = false) {
        releaseLegacyQueuedTask(target.id);
        if (hasActiveTask(target.id)) return false;
        const raw = getRawTargetStatus(target.id);
        const manualCheck = raw?.stage === 'manual' && ['failed', 'skipped'].includes(raw.status);
        if (manualCheck) checkOnly = true;
        const operation = acquireTaskLease(target.id, 'page');
        if (!operation) return false;
        operation.checkOnly = checkOnly;
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.task, target.id), { ...getTaskLease(target.id), checkOnly, checkOnlySource: manualCheck ? 'manual' : checkOnly ? 'explicit' : '', updatedAt: Date.now(), expiresAt: Date.now() + AUTO_CLOSE_PENDING_TTL_MS });
        const url = new URL(target.url);
        if (target.builtIn) url.searchParams.set('__bbs_task', operation.taskId);
        try {
            const tab = openUrl(url.href, target.openMode);
            if (tab === null || (!tab && typeof GM_openInTab !== 'function')) throw new Error('浏览器拒绝打开页面');
            trackLaunchedAutoCloseTab(target, tab, operation);
            recordTargetStatus(target.id, 'opened', { context: operation, stage: 'launch', incrementAttempt: true, url: target.url,
                message: typeof tab?.close === 'function' ? '已打开对应任务页面，等待确认' : '已请求打开；管理器无法跟踪关闭，请手动确认' });
            return true;
        } catch (err) {
            recordTargetStatus(target.id, 'failed', { context: operation, reasonCode: 'open-failed', stage: 'launch', message: stringifyDebugError(err) });
            finishTaskLease(operation);
            return false;
        }
    }

    async function runDirectTargetOnce(target, site, operation, checkOnly = false) {
        const debugContext = startSignDebugCapture(target.id, target.name, checkOnly ? 'check' : 'direct-api');
        debugContext.operation = operation;
        recordTargetStatus(target.id, 'running', { stage: checkOnly ? 'verify' : 'direct-api', context: operation, incrementAttempt: !checkOnly, message: checkOnly ? '正在重新检查签到结果' : '正在从控制台发送签到请求' });
        try {
            const result = checkOnly ? await site.check(debugContext) : await site.execute(debugContext, true);
            if ((result === true || result?.outcome === 'success') && isOperationCurrent(operation) && getRawTargetStatus(target.id)?.status === 'success' && getRawTargetStatus(target.id)?.taskId === operation.taskId) return { isSuccess: true, debugContext };
            const status = getRawTargetStatus(target.id);
            if (checkOnly && result?.outcome === 'not-completed') return { isSuccess: false, debugContext, reason: { status: 'not-started', stage: 'verify', reasonCode: 'confirmed-unsigned', message: '已确认今日尚未完成，可再次执行签到', retryable: false } };
            return { isSuccess: false, debugContext, reason: { status: ['needs-login', 'needs-foreground', 'failed'].includes(status?.status) ? status.status : debugContext.submitted || checkOnly ? 'result-unknown' : 'failed', stage: status?.stage || 'verify', message: status?.status === 'running' ? '本次未获得明确成功证据，请检查结果' : status?.message || '结果未确认', reasonCode: status?.reasonCode || (debugContext.submitted || checkOnly ? 'unknown' : 'adaptation'), retryable: false } };
        } catch (error) {
            const code = error.reasonCode || (error instanceof SyntaxError ? 'adaptation' : 'network');
            return { isSuccess: false, debugContext, reason: { status: code === 'login' ? 'needs-login' : code === 'captcha' ? 'needs-foreground' : debugContext.submitted ? 'result-unknown' : 'failed', stage: 'request', message: stringifyDebugError(error), reasonCode: code, retryable: error.retryable === true || code === 'network', retryAfterMs: error.retryAfterMs || 0 } };
        } finally { finishSignDebugCapture(debugContext); }
    }

    async function executeDirectTarget(target, onProgress, operation, checkOnly) {
        const site = siteConfigs.find(item => item.key === target.siteKey && typeof item.directRun === 'function');
        if (!site) return false;
        let result;
        for (let attempt = 1; attempt <= DIRECT_SIGN_RETRY_ATTEMPTS; attempt++) {
            if (!isOperationCurrent(operation)) return false;
            result = await runDirectTargetOnce(target, site, operation, checkOnly);
            if (result.isSuccess) return true;
            if (['needs-login', 'needs-foreground'].includes(result.reason.status)) break;
            if (result.debugContext.submitted) {
                // 回包丢失也可能已经执行，只检查，不重新提交。
                const checked = await runDirectTargetOnce(target, site, operation, true);
                if (checked.isSuccess) return true;
                if (checked.reason?.reasonCode === 'confirmed-unsigned') { result = checked; break; }
                if (!['needs-login', 'needs-foreground'].includes(result.reason.status)) result.reason.status = 'result-unknown';
                break;
            }
            if (!result.reason.retryable || checkOnly || attempt === DIRECT_SIGN_RETRY_ATTEMPTS) break;
            persistSignDebugFailure(result.debugContext, { ...result.reason, attempt });
            const wait = Math.max(DIRECT_SIGN_RETRY_DELAY_MS * attempt, result.reason.retryAfterMs || 0);
            recordTargetStatus(target.id, 'running', { stage: 'retry', context: operation, message: `第 ${attempt} 次暂时失败，${Math.ceil(wait / 1000)} 秒后重试（${attempt + 1}/3）` });
            onProgress?.();
            await delay(wait);
        }
        if (result?.reason && isOperationCurrent(operation)) {
            recordTargetStatus(target.id, result.reason.status, { ...result.reason, context: operation, url: target.url });
            persistSignDebugFailure(result.debugContext, result.reason);
        }
        return false;
    }

    function getTaskLease(key) {
        const value = GM_getValue(getScopedStorageKey(STORAGE_KEYS.task, key));
        return value && typeof value === 'object' ? value : null;
    }

    function hasActiveTask(key) {
        const lease = getTaskLease(key);
        return Boolean(lease && lease.date === getToday() && lease.expiresAt > Date.now());
    }

    function acquireTaskLease(key, kind = 'direct', taskId = newOperationId()) {
        if (hasActiveTask(key)) return null;
        const operation = { ...captureOperation(key), taskId };
        const lease = { ...operation, kind, ownerId: executionOwnerId, updatedAt: Date.now(), expiresAt: Date.now() + (kind === 'page' ? AUTO_CLOSE_PENDING_TTL_MS : 30000) };
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.task, key), lease);
        return getTaskLease(key)?.taskId === taskId ? operation : null;
    }

    function finishTaskLease(operation) {
        const lease = getTaskLease(operation.key);
        if (lease?.taskId === operation.taskId) GM_setValue(getScopedStorageKey(STORAGE_KEYS.task, operation.key), { ...lease, expiresAt: 0 });
    }

    function runDirectTarget(target, onProgress, checkOnly = false) {
        if (directTasks.has(target.id)) return directTasks.get(target.id);
        releaseLegacyQueuedTask(target.id);
        const operation = acquireTaskLease(target.id);
        if (!operation) return Promise.resolve(false);
        const wasUnknown = ['result-unknown', 'running', 'opened'].includes(getNormalizedTargetStatus(target).status);
        const heartbeat = setInterval(() => {
            const lease = getTaskLease(target.id);
            if (isOperationCurrent(operation) && lease?.taskId === operation.taskId) GM_setValue(getScopedStorageKey(STORAGE_KEYS.task, target.id), { ...lease, expiresAt: Date.now() + 30000 });
        }, 10000);
        const promise = executeDirectTarget(target, onProgress, operation, checkOnly || wasUnknown)
            .catch(error => { console.error('[签到助手] 任务异常', error); return false; })
            .finally(() => {
                clearInterval(heartbeat);
                finishTaskLease(operation);
                directTasks.delete(target.id);
                onProgress?.();
            });
        directTasks.set(target.id, promise);
        return promise;
    }

    async function runDirectTargets(targets, rerender) {
        const runnableTargets = targets.filter(target => {
            if (!target.enabled || !target.directApi) return false;
            return !isTargetDone(getNormalizedTargetStatus(target).status) && !hasActiveTask(target.id);
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
            return !isTargetDone(targetStatus) && !hasActiveTask(target.id);
        });
    }

    function getDirectRunnableTargets() {
        return getAllTargets().filter(target => {
            if (!target.enabled || !target.directApi) return false;
            const targetStatus = getNormalizedTargetStatus(target).status;
            return !isTargetDone(targetStatus) && !hasActiveTask(target.id);
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
            reminderDismissedDay = getToday();
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
        if (signature === autoOpenSuppressedSignature || reminderDismissedDay === getToday()) {
            clearAutoOpenCountdown(false);
            return;
        }
        if (autoOpenTimer && autoOpenReminderSignature === signature) return;
        startAutoOpenCountdown(signature);
    }

    function setManualTargetStatus(target, status) {
        const snapshot = { target, status: getNormalizedTargetStatus(target), success: target.siteKey ? getData(target.siteKey) : undefined };
        const context = invalidateTargetOperation(target.id);
        if (target.siteKey && getData(target.siteKey) === getToday() && status !== 'success') clearSignSuccess(target.siteKey, '已清除人工撤销的今日成功记录', context);
        if (status === 'success' && target.siteKey) markSignSuccess(target.siteKey, '已从控制台手动标记成功', { source: 'manual', context });
        else recordTargetStatus(target.id, status, {
            stage: 'manual',
            context,
            confirmationSource: 'manual',
            message: STATUS_META[status]?.message || '已手动更新状态',
            url: target.url
        });
        snapshot.writeId = getRawTargetStatus(target.id)?.writeId;
        rememberManualUndo([snapshot]);
        return snapshot;
    }

    function invalidateTargetOperation(key) {
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.mutation, key), newOperationId());
        GM_setValue(getScopedStorageKey(STORAGE_KEYS.task, key), null);
        return captureOperation(key);
    }

    function resetTargetStatus(target) {
        return setManualTargetStatus(target, 'result-unknown');
    }

    function rememberManualUndo(entries) {
        clearTimeout(manualUndoTimer);
        manualUndo = { expiresAt: Date.now() + 10000, entries };
        manualUndoTimer = setTimeout(refreshDashboardData, 10001);
    }

    function undoManualStatus() {
        if (!manualUndo) return { restored: 0, changed: 0 };
        if (Date.now() > manualUndo.expiresAt) { const count = manualUndo.entries.length; manualUndo = null; return { restored: 0, changed: count }; }
        const entries = manualUndo.entries;
        clearTimeout(manualUndoTimer);
        manualUndo = null;
        let restored = 0;
        for (const entry of entries) {
            if (getRawTargetStatus(entry.target.id)?.writeId !== entry.writeId) continue;
            const context = invalidateTargetOperation(entry.target.id);
            if (entry.target.siteKey) {
                GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, entry.target.siteKey), entry.success || '');
                const legacy = readObject(STORAGE_KEYS.successData);
                if (entry.success) legacy[entry.target.siteKey] = entry.success;
                else delete legacy[entry.target.siteKey];
                writeObject(STORAGE_KEYS.successData, legacy);
            }
            recordTargetStatus(entry.target.id, entry.status?.status || 'not-started', {
                ...entry.status, stage: entry.status?.stage || 'manual', context
            });
            restored++;
        }
        return { restored, changed: entries.length - restored };
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
        for (const name of ['keydown', 'keypress', 'keyup', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
            input.addEventListener(name, event => event.stopPropagation());
        }
        return input;
    }

    function createSearchField(value, placeholder, onInput) {
        let composing = false;
        const input = shieldDashboardInput(el('input', { className: 'bbs-sign-field bbs-sign-search', type: 'search', value, placeholder, autocomplete: 'off',
            onInput: event => { if (!composing && !event.isComposing) onInput(event); } }));
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', event => { composing = false; onInput(event); });
        return input;
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
        const style = document.createElement('style');
        style.id = 'bbs-sign-dashboard-style';
        style.textContent = `
            #bbs-sign-dashboard-overlay [hidden] { display: none !important; }
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
                position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
                padding: 24px; background: rgba(19, 38, 35, .45); backdrop-filter: blur(8px);
                animation: bbs-sign-overlay-in 180ms ease-out both;
            }
            #bbs-sign-dashboard-overlay, #bbs-sign-dashboard-overlay * { box-sizing: border-box; }
            #bbs-sign-dashboard-overlay .bbs-sign-panel {
                --bbs-ink: #223b37; --bbs-muted: #778782; --bbs-line: #e2e9e5;
                --bbs-accent: #167461; --bbs-soft: #edf5f0;
                width: min(1040px, 100%); max-height: min(820px, calc(100dvh - 48px));
                display: flex; flex-direction: column; overflow: hidden;
                color: var(--bbs-ink); background: #f7f9f6; border: 1px solid rgba(255,255,255,.6);
                border-radius: 20px; box-shadow: 0 32px 100px #102a3040;
                font: 14px/1.6 "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left;
                animation: bbs-sign-panel-in 220ms ease-out both;
            }
            #bbs-sign-dashboard-overlay button, #bbs-sign-dashboard-overlay input,
            #bbs-sign-dashboard-overlay select, #bbs-sign-dashboard-overlay summary { font: inherit; letter-spacing: normal; }
            #bbs-sign-dashboard-overlay button, #bbs-sign-dashboard-overlay summary { touch-action: manipulation; }
            #bbs-sign-dashboard-overlay button:focus-visible, #bbs-sign-dashboard-overlay summary:focus-visible {
                outline: 2px solid var(--bbs-accent); outline-offset: 3px;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-header {
                flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px;
                padding: 24px 28px 20px; background: #fff; border-bottom: 1px solid var(--bbs-line);
            }
            #bbs-sign-dashboard-overlay .bbs-sign-brand { display: flex; align-items: center; gap: 13px; min-width: 0; }
            #bbs-sign-dashboard-overlay .bbs-sign-brand-mark {
                display: grid; place-items: center; flex-shrink: 0; width: 42px; height: 46px;
                border-radius: 13px 13px 17px 5px; background: var(--bbs-accent); color: #fff;
                font: 600 24px/1 "STKaiti", "KaiTi", serif; box-shadow: inset 0 0 0 1px #ffffff20;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-title { margin: 0; padding: 0; color: var(--bbs-ink); font-size: 21px; font-weight: 700; line-height: 1.4; }
            #bbs-sign-dashboard-overlay .bbs-sign-subtitle { margin-top: 3px; color: var(--bbs-muted); font-size: 12px; }
            #bbs-sign-dashboard-overlay .bbs-sign-header-tools { display: flex; align-items: center; gap: 18px; }
            #bbs-sign-dashboard-overlay .bbs-sign-date { color: var(--bbs-muted); font-size: 12px; white-space: nowrap; }
            #bbs-sign-dashboard-overlay .bbs-sign-close {
                display: grid; place-items: center; width: 32px; height: 32px; padding: 0;
                border: 1px solid var(--bbs-line); border-radius: 50%; background: #fff; color: #73847c; cursor: pointer; font-size: 22px;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-close:hover { color: var(--bbs-ink); background: var(--bbs-soft); }
            #bbs-sign-dashboard-overlay .bbs-sign-body { min-height: 0; padding: 0 28px 24px; overflow: auto; scrollbar-width: thin; scrollbar-color: #c5d3cb transparent; }
            #bbs-sign-dashboard-overlay .bbs-sign-overview { margin: 22px 0 18px; }
            #bbs-sign-dashboard-overlay .bbs-sign-overview-head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 10px; }
            #bbs-sign-dashboard-overlay .bbs-sign-overview-label { color: var(--bbs-ink); font-size: 13px; font-weight: 600; }
            #bbs-sign-dashboard-overlay .bbs-sign-progress-label { color: var(--bbs-muted); font-size: 12px; }
            #bbs-sign-dashboard-overlay .bbs-sign-progress { height: 4px; overflow: hidden; background: #e3ebe5; border-radius: 4px; }
            #bbs-sign-dashboard-overlay .bbs-sign-progress-fill { height: 100%; background: var(--bbs-accent); border-radius: inherit; transition: width 240ms ease; }
            #bbs-sign-dashboard-overlay .bbs-sign-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 16px; }
            #bbs-sign-dashboard-overlay .bbs-sign-stat { min-width: 0; padding: 0 20px; border-left: 1px solid var(--bbs-line); }
            #bbs-sign-dashboard-overlay .bbs-sign-stat:first-child { padding-left: 0; border-left: 0; }
            #bbs-sign-dashboard-overlay .bbs-sign-card-label { display: flex; align-items: center; gap: 6px; color: var(--bbs-muted); font-size: 12px; white-space: nowrap; }
            #bbs-sign-dashboard-overlay .bbs-sign-card-label::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--stat-color, #a2aca5); }
            #bbs-sign-dashboard-overlay .bbs-sign-card-value { margin-top: 3px; color: var(--stat-color, var(--bbs-ink)); font: 500 30px/1.2 "Bahnschrift", "DIN Alternate", sans-serif; font-variant-numeric: tabular-nums; }
            #bbs-sign-dashboard-overlay .bbs-sign-stat.success { --stat-color: #167461; }
            #bbs-sign-dashboard-overlay .bbs-sign-stat.danger { --stat-color: #bc5e50; }
            #bbs-sign-dashboard-overlay .bbs-sign-stat.pending { --stat-color: #b28235; }
            #bbs-sign-dashboard-overlay .bbs-sign-card { min-width: 0; padding: 16px; border: 1px solid var(--bbs-line); border-radius: 12px; background: #fff; }
            #bbs-sign-dashboard-overlay .bbs-sign-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 20px; padding: 0; }
            #bbs-sign-dashboard-overlay[data-view="settings"] .bbs-sign-toolbar { padding-top: 20px; }
            #bbs-sign-dashboard-overlay .bbs-sign-search-wrap { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
            #bbs-sign-dashboard-overlay .bbs-sign-search-wrap > .bbs-sign-message { flex-shrink: 0; white-space: nowrap; }
            #bbs-sign-dashboard-overlay .bbs-sign-search-wrap::before {
                content: ""; position: absolute; left: 13px; top: 12px; width: 10px; height: 10px;
                border: 1.5px solid #82948b; border-radius: 50%; pointer-events: none;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-search-wrap::after { content: ""; position: absolute; left: 23px; top: 23px; width: 5px; height: 1.5px; background: #82948b; transform: rotate(45deg); pointer-events: none; }
            #bbs-sign-dashboard-overlay .bbs-sign-actions, #bbs-sign-dashboard-overlay .bbs-sign-row-actions,
            #bbs-sign-dashboard-overlay .bbs-sign-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            #bbs-sign-dashboard-overlay .bbs-sign-actions { flex-shrink: 0; }
            #bbs-sign-dashboard-overlay .bbs-sign-button {
                display: inline-flex; align-items: center; justify-content: center; min-height: 36px;
                margin: 0; padding: 7px 12px; border: 1px solid #dbe4dd; border-radius: 8px;
                color: #496056; background: #fff; cursor: pointer; font-size: 12px; font-weight: 600; line-height: 1.5;
                white-space: nowrap; box-shadow: none; transition: background 120ms ease, border-color 120ms ease;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-button:hover { background: var(--bbs-soft); border-color: #b8cdbf; }
            #bbs-sign-dashboard-overlay .bbs-sign-button.primary { color: #fff; border-color: var(--bbs-accent); background: var(--bbs-accent); }
            #bbs-sign-dashboard-overlay .bbs-sign-button.primary:hover { background: #115f50; }
            #bbs-sign-dashboard-overlay .bbs-sign-button.danger { color: #af554b; border-color: #efd9d3; background: #fff5f1; }
            #bbs-sign-dashboard-overlay .bbs-sign-button.ghost { background: transparent; border-color: transparent; color: var(--bbs-muted); }
            #bbs-sign-dashboard-overlay .bbs-sign-button.ghost:hover { background: #e9efea; color: var(--bbs-ink); }
            #bbs-sign-dashboard-overlay .bbs-sign-button:disabled { opacity: .45; cursor: not-allowed; }
            #bbs-sign-dashboard-overlay .bbs-sign-list { display: grid; gap: 8px; }
            #bbs-sign-dashboard-overlay .bbs-sign-row, #bbs-sign-dashboard-overlay .bbs-sign-setting-row {
                display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px;
                padding: 15px 16px; border: 1px solid var(--bbs-line); border-radius: 11px; background: #fff;
            }
            #bbs-sign-dashboard-overlay .bbs-sign-row { border-left: 3px solid #d9e4dc; }
            #bbs-sign-dashboard-overlay .bbs-sign-row { grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 8px; }
            #bbs-sign-dashboard-overlay .bbs-sign-row-controls { display: contents; }
            #bbs-sign-dashboard-overlay .bbs-sign-row-controls > button { grid-column: 2; grid-row: 1; }
            #bbs-sign-dashboard-overlay .bbs-sign-setting-row .bbs-sign-row-actions { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); }
            #bbs-sign-dashboard-overlay .bbs-sign-row[data-tone="warning"] { border-left-color: #d0a857; }
            #bbs-sign-dashboard-overlay .bbs-sign-row[data-tone="danger"] { border-left-color: #ce8477; }
            #bbs-sign-dashboard-overlay .bbs-sign-row[data-tone="success"] { border-left-color: #74aa91; }
            #bbs-sign-dashboard-overlay .bbs-sign-row-main { min-width: 0; }
            #bbs-sign-dashboard-overlay .bbs-sign-name-line { display: flex; align-items: center; flex-wrap: wrap; column-gap: 9px; row-gap: 3px; }
            #bbs-sign-dashboard-overlay .bbs-sign-name { color: var(--bbs-ink); font-size: 14px; font-weight: 700; }
            #bbs-sign-dashboard-overlay .bbs-sign-url, #bbs-sign-dashboard-overlay .bbs-sign-meta { color: var(--bbs-muted); font-size: 11px; overflow-wrap: anywhere; }
            #bbs-sign-dashboard-overlay .bbs-sign-name-line .bbs-sign-url { margin-left: 3px; }
            #bbs-sign-dashboard-overlay .bbs-sign-message { margin-top: 5px; color: #5b6e63; font-size: 12px; overflow-wrap: anywhere; }
            #bbs-sign-dashboard-overlay .bbs-sign-row .bbs-sign-message:empty { display: none; }
            #bbs-sign-dashboard-overlay .bbs-sign-meta { margin-top: 3px; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge { display: inline-flex; align-items: center; border-radius: 5px; padding: 1px 6px; font-size: 10px; font-weight: 500; line-height: 1.7; white-space: nowrap; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge.success { color: #2e7d61; background: #e8f4ec; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge.pending { color: #507c91; background: #edf4f7; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge.warning { color: #9b742d; background: #faf0d9; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge.danger { color: #aa594c; background: #fceee8; }
            #bbs-sign-dashboard-overlay .bbs-sign-badge.neutral, #bbs-sign-dashboard-overlay .bbs-sign-badge.muted { color: #829087; background: #f0f3ef; }
            #bbs-sign-dashboard-overlay .bbs-sign-section { margin-top: 20px; }
            #bbs-sign-dashboard-overlay .bbs-sign-section-title { display: flex; align-items: center; gap: 9px; margin: 22px 0 10px; color: var(--bbs-ink); font-size: 13px; font-weight: 700; }
            #bbs-sign-dashboard-overlay summary.bbs-sign-section-title { margin: 0 0 10px; cursor: pointer; list-style: none; }
            #bbs-sign-dashboard-overlay summary::-webkit-details-marker { display: none; }
            #bbs-sign-dashboard-overlay summary.bbs-sign-section-title::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid #84978c; border-bottom: 1.5px solid #84978c; transform: rotate(-45deg); transition: transform 120ms ease; }
            #bbs-sign-dashboard-overlay details[open] > summary.bbs-sign-section-title::before { transform: rotate(45deg) translateY(-2px); }
            #bbs-sign-dashboard-overlay .bbs-sign-section-count { display: inline-grid; place-items: center; min-width: 21px; height: 20px; padding: 0 6px; background: #e9efea; color: #6b8274; border-radius: 5px; font-size: 11px; font-weight: 500; }
            #bbs-sign-dashboard-overlay .bbs-sign-section-hint { margin-left: auto; color: #97a39b; font-size: 11px; font-weight: 400; }
            #bbs-sign-dashboard-overlay .bbs-sign-batch { margin: 6px 0 0; font-size: 11px; }
            #bbs-sign-dashboard-overlay .bbs-sign-more { position: relative; }
            #bbs-sign-dashboard-overlay .bbs-sign-more { grid-column: 3; grid-row: 1; }
            #bbs-sign-dashboard-overlay .bbs-sign-more > summary::after { content: "⌄"; margin-left: 7px; font-size: 13px; }
            #bbs-sign-dashboard-overlay .bbs-sign-more[open] { display: contents; }
            #bbs-sign-dashboard-overlay .bbs-sign-more[open] > summary { grid-column: 3; grid-row: 1; background: var(--bbs-soft); }
            #bbs-sign-dashboard-overlay .bbs-sign-more::details-content { grid-column: 1 / -1; grid-row: 2; }
            #bbs-sign-dashboard-overlay .bbs-sign-more-menu { grid-column: 1 / -1; grid-row: 2; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; padding: 8px; border: 1px solid var(--bbs-line); border-radius: 10px; background: #f7faf7; }
            #bbs-sign-dashboard-overlay .bbs-sign-more-menu .bbs-sign-button { min-height: 30px; padding: 5px 8px; font-weight: 400; font-size: 11px; }
            #bbs-sign-dashboard-overlay .bbs-sign-feedback:empty { display: none; }
            #bbs-sign-dashboard-overlay .bbs-sign-feedback { margin-bottom: 12px; }
            #bbs-sign-dashboard-overlay .bbs-sign-empty { padding: 44px 20px; text-align: center; color: var(--bbs-muted); border: 1px dashed #cfdbd2; border-radius: 12px; font-size: 13px; }
            #bbs-sign-dashboard-overlay .bbs-sign-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 18px; border: 1px solid var(--bbs-line); border-radius: 12px; background: #fff; margin-bottom: 16px; }
            #bbs-sign-dashboard-overlay .bbs-sign-field-wrap { display: grid; gap: 6px; min-width: 0; }
            #bbs-sign-dashboard-overlay .bbs-sign-field-wrap.full { grid-column: 1 / -1; }
            #bbs-sign-dashboard-overlay .bbs-sign-label { color: #617668; font-size: 12px; font-weight: 500; }
            #bbs-sign-dashboard-overlay .bbs-sign-field { min-width: 0; width: 100%; height: 38px; margin: 0; padding: 8px 10px; border: 1px solid #dce5de; border-radius: 8px; color: var(--bbs-ink); background: #fff; font: inherit; font-size: 12px; box-shadow: none; }
            #bbs-sign-dashboard-overlay .bbs-sign-field:focus { border-color: #4c9983; box-shadow: 0 0 0 3px #16746112; outline: none; }
            #bbs-sign-dashboard-overlay .bbs-sign-field::placeholder { color: #94a198; opacity: 1; }
            #bbs-sign-dashboard-overlay .bbs-sign-search { padding-left: 34px; background: #fff; }
            #bbs-sign-dashboard-overlay .bbs-sign-check { display: inline-flex; align-items: center; gap: 7px; margin-right: 16px; color: #526a5c; font-size: 12px; }
            #bbs-sign-dashboard-overlay input[type="checkbox"] { accent-color: var(--bbs-accent); width: 14px; height: 14px; flex-shrink: 0; margin: 0; }
            @keyframes bbs-sign-overlay-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes bbs-sign-panel-in { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: none; } }
            @media (max-width: 900px) {
                #bbs-sign-dashboard-overlay .bbs-sign-toolbar { flex-wrap: wrap; }
                #bbs-sign-dashboard-overlay .bbs-sign-toolbar > .bbs-sign-search-wrap { flex-basis: 100%; }
            }
            @media (max-width: 600px) {
                #bbs-sign-dashboard-overlay { padding: 10px; }
                #bbs-sign-dashboard-overlay .bbs-sign-panel { max-height: calc(100dvh - 20px); border-radius: 15px; }
                #bbs-sign-dashboard-overlay .bbs-sign-header { padding: 17px 16px; }
                #bbs-sign-dashboard-overlay .bbs-sign-title { font-size: 17px; }
                #bbs-sign-dashboard-overlay .bbs-sign-brand { gap: 10px; }
                #bbs-sign-dashboard-overlay .bbs-sign-brand-mark { width: 35px; height: 40px; font-size: 21px; }
                #bbs-sign-dashboard-overlay .bbs-sign-date { display: none; }
                #bbs-sign-dashboard-overlay .bbs-sign-body { padding: 0 16px 20px; }
                #bbs-sign-dashboard-overlay .bbs-sign-overview { margin-top: 18px; }
                #bbs-sign-dashboard-overlay .bbs-sign-stat { padding: 0 8px; }
                #bbs-sign-dashboard-overlay .bbs-sign-card-label { gap: 4px; font-size: 10px; }
                #bbs-sign-dashboard-overlay .bbs-sign-card-value { font-size: 24px; }
                #bbs-sign-dashboard-overlay .bbs-sign-overview-head { gap: 8px; }
                #bbs-sign-dashboard-overlay .bbs-sign-progress-label { font-size: 10px; }
                #bbs-sign-dashboard-overlay .bbs-sign-actions { display: grid; grid-template-columns: 1fr 1fr; width: 100%; gap: 6px; }
                #bbs-sign-dashboard-overlay .bbs-sign-row, #bbs-sign-dashboard-overlay .bbs-sign-setting-row { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 13px; }
                #bbs-sign-dashboard-overlay .bbs-sign-row { grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; }
                #bbs-sign-dashboard-overlay .bbs-sign-row > .bbs-sign-row-main { grid-column: 1 / -1; }
                #bbs-sign-dashboard-overlay .bbs-sign-row-controls > button,
                #bbs-sign-dashboard-overlay .bbs-sign-more,
                #bbs-sign-dashboard-overlay .bbs-sign-more[open] > summary { grid-row: 2; }
                #bbs-sign-dashboard-overlay .bbs-sign-more-menu { grid-row: 3; grid-template-columns: repeat(2, minmax(0, 1fr)); }
                #bbs-sign-dashboard-overlay .bbs-sign-more::details-content { grid-row: 3; }
                #bbs-sign-dashboard-overlay .bbs-sign-name-line .bbs-sign-url { width: 100%; margin-left: 0; }
                #bbs-sign-dashboard-overlay .bbs-sign-section-hint { display: none; }
                #bbs-sign-dashboard-overlay .bbs-sign-form { grid-template-columns: minmax(0, 1fr); padding: 14px; }
                #bbs-sign-dashboard-overlay .bbs-sign-check { margin: 4px 0; }
                #bbs-sign-dashboard-overlay .bbs-sign-setting-row .bbs-sign-row-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }
            @media (prefers-reduced-motion: reduce) {
                #bbs-sign-dashboard-overlay, #bbs-sign-dashboard-overlay .bbs-sign-panel { animation: none; }
                #bbs-sign-dashboard-overlay * { transition: none !important; }
            }
        `;
        (document.head || document.documentElement).append(style);
    }

    function createSummaryCard(label, value, tone = '') {
        return el('div', { className: `bbs-sign-stat ${tone}` }, [
            el('div', { className: 'bbs-sign-card-label', text: label }),
            el('div', { className: 'bbs-sign-card-value', text: String(value) })
        ]);
    }

    function createStatusBadge(status) {
        const meta = STATUS_META[status] || STATUS_META['not-started'];
        return el('span', { className: `bbs-sign-badge ${meta.tone}`, text: meta.label });
    }

    function createTargetRow(target, rerender) {
        const row = el('div', { className: 'bbs-sign-row' });
        row.dataset.target = target.id;
        const name = el('span', { className: 'bbs-sign-name' });
        const badge = createStatusBadge('not-started');
        const url = el('span', { className: 'bbs-sign-url' });
        const message = el('div', { className: 'bbs-sign-message' });
        const meta = el('div', { className: 'bbs-sign-meta' });
        const main = el('div', { className: 'bbs-sign-row-main' }, [el('div', { className: 'bbs-sign-name-line' }, [name, badge, url]), message, meta]);
        const primary = el('button', { className: 'bbs-sign-button primary', type: 'button', onClick: async () => {
            const item = row.target;
            if (hasActiveTask(item.id)) { showPageTaskInfo(item); return; }
            const status = getNormalizedTargetStatus(item).status;
            if (item.directApi && !['needs-login', 'needs-foreground'].includes(status)) await runDirectTarget(item, rerender, ['result-unknown', 'success'].includes(status));
            else launchTarget(item, ['result-unknown', 'success'].includes(status));
            rerender();
        } });
        const more = el('details', { className: 'bbs-sign-more' });
        more.append(el('summary', { className: 'bbs-sign-button', text: '更多' }));
        const menu = el('div', { className: 'bbs-sign-more-menu' });
        for (const [label, action] of [
            ['查看任务', () => showPageTaskInfo(row.target)],
            ['打开页面', () => launchTarget(row.target)],
            ['重新检查', async () => { if (row.target.directApi) await runDirectTarget(row.target, rerender, true); else launchTarget(row.target, true); }],
            ['标记成功', () => setManualTargetStatus(row.target, 'success')],
            ['标记失败', () => setManualTargetStatus(row.target, 'failed')],
            ['今日跳过', () => setManualTargetStatus(row.target, 'skipped')],
            ['重置', () => resetTargetStatus(row.target)],
            ['查看诊断', () => showTargetDiagnostics(row.target)]
        ]) menu.append(el('button', { className: 'bbs-sign-button', type: 'button', text: label, onClick: async () => { await action(); more.open = false; rerender(); } }));
        more.append(menu);
        more.addEventListener('toggle', () => { if (!more.open) rerender(); });
        row.append(main, el('div', { className: 'bbs-sign-row-actions bbs-sign-row-controls' }, [primary, more]));
        row.patch = item => {
            row.target = item;
            const status = getNormalizedTargetStatus(item);
            const info = STATUS_META[status.status] || STATUS_META['not-started'];
            name.textContent = item.name;
            try { url.textContent = new URL(item.url).hostname.replace(/^www\./, ''); }
            catch { url.textContent = item.url; }
            url.title = item.url;
            row.dataset.tone = info.tone;
            badge.textContent = info.label;
            badge.className = `bbs-sign-badge ${info.tone}`;
            message.textContent = status.status === 'not-started' ? item.note || '' : status.message || item.note || info.message;
            message.title = item.note || '';
            const source = { automatic: '自动确认', manual: '人工标记', legacy: '旧版记录' }[status.confirmationSource] || '';
            meta.textContent = [item.directApi ? '控制台直签' : OPEN_MODE_LABELS[item.openMode], source, status.updatedAt ? `更新于 ${getTimeLabel(status.updatedAt)}` : '今日尚未执行'].filter(Boolean).join(' · ');
            meta.title = item.note || '';
            primary.textContent = hasActiveTask(item.id) && !['queued', 'running'].includes(status.status) ? '查看任务' : ['queued', 'running'].includes(status.status) ? info.label : status.status === 'success' ? '重新检查' : status.status === 'result-unknown' ? '检查结果' : status.status === 'failed' ? '重试' : ['needs-login', 'needs-foreground'].includes(status.status) ? '前台处理' : item.directApi ? '直签' : '打开';
            primary.disabled = !item.enabled || ['running', 'queued'].includes(status.status) || directTasks.has(item.id);
        };
        row.patch(target);
        return row;
    }

    function groupForStatus(status) {
        if (['success', 'skipped'].includes(status)) return 'completed';
        if (['queued', 'running', 'opened'].includes(status)) return 'processing';
        if (['failed', 'result-unknown'].includes(status)) return 'failed';
        if (['needs-login', 'needs-foreground'].includes(status)) return 'attention';
        return 'unstarted';
    }

    function getDashboardSummary(targets) {
        const summary = { total: 0, success: 0, skipped: 0, pending: 0, failed: 0, todo: 0 };
        for (const target of targets.filter(item => item.enabled)) {
            summary.total++;
            const status = getNormalizedTargetStatus(target).status;
            if (status === 'success') summary.success++;
            else if (status === 'skipped') summary.skipped++;
            else if (status === 'failed') summary.failed++;
            else if (groupForStatus(status) === 'unstarted') summary.todo++;
            else summary.pending++;
        }
        return summary;
    }

    function splitDashboardTargets(targets) {
        const groups = { attention: [], processing: [], failed: [], completed: [], unstarted: [] };
        for (const target of targets) groups[groupForStatus(getNormalizedTargetStatus(target).status)].push(target);
        return groups;
    }

    function markTargetsSuccess(targets) {
        const entries = [];
        for (const target of targets) {
            if (hasActiveTask(target.id) || ['running', 'queued'].includes(getNormalizedTargetStatus(target).status)) continue;
            entries.push(setManualTargetStatus(target, 'success'));
        }
        rememberManualUndo(entries);
    }

    function renderDashboardView(body, rerender) {
        const search = createSearchField(dashboardSearchQuery, '搜索站点名称、网址或备注', event => {
            dashboardSearchQuery = event.target.value; rerender();
        });
        const summary = el('div', { className: 'bbs-sign-summary' });
        const progressLabel = el('span', { className: 'bbs-sign-progress-label' });
        const progressFill = el('div', { className: 'bbs-sign-progress-fill' });
        const progress = el('div', { className: 'bbs-sign-progress' }, [progressFill]);
        progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-label', '今日签到处理进度');
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        const overview = el('div', { className: 'bbs-sign-overview' }, [
            el('div', { className: 'bbs-sign-overview-head' }, [el('span', { className: 'bbs-sign-overview-label', text: '今日概览' }), progressLabel]), progress, summary
        ]);
        const feedback = el('div', { className: 'bbs-sign-message bbs-sign-feedback' });
        feedback.setAttribute('role', 'status');
        const undo = el('button', { className: 'bbs-sign-button', text: '撤销人工操作（10秒）', type: 'button', onClick: () => {
            const result = undoManualStatus();
            feedback.textContent = `已撤销 ${result.restored} 项；${result.changed} 项已有后续更新或已过期，保持现状`;
            rerender();
        } });
        const actions = el('div', { className: 'bbs-sign-actions' });
        for (const [label, action, tone] of [
            ['一键处理未完成', async () => { const direct = runDirectTargets(getDirectRunnableTargets(), rerender); for (const target of getLaunchableTargets()) launchTarget(target); rerender(); await direct; }, 'primary'],
            ['一键直签', () => runDirectTargets(getDirectRunnableTargets(), rerender), ''],
            ['刷新状态', rerender, 'ghost'],
            ['配置清单', () => showDashboard('settings'), 'ghost']
        ]) actions.append(el('button', { className: `bbs-sign-button ${tone}`, text: label, type: 'button', onClick: async () => { await action(); rerender(); } }));
        search.setAttribute('aria-label', '搜索签到站点');
        body.append(overview, el('div', { className: 'bbs-sign-toolbar' }, [el('div', { className: 'bbs-sign-search-wrap' }, [search]), actions]), undo, feedback);
        const sections = new Map();
        for (const [key, title, hint] of [['attention', '人工待办', '需要你完成最后一步'], ['processing', '自动处理中', '任务结果将自动更新'], ['failed', '失败与待检查', '检查结果后可重试'], ['completed', '已完成（含跳过）', '今日已处理'], ['unstarted', '未开始', '准备好后即可一键处理']]) {
            const section = el('details', { className: 'bbs-sign-section' });
            section.dataset.group = key;
            section.open = key !== 'completed';
            const count = el('span', { className: 'bbs-sign-section-count' });
            const heading = el('summary', { className: 'bbs-sign-section-title' }, [el('span', { text: title }), count, el('span', { className: 'bbs-sign-section-hint', text: hint })]);
            const list = el('div', { className: 'bbs-sign-list' });
            section.append(heading, list);
            if (key === 'attention') section.append(el('button', { className: 'bbs-sign-button ghost bbs-sign-batch', text: '批量人工确认成功', type: 'button', onClick: () => {
                markTargetsSuccess(getAllTargets().filter(item => item.enabled && groupForStatus(getNormalizedTargetStatus(item).status) === 'attention' && targetMatchesSearch(item, dashboardSearchQuery)));
                feedback.textContent = `已人工确认 ${manualUndo?.entries.length || 0} 项，可在十秒内撤销`; rerender();
            } }));
            body.append(section); sections.set(key, { section, count, list, title });
        }
        const empty = el('div', { className: 'bbs-sign-empty' });
        body.append(empty);
        const rows = new Map();
        body.refresh = () => {
            syncLaunchedAutoCloseTabs();
            const targets = getAllTargets().filter(item => item.enabled);
            const values = getDashboardSummary(targets);
            const done = values.success + values.skipped;
            const percent = values.total ? Math.round(done / values.total * 100) : 0;
            progressLabel.textContent = `${done} / ${values.total} 项已处理 · ${percent}%`;
            progressFill.style.width = `${percent}%`;
            progress.setAttribute('aria-valuenow', String(percent));
            summary.replaceChildren(...[['已成功', values.success, 'success'], ['已跳过', values.skipped, ''], ['失败', values.failed, 'danger'], ['处理 / 待办', values.pending, 'pending'], ['未开始', values.todo, '']].map(([label, count, tone]) => createSummaryCard(label, count, tone)));
            for (const target of targets) {
                let row = rows.get(target.id);
                if (!row) { row = createTargetRow(target, rerender); rows.set(target.id, row); }
                else row.patch(target);
                row.hidden = !targetMatchesSearch(target, dashboardSearchQuery);
                const group = groupForStatus(getNormalizedTargetStatus(target).status);
                // 有焦点或菜单展开时延后移动该行，保留键盘/鼠标操作现场。
                if (!row.contains(document.activeElement) && !row.querySelector('details[open]') && row.parentNode !== sections.get(group).list) sections.get(group).list.append(row);
                else if (!row.parentNode) sections.get(group).list.append(row);
            }
            for (const [id, row] of rows) if (!targets.some(item => item.id === id)) { row.remove(); rows.delete(id); }
            let visibleCount = 0;
            for (const section of sections.values()) {
                // 延后移动的行仍属于当前显示分组，避免菜单或焦点随空分区一起消失。
                const count = [...section.list.children].filter(row => !row.hidden).length;
                section.count.textContent = String(count);
                section.section.hidden = count === 0;
                visibleCount += count;
            }
            empty.hidden = visibleCount > 0;
            empty.textContent = dashboardSearchQuery.trim() ? '没有找到匹配的站点，试试其他名称、网址或备注。' : '还没有启用的签到站点，前往「配置清单」添加或启用。';
            undo.hidden = !manualUndo || manualUndo.expiresAt < Date.now();
        };
        body.refresh();
        body.addEventListener('focusout', () => setTimeout(rerender, 0));
    }

    function refreshDashboardData() {
        const overlay = document.getElementById('bbs-sign-dashboard-overlay');
        if (overlay?.dataset.view === 'dashboard') dashboardMounted?.body.refresh?.();
        updateDashboardReminderButton();
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
        const builtInTargets = allBuiltInTargets;
        const customTargets = allCustomTargets;
        const editingTarget = allCustomTargets.find(target => target.id === editingId) || null;
        const searchInput = createSearchField(settingsSearchQuery, '搜索配置项、网址或备注', (event) => {
            settingsSearchQuery = event.target.value;
            for (const row of body.querySelectorAll('[data-setting-target]')) row.hidden = !targetMatchesSearch(JSON.parse(row.dataset.settingTarget), settingsSearchQuery);
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
                refreshDashboardData();
            }
        });
        const autoCloseInput = el('input', {
            type: 'checkbox',
            checked: config.preferences.autoClosePageAfterSign,
            onChange: (event) => {
                updateDashboardPreference({ autoClosePageAfterSign: event.target.checked });
                refreshDashboardData();
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
            row.dataset.settingTarget = JSON.stringify(target);
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
                        if (ok) { dashboardMounted.views.delete('settings'); showDashboard('settings'); }
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
            const customRow = el('div', { className: 'bbs-sign-setting-row' }, [
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
                                dashboardMounted.views.delete('settings'); showDashboard('settings');
                            }
                        }
                    })
                ])
            ]);
            customRow.dataset.settingTarget = JSON.stringify(target);
            customList.append(customRow);
        }
        body.append(customList);
        appendBackupSettings(body);
    }

    function closeDashboardOverlay(overlay) {
        clearAutoOpenCountdown(true);
        overlay.remove();
        refreshSyncPolling();
        updateDashboardReminderButton();
    }

    function showDashboard(view = 'dashboard', editingId = '') {
        addDashboardStyles();
        for (const target of getAllTargets()) releaseLegacyQueuedTask(target.id);
        clearAutoOpenCountdown(true);
        if (!dashboardMounted) {
            const overlay = el('div', { onClick: event => { if (event.target === overlay) closeDashboardOverlay(overlay); } });
            overlay.id = 'bbs-sign-dashboard-overlay';
            const panel = el('section', { className: 'bbs-sign-panel' });
            const title = el('h2', { className: 'bbs-sign-title' });
            title.id = 'bbs-sign-dashboard-title';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', title.id);
            const subtitle = el('div', { className: 'bbs-sign-subtitle' });
            const date = el('span', { className: 'bbs-sign-date' });
            const close = el('button', { className: 'bbs-sign-close', type: 'button', text: '×', title: '关闭控制台', onClick: () => closeDashboardOverlay(overlay) });
            close.setAttribute('aria-label', '关闭控制台');
            panel.append(el('header', { className: 'bbs-sign-header' }, [
                el('div', { className: 'bbs-sign-brand' }, [el('span', { className: 'bbs-sign-brand-mark', text: '签' }), el('div', {}, [title, subtitle])]),
                el('div', { className: 'bbs-sign-header-tools' }, [date, close])
            ]));
            // 在冒泡阶段隔离宿主热键，不阻止目标输入事件抵达自己的监听器。
            for (const name of ['keydown', 'keypress', 'keyup', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) panel.addEventListener(name, event => event.stopPropagation());
            overlay.append(panel);
            dashboardMounted = { overlay, panel, title, subtitle, date, body: null, views: new Map(), editingId: '' };
        }
        const mounted = dashboardMounted;
        if (view === 'settings' && editingId !== mounted.editingId) { mounted.views.delete('settings'); mounted.editingId = editingId; }
        if (mounted.body) mounted.body.remove();
        let body = mounted.views.get(view);
        if (!body) {
            body = el('div', { className: 'bbs-sign-body' });
            mounted.views.set(view, body);
            if (view === 'settings') renderSettingsView(body, editingId);
            else renderDashboardView(body, refreshDashboardData);
        }
        mounted.body = body;
        mounted.overlay.dataset.view = view;
        mounted.title.textContent = view === 'settings' ? '签到清单配置' : '每日签到控制台';
        mounted.subtitle.textContent = view === 'settings' ? '管理站点、打开方式与确认偏好' : '每天一点，轻松完成';
        mounted.date.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
        mounted.panel.append(body);
        if (!mounted.overlay.isConnected) document.body.append(mounted.overlay);
        refreshDashboardData();
        refreshSyncPolling();
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

    function refreshSyncPolling() {
        if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
        if ((typeof GM_addValueChangeListener !== 'function' || typeof GM_removeValueChangeListener !== 'function') && (!document.hidden || directTasks.size || launchedAutoCloseTabs.size)) {
            syncPollTimer = setInterval(checkSynchronizedState, 5000);
        }
    }

    function scheduleSynchronizedRefresh() {
        if (syncRefreshTimer) return;
        syncRefreshTimer = setTimeout(() => { syncRefreshTimer = null; checkSynchronizedState(); }, 50);
    }

    function bindStateListeners() {
        if (typeof GM_removeValueChangeListener === 'function') for (const id of syncListenerIds) GM_removeValueChangeListener(id);
        syncListenerIds = [];
        if (typeof GM_addValueChangeListener !== 'function' || typeof GM_removeValueChangeListener !== 'function') return;
        const keys = new Set([STORAGE_KEYS.dashboardConfig, STORAGE_KEYS.dashboardStatus, STORAGE_KEYS.successData]);
        for (const target of getAllTargets()) {
            keys.add(getTargetStatusStorageKey(getToday(), target.id));
            keys.add(getScopedStorageKey(STORAGE_KEYS.successData, target.id));
            keys.add(getScopedStorageKey(STORAGE_KEYS.task, target.id));
        }
        for (const key of keys) syncListenerIds.push(GM_addValueChangeListener(key, () => {
            if (key === STORAGE_KEYS.dashboardConfig) bindStateListeners();
            scheduleSynchronizedRefresh();
        }));
    }

    function scheduleMidnightCheck() {
        clearTimeout(midnightTimer);
        const next = new Date(); next.setHours(24, 0, 0, 50);
        midnightTimer = setTimeout(() => { checkSynchronizedState(); scheduleMidnightCheck(); }, Math.max(50, next.getTime() - Date.now()));
    }

    function checkSynchronizedState() {
        if (syncDay !== getToday()) {
            syncDay = getToday();
            bindStateListeners();
            scheduleMidnightCheck();
            clearAutoOpenCountdown(false);
            runDailyHistoryCleanup();
        }
        refreshDashboardData();
    }

    function stopStateSynchronization() {
        for (const id of syncListenerIds) GM_removeValueChangeListener(id);
        syncListenerIds = [];
        clearInterval(syncPollTimer); clearTimeout(midnightTimer); clearTimeout(syncRefreshTimer); clearTimeout(manualUndoTimer);
        syncPollTimer = midnightTimer = syncRefreshTimer = null;
        stopLaunchedAutoCloseMonitor(); clearAutoOpenCountdown(false);
        for (const state of captchaAutoSubmitStates.values()) state.stop?.();
        for (const stop of pageObserverStops) stop();
    }

    function startStateSynchronization() {
        if (syncStarted) return;
        syncStarted = true;
        if (!isLimestartHost()) { window.addEventListener('pagehide', stopStateSynchronization); runDailyHistoryCleanup(); return; }
        syncDay = getToday(); bindStateListeners(); scheduleMidnightCheck(); refreshSyncPolling(); runDailyHistoryCleanup();
        window.addEventListener('focus', checkSynchronizedState);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSynchronizedState(); refreshSyncPolling(); });
        window.addEventListener('pagehide', stopStateSynchronization);
        window.addEventListener('pageshow', () => { bindStateListeners(); checkSynchronizedState(); scheduleMidnightCheck(); refreshSyncPolling(); });
    }

    function listOwnedDataKeys() {
        if (typeof GM_listValues !== 'function') throw new Error('当前脚本管理器不支持枚举存储，无法安全恢复或清理；请更新管理器');
        return GM_listValues().filter(key => [STORAGE_KEYS.dashboardConfig, STORAGE_KEYS.successData, STORAGE_KEYS.dashboardStatus, STORAGE_KEYS.mutation, STORAGE_KEYS.task].some(base => key === base || key.startsWith(base + ':')));
    }

    function deleteStoredValue(key) {
        if (typeof GM_deleteValue !== 'function') throw new Error('当前脚本管理器不支持同步删除存储，请更新管理器');
        GM_deleteValue(key);
    }

    function isValidDay(day) {
        try { return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day; } catch (err) { return false; }
    }

    function backupUrl(value) {
        const url = new URL(value);
        url.username = ''; url.password = '';
        for (const key of [...url.searchParams.keys()]) if (DEBUG_SENSITIVE_KEY_RE.test(key) || key === '__bbs_task') url.searchParams.delete(key);
        return url.href;
    }

    function portableState(state) {
        const transient = ['running', 'queued', 'opened'].includes(state.status);
        return { schemaVersion: 1, status: STATUS_META[state.status] && !transient ? state.status : 'result-unknown',
            stage: transient ? 'restore-check' : state.stage || '', confirmationSource: ['manual', 'automatic', 'legacy'].includes(state.confirmationSource) ? state.confirmationSource : 'legacy',
            message: truncateDebugText(redactDebugText(transient ? '已恢复未完成记录，请重新检查结果' : state.message || ''), 500),
            updatedAt: state.updatedAt || '', reasonCode: transient ? 'restored' : state.reasonCode || '' };
    }

    function structuredCopy(value) { return JSON.parse(JSON.stringify(value)); }

    function createBackup(includeStates = false, snapshotEntries = null) {
        const snapshot = snapshotEntries ? new Map(snapshotEntries) : null;
        const config = snapshot ? normalizeDashboardConfig(snapshot.get(STORAGE_KEYS.dashboardConfig) || DEFAULT_DASHBOARD_CONFIG) : getDashboardConfig();
        config.customTargets = config.customTargets.map(item => ({ id: item.id, name: item.name, url: backupUrl(item.url), enabled: item.enabled !== false, openMode: item.openMode || 'background', resultMode: item.resultMode || 'opened', note: redactDebugText(item.note || '') }));
        config.targetSettings = Object.fromEntries(Object.entries(config.targetSettings).map(([id, item]) => [id, { enabled: item.enabled !== false, openMode: item.openMode || siteConfigs.find(site => site.key === id)?.dashboard.openMode || 'background', resultMode: item.resultMode || 'script', ...(item.url ? { url: backupUrl(item.url) } : {}) }]));
        const backup = { type: 'BBSSignHelperBackup', schemaVersion: 1, exportedAt: getLocalDateTimeWithOffset(), config };
        if (includeStates) {
            const successDates = snapshot ? structuredCopy(snapshot.get(STORAGE_KEYS.successData) || {}) : readObject(STORAGE_KEYS.successData);
            const dailyStatus = snapshot ? structuredCopy(snapshot.get(STORAGE_KEYS.dashboardStatus) || {}) : getStatusStore();
            for (const key of snapshot ? snapshot.keys() : listOwnedDataKeys()) {
                if (key.startsWith(STORAGE_KEYS.successData + ':')) successDates[key.slice(STORAGE_KEYS.successData.length + 1)] = snapshot ? snapshot.get(key) : GM_getValue(key);
                if (key.startsWith(STORAGE_KEYS.dashboardStatus + ':')) {
                    const rest = key.slice(STORAGE_KEYS.dashboardStatus.length + 1); const day = rest.slice(0, 10); const id = rest.slice(11);
                    if (isValidDay(day)) { dailyStatus[day] = dailyStatus[day] || {}; dailyStatus[day][id] = snapshot ? snapshot.get(key) : GM_getValue(key); }
                }
            }
            backup.states = { successDates: Object.fromEntries(Object.entries(successDates).filter(([, day]) => isValidDay(day))),
                dailyStatus: Object.fromEntries(Object.entries(dailyStatus).filter(([day]) => isValidDay(day)).map(([day, values]) => [day, Object.fromEntries(Object.entries(values).filter(([, value]) => value && typeof value === 'object').map(([id, state]) => [id, portableState(state)]))])) };
        }
        return backup;
    }

    function validateBackup(text) {
        if (typeof text !== 'string' || new Blob([text]).size > 5 * 1024 * 1024) throw new Error('备份不得超过 5 MiB');
        let backup;
        try { backup = JSON.parse(text); } catch (err) { throw new Error('备份不是合法 JSON'); }
        const object = value => value && typeof value === 'object' && !Array.isArray(value);
        const fail = () => { throw new Error('备份字段、网址、日期或枚举值无效'); };
        if (!object(backup) || backup.type !== 'BBSSignHelperBackup' || backup.schemaVersion !== 1) throw new Error('不支持的备份类型或格式版本');
        const config = backup.config;
        if (!object(config) || !object(config.targetSettings) || !object(config.preferences) || !Array.isArray(config.customTargets) || config.customTargets.length > 200) fail();
        const ids = new Set(siteConfigs.map(site => site.key));
        const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(id) && !/[\s:]/.test(id);
        const validModes = item => ['background', 'foreground', 'manual'].includes(item.openMode) && ['script', 'opened', 'manual'].includes(item.resultMode) && typeof item.enabled === 'boolean';
        for (const item of config.customTargets) {
            if (!object(item) || !validId(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || !safeUrl(item.url) || !validModes(item) || (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 2000))) fail();
            ids.add(item.id);
        }
        for (const [id, item] of Object.entries(config.targetSettings)) if (!siteConfigs.some(site => site.key === id) || !object(item) || !validModes(item) || (item.url !== undefined && !safeUrl(item.url))) fail();
        for (const key of ['autoClosePageAfterSign', 'autoOpenDashboardOnAttention']) if (typeof config.preferences[key] !== 'boolean') fail();
        if (![undefined, 0, 7, 30, 90].includes(config.preferences.historyRetentionDays)) fail();
        if (backup.states !== undefined) {
            const states = backup.states;
            if (!object(states) || !object(states.successDates) || !object(states.dailyStatus) || Object.keys(states.dailyStatus).length > 1000) fail();
            for (const [id, day] of Object.entries(states.successDates)) if (!validId(id) || !isValidDay(day)) fail();
            let count = 0;
            for (const [day, values] of Object.entries(states.dailyStatus)) {
                if (!isValidDay(day) || !object(values)) fail();
                for (const [id, state] of Object.entries(values)) {
                    if (++count > 20000 || !validId(id) || !object(state) || typeof state.status !== 'string' || (state.confirmationSource && !['automatic', 'manual', 'legacy'].includes(state.confirmationSource)) || (state.updatedAt && !Number.isFinite(Date.parse(state.updatedAt)))) fail();
                    values[id] = portableState(state);
                }
            }
        }
        // 只接受声明字段，避免把未知对象带回配置或运行时状态。
        return { type: backup.type, schemaVersion: 1, config: { targetSettings: Object.fromEntries(Object.entries(config.targetSettings).map(([id, item]) => [id, { enabled: item.enabled, openMode: item.openMode, resultMode: item.resultMode, ...(item.url ? { url: backupUrl(item.url) } : {}) }])),
            customTargets: config.customTargets.map(item => ({ id: item.id, name: item.name, url: backupUrl(item.url), enabled: item.enabled, openMode: item.openMode, resultMode: item.resultMode, note: redactDebugText(item.note || '') })), preferences: { autoClosePageAfterSign: config.preferences.autoClosePageAfterSign, autoOpenDashboardOnAttention: config.preferences.autoOpenDashboardOnAttention, historyRetentionDays: config.preferences.historyRetentionDays || 0 } }, ...(backup.states ? { states: backup.states } : {}) };
    }

    function previewBackup(backup, sections = { config: true, states: false }) {
        return { configTargets: sections.config ? siteConfigs.length + backup.config.customTargets.length : 0,
            dates: sections.states && backup.states ? Object.keys(backup.states.successDates).length : 0,
            records: sections.states && backup.states ? Object.values(backup.states.dailyStatus).reduce((sum, day) => sum + Object.keys(day).length, 0) : 0 };
    }

    function restoreImportSnapshot() {
        const snapshot = GM_getValue(STORAGE_KEYS.recovery);
        if (!snapshot || !Array.isArray(snapshot.entries)) throw new Error('未找到有效恢复快照');
        GM_setValue(STORAGE_KEYS.importPending, { restoring: true });
        for (const key of listOwnedDataKeys()) deleteStoredValue(key);
        for (const [key, value] of snapshot.entries) GM_setValue(key, value);
        GM_setValue(STORAGE_KEYS.importPending, null);
    }

    function recoverPendingImport() {
        if (!GM_getValue(STORAGE_KEYS.importPending)) return true;
        try { restoreImportSnapshot(); alert('已恢复上次未完成导入之前的数据。'); return true; }
        catch (err) { alert('上次导入未完成，自动恢复失败；恢复快照仍保留，请在配置页重试恢复。' + stringifyDebugError(err)); return false; }
    }

    function applyBackup(backup, sections = { config: true, states: false }) {
        if (GM_getValue(STORAGE_KEYS.importPending)) throw new Error('请先恢复上次未完成的导入，再应用新备份');
        // API 入口再次验证，预览之后的对象也不能绕过校验。
        backup = validateBackup(JSON.stringify(backup));
        if (!sections.config && !(sections.states && backup.states)) throw new Error('请选择至少一个可恢复分区');
        const entries = listOwnedDataKeys().map(key => [key, GM_getValue(key)]);
        if (new Blob([JSON.stringify(entries)]).size > 5 * 1024 * 1024) throw new Error('当前恢复快照超过 5 MiB，请先导出备份并按保留策略清理历史');
        GM_setValue(STORAGE_KEYS.recovery, { savedAt: getLocalDateTimeWithOffset(), entries });
        GM_setValue(STORAGE_KEYS.importPending, { startedAt: getLocalDateTimeWithOffset() });
        try {
            if (sections.config) saveDashboardConfig(backup.config);
            if (sections.states && backup.states) {
                for (const target of getAllTargets()) invalidateTargetOperation(target.id);
                for (const key of listOwnedDataKeys()) if ([STORAGE_KEYS.successData, STORAGE_KEYS.dashboardStatus].some(base => key === base || key.startsWith(base + ':'))) deleteStoredValue(key);
                GM_setValue(STORAGE_KEYS.successData, backup.states.successDates);
                GM_setValue(STORAGE_KEYS.dashboardStatus, backup.states.dailyStatus);
                for (const [id, day] of Object.entries(backup.states.successDates)) GM_setValue(getScopedStorageKey(STORAGE_KEYS.successData, id), day);
                for (const [day, values] of Object.entries(backup.states.dailyStatus)) for (const [id, value] of Object.entries(values)) {
                    const context = invalidateTargetOperation(id);
                    GM_setValue(getTargetStatusStorageKey(day, id), { ...portableState(value), mutationId: context.mutationId, writeId: newOperationId() });
                }
            }
            GM_setValue(STORAGE_KEYS.importPending, null);
            return { ...previewBackup(backup, sections), recovered: false };
        } catch (err) {
            try { restoreImportSnapshot(); } catch (recoveryError) { throw new Error('导入失败，自动恢复也失败；快照已保留，可重试恢复：' + stringifyDebugError(recoveryError)); }
            throw new Error('导入失败，已恢复导入前数据：' + stringifyDebugError(err));
        }
    }

    function previewHistoryCleanup(days = getDashboardConfig().preferences.historyRetentionDays) {
        if (![7, 30, 90].includes(days)) return { dates: [], scopedKeys: [], records: 0 };
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days + 1); const limit = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
        const dates = new Set(Object.keys(getStatusStore()).filter(day => isValidDay(day) && day < limit));
        const scopedKeys = listOwnedDataKeys().filter(key => {
            if (!key.startsWith(STORAGE_KEYS.dashboardStatus + ':')) return false;
            const day = key.slice(STORAGE_KEYS.dashboardStatus.length + 1, STORAGE_KEYS.dashboardStatus.length + 11);
            if (isValidDay(day) && day < limit) { dates.add(day); return true; } return false;
        });
        const pairs = new Set();
        for (const day of dates) for (const id of Object.keys(getStatusStore()[day] || {})) pairs.add(day + ':' + id);
        for (const key of scopedKeys) pairs.add(key.slice(STORAGE_KEYS.dashboardStatus.length + 1));
        return { dates: [...dates].sort(), scopedKeys, records: pairs.size };
    }

    function cleanHistory(preview = previewHistoryCleanup(), maxDates = Infinity) {
        const selected = new Set(preview.dates.slice(0, maxDates));
        const store = getStatusStore();
        for (const day of selected) delete store[day];
        // 先移除汇总，再移除拆分；旧镜像不能复活已清理的数据。
        saveStatusStore(store);
        for (const key of preview.scopedKeys) if (selected.has(key.slice(STORAGE_KEYS.dashboardStatus.length + 1, STORAGE_KEYS.dashboardStatus.length + 11))) deleteStoredValue(key);
        return selected.size;
    }

    function runDailyHistoryCleanup() {
        if (!getDashboardConfig().preferences.historyRetentionDays || GM_getValue('BBSSignHelperHistoryCleanupDay') === getToday()) return;
        try { cleanHistory(previewHistoryCleanup(), 20); GM_setValue('BBSSignHelperHistoryCleanupDay', getToday()); }
        catch (err) { console.log('[签到助手] 历史自动清理未完成', stringifyDebugError(err)); }
    }

    function downloadJson(value, filename) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
        const link = el('a', { href: url }); link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function appendBackupSettings(body) {
        const feedback = el('div', { className: 'bbs-sign-message' });
        const include = el('input', { type: 'checkbox' });
        const importConfig = el('input', { type: 'checkbox', checked: true });
        const importStates = el('input', { type: 'checkbox' });
        const input = shieldDashboardInput(el('input', { type: 'file' })); input.accept = '.json,application/json';
        let pending = null;
        const describe = () => {
            if (!pending) return;
            const count = previewBackup(pending, { config: importConfig.checked, states: importStates.checked });
            feedback.textContent = `分区替换预览：配置目标 ${count.configTargets}，成功日期 ${count.dates}，每日记录 ${count.records}；未选分区保留。应用前会保存恢复快照。`;
        };
        input.addEventListener('change', async () => {
            pending = null;
            try { const file = input.files[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MiB'); pending = validateBackup(await file.text()); describe(); }
            catch (err) { feedback.textContent = stringifyDebugError(err); }
        });
        importConfig.addEventListener('change', describe); importStates.addEventListener('change', describe);
        const safeAction = fn => () => { try { fn(); } catch (err) { feedback.textContent = stringifyDebugError(err); } };
        body.append(el('div', { className: 'bbs-sign-section-title', text: '备份、恢复与历史' }), el('div', { className: 'bbs-sign-card' }, [
            el('label', {}, [include, el('span', { text: '导出时包含日期和可恢复状态' })]),
            el('button', { className: 'bbs-sign-button', text: '导出备份', onClick: safeAction(() => downloadJson(createBackup(include.checked), `bbs-sign-backup-${getToday()}.json`)) }),
            input,
            el('label', {}, [importConfig, el('span', { text: '替换配置' })]), el('label', {}, [importStates, el('span', { text: '替换备份中的状态' })]),
            el('button', { className: 'bbs-sign-button', text: '应用已预览备份', onClick: safeAction(() => { if (!pending) throw new Error('请先选择有效备份并查看预览'); const result = applyBackup(pending, { config: importConfig.checked, states: importStates.checked }); feedback.textContent = `已恢复：配置目标 ${result.configTargets}，日期 ${result.dates}，记录 ${result.records}`; pending = null; bindStateListeners(); }) }),
            el('button', { className: 'bbs-sign-button', text: '下载恢复快照', onClick: safeAction(() => { const snapshot = GM_getValue(STORAGE_KEYS.recovery); if (!snapshot?.entries) throw new Error('暂无恢复快照'); downloadJson(createBackup(true, snapshot.entries), `bbs-sign-recovery-${getToday()}.json`); }) }),
            el('button', { className: 'bbs-sign-button', text: '恢复导入前快照', onClick: safeAction(() => { restoreImportSnapshot(); feedback.textContent = '已恢复导入前快照'; refreshDashboardData(); }) }),
            createSelect(getDashboardConfig().preferences.historyRetentionDays, [{ value: 0, label: '历史保留全部（默认）' }, { value: 7, label: '保留7天' }, { value: 30, label: '保留30天' }, { value: 90, label: '保留90天' }], event => updateDashboardPreference({ historyRetentionDays: Number(event.target.value) })),
            el('button', { className: 'bbs-sign-button', text: '预览并清理历史', onClick: safeAction(() => { const preview = previewHistoryCleanup(); feedback.textContent = `清理范围：${preview.dates.join('、') || '无'}，${preview.records} 条记录`; if (preview.dates.length && confirm(feedback.textContent + '。执行清理？')) { cleanHistory(preview); feedback.textContent = `已清理 ${preview.dates.length} 个日期、${preview.records} 条记录`; } }) }), feedback
        ]));
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

    const recoverySucceeded = recoverPendingImport();
    registerDashboardMenu();
    if (recoverySucceeded) startStateSynchronization();

    if (isLimestartHost(currentHost)) {
        initDashboardEntry();
        return;
    }

    if (!recoverySucceeded) return;

    for (const site of siteConfigs) {
        // 匹配域名
        const isMatch = site.matches.some(domain => currentHost.includes(domain));
        if (isMatch) {
            console.log(`[签到助手] 进入 ${site.name} 模块`);

            releaseLegacyQueuedTask(site.key);
            const manualStatus = getRawTargetStatus(site.key);
            let operation = bindPageTask(site.key);
            if (manualStatus?.stage === 'manual' && ['failed', 'skipped'].includes(manualStatus.status) && !operation?.checkOnly) return;
            // 验证前的入口点击、未完成状态不能阻止站点继续执行。
            // ZodGame 已发出的签到表单只查结果；SS同盟按原站点流程自行检查和刷新重试。
            const submittedForm = site.key === 'ZodGame' && (manualStatus?.status === 'result-unknown' || hasPageSubmittedAction(site.key, operation));
            const recoveryOnly = Boolean(operation?.checkOnly || submittedForm);
            if (!operation && hasActiveTask(site.key)) {
                showPageSignToast(site.key, 'opened', { message: '此站点正在其他页面处理，请回到对应任务页' });
                return;
            }
            operation = operation || acquireTaskLease(site.key, 'page');
            if (!operation) return;
            pageOperations.set(site.key, operation);
            sessionStorage.setItem(`BBSSignHelperPageTask:${site.key}`, operation.taskId);
            const hasConfirmedToday = isSignSuccessRecorded(site.key);
            const shouldRecheckUuGgSignPage = site.key === 'uugg' && /plugin\.php\?id=dsu_paulsign(?::|%3A)sign/i.test(location.href);
            if (hasConfirmedToday && !recoveryOnly && !shouldRecheckUuGgSignPage && site.key !== 'sstm') {
                console.log(`[签到助手] ${site.name} 今日已完成，跳过。`);
                recordTargetStatus(site.key, 'success', {
                    stage: 'skip',
                    message: '今日已完成，跳过执行',
                    url: location.href,
                    autoClosePageSignToastAfterMs: PAGE_COMPLETED_TOAST_AUTO_CLOSE_MS,
                    countCompletedPageSignToast: true
                });
                maybeAutoClosePageAfterSign(site.key);
                finishTaskLease(operation);
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
                const pageResult = await runPageTask(site, debugContext, recoveryOnly);
                let isSuccess = pageResult.outcome === 'success';
                if (!isSuccess && site.key !== 'sstm' && pageResult.outcome !== 'not-completed' && !['needs-login', 'needs-foreground', 'failed'].includes(getRawTargetStatus(site.key)?.status)) {
                    isSuccess = await waitForSiteSuccessRecheck(site);
                }
                if (isSuccess) {
                    if (!isSignSuccessRecorded(site.key)) await checkSiteResult(site, debugContext);
                } else {
                    const rawAfterStatus = getRawTargetStatus(site.key);
                    if (!rawAfterStatus || rawAfterStatus.writeId === beforeStatus?.writeId) {
                        const isSstm = site.key === 'sstm';
                        recordTargetStatus(site.key, isSstm ? 'needs-foreground' : debugContext.submitted || recoveryOnly ? 'result-unknown' : 'failed', {
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
                const reasonCode = err.reasonCode || 'adaptation';
                let recovered = false;
                if (debugContext.submitted && !['login', 'captcha', 'cancelled'].includes(reasonCode)) {
                    try { recovered = (await site.check(debugContext)).outcome === 'success'; } catch (checkError) { /* 结果未知保留人工检查。 */ }
                }
                if (!recovered) recordTargetStatus(site.key, reasonCode === 'login' ? 'needs-login' : reasonCode === 'captcha' ? 'needs-foreground' : debugContext.submitted ? 'result-unknown' : 'failed', {
                    reasonCode, stage: 'error',
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
                // 人工验证码监视器可以继续保留到页面租约期限；不永久续租。
                if (!['needs-foreground', 'needs-login', 'result-unknown', 'opened'].includes(getRawTargetStatus(site.key)?.status)) finishTaskLease(operation);
            }
            break; // 匹配到一个站点后就不再往下走了
        }
    }

})();
