## Purpose

Define configurable Discuz thread list page width control, including default settings, current-site policy, target selector, width mode, and list-page-only application.

## Requirements

### Requirement: Width control is disabled by default
The script SHALL provide a thread list width control setting that is disabled by default.

#### Scenario: Existing user opens a forum list page
- **WHEN** the user has not enabled thread list width control
- **THEN** the script MUST NOT change the forum page container width
- **AND** existing visited marking and image preview behavior MUST continue unchanged

#### Scenario: User opens settings
- **WHEN** the user opens the Discuz helper settings panel
- **THEN** the panel MUST show a thread list width control option in the disabled state unless the user previously enabled it

### Requirement: Width control target selector is configurable
The script SHALL allow users to choose which page container receives the width style.

#### Scenario: User keeps the default selector
- **WHEN** thread list width control is enabled and the selector setting is empty or unset
- **THEN** the script MUST target `.wp` as the default container selector

#### Scenario: User configures a custom selector
- **WHEN** the user saves a non-empty custom selector for thread list width control
- **THEN** the script MUST use that selector when applying the width style

#### Scenario: Selector is invalid or unmatched
- **WHEN** the configured selector is invalid or matches no element on the current page
- **THEN** the script MUST leave the page layout unchanged
- **AND** the script MUST continue running other list page features without throwing an uncaught error

### Requirement: Width control supports default and site-level settings
The script SHALL support a default thread list width configuration and a current-site policy for selecting how that site handles width control.

#### Scenario: Current site uses default configuration
- **WHEN** the current site's width policy is set to use the default configuration
- **THEN** the script MUST use the default thread list width configuration

#### Scenario: Current site uses independent configuration
- **WHEN** the current site's width policy is set to independent configuration
- **THEN** the script MUST use the current site's thread list width configuration
- **AND** the script MUST apply width control on the current site
- **AND** saving the current site configuration MUST NOT overwrite the default width configuration

#### Scenario: Current site disables width control independently
- **WHEN** the current site's width policy is set to not enabled
- **THEN** the script MUST NOT apply width control on the current site
- **AND** this MUST remain true even when the default width configuration is enabled

#### Scenario: Another site is opened
- **WHEN** a different site is opened
- **THEN** that site MUST NOT use the previous site's current-site policy or independent width settings

#### Scenario: User opens settings
- **WHEN** the user opens the Discuz helper settings panel
- **THEN** the panel MUST provide a current-site policy dropdown with options for using default configuration, using independent configuration, and not enabling width control

### Requirement: Width control supports percentage and pixel modes
The script SHALL support both percentage width and fixed pixel width settings.

#### Scenario: Percentage width is selected
- **WHEN** thread list width control is enabled with percentage mode and a valid numeric value
- **THEN** the script MUST apply the target container width using a percent value

#### Scenario: Pixel width is selected
- **WHEN** thread list width control is enabled with pixel mode and a valid numeric value
- **THEN** the script MUST apply the target container width using a pixel value

#### Scenario: Width value is invalid
- **WHEN** the saved width value is missing, non-numeric, or outside the supported range
- **THEN** the script MUST fall back to the default width value for the selected mode

### Requirement: Width control applies only to thread list pages
The script SHALL apply thread list width control only on Discuz thread list pages.

#### Scenario: User opens a thread list page
- **WHEN** the current URL is detected as a Discuz forum list page
- **AND** thread list width control is enabled
- **THEN** the script MUST apply the configured width to the configured target container

#### Scenario: User opens a thread detail page
- **WHEN** the current URL is detected as a Discuz thread detail page
- **THEN** the script MUST NOT apply thread list width control
