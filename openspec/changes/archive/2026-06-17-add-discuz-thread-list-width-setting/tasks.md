## 1. Settings Model

- [x] 1.1 Add constants/defaults for thread list width settings in `scripts/Discuz 论坛帖子已读标记与图片预览.js`
- [x] 1.2 Add helper functions to read and validate enabled state, selector, width mode, and width value
- [x] 1.3 Ensure invalid saved settings fall back to safe defaults without modifying existing GM data keys

## 2. Settings Panel

- [x] 2.1 Add a text input helper for selector settings if the existing UI factories do not cover it
- [x] 2.2 Add a “帖子列表宽度” settings section with enable checkbox, selector input, width mode select, and numeric width input
- [x] 2.3 Save the new settings through existing `GM_setValue` flow and preserve the existing save-and-refresh behavior

## 3. Width Application

- [x] 3.1 Implement a function that applies the configured width to matching containers with `querySelectorAll` and invalid-selector handling
- [x] 3.2 Apply percentage values as `%` widths and pixel values as `px` widths
- [x] 3.3 Call the width application only in the existing forum list page branch, not on thread detail pages

## 4. Verification

- [x] 4.1 Run a JavaScript syntax check for the modified userscript
- [x] 4.2 Verify the script header metadata still needs no new `@grant`, `@match`, `@require`, or `@connect`
- [x] 4.3 Manually reason through disabled-default, default `.wp`, custom selector, percentage width, pixel width, invalid selector, and thread-detail-page scenarios

## 5. Site-Level Width Configuration

- [x] 5.1 Keep existing `thread_list_width_*` keys as default width configuration
- [x] 5.2 Add current-site policy state and host-scoped width configuration keys
- [x] 5.3 Update the settings panel so the current site can use default configuration, independent configuration, or disabled mode
- [x] 5.4 Verify effective config resolution for default policy, independent policy, disabled policy, and another host
- [x] 5.5 Replace the current-site override checkbox interaction with a current-site policy dropdown
