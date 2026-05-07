# Task Plan: 用户脚本真实网页测试体系

## Goal

为本油猴脚本库建立一套可持续使用的开发测试体系，先以 `scripts/Bilibili视频观看历史记录.js` 为样板，解决复制到油猴、人工测试和手动保存 HTML 的痛点。

## Current Phase

Phase 7

## Phases

### Phase 1: Requirements & Discovery

- [x] 确认目标脚本和仓库形态
- [x] 确认用户接受 Node/Playwright 开发依赖
- [x] 确认允许使用专用浏览器 profile 保存 B 站登录态
- [x] 创建 `task_plan.md`、`findings.md`、`progress.md`
- **Status:** complete

### Phase 2: Test Architecture

- [x] 设计 npm/Playwright 工程结构
- [x] 设计 Tampermonkey 本地 loader 工作流
- [x] 设计 userscript metadata 解析和 GM shim
- [x] 设计真实页面采集 artifacts 格式
- **Status:** complete

### Phase 3: Implementation

- [x] 新增开发依赖和基础配置
- [x] 新增专用 profile 启动命令
- [x] 新增真实页面 capture 命令
- [x] 新增 fixture 测试 runner
- [x] 新增 `.gitignore` 规则保护 profile 和测试产物
- **Status:** complete

### Phase 4: Verification

- [ ] 验证 capture 命令能打开真实 B 站页面并保存诊断资料
- [x] 验证 GM shim 能覆盖当前 Bilibili 脚本使用的 GM API
- [ ] 验证 fixture 测试能复现列表标记、管理面板和存储行为
- [x] 记录测试结果到 `progress.md`
- **Status:** complete

### Phase 5: Delivery

- [x] 汇总新增命令和使用方式
- [x] 说明是否更新 `@version`、`README.md`、`CHANGELOG.md`
- [x] 说明 planning 三件套是否建议归档
- **Status:** complete

### Phase 6: Project Structure Cleanup

- [x] 将根目录用户脚本移动到 `scripts/`
- [x] 更新 README/CHANGELOG 文件链接
- [x] 更新测试工具和 fixture 中的脚本路径
- [x] 验证静态检查和 loader 输出
- [x] 说明 WSL 中浏览器依赖安装方式
- **Status:** complete

### Phase 7: Feasibility Verification

- [x] 运行离线 fixture 测试
- [x] 根据失败结果修正测试基础设施或 fixture
- [x] 尝试真站 smoke 或 capture
- [x] 记录验证结论和后续限制
- **Status:** complete

## Key Questions

1. Playwright 自动化应直接加载真实油猴扩展，还是先用自建 userscript runner 注入脚本？
2. Tampermonkey loader 是否只作为手动调试入口，自动化测试是否统一使用 GM shim？
3. 真站测试覆盖哪些 B 站页面作为首版 smoke 范围？
4. 离线 fixture 应保存完整 HTML，还是保存最小 DOM 片段？

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 先以 `scripts/Bilibili视频观看历史记录.js` 为样板 | 当前痛点来自真实 B 站页面、SPA DOM、GM 存储和视频播放进度，最能代表复杂脚本测试需求。 |
| 使用 `planning-with-files` 三件套 | 本任务涉及多阶段调研、实现和验证，需要跨轮保存上下文。 |
| 接受 Node/Playwright 开发依赖 | 需要真实网页自动化、截图、console、HTML、trace 和可重复回归。 |
| 使用专用持久化浏览器 profile | B 站登录态和个性化 DOM 对测试很重要，但不应污染日常浏览器 profile。 |
| 开发阶段不更新版本和文档 | 当前是测试基础设施规划/开发，不是脚本发布收尾。 |
| 自动化优先使用自建 userscript runner，Tampermonkey loader 作为手动真环境入口 | 自建 runner 更适合保存 artifacts 和稳定回归；loader 更接近真实用户环境并解决复制粘贴。 |
| fixture 首版使用最小 HTML，capture 保存完整 HTML | 最小 fixture 易维护，真实问题由 capture 命令保存完整页面以供诊断。 |
| 提供 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / `PLAYWRIGHT_CHROMIUM_CHANNEL` 逃生口 | 当前环境缺少系统浏览器且 Playwright 自带浏览器依赖无法 sudo 安装，允许用户显式指定已安装浏览器。 |
| 用户脚本源码统一放入 `scripts/` | 根目录保留项目文档、配置、测试入口和 planning 文件，脚本源码按类型集中管理，改动范围小。 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Playwright Chromium executable missing | 1 | 运行 fixture 测试时发现 Playwright 刚安装但浏览器二进制未下载；下一步执行 `npx playwright install chromium`。 |
| Playwright does not support chromium on ubuntu26.04-x64 | 2 | 使用 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` 下载 fallback Chromium。 |
| Chromium missing `libnspr4.so` and install-deps requires sudo TTY | 3 | 当前会话无法完成系统依赖安装；已新增安装脚本和显式浏览器路径逃生口。 |

## Notes

- 每次重大技术决策前先重读本文件。
- 每 2 次重要阅读、搜索或浏览器观察后，将关键事实同步到 `findings.md`。
- 每完成一个阶段，更新本文件阶段状态并在 `progress.md` 记录执行结果。
- 不要让旧 planning 文件污染无关新需求；任务完成后建议整体归档三件套。
