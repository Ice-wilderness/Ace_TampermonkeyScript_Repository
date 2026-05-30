// ==UserScript==
// @name         【自写】自用论坛辅助签到自写
// @namespace    bbshelperforme
// @version      2.3.0
// @description  论坛辅助签到工具 - 支持 limestart 签到控制台、可配置打开清单与多站点自动签到
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
// @match        http*://www.vikacg.com/*
// @match        http*://feixueacg.org/*
// @match        http*://www.galgamex.org/*
// @match        http*://www.acgndog.com/*
// @match        http*://www.galgamex.top/*
// @match        http*://zodgame.xyz/*
// @match        http*://www.fufugal.com/*
// @match        *://sstm.moe/*
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
        dashboardStatus: 'BBSSignHelperDashboardStatus'
    };

    const STATUS_META = {
        'not-started': { label: '待开始', tone: 'neutral', message: '今日尚未处理' },
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
            autoOpenDashboardOnAttention: false
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

    function readObject(key, fallback = {}) {
        const value = GM_getValue(key);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return JSON.parse(JSON.stringify(fallback));
        }
        return value;
    }

    function writeObject(key, value) {
        GM_setValue(key, value);
    }

    // 获取数据
    function getData(key) {
        const data = readObject(STORAGE_KEYS.successData);
        return data[key];
    }

    // 设置数据并标记今日已签到
    function markSignSuccess(key, message = '今日签到已确认') {
        const data = readObject(STORAGE_KEYS.successData);
        data[key] = getToday();
        writeObject(STORAGE_KEYS.successData, data);
        recordTargetStatus(key, 'success', {
            stage: 'verify',
            message,
            url: location.href
        });
        console.log(`[签到助手] ${key} 签到状态已更新为：${data[key]}`);
    }

    function completeSign(key, message) {
        markSignSuccess(key, message);
        return true;
    }

    function getDashboardConfig() {
        const config = readObject(STORAGE_KEYS.dashboardConfig, DEFAULT_DASHBOARD_CONFIG);
        const preferences = config.preferences && typeof config.preferences === 'object' ? config.preferences : {};
        return {
            targetSettings: config.targetSettings && typeof config.targetSettings === 'object' ? config.targetSettings : {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: preferences.autoOpenDashboardOnAttention === true
            }
        };
    }

    function saveDashboardConfig(config) {
        writeObject(STORAGE_KEYS.dashboardConfig, {
            targetSettings: config.targetSettings || {},
            customTargets: Array.isArray(config.customTargets) ? config.customTargets : [],
            preferences: {
                autoOpenDashboardOnAttention: config.preferences?.autoOpenDashboardOnAttention === true
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

    function recordTargetStatus(key, status, options = {}) {
        if (!key) return;
        const today = getToday();
        const store = getStatusStore();
        const dayStatus = store[today] || {};
        const previous = dayStatus[key] || {};
        dayStatus[key] = {
            status,
            stage: options.stage || previous.stage || '',
            message: options.message || STATUS_META[status]?.message || previous.message || '',
            updatedAt: new Date().toISOString(),
            url: options.url || previous.url || location.href,
            attemptCount: options.incrementAttempt ? (previous.attemptCount || 0) + 1 : (previous.attemptCount || 0)
        };
        store[today] = dayStatus;
        saveStatusStore(store);
        updateDashboardReminderButton();
    }

    function getRawTargetStatus(key) {
        const store = getStatusStore();
        const todayStatus = store[getToday()] || {};
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
            return {
                status: 'success',
                stage: raw?.stage || 'legacy',
                message: raw?.message || '从既有签到记录同步为成功',
                updatedAt: raw?.updatedAt || '',
                url: raw?.url || target.url,
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

    function safeUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
        } catch (e) {
            return '';
        }
        return '';
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
                        return completeSign('sstm', '评论区已检测到今日回帖');
                    } else if (!currentUserLink) {
                        // 兼容极端情况：如果未能获取到当前用户信息，降级为检查严格的日期时间格式
                        const commentsArea = document.querySelector('[data-role="commentFeed"]');
                        const strictDateRegex = new RegExp(`${year}年${month}月${date}日\\s+\\d{2}:\\d{2}:\\d{2}`);
                        if (commentsArea && strictDateRegex.test(commentsArea.innerText)) {
                            console.log('[签到助手] 评论区检测到严格符合格式的回帖（防误判降级），判定为签到成功。');
                            return completeSign('sstm', '评论区检测到今日回帖格式');
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
                            submitBtn.click();

                            // 4. 等待并校验
                            await delay(5000);
                            const commentsArea = document.querySelector('[data-role="commentFeed"], #elPostFeed, .ipsType_richText');
                            if (document.body.innerText.includes(timeString)) {
                                console.log('[签到助手] 校验成功！');
                                GM_setValue('sstm_retry_count', 0);
                                return completeSign('sstm', '回帖提交后已校验成功');
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
                    return completeSign('wcccc', '已点击签到按钮');
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
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('dc_signin') && !location.href.includes('login')) {
                    window.location.href = "plugin.php?id=dc_signin";
                    return false;
                }
                if (location.href.includes('dc_signin')) {
                    const statusLink = await waitForElement('#dcsignin > div.sd > div.bm.bw0 > div > a', 3000);
                    if (statusLink && statusLink.innerText.includes('已签到')) {
                        console.log('已签到');
                        return completeSign('fxacg', '页面显示今日已签到');
                    } else if (statusLink) {
                        statusLink.click();
                        const btnSign2 = await waitForElement('#signform > div > ul > li:nth-child(1)', 5000);
                        const btnSign = await waitForElement('#signform > p > button', 5000);
                        if (btnSign2 && btnSign) {
                            btnSign2.click();
                            await delay(200);
                            btnSign.click();
                            console.log('签到成功');
                            return completeSign('fxacg', '已提交签到表单');
                        }
                    }
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
                resultMode: "script"
            },
            async run() {
                // 使用 fetch 替代繁琐的 XMLHttpRequest
                const fetchTask = async (id) => {
                    let res = await fetch(`https://www.south-plus.net/plugin.php?H_name=tasks&action=ajax&actions=job&cid=${id}`);
                    let text = await res.text();
                    if (text.includes("还没超过")) {
                        console.log(`[南+] 任务${id} 刷新时间未到`);
                        return true;
                    } else if (text.includes("已经申请")) {
                        res = await fetch(`https://www.south-plus.net/plugin.php?H_name=tasks&action=ajax&actions=job2&cid=${id}`);
                        text = await res.text();
                        if (text.includes("已经完成")) {
                            console.log(`[南+] 成功完成任务${id}`);
                            return true;
                        } else {
                            console.log(`[南+] 任务${id}提交异常`);
                        }
                    }
                    return false;
                };

                const w14 = await fetchTask('14'); // 周常
                const w15 = await fetchTask('15'); // 日常
                return w14 && w15;
            }
        },
        {
            name: "2dfan",
            matches: ["galge.fun", "2dfan.com", "2dfan.org"],
            key: "2dfan",
            dashboard: {
                url: "https://galge.fun/users/177256/recheckin",
                openMode: "background",
                resultMode: "script"
            },
            async run() {
                // 注意：原代码中写死了 /users/177256/recheckin，这里保留你的原逻辑，若需要可修改为动态获取
                if (!location.href.includes('recheckin') && !location.href.includes('not_authenticated')) {
                    window.location.href = "users/177256/recheckin";
                    return false;
                }
                const signFlag = await waitForElement('#checkin', 3000);
                const signFlag2 = document.querySelector('.checkin-info .pull-right');

                if ((signFlag && signFlag.innerText.includes('已签到')) ||
                    (signFlag2 && signFlag2.innerText.includes('已连续签到'))) {
                    console.log('已签到!');
                    return completeSign('2dfan', '页面显示今日已签到');
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
                resultMode: "script"
            },
            async run() {
                const res = await fetch('https://www.sl-asmr.com/api/mission/fast', { method: 'POST' });
                const text = await res.text();
                if (text.includes("签到成功") || text.includes("您已签到")) {
                    console.log('签到成功或今天已经签到过了');
                    return completeSign('sl-asmr', '接口返回签到成功或已签到');
                } else {
                    console.log('签到异常，请检查是否登录', text);
                    return false;
                }
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
                    } else {
                        console.log('已签到');
                    }
                    return completeSign('galgamex', '签到按钮状态已确认');
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
                resultMode: "script"
            },
            async run() {
                const btn = await waitForElement('#inn-nav__point-sign-daily > a', 5000);
                if (btn) {
                    if (btn.innerText.includes('已签到')) {
                        console.log('已签到');
                    } else {
                        btn.click();
                        console.log('执行签到点击');
                    }
                    return completeSign('acgndog', '签到按钮状态已确认');
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
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('kf_growup.php')) {
                    window.location.href = "kf_growup.php";
                    return false;
                }
                const btn = await waitForElement('#alldiv .drow .dcol div div table tbody tr td div a', 5000);
                if (btn) {
                    if (btn.innerText.includes('已经领过了')) {
                        console.log('已签到!');
                    } else {
                        btn.click();
                        console.log('签到成功');
                    }
                    return completeSign('kfpromax', '成长奖励状态已确认');
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
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('wallet/mission')) {
                    console.log('前往签到');
                    window.location.href = "wallet/mission";
                    return false;
                }

                // 更新为精确选择器，并对 CSS 转义字符进行 JS 双重转义
                const selector = '#main-container > div > div > div.tablet\\:flex-\\[3\\].w-full.min-w-0 > div:nth-child(1) > div.arco-menu.arco-menu-light.arco-menu-vertical.mt-2 > div > div:nth-child(2) > div > div.ml-auto > button';
                const btn = await waitForElement(selector, 5000);

                if (btn) {
                    if (!btn.innerText.includes('立即签到')) {
                        console.log('已签到!');
                    } else {
                        btn.click();
                        console.log('签到成功');
                    }
                    return completeSign('vik', '任务签到状态已确认');
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
                resultMode: "script"
            },
            async run() {
                if (!location.href.includes('k_misign-sign.html')) {
                    console.log('前往签到');
                    window.location.href = "k_misign-sign.html";
                    return false;
                }

                await delay(1000); // 稍微等待页面渲染
                if ($('#fwin_login').length > 0) {
                    console.log('检测到登录弹窗，等待用户登录...');
                    return false;
                }

                const isSigned = () => {
                    const btnVisited = document.querySelector('.btnvisted');
                    const statusText = document.querySelector('.qdleft .font');
                    return btnVisited || (statusText && !statusText.innerText.includes("您今天还没有签到"));
                };

                if (isSigned()) {
                    console.log('已签到!');
                    return completeSign('sijishe', '页面显示今日已签到');
                }

                const btnSign = document.querySelector('#JD_sign');
                if (btnSign) {
                    btnSign.click();
                    console.log('已点击签到，等待页面确认...');

                    for (let i = 0; i < 10; i++) {
                        await delay(500);
                        if (isSigned()) {
                            console.log('签到成功');
                            return completeSign('sijishe', '点击后已检测到签到成功');
                        }
                    }

                    console.log('签到点击后未检测到已签到状态，暂不记录签到时间。');
                }
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
                resultMode: "script"
            },
            async run() {
                const res = await fetch('https://www.galgamex.top/api/user/checkin', { method: 'POST' });
                // 移除 res.ok 校验，因为返回 error 时 HTTP 状态码可能不是 200，但我们需要读取 body 里的错误信息
                const text = await res.text();
                if (text.includes("randomMoemoepoints")) {
                    const json = JSON.parse(text);
                    console.log('签到成功，获得' + json.randomMoemoepoints + '萌点');
                    return completeSign('galGameXNew', `签到成功，获得 ${json.randomMoemoepoints} 萌点`);
                } else if (text.includes("您今天已经签到过了")) {
                    console.log('今天已经签到过了');
                    return completeSign('galGameXNew', '接口返回今日已经签到过了');
                } else {
                    console.log('API 返回异常:', text);
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
                    markSignSuccess('ZodGame', '已提交签到表单');
                    if (form) form.submit();

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
                resultMode: "script"
            },
            async run() {
                // 等待指定的寻宝(签到)按钮出现
                const btn = await waitForElement('#photo_wrap > figure > div.user-infos > div.xbs.el-tooltip__trigger.el-tooltip__trigger', 5000);
                if (btn) {
                    // 如果按钮文本包含"寻宝"说明还没签到，进行点击
                    if (btn.innerText.includes('寻宝')) {
                        btn.click();
                        console.log('执行寻宝(签到)点击');
                    } else {
                        console.log('已寻宝(签到)');
                    }
                    return completeSign('fufugal', '寻宝按钮状态已确认');
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

    function openUrl(url, openMode = 'background') {
        if (typeof GM_openInTab === 'function') {
            GM_openInTab(url, {
                active: openMode === 'foreground',
                insert: true,
                setParent: true
            });
            return;
        }
        window.open(url, openMode === 'foreground' ? '_self' : '_blank', 'noopener');
    }

    function launchTarget(target) {
        openUrl(target.url, target.openMode);
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

    function isTargetDone(status) {
        return status === 'success' || status === 'skipped';
    }

    function getLaunchableTargets() {
        return getAllTargets().filter(target => {
            if (!target.enabled || target.openMode === 'manual') return false;
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
                text: `${OPEN_MODE_LABELS[target.openMode] || target.openMode} · ${RESULT_MODE_LABELS[target.resultMode] || target.resultMode} · 更新 ${getTimeLabel(status.updatedAt)}`
            })
        );
        if (target.note) {
            main.append(el('div', { className: 'bbs-sign-meta', text: target.note }));
        }

        const actions = el('div', { className: 'bbs-sign-row-actions' });
        const openBtn = el('button', {
            className: 'bbs-sign-button primary',
            type: 'button',
            text: target.openMode === 'foreground' ? '前台打开' : '打开',
            onClick: () => {
                launchTarget(target);
                rerender();
            }
        });
        openBtn.disabled = !target.enabled;
        actions.append(
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
        );

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
            } else if (status === 'opened' || status === 'needs-login' || status === 'needs-foreground') {
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
        const visibleTargets = targets.filter(target => targetMatchesSearch(target, dashboardSearchQuery));
        const summary = getDashboardSummary(targets);
        const launchableTargets = getLaunchableTargets();
        const groups = splitDashboardTargets(visibleTargets);
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
                        text: '一键打开未完成',
                        onClick: () => {
                            for (const target of getLaunchableTargets()) {
                                launchTarget(target);
                            }
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
            text: `今天 ${getToday()}，还有 ${launchableTargets.length} 个目标可一键打开。已禁用站点已从控制台隐藏，可在配置清单中管理。`
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
        body.append(
            el('div', { className: 'bbs-sign-section-title', text: '控制台选项' }),
            el('div', { className: 'bbs-sign-card' }, [
                el('label', { className: 'bbs-sign-check' }, [
                    autoOpenInput,
                    el('span', { text: '提醒状态下 3 秒后自动展开控制台' })
                ]),
                el('div', { className: 'bbs-sign-meta', text: '倒计时会显示在悬浮按钮上，可点击“取消”停止本次自动展开。' })
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
        overlay.remove();
        updateDashboardReminderButton();
    }

    function showDashboard(view = 'dashboard', editingId = '') {
        addDashboardStyles();
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

    function registerDashboardMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
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
            if (lastSignDate === todayStr) {
                console.log(`[签到助手] ${site.name} 今日已完成，跳过。`);
                recordTargetStatus(site.key, 'success', {
                    stage: 'skip',
                    message: '今日已完成，跳过执行',
                    url: location.href
                });
                return; // 当日已执行，退出
            }

            try {
                const beforeStatus = getRawTargetStatus(site.key);
                // 运行该站点的特定逻辑，如果执行完成返回 true，则保存今天的日期
                const isSuccess = await site.run();
                if (isSuccess) {
                    if (getData(site.key) !== todayStr) {
                        markSignSuccess(site.key);
                    }
                } else {
                    const afterStatus = getRawTargetStatus(site.key);
                    if (!afterStatus || afterStatus.updatedAt === beforeStatus?.updatedAt) {
                        const isSstm = site.key === 'sstm';
                        recordTargetStatus(site.key, isSstm ? 'needs-foreground' : 'opened', {
                            stage: 'run',
                            message: isSstm
                                ? '本次未确认成功，SS同盟可能需要前台页面继续处理'
                                : '本次未确认成功，可能正在跳转或等待页面确认',
                            url: location.href
                        });
                    }
                }
            } catch (err) {
                console.error(`[签到助手] ${site.name} 执行时发生错误:`, err);
                recordTargetStatus(site.key, 'failed', {
                    stage: 'error',
                    message: err?.message ? `执行异常：${err.message}` : '执行时发生异常',
                    url: location.href
                });
            }
            break; // 匹配到一个站点后就不再往下走了
        }
    }

})();
