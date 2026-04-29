// ==UserScript==
// @name              Discuz 论坛帖子已读标记与图片预览
// @name:en           Discuz Visited Thread Marker with Image Preview
// @namespace         http://tampermonkey.net/
// @version           4.6.1
// @description       自动记录并标记 Discuz! 论坛中已访问过的帖子，支持列表页静默并发图片预览、可选后续分页抓取、已读样式配置和可拖动设置入口。
// @description:en    Marks visited threads in Discuz! forum lists, with silent concurrent image previews, optional extra-page fetching, configurable visited styles, and a draggable settings entry.
// @author            Ice_wilderness
// @match             *://*/*forum.php?mod=forumdisplay*
// @match             *://*/*forum.php?mod=viewthread*
// @match             *://*/*forum-*-*.html
// @match             *://*/*thread-*-*.html
// @grant             GM_setValue
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

    // 注入自定义 CSS
    GM_addStyle(`
        :root {
            --dh-modal-bg: #fff;
            --dh-modal-title: #333;
            --dh-modal-label: #555;
            --dh-section-bg: #fafafa;
            --dh-section-border: #e5e7eb;
            --dh-section-title: #333;
            --dh-section-text: #777;
            --dh-field-color: #555;
            --dh-input-bg: #fff;
            --dh-input-border: #d1d5db;
            --dh-input-color: #333;
            --dh-float-btn-bg: #ffffff;
            --dh-float-btn-color: #333;
            --dh-float-btn-border: rgba(0, 0, 0, 0.12);
            --dh-float-btn-hover-bg: #f3f7ff;
            --dh-float-btn-hover-border: #9fc5ff;
            --dh-preview-btn-bg: #f9f9f9;
            --dh-preview-btn-color: #333;
            --dh-preview-btn-border: #dcdcdc;
            --dh-preview-btn-hover-bg: #e0e0e0;
            --dh-preview-container-bg: #f0f2f5;
            --dh-preview-container-border: #e4e7ed;
            --dh-preview-status-color: #666;
            --dh-preview-more-bg: #fff;
            --dh-preview-more-color: #333;
            --dh-preview-more-border: #cfd6df;
            --dh-preview-more-hover-bg: #eef5ff;
            --dh-preview-more-hover-border: #9fc5ff;
            --dh-preview-more-hover-color: #333;
            --dh-preview-full-bg: #fff;
            --dh-preview-full-color: #333;
            --dh-preview-full-border: #cfd6df;
            --dh-preview-full-hover-bg: #fff7e6;
            --dh-preview-full-hover-border: #f0b35d;
            --dh-preview-full-hover-color: #333;
            --dh-progress-bg: #e0e0e0;
            --dh-img-item-bg: #f8f9fa;
            --dh-img-item-border: #ccc;
            --dh-img-loading-bg: #f8f9fa;
            --dh-img-loading-border: #dcdcdc;
            --dh-img-loading-color: #aaa;
            --dh-visited-default-bg: #a9a9a9;
            --dh-visited-label-color: #363636;
            --dh-viewed-images-bg: #d2d2d2;
            --dh-viewed-images-label-color: #ff8c00;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --dh-modal-bg: #2a2a2a;
                --dh-modal-title: #fff;
                --dh-modal-label: #ccc;
                --dh-section-bg: #222;
                --dh-section-border: #3a3a3a;
                --dh-section-title: #eee;
                --dh-field-color: #ccc;
                --dh-input-bg: #1f1f1f;
                --dh-input-border: #555;
                --dh-input-color: #eee;
                --dh-float-btn-bg: #2d2d2d;
                --dh-float-btn-color: #eee;
                --dh-float-btn-border: #555;
                --dh-float-btn-hover-bg: #3a3a3a;
                --dh-preview-btn-bg: #333;
                --dh-preview-btn-color: #ccc;
                --dh-preview-btn-border: #555;
                --dh-preview-btn-hover-bg: #444;
                --dh-preview-container-bg: #1e1e1e;
                --dh-preview-container-border: #333;
                --dh-preview-more-bg: #2d2d2d;
                --dh-preview-more-color: #ccc;
                --dh-preview-more-border: #555;
                --dh-preview-more-hover-bg: #3a3a3a;
                --dh-preview-more-hover-border: #555;
                --dh-preview-more-hover-color: #fff;
                --dh-preview-full-bg: #2d2d2d;
                --dh-preview-full-color: #ccc;
                --dh-preview-full-border: #555;
                --dh-preview-full-hover-bg: #3a3a3a;
                --dh-preview-full-hover-border: #555;
                --dh-preview-full-hover-color: #fff;
                --dh-progress-bg: #444;
                --dh-img-item-bg: #222;
                --dh-img-item-border: #444;
                --dh-img-loading-bg: #222;
                --dh-img-loading-border: #444;
                --dh-visited-default-bg: #2a2a2a;
                --dh-viewed-images-bg: #364136;
            }
        }

        /* 设置与管理面板样式 */
        .custom-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        }
        .custom-modal-content {
            background-color: var(--dh-modal-bg);
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
            max-width: 760px;
            width: 92%;
            max-height: 86vh;
            overflow-y: auto;
            font-family: Arial, sans-serif;
            text-align: left;
        }
        .custom-modal-content h3 {
            margin-top: 0;
            color: var(--dh-modal-title);
        }
        .custom-modal-content label {
            display: block;
            margin: 12px 0;
            font-size: 14px;
            cursor: pointer;
            color: var(--dh-modal-label);
            text-align: left;
        }
        .custom-modal-content input[type="checkbox"] { margin-right: 10px; }
        .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
            margin: 16px 0;
        }
        .settings-section {
            border: 1px solid var(--dh-section-border);
            border-radius: 8px;
            padding: 12px;
            background: var(--dh-section-bg);
        }
        .settings-section h4 {
            margin: 0 0 10px;
            font-size: 15px;
            color: var(--dh-section-title);
        }
        .settings-section p {
            margin: 8px 0;
            color: var(--dh-section-text);
            font-size: 12px;
            line-height: 1.6;
        }
        .settings-field {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin: 10px 0;
            color: var(--dh-field-color);
            font-size: 13px;
        }
        .settings-field input[type="number"],
        .settings-field select {
            width: 120px;
            max-width: 48%;
            padding: 5px 8px;
            border: 1px solid var(--dh-input-border);
            border-radius: 4px;
            background: var(--dh-input-bg);
            color: var(--dh-input-color);
        }
        .settings-actions {
            text-align: center;
            margin-top: 12px;
        }
        .custom-modal-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
            font-size: 14px;
            background-color: #007bff;
            color: #fff;
            transition: background-color 0.3s;
        }
        .custom-modal-btn:hover { background-color: #0056b3; }
        .custom-modal-btn.danger { background-color: #dc3545; }
        .custom-modal-btn.danger:hover { background-color: #c82333; }
        .custom-modal-btn.secondary { background-color: #6c757d; }
        .custom-modal-btn.secondary:hover { background-color: #5a6268; }
        .custom-modal-file-input { display: none; }
        .discuz-helper-floating-btn {
            position: fixed;
            right: 18px;
            bottom: 86px;
            width: 42px;
            height: 42px;
            border: 1px solid var(--dh-float-btn-border);
            border-radius: 50%;
            z-index: 99998;
            cursor: grab;
            background: var(--dh-float-btn-bg);
            color: var(--dh-float-btn-color);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            line-height: 1;
            user-select: none;
        }
        .discuz-helper-floating-btn:hover {
            background: var(--dh-float-btn-hover-bg);
            border-color: var(--dh-float-btn-hover-border);
        }
        .discuz-helper-floating-btn:active { cursor: grabbing; }

        .temporary-message {
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #4CAF50;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10001;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
            pointer-events: none;
        }
        .temporary-message.show { opacity: 1; }

        /* 预览按钮与容器 */
        .preview-button {
            margin-left: 8px;
            padding: 2px 8px;
            border: 1px solid var(--dh-preview-btn-border);
            border-radius: 4px;
            cursor: pointer;
            background-color: var(--dh-preview-btn-bg);
            font-size: 12px;
            color: var(--dh-preview-btn-color);
            transition: all 0.2s;
        }
        .preview-button:hover:not(:disabled) {
            background-color: var(--dh-preview-btn-hover-bg);
        }
        .preview-container {
            margin-top: 10px;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid var(--dh-preview-container-border);
            background-color: var(--dh-preview-container-bg);
            line-height: 1.5;
            max-height: 50vh;
            overflow-y: auto;
            overflow-x: hidden;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 8px;
            align-items: start;
        }

        .preview-status-text {
            color: var(--dh-preview-status-color);
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 8px;
            grid-column: 1 / -1;
        }
        .preview-more-button {
            grid-column: 1 / -1;
            justify-self: start;
            padding: 4px 10px;
            border: 1px solid var(--dh-preview-more-border);
            border-radius: 4px;
            cursor: pointer;
            background-color: var(--dh-preview-more-bg);
            color: var(--dh-preview-more-color);
            font-size: 12px;
        }
        .preview-more-button:hover:not(:disabled) {
            background-color: var(--dh-preview-more-hover-bg);
            border-color: var(--dh-preview-more-hover-border);
            color: var(--dh-preview-more-hover-color);
        }
        .preview-more-button:disabled { cursor: wait; opacity: 0.7; }
        .preview-full-button {
            width: 100%;
            min-height: 0;
            height: 140px;
            padding: 10px;
            border: 1px dashed var(--dh-preview-full-border);
            border-radius: 4px;
            cursor: pointer;
            background-color: var(--dh-preview-full-bg);
            color: var(--dh-preview-full-color);
            font-size: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            line-height: 1.4;
            text-align: center;
            box-sizing: border-box;
        }
        .preview-full-button::before {
            content: "+";
            font-size: 28px;
            line-height: 1;
            font-weight: bold;
        }
        .preview-full-button:hover:not(:disabled) {
            background-color: var(--dh-preview-full-hover-bg);
            border-color: var(--dh-preview-full-hover-border);
            color: var(--dh-preview-full-hover-color);
        }
        .preview-full-button:disabled { cursor: wait; opacity: 0.7; }

        /* 进度条 */
        .progress-container {
            height: 4px;
            background: var(--dh-progress-bg);
            border-radius: 2px;
            overflow: hidden;
            margin-bottom: 8px;
            grid-column: 1 / -1;
        }
        .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            transition: width 0.3s ease;
            width: 0%;
        }

        /* 图片项 */
        .preview-img-item,
        .preview-img-loading {
            width: 100%;
            border-radius: 4px;
            overflow: hidden;
            text-align: center;
        }
        .preview-img-item {
            max-height: 250px;
            border: 1px solid var(--dh-img-item-border);
            background-color: var(--dh-img-item-bg);
            cursor: zoom-in;
            object-fit: cover;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .preview-img-item:hover {
            transform: scale(1.03);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            z-index: 10;
            position: relative;
        }

        .preview-img-loading {
            min-height: 100px;
            background-color: var(--dh-img-loading-bg);
            border: 1px dashed var(--dh-img-loading-border);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--dh-img-loading-color);
            font-size: 12px;
        }

        /* 帖子状态标记 - 用 CSS class 替代 style 标签注入 */
        body.thread-visited-mode-default .thread--visited {
            background-color: var(--dh-visited-default-bg) !important;
        }
        body.thread-visited-mode-default .thread--visited a.xst::before {
            content: "[已访问] ";
            font-weight: bold;
            color: var(--dh-visited-label-color);
        }
        body.thread-visited-mode-opacity .thread--visited { opacity: 0.45; }
        body.thread-visited-mode-strike .thread--visited a.xst { text-decoration: line-through !important; }
        body.thread-visited-mode-opacity-strike .thread--visited { opacity: 0.45; }
        body.thread-visited-mode-opacity-strike .thread--visited a.xst { text-decoration: line-through !important; }
        body.thread-visited-mode-color .thread--visited a.xst { color: #8a8a00 !important; }
        body.thread-visited-mode-hidden .thread--visited { display: none !important; }

        .thread--viewed-images { background-color: var(--dh-viewed-images-bg) !important; }
        .thread--viewed-images a.xst::before {
            content: "[已看图] ";
            font-weight: bold;
            color: var(--dh-viewed-images-label-color);
        }

        /* 全局灯箱 */
        #global-lightbox {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 99999;
            user-select: none;
        }
        #global-lightbox img {
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
            border-radius: 4px;
        }
        .lightbox-nav-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            color: white;
            font-size: 40px;
            cursor: pointer;
            padding: 20px;
            background: rgba(0, 0, 0, 0.1);
            transition: background 0.2s;
            border-radius: 4px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        .lightbox-nav-btn:hover { background: rgba(0, 0, 0, 0.6); }
        #lightbox-prev { left: 20px; }
        #lightbox-next { right: 20px; }
        #lightbox-indicator {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-size: 16px;
            background: rgba(0, 0, 0, 0.6);
            padding: 5px 15px;
            border-radius: 15px;
            letter-spacing: 1px;
        }
    `);

    const BASE_STORAGE_KEY = 'discuz_visited_threads';
    const DEFAULT_MIN_DIMENSION = 200; // 图片最小尺寸阈值
    const DEFAULT_AUTO_PREVIEW_LIMIT = 5; // 自动预览最多展示第一页 5 张合格图片
    const MAX_HISTORY_RECORDS = 2000; // 最大保存帖子记录数
    const PREVIEW_PAGE_BATCH_SIZE = 3; // 每次最多抓取 3 页
    const PREVIEW_CACHE_TTL = 24 * 60 * 60 * 1000; // 预览缓存保留 24 小时
    const PREVIEW_CACHE_VERSION = 6;
    const DEFAULT_AUTO_PREVIEW_CONCURRENT = 1;
    const AUTO_PREVIEW_DELAY_MS = 300;
    const VISITED_STYLE_MODES = ['default', 'opacity', 'strike', 'opacity-strike', 'color', 'hidden'];
    const RE_THREAD_PAGE_SHORT = /thread-(\d+)-(\d+)(-\d+)?\.html$/i;
    const RE_THREAD_PAGE_ARCHIVE = /thread-(\d+)-(\d+)-(\d+)\.html$/i;

    // 灯箱自定义光标 (SVG Data URI)
    const CURSOR_SVG_LEFT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024' width='32' height='32'%3E%3Cpath d='M729.29 959.73c-10.02 0-20.04-3.82-27.69-11.47L292.83 539.47a39.18 39.18 0 0 1-11.47-27.69c0-10.38 4.13-20.34 11.47-27.69L701.61 75.34c15.3-15.3 40.08-15.3 55.37 0s15.3 40.08 0 55.37L375.89 511.79l381.09 381.1c15.3 15.3 15.3 40.08 0 55.37a39.073 39.073 0 0 1-27.69 11.47z' fill='white' stroke='black' stroke-width='40' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, pointer`;
    const CURSOR_SVG_RIGHT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024' width='32' height='32'%3E%3Cpath d='M295.28 959.73c-10.01 0-20.03-3.82-27.67-11.47-15.29-15.29-15.29-40.06 0-55.35l380.94-380.92-380.94-380.95c-15.29-15.29-15.29-40.06 0-55.35s40.06-15.29 55.35 0l408.62 408.62a39.15 39.15 0 0 1 11.47 27.67c0 10.37-4.13 20.34-11.47 27.67l-408.62 408.6a39.02 39.02 0 0 1-27.68 11.48z' fill='white' stroke='black' stroke-width='40' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, pointer`;

    // --- 工具函数 ---

    function getForumName() {
        const titleParts = document.title.split(' - ');
        let potentialForumName = titleParts.length > 1 && titleParts[titleParts.length - 1].trim() === 'Powered by Discuz!'
            ? titleParts[titleParts.length - 2].trim()
            : titleParts[titleParts.length - 1].trim();
        const parts = potentialForumName.split('_');
        return encodeURIComponent((parts.length > 1 ? parts[parts.length - 1] : potentialForumName).trim() || 'default_forum');
    }

    const forumName = getForumName();
    const hostName = window.location.hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const STORAGE_KEY = `${BASE_STORAGE_KEY}_${forumName}_${hostName}`;
    const OLD_STORAGE_KEY = `${BASE_STORAGE_KEY}_${forumName}`;

    // 数据迁移逻辑 (针对旧版升级)
    function migrateStorageKey() {
        const oldData = GM_getValue(OLD_STORAGE_KEY);
        if (oldData && !GM_getValue(STORAGE_KEY)) {
            GM_setValue(STORAGE_KEY, oldData);
            GM_deleteValue(OLD_STORAGE_KEY);
            console.log('[Discuz Marker] ✅ 数据已自动迁移到新存储键（加注域名后缀，增强兼容性）');
        }
    }
    migrateStorageKey();

    function showTemporaryMessage(message) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'temporary-message';
        msgDiv.textContent = message;
        document.body.appendChild(msgDiv);

        // eslint-disable-next-line no-unused-expressions
        msgDiv.offsetHeight; // force reflow
        msgDiv.classList.add('show');
        setTimeout(() => {
            msgDiv.classList.remove('show');
            setTimeout(() => msgDiv.remove(), 500);
        }, 3000);
    }

    function getThreadIdFromUrl(urlStr = window.location.href) {
        try {
            const url = new URL(urlStr, window.location.origin);
            const params = new URLSearchParams(url.search);
            let tid = params.get('tid');
            if (!tid) {
                const match = url.pathname.match(/thread-(\d+)-/);
                if (match) tid = match[1];
            }
            return tid;
        } catch (e) {
            return null;
        }
    }

    // --- 数据存储层 ---

    function getVisitedThreads() {
        try {
            const data = JSON.parse(GM_getValue(STORAGE_KEY, '{}'));
            return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
        } catch (e) { return {}; }
    }

    function saveVisitedThreads(data) {
        const keys = Object.keys(data);
        let dataToSave = data;
        if (keys.length > MAX_HISTORY_RECORDS * 1.1) {
            console.log(`[Discuz Marker] 记录数超出阈值 (${keys.length})，自动清理旧数据...`);
            const arr = keys.map(id => ({ id, ts: (typeof data[id] === 'object' && data[id].ts) ? data[id].ts : 0 }));
            arr.sort((a, b) => b.ts - a.ts); // 按时间倒序
            const newData = {};
            for (let i = 0; i < MAX_HISTORY_RECORDS; i++) {
                newData[arr[i].id] = data[arr[i].id];
            }
            dataToSave = newData;
        }
        GM_setValue(STORAGE_KEY, JSON.stringify(dataToSave));
    }

    function normalizeRecord(record) {
        if (record === true) return { visited: true, ts: 0 };
        if (record && typeof record === 'object') return record;
        return {};
    }

    function updateThreadData(threadId, patch) {
        if (!threadId) return;
        const visited = getVisitedThreads();
        const existing = visited[threadId];
        visited[threadId] = {
            ...normalizeRecord(existing),
            ...patch,
            ts: Date.now()
        };
        saveVisitedThreads(visited);
    }

    function getThreadRecordStats(data = getVisitedThreads()) {
        const keys = Object.keys(data);
        let visitedCount = 0;
        let viewedOnlyCount = 0;
        let latestTs = 0;

        keys.forEach(key => {
            const record = data[key];
            const normalized = normalizeRecord(record);
            if (normalized.visited) visitedCount++;
            if (!normalized.visited && normalized.viewedImages) viewedOnlyCount++;
            if (normalized.ts && normalized.ts > latestTs) latestTs = normalized.ts;
        });

        return {
            total: keys.length,
            visitedCount,
            viewedOnlyCount,
            latestText: latestTs ? new Date(latestTs).toLocaleString() : '暂无记录'
        };
    }

    // --- 面板 UI ---

    function createModalBase(id, innerDomBuilder) {
        if (document.getElementById(id)) return;
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'custom-modal-overlay';
        const content = document.createElement('div');
        content.className = 'custom-modal-content';
        innerDomBuilder(content, () => modal.remove());
        modal.appendChild(content);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    function getNumberSetting(key, defaultValue, min, max) {
        const value = Number(GM_getValue(key, defaultValue));
        if (!Number.isFinite(value)) return defaultValue;
        return Math.min(max, Math.max(min, Math.round(value)));
    }

    const CONFIG_DEFS = {
        preview_min_dimension:     { default: DEFAULT_MIN_DIMENSION,         min: 1,  max: 2000 },
        auto_preview_limit:        { default: DEFAULT_AUTO_PREVIEW_LIMIT,    min: 1,  max: 20 },
        auto_preview_concurrent:   { default: DEFAULT_AUTO_PREVIEW_CONCURRENT, min: 1, max: 5 },
    };

    function getConfig(key) {
        const def = CONFIG_DEFS[key];
        if (!def) return undefined;
        return getNumberSetting(key, def.default, def.min, def.max);
    }

    // 旧 wrapper 保留，内部委托给 getConfig，实现平滑过渡
    function getMinDimension() { return getConfig('preview_min_dimension'); }
    function getAutoPreviewLimit() { return getConfig('auto_preview_limit'); }
    function getAutoPreviewConcurrent() { return getConfig('auto_preview_concurrent'); }

    function canFetchExtraPages() {
        return GM_getValue('enable_extra_page_preview', false);
    }

    function getVisitedStyleMode() {
        const mode = GM_getValue('visited_style_mode', 'default');
        return VISITED_STYLE_MODES.includes(mode) ? mode : 'default';
    }

    function applyVisitedStyleMode() {
        document.body.classList.remove(...VISITED_STYLE_MODES.map(mode => `thread-visited-mode-${mode}`));
        document.body.classList.add(`thread-visited-mode-${getVisitedStyleMode()}`);
    }

    // --- 设置面板 UI 工厂函数 ---

    const STYLE_OPTIONS = [
        ['default',        '灰底标签'],
        ['opacity',        '半透明'],
        ['strike',         '删除线'],
        ['opacity-strike', '半透明 + 删除线'],
        ['color',          '仅改变标题颜色'],
        ['hidden',         '隐藏已读帖子'],
    ];

    function createLabeledCheckbox(labelText, checked) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        label.append(input, document.createTextNode(' ' + labelText));
        return { label, input };
    }

    function createNumberField(labelText, min, max, value) {
        const label = document.createElement('label');
        label.className = 'settings-field';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        label.append(document.createTextNode(labelText), input);
        return { label, input };
    }

    function createSettingsSection(title, children) {
        const section = document.createElement('div');
        section.className = 'settings-section';
        const h4 = document.createElement('h4');
        h4.textContent = title;
        section.appendChild(h4);
        children.forEach(child => {
            if (child.label) section.appendChild(child.label);
            else if (child instanceof Node) section.appendChild(child);
        });
        return section;
    }

    function createStyleSelect(currentMode) {
        const field = document.createElement('label');
        field.className = 'settings-field';
        const select = document.createElement('select');
        STYLE_OPTIONS.forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            if (value === currentMode) option.selected = true;
            select.appendChild(option);
        });
        field.append(document.createTextNode('显示模式'), select);
        return { field, select };
    }

    function showSettingsPanel() {
        createModalBase('discuz-helper-settings-modal', (content, closeFn) => {
            const data = getVisitedThreads();
            const stats = getThreadRecordStats(data);

            const title = document.createElement('h3');
            title.textContent = 'Discuz 辅助设置';

            // 图片预览 section
            const previewCb1 = createLabeledCheckbox('启用图片预览功能', GM_getValue('enable_preview', true));
            const previewCb2 = createLabeledCheckbox('列表页自动预览第一页', GM_getValue('enable_auto_preview', true));
            const previewCb3 = createLabeledCheckbox('允许手动抓取后续分页（每次 3 页）', canFetchExtraPages());
            const limitField = createNumberField('自动预览数量', 1, 20, getAutoPreviewLimit());
            const concurrentField = createNumberField('自动预览并发', 1, 5, getAutoPreviewConcurrent());
            const minField = createNumberField('最小图片边长', 1, 2000, getMinDimension());
            const previewTip = document.createElement('p');
            previewTip.textContent = '默认只抓取帖子第 1 页；开启后续分页后，预览网格末尾会出现”加载更多图片”卡片。';
            const previewSection = createSettingsSection('图片预览', [
                previewCb1, previewCb2, previewCb3,
                limitField, concurrentField, minField,
                previewTip,
            ]);

            // 已读样式 section
            const styleSelect = createStyleSelect(getVisitedStyleMode());
            const styleTip = document.createElement('p');
            styleTip.textContent = '已读记录仍只在真实进入帖子详情页后产生；仅看图帖子不受”隐藏已读帖子”影响。';
            const styleSection = createSettingsSection('已读样式', [styleSelect, styleTip]);

            // 数据管理 section
            const dataSection = document.createElement('div');
            dataSection.className = 'settings-section';
            const dataTitle = document.createElement('h4');
            dataTitle.textContent = '数据管理';
            const info = document.createElement('p');
            info.textContent = `当前论坛域存储了 ${Object.keys(data).length} 条帖子足迹`;
            const statsInfo = document.createElement('p');
            statsInfo.innerHTML = `已访问：${stats.visitedCount} 条<br>仅看图：${stats.viewedOnlyCount} 条<br>最近记录：${stats.latestText}<br>存储键：${STORAGE_KEY}`;
            statsInfo.style.wordBreak = 'break-all';

            const exportBtn = document.createElement('button');
            exportBtn.textContent = '⬇️ 导出数据';
            exportBtn.className = 'custom-modal-btn';
            exportBtn.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `discuz_history_${forumName}_${hostName}.json`;
                a.click();
            });

            const importBtn = document.createElement('button');
            importBtn.textContent = '⬆️ 导入数据';
            importBtn.className = 'custom-modal-btn secondary';
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.className = 'custom-modal-file-input';
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const importedData = JSON.parse(ev.target.result);
                        if (typeof importedData !== 'object' || Array.isArray(importedData)) throw new Error('无效的格式');
                        const merged = { ...getVisitedThreads() };
                        let added = 0;
                        for (const k in importedData) {
                            if (!merged[k] || (importedData[k].ts || 0) > (merged[k].ts || 0)) {
                                merged[k] = importedData[k];
                                added++;
                            }
                        }
                        saveVisitedThreads(merged);
                        info.textContent = `导入成功，合并更新了 ${added} 条记录。`;
                        info.style.color = 'green';
                    } catch (err) {
                        alert('导入失败：文件格式不合法\n' + err.message);
                    }
                };
                reader.readAsText(file);
            });

            const cleanBtn = document.createElement('button');
            cleanBtn.textContent = '🧹 清除 30 天前的足迹';
            cleanBtn.className = 'custom-modal-btn secondary';
            cleanBtn.addEventListener('click', () => {
                const currentData = getVisitedThreads();
                const now = Date.now();
                const threshold = 30 * 24 * 3600 * 1000;
                let removed = 0;
                for (const k in currentData) {
                    if (now - (currentData[k].ts || 0) > threshold) {
                        delete currentData[k];
                        removed++;
                    }
                }
                saveVisitedThreads(currentData);
                info.textContent = `清理完毕，删除了 ${removed} 条旧记录。`;
                info.style.color = 'green';
            });

            const wipeBtn = document.createElement('button');
            wipeBtn.textContent = '❌ 清空所有足迹';
            wipeBtn.className = 'custom-modal-btn danger';
            wipeBtn.addEventListener('click', () => {
                if (confirm('确定要清空本论坛产生的所有已读与看图标记吗？此操作无法撤销！')) {
                    GM_deleteValue(STORAGE_KEY);
                    info.textContent = '已彻底清空。刷新页面后重置。';
                    info.style.color = 'red';
                }
            });

            dataSection.append(dataTitle, info, statsInfo, exportBtn, fileInput, importBtn, cleanBtn, wipeBtn);

            const grid = document.createElement('div');
            grid.className = 'settings-grid';
            grid.append(previewSection, styleSection, dataSection);

            const actions = document.createElement('div');
            actions.className = 'settings-actions';
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存并刷新';
            saveBtn.className = 'custom-modal-btn';
            saveBtn.addEventListener('click', () => {
                GM_setValue('enable_preview', previewCb1.input.checked);
                GM_setValue('enable_auto_preview', previewCb2.input.checked);
                GM_setValue('enable_extra_page_preview', previewCb3.input.checked);
                GM_setValue('auto_preview_limit', getNumberFromInput(limitField.input, DEFAULT_AUTO_PREVIEW_LIMIT, 1, 20));
                GM_setValue('auto_preview_concurrent', getNumberFromInput(concurrentField.input, DEFAULT_AUTO_PREVIEW_CONCURRENT, 1, 5));
                GM_setValue('preview_min_dimension', getNumberFromInput(minField.input, DEFAULT_MIN_DIMENSION, 1, 2000));
                GM_setValue('visited_style_mode', VISITED_STYLE_MODES.includes(styleSelect.select.value) ? styleSelect.select.value : 'default');
                showTemporaryMessage('设置已保存，即将刷新页面。');
                setTimeout(() => window.location.reload(), 1000);
            });
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.className = 'custom-modal-btn secondary';
            cancelBtn.addEventListener('click', closeFn);
            actions.append(saveBtn, cancelBtn);

            content.append(title, grid, actions);
        });
    }

    function getNumberFromInput(input, defaultValue, min, max) {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return defaultValue;
        return Math.min(max, Math.max(min, Math.round(value)));
    }

    GM_registerMenuCommand("⚙️ Discuz 辅助设置", showSettingsPanel);

    function createFloatingSettingsButton() {
        if (document.getElementById('discuz-helper-floating-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'discuz-helper-floating-btn';
        btn.type = 'button';
        btn.className = 'discuz-helper-floating-btn';
        btn.textContent = '⚙';
        btn.title = 'Discuz 辅助设置（可拖动）';

        const savedPos = GM_getValue('floating_settings_button_pos', null);
        if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
            btn.style.left = `${Math.max(0, Math.min(window.innerWidth - 42, savedPos.x))}px`;
            btn.style.top = `${Math.max(0, Math.min(window.innerHeight - 42, savedPos.y))}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }

        let dragging = false;
        let moved = false;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        btn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const rect = btn.getBoundingClientRect();
            dragging = true;
            moved = false;
            pointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            btn.style.left = `${startLeft}px`;
            btn.style.top = `${startTop}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.setPointerCapture(pointerId);
        });

        btn.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            const maxLeft = Math.max(0, window.innerWidth - btn.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - btn.offsetHeight);
            btn.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + dx))}px`;
            btn.style.top = `${Math.max(0, Math.min(maxTop, startTop + dy))}px`;
        });

        const finishDrag = (e) => {
            if (!dragging || (e && e.pointerId !== pointerId)) return;
            dragging = false;
            if (pointerId !== null) {
                try { btn.releasePointerCapture(pointerId); } catch (err) { }
            }
            pointerId = null;
            const rect = btn.getBoundingClientRect();
            GM_setValue('floating_settings_button_pos', { x: Math.round(rect.left), y: Math.round(rect.top) });
        };

        btn.addEventListener('pointerup', finishDrag);
        btn.addEventListener('pointercancel', finishDrag);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (moved) return;
            showSettingsPanel();
        });

        document.body.appendChild(btn);
    }

    // --- 全局灯箱系统 ---

    let lightboxImages = [];
    let currentLightboxIndex = 0;
    const lightboxDOM = { container: null, img: null, indicator: null };

    function initLightbox() {
        if (lightboxDOM.container) return;

        const lb = document.createElement('div'); lb.id = 'global-lightbox';
        const img = document.createElement('img');
        const prev = document.createElement('div'); prev.className = 'lightbox-nav-btn'; prev.id = 'lightbox-prev'; prev.innerHTML = '&#10094;';
        const next = document.createElement('div'); next.className = 'lightbox-nav-btn'; next.id = 'lightbox-next'; next.innerHTML = '&#10095;';
        const indicator = document.createElement('div'); indicator.id = 'lightbox-indicator';

        lb.append(img, prev, next, indicator);
        document.body.appendChild(lb);

        lightboxDOM.container = lb; lightboxDOM.img = img; lightboxDOM.indicator = indicator;

        function update() {
            if (lightboxImages.length === 0) return;
            img.src = lightboxImages[currentLightboxIndex];
            indicator.textContent = `${currentLightboxIndex + 1} / ${lightboxImages.length}`;
        }
        function nextImg() { if (lightboxImages.length) { currentLightboxIndex = (currentLightboxIndex + 1) % lightboxImages.length; update(); } }
        function prevImg() { if (lightboxImages.length) { currentLightboxIndex = (currentLightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; update(); } }
        function closeLb() { lb.style.display = 'none'; }

        lb.addEventListener('click', (e) => { if (e.target === lb || e.target === indicator) closeLb(); });
        prev.addEventListener('click', (e) => { e.stopPropagation(); prevImg(); });
        next.addEventListener('click', (e) => { e.stopPropagation(); nextImg(); });

        img.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.offsetX < img.offsetWidth / 2) {
                prevImg();
            } else {
                nextImg();
            }
        });

        let lastCursorState = '';
        img.addEventListener('mousemove', (e) => {
            const targetCursor = (e.offsetX < img.offsetWidth / 2) ? CURSOR_SVG_LEFT : CURSOR_SVG_RIGHT;

            if (lastCursorState !== targetCursor) {
                img.style.cursor = targetCursor;
                lastCursorState = targetCursor;
            }
        });

        img.addEventListener('mouseleave', () => {
            lastCursorState = '';
            img.style.cursor = '';
        });

        document.addEventListener('keydown', (e) => {
            if (lb.style.display !== 'none') {
                if (e.key === 'Escape') closeLb();
                else if (e.key === 'ArrowLeft') prevImg();
                else if (e.key === 'ArrowRight') nextImg();
            }
        });
    }

    function openLightbox(urls, startIndex) {
        if (!urls || urls.length === 0) return;
        initLightbox();
        lightboxImages = urls;
        currentLightboxIndex = startIndex >= 0 && startIndex < urls.length ? startIndex : 0;
        lightboxDOM.img.src = lightboxImages[currentLightboxIndex];
        lightboxDOM.indicator.textContent = `${currentLightboxIndex + 1} / ${lightboxImages.length}`;
        lightboxDOM.container.style.display = 'flex';
    }


    // --- 核心业务逻辑 ---

    function markThreadsOnListPage() {
        const threadListTable = document.getElementById('threadlisttableid');
        if (!threadListTable) return;

        const visited = getVisitedThreads();
        const threads = threadListTable.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]');

        threads.forEach(thread => {
            const threadId = thread.id.replace(/^(normalthread_|stickthread_)/, '');
            const threadData = visited[threadId];
            thread.classList.remove('thread--visited', 'thread--viewed-images');
            if (!threadData) return;

            const isVisited = threadData === true || threadData.visited;
            const isViewedImages = threadData.viewedImages;

            if (isVisited) {
                thread.classList.add('thread--visited');
                thread.classList.remove('thread--viewed-images');
            } else if (isViewedImages) {
                thread.classList.add('thread--viewed-images');
            }
        });
    }

    function refreshThreadMark(threadElement) {
        if (!threadElement) return;
        const threadId = threadElement.id.replace(/^(normalthread_|stickthread_)/, '');
        const record = getVisitedThreads()[threadId];
        threadElement.classList.remove('thread--visited', 'thread--viewed-images');
        if (!record) return;
        if (record === true || record.visited) {
            threadElement.classList.add('thread--visited');
        } else if (record.viewedImages) {
            threadElement.classList.add('thread--viewed-images');
        }
    }

    function recordThreadVisit() {
        const threadId = getThreadIdFromUrl();
        if (threadId) updateThreadData(threadId, { visited: true });
    }

    function extractImagesFromDoc(doc) {
        const validImages = [];
        const contentAreas = doc.querySelectorAll('.t_f, .t_fsz');
        const attrNames = ['zoomfile', 'file', 'data-original', 'data-src', 'src'];
        contentAreas.forEach(area => {
            const images = area.querySelectorAll('img[id^="aimg_"], img.zoom, img[src*="attachment"], img[file], img[zoomfile], img[data-original], img[data-src]');
            images.forEach(img => {
                const src = attrNames.map(name => img.getAttribute(name)).find(Boolean);
                if (src && !/smilie|clear\.gif|none\.gif|avatar|loading/i.test(src)) {
                    validImages.push(src);
                }
            });
        });
        return [...new Set(validImages)];
    }

    function buildThreadPageUrl(threadUrl, page) {
        const url = new URL(threadUrl, window.location.origin);
        if (url.search) {
            url.searchParams.set('page', String(page));
            return url.href;
        }

        const path = url.pathname;
        let nextPath = path.replace(RE_THREAD_PAGE_SHORT, (all, tid, _page, extra = '') => `thread-${tid}-${page}${extra}.html`);
        if (nextPath === path) {
            nextPath = path.replace(RE_THREAD_PAGE_ARCHIVE, (_all, tid, _page, archive) => `thread-${tid}-${page}-${archive}.html`);
        }

        if (nextPath !== path) {
            url.pathname = nextPath;
            return url.href;
        }

        url.searchParams.set('page', String(page));
        return url.href;
    }

    function getMaxPageFromDoc(doc) {
        const pgElement = doc.querySelector('.pg');
        if (!pgElement) return 1;
        let maxPage = 1;
        pgElement.querySelectorAll('a, strong').forEach(node => {
            const textPage = parseInt((node.textContent || '').replace(/\D/g, ''), 10);
            if (textPage > maxPage) maxPage = textPage;
            const href = node.getAttribute && node.getAttribute('href');
            if (href) {
                const hrefPage = href.match(/[?&]page=(\d+)/i) || href.match(/thread-\d+-(\d+)(?:-\d+)?\.html/i);
                if (hrefPage) maxPage = Math.max(maxPage, parseInt(hrefPage[1], 10));
            }
        });
        return maxPage;
    }

    function getPreviewCacheKey(threadId) {
        return `discuz_preview_v${PREVIEW_CACHE_VERSION}_${hostName}_${forumName}_${threadId}`;
    }

    function readPreviewCache(threadId) {
        try {
            const cached = JSON.parse(sessionStorage.getItem(getPreviewCacheKey(threadId)) || 'null');
            if (!cached || cached.version !== PREVIEW_CACHE_VERSION || cached.hostName !== hostName || cached.forumName !== forumName || cached.threadId !== threadId) return null;
            if (Date.now() - (cached.cachedAt || 0) > PREVIEW_CACHE_TTL) return null;
            return cached;
        } catch (e) {
            return null;
        }
    }

    function writePreviewCache(threadId, cache) {
        try {
            sessionStorage.setItem(getPreviewCacheKey(threadId), JSON.stringify({
                version: PREVIEW_CACHE_VERSION,
                hostName,
                forumName,
                threadId,
                cachedAt: Date.now(),
                maxPage: cache.maxPage || 1,
                pages: cache.pages || {}
            }));
        } catch (e) { }
    }

    // --- PreviewState: 管理每个帖子的预览状态与 DOM 引用 ---

    class PreviewState {
        constructor(threadElement, threadId, threadUrl, dom) {
            this.threadElement = threadElement;
            this.threadId = threadId;
            this.threadUrl = threadUrl;
            // DOM 引用
            this.button = dom.button;
            this.previewOuter = dom.previewOuter;
            this.previewContainer = dom.previewContainer;
            this.statusBar = dom.statusBar;
            this.statusText = dom.statusText;
            this.progressContainer = dom.progressContainer;
            this.progressBarFill = dom.progressBarFill;
            this.moreBtn = dom.moreBtn;
            this.fullBtn = dom.fullBtn;
            // 可变状态
            this.validCountForTitle = 0;
            this.cache = { maxPage: 1, pages: {} };
            this.loadedPageUntil = 0;
            this.maxPage = 1;
            this.pendingCount = 0;
            this.checkedCount = 0;
            this.fullPreviewMode = false;
            this.firstPageImages = [];
            this.firstPageNextIndex = 0;
            this.renderedSrcSet = new Set();
            this.observer = null;
        }

        destroy() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
            previewStateMap.delete(this.threadElement);
        }
    }

    /** WeakMap<threadElement, PreviewState> — DOM 节点为键，自动 GC */
    const previewStateMap = new WeakMap();

    const autoPreviewQueue = [];
    let autoPreviewActiveCount = 0;
    let autoPreviewObserver = null;

    function enqueueAutoPreview(task) {
        autoPreviewQueue.push(task);
        drainAutoPreviewQueue();
    }

    function drainAutoPreviewQueue() {
        const concurrentLimit = getAutoPreviewConcurrent();
        while (autoPreviewActiveCount < concurrentLimit && autoPreviewQueue.length > 0) {
            const task = autoPreviewQueue.shift();
            autoPreviewActiveCount++;
            Promise.resolve()
                .then(task)
                .catch(err => {
                    console.error('[Discuz Marker] auto preview fail', err);
                })
                .finally(() => {
                    autoPreviewActiveCount--;
                    if (autoPreviewQueue.length > 0) {
                        setTimeout(drainAutoPreviewQueue, AUTO_PREVIEW_DELAY_MS);
                    }
                });
        }
    }

    function getAutoPreviewObserver() {
        if (!autoPreviewObserver) {
            autoPreviewObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    observer.unobserve(entry.target);
                    const threadElement = entry.target;
                    if (threadElement.dataset.autoPreviewQueued === 'true') return;
                    threadElement.dataset.autoPreviewQueued = 'true';
                    enqueueAutoPreview(() => runAutoPreview(threadElement));
                });
            }, { rootMargin: '500px 0px', threshold: 0.01 });
        }
        return autoPreviewObserver;
    }

    function createPreviewDOM(threadElement, titleLink) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '预览图片';
        button.className = 'preview-button';

        const previewOuter = document.createElement('div');
        previewOuter.style.display = 'none';

        const statusBar = document.createElement('div');
        statusBar.style.gridColumn = '1 / -1';
        const statusText = document.createElement('div');
        statusText.className = 'preview-status-text';
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';
        progressContainer.style.display = 'none';
        const progressBarFill = document.createElement('div');
        progressBarFill.className = 'progress-bar-fill';
        progressContainer.appendChild(progressBarFill);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'preview-container';

        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'preview-more-button';
        moreBtn.style.display = 'none';

        const fullBtn = document.createElement('button');
        fullBtn.type = 'button';
        fullBtn.className = 'preview-full-button';
        fullBtn.textContent = '加载更多图片';
        fullBtn.style.display = 'none';

        statusBar.append(statusText, progressContainer);
        previewContainer.append(statusBar);
        previewOuter.appendChild(previewContainer);

        titleLink.insertAdjacentElement('afterend', button);
        const titleCell = titleLink.closest('th');
        if (titleCell) titleCell.appendChild(previewOuter);

        // 事件委托：在容器上统一处理图片点击，触发灯箱
        previewContainer.addEventListener('click', (e) => {
            const img = e.target.closest('.preview-img-item');
            if (!img) return;
            e.stopPropagation();
            const allImgs = Array.from(previewContainer.querySelectorAll('.preview-img-item'));
            const urls = allImgs.map(im => im.src);
            const idx = allImgs.indexOf(img);
            openLightbox(urls, idx);
        });

        return {
            button, previewOuter, previewContainer,
            statusBar, statusText, progressContainer, progressBarFill,
            moreBtn, fullBtn,
        };
    }

    // --- 预览状态操作函数（模块级，接收 state 为首参） ---

    function updateButtonLabel(state) {
        const { button, previewOuter, previewContainer, validCountForTitle } = state;
        if (previewContainer.dataset.error === 'true') {
            button.textContent = '获取失败';
        } else if (previewContainer.dataset.loaded === 'true' && validCountForTitle === 0) {
            button.textContent = '无图片';
        } else if (previewOuter.style.display !== 'none') {
            button.textContent = '隐藏图片';
        } else if (validCountForTitle > 0) {
            button.textContent = `预览图片 (${validCountForTitle})`;
        } else {
            button.textContent = '预览图片';
        }
    }

    function setManualFeedbackVisible(state, visible) {
        state.statusBar.style.display = visible ? '' : 'none';
        if (!visible) state.progressContainer.style.display = 'none';
    }

    let _syncFullSizePending = false;
    function syncFullButtonSize(state) {
        if (_syncFullSizePending) return;
        _syncFullSizePending = true;
        requestAnimationFrame(() => {
            _syncFullSizePending = false;
            const images = Array.from(state.previewContainer.querySelectorAll('.preview-img-item'));
            const lastImage = images[images.length - 1];
            if (!lastImage) {
                state.fullBtn.style.height = '140px';
                return;
            }
            const rect = lastImage.getBoundingClientRect();
            if (rect.height > 0) {
                state.fullBtn.style.height = `${Math.round(rect.height)}px`;
            }
        });
    }

    function hasFirstPageRemainingImages(state) {
        return state.firstPageNextIndex < state.firstPageImages.length;
    }

    function appendRemainingFirstPageImages(state) {
        if (!hasFirstPageRemainingImages(state)) return false;
        const remaining = state.firstPageImages.slice(state.firstPageNextIndex);
        state.firstPageNextIndex = state.firstPageImages.length;
        appendImagePlaceholders(state, remaining, { silent: !canFetchExtraPages() });
        return true;
    }

    function updateMoreButton(state) {
        state.moreBtn.style.display = 'none';
        const hasMoreFirst = hasFirstPageRemainingImages(state);
        const hasMorePages = canFetchExtraPages() && state.loadedPageUntil < state.maxPage;
        if (state.previewContainer.dataset.loaded === 'true' && state.validCountForTitle > 0 && (hasMoreFirst || hasMorePages)) {
            const nextStart = state.loadedPageUntil + 1;
            const nextEnd = Math.min(state.maxPage, state.loadedPageUntil + PREVIEW_PAGE_BATCH_SIZE);
            state.fullBtn.textContent = '加载更多图片';
            state.fullBtn.title = hasMoreFirst
                ? '继续显示第 1 页剩余图片'
                : `继续抓取第 ${nextStart}-${nextEnd} 页（共 ${state.maxPage} 页）`;
            state.fullBtn.style.display = '';
            syncFullButtonSize(state);
        } else {
            state.fullBtn.title = '';
            state.fullBtn.style.display = 'none';
        }
    }

    function updateStatus(state) {
        const { previewOuter, previewContainer, statusText, validCountForTitle,
                pendingCount, checkedCount, loadedPageUntil, maxPage, fullPreviewMode } = state;

        if (!fullPreviewMode) {
            if (previewContainer.dataset.loaded === 'true' && pendingCount === 0 && validCountForTitle === 0) {
                previewOuter.style.display = 'none';
            }
            setManualFeedbackVisible(state, false);
            updateMoreButton(state);
            updateButtonLabel(state);
            return;
        }
        if (!canFetchExtraPages()) {
            setManualFeedbackVisible(state, false);
            updateMoreButton(state);
            updateButtonLabel(state);
            return;
        }
        setManualFeedbackVisible(state, true);
        if (pendingCount > 0) {
            statusText.textContent = `正在逐步呈现图片... (剩余 ${pendingCount} 张待查，符合要求展示 ${validCountForTitle} 张)`;
        } else if (validCountForTitle > 0) {
            statusText.textContent = `已抓取 ${loadedPageUntil}/${maxPage} 页，共加载 ${validCountForTitle} 张图片。`;
        } else if (checkedCount > 0) {
            statusText.textContent = '没有满足尺寸要求的图片。';
        } else {
            statusText.textContent = loadedPageUntil < maxPage
                ? `前 ${loadedPageUntil} 页未发现图片，可继续抓取后续页面。`
                : '该帖子内没有发现图片。';
        }
        updateMoreButton(state);
        updateButtonLabel(state);
    }

    function appendAutoPreviewCandidates(state, targetLimit, silent = true) {
        if (!hasFirstPageRemainingImages(state) || state.validCountForTitle >= targetLimit) return false;
        const neededCount = targetLimit - state.validCountForTitle;
        const nextImages = [];
        while (state.firstPageNextIndex < state.firstPageImages.length && nextImages.length < neededCount) {
            const imgSrc = state.firstPageImages[state.firstPageNextIndex++];
            if (state.renderedSrcSet.has(imgSrc)) continue;
            nextImages.push(imgSrc);
        }
        if (nextImages.length === 0) return false;
        appendImagePlaceholders(state, nextImages, { silent, autoFillLimit: targetLimit });
        return true;
    }

    function appendImagePlaceholders(state, srcList, options = {}) {
        const { previewContainer, previewOuter, fullBtn, progressBarFill,
                progressContainer, threadUrl } = state;
        const silent = options.silent === true;
        const limit = Number.isFinite(options.limit) ? options.limit : null;
        const autoFillLimit = Number.isFinite(options.autoFillLimit) ? options.autoFillLimit : null;
        let acceptedInThisRun = 0;
        const uniqueList = srcList.filter(src => {
            if (state.renderedSrcSet.has(src)) return false;
            state.renderedSrcSet.add(src);
            return true;
        });

        if (uniqueList.length === 0) {
            updateStatus(state);
            return;
        }

        state.pendingCount += uniqueList.length;
        state.checkedCount += uniqueList.length;

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const placeholder = entry.target;
                obs.unobserve(placeholder);

                const imgSrc = placeholder.dataset.src;
                const finalSrc = (!imgSrc.startsWith('http') && !imgSrc.startsWith('//'))
                    ? new URL(imgSrc, threadUrl).href : imgSrc;
                const tempImg = new Image();
                let isHandled = false;

                const finish = (shouldShow) => {
                    if (isHandled) return;
                    isHandled = true;
                    const overLimit = shouldShow && limit !== null && acceptedInThisRun >= limit;
                    if (shouldShow && !overLimit) {
                        acceptedInThisRun++;
                        state.validCountForTitle++;
                        const previewImg = document.createElement('img');
                        previewImg.src = finalSrc;
                        previewImg.className = 'preview-img-item';
                        previewImg.style.aspectRatio = `${tempImg.naturalWidth} / ${tempImg.naturalHeight}`;
                        placeholder.replaceWith(previewImg);
                        syncFullButtonSize(state);
                    } else {
                        if (overLimit) state.renderedSrcSet.delete(imgSrc);
                        placeholder.remove();
                    }
                    state.pendingCount--;
                    progressBarFill.style.width = state.checkedCount
                        ? `${Math.min(95, 40 + 55 * ((state.checkedCount - state.pendingCount) / state.checkedCount))}%`
                        : '95%';
                    if (state.pendingCount === 0) progressContainer.style.display = 'none';
                    if (state.pendingCount === 0 && autoFillLimit !== null && state.validCountForTitle < autoFillLimit) {
                        if (appendAutoPreviewCandidates(state, autoFillLimit, silent)) return;
                    }
                    updateStatus(state);
                };

                const pollDimension = () => {
                    if (isHandled) return;
                    if (tempImg.naturalWidth > 0 && tempImg.naturalHeight > 0) {
                        const minDim = getMinDimension();
                        finish(tempImg.naturalWidth >= minDim && tempImg.naturalHeight >= minDim);
                    } else {
                        requestAnimationFrame(pollDimension);
                    }
                };

                requestAnimationFrame(pollDimension);
                tempImg.onload = () => {
                    const minDim = getMinDimension();
                    finish(tempImg.naturalWidth >= minDim && tempImg.naturalHeight >= minDim);
                };
                tempImg.onerror = () => finish(false);
                tempImg.src = finalSrc;
            });
        }, { root: previewOuter, rootMargin: '400px 0px', threshold: 0.01 });

        uniqueList.forEach(imgSrc => {
            const placeholder = document.createElement('div');
            placeholder.className = 'preview-img-loading';
            placeholder.textContent = silent ? '' : '等待呈现...';
            placeholder.dataset.src = imgSrc;
            if (fullBtn.parentNode === previewContainer) {
                previewContainer.insertBefore(placeholder, fullBtn);
            } else {
                previewContainer.appendChild(placeholder);
            }
            observer.observe(placeholder);
        });
        updateStatus(state);
    }

    async function fetchPageImages(state, page, options = {}) {
        const { cache, threadUrl, threadId, statusText, progressContainer, progressBarFill } = state;
        if (cache.pages[page]) return cache.pages[page];
        if (!options.silent) {
            setManualFeedbackVisible(state, true);
            statusText.textContent = `正在拉取第 ${page} 页...`;
            progressContainer.style.display = 'block';
            progressBarFill.style.width = `${Math.min(80, 15 + page * 15)}%`;
        }
        const response = await fetch(buildThreadPageUrl(threadUrl, page));
        if (!response.ok) throw new Error(`第 ${page} 页 HTTP Error: ${response.status}`);
        const text = await response.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const srcList = extractImagesFromDoc(doc);
        cache.pages[page] = srcList;
        if (page === 1) {
            state.firstPageImages = srcList;
            state.maxPage = getMaxPageFromDoc(doc);
            cache.maxPage = state.maxPage;
        }
        writePreviewCache(threadId, cache);
        return srcList;
    }

    function addPreviewButtonToThread(threadElement) {
        const titleLink = threadElement.querySelector('th a.s.xst') || threadElement.querySelector('th a.xst');
        if (!titleLink) return;

        const threadUrl = titleLink.href;
        const threadId = threadElement.id.replace(/^(normalthread_|stickthread_)/, '');

        if (threadElement.querySelector('.preview-button')) return;

        const dom = createPreviewDOM(threadElement, titleLink);
        const {
            button, previewOuter, previewContainer,
            statusBar, statusText, progressContainer, progressBarFill,
            moreBtn, fullBtn,
        } = dom;

        // 创建预览状态并绑定到 DOM 节点 (WeakMap 保证自动 GC)
        const state = new PreviewState(threadElement, threadId, threadUrl, dom);
        previewStateMap.set(threadElement, state);

        let validCountForTitle = 0;
        let cache = readPreviewCache(threadId) || { maxPage: 1, pages: {} };
        let loadedPageUntil = 0;
        let maxPage = cache.maxPage || 1;
        let pendingCount = 0;
        let checkedCount = 0;
        let fullPreviewMode = false;
        let firstPageImages = [];
        let firstPageNextIndex = 0;
        const renderedSrcSet = new Set();
        setManualFeedbackVisible(state, false);


        const loadAutoPreview = async () => {
            if (previewContainer.dataset.loading === 'true' || previewContainer.dataset.loaded === 'true') return;
            previewContainer.dataset.loading = 'true';
            delete previewContainer.dataset.error;
            button.disabled = true;
            moreBtn.disabled = true;
            fullBtn.disabled = true;
            previewOuter.style.display = 'block';
            setManualFeedbackVisible(state, false);

            try {
                const pageImages = await fetchPageImages(state,1, { silent: true });
                firstPageImages = pageImages;
                firstPageNextIndex = 0;
                maxPage = cache.maxPage || maxPage || 1;
                loadedPageUntil = Math.max(loadedPageUntil, 1);
                appendAutoPreviewCandidates(state, getAutoPreviewLimit(), true);
                previewContainer.dataset.loaded = 'true';
                delete previewContainer.dataset.error;
                updateStatus(state);
            } catch (err) {
                console.error('[Discuz Marker] auto preview images fail', err);
                previewOuter.style.display = 'none';
            } finally {
                button.disabled = false;
                moreBtn.disabled = false;
                fullBtn.disabled = false;
                delete previewContainer.dataset.loading;
                updateButtonLabel(state);
            }
        };

        const loadPageBatch = async (startPage) => {
            if (previewContainer.dataset.loading === 'true') return;
            if (startPage > 1 && !canFetchExtraPages()) return false;
            previewContainer.dataset.loading = 'true';
            delete previewContainer.dataset.error;
            fullPreviewMode = true;
            setManualFeedbackVisible(state, canFetchExtraPages());
            button.disabled = true;
            moreBtn.disabled = true;
            fullBtn.disabled = true;
            progressContainer.style.display = canFetchExtraPages() ? 'block' : 'none';
            progressBarFill.style.width = canFetchExtraPages() ? '10%' : '0%';

            try {
                if (startPage === 1 || !cache.pages[1]) {
                    await fetchPageImages(state,1, { silent: !canFetchExtraPages() });
                }
                maxPage = cache.maxPage || maxPage || 1;
                if (startPage === 1 && cache.pages[1]) {
                    firstPageImages = cache.pages[1];
                    firstPageNextIndex = firstPageImages.length;
                }

                const actualStart = Math.max(startPage, loadedPageUntil + 1, 1);
                const endPage = canFetchExtraPages() ? Math.min(maxPage, actualStart + PREVIEW_PAGE_BATCH_SIZE - 1) : 1;
                const batchImages = [];
                for (let page = actualStart; page <= endPage; page++) {
                    batchImages.push(...await fetchPageImages(state,page));
                    loadedPageUntil = Math.max(loadedPageUntil, page);
                }

                if (canFetchExtraPages() && startPage === 1 && loadedPageUntil < Math.min(maxPage, PREVIEW_PAGE_BATCH_SIZE)) {
                    loadedPageUntil = Math.min(maxPage, PREVIEW_PAGE_BATCH_SIZE);
                }

                appendImagePlaceholders(state, [...new Set(batchImages)], { silent: !canFetchExtraPages() });
                previewContainer.dataset.loaded = 'true';
                delete previewContainer.dataset.error;
                updateThreadData(threadId, { viewedImages: true });
                refreshThreadMark(threadElement);
                progressBarFill.style.width = '95%';
                if (pendingCount === 0) progressContainer.style.display = 'none';
                updateStatus(state);
                return true;
            } catch (err) {
                console.error('[Discuz Marker] fetch images fail', err);
                previewContainer.dataset.error = 'true';
                statusText.textContent = `获取数据失败: ${err.message}`;
                progressContainer.style.display = 'none';
                button.textContent = '获取失败';
                return false;
            } finally {
                button.disabled = false;
                moreBtn.disabled = false;
                fullBtn.disabled = false;
                delete previewContainer.dataset.loading;
                updateButtonLabel(state);
            }
        };

        button.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();

            const isDisplayed = previewOuter.style.display !== 'none';
            if (previewContainer.dataset.loaded === "true") {
                if (validCountForTitle === 0 && (hasFirstPageRemainingImages(state) || loadedPageUntil < maxPage)) {
                    if (hasFirstPageRemainingImages(state) || canFetchExtraPages()) {
                        fullPreviewMode = true;
                        previewOuter.style.display = 'block';
                        button.textContent = '获取中...';
                        if (appendRemainingFirstPageImages(state)) {
                            updateThreadData(threadId, { viewedImages: true });
                            refreshThreadMark(threadElement);
                            updateButtonLabel(state);
                        } else {
                            await loadPageBatch(loadedPageUntil + 1);
                        }
                    } else {
                        previewOuter.style.display = 'none';
                        updateButtonLabel(state);
                    }
                    return;
                }
                previewOuter.style.display = isDisplayed ? 'none' : 'block';
                updateButtonLabel(state);
                return;
            }

            fullPreviewMode = true;
            previewOuter.style.display = 'block';
            button.textContent = '获取中...';
            await loadPageBatch(1);
        });

        moreBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await loadPageBatch(loadedPageUntil + 1);
        });

        fullBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            fullPreviewMode = true;
            previewOuter.style.display = 'block';
            updateThreadData(threadId, { viewedImages: true });
            refreshThreadMark(threadElement);
            const appendedFirstPageRemaining = appendRemainingFirstPageImages(state);
            updateStatus(state);
            if (!appendedFirstPageRemaining && canFetchExtraPages() && loadedPageUntil < maxPage) {
                await loadPageBatch(loadedPageUntil + 1);
            }
            updateStatus(state);
        });

        threadElement.discuzStartAutoPreview = loadAutoPreview;
        previewContainer.appendChild(moreBtn);
        previewContainer.appendChild(fullBtn);
    }

    function addPreviewButtons() {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(thread => {
            addPreviewButtonToThread(thread);
            registerAutoPreview(thread);
        });
    }

    function registerAutoPreview(threadElement) {
        if (!GM_getValue('enable_auto_preview', true)) return;
        if (!threadElement || threadElement.dataset.autoPreviewObserved === 'true') return;
        threadElement.dataset.autoPreviewObserved = 'true';
        getAutoPreviewObserver().observe(threadElement);
    }

    async function runAutoPreview(threadElement) {
        if (!GM_getValue('enable_preview', true) || !GM_getValue('enable_auto_preview', true)) return;
        addPreviewButtonToThread(threadElement);
        if (typeof threadElement.discuzStartAutoPreview === 'function') {
            await threadElement.discuzStartAutoPreview();
        }
    }

    function observeNewThreads() {
        const threadListTable = document.getElementById('threadlisttableid');
        if (!threadListTable) return;
        let pendingUpdate = false;
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.tagName === 'TBODY' && (node.id.startsWith('normalthread_') || node.id.startsWith('stickthread_'))) {
                            if (enablePreview) {
                                addPreviewButtonToThread(node);
                                registerAutoPreview(node);
                            }
                        }
                    });
                    if (!pendingUpdate) {
                        pendingUpdate = true;
                        setTimeout(() => {
                            markThreadsOnListPage();
                            if (enablePreview) addPreviewButtons();
                            pendingUpdate = false;
                        }, 50);
                    }
                }
            });
        });
        observer.observe(threadListTable, { childList: true });
    }

    // --- 初始化流程 ---

    const currentUrl = window.location.href;
    const enablePreview = GM_getValue('enable_preview', true);
    applyVisitedStyleMode();
    createFloatingSettingsButton();

    if (currentUrl.includes('mod=forumdisplay') || currentUrl.includes('forum-')) {
        markThreadsOnListPage();

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') markThreadsOnListPage();
        });

        if (enablePreview) {
            addPreviewButtons();
        }
        setTimeout(observeNewThreads, 1500);
    } else if (currentUrl.includes('mod=viewthread') || currentUrl.includes('thread-')) {
        // 立即记录访问；部分 Discuz 环境下异步存储可能存在时序问题，
        // 因此 3 秒后做二次确认：若仍无 visited 标记则补写一次。
        recordThreadVisit();

        setTimeout(() => {
            const tid = getThreadIdFromUrl();
            if (tid && !getVisitedThreads()[tid]?.visited) {
                recordThreadVisit();
            }
        }, 3000);
    }
})();
