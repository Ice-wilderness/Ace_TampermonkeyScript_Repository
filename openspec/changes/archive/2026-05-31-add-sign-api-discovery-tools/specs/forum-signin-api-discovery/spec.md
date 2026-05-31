## ADDED Requirements

### Requirement: Developer-only discovery workflow
The project SHALL provide an API discovery workflow as a project-side development tool intended for maintenance of forum sign-in strategies, not as code embedded in the normal userscript.

#### Scenario: Developer enables discovery for a target site
- **WHEN** a developer starts discovery while researching a specific forum sign-in target
- **THEN** the tool MUST indicate which target or host is being investigated
- **AND** the tool MUST NOT change the user's daily sign-in status records
- **AND** the normal forum sign-in dashboard and released userscript MUST NOT expose this as a regular user-facing feature

#### Scenario: Normal user runs the sign-in dashboard
- **WHEN** the user uses the existing daily sign-in dashboard without explicitly enabling developer discovery
- **THEN** the released userscript MUST NOT capture API candidates
- **AND** the released userscript MUST NOT show discovery controls or candidate management UI

### Requirement: Request and form evidence capture
The discovery workflow SHALL collect evidence useful for implementing a site's sign-in strategy.

#### Scenario: Page sends network requests during discovery
- **WHEN** the investigated page sends fetch or XMLHttpRequest requests while discovery is active
- **THEN** the tool MUST capture candidate request metadata including method, URL, timestamp, request summary, response status when available, and response excerpt when available
- **AND** the captured request MUST be labelled as a candidate rather than a verified sign-in API

#### Scenario: Page submits a form during discovery
- **WHEN** the investigated page submits a form while discovery is active
- **THEN** the tool MUST capture the form action, method, field names, hidden fields, and submit trigger context when available
- **AND** the capture MUST happen before navigation can erase the page context

#### Scenario: Page is already signed in for the day
- **WHEN** no sign-in submission request occurs because the account has already signed in
- **THEN** the tool MUST still collect static page clues such as sign-in buttons, form actions, hidden token fields, and already-signed text
- **AND** the report MUST state that no unambiguous sign-in request was verified in this session

### Requirement: Sensitive data redaction
The discovery workflow SHALL avoid storing or exporting sensitive account credentials and session secrets.

#### Scenario: Captured data contains sensitive fields
- **WHEN** captured request, form, or header data includes cookies, authorization values, passwords, token-like fields, CSRF values, formhash values, or similar secrets
- **THEN** the tool MUST mask or omit the sensitive value before storage or export
- **AND** the report MUST retain enough non-secret context such as field name, value length, and source location to support later implementation

#### Scenario: Developer exports a report
- **WHEN** a developer exports or copies the discovery report
- **THEN** the exported report MUST use the redacted representation
- **AND** it MUST NOT contain raw Cookie or Authorization header values

### Requirement: Structured diagnostic reports
The discovery workflow SHALL produce a structured report that can guide later site implementation work.

#### Scenario: Developer generates report
- **WHEN** the developer generates a discovery report
- **THEN** the report MUST include investigated host or target, capture time, candidate requests, form/page clues, possible success or already-signed text, and uncertainty notes
- **AND** the report MUST be usable as implementation context without automatically modifying `siteConfigs`

#### Scenario: Candidate requires future validation
- **WHEN** a captured candidate cannot be confirmed because the account was already signed in or the response is ambiguous
- **THEN** the report MUST mark the candidate as needing future validation
- **AND** the report MUST NOT describe the candidate as a confirmed API

### Requirement: Handoff to site implementation
The discovery workflow SHALL support later implementation without directly implementing the site's sign-in logic.

#### Scenario: Developer uses report to implement a site
- **WHEN** a developer later implements or updates a site's sign-in strategy using the report
- **THEN** the site implementation MUST still perform its own conservative success validation
- **AND** any required userscript permissions, such as `@connect`, MUST be reviewed during that implementation work

#### Scenario: Discovery tool is disabled or removed
- **WHEN** the developer discovery tool is disabled, removed, or not installed
- **THEN** existing daily sign-in behavior and stored sign-in success dates MUST remain unaffected
