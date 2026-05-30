## 1. History Page Parsing

- [x] 1.1 Use `temp.html` and the live history page to confirm selectors for `.history-card`, `data-bsb-bvid`, video links, title text, cover stat text, progress CSS variable, and `.bili-video-card__corner span` watch time.
- [x] 1.2 Add a history-page detection helper for `www.bilibili.com/history*` and `www.bilibili.com/account/history*`.
- [x] 1.3 Implement a card parser that extracts normalized video key, per-page `p=` key when present, title, numeric watched percentage, actual `currentTime` when available, and raw watch-time text.
- [x] 1.4 Implement progress parsing for `current/total`, `已看完`, direct percentage text, and `--bili-cover-card-progress-value`.
- [x] 1.5 Implement watch-time conversion to `YYYY-MM-DD HH:mm:ss`, including `今天HH:mm`, `昨天HH:mm`, `MM-DD HH:mm`, and `YYYY-MM-DD HH:mm` cases.
- [x] 1.6 Ensure cards without a supported video key, usable progress, or parseable watch time are skipped and counted.

## 2. Floating Sync Flow

- [x] 2.1 Add a Bilibili history-page floating sync button that is independent from page layout and the script history management toolbar.
- [x] 2.2 Hide or avoid creating the floating sync button on non-history pages.
- [x] 2.3 Implement the first-click flow that syncs the currently loaded history cards and then changes the button to a continue-sync state.
- [x] 2.4 Implement the continue-sync flow that scrolls to the page bottom, waits for card loading or DOM height/card count stability, then syncs currently loaded cards again.
- [x] 2.5 Keep the floating button usable after each sync attempt and show temporary disabled/loading states while syncing or waiting.

## 3. Merge Logic

- [x] 3.1 Implement a sync candidate to local record converter using existing fields: `status`, `currentTime`, `percent`, `savedAt`, and `title`.
- [x] 3.2 Implement the 5 absolute percentage point merge threshold: create missing records, update only when Bilibili progress is more than 5 points longer, and skip records within 5 points.
- [x] 3.3 Preserve existing local records when local progress is longer than Bilibili progress by more than 5 points.
- [x] 3.4 Preserve a non-empty existing title if the Bilibili card title is empty.
- [x] 3.5 Do not fabricate `currentTime` from percentage-only cards; preserve existing non-empty `currentTime` when updating from a candidate without `currentTime`.
- [x] 3.6 Do not update `savedAt` when the progress difference is within 5 percentage points.
- [x] 3.7 Batch-save created and updated records with `StorageManager.saveRecords(records, false)` and trigger one data-change notification after writing.

## 4. Feedback and Refresh

- [x] 4.1 Show progress or toast feedback while syncing, scrolling, and waiting for more history cards.
- [x] 4.2 Summarize created, updated, skipped, failed, and newly loaded/no-new-record counts after each sync attempt.
- [x] 4.3 Refresh the current history management view, statistics, and page markers after successful writes.
- [x] 4.4 Handle continue-sync attempts with no additional loaded cards without throwing errors.

## 5. Verification

- [x] 5.1 Verify syncing a new loaded Bilibili history card creates a local `已观看` record with the watch time from `.bili-video-card__corner span`.
- [x] 5.2 Verify a card URL with `p=6` is stored as the corresponding per-page key instead of the base BV key.
- [x] 5.3 Verify a `current/total` card stores the current-time portion and calculates the expected progress percentage.
- [x] 5.4 Verify a percentage-only or `已看完` card does not fabricate `currentTime`.
- [x] 5.5 Verify an existing local record is updated only when the Bilibili progress is more than 5 percentage points longer.
- [x] 5.6 Verify an existing local record is unchanged, including `savedAt`, when progress difference is 5 percentage points or less.
- [x] 5.7 Verify an existing local record is unchanged when local progress is longer than Bilibili progress by more than 5 percentage points.
- [x] 5.8 Verify invalid or unsupported history cards are skipped without throwing errors.
- [x] 5.9 Verify continuing sync scrolls to the bottom, waits for more cards, and can be repeated.
- [x] 5.10 Verify existing history management actions still work after adding the floating sync control.
- [x] 5.11 Check userscript metadata and confirm no new `@match`, `@grant`, `@require`, or `@connect` entry is needed for the implementation.
