## Requirements

### Requirement: Retention cleanup controls
The script SHALL provide a retention cleanup control in the history management panel that lets the user enter a numeric retention amount and choose a retention unit of days, months, or years.

#### Scenario: User enters a valid retention period
- **WHEN** the history management panel is open
- **THEN** the user can enter a positive integer retention amount
- **AND** the user can choose one unit from days, months, or years
- **AND** the user can start retention cleanup from the same panel

#### Scenario: User enters an invalid retention amount
- **WHEN** the user starts retention cleanup with an empty value, a non-numeric value, or a value less than 1
- **THEN** the script MUST NOT delete any history records
- **AND** the script MUST show feedback that the retention amount must be numeric

### Requirement: Retention cutoff calculation
The script SHALL calculate a retention cutoff from the current local time and the selected retention amount and unit, then treat records with a valid `savedAt` earlier than that cutoff as deletion candidates.

#### Scenario: Cleanup candidates are older than the cutoff
- **WHEN** the user requests cleanup for a valid retention period
- **THEN** the script MUST compute the actual cutoff time for that retention period
- **AND** records whose valid `savedAt` time is earlier than the cutoff MUST be included as deletion candidates
- **AND** records whose valid `savedAt` time is equal to or later than the cutoff MUST be retained

#### Scenario: Records without a valid saved time are preserved
- **WHEN** a history record has no valid `savedAt` value
- **THEN** the script MUST NOT include that record as a retention cleanup deletion candidate

#### Scenario: Current filters do not limit cleanup
- **WHEN** the user has a search query, status filter, sort order, page, or page size selected in history management
- **THEN** retention cleanup MUST evaluate all stored history records
- **AND** retention cleanup MUST NOT be limited to the currently visible page or filtered rows

### Requirement: Destructive action confirmation
The script SHALL require a second confirmation before deleting retention cleanup candidates.

#### Scenario: Confirmation shows deletion range
- **WHEN** retention cleanup finds one or more deletion candidates
- **THEN** the script MUST show a confirmation dialog before deletion
- **AND** the confirmation dialog MUST state the retention period
- **AND** the confirmation dialog MUST state the cutoff time or older-than time range that will be deleted
- **AND** the confirmation dialog MUST state the number of records expected to be deleted

#### Scenario: User cancels confirmation
- **WHEN** the confirmation dialog is shown
- **AND** the user cancels the confirmation
- **THEN** the script MUST NOT delete any history records

#### Scenario: No matching records
- **WHEN** retention cleanup finds no deletion candidates
- **THEN** the script MUST NOT show a destructive confirmation
- **AND** the script MUST show feedback that no matching history records need to be deleted

### Requirement: Confirmed retention deletion
The script SHALL delete only the confirmed retention cleanup candidates and refresh history-related UI state after deletion.

#### Scenario: User confirms deletion
- **WHEN** the confirmation dialog is shown for retention cleanup candidates
- **AND** the user confirms deletion
- **THEN** the script MUST delete the candidate records from local history storage
- **AND** the script MUST retain records that are within the retention period
- **AND** the script MUST refresh the history list and related statistics or markers through the existing data-change flow
- **AND** the script MUST show feedback with the number of records deleted

#### Scenario: Existing deletion behavior remains available
- **WHEN** retention cleanup is added
- **THEN** single-record deletion, selected-record deletion, import, export, search, filtering, sorting, and pagination in history management MUST continue to work as before
