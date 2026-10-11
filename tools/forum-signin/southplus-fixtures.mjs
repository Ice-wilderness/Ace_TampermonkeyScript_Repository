// 首页、空进行中列表、已完成表格按 2026-10-11 登录页面提取的结构缩减。
// 有进行中任务的进度为构造样例；不包含账号、Cookie 或真实请求。
export function southPlusPages({ daily = 'available', weekly = 'cooldown', completedAt = '2026-10-09 PM:23:41:56' } = {}) {
    const tasks = [{ id: '14', name: '周常', state: weekly, hours: 158 }, { id: '15', name: '日常', state: daily, hours: 18 }];
    const row = (task, control, detail = '') => `<tr class="f_one"><td><b>${task.name}</b> <font>任务时效2011-12-03~2028-12-31</font></td><td rowspan="2">${control}</td></tr><tr class="f_one"><td>${detail}</td></tr>`;
    const page = (heading, body) => `<a href="login.php?action-quit-verify-fixture.html">退出</a><div id="main">
        <a href="plugin.php?H_name-tasks-actions-newtasks.html.html">进行中任务</a>
        <a href="plugin.php?H_name-tasks-actions-endtasks.html.html">已完成任务</a>
        <table><tbody><tr><td class="h">${heading}</td></tr>${body}</tbody></table></div>`;
    return {
        available: page('社区论坛任务', tasks.map(task => row(task, task.state === 'cooldown' ? `上次领取未超过 ${task.hours} 小时` : task.state === 'unknown' ? '未知状态' : `<span id="p_${task.id}"><a onclick="startjob('${task.id}');" title="按这申请此任务">申请</a></span>`)).join('')),
        active: page('您在进行中任务', tasks.filter(task => ['claimable', 'in-progress'].includes(task.state)).map(task => row(task, '<a title="领取奖励">领取奖励</a>', `<div class="taskbar"><div class="taskbar_text">已完成 ${task.state === 'claimable' ? 100 : 50} %</div></div>`)).join('') || '<tr><td>你无任何进行任务</td></tr>'),
        completed: page('您已完成任务', tasks.map(task => row(task, '<img src="hack/tasks/image/end.png">', `<div class="taskbar"><div class="taskbar_text">已完成 100 %</div></div>完成时间 ${completedAt}`)).join(''))
    };
}

export function southPlusResponses(options) {
    return Object.values(southPlusPages(options)).map(responseText => ({ responseText, responseHeaders: 'Content-Type: text/html; charset=utf-8' }));
}

export const southPlusXml = text => ({ responseText: `<?xml version="1.0" encoding="utf-8"?><ajax><![CDATA[${text}]]></ajax>` });
