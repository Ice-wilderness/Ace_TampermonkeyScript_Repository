document.querySelector('#fixture-tests').onclick = async () => {
    const out = document.querySelector('#fixture-results'),
        api = window.fixtureAPI,
        results = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (predicate) => {
        for (let i = 0; i < 100; i++) {
            if (predicate()) return;
            await sleep(50);
        }
        throw new Error('等待状态超时');
    };
    const check = (name, condition) => {
        results.push(`${condition ? '通过' : '失败'} · ${name}`);
        if (!condition) throw new Error(name);
    };
    try {
        await until(() => [...api.controllers.values()][0]?.count() === 5);
        check('六个帖子各有一套操作区', document.querySelectorAll('.dh-tools').length === 6);
        check('自动预览没有写看图记录', Object.keys(api.history.all()).length === 0);
        const first = [...api.controllers.values()][0];
        await first.togglePreview();
        await first.togglePreview();
        check('收起再展开不记录看图', api.history.read('1').viewedImages?.value !== true);
        const previewCellStyle = getComputedStyle(first.row.firstElementChild);
        check(
            '预览面板上下留白一致',
            previewCellStyle.paddingTop === previewCellStyle.paddingBottom &&
                parseFloat(previewCellStyle.paddingTop) > 0,
        );
        [...first.images.values()].find((i) => i.status === 'ready').card.click();
        await until(() => document.querySelector('.dh-lightbox-stage > img:not([hidden])'));
        check('灯箱成功显示才记录看图', api.history.read('1').viewedImages?.value === true);
        check(
            '看图标记有明确文字与底色',
            first.badge.textContent.includes('已看图') &&
                getComputedStyle(first.badge).backgroundColor !== 'rgba(0, 0, 0, 0)',
        );

        const lightboxImage = document.querySelector('.dh-lightbox-stage > img');
        const rect = lightboxImage.getBoundingClientRect();
        const overlay = document.querySelector('.dh-lightbox');
        const clickImage = () =>
            lightboxImage.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
            }));
        const wheel = (deltaY, target = overlay) =>
            target.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
            }));
        clickImage();
        check(
            '点击图片放大且不翻页或关闭',
            lightboxImage.getBoundingClientRect().width > rect.width &&
                lightboxImage.alt === '第 1 张图片' &&
                overlay.isConnected,
        );
        const zoomWidth = lightboxImage.getBoundingClientRect().width;
        wheel(120);
        check(
            '放大后滚轮缩小且不翻页',
            lightboxImage.getBoundingClientRect().width < zoomWidth && lightboxImage.alt === '第 1 张图片',
        );
        for (let i = 0; i < 30; i++) wheel(-120);
        check(
            '缩放上限为适应尺寸的八倍',
            Math.abs(lightboxImage.getBoundingClientRect().width / rect.width - 8) < 0.01,
        );
        clickImage();
        check('再次点击还原适应窗口', Math.abs(lightboxImage.getBoundingClientRect().width - rect.width) < 1);
        // 缩放手势尚未结束，残余滚轮不能立即变成翻页。
        wheel(120);
        check('缩放手势残余滚动不会翻页', lightboxImage.alt === '第 1 张图片' && !lightboxImage.hidden);
        await sleep(220);
        wheel(120);
        await until(() => lightboxImage.alt === '第 2 张图片' && !lightboxImage.hidden);
        check('任意位置向下滚轮切到下一张', lightboxImage.alt === '第 2 张图片');
        wheel(60);
        wheel(30);
        await sleep(70);
        check('同一串惯性不会连续翻页', lightboxImage.alt === '第 2 张图片' && !lightboxImage.hidden);
        await sleep(220);
        wheel(-120, document.querySelector('.dh-lightbox-top button'));
        await until(() => lightboxImage.alt === '第 1 张图片' && !lightboxImage.hidden);
        check('按钮上方滚轮也能返回上一张', lightboxImage.alt === '第 1 张图片');
        clickImage();
        overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await until(() => lightboxImage.alt === '第 2 张图片' && !lightboxImage.hidden);
        check('方向键翻页重置缩放', getComputedStyle(lightboxImage).cursor === 'zoom-in');
        const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        lightboxImage.dispatchEvent(contextMenu);
        check('图片右键菜单没有被取消且灯箱保持打开', !contextMenu.defaultPrevented && overlay.isConnected);
        const middleDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
        overlay.dispatchEvent(middleDown);
        check('中键按下阻止浏览器自动滚动', middleDown.defaultPrevented && overlay.isConnected);
        lightboxImage.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
        check(
            '中键在图片上关闭灯箱并恢复焦点',
            !overlay.isConnected && document.activeElement.classList.contains('dh-card'),
        );
        [...first.images.values()].find((i) => i.status === 'ready').card.click();
        await until(() => document.querySelector('.dh-lightbox-stage > img:not([hidden])'));
        const blankOverlay = document.querySelector('.dh-lightbox'),
            navRect = blankOverlay.querySelector('.dh-lightbox-next').getBoundingClientRect();
        check('翻页按钮点击区域至少为 56 × 96 像素', navRect.width >= 56 && navRect.height >= 96);
        blankOverlay.querySelector('.dh-lightbox-stage').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        check('点击图片外的舞台空白关闭灯箱', !blankOverlay.isConnected);
        first.intent = null;
        api.history.reset('1', 'viewedImages');
        first.maybeMark();
        check('清除后旧结果不重新标记', api.history.read('1').viewedImages?.value === false);
        const cols = first.row.firstElementChild.colSpan;
        check('预览独立行覆盖原表格列', cols === 3 && first.row.parentElement === first.thread);
        const before = document.querySelector('table').cloneNode(true);
        before.querySelectorAll('[data-dh-owned]').forEach((node) => node.remove());
        const old = [...api.controllers.values()];
        document.querySelector('#fixture-replace').click();
        await until(() => old.every((c) => c.disposed));
        check(
            '列表替换后旧控制器已销毁',
            old.every((c) => c.disposed && c.abort.signal.aborted),
        );
        check('替换后无重复控件', document.querySelectorAll('.dh-tools').length === 6);
        const c = [...api.controllers.values()][0];
        c.thread.id = 'normalthread_101';
        c.title.href = '/thread-101-1-1.html';
        await until(() => c.disposed);
        check('复用节点重建身份', c.disposed && api.controllers.get(c.thread)?.tid === '101');
        const snapshot = api.history.export(true);
        api.history.write('200', 'visited', true);
        check('导出实时读取', !snapshot['200'] && api.history.export(true)['200'].visited);
        const unsafe = document.createElement('tbody');
        unsafe.id = 'normalthread_999';
        unsafe.innerHTML = '<tr><th rowspan="2"><a class="xst" href="/thread-999-1-1.html">非标准主题</a></th></tr>';
        document.querySelector('table').append(unsafe);
        await until(() => api.controllers.has(unsafe));
        check('非标准行安全降级', !api.controllers.get(unsafe).safe);
        unsafe.remove();
        await until(() => !api.controllers.has(unsafe));
        check('移除节点回收资源', !api.controllers.has(unsafe));
        api.history.write('101', 'visited', true);
        api.refreshMarks();
        const visitedThread = document.querySelector('#normalthread_101');
        document.querySelector('.dh-visibility-toggle').click();
        await sleep(20);
        check('非隐藏样式也能临时隐藏已访问帖子', getComputedStyle(visitedThread).display === 'none');
        document.querySelector('.dh-visibility-toggle').click();
        await sleep(20);
        check(
            '再次点击恢复显示且保留访问记录',
            getComputedStyle(visitedThread).display !== 'none' && api.history.read('101').visited.value === true,
        );
        document.querySelector('.dh-floating').click();
        await until(() => document.querySelector('.dh-dialog'));
        const exampleToggle = [...document.querySelectorAll('.dh-dialog button')].find(
            (node) => node.textContent === '预览效果',
        );
        exampleToggle.click();
        await sleep(20);
        check(
            '主题示例可展开',
            exampleToggle.getAttribute('aria-expanded') === 'true' && exampleToggle.nextElementSibling.hidden === false,
        );
        exampleToggle.click();
        await sleep(20);
        check(
            '主题示例可收起',
            exampleToggle.getAttribute('aria-expanded') === 'false' && exampleToggle.nextElementSibling.hidden === true,
        );
        [...document.querySelectorAll('.dh-dialog button')].find((node) => node.textContent === '关闭').click();
        document.querySelector('table').replaceWith(before);
        await sleep(100);
        out.textContent = results.join('\n') + '\n交互验证完成';
    } catch (error) {
        out.textContent = results.join('\n') + '\n失败：' + error.message;
    }
};
