## 1. Scope and Tool Shape

- [x] 1.1 Create a project-side development tool location, such as `tools/signin-api-discovery/`, separate from the released userscript.
- [x] 1.2 Define whether the tool runs as a Playwright runner, browser injection helper, or a combination of both.
- [x] 1.3 Define the activation flow for researching one target host or built-in target without changing daily sign-in status.
- [x] 1.4 Document that discovery output is diagnostic evidence, not an auto-promoted API configuration.

## 2. Capture Engine

- [x] 2.1 Capture fetch and XMLHttpRequest metadata during an explicit discovery session.
- [x] 2.2 Capture form submission metadata before navigation, including action, method, field names, hidden fields, and submit context.
- [x] 2.3 Collect static page clues such as likely sign-in buttons, form actions, token field locations, and already-signed text.
- [x] 2.4 Label all captured network requests as candidates until a later site implementation verifies them.

## 3. Redaction and Safety

- [x] 3.1 Add redaction rules for Cookie, Authorization, password-like fields, token-like fields, CSRF values, formhash values, and similar secrets.
- [x] 3.2 Ensure stored and exported reports use the redacted representation only.
- [x] 3.3 Preserve non-secret implementation hints such as field names, value lengths, DOM locations, and host/path context.

## 4. Report Output

- [x] 4.1 Generate a structured report containing target host, capture time, candidate requests, form/page clues, response excerpts, and uncertainty notes.
- [x] 4.2 Mark already-signed or ambiguous sessions as needing future validation rather than confirmed API support.
- [x] 4.3 Provide a convenient way to copy or export the report for later implementation discussion.

## 5. Integration Boundaries

- [x] 5.1 Keep normal daily dashboard UI and one-click sign-in behavior unchanged.
- [x] 5.2 Keep discovery logic out of the released userscript unless a later change explicitly decides otherwise.
- [x] 5.3 Avoid writing success-date records, dashboard status records, or site strategy settings from the discovery workflow.
- [x] 5.4 Do not update `@version`, `README.md`, or `CHANGELOG.md` during development unless the user explicitly requests release cleanup.

## 6. Verification

- [x] 6.1 Verify discovery remains inactive during normal dashboard usage.
- [x] 6.2 Verify a test page/session can capture fetch, XMLHttpRequest, and form submission candidates.
- [x] 6.3 Verify reports do not contain raw Cookie or Authorization values.
- [x] 6.4 Verify an already-signed page still produces useful static clues and clearly marks missing API validation.
- [x] 6.5 Verify disabling or removing the developer tool does not affect existing sign-in data or daily dashboard behavior.
