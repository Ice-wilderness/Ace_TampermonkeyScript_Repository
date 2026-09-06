import http from 'node:http';
import fs from 'node:fs';
import { instrument } from './harness.mjs';
import { records } from './fixtures.mjs';
const script = new URL('../../scripts/Bilibili视频观看历史记录.js', import.meta.url);
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/script.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(instrument(fs.readFileSync(script, 'utf8'))); }
    else if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(new URL('./fixture.js', import.meta.url))); }
    else if (url.pathname === '/seed.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(records(Math.max(0, Math.min(10000, Number(url.searchParams.get('count')) || 0))))); }
    else if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>观看记录 · 隔离验证</title><style>body{margin:0;padding:24px;background:#e9edf0;font:14px/1.7 'Microsoft YaHei',sans-serif}#fixture-results{white-space:pre-wrap}#native-button{background:#e7d36a;border:3px solid #523f19}</style><h1>观看记录 · 隔离验证</h1><p>本页仅使用合成数据和内存存储，不连接 Bilibili。</p><button id="open-manager">打开管理面板</button> <button id="run-tests">运行交互验证</button> <button id="native-button">站点原生按钮</button><pre id="fixture-results" role="status">正在初始化…</pre><script>
window.fixtureData = new Map(); window.fixtureCalls = []; window.fixtureFault = false;
window.GM_getValue = (k,d) => structuredClone(fixtureData.has(k) ? fixtureData.get(k) : d);
window.GM_setValue = (k,v) => { fixtureCalls.push({type:'set',key:k}); fixtureData.set(k,structuredClone(v)); };
window.GM_listValues = () => { fixtureCalls.push({type:'list'}); return [...fixtureData.keys()]; };
window.GM_deleteValue = k => fixtureData.delete(k);
window.GM = Object.fromEntries(['getValue','setValue','listValues','deleteValue'].map(name => [name, async (...args) => { if(fixtureFault && name==='setValue') throw new Error('合成写入失败'); return window['GM_'+name](...args); }]));
window.GM_addValueChangeListener = () => 1; window.GM_removeValueChangeListener = () => {};
window.GM_addStyle = text => { const style = document.createElement('style'); style.textContent = text; document.head.append(style); };
window.GM_registerMenuCommand = () => {}; window.GM_info = {script:{version:'test'}}; window.unsafeWindow = window;
</script><script src="/script.js"></script><script src="/fixture.js"></script></html>`); }
    else { res.statusCode = 404; res.end('Not found'); }
});
server.listen(8766, '127.0.0.1', () => console.log('隔离验证服务：http://127.0.0.1:8766'));
