## ADDED Requirements

### Requirement: Limestart dashboard host
The script SHALL provide the full forum sign-in dashboard only on `https://www.limestart.cn/*` and `https://limestart.cn/*`.

#### Scenario: User opens limestart
- **WHEN** the user opens `https://www.limestart.cn/` or another matched limestart page
- **THEN** the script MUST make the forum sign-in dashboard available from that page
- **AND** the dashboard MUST be independent from limestart's page layout

#### Scenario: User opens a supported sign-in site
- **WHEN** the user opens a supported forum sign-in site other than limestart
- **THEN** the script MUST NOT render the full dashboard UI on that site
- **AND** the script MUST continue running the site's sign-in strategy when applicable

### Requirement: Modern dashboard interface
The dashboard SHALL present a polished, modern control surface for daily sign-in management.

#### Scenario: Dashboard opens
- **WHEN** the user opens the dashboard on limestart
- **THEN** the dashboard MUST show a clear daily summary of successful, failed, pending, and not-started targets
- **AND** the dashboard MUST show each target with its name, status, brief message, latest update time, and available actions
- **AND** the visual layout MUST use clear spacing, status badges, readable typography, and responsive constraints

#### Scenario: Dashboard is viewed on a narrow viewport
- **WHEN** the dashboard is displayed on a narrow browser viewport
- **THEN** the dashboard MUST remain usable without incoherent text or control overlap
- **AND** the site list MUST remain scrollable or reflow into a layout that preserves all primary actions

### Requirement: Configurable launch targets
The dashboard SHALL allow the user to maintain a configurable list of enabled sign-in launch targets.

#### Scenario: User adds a custom target
- **WHEN** the user adds a custom launch target with a display name and valid URL
- **THEN** the dashboard MUST save the target locally
- **AND** the target MUST appear in the dashboard's sign-in target list
- **AND** the target MUST be eligible for one-click opening when enabled

#### Scenario: User disables a target
- **WHEN** the user disables a built-in or custom launch target
- **THEN** the target MUST be excluded from one-click opening
- **AND** the target MUST remain available for later re-enabling unless the user deletes a custom target

#### Scenario: Target is opened but not script-detectable
- **WHEN** a target is configured as opened-pending or manual-confirmation mode
- **THEN** the dashboard MUST NOT mark it successful merely because it was opened
- **AND** the dashboard MUST allow the user to manually mark the target as successful, failed, or skipped for the current day

### Requirement: One-click open for required sign-in sites
The dashboard SHALL provide an action to open all enabled targets that still need user attention for the current day.

#### Scenario: User opens unfinished targets
- **WHEN** the user clicks the one-click open action
- **THEN** the script MUST open enabled targets that are not already successful or skipped for the current day
- **AND** targets configured for opened-pending confirmation MUST be recorded as opened for the current day
- **AND** disabled targets MUST NOT be opened

#### Scenario: Target requires foreground handling
- **WHEN** an enabled target is configured to require foreground handling
- **THEN** the script MUST open that target in a focused or foreground tab when possible
- **AND** the dashboard MUST show that the target may require foreground processing if completion is not detected

### Requirement: Daily status records
The script SHALL record daily dashboard status without breaking existing sign-in success records.

#### Scenario: Script-detected sign-in succeeds
- **WHEN** a supported site's sign-in strategy determines that sign-in succeeded
- **THEN** the script MUST keep recording the success in the existing success-date data
- **AND** the dashboard status for that site MUST show success for the current day

#### Scenario: Sign-in attempt fails
- **WHEN** a supported site's sign-in strategy fails, throws, or reaches a known blocked state
- **THEN** the dashboard status MUST record a non-success status for the current day
- **AND** the status MUST include a short user-readable message or stage when available

#### Scenario: A new day begins
- **WHEN** the dashboard is opened on a date after the last recorded dashboard status
- **THEN** targets without current-day success MUST appear as needing attention for the new day
- **AND** historical success dates in existing storage MUST NOT be erased

### Requirement: SSTM foreground reliability handling
The dashboard SHALL treat SSTM as a foreground-sensitive target.

#### Scenario: One-click opening includes SSTM
- **WHEN** SSTM is enabled and not successful for the current day
- **THEN** one-click opening MUST prefer opening SSTM as a foreground target
- **AND** the dashboard MUST distinguish SSTM from background-safe targets

#### Scenario: SSTM cannot complete in background
- **WHEN** the SSTM strategy cannot find or activate the editor, submit the reply, or verify the reply
- **THEN** the dashboard status MUST communicate that SSTM may need foreground attention or manual inspection
- **AND** the status MUST NOT be reported as successful until the strategy verifies today's sign-in reply
