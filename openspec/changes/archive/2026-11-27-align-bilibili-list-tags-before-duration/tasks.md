# Tasks

## 1. 列表标签位置统一与弹性布局

- [x] 1.1 在 `scripts/Bilibili视频观看历史记录.js` 的 `DOMWatcher` 中新增 `getPlaylistTagPlacement(el, { isGridItem, isPlayerMenuItem })`，统一解析纯分 P 列表（`.simple-base-item.video-pod__item`）、合集单 P（`.single-p > .simple-base-item.normal`）、合集嵌套分 P（`.simple-base-item.page-item`）及通用带 `.stats` / `.duration` 列表项的插入位置（紧邻时长节点之前），无时长节点时降级至 `:scope > .title` 或行容器末尾，并保持网格分 P、播放器选集菜单、播单封面与合集折叠头规则不变；通过 `tools/bilibili-history/playlist-test.mjs` 新增的 DOM 位置与边界断言验证各类列表项的挂载父节点与兄弟顺序。
- [x] 1.2 更新 `DOMWatcher.processPlaylistItem(el)` 改用 `getPlaylistTagPlacement` 与 `parent.insertBefore(tagEl, beforeNode)`，扩展幂等检查同时校验 `parentNode === placement.parent` 与 `nextSibling === placement.beforeNode`；在 `tools/bilibili-history/playlist-test.mjs` 中验证重复刷新零 DOM 写入，以及 `.stats` 延后插入或标签被移除重排后的自动校正与单标签唯一性。
- [x] 1.3 在 `injectStyles()` 中为 `.bvh-episode-tag` 补充 `flex-shrink: 0` 等行内弹性保护，并为含列表标签的 `.simple-base-item > .title` 补充 `min-width: 0; overflow: hidden;` 防御规则；在本地 Playwright 布局夹具中验证短标题、超长无空格标题下的经典标签（默认与 16px 大字号、完整/精简）及 SVG 圆环（27px/36px）均对齐于时长列左侧、不被压缩或裁切且不推挤右侧时长。

## 2. 设置页列表预览同步

- [x] 2.1 在 `HistoryManagerPanel.renderSettings()` 与工作台 CSS 中更新 `.bvh-preview-episode-row`，在 `[data-preview-episode]` 右侧补充示意时长（如 `12:48`）并调整标题省略与间距样式；运行 `node tools/bilibili-history/tag-style-test.mjs` 验证经典标签、精简模式、SVG 圆环预览及 390px 窄视口下均无横向溢出且布局符合「标题 — 标签 — 时长」。

## 3. 综合回归验收

- [x] 3.1 运行 `node --check scripts/Bilibili视频观看历史记录.js`、`node tools/bilibili-history/playlist-test.mjs`、`node tools/bilibili-history/tag-style-test.mjs` 与 `node tools/bilibili-history/startup-header-test.mjs`，确认全部通过；具备真实 B 站视频页环境时核实纯分 P 与合集列表实页对齐效果，无环境则如实记为未实测。检查最终 `git diff` 仅涉及目标脚本与测试工具，未修改 `@version`、`README.md` 与 `CHANGELOG.md`（留待收尾指令处理）。
