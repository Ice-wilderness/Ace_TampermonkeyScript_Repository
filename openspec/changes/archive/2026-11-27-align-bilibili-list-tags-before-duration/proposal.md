# Proposal

## Why

当前 `Bilibili视频观看历史记录.js` 在视频页右侧的纯分 P 列表、合集单 P 列表以及合集内嵌分 P 子列表中，将观看标签（`.bvh-episode-tag`）附加在标题元素末尾（纯分 P 甚至直接插入在带 `overflow: hidden` 的 `.title-txt` 内部）。这导致标签紧贴长短不一的标题文字后方，与右侧视频时长列之间留出参差不齐的空白，不仅整体难以纵向扫视，长标题下还容易把纯分 P 标签截断或挤压。需要将所有带时长的文字列表标签统一移动到时长列左侧，与播放器选集菜单那样形成整齐的右侧纵向对齐列。

## What Changes

- 统一排查并收口所有文字型播放列表条目的观看标签挂载位置，将标签移动到行内时长区域（`.stats` / `.duration`）的紧邻左侧，对齐效果与播放器内选集菜单（`.bpx-player-ctrl-eplist-multi-menu-item`）保持一致：
  - **纯分 P 列表视图**（`.video-pod__list.multip.list` 下的 `.simple-base-item.video-pod__item[data-key]`）：从 `.title-txt` 内部移出，改为作为行容器直接子项插入到 `.stats` 之前。
  - **合集单 P 条目**（`.video-pod__list.section` 下的 `.single-p > .simple-base-item.normal`）：从 `.title` 内部移出，改为插入到 `.stats` 之前。
  - **合集嵌套分 P 子条目**（`.video-pod__list.section` 下的 `.page-list > .simple-base-item.page-item`）：从 `:scope > .title` 内部移出，改为插入到 `.stats` 之前。
  - **其他通用文字列表变体**（含 `.stats` 或 `.duration` 的 `.video-pod__item[data-key]`）：统一插入到时长节点左侧；若条目不存在时长节点，则安全降级至标题外侧或行尾，不破坏无时长结构的兼容渲染。
- 配套调整列表标签与行内标题区的弹性布局样式，确保在经典标签（完整/精简、自定义字号/留白）与 SVG 圆环（20–36px）两种样式下，标签均不被压缩、长标题在左侧独立省略号截断、且不推挤或遮挡右侧时长列。
- 强化幂等位置校验：标签已位于目标位置且内容样式未变时保持零 DOM 写入；若页面框架动态重排或延迟渲染 `.stats`，刷新时自动校正到时长左侧。
- 同步调整设置页「标记效果预览」中的合集列表预览行（`.bvh-preview-episode-row`），补充示意时长并呈现「标题 — 标签 — 时长」布局，使预览与页面实际效果一致。
- 明确保持以下非文字时长列表的既有行为不变：
  - **播放器内选集菜单**（`.bpx-player-ctrl-eplist-multi-menu-item`）：本身无时长列，已采用右侧纵向对齐，作为本次效果参考保持不变。
  - **纯分 P 网格视图**（`.video-pod__list.grid .video-pod__item.page`）：无时长列的数字方格，保持右上角紧凑角标 `.bvh-episode-tag-grid` 不变。
  - **播单图文列表**（`/list/` 页 `.action-list-item-wrap[data-key]`）：使用的是封面角标（`.bvh-action-list-cover-tag`），保持不变；其内部 `.multip-list-item` 目前尚未纳入脚本标记范围，不在本次位置调整范围内。
  - **合集多 P 折叠头**（`.multi-p > .simple-base-item.head`）：沿用不直接打标（由下属 `.page-item` 各自标记）的既有规则。

## Capabilities

### New Capabilities

- `bilibili-history-playlist-marker-layout`: 规范 Bilibili 各类播放列表（纯分 P 列表、合集单 P、合集嵌套分 P、通用列表变体、网格视图与播放器选集菜单）观看标签的放置位置、与时长列的对齐方式、长标题截断保护、圆环/经典双样式兼容及无时长降级行为。

### Modified Capabilities

无。

## Impact

- 实现范围限定在 `scripts/Bilibili视频观看历史记录.js` 的全局列表标签 CSS 规则、`DOMWatcher.processPlaylistItem`（及新增的轻量位置解析辅助方法）和设置页预览区 `.bvh-preview-episode-row` 模板与样式。
- 不改变任何 GM 存储 key、历史记录格式、设置字段、导入导出协议、脚本元信息权限或网络请求。
- 验证复用既有 `tools/bilibili-history/playlist-test.mjs`、`tools/bilibili-history/tag-style-test.mjs`、`tools/bilibili-history/startup-header-test.mjs`，并补充覆盖纯分 P 列表、合集单 P、合集嵌套分 P、长短标题截断、经典标签与 SVG 圆环、以及无时长降级的本地 Playwright 布局回归验证。
- 本次仅生成规划文件，不修改脚本代码、版本、`README.md` 或 `CHANGELOG.md`。
