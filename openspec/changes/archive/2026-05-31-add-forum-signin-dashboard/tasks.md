## 1. Entry And Data Model

- [x] 1.1 Add limestart userscript matching metadata and route execution so the full dashboard initializes only on `limestart.cn`.
- [x] 1.2 Extend built-in site definitions with dashboard launch metadata such as entry URL, open mode, result mode, and dashboard visibility.
- [x] 1.3 Add storage helpers for dashboard configuration, custom launch targets, and current-day status records while preserving existing `BBSSignHelperData`.
- [x] 1.4 Add status normalization so existing success dates are reflected as current-day dashboard success without erasing historical data.

## 2. Dashboard UI

- [x] 2.1 Add a limestart dashboard entry point through a floating button and an oilmonkey menu command.
- [x] 2.2 Build the dashboard modal with daily summary counts, target list, status badges, messages, timestamps, and per-target actions.
- [x] 2.3 Add polished responsive styling with clear hierarchy, modern spacing, state colors, and no text/control overlap on narrow viewports.
- [x] 2.4 Build the custom target configuration UI for adding, editing, enabling/disabling, and deleting user-defined launch targets.

## 3. Launch And Status Flow

- [x] 3.1 Implement one-click opening for enabled current-day unfinished targets while excluding successful, skipped, disabled, and manual-only targets.
- [x] 3.2 Respect each target's open mode by opening foreground-sensitive targets in a focused tab and background-safe targets in background tabs when possible.
- [x] 3.3 Record opened-pending status for targets that cannot be script-verified and expose manual success, failure, and skipped actions.
- [x] 3.4 Refresh dashboard state after launch actions and manual status changes without requiring a full page reload.

## 4. Sign-in Strategy Integration

- [x] 4.1 Update the sign-in engine to write dashboard success status when a supported site strategy returns success.
- [x] 4.2 Record failed or blocked outcomes with short user-readable messages when strategies return false, throw errors, or detect login/manual requirements.
- [x] 4.3 Mark SSTM as foreground-sensitive and surface editor, submit, or verification failures as needing foreground attention.
- [x] 4.4 Ensure supported forum pages continue signing automatically without rendering the full dashboard UI.

## 5. Verification And Finish

- [x] 5.1 Run a syntax check or the narrowest available script validation for `scripts/自用论坛辅助签到自写.js`.
- [x] 5.2 Manually inspect the limestart dashboard UI at desktop and narrow viewport sizes for readability, spacing, and action availability.
- [x] 5.3 Manually verify one-click opening behavior with at least one background-safe built-in target, one opened-pending custom target, and SSTM foreground handling.
- [x] 5.4 Review userscript metadata, `@grant` usage, README needs, CHANGELOG needs, and `@version` according to the repository's收尾 rules before final release or commit.
