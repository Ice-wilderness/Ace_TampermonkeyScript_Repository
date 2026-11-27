# Design

## Context

动机与改动范围见 [proposal.md](./proposal.md)，行为契约见 [specs/bilibili-history-playlist-marker-layout/spec.md](./specs/bilibili-history-playlist-marker-layout/spec.md)。

当前 `scripts/Bilibili视频观看历史记录.js` 通过 `PLAYLIST_ITEM_SELECTOR` 统一识别四类播放列表条目，并由 `DOMWatcher.processPlaylistItem(el)` 完成渲染：

1. **播单图文列表**（`.action-list-item-wrap[data-key]`）：走封面角标分支 `createPlaylistCoverTag`，插入到 `.cover .cover-img` 中。
2. **纯分 P 网格视图**（`.video-pod__list.grid` / `.video-pod__item.page`）：走紧凑角标分支 `.bvh-episode-tag-grid`，挂载到 `el` 右上角。
3. **播放器内选集菜单**（`.bpx-player-ctrl-eplist-multi-menu-item[data-cid]`）：挂载到 `el` 并以 `position: absolute; right: 10px; top: 50%; transform: translateY(-50%)` 右对齐，同时通过 `--bvh-episode-label-space` 为 `.bpx-player-ctrl-eplist-multi-menu-item-text` 预留右侧内边距。
4. **视频页右侧文字型列表**：
   - 纯分 P 列表（`.video-pod__list.multip.list` -> `.simple-base-item.video-pod__item.normal`）
   - 合集单 P 条目（`.video-pod__list.section` -> `.video-pod__item` -> `.single-p > .simple-base-item.normal`）
   - 合集嵌套分 P 子条目（`.video-pod__list.section` -> `.multi-p > .page-list > .simple-base-item.page-item`）

经实测当前 Bilibili 页面 DOM 与计算样式，上述三类右侧文字列表均复用同一 `.simple-base-item` 组件结构：
- 行容器 `.simple-base-item`：`display: flex; flex-direction: row; justify-content: space-between; align-items: center; height: 31px; overflow: visible;`
- 左侧标题区 `.title`：`display: flex; flex: 1 1 0%; align-items: center;`，内部包含 `.playing-gif`（`flex: 0 0 auto`）与 `.title-txt`（`display: flow-root; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis;`）
- 右侧统计/时长区 `.stats`：`flex: 0 0 auto; margin-left: 10px;`，内部包含 `.stat-item.duration`

现有代码（约第 7358–7365 行）将合集单 P/子 P 标签 `appendChild` 到 `.title` 内部，把纯分 P 标签直接 `appendChild` 到 `.title-txt` 内部。因为 `.title-txt` 是 `flex: 0 1 auto`（按文字实际宽度收缩）且带 `overflow: hidden`，导致标签紧贴文字末尾而非靠向 `.stats`，在纯分 P 长标题下甚至会被 `.title-txt` 裁切。

## Goals / Non-Goals

**Goals:**
- 以统一的位置解析辅助方法将所有带时长的文字列表条目（纯分 P 列表、合集单 P、合集嵌套分 P 及通用带 `.stats`/`.duration` 列表变体）的 `.bvh-episode-tag` 插入到时长节点的紧邻左侧。
- 通过最小范围 CSS 保障标签不被压缩、长标题在左侧独立省略截断、经典标签与 SVG 圆环均不溢出或被裁切，且不改写 Bilibili 原生 `.stats` 与无标签行的视觉表现。
- 保持 `processPlaylistItem` 的零写入幂等性能特性，并在 DOM 结构变化或 `.stats` 延后出现时自动校正位置。
- 保持设置页列表预览 `.bvh-preview-episode-row` 与真实页面“标题 — 标签 — 时长”布局一致。

**Non-Goals:**
- 不新增用户配置项（如列表标签左右开关），不修改 `bvh_settings` 或历史存储结构。
- 不改变播放器选集菜单、纯分 P 网格、播单图文封面角标、合集多 P 折叠头及封面视频卡片的既有布局。
- 不在本次变更中扩展对 `/list/` 页面 `.action-list-item-wrap .multip-list-item` 子项的新增打标能力（该类节点当前未纳入 `PLAYLIST_ITEM_SELECTOR`）。

## Decisions

### 1. 使用 DOM 兄弟插入（`insertBefore` 到 `.stats` / `.duration` 之前）而非绝对定位或改写 `.title` 布局

**方案选择：**
在行容器（`.simple-base-item` 或 `el`）中直接查找时长锚点，使用 `parent.insertBefore(tagEl, beforeNode)` 将 `tagEl` 作为与 `.title`、`.stats` 同级的 flex 子项插在时长锚点之前。

**理由：**
- 在 `.simple-base-item` 中，`.title` 原生已为 `flex: 1 1 0%`，`.stats` 为 `flex: 0 0 auto; margin-left: 10px;`。将 `tagEl`（`flex-shrink: 0; margin-left: 6px;`）放在 `.title` 与 `.stats` 之间后：
  - `.title` 自动占满剩余空间并将 `tagEl` 紧推至 `.stats` 左侧，天然形成与时长列平齐的纵向对齐列；
  - 长标题自动在 `.title` / `.title-txt` 内部截断，无需像播放器选集菜单那样手算字符宽度和 `--bvh-episode-label-space`；
  - `.simple-base-item` 为 `align-items: center; overflow: visible`，无论是 9–16px 字号的经典标签还是 20–36px 直径的 SVG 圆环，都会垂直居中且不再受 `.title-txt` 的 `overflow: hidden` 裁切；
  - 无需修改 Bilibili 原生 `.stats` 的样式，不破坏无标签行或带扩展图标的 `.stats` 内容。

**已评估的备选方案：**
- *备选 A：保留在 `.title` 内部，对 `.bvh-episode-tag` 设置 `margin-left: auto`* —— 仍需改写纯分 P 的挂载点（从 `.title-txt` 移到 `.title`），且在部分无 `.title` 外壳只有 `.title-txt` + `.duration` 的变体（如精简 DOM 或既有测试夹具）中不成立；另外把外挂节点放在 `.title` 内不如与 `.stats` 平级来得直观稳定。
- *备选 B：对 `.simple-base-item` 使用 `position: absolute` 固定到右侧* —— 需要动态测量 `.stats`（如 `02:44` 与 `1:23:45` 宽度不同）以及标签自身宽度来同时计算 `right` 与 `.title` 的 `padding-right`，在动态字体缩放、圆环切换和时长宽度变化时更脆弱。

### 2. 统一的挂载位置解析顺序与降级策略

新增 `DOMWatcher.getPlaylistTagPlacement(el, { isGridItem, isPlayerMenuItem })` 返回 `{ parent, beforeNode }`：

1. **网格分 P / 播放器选集菜单**：`{ parent: el, beforeNode: null }`（保持既有逻辑不变）。
2. **定位行容器 `row`**：
   - 若 `el.matches('.simple-base-item')`（覆盖纯分 P 列表 `.simple-base-item.video-pod__item` 与合集嵌套分 P `.simple-base-item.page-item`）：`row = el`。
   - 否则若存在 `el.querySelector('.single-p > .simple-base-item.normal')` 或 `el.querySelector('.simple-base-item.normal')`（覆盖合集单 P 条目）：`row = 该行容器`。
   - 否则：`row = el`（覆盖通用 `.video-pod__item` 变体）。
3. **在 `row` 内定位时长锚点 `anchor`**（仅匹配直接子项或安全范围内节点，避免命中 `.multi-p` 折叠头或深层无关节点）：
   - 优先 `row.querySelector(':scope > .stats')`
   - 其次 `row.querySelector(':scope > .stat-item.duration, :scope > .duration')`
   - 若命中 `anchor` 且其父节点为 `row`：返回 `{ parent: row, beforeNode: anchor }`。
4. **无时长节点时的安全降级**：
   - 优先挂在 `row.querySelector(':scope > .title')`（若有 `.title` 容器，不塞入 `.title-txt` 裁切盒内）；
   - 其次挂在 `row` 自身（仅当行内没有 `.title` 但有 `.title-txt` 且 `row` 为块/弹性容器时，挂在 `row` 或保持兼容；若退化到极简结构如 `<div class="video-pod__item"><span class="title-txt">...</span></div>` 挂在 `row` 末尾仍可在视觉上紧随标题并保留 `el.contains(tag)` 与 `el.querySelector('.bvh-episode-tag')` 兼容）。

### 3. 局部弹性布局 CSS 保护

在 `injectStyles()` 中对列表行标签补充最小且精准的样式规则：
- `.bvh-episode-tag` 增加 `flex-shrink: 0;`（经典标签与圆环在 flex 行中均不被压缩；圆环模式还会由 `TagStyle.apply` 设置 `flex: 0 0 ${diameter}px !important`，两者协同无冲突）。
- 对包含列表标签的 `.simple-base-item` 行（例如 `.simple-base-item > .bvh-episode-tag` 对应的相邻 `.title`，可用 `.simple-base-item:has(> .bvh-episode-tag) > .title { min-width: 0; overflow: hidden; }` 或直接针对 `.simple-base-item > .title` 保持 `min-width: 0`）：确保即便 Bilibili 未来把 `.title` 的 `flex-basis` 从 `0%` 改为 `auto` 或长英文无空格时，标题区也能安全收缩截断，不会把标签和 `.stats` 推出容器。
- 对直接带 `.bvh-episode-tag` 且位于 `.stats` / `.duration` 之前的行标签，保留 `margin-left: 6px; margin-right: 0;`（与 `.stats` 原生 `margin-left: 10px` 衔接；在只有 `.duration` 且无 `margin-left` 的结构下由容器 `gap` 或局部样式保持间隔）。

### 4. 零 DOM 写入幂等校验与自愈

在 `DOMWatcher.processPlaylistItem(el)` 中：
- 提前计算 `placement = this.getPlaylistTagPlacement(el, { isGridItem, isPlayerMenuItem })`；
- 幂等短路条件升级为：
  ```js
  if (
      el._bvhEpisodeSignature === signature &&
      el._bvhEpisodeTag &&
      el.contains(el._bvhEpisodeTag) &&
      el._bvhEpisodeTag.parentNode === placement.parent &&
      el._bvhEpisodeTag.nextSibling === placement.beforeNode
  ) return;
  ```
- 插入时统一使用 `placement.parent.insertBefore(tagEl, placement.beforeNode)`（`beforeNode` 为 `null` 时等价于 `appendChild`）。
- 这样：稳定状态下仍为严格 0 DOM 写入（不触发 MutationObserver 抖动）；若页面框架延迟插入 `.stats` 或调整了子节点顺序，下次刷新自动把标签校正到 `.stats` 之前。

### 5. 设置页列表预览同步

更新 `HistoryManagerPanel.renderSettings()` 中 `.bvh-preview-episode-row`：
- 结构改为：`<span>01 · 下一段旅程</span><span data-preview-episode></span><span class="bvh-preview-episode-duration">12:48</span>`
- 样式调整：标题 `span:first-child` 设为 `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`，`[data-preview-episode]` 保持 `flex-shrink: 0; margin-left: 6px;`，`.bvh-preview-episode-duration` 设为 `flex-shrink: 0; margin-left: 8px; font-size: 11px; color: var(--bvh-muted);`。
- 保留 `[data-preview-episode]` 与 `[data-preview-grid]` 属性不变，兼容 `tag-style-test.mjs` 既有断言与 390px 窄屏无溢出约束。

## Risks / Trade-offs

- [部分自定义皮肤/扩展（如 Evolved 或用户自定义 CSS）改写了 `.simple-base-item` 的 `display` 或 `.title` 的 `flex` 属性] → 通过 `.simple-base-item:has(> .bvh-episode-tag) > .title { min-width: 0; }` 与 `.bvh-episode-tag { flex-shrink: 0; }` 提供防御性保护；即使外层非 flex，DOM 顺序上标签依然紧贴 `.stats` 左侧，不会出现错乱覆盖。
- [极少数无 `.stats` 但使用纯文字行的测试夹具或精简列表] → 无时长锚点时降级至 `:scope > .title` 或 `row` 末尾，不抛异常，并保持 `playlist-test.mjs` 与 `startup-header-test.mjs` 的全部既有语义。
- [Vue 在切换当前播放集时更新 `.simple-base-item` 的 class 或 `playing-gif` 可见性] → 标签作为 `.title` 与 `.stats` 之间的独立兄弟节点挂载，不包裹或修改 Bilibili 原生节点；若 Vue 罕见地替换或移动子节点，升级后的幂等检查会在刷新时自动修复位置且保证单标签不重复。
- [最大字号（16px）经典标签或 36px 圆环在 31px 高列表行中的视觉占比] → `.simple-base-item` 默认 `align-items: center; overflow: visible`，不会裁切标签；需在 Playwright 布局验证中覆盖默认尺寸、16px 经典标签及 27px/36px 圆环组合。

## Migration Plan

纯前端 DOM 定位与 CSS 调整，不涉及任何存储格式、设置字段或数据迁移；回退到旧脚本无需任何清理操作。按仓库规范，实现阶段不自动修改 `@version`、`README.md` 与 `CHANGELOG.md`，留待收尾指令统一处理。
