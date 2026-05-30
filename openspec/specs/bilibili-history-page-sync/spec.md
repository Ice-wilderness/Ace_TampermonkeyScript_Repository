# bilibili-history-page-sync Specification

## Purpose
TBD - created by archiving change sync-bilibili-history-records. Update Purpose after archive.
## Requirements
### Requirement: Floating history sync control
The script SHALL provide a floating synchronization control on Bilibili history pages for syncing currently loaded history cards.

#### Scenario: User opens a Bilibili history page
- **WHEN** the user opens `https://www.bilibili.com/history*` or `https://www.bilibili.com/account/history*`
- **THEN** the script MUST show a floating sync button for Bilibili history records
- **AND** the button MUST be independent from the Bilibili page layout and the script history management toolbar
- **AND** the initial button action MUST communicate that it will sync the currently loaded page records

#### Scenario: User opens a non-history page
- **WHEN** the user opens any matched page that is not a Bilibili history page
- **THEN** the script MUST NOT show the floating Bilibili history sync button
- **AND** the script MUST NOT start history synchronization from that page

### Requirement: Incremental continue-sync flow
The script SHALL use repeated button clicks to sync currently loaded history cards and then continue by loading more page content.

#### Scenario: User clicks sync for the first time
- **WHEN** the user clicks the floating sync button for the first time on a Bilibili history page
- **THEN** the script MUST sync the history cards currently loaded in the page DOM
- **AND** after the sync attempt completes, the button MUST change to a continue-sync state

#### Scenario: User clicks continue sync
- **WHEN** the user clicks the floating button again after an initial sync
- **THEN** the script MUST scroll the Bilibili history page to the bottom
- **AND** the script MUST wait until additional history cards finish loading or the page becomes stable
- **AND** the script MUST run synchronization again against the currently loaded cards
- **AND** after the sync attempt completes, the button MUST remain available for another continue-sync click

#### Scenario: Continue sync loads no additional cards
- **WHEN** the user clicks continue sync
- **AND** scrolling and waiting do not add any new history cards
- **THEN** the script MUST still complete without throwing errors
- **AND** the script MUST show feedback that no new writable records were found or that no additional records loaded

### Requirement: Loaded history card extraction
The script SHALL extract synchronizable video records from currently loaded Bilibili history cards.

#### Scenario: Card contains a video link and progress
- **WHEN** a loaded Bilibili history card contains a video URL with a BV, av, or supported page key
- **AND** the card exposes a valid watched percentage, a valid watched-time/total-time pair, or an `已看完` state
- **THEN** the script MUST create a sync candidate with the normalized script video key
- **AND** the candidate MUST include the card title when available
- **AND** the candidate MUST include a numeric watched percentage

#### Scenario: Card link contains a page parameter
- **WHEN** a loaded Bilibili history card links to a video URL with a valid `p=` query parameter
- **THEN** the script MUST sync the candidate to the corresponding per-page key such as `BVxxxxxxxxxx?p=6`
- **AND** the script MUST NOT collapse that candidate to the base BV key

#### Scenario: Card has only a base BV
- **WHEN** a loaded Bilibili history card exposes a base BV but no valid `p=` query parameter
- **THEN** the script MUST sync the candidate to the base BV key
- **AND** the script MUST NOT guess a per-page key

#### Scenario: Card cannot produce a script video key
- **WHEN** a loaded Bilibili history card does not contain a supported video key
- **THEN** the script MUST skip that card
- **AND** the script MUST NOT create a local history record for that card

#### Scenario: Card has no usable progress
- **WHEN** a loaded Bilibili history card does not expose a valid watched percentage, watched-time/total-time pair, or `已看完` state
- **THEN** the script MUST skip that card
- **AND** the script MUST include the skipped card in the sync result summary

### Requirement: History card watch time
The script SHALL use the watch time displayed beside the device icon on the Bilibili history card as the synchronized record time.

#### Scenario: Card watch time is parseable
- **WHEN** a sync candidate has a parseable watch time from the card position beside the device icon
- **THEN** the script MUST store that time as the local record `savedAt`
- **AND** the stored time MUST use the existing `YYYY-MM-DD HH:mm:ss` format

#### Scenario: Card watch time is not parseable
- **WHEN** a loaded Bilibili history card has progress data but its device-icon time cannot be converted to a reliable absolute time
- **THEN** the script MUST skip that card
- **AND** the script MUST NOT replace the time with the current time

### Requirement: Current time handling
The script SHALL only store a `currentTime` value when the Bilibili history card exposes an actual watched-time text.

#### Scenario: Card exposes current and total time
- **WHEN** a loaded Bilibili history card exposes a watched-time/total-time pair such as `01:01:14/01:17:14`
- **THEN** the sync candidate MUST use the watched-time portion as `currentTime`
- **AND** the candidate MUST use the same pair to calculate watched percentage when a direct percentage is unavailable

#### Scenario: Card exposes only percentage or finished state
- **WHEN** a loaded Bilibili history card exposes only a percentage or `已看完`
- **THEN** the script MUST NOT fabricate a `currentTime` value from the percentage
- **AND** when updating an existing local record, the script MUST preserve the existing non-empty `currentTime` if the candidate has no `currentTime`

### Requirement: Progress merge policy
The script SHALL merge Bilibili history sync candidates with local script records by preserving the longer watched progress.

#### Scenario: Local record does not exist
- **WHEN** a sync candidate has no existing local script record
- **THEN** the script MUST save a new local record using the candidate key, title, progress, actual current-time position when available, and watch time
- **AND** the new record status MUST be `已观看`

#### Scenario: Bilibili progress is longer by more than five percentage points
- **WHEN** a sync candidate matches an existing local record
- **AND** the candidate watched percentage is more than 5 percentage points greater than the local watched percentage
- **THEN** the script MUST update the local record to the candidate progress and watch time
- **AND** the script MUST preserve a non-empty existing title when the candidate title is empty
- **AND** the script MUST preserve a non-empty existing `currentTime` when the candidate has no `currentTime`

#### Scenario: Progress difference is within five percentage points
- **WHEN** a sync candidate matches an existing local record
- **AND** the absolute difference between candidate watched percentage and local watched percentage is 5 percentage points or less
- **THEN** the script MUST skip writing that record
- **AND** the local record MUST remain unchanged, including its existing watch time

#### Scenario: Local progress is longer by more than five percentage points
- **WHEN** a sync candidate matches an existing local record
- **AND** the local watched percentage is more than 5 percentage points greater than the candidate watched percentage
- **THEN** the script MUST skip writing that record
- **AND** the local record MUST remain unchanged

### Requirement: Sync result feedback and refresh
The script SHALL report synchronization results and refresh history-related local UI state after writing records.

#### Scenario: Sync writes one or more records
- **WHEN** synchronization creates or updates one or more local records
- **THEN** the script MUST batch-save the written records
- **AND** the script MUST refresh the history management list, statistics, and page markers through the existing data-change flow
- **AND** the script MUST show feedback containing created, updated, skipped, and failed counts

#### Scenario: Sync finds no writable records
- **WHEN** synchronization completes without creating or updating any local records
- **THEN** the script MUST NOT call the local batch-save path
- **AND** the script MUST show feedback explaining that no records needed synchronization

#### Scenario: User syncs after loading more history cards
- **WHEN** the user clicks continue sync after additional cards load
- **THEN** the script MUST evaluate the newly loaded cards as well as already loaded cards
- **AND** records already synchronized within the 5 percentage point threshold MUST be skipped

