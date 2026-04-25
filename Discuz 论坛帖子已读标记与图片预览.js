// ==UserScript==
// @name              Discuz 论坛帖子已读标记与图片预览
// @name:en           Discuz Visited Thread Marker with Image Preview
// @namespace         http://tampermonkey.net/
// @version           4.1
// @description       自动记录并标记 Discuz! 论坛中已访问过的帖子，可选图片预览功能。全面重构：防数据膨胀、性能优化(IntersectionObserver+requestAnimationFrame)、列表瀑布流、图片灯箱支持键盘与前后翻页、缓存体验提升。
// @description:en    Marks visited threads in Discuz! forum lists and optionally adds image preview. Uses progressive rendering for fast image previews and auto-cleans old data.
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
        /* 设置与管理面板样式 */
        .custom-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex; justify-content: center; align-items: center; z-index: 10000;
        }
        .custom-modal-content {
            background-color: #fff; padding: 20px; border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); max-width: 450px; width: 90%;
            font-family: Arial, sans-serif; text-align: center;
        }
        .custom-modal-content h3 { margin-top: 0; color: #333; }
        .custom-modal-content label { display: block; margin: 15px 0; font-size: 16px; cursor: pointer; color: #555; text-align: left;}
        .custom-modal-content input[type="checkbox"] { margin-right: 10px; }
        .custom-modal-btn {
            padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 5px;
            font-size: 14px; background-color: #007bff; color: #fff; transition: background-color 0.3s;
        }
        .custom-modal-btn:hover { background-color: #0056b3; }
        .custom-modal-btn.danger { background-color: #dc3545; }
        .custom-modal-btn.danger:hover { background-color: #c82333; }
        .custom-modal-btn.secondary { background-color: #6c757d; }
        .custom-modal-btn.secondary:hover { background-color: #5a6268; }
        .custom-modal-file-input { display: none; }

        .temporary-message {
            position: fixed; top: 20px; right: 20px; background-color: #4CAF50;
            color: white; padding: 15px; border-radius: 5px; z-index: 10001;
            opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none;
        }
        .temporary-message.show { opacity: 1; }

        /* 预览按钮与容器 */
        .preview-button {
            margin-left: 8px; padding: 2px 8px; border: 1px solid #dcdcdc; border-radius: 4px;
            cursor: pointer; background-color: #f9f9f9; font-size: 12px; color: #333; transition: all 0.2s;
        }
        .preview-button:hover:not(:disabled) { background-color: #e0e0e0; }

        .preview-container {
            margin-top: 10px; padding: 10px; border-radius: 4px; border: 1px solid #e4e7ed;
            background-color: #f0f2f5; line-height: 1.5; max-height: 50vh; overflow-y: auto; overflow-x: hidden;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; align-items: start;
        }

        .preview-status-text { color: #666; font-size: 12px; font-weight: bold; margin-bottom: 8px; grid-column: 1 / -1; }

        /* 进度条 */
        .progress-container {
            height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden; margin-bottom: 8px; grid-column: 1 / -1;
        }
        .progress-bar-fill {
            height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s ease; width: 0%;
        }

        /* 图片项 */
        .preview-img-item, .preview-img-loading {
            width: 100%; border-radius: 4px; overflow: hidden; text-align: center;
        }
        .preview-img-item {
            max-height: 250px; border: 1px solid #ccc; background-color: #f8f9fa;
            cursor: zoom-in; object-fit: cover; transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .preview-img-item:hover { transform: scale(1.03); box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 10; position: relative; }

        .preview-img-loading {
            min-height: 100px; background-color: #f8f9fa; border: 1px dashed #dcdcdc;
            display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 12px;
        }

        /* 帖子状态标记 - 核心：用 CSS class 替代 style 标签注入 */
        .thread--visited { background-color: #a9a9a9 !important; }
        .thread--visited a.xst::before { content: "[已访问] "; font-weight: bold; color: #363636; }

        .thread--viewed-images { background-color: #d2d2d2 !important; }
        .thread--viewed-images a.xst::before { content: "[已看图] "; font-weight: bold; color: #ff8c00; }

        /* 全局灯箱 */
        #global-lightbox {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.85);
            display: none; justify-content: center; align-items: center; z-index: 99999; user-select: none;
        }
        #global-lightbox img {
            max-width: 90%; max-height: 90%; object-fit: contain; box-shadow: 0 0 20px rgba(0,0,0,0.5); border-radius: 4px;
        }
        .lightbox-nav-btn {
            position: absolute; top: 50%; transform: translateY(-50%); color: white; font-size: 40px; cursor: pointer; padding: 20px;
            background: rgba(0,0,0,0.1); transition: background 0.2s; border-radius: 4px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }
        .lightbox-nav-btn:hover { background: rgba(0,0,0,0.6); }
        #lightbox-prev { left: 20px; }
        #lightbox-next { right: 20px; }
        #lightbox-indicator {
            position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
            color: white; font-size: 16px; background: rgba(0,0,0,0.6); padding: 5px 15px; border-radius: 15px; letter-spacing: 1px;
        }

        /* 暗黑模式适配 */
        @media (prefers-color-scheme: dark) {
            .custom-modal-content { background-color: #2a2a2a; color: #eee; }
            .custom-modal-content h3 { color: #fff; }
            .custom-modal-content label { color: #ccc; }
            .preview-container { background-color: #1e1e1e; border-color: #333; }
            .preview-button { background-color: #333; color: #ccc; border-color: #555; }
            .preview-button:hover:not(:disabled) { background-color: #444; }
            .preview-img-item, .preview-img-loading { border-color: #444; background-color: #222; }
            .thread--visited { background-color: #2a2a2a !important; }
            .thread--viewed-images { background-color: #364136 !important; }
            .progress-container { background-color: #444; }
        }
    `);

    const BASE_STORAGE_KEY = 'discuz_visited_threads';
    const MIN_DIMENSION = 200; // 图片最小尺寸阈值
    const MAX_HISTORY_RECORDS = 2000; // 最大保存帖子记录数

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
        if (keys.length > MAX_HISTORY_RECORDS * 1.1) {
            console.log(`[Discuz Marker] 记录数超出阈值 (${keys.length})，自动清理旧数据...`);
            const arr = keys.map(id => ({ id, ts: (typeof data[id] === 'object' && data[id].ts) ? data[id].ts : 0 }));
            arr.sort((a, b) => b.ts - a.ts); // 按时间倒序
            const newData = {};
            for (let i = 0; i < MAX_HISTORY_RECORDS; i++) {
                newData[arr[i].id] = data[arr[i].id];
            }
            data = newData;
        }
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function updateThreadData(threadId, patch) {
        if (!threadId) return;
        const visited = getVisitedThreads();
        const existing = visited[threadId];
        visited[threadId] = {
            ...(typeof existing === 'object' ? existing : (existing === true ? { visited: true } : {})),
            ...patch,
            ts: Date.now()
        };
        saveVisitedThreads(visited);
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

    function showSettingsDialog() {
        createModalBase('image-preview-settings-modal', (content, closeFn) => {
            const enablePreview = GM_getValue('enable_preview', true);
            const enableMultiPage = GM_getValue('enable_multipage_preview', false);

            const title = document.createElement('h3'); title.textContent = '图片预览设置';

            const lbl1 = document.createElement('label');
            const chk1 = document.createElement('input'); chk1.type = 'checkbox'; chk1.checked = enablePreview;
            lbl1.appendChild(chk1); lbl1.appendChild(document.createTextNode(' 启用图片预览功能'));

            const lbl2 = document.createElement('label');
            const chk2 = document.createElement('input'); chk2.type = 'checkbox'; chk2.checked = enableMultiPage;
            lbl2.appendChild(chk2); lbl2.appendChild(document.createTextNode(' 【可选】自动抓取多页帖子的所有图片'));

            const saveBtn = document.createElement('button'); saveBtn.textContent = '保存并刷新'; saveBtn.className = 'custom-modal-btn';

            saveBtn.addEventListener('click', () => {
                GM_setValue('enable_preview', chk1.checked);
                GM_setValue('enable_multipage_preview', chk2.checked);
                showTemporaryMessage('设置已保存，即将刷新页面。');
                setTimeout(() => window.location.reload(), 1000);
            });

            const cancelBtn = document.createElement('button'); cancelBtn.textContent = '取消'; cancelBtn.className = 'custom-modal-btn secondary';
            cancelBtn.addEventListener('click', closeFn);

            content.append(title, lbl1, lbl2, saveBtn, cancelBtn);
        });
    }

    function showDataManagementDialog() {
        createModalBase('data-management-modal', (content, closeFn) => {
            const data = getVisitedThreads();
            const keys = Object.keys(data);

            const title = document.createElement('h3'); title.textContent = '已读记录数据管理';
            const info = document.createElement('p'); info.textContent = `当前论坛域存储了 ${keys.length} 条帖子足迹`;
            info.style.color = '#777'; info.style.marginBottom = '20px';

            const exportBtn = document.createElement('button'); exportBtn.textContent = '⬇️ 导出数据'; exportBtn.className = 'custom-modal-btn';
            exportBtn.addEventListener('click', () => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = `discuz_history_${forumName}_${hostName}.json`;
                a.click();
            });

            const importBtn = document.createElement('button'); importBtn.textContent = '⬆️ 导入数据'; importBtn.className = 'custom-modal-btn secondary';
            const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.className = 'custom-modal-file-input';
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const importedStr = ev.target.result;
                        const importedData = JSON.parse(importedStr);
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

            const cleanBtn = document.createElement('button'); cleanBtn.textContent = '🧹 清除 30 天前的足迹'; cleanBtn.className = 'custom-modal-btn secondary';
            cleanBtn.addEventListener('click', () => {
                const currentData = getVisitedThreads();
                const now = Date.now();
                const threshold = 30 * 24 * 3600 * 1000;
                let removed = 0;
                for (const k in currentData) {
                    const ts = currentData[k].ts || 0;
                    if (now - ts > threshold) {
                        delete currentData[k];
                        removed++;
                    }
                }
                saveVisitedThreads(currentData);
                info.textContent = `清理完毕，删除了 ${removed} 条旧记录。`;
                info.style.color = 'green';
            });

            const wipeBtn = document.createElement('button'); wipeBtn.textContent = '❌ 清空所有足迹'; wipeBtn.className = 'custom-modal-btn danger';
            wipeBtn.addEventListener('click', () => {
                if (confirm('确定要清空本论坛产生的所有已读与看图标记吗？此操作无法撤销！')) {
                    GM_deleteValue(STORAGE_KEY);
                    info.textContent = '已彻底清空。刷新页面后重置。';
                    info.style.color = 'red';
                }
            });

            content.append(title, info, exportBtn, fileInput, importBtn, document.createElement('br'), cleanBtn, wipeBtn);
        });
    }

    GM_registerMenuCommand("⚙️ 图片预览设置", showSettingsDialog);
    GM_registerMenuCommand("🗄️ 数据管理面板", showDataManagementDialog);

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


        // 左箭头
        const cursorLeft = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024' width='32' height='32'%3E%3Cpath d='M729.29 959.73c-10.02 0-20.04-3.82-27.69-11.47L292.83 539.47a39.18 39.18 0 0 1-11.47-27.69c0-10.38 4.13-20.34 11.47-27.69L701.61 75.34c15.3-15.3 40.08-15.3 55.37 0s15.3 40.08 0 55.37L375.89 511.79l381.09 381.1c15.3 15.3 15.3 40.08 0 55.37a39.073 39.073 0 0 1-27.69 11.47z' fill='white' stroke='black' stroke-width='40' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, pointer`;
        
        // 右箭头
        const cursorRight = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024' width='32' height='32'%3E%3Cpath d='M295.28 959.73c-10.01 0-20.03-3.82-27.67-11.47-15.29-15.29-15.29-40.06 0-55.35l380.94-380.92-380.94-380.95c-15.29-15.29-15.29-40.06 0-55.35s40.06-15.29 55.35 0l408.62 408.62a39.15 39.15 0 0 1 11.47 27.67c0 10.37-4.13 20.34-11.47 27.67l-408.62 408.6a39.02 39.02 0 0 1-27.68 11.48z' fill='white' stroke='black' stroke-width='40' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, pointer`;
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
            const targetCursor = (e.offsetX < img.offsetWidth / 2) ? cursorLeft : cursorRight;

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

    function recordThreadVisit() {
        const threadId = getThreadIdFromUrl();
        if (threadId) updateThreadData(threadId, { visited: true });
    }

    function extractImagesFromDoc(doc) {
        const validImages = [];
        const contentAreas = doc.querySelectorAll('.t_f, .t_fsz');
        contentAreas.forEach(area => {
            const images = area.querySelectorAll('img[id^="aimg_"], img.zoom, img[src*="attachment"]');
            images.forEach(img => {
                const src = img.getAttribute('file') || img.getAttribute('src') || img.getAttribute('zoomfile');
                if (src && !src.includes('smilie') && !src.includes('clear.gif') && !src.includes('none.gif')) {
                    validImages.push(src);
                }
            });
        });
        return [...new Set(validImages)];
    }

    function addPreviewButtonToThread(threadElement) {
        if (threadElement.querySelector('.preview-button')) return;
        const titleLink = threadElement.querySelector('th a.s.xst') || threadElement.querySelector('th a.xst');
        if (!titleLink) return;

        const threadUrl = titleLink.href;
        const threadId = threadElement.id.replace(/^(normalthread_|stickthread_)/, '');

        const button = document.createElement('button');
        button.textContent = '预览图片';
        button.className = 'preview-button';

        const previewOuter = document.createElement('div');
        previewOuter.style.display = 'none';

        const statusBar = document.createElement('div');
        statusBar.style.gridColumn = '1 / -1';
        const statusText = document.createElement('div'); statusText.className = 'preview-status-text';
        const progressContainer = document.createElement('div'); progressContainer.className = 'progress-container'; progressContainer.style.display = 'none';
        const progressBarFill = document.createElement('div'); progressBarFill.className = 'progress-bar-fill';
        progressContainer.appendChild(progressBarFill);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'preview-container';

        statusBar.append(statusText, progressContainer);
        previewContainer.append(statusBar);
        previewOuter.appendChild(previewContainer);

        titleLink.insertAdjacentElement('afterend', button);
        const titleCell = titleLink.closest('th');
        if (titleCell) titleCell.appendChild(previewOuter);

        let validCountForTitle = 0; // 一旦成功加载完毕，将按钮标题固化

        button.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();

            const isDisplayed = previewOuter.style.display !== 'none';
            if (previewContainer.dataset.loaded === "true") {
                previewOuter.style.display = isDisplayed ? 'none' : 'block';
                button.textContent = isDisplayed ? (validCountForTitle > 0 ? `预览图片 (${validCountForTitle})` : '无图片') : '隐藏图片';
                return;
            }

            if (previewContainer.dataset.loading === "true") return;

            button.textContent = '获取中...';
            button.disabled = true;
            previewContainer.dataset.loading = "true";
            previewOuter.style.display = 'block';
            statusText.textContent = '正在获取帖子数据...';
            progressContainer.style.display = 'block';
            progressBarFill.style.width = '10%';

            try {
                let validSrcList = [];
                const cacheKey = `discuz_preview_v4_${threadId}`;
                const cached = sessionStorage.getItem(cacheKey);

                if (cached) {
                    validSrcList = JSON.parse(cached);
                    statusText.textContent = '从缓存读取成功，正在加载...';
                    progressBarFill.style.width = '50%';
                } else {
                    const response = await fetch(threadUrl);
                    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                    const text = await response.text();
                    const doc = new DOMParser().parseFromString(text, 'text/html');
                    validSrcList = extractImagesFromDoc(doc);
                    progressBarFill.style.width = '40%';

                    const enableMultiPage = GM_getValue('enable_multipage_preview', false);
                    if (enableMultiPage) {
                        const pgElement = doc.querySelector('.pg');
                        if (pgElement) {
                            const lastLink = pgElement.querySelector('.last') || pgElement.querySelector('a:nth-last-child(2)');
                            if (lastLink) {
                                const maxPageMatch = lastLink.href.match(/page=(\d+)/) || lastLink.href.match(/-(\d+)\.html/);
                                const maxPage = maxPageMatch ? parseInt(maxPageMatch[1], 10) : 1;

                                if (maxPage > 1) {
                                    for (let i = 2; i <= maxPage; i++) {
                                        statusText.textContent = `正在拉取第 ${i}/${maxPage} 页...`;
                                        progressBarFill.style.width = `${40 + 40 * (i / maxPage)}%`;
                                        try {
                                            const pageUrl = threadUrl.includes('?') ? `${threadUrl}&page=${i}` : threadUrl.replace(/-1\.html$/, `-${i}.html`);
                                            const pRes = await fetch(pageUrl);
                                            const pText = await pRes.text();
                                            const pDoc = new DOMParser().parseFromString(pText, 'text/html');
                                            const pSrcList = extractImagesFromDoc(pDoc);
                                            validSrcList = [...validSrcList, ...pSrcList];
                                        } catch (err) { console.error('fetch page err', err); }
                                    }
                                }
                            }
                        }
                    }
                    validSrcList = [...new Set(validSrcList)];
                    try { sessionStorage.setItem(cacheKey, JSON.stringify(validSrcList)); } catch (e) { }
                }

                if (validSrcList.length === 0) {
                    statusText.textContent = '该帖子内没有发现图片。';
                    button.textContent = '无图片';
                    button.style.cssText = 'background-color:#f5f5f5; color:#aaa; cursor:not-allowed;';
                    previewContainer.dataset.loaded = "true";
                    progressContainer.style.display = 'none';
                    return;
                }

                let pendingCount = validSrcList.length;
                let loadedCount = 0;

                const updateCountDisplay = () => {
                    if (pendingCount === 0) {
                        statusText.textContent = loadedCount === 0 ? '没有满足尺寸要求的图片。' : `共加载 ${loadedCount} 张图片。`;
                        progressContainer.style.display = 'none';
                        button.textContent = loadedCount > 0 ? '隐藏图片' : '无大图';
                        validCountForTitle = loadedCount;
                    } else {
                        statusText.textContent = `正在逐步呈现图片... (剩余 ${pendingCount} 张待查，符合要求展示 ${loadedCount} 张)`;
                    }
                };

                const observer = new IntersectionObserver((entries, obs) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const placeholder = entry.target;
                            obs.unobserve(placeholder);

                            const imgSrc = placeholder.dataset.src;
                            const finalSrc = (!imgSrc.startsWith('http') && !imgSrc.startsWith('//')) ? new URL(imgSrc, threadUrl).href : imgSrc;

                            const tempImg = new Image();
                            let isHandled = false;

                            const replaceDom = () => {
                                loadedCount++;
                                const previewImg = document.createElement('img');
                                previewImg.src = finalSrc;
                                previewImg.className = 'preview-img-item';
                                previewImg.style.aspectRatio = `${tempImg.naturalWidth} / ${tempImg.naturalHeight}`;

                                previewImg.addEventListener('click', (evt) => {
                                    evt.stopPropagation();
                                    const allImgs = Array.from(previewContainer.querySelectorAll('.preview-img-item'));
                                    const urls = allImgs.map(img => img.src);
                                    const idx = allImgs.indexOf(previewImg);
                                    openLightbox(urls, idx);
                                });

                                placeholder.replaceWith(previewImg);
                                progressBarFill.style.width = `${80 + 20 * (loadedCount / validSrcList.length)}%`;
                            };

                            const pollDimension = () => {
                                if (isHandled) return;
                                if (tempImg.naturalWidth > 0 && tempImg.naturalHeight > 0) {
                                    isHandled = true;
                                    if (tempImg.naturalWidth >= MIN_DIMENSION && tempImg.naturalHeight >= MIN_DIMENSION) {
                                        replaceDom();
                                    } else {
                                        placeholder.remove();
                                    }
                                    pendingCount--;
                                    updateCountDisplay();
                                } else {
                                    requestAnimationFrame(pollDimension);
                                }
                            };

                            requestAnimationFrame(pollDimension);

                            tempImg.onload = () => {
                                if (!isHandled) {
                                    isHandled = true;
                                    if (tempImg.naturalWidth >= MIN_DIMENSION && tempImg.naturalHeight >= MIN_DIMENSION) replaceDom();
                                    else placeholder.remove();
                                    pendingCount--;
                                    updateCountDisplay();
                                }
                            };

                            tempImg.onerror = () => {
                                if (!isHandled) {
                                    isHandled = true;
                                    placeholder.remove();
                                    pendingCount--;
                                    updateCountDisplay();
                                }
                            };

                            tempImg.src = finalSrc;
                        }
                    });
                }, { root: previewOuter, rootMargin: '400px 0px', threshold: 0.01 });

                validSrcList.forEach(imgSrc => {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'preview-img-loading';
                    placeholder.textContent = '等待呈现...';
                    placeholder.dataset.src = imgSrc;
                    previewContainer.appendChild(placeholder);
                    observer.observe(placeholder);
                });

                progressBarFill.style.width = '80%';
                button.disabled = false;
                button.textContent = '隐藏图片';
                previewContainer.dataset.loaded = "true";
                delete previewContainer.dataset.loading;

                updateThreadData(threadId, { viewedImages: true });
                if (!threadElement.classList.contains('thread--visited')) {
                    threadElement.classList.add('thread--viewed-images');
                }

            } catch (err) {
                console.error('[Discuz Marker] fetch images fail', err);
                statusText.textContent = `获取数据失败: ${err.message}`;
                progressContainer.style.display = 'none';
                button.textContent = '获取失败';
                button.disabled = false;
                delete previewContainer.dataset.loading;
            }
        });
    }

    function addPreviewButtons() {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(addPreviewButtonToThread);
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
                            if (enablePreview) addPreviewButtonToThread(node);
                        }
                    });
                    if (!pendingUpdate) {
                        pendingUpdate = true;
                        setTimeout(() => {
                            markThreadsOnListPage();
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
        recordThreadVisit();

        setTimeout(() => {
            const tid = getThreadIdFromUrl();
            if (tid && !getVisitedThreads()[tid]?.visited) {
                recordThreadVisit();
            }
        }, 3000);
    }
})();