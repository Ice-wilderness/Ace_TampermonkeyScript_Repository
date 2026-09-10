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
        lightboxImage.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 10 }));
        const leftCursor = getComputedStyle(lightboxImage).cursor;
        lightboxImage.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.right - 10 }));
        const rightCursor = getComputedStyle(lightboxImage).cursor;
        check(
            '灯箱左右半区显示不同方向光标',
            leftCursor.includes('w-resize') && rightCursor.includes('e-resize') && leftCursor !== rightCursor,
        );
        lightboxImage.dispatchEvent(new MouseEvent('click', { clientX: rect.right - 10 }));
        await until(() => lightboxImage.alt === '第 2 张图片' && !lightboxImage.hidden);
        check('灯箱右半区点击切到下一张', lightboxImage.alt === '第 2 张图片');
        document.querySelector('.dh-lightbox-top button').click();
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
