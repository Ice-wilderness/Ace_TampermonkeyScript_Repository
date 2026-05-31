# Sign-in API Discovery

这是论坛签到脚本的项目侧开发工具，用来在新增或维护站点时采集接口、表单、按钮、token 位置和响应线索。它不是发布给用户的油猴脚本功能，也不会写入每日签到状态。

## 工具形态

- `inject.js`：核心浏览器注入脚本。显式启动后会捕获 `fetch`、`XMLHttpRequest`、表单提交和静态页面线索。
- `runner.mjs`：Playwright runner，用它打开目标页并自动注入 `inject.js`。
- `test.mjs`：无浏览器的基础验证，覆盖候选捕获、表单采集、脱敏和已签到页面线索。

本项目已将 Playwright 安装为开发依赖。首次使用前先在仓库根目录运行：

```powershell
npm install
```

## 推荐流程

### 方式 A：Playwright runner

```powershell
node .\tools\signin-api-discovery\runner.mjs --url "https://example.com/checkin" --target "example"
```

runner 会使用 `tools/signin-api-discovery/.profile/` 作为浏览器 profile，便于保留开发期登录状态。打开页面后，在浏览器中手动触发签到或相关操作，然后回到终端按 Enter 导出报告。

可选参数：

```text
--url <url>              要打开的目标页面，必填
--target <name>          目标名称，默认使用 URL host
--out <dir>              报告输出目录，默认 tools/signin-api-discovery/reports
--user-data-dir <dir>    Playwright 持久 profile 目录
--headless true          使用无头模式，默认 false
```

基础验证：

```powershell
npm run test:signin-api-discovery
```

### 方式 B：手动注入

1. 打开目标站点页面。
2. 将 `inject.js` 内容粘贴到浏览器开发者工具控制台。
3. 运行：

```js
__signinApiDiscovery.start({
  target: "example",
  host: location.host,
  note: "researching daily sign-in"
});
```

4. 手动触发签到、点击按钮或提交表单。
5. 导出报告：

```js
__signinApiDiscovery.copyMarkdown();
__signinApiDiscovery.downloadJson();
__signinApiDiscovery.downloadMarkdown();
```

## 报告边界

报告只是一份开发诊断证据：

- 捕获到的请求统一标记为 candidate，不代表已验证为签到 API。
- 今天已经签到时，报告可能只有页面按钮、表单、token 和已签到文案线索。
- 报告不会修改 `siteConfigs`。
- 报告不会写入 `BBSSignHelperData`、`BBSSignHelperDashboardStatus` 或任何每日签到状态。
- 后续真正实现某个站点 API 签到时，仍然要做保守成功校验，并在发布收尾时检查 `@connect` / `@grant`。

## 脱敏策略

导出前会脱敏 Cookie、Authorization、password、token、csrf、formhash、auth、secret、session 等字段。报告保留字段名、长度、来源位置和 URL path 等非秘密上下文，帮助后续实现运行时读取 token，而不是复用采集时的明文值。
