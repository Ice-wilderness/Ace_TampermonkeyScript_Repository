## Context

`scripts/自用论坛辅助签到自写.js` 是自用油猴脚本，当前控制台已经能集中打开和标记多个论坛签到目标。用户计划未来把普通站点逐步改成 API 签到，把复杂站点交给前台处理，但“API 探测”本身不是最终用户功能，而是维护脚本时的开发辅助能力。

因此，本变更不应把探测功能塞进每日签到控制台，也不应让普通用户在日常签到时看到候选请求、promote 按钮或采集状态。它应该作为仓库内开发工具存在，形态类似 Playwright/runner 诊断工具：当需要新增或修复某个站点时运行，采集可复现信息，生成报告，供后续实现站点策略时参考。

## Goals / Non-Goals

**Goals:**
- 提供开发期工具，帮助维护者采集某个论坛站点的签到接口候选、表单结构、按钮选择器、token 位置和响应片段。
- 支持在“今天已签到”的情况下仍然输出有价值的页面线索，并明确标注哪些请求尚未验证为签到请求。
- 生成便于后续实现的结构化报告，而不是直接修改站点配置或签到状态。
- 对采集信息做敏感字段脱敏，避免保存 Cookie、Authorization、密码或明显的 token 明文。
- 保持普通用户脚本行为不变：不把探测代码放入发布 userscript，不显示探测 UI，不自动采集，不改变控制台一键签到流程。

**Non-Goals:**
- 不实现最终的 API 签到队列。
- 不实现前台串行队列。
- 不自动逆向或自动启用新站点签到逻辑。
- 不绕过登录、验证码、人机校验、权限限制或站点反爬策略。
- 不把本仓库迁移为浏览器扩展。

## Decisions

### Decision: Keep discovery as a project-side developer tool

API 探测工具应放在仓库的开发工具区，例如 `tools/` 下的 Playwright/runner 脚本或配套注入片段。它不应成为主 userscript 的 debug mode，也不应随日常脚本发布。正常每日签到控制台不应出现“API 候选管理”这类用户界面。

Alternative considered: 把 API 探测做成控制台内置功能。这个方向会增加普通用户 UI 复杂度，也容易让“未验证候选”看起来像可直接使用的功能，不符合当前目标。

Alternative considered: 在主 userscript 内加入隐藏开发开关。这个方案短期方便，但会把开发诊断逻辑带进用户脚本，增加权限、体积和维护负担，因此不采用。

### Decision: Capture evidence, not configuration

工具输出的是诊断报告，包括候选请求、页面表单、按钮、可能 token、响应摘要和复现备注。报告本身不修改 `siteConfigs`，不写成功日期，不改变目标的执行策略。

Alternative considered: 捕获后直接保存为可执行 API 配置。这个自动化程度太高，容易把误判请求固化进脚本。

### Decision: Collect both network and page clues

由于很多站点当天已经签到后不会再次发送真正的签到请求，工具不能只依赖网络请求。它还应采集页面上的签到入口、表单 action/method、隐藏字段、按钮文本、关键 DOM 选择器和“已签到”文案。

Alternative considered: 只 patch fetch/XMLHttpRequest。这样会漏掉传统表单提交、页面跳转式签到和已签到页面的静态线索。

### Decision: Redact before storing or exporting

采集报告应在写入存储、复制或下载前脱敏。Cookie、Authorization、password、passwd、token、formhash、csrf、auth、secret 等字段应默认隐藏或只保留字段名和长度。

Alternative considered: 保存完整请求以便复现。完整请求可能包含账号态凭证，不适合作为长期文件或聊天上下文。

### Decision: Make reports easy to hand to the implementation step

报告应包含足够上下文，让后续实现时能快速判断：
- 是否存在明确 API；
- 是否需要先 GET 页面拿 token；
- 成功/已签到/失败文案可能是什么；
- 该站点更适合 API、页面脚本、前台队列还是手动处理。

Alternative considered: 只导出原始 JSON。原始 JSON 机器友好但不利于快速阅读，因此应提供结构化 JSON 和简短 Markdown 摘要中的至少一种。

## Risks / Trade-offs

- 已签到状态下抓不到真实提交请求 -> 报告必须标注“未验证为签到 API”，并保留到未来未签到日继续采集。
- 页面内 patch 可能漏掉浏览器层较早发生的请求 -> 工具说明应要求先启用采集，再触发签到动作。
- 传统表单提交可能导致页面跳转前来不及保存 -> 在 submit 捕获时先同步记录表单摘要。
- 脱敏可能隐藏实现所需 token 值 -> 报告保留字段名、位置和长度，后续代码通过运行时读取 token，而不是复用采集时的明文值。
- 开发工具混入主脚本会增加维护负担 -> 将诊断逻辑放在仓库开发工具目录，不进入普通用户 userscript。

## Migration Plan

1. 先在仓库内新增开发期 API 诊断工具，不改变主脚本日常签到行为。
2. 用该工具在后续新增/维护站点时导出报告。
3. 基于报告逐站点实现 API 签到或前台处理策略。
4. 每个站点真正实现时，再独立检查 userscript 元信息、版本、README 和 CHANGELOG。

Rollback：删除或停用开发诊断工具即可；现有签到数据和每日控制台不受影响。

## Open Questions

- 开发工具使用 Playwright runner、普通浏览器注入片段，还是二者组合？
- 报告默认导出为 JSON、Markdown，还是两者都提供？
- 是否需要为常见 Discuz 签到插件提供专门的启发式扫描规则？
