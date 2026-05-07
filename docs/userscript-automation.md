# 用户脚本自动化调试指南

本项目的自动化工具用于减少“复制脚本到油猴、手动保存 HTML、再让 AI 猜问题”的流程。当前工具以 `scripts/Bilibili视频观看历史记录.js` 为样板。

现在推荐优先使用真实环境入口：真实浏览器 profile + 真实 Tampermonkey/Violentmonkey + 本地 loader。Playwright 只负责打开浏览器和保存现场，不再模拟油猴扩展。

## 给用户的使用方式

首次使用前安装依赖：

```bash
npm install
npm run install:playwright-browsers
npm run install:playwright-deps
```

如果在 WSL 中执行 `install:playwright-deps`，需要在你自己的 WSL 终端输入 sudo 密码。

### 首次准备真实脚本管理器

```bash
npm run setup:bilibili-real-profile
```

这个命令使用普通 Chrome 打开 `.browser-profiles/bilibili-real/`，不会经过 Playwright 控制。Chrome Web Store 安装 Tampermonkey/Violentmonkey 时应该使用这个入口。

在打开的浏览器中完成一次性准备：

1. 安装 Tampermonkey 或 Violentmonkey。
2. 在另一个终端运行 `npm run dev:bilibili`。
3. 将输出的 loader 保存为用户脚本。
4. 在浏览器扩展详情中允许脚本管理器访问 `file://` URL。
5. 登录 Bilibili。
6. 关闭这个 Chrome 窗口，让 profile 写入完成。

如果没有找到 Chrome，先确认 WSL 中能执行：

```bash
google-chrome-stable --version
```

也可以用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/browser npm run setup:bilibili-real-profile` 指向已有浏览器。

### 首选：真实脚本管理器环境

```bash
PLAYWRIGHT_CHROMIUM_CHANNEL=chrome npm run debug:bilibili:real -- "https://www.bilibili.com/video/..."
```

这个命令使用 `.browser-profiles/bilibili-real/`，不会注入 Playwright GM shim，也不会自动加载仓库脚本。脚本必须由真实 Tampermonkey/Violentmonkey 执行。

`debug:bilibili:real` 会忽略 Playwright 默认的 `--disable-extensions`，让已经安装在 profile 中的真实扩展继续运行。但它仍是 Playwright 控制的浏览器，不建议在这个窗口里安装 Chrome Web Store 扩展；安装扩展请使用 `setup:bilibili-real-profile`。

复现问题后回终端按 Enter。工具会自动保存真实环境现场到：

```text
artifacts/real-debug-sessions/<timestamp>/
```

现场目录包含：

- `screenshot.png`
- `page.html`
- `console.json`
- `page-errors.json`
- `userscript-state.json`
- `real-environment.json`
- `trace.zip`
- `summary.json`

真实脚本管理器的 GM 存储通常不能直接从页面导出，所以 `userscript-state.json` 在真实环境里只记录页面信息和说明，`gmStore` 会是 `null`。AI 排障时应优先看 DOM、截图、console、page errors 和 trace。

如果只想打开真实调试浏览器但不保存现场：

```bash
DEBUG_SAVE_SNAPSHOT=0 npm run debug:bilibili:real -- "https://www.bilibili.com/..."
```

### 辅助：模拟 runner 人工复现

```bash
npm run debug:bilibili -- "https://www.bilibili.com/video/..."
```

这个命令会打开可手动操作的浏览器，并通过 Playwright runner 注入当前仓库里的 Bilibili 用户脚本。它适合快速诊断和保存 GM shim 状态，但不是完全真实的油猴环境。

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

### 模拟 runner 登录

```bash
npm run setup:bilibili-profile
```

浏览器打开后登录 Bilibili。登录完成后，回终端按 Enter 保存并关闭。登录态保存在 `.browser-profiles/bilibili/`，不会提交到仓库。这个 profile 供 `debug:bilibili`、`capture:bilibili` 和短测使用，不等同于真实脚本管理器 profile。

### 自动短测

```bash
npm run test:fixture:bilibili
npm run test:e2e:bilibili
```

`test:fixture:bilibili` 使用离线 HTML fixture，适合回归列表标记、菜单面板和进度保存。

`test:e2e:bilibili` 是短时真站 smoke，通过模拟 runner 验证脚本能在真站注入并注册菜单，跑完会自动关闭浏览器。它不是手动调试入口，也不是最终真实环境判断。

离线 fixture 也覆盖同域多标签页 GM 存储同步：一个 `www.bilibili.com` 页面更新观看记录后，另一个 `www.bilibili.com` 页面在切回可见时应能读取最新 revision 并刷新标签。注意：Playwright runner 的 GM 存储是对真实油猴环境的近似模拟；跨子域（例如 `www.bilibili.com` 与 `search.bilibili.com`）的同步不完全等价于 Tampermonkey 的扩展级存储。

### 自动采集指定页面

```bash
HEADLESS=1 CAPTURE_WAIT_MS=5000 npm run capture:bilibili -- "https://www.bilibili.com/..."
```

采集结果保存在：

```text
artifacts/captures/<timestamp>/
```

这个命令适合你已经知道要检查哪个 URL，但不需要手动点击复现的场景。它仍使用模拟 runner，结论应服从真实环境入口。

## 给 AI 的工作流

当用户说“我人工复现了问题，现场在 artifacts/real-debug-sessions/... 或 artifacts/debug-sessions/...”时：

1. 读取 `summary.json`，确认 URL、标题和保存时间。
2. 读取 `page-errors.json` 和 `console.json`，优先查页面错误、脚本错误、warning。
3. 如果是 `artifacts/real-debug-sessions/...`，读取 `real-environment.json`，确认这是未注入 shim 的真实环境；如果是 `artifacts/debug-sessions/...`，把它当作模拟 runner 现场。
4. 读取 `userscript-state.json`。真实环境里 GM 存储可能不可见；模拟 runner 里可用它确认 GM 存储、脚本版本和菜单注册情况。
5. 读取 `page.html`，用 `rg` 搜索相关 DOM、视频 BV、`.bvh-*` 标签、目标卡片选择器。
6. 必要时查看 `screenshot.png`，确认用户可见状态。
7. 如果真实环境和模拟 runner 结论冲突，以真实环境为准；只在 runner 出现的问题优先按测试工具差异处理。
8. 修改 `scripts/Bilibili视频观看历史记录.js`，保持小改动。
9. 先跑 `npm run test:fixture:bilibili`，再按需要跑 `npm run test:e2e:bilibili` 或 `capture:bilibili`。
10. 普通开发修复不更新 `@version`、`README.md`、`CHANGELOG.md`，除非用户明确要求收尾、提交或发布。

在 Codex 的命令沙箱中启动 Chromium 可能需要提升权限；用户自己的 WSL 终端通常不需要。

## 常见选择

- 想按真实油猴环境查问题：用 `debug:bilibili:real`。
- 想快速辅助定位并导出 GM shim 状态：用 `debug:bilibili`。
- 想让 AI 自动检查一个 URL：用 `capture:bilibili`，但它是模拟 runner。
- 想快速确认没破坏基础功能：用 `test:fixture:bilibili`。
- 想确认真站 runner 注入没坏：用 `test:e2e:bilibili`。
