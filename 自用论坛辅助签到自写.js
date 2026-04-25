// ==UserScript==
// @name         【自写】自用论坛辅助签到自写
// @namespace    bbshelperforme
// @version      2.2.0
// @description  论坛辅助签到工具 - 优化了性能与结构，采用异步等待与策略模式，新增SSTM支持
// @author       Ice_wilderness
// @match        http*://bbs.wcccc.cc/*
// @match        http*://www.south-plus.net/*
// @match        http*://galge.fun/*
// @match        http*://2dfan.com/*
// @match        http*://2dfan.org/*
// @match        http*://www.sl-asmr.com/*
// @match        http*://bbs.kfpromax.com/*
// @match        http*://sjs47.com/*
// @match        http*://www.vikacg.com/*
// @match        http*://feixueacg.com/*
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

    // 获取格式化后的今天日期 (yyyy-MM-dd)
    function getToday() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    // 获取数据
    function getData(key) {
        const data = GM_getValue('BBSSignHelperData') || {};
        return data[key];
    }

    // 设置数据并标记今日已签到
    function markSignSuccess(key) {
        const data = GM_getValue('BBSSignHelperData') || {};
        data[key] = getToday();
        GM_setValue('BBSSignHelperData', data);
        console.log(`[签到助手] ${key} 签到状态已更新为：${data[key]}`);
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
            async run() {
                // 1. 登录检查
                const isLogin = !document.querySelector('a[data-role="login"]') && !document.body.innerText.includes("现有用户? 登入");
                if (!isLogin) {
                    console.log('[签到助手] SS同盟：检测到未登录，等待用户手动登录...');
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
                            window.location.href = a.href;
                            return false;
                        }
                    }

                    console.log('[签到助手] 未找到包含 ' + dateStr + ' 的今日贴。尝试刷新页面或手动检查。');
                    return false;
                }

                // 3. 如果在帖子详情页，执行回帖
                if (location.href.includes('/topic/')) {
                    // 校验是否为今日贴，防止跑错帖子
                    const pageTitle = document.querySelector('h1.ipsType_pageTitle')?.innerText || "";
                    if (!pageTitle.includes(dateStr) && !pageTitle.includes(`${year}/${month}/${date}`)) {
                        console.log('[签到助手] 当前帖子日期不匹配，跳转到签到区寻找新帖...');
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
                        return true;
                    } else if (!currentUserLink) {
                        // 兼容极端情况：如果未能获取到当前用户信息，降级为检查严格的日期时间格式
                        const commentsArea = document.querySelector('[data-role="commentFeed"]');
                        const strictDateRegex = new RegExp(`${year}年${month}月${date}日\\s+\\d{2}:\\d{2}:\\d{2}`);
                        if (commentsArea && strictDateRegex.test(commentsArea.innerText)) {
                            console.log('[签到助手] 评论区检测到严格符合格式的回帖（防误判降级），判定为签到成功。');
                            return true;
                        }
                    }

                    const retryCount = GM_getValue('sstm_retry_count', 0);
                    if (retryCount >= 3) {
                        alert("【签到助手】SS同盟签到连续3次失败，请检查回帖权限或是否被禁言！");
                        GM_setValue('sstm_retry_count', 0);
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
                                return true;
                            }
                        }
                    }

                    console.log('[签到助手] 编辑器或按钮未就绪，准备刷新重试...');
                    GM_setValue('sstm_retry_count', retryCount + 1);
                    location.reload();
                    return false;
                }

                // 4. 如果在主域首页或其他页面，引导至签到区
                if (location.hostname === 'sstm.moe' && !location.href.includes('/forum/72-') && !location.href.includes('/topic/')) {
                    console.log('[签到助手] 自动前往签到区...');
                    window.location.href = "https://sstm.moe/forum/72-%E5%90%8C%E7%9B%9F%E7%AD%BE%E5%88%B0%E5%8C%BA/";
                }

                return false;
            }
        },
        {
            name: "月曦论坛",
            matches: ["bbs.wcccc.cc"],
            key: "wcccc",
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
                    return true;
                } else if (btnSign) {
                    btnSign.click();
                    console.log('签到成功!');
                    return true;
                }
                return false;
            }
        },
        {
            name: "飞雪论坛",
            matches: ["feixueacg.com"],
            key: "fxacg",
            async run() {
                if (!location.href.includes('dc_signin') && !location.href.includes('login')) {
                    window.location.href = "plugin.php?id=dc_signin";
                    return false;
                }
                if (location.href.includes('dc_signin')) {
                    const statusLink = await waitForElement('#dcsignin > div.sd > div.bm.bw0 > div > a', 3000);
                    if (statusLink && statusLink.innerText.includes('已签到')) {
                        console.log('已签到');
                        return true;
                    } else if (statusLink) {
                        statusLink.click();
                        const btnSign2 = await waitForElement('#signform > div > ul > li:nth-child(1)', 5000);
                        const btnSign = await waitForElement('#signform > p > button', 5000);
                        if (btnSign2 && btnSign) {
                            btnSign2.click();
                            await delay(200);
                            btnSign.click();
                            console.log('签到成功');
                            return true;
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
                    return true;
                }
                return false;
            }
        },
        {
            name: "夜世界",
            matches: ["www.sl-asmr.com"],
            key: "sl-asmr",
            async run() {
                const res = await fetch('https://www.sl-asmr.com/api/mission/fast', { method: 'POST' });
                const text = await res.text();
                if (text.includes("签到成功") || text.includes("您已签到")) {
                    console.log('签到成功或今天已经签到过了');
                    return true;
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
                    return true;
                }
                return false;
            }
        },
        {
            name: "次元狗",
            matches: ["www.acgndog.com"],
            key: "acgndog",
            async run() {
                const btn = await waitForElement('#inn-nav__point-sign-daily > a', 5000);
                if (btn) {
                    if (btn.innerText.includes('已签到')) {
                        console.log('已签到');
                    } else {
                        btn.click();
                        console.log('执行签到点击');
                    }
                    return true;
                }
                return false;
            }
        },
        {
            name: "绯月",
            matches: ["bbs.kfpromax.com"],
            key: "kfpromax",
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
                    return true;
                }
                return false;
            }
        },
        {
            name: "维咔",
            matches: ["www.vikacg.com"],
            key: "vik",
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
                    return true;
                }
                return false;
            }
        },
        {
            name: "司机社",
            matches: ["sjs47.com"],
            key: "sijishe",
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

                const btnVisited = document.querySelector('.btnvisted');
                const btnSign = document.querySelector('#JD_sign');
                const statusText = document.querySelector('.qdleft .font');

                if (btnVisited || (statusText && !statusText.innerText.includes("您今天还没有签到"))) {
                    console.log('已签到!');
                    return true;
                } else if (btnSign) {
                    btnSign.click();
                    console.log('签到成功');
                    return true;
                }
                return false;
            }
        },
        {
            name: "GalgameX 新站",
            matches: ["www.galgamex.top"],
            key: "galGameXNew",
            async run() {
                const res = await fetch('https://www.galgamex.top/api/user/checkin', { method: 'POST' });
                // 移除 res.ok 校验，因为返回 error 时 HTTP 状态码可能不是 200，但我们需要读取 body 里的错误信息
                const text = await res.text();
                if (text.includes("randomMoemoepoints")) {
                    const json = JSON.parse(text);
                    console.log('签到成功，获得' + json.randomMoemoepoints + '萌点');
                    return true;
                } else if (text.includes("您今天已经签到过了")) {
                    console.log('今天已经签到过了');
                    return true;
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
                    return true;
                }

                if (document.body.innerText.includes("今天签到了吗") && document.body.innerText.includes("写下今天最想说的话")) {
                    const emoji = document.querySelector('#fd_s');
                    if (emoji) emoji.checked = true;

                    const say = document.querySelector('#todaysay');
                    if (say) say.value = "每天签到水一发。。。";

                    const form = document.querySelector('#qiandao');
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
                    return true;
                }
                return false;
            }
        }
    ];

    // ================== 主引擎核心 ==================

    const todayStr = getToday();
    const currentHost = window.location.hostname;

    for (const site of siteConfigs) {
        // 匹配域名
        const isMatch = site.matches.some(domain => currentHost.includes(domain));
        if (isMatch) {
            console.log(`[签到助手] 进入 ${site.name} 模块`);

            const lastSignDate = getData(site.key);
            if (lastSignDate === todayStr) {
                console.log(`[签到助手] ${site.name} 今日已完成，跳过。`);
                return; // 当日已执行，退出
            }

            try {
                // 运行该站点的特定逻辑，如果执行完成返回 true，则保存今天的日期
                const isSuccess = await site.run();
                if (isSuccess) {
                    markSignSuccess(site.key);
                }
            } catch (err) {
                console.error(`[签到助手] ${site.name} 执行时发生错误:`, err);
            }
            break; // 匹配到一个站点后就不再往下走了
        }
    }

})();
