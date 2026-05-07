# 用户脚本自动化调试指南

本项目的自动化工具用于减少“复制脚本到油猴、手动保存 HTML、再让 AI 猜问题”的流程。当前工具以 `scripts/Bilibili视频观看历史记录.js` 为样板。

## 给用户的使用方式

首次使用前安装依赖：

```bash
npm install
npm run install:playwright-browsers
npm run install:playwright-deps
```

如果在 WSL 中执行 `install:playwright-deps`，需要在你自己的 WSL 终端输入 sudo 密码。

### 人工登录

```bash
npm run setup:bilibili-profile
```

浏览器打开后登录 Bilibili。登录完成后，回终端按 Enter 保存并关闭。登录态保存在 `.browser-profiles/bilibili/`，不会提交到仓库。

### 人工复现并保存现场

```bash
npm run debug:bilibili -- "https://www.bilibili.com/video/..."
```

这个命令会打开可手动操作的浏览器，并注入当前仓库里的 Bilibili 用户脚本。你可以登录、跳转页面、点击 UI、滚动列表并复现问题。

复现后回终端按 Enter。工具会自动保存现场到：

```text
artifacts/debug-sessions/<timestamp>/
```

现场目录包含：

- `screenshot.png`
- `page.html`
- `console.json`
- `page-errors.json`
- `userscript-state.json`
- `trace.zip`
- `summary.json`

然后把问题现象和这个目录告诉 AI。

如果只想打开调试浏览器但不保存现场：

```bash
DEBUG_SAVE_SNAPSHOT=0 npm run debug:bilibili -- "https://www.bilibili.com/..."
```

### 自动短测

```bash
npm run test:fixture:bilibili
npm run test:e2e:bilibili
```

`test:fixture:bilibili` 使用离线 HTML fixture，适合回归列表标记、菜单面板和进度保存。

`test:e2e:bilibili` 是短时真实页面 smoke，只验证脚本能在真站注入并注册菜单，跑完会自动关闭浏览器。它不是手动调试入口。

### 自动采集指定页面

```bash
HEADLESS=1 CAPTURE_WAIT_MS=5000 npm run capture:bilibili -- "https://www.bilibili.com/..."
```

采集结果保存在：

```text
artifacts/captures/<timestamp>/
```

这个命令适合你已经知道要检查哪个 URL，但不需要手动点击复现的场景。

## 给 AI 的工作流

当用户说“我人工复现了问题，现场在 artifacts/debug-sessions/...”时：

1. 读取 `summary.json`，确认 URL、标题和保存时间。
2. 读取 `page-errors.json` 和 `console.json`，优先查页面错误、脚本错误、warning。
3. 读取 `userscript-state.json`，确认 GM 存储、脚本版本和菜单注册情况。
4. 读取 `page.html`，用 `rg` 搜索相关 DOM、视频 BV、`.bvh-*` 标签、目标卡片选择器。
5. 必要时查看 `screenshot.png`，确认用户可见状态。
6. 修改 `scripts/Bilibili视频观看历史记录.js`，保持小改动。
7. 先跑 `npm run test:fixture:bilibili`，再按需要跑 `npm run test:e2e:bilibili` 或 `capture:bilibili`。
8. 普通开发修复不更新 `@version`、`README.md`、`CHANGELOG.md`，除非用户明确要求收尾、提交或发布。

在 Codex 的命令沙箱中启动 Chromium 可能需要提升权限；用户自己的 WSL 终端通常不需要。

## 常见选择

- 想自己点页面查问题：用 `debug:bilibili`。
- 想让 AI 自动检查一个 URL：用 `capture:bilibili`。
- 想快速确认没破坏基础功能：用 `test:fixture:bilibili`。
- 想确认真站注入没坏：用 `test:e2e:bilibili`。
