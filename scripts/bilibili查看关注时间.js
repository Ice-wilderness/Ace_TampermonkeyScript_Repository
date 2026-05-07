// ==UserScript==
// @name         bilibili查看关注时间
// @namespace    http://tampermonkey.net/
// @version      1.1.2
// @description  bilibili查看关注时间。
// @author       Ice_wilderness
// @match        https://space.bilibili.com/*
// @match        https://m.bilibili.com/*
// @match        https://www.bilibili.com/*
// @match        https://t.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.bilibili.com
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/573211/bilibili%E6%9F%A5%E7%9C%8B%E5%85%B3%E6%B3%A8%E6%97%B6%E9%97%B4.user.js
// @updateURL https://update.greasyfork.org/scripts/573211/bilibili%E6%9F%A5%E7%9C%8B%E5%85%B3%E6%B3%A8%E6%97%B6%E9%97%B4.meta.js
// ==/UserScript==

(function () {
    'use strict';

    let lastUrl = ''; // 记录路由变化
    let isSyncing = false; // 全局同步锁

    function log(msg, data = '') {
        console.log(`%c[B站关注时间助手] %c${msg}`, 'color: #00a1d6; font-weight: bold;', 'color: inherit;', data);
    }

    function isVideoPlaybackPage(url = location.href) {
        return /https:\/\/www\.bilibili\.com\/(?:video|v|medialist\/play|list)\//.test(url);
    }

    // 获取当前登录用户的 UID (用于隔离本地数据库)
    function getLoginUid() {
        let match = document.cookie.match(/DedeUserID=(\d+)/);
        return match ? match[1] : null;
    }

    // ==========================================
    // UI 组件：悬浮同步进度条 & 智能位置时间标签
    // ==========================================
    function getToast() {
        let toast = document.getElementById('bili-sync-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'bili-sync-toast';
            toast.style.cssText = `
                position: fixed; bottom: 30px; right: 30px;
                background: rgba(0, 0, 0, 0.75); color: #fff;
                padding: 10px 20px; border-radius: 8px;
                font-size: 13px; z-index: 999999; display: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                pointer-events: none; backdrop-filter: blur(4px);
            `;
            document.body.appendChild(toast);
        }
        return toast;
    }

    function showToast(msg, autoHide = false) {
        let t = getToast();
        t.innerHTML = msg;
        t.style.display = 'block';
        if (autoHide) setTimeout(() => t.style.display = 'none', 4000);
    }

    // 精细化注入核心，支持多种插入策略和独立样式
    function injectTimeSpan(nameElement, timestamp, isPending = false, bindMid = 'done', options = {}) {
        let targetEl = options.target || nameElement;
        let position = options.position || 'after'; // 'after' 或 'append'
        let customStyle = options.style || '';

        // 防复用：安全寻找是否已经在当前目标中注入过
        let timeSpan = null;
        if (position === 'after' && targetEl.nextElementSibling && targetEl.nextElementSibling.classList.contains('bili-follow-time')) {
            timeSpan = targetEl.nextElementSibling;
        } else if (position === 'append') {
            timeSpan = Array.from(targetEl.children).find(el => el.classList.contains('bili-follow-time'));
        }

        // 如果没有则创建新的 DOM
        if (!timeSpan) {
            timeSpan = document.createElement('span');
            timeSpan.className = 'bili-follow-time';
            if (position === 'after' && targetEl.parentNode) {
                targetEl.parentNode.insertBefore(timeSpan, targetEl.nextSibling);
            } else if (position === 'append') {
                targetEl.appendChild(timeSpan);
            }
        }

        // 内容与默认基础样式 (保证无论塞在哪里都不会太出格)
        let text = isPending ? `⏳ 同步库中...` : `关注于: ${timestamptoDate(timestamp)}`;
        let baseStyle = isPending
            ? `color: #ff9800; font-size: 12px; background-color: #fff3e0; padding: 2px 6px; border-radius: 4px; line-height: 18px; height: fit-content; white-space: nowrap;`
            : `color: #99a2aa; font-size: 12px; background-color: #f4f5f7; padding: 2px 6px; border-radius: 4px; line-height: 18px; height: fit-content; white-space: nowrap;`;

        timeSpan.textContent = text;
        timeSpan.style.cssText = baseStyle + " " + customStyle;

        // 绑定标记，防止 SPA 单页应用的重绘和重渲染
        nameElement.dataset.timeAdded = String(bindMid);
    }

    // ==========================================
    // 数据库操作 (GM_setValue/getValue 持久化隔离)
    // ==========================================
    function getDBKey(vmid, type) {
        return `BiliFollowDB_${type}_${vmid}`;
    }

    function getDB(vmid, type) {
        let defaultDB = { lastSync: 0, total: 0, data: {} };
        return GM_getValue(getDBKey(vmid, type), defaultDB);
    }

    function saveDB(vmid, type, dbObj) {
        GM_setValue(getDBKey(vmid, type), dbObj);
    }

    // ==========================================
    // 核心引擎：全量同步爬虫
    // ==========================================
    async function startFullSync(vmid, type) {
        if (isVideoPlaybackPage()) {
            log('当前为视频播放相关页面，跳过关注列表全量同步。');
            return;
        }
        if (isSyncing) return;
        isSyncing = true;
        log(`触发全量同步: 账号(${vmid}) 类型(${type})`);

        let apiType = type === 'followings' ? 'followings' : 'followers';
        let pn = 1;
        let ps = 50; // 每页最大50
        let total = 1;
        let newData = {};

        showToast(`⏳ 准备同步全部列表...`);

        try {
            while ((pn - 1) * ps < total) {
                let url = `https://api.bilibili.com/x/relation/${apiType}?vmid=${vmid}&pn=${pn}&ps=${ps}&order=desc`;
                let res = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        withCredentials: true, // 强制带凭据
                        onload: (r) => {
                            try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
                        },
                        onerror: reject
                    });
                });

                if (res.code !== 0) {
                    throw new Error(`B站接口返回异常: ${res.message}`);
                }

                total = res.data.total;
                let list = res.data.list || [];

                // 写入临时缓存
                list.forEach(item => {
                    newData[item.mid] = item.mtime;
                });

                showToast(`⏳ 正在同步后台数据库 (${Object.keys(newData).length} / ${total})<br><span style="font-size:11px;color:#ccc;">为防风控，每页休眠1.5秒...</span>`);

                // 【边同步边渲染】每抓一页，立刻写库并触发UI刷新
                let currentDb = getDB(vmid, type);
                currentDb.data = { ...currentDb.data, ...newData }; // 合并数据
                saveDB(vmid, type, currentDb);
                triggerUIRefresh(vmid, type);

                pn++;
                // 如果还有下一页，强制休眠1.5秒，避免触发风控
                if ((pn - 1) * ps < total) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            // 全部同步完成，更新最终全量库和最后更新时间
            let finalDb = getDB(vmid, type);
            finalDb.data = newData; // 使用全量新数据覆盖（可自动剔除已取关的人）
            finalDb.total = total;
            finalDb.lastSync = Date.now();
            saveDB(vmid, type, finalDb);

            log(`全量同步完成！共记录 ${total} 条数据`);
            showToast(`✅ 数据库同步完成 (共${total}条)`, true);
            triggerUIRefresh(vmid, type);

        } catch (err) {
            console.error('[B站关注时间助手] 同步中止:', err);
            showToast(`❌ 数据同步失败，请刷新重试`, true);
        } finally {
            isSyncing = false;
        }
    }

    // 后台静默检测机制：在任意页面均可触发当前账号的数据同步
    function checkBackgroundSync() {
        if (isVideoPlaybackPage()) return; // 视频播放页只做标签注入，不触发后台全量同步

        let loginUid = getLoginUid();
        if (!loginUid) return; // 未登录时不执行

        let db = getDB(loginUid, 'followings');
        let hoursSinceSync = (Date.now() - db.lastSync) / (1000 * 60 * 60);

        // 如果从未同步过，或者距上次同步超过 24 小时，则触发静默同步
        if (hoursSinceSync > 24 && !isSyncing) {
            log('后台检测到全量数据库未建立或已过期，自动触发静默同步...');
            startFullSync(loginUid, 'followings');
        }
    }

    // ==========================================
    // 渲染主逻辑
    // ==========================================
    function triggerUIRefresh(vmid, type) {
        let nameElements = document.querySelectorAll('.list-item .title, .list-item .fans-name, .list-item .fan-name, .list-item .up-name, .relation-card-info__uname');
        let db = getDB(vmid, type);
        let missingCount = 0;

        nameElements.forEach(el => {
            let mid = extractMid(el);
            if (!mid) return;

            // DOM 复用深度清理：如果列表翻页导致元素复用给新人，必须清空旧人的锁和标签
            if (el.dataset.timeAdded && el.dataset.timeAdded !== String(mid)) {
                let card = el.closest('.list-item, .relation-card');
                if (card) card.querySelectorAll('.bili-follow-time').forEach(node => node.remove());
                el.removeAttribute('data-time-added');
            }

            if (el.dataset.timeAdded === String(mid)) return;

            // 定位个人中心关注列表的特定位置（推至操作按钮区域的最右侧）
            let card = el.closest('.list-item, .relation-card');
            let targetOption = card ? card.querySelector('.relation-card-info-option, .fans-action') : null;

            let options = {
                target: targetOption || el,
                position: targetOption ? 'append' : 'after',
                // 关注列表页面的选项依然推到最右侧
                style: targetOption ? 'margin-left: auto; align-self: center;' : 'margin-left: 10px; align-self: center;'
            };

            let mtime = db.data[mid];
            if (mtime) {
                injectTimeSpan(el, mtime, false, mid, options);
            } else {
                injectTimeSpan(el, null, true, mid, options);
                missingCount++;
            }
        });

        // 触发自动同步机制的条件：
        // 1. 如果有当前屏幕上有查不到的人
        // 2. 或者距离上次全量同步超过 12 个小时 (12 * 60 * 60 * 1000)
        let hoursSinceSync = (Date.now() - db.lastSync) / (1000 * 60 * 60);
        if ((missingCount > 0 || hoursSinceSync > 12) && !isSyncing && !isVideoPlaybackPage()) {
            startFullSync(vmid, type);
        }
    }

    function extractMid(element) {
        let href = element.getAttribute('href');
        if (href) {
            let match = href.match(/space\.bilibili\.com\/(\d+)/);
            if (match) return parseInt(match[1], 10);
        }
        return null;
    }

    function handleListPage(url) {
        const match = url.match(/space\.bilibili\.com\/(\d+)/);
        if (!match) return;
        const vmid = match[1];

        let isFollowings = url.includes('/fans/follow') || url.includes('/relation/follow');
        let isFollowers = url.includes('/fans/fans') || url.includes('/relation/fans');
        if (!isFollowings && !isFollowers) return;

        let type = isFollowings ? 'followings' : 'followers';
        triggerUIRefresh(vmid, type);
    }

    function handleProfilePage(url) {
        const match = url.match(/(?:space\.bilibili\.com\/|m\.bilibili\.com\/space\/)(\d+)/);
        if (!match) return;
        const targetUserId = match[1];

        let nameElement = document.querySelector('#h-name, .h-name, .base-info .name, .user-name, .m-space-info .name, .upinfo-detail__top .nickname, .header-upinfo .nickname');

        // 等待页面渲染出名字且没有处理过再执行
        if (!nameElement || !nameElement.textContent.trim() || nameElement.dataset.timeAdded === String(targetUserId)) return;

        nameElement.dataset.timeAdded = String(targetUserId);

        // 定位UP主主页头部区域的特定位置（跟在等级、牌子等原生标签的最后面）
        let container = nameElement.closest('.upinfo-detail__top, .h-basic');
        let options = {
            target: container || nameElement,
            position: container ? 'append' : 'after',
            style: 'margin-left: 10px; align-self: center;'
        };

        // 1. 优先查本地库
        let loginUid = getLoginUid();
        if (loginUid) {
            let db = getDB(loginUid, 'followings');
            if (db && db.data && db.data[targetUserId]) {
                injectTimeSpan(nameElement, db.data[targetUserId], false, targetUserId, options);
                return;
            }
        }

        // 2. API兜底
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.bilibili.com/x/space/acc/relation?mid=${targetUserId}`,
            withCredentials: true,
            onload: (r) => {
                try {
                    let response = JSON.parse(r.responseText);
                    if (response.code === 0 && response.data && response.data.relation && response.data.relation.mtime > 0) {
                        injectTimeSpan(nameElement, response.data.relation.mtime, false, targetUserId, options);
                    }
                } catch (e) {}
            }
        });
    }

    // 独立处理全站（视频、动态等）的悬浮名片窗口
    function handleHoverCards() {
        let cards = document.querySelectorAll('.user-card-m-exp');
        cards.forEach(card => {
            let nameElement = card.querySelector('.info .user .name');
            if (!nameElement) return;

            let mid = extractMid(nameElement);
            if (!mid) return;

            // DOM 节点复用深度清理：如果当前卡片的 UID 变了（由于B站复用同一个悬浮窗），彻底清理并释放锁
            if (nameElement.dataset.timeAdded && nameElement.dataset.timeAdded !== String(mid)) {
                card.querySelectorAll('.bili-follow-time').forEach(el => el.remove());
                nameElement.removeAttribute('data-time-added');
            }

            // 如果当前人已经成功处理过，跳过
            if (nameElement.dataset.timeAdded === String(mid)) return;

            // 核心修复点 1：必须等待 B站悬浮窗基础数据加载完成
            if (!card.classList.contains('card-loaded')) return;

            // 核心修复点 2：判断关注状态。
            // 因为 Vue 渲染“关注”按钮的状态比赋予 card-loaded 可能还会再慢几毫秒！
            let followBtn = card.querySelector('.btn-box .like, .btn-box .follow');
            let isFollowed = followBtn && (followBtn.classList.contains('liked') || followBtn.textContent.includes('已关注') || followBtn.textContent.includes('互粉'));

            // 如果还没渲染出"已关注"，绝不上死锁！直接返回，允许下一次 MutationObserver 或心跳再次检测。
            if (!isFollowed) return;

            // 此时，不仅数据加载完了，且按钮也明确是“已关注”了。安全上锁！
            nameElement.dataset.timeAdded = String(mid);

            // 精准定位悬浮窗（寻找粉丝/获赞的数据行，放置在其正下方，单独成行）
            let socialTarget = card.querySelector('.info .social');
            let options = {
                target: socialTarget || nameElement,
                position: 'after',
                style: socialTarget ? 'display: block; width: fit-content; margin-top: 8px; margin-bottom: 2px;' : 'margin-left: 10px; align-self: center;'
            };

            // 1. 本地库极速响应
            let loginUid = getLoginUid();
            if (loginUid) {
                let db = getDB(loginUid, 'followings');
                if (db && db.data && db.data[mid]) {
                    injectTimeSpan(nameElement, db.data[mid], false, mid, options);
                    return;
                }
            }

            // 2. 异步兜底
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.bilibili.com/x/space/acc/relation?mid=${mid}`,
                withCredentials: true,
                onload: (r) => {
                    try {
                        // 核心修复点 3：网络请求回来后，如果鼠标已经移开（DOM复用给了别人），果断中止注入！防串乱！
                        if (extractMid(nameElement) !== mid) return;

                        let response = JSON.parse(r.responseText);
                        if (response.code === 0 && response.data && response.data.relation && response.data.relation.mtime > 0) {
                            injectTimeSpan(nameElement, response.data.relation.mtime, false, mid, options);
                        }
                    } catch (e) {}
                }
            });
        });
    }

    function timestamptoDate(timestamp) {
        if (!timestamp || timestamp <= 0) return "未知";
        var date = new Date(timestamp * 1000);
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        var hours = String(date.getHours()).padStart(2, '0');
        var minutes = String(date.getMinutes()).padStart(2, '0');
        var seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    // 执行页面的所有视图检测
    function runAllChecks() {
        let currentUrl = window.location.href;

        // 路由变化时，重置全部 SPA 幽灵缓存
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            document.querySelectorAll('[data-time-added]').forEach(el => el.removeAttribute('data-time-added'));
            document.querySelectorAll('.bili-follow-time').forEach(el => el.remove());
        }

        if (currentUrl.includes('/fans/') || currentUrl.includes('/relation/')) {
            handleListPage(currentUrl);
        } else if (currentUrl.includes('space.bilibili.com') || currentUrl.includes('m.bilibili.com/space')) {
            handleProfilePage(currentUrl);
        }

        // 全站任意页面的悬浮名片检测
        handleHoverCards();
    }

    function init() {
        log('脚本开始运行，采用 MutationObserver 瞬间注入与竞态兜底双重保险...');

        // 全局初始化时检查一次是否需要后台静默建库
        checkBackgroundSync();

        // 核心一：MutationObserver 监听 DOM 变动，实现毫秒级响应
        let observerTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (observerTimer) clearTimeout(observerTimer);
            observerTimer = setTimeout(() => {
                runAllChecks();
            }, 50); // 50毫秒防抖
        });

        // 监听整个 body 及其子树
        observer.observe(document.body, { childList: true, subtree: true });

        // 【第二重保险：心跳兜底】
        // 保留一个 1000ms 的 setInterval 心跳。即使 observer 因为B站异步接口延迟导致判定错配，
        // 一秒钟后的心跳也能立刻把遗漏的标签补上去！
        setInterval(() => {
            runAllChecks();
        }, 1000);

        // 每隔 1 小时检测一次是否需要重新同步全量数据库（应对长期不关闭页面的情况）
        setInterval(() => {
            checkBackgroundSync();
        }, 60 * 60 * 1000);
    }

    init();

})();
