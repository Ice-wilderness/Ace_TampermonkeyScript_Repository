## 1. History Panel UI

- [x] 1.1 Locate the existing history management toolbar in `scripts/Bilibili视频观看历史记录.js` and identify the smallest safe insertion point for retention cleanup controls.
- [x] 1.2 Add a numeric retention amount input, a unit selector for days/months/years, and a cleanup button to the history management panel using existing `bvh-*` styles.
- [x] 1.3 Add minimal state or DOM reads needed for the retention amount and unit without affecting existing search, status filter, sort, pagination, import, export, or selected-delete controls.

## 2. Retention Logic

- [x] 2.1 Implement validation so the retention amount must be a positive integer composed only of digits; invalid input must show an error toast and stop before scanning or deleting records.
- [x] 2.2 Implement cutoff calculation from current local time using days, months, or years according to the selected unit.
- [x] 2.3 Implement candidate collection across all `StorageManager.getAllRecords()` results, including only records with valid `savedAt` earlier than the cutoff and preserving records with missing or invalid `savedAt`.
- [x] 2.4 Ensure candidate collection is independent of current history search, status filter, sorting, page, and page size.

## 3. Confirmation And Deletion

- [x] 3.1 Show non-destructive feedback and perform no deletion when no records match the retention cleanup range.
- [x] 3.2 Add a second confirmation before deletion that includes the selected retention period, the concrete older-than cutoff/time range, and the expected deletion count.
- [x] 3.3 Ensure cancelling the confirmation performs no storage writes and leaves the history UI unchanged.
- [x] 3.4 On confirmation, delete only the candidate keys by reusing the existing batch deletion flow or a shared helper that preserves undo, data-change notification, selected-state cleanup, and UI refresh behavior.

## 4. Verification

- [x] 4.1 Manually verify invalid values such as empty input, letters, decimals, and `0` do not delete records and show an error.
- [x] 4.2 Manually verify day, month, and year retention ranges calculate and display the expected cutoff time in the confirmation dialog.
- [x] 4.3 Manually verify cancelling confirmation deletes nothing, while confirming deletes only records older than the cutoff and keeps newer records.
- [x] 4.4 Manually verify existing history management functions still work: single delete, selected delete, search, filtering, sorting, pagination, import, export, and statistics refresh.
- [x] 4.5 Confirm no userscript metadata, `@version`, `README.md`, or `CHANGELOG.md` changes are made during implementation unless the user explicitly starts收尾、提交或发布。
