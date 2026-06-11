// ==UserScript==
// @name         ChatGPT 图片批量下载器
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  在 ChatGPT 图片页面为图片添加复选框，并通过页面原生保存按钮批量下载。
// @author       Ice_wilderness
// @match        https://chatgpt.com/images*
// @match        https://chat.openai.com/images*
// @run-at       document-idle
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'cgpt-image-batch-panel';
    const CHECKBOX_CLASS = 'cgpt-image-batch-checkbox';
    const HOST_CLASS = 'cgpt-image-batch-host';
    const ITEM_ATTR = 'data-cgpt-image-batch-id';
    const MIN_RENDERED_SIDE = 80;
    const MIN_NATURAL_SIDE = 180;
    const SCAN_DELAY = 250;
    const DOWNLOAD_DELAY = 120;
    const NATIVE_DOWNLOAD_TIMEOUT = 1800;
    const OPEN_SETTLE_DELAY = 180;
    const SAVE_SETTLE_DELAY = 250;
    const VIEWER_CLOSE_DELAY = 220;
    const VIEWER_CLOSE_TIMEOUT = 1400;
    const VIEWER_SWITCH_TIMEOUT = 2200;
    const VIEWER_SWITCH_POLL_DELAY = 100;
    const THUMBNAIL_MAX_SIDE = 180;

    const state = {
        items: new Map(),
        serial: 0,
        scanTimer: 0,
        downloading: false,
        observer: null
    };

    GM_addStyle(`
        #${PANEL_ID} {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 10px;
            max-width: min(520px, calc(100vw - 32px));
            padding: 10px 12px;
            border: 1px solid rgba(0, 0, 0, 0.12);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.96);
            color: #202123;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 14px;
            line-height: 1.4;
            backdrop-filter: blur(10px);
        }

        #${PANEL_ID}[hidden] {
            display: none !important;
        }

        #${PANEL_ID} button {
            min-height: 32px;
            padding: 6px 12px;
            border: 0;
            border-radius: 7px;
            cursor: pointer;
            font: inherit;
            font-weight: 600;
            white-space: nowrap;
        }

        #${PANEL_ID} button[data-action="toggle"] {
            background: #ececf1;
            color: #202123;
        }

        #${PANEL_ID} button[data-action="download"] {
            background: #10a37f;
            color: #fff;
        }

        #${PANEL_ID} button:disabled {
            cursor: not-allowed;
            opacity: 0.55;
        }

        #${PANEL_ID} [data-role="count"] {
            white-space: nowrap;
        }

        #${PANEL_ID} [data-role="status"] {
            min-width: 0;
            max-width: 190px;
            overflow: hidden;
            color: #5f6368;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .${HOST_CLASS} {
            isolation: isolate;
        }

        .${CHECKBOX_CLASS} {
            position: absolute !important;
            top: 8px !important;
            left: 8px !important;
            z-index: 2147483647 !important;
            box-sizing: border-box !important;
            width: 26px !important;
            height: 26px !important;
            margin: 0 !important;
            padding: 0 !important;
            cursor: pointer !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            border: 2px solid #fff !important;
            border-radius: 6px !important;
            background-color: rgba(255, 255, 255, 0.96) !important;
            background-position: center !important;
            background-repeat: no-repeat !important;
            background-size: 18px 18px !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45) !important;
        }

        .${CHECKBOX_CLASS}:checked {
            border-color: #fff !important;
            background-color: #10a37f !important;
            background-image: url("data:image/svg+xml,%3Csvg width='18' height='18' viewBox='0 0 18 18' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M4 9.2 7.3 12.5 14.2 5.5' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
        }

        .${CHECKBOX_CLASS}:focus-visible {
            outline: 3px solid rgba(16, 163, 127, 0.35) !important;
            outline-offset: 2px !important;
        }

        @media (max-width: 640px) {
            #${PANEL_ID} {
                right: 12px;
                bottom: 12px;
                left: 12px;
                justify-content: center;
                flex-wrap: wrap;
            }

            #${PANEL_ID} [data-role="status"] {
                flex-basis: 100%;
                max-width: none;
                text-align: center;
            }
        }

        @media (prefers-color-scheme: dark) {
            #${PANEL_ID} {
                border-color: rgba(255, 255, 255, 0.16);
                background: rgba(33, 33, 33, 0.96);
                color: #ececec;
            }

            #${PANEL_ID} button[data-action="toggle"] {
                background: #3a3a3a;
                color: #ececec;
            }

            #${PANEL_ID} [data-role="status"] {
                color: #c5c5c5;
            }
        }
    `);

    function init() {
        if (!document.body) {
            window.setTimeout(init, 100);
            return;
        }

        createPanel();
        observeDomChanges();
        observeRouteChanges();

        window.addEventListener('scroll', scheduleScan, true);
        window.addEventListener('resize', scheduleScan);
        document.addEventListener('load', (event) => {
            if (event.target instanceof HTMLImageElement) {
                scheduleScan();
            }
        }, true);

        scheduleScan();
    }

    function createPanel() {
        if (document.getElementById(PANEL_ID)) {
            return;
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.hidden = true;

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.dataset.action = 'toggle';
        toggleButton.textContent = '全选';
        toggleButton.addEventListener('click', toggleAllVisibleImages);

        const count = document.createElement('span');
        count.dataset.role = 'count';
        count.textContent = '已选: 0 / 0';

        const downloadButton = document.createElement('button');
        downloadButton.type = 'button';
        downloadButton.dataset.action = 'download';
        downloadButton.textContent = '批量下载';
        downloadButton.addEventListener('click', downloadSelectedImages);

        const status = document.createElement('span');
        status.dataset.role = 'status';
        status.title = '';

        panel.append(toggleButton, count, downloadButton, status);
        document.body.appendChild(panel);
    }

    function observeDomChanges() {
        if (state.observer) {
            return;
        }

        state.observer = new MutationObserver((mutations) => {
            if (state.downloading) {
                return;
            }

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
                    scheduleScan();
                    return;
                }

                if (mutation.type === 'attributes') {
                    scheduleScan();
                    return;
                }
            }
        });

        state.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'href', 'src', 'srcset', 'style']
        });
    }

    function observeRouteChanges() {
        if (history.pushState.__cgptImageBatchWrapped) {
            return;
        }

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function () {
            const result = originalPushState.apply(this, arguments);
            scheduleScan();
            return result;
        };

        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);
            scheduleScan();
            return result;
        };

        history.pushState.__cgptImageBatchWrapped = true;
        history.replaceState.__cgptImageBatchWrapped = true;
        window.addEventListener('popstate', scheduleScan);
    }

    function scheduleScan() {
        if (state.downloading) {
            return;
        }

        window.clearTimeout(state.scanTimer);
        state.scanTimer = window.setTimeout(scanImages, SCAN_DELAY);
    }

    function scanImages() {
        if (state.downloading) {
            return;
        }

        if (!isImagesRoute()) {
            clearInjectedItems();
            updatePanel();
            return;
        }

        const root = getScanRoot();
        const images = Array.from(root.querySelectorAll('img'));

        for (const img of images) {
            if (isCandidateImage(img)) {
                injectCheckbox(img);
            }
        }

        pruneMissingItems();
        updatePanel();
    }

    function isImagesRoute() {
        return /^\/images(?:\/|$)/.test(location.pathname);
    }

    function getScanRoot() {
        const main = document.querySelector('main') || document.body;

        if (isImagesRoute()) {
            const ownImagesHeading = findOwnImagesHeading(main);
            if (ownImagesHeading) {
                const scopedRoot = ownImagesHeading.closest('section') || ownImagesHeading.parentElement || main;
                return scopedRoot.querySelector('img') ? scopedRoot : main;
            }
        }

        return main;
    }

    function findOwnImagesHeading(root) {
        const isOwnImagesText = (element) => {
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            return /^(我的图片|我的图像|我的作品|My images|Your images)$/i.test(text);
        };
        const semanticHeadings = Array.from(root.querySelectorAll('h1, h2, h3, h4, [role="heading"]'));
        const semanticMatch = semanticHeadings.find(isOwnImagesText);

        if (semanticMatch) {
            return semanticMatch;
        }

        return Array.from(root.querySelectorAll('div, span')).find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && element.children.length <= 2 && isOwnImagesText(element);
        });
    }

    function isCandidateImage(img) {
        if (!(img instanceof HTMLImageElement)) {
            return false;
        }

        if (img.hasAttribute(ITEM_ATTR) && state.items.has(img.getAttribute(ITEM_ATTR))) {
            return false;
        }

        if (img.closest(`#${PANEL_ID}, nav, header, footer, [role="navigation"]`)) {
            return false;
        }

        if (!isElementVisible(img)) {
            return false;
        }

        const rect = img.getBoundingClientRect();
        const renderedSide = Math.max(rect.width, rect.height);
        const naturalSide = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);

        if (renderedSide < MIN_RENDERED_SIDE && naturalSide < MIN_NATURAL_SIDE) {
            return false;
        }

        if (Math.min(rect.width, rect.height) < 48 && Math.min(img.naturalWidth || 0, img.naturalHeight || 0) < 120) {
            return false;
        }

        const sourceText = [
            img.currentSrc,
            img.src,
            img.getAttribute('srcset'),
            img.getAttribute('alt')
        ].filter(Boolean).join(' ');

        if (isLikelyIconText(sourceText) && renderedSide < 160) {
            return false;
        }

        return true;
    }

    function isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    }

    function isLikelyIconText(text) {
        return /avatar|profile|icon|logo|favicon|sprite|placeholder/i.test(text || '');
    }

    function injectCheckbox(img) {
        const existingId = img.getAttribute(ITEM_ATTR);
        if (existingId && state.items.has(existingId)) {
            return;
        }

        const host = findOverlayHost(img);
        if (!host) {
            return;
        }

        const id = `cgpt-image-batch-${++state.serial}`;
        const checkbox = document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.className = CHECKBOX_CLASS;
        checkbox.title = '选择这张图片';
        checkbox.setAttribute('aria-label', '选择这张图片用于批量下载');
        checkbox.dataset.targetImageId = id;

        for (const eventName of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
            checkbox.addEventListener(eventName, stopImageOpenEvent, true);
        }

        checkbox.addEventListener('change', updatePanel);

        prepareHost(host);
        img.setAttribute(ITEM_ATTR, id);
        host.appendChild(checkbox);

        state.items.set(id, {
            id,
            img,
            host,
            checkbox
        });
    }

    function stopImageOpenEvent(event) {
        event.stopPropagation();
    }

    function findOverlayHost(img) {
        const picture = img.closest('picture');
        let host = img.closest('a[href], button, [role="button"], figure, article, li') || picture || img.parentElement;

        if (host && host.tagName && host.tagName.toLowerCase() === 'picture') {
            host = host.parentElement;
        }

        if (!host) {
            return null;
        }

        const imgRect = img.getBoundingClientRect();
        let current = host;

        while (current.parentElement && current.parentElement !== document.body) {
            const currentRect = current.getBoundingClientRect();
            const parentRect = current.parentElement.getBoundingClientRect();
            const currentTooSmall = currentRect.width < imgRect.width * 0.8 || currentRect.height < imgRect.height * 0.8;
            const parentStillCardSized = parentRect.width <= imgRect.width * 2.2 && parentRect.height <= imgRect.height * 2.2;

            if (!currentTooSmall && !parentStillCardSized) {
                break;
            }

            if (parentStillCardSized) {
                current = current.parentElement;
                continue;
            }

            break;
        }

        return current;
    }

    function prepareHost(host) {
        host.classList.add(HOST_CLASS);

        const style = window.getComputedStyle(host);
        if (style.position === 'static') {
            host.style.position = 'relative';
        }

        if (style.display === 'inline') {
            host.style.display = 'inline-block';
        }
    }

    function pruneMissingItems() {
        for (const [id, item] of state.items) {
            if (!item.img.isConnected || !item.checkbox.isConnected) {
                item.img.removeAttribute(ITEM_ATTR);
                item.checkbox.remove();
                state.items.delete(id);
            }
        }
    }

    function clearInjectedItems() {
        for (const item of state.items.values()) {
            if (item.img.isConnected) {
                item.img.removeAttribute(ITEM_ATTR);
            }

            if (item.checkbox.isConnected) {
                item.checkbox.remove();
            }

            if (item.host && item.host.isConnected) {
                item.host.classList.remove(HOST_CLASS);
            }
        }

        state.items.clear();
    }

    function getVisibleItems() {
        pruneMissingItems();
        return Array.from(state.items.values()).filter((item) => isElementVisible(item.img));
    }

    function updatePanel() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) {
            return;
        }

        const items = getVisibleItems();
        const selectedCount = items.filter((item) => item.checkbox.checked).length;
        const totalCount = items.length;
        const toggleButton = panel.querySelector('[data-action="toggle"]');
        const downloadButton = panel.querySelector('[data-action="download"]');
        const count = panel.querySelector('[data-role="count"]');

        panel.hidden = totalCount === 0;
        count.textContent = `已选: ${selectedCount} / ${totalCount}`;
        toggleButton.textContent = selectedCount === totalCount && totalCount > 0 ? '取消全选' : '全选';
        toggleButton.disabled = state.downloading || totalCount === 0;
        downloadButton.disabled = state.downloading || selectedCount === 0;
    }

    function setStatus(message) {
        const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
        if (!status) {
            return;
        }

        status.textContent = message || '';
        status.title = message || '';
    }

    function toggleAllVisibleImages() {
        const items = getVisibleItems();
        const shouldCheck = !items.length || items.some((item) => !item.checkbox.checked);

        for (const item of items) {
            item.checkbox.checked = shouldCheck;
        }

        updatePanel();
    }

    async function downloadSelectedImages() {
        if (!isImagesRoute()) {
            window.alert('请在 ChatGPT 图片页面使用批量下载。');
            return;
        }

        const selectedItems = getVisibleItems().filter((item) => item.checkbox.checked);

        if (!selectedItems.length) {
            window.alert('请先勾选需要下载的图片。');
            return;
        }

        state.downloading = true;
        updatePanel();
        setStatus('准备下载...');

        const failures = [];
        const failedItemIds = new Set();
        let nativeTriggered = 0;
        let thumbnailTriggered = 0;

        try {
            for (let index = 0; index < selectedItems.length; index += 1) {
                const item = selectedItems[index];
                const displayIndex = index + 1;

                setStatus(`页面下载 ${displayIndex}/${selectedItems.length}`);

                try {
                    const result = await triggerNativeDownload(item);
                    nativeTriggered++;
                    if (result && result.usedThumbnail) {
                        thumbnailTriggered++;
                    }
                } catch (error) {
                    failedItemIds.add(item.id);
                    failures.push({
                        index: displayIndex,
                        reason: '页面下载按钮触发失败',
                        nativeFallback: error && error.message ? error.message : String(error)
                    });
                }

                await delay(DOWNLOAD_DELAY);
            }
        } finally {
            state.downloading = false;
            updatePanel();
            scheduleScan();
        }

        if (failures.length) {
            for (const item of selectedItems) {
                if (item.checkbox.isConnected) {
                    item.checkbox.checked = failedItemIds.has(item.id);
                }
            }
            updatePanel();
            console.warn('[ChatGPT 图片批量下载器] 部分图片下载失败。脚本当前只使用 ChatGPT 页面原生保存/下载按钮。', failures);
            setStatus(`完成，失败 ${failures.length} 张，已保留失败项`);
            window.alert(`已完成，失败 ${failures.length} 张。已自动取消成功图片勾选，仅保留失败图片，可直接再次点击批量下载。失败原因已输出到控制台。`);
        } else {
            setStatus(thumbnailTriggered ? `完成 ${selectedItems.length} 张，缩略图切换 ${thumbnailTriggered} 张` : (nativeTriggered ? `完成 ${selectedItems.length} 张，页面触发 ${nativeTriggered} 张` : `完成 ${selectedItems.length} 张`));
        }
    }

    async function triggerNativeDownload(item) {
        const targetFileIds = getFileIdsFromImage(item.img);
        const viewerAlreadyOpen = Boolean(findNativeDownloadButton());

        if (!viewerAlreadyOpen) {
            item.img.scrollIntoView({
                block: 'center',
                inline: 'center'
            });
            await delay(OPEN_SETTLE_DELAY);
        }

        let { targetReady, downloadButton, usedThumbnail } = await openTargetImageForDownload(item, targetFileIds);

        if ((!targetReady || !downloadButton) && findNativeDownloadButton()) {
            await closeNativeViewerIfPossible();
            item.img.scrollIntoView({
                block: 'center',
                inline: 'center'
            });
            await delay(OPEN_SETTLE_DELAY);
            ({ targetReady, downloadButton, usedThumbnail } = await openTargetImageForDownload(item, targetFileIds));
        }

        if (!targetReady && targetFileIds.length) {
            throw new Error('未确认详情页已切换到目标图片，已跳过以避免重复下载当前图片');
        }

        if (!downloadButton) {
            downloadButton = await waitForNativeDownloadButton(NATIVE_DOWNLOAD_TIMEOUT);
        }

        if (!downloadButton) {
            throw new Error('未找到 ChatGPT 页面原生下载按钮');
        }

        clickElement(downloadButton);
        await delay(SAVE_SETTLE_DELAY);

        if (!hasVisibleThumbnailStrip()) {
            await closeNativeViewerIfPossible();
        }

        return {
            usedThumbnail
        };
    }

    async function openTargetImageForDownload(item, targetFileIds) {
        let usedThumbnail = false;
        let targetReady = isActiveViewerAtFileIds(targetFileIds);
        let downloadButton = targetReady ? findNativeDownloadButton() : null;
        const viewerOpen = Boolean(findNativeDownloadButton());

        if ((!targetReady || !downloadButton) && viewerOpen && targetFileIds.length) {
            const thumbnail = findThumbnailForTargetFileIds(targetFileIds);
            if (!thumbnail) {
                return {
                    targetReady: false,
                    downloadButton: null,
                    usedThumbnail
                };
            }

            usedThumbnail = true;
            targetReady = await clickAndWaitForTargetImage(thumbnail, targetFileIds);
            downloadButton = targetReady ? findNativeDownloadButton() : null;
        }

        if (targetReady && downloadButton) {
            return {
                targetReady,
                downloadButton,
                usedThumbnail
            };
        }

        if (viewerOpen) {
            return {
                targetReady,
                downloadButton,
                usedThumbnail
            };
        }

        targetReady = await clickAndWaitForTargetImage(item.img, targetFileIds);
        downloadButton = targetReady ? findNativeDownloadButton() : null;

        if ((!targetReady || !downloadButton) && item.host && item.host !== item.img) {
            targetReady = await clickAndWaitForTargetImage(item.host, targetFileIds);
            downloadButton = targetReady ? findNativeDownloadButton() : null;
        }

        if (!targetReady || !downloadButton) {
            const openButton = findCardOpenButton(item.host);
            if (openButton) {
                targetReady = await clickAndWaitForTargetImage(openButton, targetFileIds);
                downloadButton = targetReady ? findNativeDownloadButton() : null;
            }
        }

        return {
            targetReady,
            downloadButton,
            usedThumbnail
        };
    }

    async function clickAndWaitForTargetImage(element, targetFileIds) {
        clickElement(element);

        if (!targetFileIds.length) {
            await delay(OPEN_SETTLE_DELAY);
            return true;
        }

        return waitForActiveImageFileIds(targetFileIds, VIEWER_SWITCH_TIMEOUT);
    }

    async function waitForActiveImageFileIds(targetFileIds, timeoutMs) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const activeImage = findActiveViewerImage();
            if (activeImage && hasAnyFileId(activeImage, targetFileIds)) {
                return true;
            }

            await delay(VIEWER_SWITCH_POLL_DELAY);
        }

        return false;
    }

    function isActiveViewerAtFileIds(targetFileIds) {
        if (!targetFileIds.length) {
            return false;
        }

        const activeImage = findActiveViewerImage();
        return Boolean(activeImage && hasAnyFileId(activeImage, targetFileIds));
    }

    function findActiveViewerImage() {
        return Array.from(document.images)
            .filter((img) => !img.closest(`#${PANEL_ID}`) && isElementVisible(img))
            .map((img) => ({
                img,
                rect: img.getBoundingClientRect()
            }))
            .filter((entry) => entry.rect.width >= MIN_RENDERED_SIDE && entry.rect.height >= MIN_RENDERED_SIDE)
            .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.img || null;
    }

    function findThumbnailForTargetFileIds(targetFileIds) {
        if (!targetFileIds.length) {
            return null;
        }

        return getThumbnailButtons().find((button) => hasAnyFileIdInElement(button, targetFileIds)) || null;
    }

    function hasVisibleThumbnailStrip() {
        return getThumbnailButtons().length >= 2;
    }

    function getThumbnailButtons() {
        return Array.from(document.querySelectorAll('button[aria-label]'))
            .filter((button) => /^图片\s*\d+（共\s*\d+\s*张）/.test(button.getAttribute('aria-label') || ''))
            .filter((button) => !button.closest(`#${PANEL_ID}`) && isElementVisible(button))
            .map((button) => ({
                button,
                rect: button.getBoundingClientRect()
            }))
            .filter((entry) => entry.rect.width >= 20 && entry.rect.height >= 20)
            .filter((entry) => {
                const maxSide = Math.max(entry.rect.width, entry.rect.height);
                return maxSide <= THUMBNAIL_MAX_SIDE;
            })
            .sort((a, b) => (a.rect.left - b.rect.left) || (a.rect.top - b.rect.top))
            .map((entry) => entry.button);
    }

    function hasAnyFileId(img, fileIds) {
        const imageFileIds = getFileIdsFromImage(img);
        return fileIds.some((fileId) => imageFileIds.includes(fileId));
    }

    function hasAnyFileIdInElement(element, fileIds) {
        const elementFileIds = getFileIdsFromElement(element);
        return fileIds.some((fileId) => elementFileIds.includes(fileId));
    }

    function getFileIdsFromElement(element) {
        const ids = new Set();

        if (element instanceof HTMLImageElement) {
            for (const fileId of getFileIdsFromImage(element)) {
                ids.add(fileId);
            }
        }

        if (element && typeof element.querySelectorAll === 'function') {
            for (const img of element.querySelectorAll('img')) {
                for (const fileId of getFileIdsFromImage(img)) {
                    ids.add(fileId);
                }
            }
        }

        return Array.from(ids);
    }

    function getFileIdsFromImage(img) {
        const ids = new Set();

        for (const value of [
            img.currentSrc,
            img.src,
            img.getAttribute('srcset')
        ]) {
            for (const match of String(value || '').matchAll(/file_[a-z0-9]+/ig)) {
                ids.add(match[0].toLowerCase());
            }
        }

        return Array.from(ids);
    }

    async function waitForNativeDownloadButton(timeoutMs) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const button = findNativeDownloadButton();
            if (button) {
                return button;
            }

            await delay(150);
        }

        return null;
    }

    function findNativeDownloadButton() {
        const elements = Array.from(document.querySelectorAll('button, a[href], [role="button"]'));

        return elements.find((element) => {
            if (element.closest(`#${PANEL_ID}`) || !isElementVisible(element)) {
                return false;
            }

            const label = getElementActionText(element);
            if (/下载应用|download app|批量下载/i.test(label)) {
                return false;
            }

            if (/下载|download|保存|save/i.test(label)) {
                return true;
            }

            return false;
        });
    }

    function findCardOpenButton(host) {
        if (!host) {
            return null;
        }

        return Array.from(host.querySelectorAll('button, a[href], [role="button"]')).find((element) => {
            if (element.closest(`#${PANEL_ID}`) || element.classList.contains(CHECKBOX_CLASS) || !isElementVisible(element)) {
                return false;
            }

            return /编辑|edit|打开|open|查看|view/i.test(getElementActionText(element));
        }) || null;
    }

    async function closeNativeViewerIfPossible() {
        const closeButton = findNativeCloseButton();

        if (closeButton) {
            clickElement(closeButton);
        } else {
            dispatchEscapeKey();
        }

        await waitForNativeDownloadButtonToDisappear(VIEWER_CLOSE_TIMEOUT);
        await delay(VIEWER_CLOSE_DELAY);
    }

    function findNativeCloseButton() {
        return Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
            if (element.closest(`#${PANEL_ID}`) || !isElementVisible(element)) {
                return false;
            }

            const label = getElementActionText(element);
            return /关闭|close/i.test(label) && !/边栏|侧边栏|sidebar/i.test(label);
        }) || null;
    }

    async function waitForNativeDownloadButtonToDisappear(timeoutMs) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            if (!findNativeDownloadButton()) {
                return true;
            }

            await delay(VIEWER_SWITCH_POLL_DELAY);
        }

        return false;
    }

    function dispatchEscapeKey() {
        const eventInit = {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true
        };

        for (const target of [document.activeElement, document, window]) {
            if (!target || typeof target.dispatchEvent !== 'function') {
                continue;
            }

            target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        }
    }

    function getElementActionText(element) {
        return [
            element.getAttribute('aria-label'),
            element.getAttribute('aria-labelledby') ? getTextByIds(element.getAttribute('aria-labelledby')) : null,
            element.getAttribute('title'),
            element.getAttribute('download'),
            element.getAttribute('data-testid'),
            element.getAttribute('data-test-id'),
            element.querySelector('svg title') && element.querySelector('svg title').textContent,
            element.textContent
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function getTextByIds(ids) {
        return String(ids || '')
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((element) => element.textContent || '')
            .join(' ');
    }

    function clickElement(element) {
        for (const eventName of ['mouseover', 'mousedown', 'mouseup']) {
            try {
                element.dispatchEvent(new MouseEvent(eventName, {
                    bubbles: true,
                    cancelable: true,
                    composed: true
                }));
            } catch (error) {
                element.dispatchEvent(new Event(eventName, {
                    bubbles: true,
                    cancelable: true,
                    composed: true
                }));
            }
        }

        try {
            element.click();
        } catch (error) {
            console.warn('[ChatGPT 图片批量下载器] element.click() 失败:', error);
        }
    }

    function delay(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    init();
})();
