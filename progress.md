# Progress Log

## Session: 2026-05-07

### Phase 1: Requirements & Discovery

- **Status:** complete
- **Started:** 2026-05-07 23:07:54 CST
- Actions taken:
  - 使用 `planning-with-files` skill。
  - 运行 session catchup 检查，未发现旧会话上下文。
  - 确认项目根目录没有现成 `task_plan.md`、`findings.md`、`progress.md`。
  - 确认工作区在创建 planning 文件前为干净状态。
  - 创建本任务专用 planning 三件套。
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)

### Phase 2: Test Architecture

- **Status:** complete
- Actions taken:
  - 收到 planning hook，确认任务只有 1/5 阶段完成，需要继续推进。
  - 重读 `task_plan.md`、`findings.md`、`progress.md` 和 `planning-with-files` skill。
  - 确认 Phase 2 架构决策：npm/Playwright 工程、自建 userscript runner + GM shim、Tampermonkey loader 手动入口、capture artifacts。
- Files created/modified:
  - `task_plan.md` (updated)
  - `progress.md` (updated)

### Phase 3: Implementation

- **Status:** complete
- Actions taken:
  - 开始实现测试基础设施。
  - 新增 npm/Playwright 基础配置、userscript metadata parser、GM shim runner、capture/profile 命令、Tampermonkey loader 输出命令和 Bilibili fixture 测试。
  - 安装 `@playwright/test` 并生成 `package-lock.json`。
  - 运行 `npm run test:fixture:bilibili`，测试尚未进入断言阶段，因 Playwright Chromium 浏览器二进制未安装而失败。
  - 使用 Ubuntu 24.04 fallback 下载 Playwright Chromium。
  - 发现当前系统缺少 `libnspr4.so` 等 Chromium 运行依赖，且 `install-deps` 需要 sudo TTY，无法在本会话完成。
  - 新增 `install:playwright-browsers`、`install:playwright-deps` 脚本，以及 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / `PLAYWRIGHT_CHROMIUM_CHANNEL` 支持。
  - 修复 userscript metadata parser 对无路径 `@match` 和 glob `*` 的兼容问题。
- Files created/modified:
  - `.gitignore` (created)
  - `package.json` (created)
  - `package-lock.json` (created)
  - `playwright.config.cjs` (created)
  - `tools/userscript/*.cjs` (created)
  - `tests/userscript/*.cjs` (created)
  - `tests/userscript/fixtures/*.html` (created)
- Files created/modified:
  -

### Phase 4: Verification

- **Status:** complete
- Actions taken:
  - 运行所有新增 `.cjs` 文件的 `node --check`，语法检查通过。
  - 运行 `npm run dev:bilibili`，成功生成 Tampermonkey 本地 loader。
  - 运行 metadata matcher smoke，确认视频页、首页和带 query 首页能匹配，外站 URL 不匹配。
  - 再次运行 `npm run test:fixture:bilibili`，仍被当前系统缺少 Chromium 动态库阻塞，未进入测试断言。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 5: Delivery

- **Status:** complete
- Actions taken:
  - 准备最终汇总。
  - 确认 `README.md`、`CHANGELOG.md` 和现有 `*.js` 脚本没有 diff。
  - 确认 `node_modules/`、`artifacts/`、`test-results/` 已被 `.gitignore` 忽略。
- Files created/modified:
  - `progress.md` (updated)

### Phase 6: Project Structure Cleanup

- **Status:** complete
- Actions taken:
  - 用户要求优化项目结构，不再让用户脚本直接暴露在项目根目录。
  - 读取当前 planning 文件和所有根目录 `.js` 脚本引用。
  - 决定采用 `scripts/` 目录集中存放用户脚本源码，并同步更新 README/CHANGELOG 和测试工具路径。
  - 将 4 个根目录 userscript 移动到 `scripts/`。
  - 更新 README/CHANGELOG 脚本链接，并新增 README 项目结构说明。
  - 更新 Tampermonkey loader、capture、fixture/e2e 测试中的目标脚本路径。
  - 验证根目录无 `.js` 文件，`scripts/` 中包含 4 个脚本。
  - 运行 CJS 语法检查、Tampermonkey loader 输出和 metadata matcher smoke，均通过。
  - 扫描旧根路径链接，未发现残留。
  - 对比 4 个移动后脚本与 HEAD 中原路径的 blob hash，确认脚本内容未变化。
  - 运行 planning-with-files complete check，确认 6/6 阶段完成。
- Files created/modified:
  - `task_plan.md` (updated)
  - `progress.md` (updated)
  - `findings.md` (updated)
  - `README.md` (updated)
  - `CHANGELOG.md` (updated)
  - `tools/userscript/print-tampermonkey-loader.cjs` (updated)
  - `tools/userscript/capture-bilibili.cjs` (updated)
  - `tests/userscript/bilibili.fixture.spec.cjs` (updated)
  - `tests/userscript/bilibili.e2e.spec.cjs` (updated)
  - `scripts/*.js` (moved from repository root)

### Phase 7: Feasibility Verification

- **Status:** complete
- Actions taken:
  - 已创建提交 `5b77efe Add userscript test workflow and project layout`。
  - 开始可行性验证，先运行离线 fixture 测试。
  - 默认沙箱中首次运行 fixture 失败，Chromium 报 `sandbox_host_linux.cc ... Operation not permitted`。
  - 使用提升权限重跑 `npm run test:fixture:bilibili`，3 个离线 fixture 测试全部通过。
  - 使用提升权限运行 `npm run test:e2e:bilibili`，真实 B 站首页 smoke 通过。
  - 使用 headless capture 验证 `npm run capture:bilibili -- https://www.bilibili.com/`，成功保存诊断产物。
  - 检查 capture 产物，确认包含截图、HTML、console、page errors、userscript state、trace 和 summary。
  - 检查 `page-errors.json` 为空，console 仅包含 log/info，GM 存储和菜单命令初始化成功。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 8: Manual Reproduction Snapshot Workflow

- **Status:** complete
- Actions taken:
  - 用户确认采用“人工复现后保存现场”的方案，并要求新增用户/AI 使用文档。
  - 读取当前 debug/capture/artifacts 工具和 package scripts。
  - 新增 `tools/userscript/snapshot.cjs`，统一保存 screenshot、HTML、console、page-errors、userscript-state、summary。
  - 改造 `capture:bilibili` 使用统一 snapshot helper。
  - 改造 `debug:bilibili`：浏览器保持打开，用户按 Enter 后保存 debug session 现场再关闭。
  - 新增 `docs/userscript-automation.md`，说明用户命令和 AI 排障流程。
  - 增加 `HEADLESS=1` 支持，用于非交互验证 debug snapshot。
  - 运行 CJS 语法检查，通过。
  - 运行 `npm run test:fixture:bilibili`，3 个测试通过。
  - 运行 `capture:bilibili`，确认统一 snapshot helper 产物完整。
  - 运行 `HEADLESS=1 printf Enter | npm run debug:bilibili`，确认 debug session 能保存现场。
- Files created/modified:
  - `tools/userscript/snapshot.cjs` (created)
  - `tools/userscript/capture-bilibili.cjs` (updated)
  - `tools/userscript/debug-bilibili.cjs` (updated)
  - `docs/userscript-automation.md` (created)
  - `README.md` (updated)
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 9: GM Storage Sync Parity

- **Status:** complete
- Actions taken:
  - 用户反馈真实 Tampermonkey 环境切换标签页会刷新最新状态标签，但 Playwright runner 环境不会。
  - 分析脚本同步逻辑：`visibilitychange` 时读取 `bvh_storage_revision`，变大则清缓存并通知 DOMWatcher 重扫。
  - 定位 runner 差异：GM shim 初始化后使用页面内存 store，其他标签页更新后当前页 `GM_getValue` 仍读旧内存。
  - 修改 GM shim，使 `GM_getValue`、`GM_setValue`、`GM_deleteValue`、`GM_listValues` 和 `__userscriptGetGMStore` 在读写前同步持久 store。
  - 调整持久 store 初始数据逻辑，避免新页面重复把 fixture 初始数据补种回持久 store。
  - 新增同域双页面 fixture，验证第二页更新记录后第一页切回可刷新标签状态。
  - 记录跨子域同步限制：runner 仍不是 Tampermonkey 扩展级跨 origin GM 存储。
- Files created/modified:
  - `tools/userscript/runner.cjs` (updated)
  - `tests/userscript/bilibili.fixture.spec.cjs` (updated)
  - `docs/userscript-automation.md` (updated)
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

## Test Results

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| session catchup | planning-with-files session-catchup.py | No stale context or actionable catchup output | No output | pass |
| planning file existence check | task_plan.md/findings.md/progress.md | No old planning files before creation | No files found | pass |
| git status before creation | git status --short | Clean worktree before creating planning files | No output | pass |
| fixture tests first run | npm run test:fixture:bilibili | Start Chromium and run 3 offline tests | Failed before browser launch because Playwright Chromium was not installed | fail |
| CJS syntax check | node --check on Playwright config, tools, tests | All new CJS files parse | Passed | pass |
| Tampermonkey loader generation | npm run dev:bilibili | Print userscript header with file:// @require | Passed | pass |
| metadata matcher smoke | node -e matcher check | Bilibili video/root/query URLs match; example.com does not | Passed | pass |
| fixture tests after browser download | npm run test:fixture:bilibili | Run 3 offline tests | Blocked before launch: `libnspr4.so` missing | blocked |
| release-doc/script diff check | git diff -- README.md CHANGELOG.md '*.js' | No script/doc/version changes | No diff | pass |
| root JS cleanup | find . -maxdepth 1 -type f -name '*.js' | No userscript source files in root | No output | pass |
| scripts directory check | find scripts -maxdepth 1 -type f -name '*.js' | Four userscript files present | Four files listed | pass |
| CJS syntax check after move | node --check on Playwright config, tools, tests | All CJS files parse after path update | Passed | pass |
| Tampermonkey loader after move | npm run dev:bilibili | Loader @require points to scripts/Bilibili...js | Passed | pass |
| metadata matcher after move | node -e matcher check | Bilibili video/root URLs match; example.com does not | Passed | pass |
| old root path residual scan | rg for old root links/path joins | No old root script links or joins remain | No output | pass |
| moved script content hash | git hash-object vs git rev-parse HEAD:path | Moved files keep identical content | All 4 hashes match | pass |
| planning completion | check-complete.sh | All phases complete | 6/6 complete | pass |
| fixture feasibility default sandbox | npm run test:fixture:bilibili | Run fixture tests | Blocked by Chromium sandbox host permission | blocked |
| fixture feasibility elevated | npm run test:fixture:bilibili | Run 3 offline tests | 3 passed | pass |
| real-page smoke | npm run test:e2e:bilibili | Open Bilibili homepage and register userscript menu | 1 passed | pass |
| capture workflow | HEADLESS=1 CAPTURE_WAIT_MS=2000 npm run capture:bilibili -- https://www.bilibili.com/ | Save screenshot, HTML, logs, state, trace, summary | Capture saved successfully | pass |
| capture artifact sanity | inspect generated JSON/files | page-errors empty, GM state and menu commands present | Passed | pass |
| CJS syntax check after snapshot workflow | node --check on Playwright config, tools, tests | All CJS files parse | Passed | pass |
| fixture after snapshot workflow | npm run test:fixture:bilibili | 3 offline tests pass | 3 passed | pass |
| capture after snapshot refactor | HEADLESS=1 CAPTURE_WAIT_MS=1000 npm run capture:bilibili -- https://www.bilibili.com/ | Capture files saved with summary mode capture | Passed | pass |
| debug snapshot workflow | HEADLESS=1 piped Enter into npm run debug:bilibili -- https://www.bilibili.com/ | Debug session files saved with summary mode debug | Passed | pass |
| GM same-origin sync fixture | npm run test:fixture:bilibili | Includes cross-page GM revision refresh and tag update | 4 passed | pass |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-05-07 23:08 CST | Playwright Chromium executable missing | 1 | Need to run `npx playwright install chromium`, then rerun fixture tests. |
| 2026-05-07 23:08 CST | Playwright unsupported platform `ubuntu26.04-x64` | 2 | Used `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` to download fallback Chromium. |
| 2026-05-07 23:08 CST | Chromium missing `libnspr4.so`; install-deps needs sudo TTY | 3 | Added install scripts and explicit browser path/channel support; full browser tests require user-side system dependency setup. |
| 2026-05-07 23:08 CST | Metadata matcher rejected no-path `@match` and mishandled `*` glob | 1 | Updated parser to support no-path matches and correctly convert `*` to `.*`. |
| 2026-05-07 23:09 CST | Residual path scan command used unescaped backticks | 1 | Re-run the scan with single-quoted pattern and no shell-interpreted backticks. |
| 2026-05-07 23:33 CST | Chromium launch blocked by command sandbox | 1 | Re-ran Playwright tests with elevated execution; fixture tests passed. |

## 5-Question Reboot Check

| Question | Answer |
|----------|--------|
| Where am I? | Phase 9 complete; same-origin GM storage sync parity is fixed and covered by fixture. |
| Where am I going? | User can retest tag refresh in debug environment; cross-subdomain sync remains a known runner limitation. |
| What's the goal? | 为油猴脚本库建立真实网页测试和诊断体系，先覆盖 `scripts/Bilibili视频观看历史记录.js`。 |
| What have I learned? | See `findings.md`. |
| What have I done? | Created planning files, added the Playwright/userscript test infrastructure, ran static checks, and documented browser dependency blocker. |

---

*Update after completing each phase or encountering errors.*
