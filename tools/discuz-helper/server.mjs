import http from 'node:http';
import fs from 'node:fs';
import { source } from './harness.mjs';
const titles = [
    '山间来信：沿着山脊走到日落',
    '周末随拍 · 光影与日常',
    '这是一篇没有图片的文字分享',
    '访问权限提示',
    '慢慢加载的风景',
    '分页恢复测试',
];
const rows = () =>
    titles
        .map(
            (t, i) =>
                `<tbody id="normalthread_${i + 1}"><tr><td class="native-icon">${String(i + 1).padStart(2, '0')}</td><th><a class="s xst" href="/thread-${i + 1}-1-1.html">${t}</a><p class="native-meta">山野记录 · 摄影交流 · 今天 16:20</p></th><td class="native-count">${12 + i * 9}<small>回复</small></td></tr></tbody>`,
        )
        .join('');
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    if (u.pathname === '/script.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(
            source().replace(
                '    // --- 初始化流程 ---',
                `    window.fixtureAPI = {PageAdapter, HistoryStore, PreviewController, get controllers(){return controllers}, get history(){return history}, get pageQueue(){return pageQueue}, get imageQueue(){return imageQueue}, get settings(){return settings}, rebuild, refreshMarks};\n    // --- 初始化流程 ---`,
            ),
        );
        return;
    }
    if (u.pathname === '/fixture.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(fs.readFileSync(new URL('./fixture.js', import.meta.url)));
        return;
    }
    if (u.pathname.startsWith('/image/')) {
        const n = Number(u.pathname.split('/')[2]) || 1;
        const h = n % 3 === 0 ? 1400 : 500;
        res.setHeader('Content-Type', 'image/svg+xml');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="${h}" viewBox="0 0 800 500"><rect width="800" height="500" fill="${n % 2 ? '#ddd4ba' : '#c5d4d1'}"/><circle cx="600" cy="120" r="55" fill="#fbf0cb"/><path d="M0 390L220 100 440 360 610 220 800 430V500H0" fill="#80968b"/><path d="M0 500L330 260 600 480 800 350V500" fill="#344f48"/><text x="32" y="465" fill="white" font-size="18">FIELD NOTES / ${n}</text></svg>`;
        setTimeout(() => res.end(svg), u.searchParams.has('slow') ? 2500 : 30);
        return;
    }
    const match = u.pathname.match(/thread-(\d+)-(\d+)/);
    if (match) {
        const id = Number(match[1]),
            page = Number(match[2]);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (id === 4) {
            res.end('<div id="messagetext">您需要登录后才能查看本主题</div>');
            return;
        }
        res.end(
            `<div class="t_f">${id === 3 ? '纯文字帖子' : Array.from({ length: id === 6 ? 2 : 8 }, (_, i) => `<img id="aimg_${i}" file="/image/${page * 10 + i + 1}${id === 5 ? '?slow' : ''}">`).join('')}</div><div class="pg"><a href="/thread-${id}-3-1.html">3</a></div>`,
        );
        return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>山野来信 - 阅读论坛 - Powered by Discuz!</title><style>
    body{margin:0;background:#edf0ec;color:#26342e;font:14px/1.6 'Microsoft YaHei',sans-serif}header{padding:36px max(20px,calc((100% - 1120px)/2));background:#223d34;color:#eef4ec}header h1{font-size:29px;margin:8px 0}header p{opacity:.7}.wp{width:92%;max-width:1120px;margin:24px auto}table{width:100%;border-collapse:collapse;table-layout:auto;background:white}th{text-align:left;font-weight:400;padding:20px 12px}a{color:#253f35;text-decoration:none}.xst{font-size:17px;font-weight:600}.native-meta{font-size:12px;color:#78837e;margin:8px 0 0}.native-icon{width:42px;text-align:center;color:#839188}.native-count{width:54px;text-align:center}.native-count small{display:block;color:#87928b}tbody{border-bottom:1px solid #e9eeea}#fixture-results{white-space:pre-wrap;font:12px/1.6 monospace}.fixture-actions button{margin:5px;padding:8px}@media(max-width:500px){header{padding:20px}.native-icon{width:25px}.native-count{width:30px}.xst{font-size:14px}th{padding:16px 6px}}body:has([data-dh-theme=dark]){background:#1d2522;color:#dae6de}body:has([data-dh-theme=dark]) table{background:#26332c}body:has([data-dh-theme=dark]) .xst{color:#e4ebe6}
    </style><header><small>FIELD NOTES / 摄影与生活</small><h1>山野来信</h1><p>记录行走的片刻，分享看见的世界。</p></header><main class="wp"><div class="fixture-actions"><button id="fixture-settings">打开辅助设置</button><button id="fixture-replace">替换列表</button><button id="fixture-tests">运行交互验证</button></div><table id="threadlisttableid">${rows()}</table><pre id="fixture-results">隔离夹具 · 不使用真实论坛数据</pre></main><script>
    window.fixtureData=new Map();window.fixtureCalls=[];window.fixtureRequests=[];
    window.GM_getValue=(k,d)=>structuredClone(fixtureData.has(k)?fixtureData.get(k):d);window.GM_setValue=(k,v)=>{fixtureCalls.push({type:'set',k});fixtureData.set(k,structuredClone(v));};window.GM_deleteValue=k=>fixtureData.delete(k);window.GM_listValues=()=>[...fixtureData.keys()];window.GM_addStyle=t=>{const s=document.createElement('style');s.textContent=t;document.head.append(s)};window.GM_registerMenuCommand=(n,f)=>window.fixtureSettings=f;
    const nativeFetch=window.fetch;window.fetch=(...a)=>{fixtureRequests.push(String(a[0]));return nativeFetch(...a)};
    document.querySelector('#fixture-settings').onclick=()=>window.fixtureSettings();document.querySelector('#fixture-replace').onclick=()=>{const table=document.querySelector('table');const copy=table.cloneNode(true);copy.querySelectorAll('[data-dh-owned]').forEach(n=>n.remove());copy.querySelectorAll('[data-dh-thread]').forEach(n=>{delete n.dataset.dhThread;n.className=''});table.replaceWith(copy)};
    </script><script src="/script.js"></script><script src="/fixture.js"></script></html>`);
});
server.listen(8767, '127.0.0.1', () =>
    console.log('Discuz 隔离夹具：http://127.0.0.1:8767/forum.php?mod=forumdisplay&fid=1'),
);
