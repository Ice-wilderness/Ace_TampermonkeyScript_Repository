# Findings & Decisions

## Requirements

- 当前仓库是多个独立维护的油猴 / 用户脚本集合。
- 本任务目标不是修改某个脚本功能，而是为开发过程建立测试和诊断体系。
- 首个样板脚本为 `scripts/Bilibili视频观看历史记录.js`。
- 用户希望减少手动复制到油猴、人工测试、手动保存 HTML 后再交给 Codex 分析的流程。
- 用户选择完整测试体系：免复制调试、真实网页自动化采集、离线 fixture 回归。
- 用户接受新增 Node/Playwright 开发依赖。
- 用户允许使用专用浏览器 profile 保存 B 站登录态。

## Research Findings

- 仓库当前没有 `package.json`、Playwright 配置或现成测试工程。
- `scripts/Bilibili视频观看历史记录.js` 是大型单文件 userscript，当前版本为 `3.2.2`。
- 该脚本使用 `@run-at document-start`，并匹配 B 站视频页、首页、动态页、空间页、历史页、稍后再看、搜索页、合集和列表页。
- 该脚本使用的 GM API 包括 `GM_setValue`、`GM_getValue`、`GM_deleteValue`、`GM_listValues`、`GM_addStyle`、`GM_registerMenuCommand`、`GM_info` 和 `unsafeWindow`。
- 该脚本依赖 `MutationObserver`、SPA URL 变化监听、视频元素事件、`localStorage` 和 `sessionStorage`。
- Tampermonkey 支持通过外部编辑器方案保留 userscript header，并用 `@require file://...` 加载本地脚本文件。
- Playwright 支持持久化浏览器上下文，可保存 cookies、localStorage 等会话状态。
- Playwright 支持 Chrome/Chromium 扩展测试，但扩展需要 persistent context，且 Chrome/Edge 对 side-load extension 有限制，推荐使用 Playwright bundled Chromium。
- Playwright trace viewer 可记录截图、DOM snapshot、console 和网络信息，适合失败诊断。
- Chrome `chrome.userScripts` API 可注册用户脚本，但它是扩展开发接口，不等同于 Tampermonkey 的完整 GM API 环境。
- Violentmonkey 文档提醒 SPA 软跳转不会天然重新注入 userscript，需要脚本主动监听 URL 或 DOM 变化。
- 本机可用 Node.js `v24.15.0` 和 npm `11.12.1`。
- 仓库根目录当前没有 `.gitignore`、`package.json`、`package-lock.json` 或 `playwright.config.*`。
- Bilibili 脚本启动时在 `DOMContentLoaded` 后创建 `AppController`；`AppController.startDomPhase()` 会创建 `DOMWatcher`、初始化视频页观察、显示快捷入口并劫持 SPA 路由。
- 视频页记录由 `VideoPlayerObserver` 创建：进入视频页会保存已访问记录，绑定视频元素后根据 play/timeupdate/pause 保存观看进度。
- 列表标记由 `DOMWatcher` 完成：通过 `IntersectionObserver`、`MutationObserver` 和队列处理视频链接/播放列表项，再按 GM 存储记录注入 `.bvh-*` 标签。
- Userscript `@match` 中存在 `https://www.bilibili.com` 这种无路径写法，runner 需要兼容并匹配浏览器规范化后的 `https://www.bilibili.com/`。
- Userscript `@match` glob 的 `*` 必须转换为正则 `.*`；否则 `/video/*` 会无法匹配真实视频页 URL。
- 当前环境可下载 Playwright Ubuntu 24.04 fallback Chromium，但运行时缺少系统库 `libnspr4.so`。
- `npx playwright install-deps chromium` 需要 sudo 交互认证，当前会话无法完成系统依赖安装。
- 用户脚本源码已统一移动到 `scripts/`；根目录不再直接放置 `.js` userscript。
- README 和 CHANGELOG 的脚本文件链接已同步到 `./scripts/...`。
- Bilibili Playwright 工具和测试已改为读取 `scripts/Bilibili视频观看历史记录.js`。
- 在默认命令沙箱中直接启动 Chromium 会触发 `sandbox_host_linux.cc ... Operation not permitted`；用提升权限运行 Playwright 命令后可正常启动。
- `npm run test:fixture:bilibili` 已通过：3 个离线 fixture 测试覆盖列表标记、菜单面板和视频进度保存。
- `npm run test:e2e:bilibili` 已通过：真实 B 站首页 smoke 能打开页面并注册脚本菜单。
- `HEADLESS=1 CAPTURE_WAIT_MS=2000 npm run capture:bilibili -- https://www.bilibili.com/` 已通过，产物包含 `screenshot.png`、`page.html`、`console.json`、`page-errors.json`、`userscript-state.json`、`trace.zip` 和 `summary.json`。
- capture 中 `page-errors.json` 为空，console 只有 log/info；`userscript-state.json` 显示 GM 存储初始化成功并注册 4 个菜单命令。
- `debug:bilibili` 需要和 `capture:bilibili` 产出一致格式，方便 AI 使用同一排障流程读取 artifacts。
- 人工复现场景默认保存到 `artifacts/debug-sessions/<timestamp>/`，自动指定 URL 采集仍保存到 `artifacts/captures/<timestamp>/`。
- `debug:bilibili` 已验证可在按 Enter 后保存 `screenshot.png`、`page.html`、`console.json`、`page-errors.json`、`userscript-state.json`、`trace.zip` 和 `summary.json`。
- debug snapshot 验证中 `page-errors.json` 为空，GM store 初始化成功并注册 4 个菜单命令。
- 用户反馈真实浏览器切换标签页可自动刷新状态标签，但 Playwright runner 环境不能刷新；原因是 GM shim 曾把持久 store 读入页面内存后不再主动刷新。
- 已将 `GM_getValue`、`GM_setValue`、`GM_deleteValue`、`GM_listValues` 和 `__userscriptGetGMStore` 改为读写前同步持久 store。
- 新增 fixture 覆盖同域多页面同步：第二个页面写入 `bvh_shard_32` 和 `bvh_storage_revision=99` 后，第一个页面触发 `visibilitychange` 能刷新标签到 `已观看88%`。
- 该修复覆盖同源/同域页面；跨子域的 GM 存储同步仍不能完全模拟 Tampermonkey 扩展级共享存储。

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| 第一阶段先搭自建 userscript runner + GM shim | 比直接控制 Tampermonkey 内部状态更可控，便于 Codex 自动保存 HTML、日志和存储快照。 |
| Tampermonkey loader 用作日常手动真环境验证 | 最接近真实用户脚本管理器行为，也能消除复制粘贴。 |
| Playwright 真站测试使用专用 profile | 既保留 B 站登录态，又避免影响日常浏览器。 |
| 离线 fixture 和真站 E2E 分层 | 真站测试容易受网络、登录态和 B 站 DOM 变化影响；fixture 更适合回归。 |
| artifacts 默认不入库 | 截图、HTML、trace 和 profile 可能包含登录态或个人信息，必须加入 `.gitignore`。 |
| Node 工程使用 CommonJS | 仓库当前是纯 `.js` userscript 集合，CommonJS 脚本足够且能减少配置成本。 |
| 首版 fixture 使用可加载真实脚本的 HTML 页面 | 不拆分生产脚本源码，降低对现有单文件结构的侵入。 |
| package-lock 正常入库 | 测试工程依赖需要可复现安装，`package-lock.json` 不应被 `.gitignore` 忽略。 |
| 根目录脚本迁移到 `scripts/` | 保留多脚本独立维护方式，同时让根目录只承载文档、配置、测试和 planning 文件。 |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| 当前还没有 planning 文件 | 已创建本次任务专用 `task_plan.md`、`findings.md`、`progress.md`。 |
| Playwright 浏览器依赖无法在当前会话完整安装 | 已下载 fallback Chromium，但系统库安装需要 sudo；用户可在终端执行 `npm run install:playwright-deps` 或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已有浏览器。 |
| 默认命令沙箱无法启动 Chromium | 对 Playwright 浏览器启动命令使用提升权限；用户本机 WSL 终端直接运行不应受该沙箱限制。 |
| debug snapshot 默认开启 | 更符合“人工发现问题后交给 AI 读取现场”的目标；如只想关闭浏览器可用 `DEBUG_SAVE_SNAPSHOT=0`。 |
| debug 支持 `HEADLESS=1` | 便于 CI/Codex 非交互验证 snapshot 保存路径；用户手动测试默认仍打开可见浏览器。 |
| 同域 GM 同步通过每次读写刷新 localStorage 实现 | 保持 GM API 同步调用形态，避免引入异步 binding 破坏 userscript 行为。 |

## Resources

- Project root: `/home/ace/projects/油猴脚本编写`
- Target script: `scripts/Bilibili视频观看历史记录.js`
- Playwright Chrome extensions docs: https://playwright.dev/docs/chrome-extensions
- Playwright BrowserType docs: https://playwright.dev/docs/api/class-browsertype
- Playwright Trace Viewer docs: https://playwright.dev/docs/trace-viewer-intro
- Tampermonkey external editor FAQ: https://www.tampermonkey.net/faq.php?q=Q402
- Chrome userScripts API: https://developer.chrome.com/docs/extensions/reference/api/userScripts
- Violentmonkey SPA matching guide: https://violentmonkey.github.io/api/matching/

## Visual/Browser Findings

- 暂无截图或浏览器页面观察结果。
- 后续使用 Playwright 采集真实页面时，必须将重要视觉发现写入本文件，避免上下文丢失。

---

*Update this file after every 2 view/browser/search operations.*
*This prevents visual information from being lost.*
