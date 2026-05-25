## Why

Bilibili 视频观看历史记录会长期累积，用户需要一种安全、明确的方式清理久远记录，避免历史管理列表和本地分片存储持续膨胀。

## What Changes

- 在“历史管理”面板增加按保留周期清理历史记录的入口。
- 支持用户输入保留数量 `N`，并选择按天、月或年保留记录；`N` 只能为数字。
- 点击清理后删除不在保留范围内的历史记录，即 `savedAt` 早于计算截止时间的记录。
- 删除前显示二次确认对话框，明确说明将删除的时间范围和预计删除数量。
- 复用现有历史删除和刷新机制，不新增外部依赖，不扩大脚本匹配范围或权限。

## Capabilities

### New Capabilities

- `bilibili-history-retention-cleanup`: 定义 Bilibili 观看历史脚本按天/月/年保留记录并删除久远历史的用户行为。

### Modified Capabilities

## Impact

- 影响脚本：`scripts/Bilibili视频观看历史记录.js`。
- 主要影响区域：历史管理面板 UI、历史记录筛选逻辑、批量删除流程和删除后的列表/统计刷新。
- 不需要新增 userscript `@grant`、`@match`、`@require` 或 `@connect`。
- 开发阶段不更新 `@version`、`README.md` 或 `CHANGELOG.md`，收尾/发布时再统一判断。
