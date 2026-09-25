# UNB Course Planner implementation plan

Status: local planner, manual collector, and opt-in automatic scan queue implemented. The user approved optional UNB-only host access. Version 0.2.0 scans supported discovered pages in inactive tabs, persists progress between pages, and schedules a 30-minute refresh. Signed-in DOM inspection covered homepage, timezone settings, an assignment list, and a linked Calendar event. Installed automatic scanning, complete enrollment/source coverage, and notification delivery remain unverified or incomplete. See FEASIBILITY.md.

## Confirmed scope changes

- User privacy and verified read-only access are release gates. Keep planner records in the user's local Chrome profile. No backend, telemetry, cloud sync, external processing, third-party data transmission, or persisted authentication secrets. Use synthetic or sanitized fixtures and keep personal course data out of diagnostic logs.
- Keep Brightspace access read-only wherever technically possible, during both validation and normal use. Minimize Chrome permissions and document why each is necessary. Do not intentionally change LMS state, including submissions, completion, read status, or course settings. Local planner changes remain permitted. Ordinary reads may still cause server logging or automatic view tracking.
- Defer the entire syllabus workflow until after MVP, including discovery, extraction, OCR, candidates, review UI, and syllabus acceptance tests. References to syllabus architecture and decisions below are future considerations only.
- Default to 8 a.m. local on the due date for assignments, tests, quizzes, and exams. For timed deadlines at or before 8 a.m., use one hour before due instead, including the previous date when necessary. Mute other types by default. No additional lead-time reminders are enabled by default.
- Validate with the product owner's courses first, before a broader student pilot.
- On resume, send at most one catch-up reminder per eligible upcoming item and skip past deadlines. Date-only items remain eligible through their local due date. Preserve completion, muting, and deduplication rules.

## Review findings

The workspace contains a directly loadable side-panel extension, local persistence, domain/reconciliation/reminder rules, a manual reader for specific already-loaded LMS pages, a separate structural probe, and synthetic tests. The first collection path uses temporary active-tab scripting, not authenticated network calls. No background fetch endpoints have been approved. Manual collection is explicitly partial and does not meet the 30-minute full-sync requirement yet.

The user has deferred syllabus review and set day-of reminder defaults. The PRD's confirmed scope update supersedes its retained future syllabus specifications.

## Clarification status

No blocking product questions remain. The next gate is technical: validate read-only collection and session behavior against the product owner's courses. The remaining recommendations below are implementation defaults; confirmed decisions above take precedence.

## Proposed decisions for remaining gaps

These are recommendations, not approved changes to the PRD.

- Calendar events without deadline meaning appear in Week and Month as events; To-do contains deadlines only. All views use the same underlying records with explicit view eligibility. This clarifies the requirement for the same merged set across views.
- Unconfirmed syllabus findings initially appear only in Review needed. Tentative calendar entries can follow if useful.
- Default to a Monday-start week and a seven-day agenda at narrow widths. Group deadlines into mutually exclusive buckets in local time. Date-only items become overdue the day after their date.
- Completed items remain accessible through a Show completed control and leave active overdue groups.
- On resume, combine missed reminder thresholds into at most one notification per still-upcoming item. Do not replay reminders for deadlines already passed. Persist reconciliation state to avoid repeated catch-up notices.
- For changed deadlines already inside a reminder window, apply the same single-notification catch-up rule. Suppress old scheduled reminders using a due-date revision identifier.
- A date change does not undo a manual check-off. Keep Updated visible in item detail, including for completed items.
- Removal requires two complete, successful scans of the relevant source inventory. Partial scans never count. Archive records missing from every authoritative source; preserve manual state and history and stop their reminders. A surviving valid source keeps the item active.
- Isolate cached data by a verified account identifier. On an account change, stop the prior account's scans and reminders and never show its records in the new account. If identity cannot be verified, pause authenticated reconciliation. Signed-out use can retain the last account's cache as specified in the PRD.
- Initially request only lms.unb.ca host access. If required syllabus files use another host, record the limitation and resolve the PRD's conflicting host-access wording before expanding permissions.
- Use bounded syllabus processing with cancellation, file/page limits, and explicit skip reasons. Set concrete limits from the feasibility samples. Avoid re-extracting unchanged documents on every 30-minute scan.
- A changed syllabus excerpt or date creates a new review revision; unchanged dismissed candidates remain dismissed. Keep previous confirmation and evidence until the new revision is reviewed.

## Proposed architecture

- Implemented with dependency-free native JavaScript modules and a Manifest V3 side panel. This keeps the current small UI directly loadable and avoids introducing a build toolchain before source integration. TypeScript/React/Vite remain an option if later complexity warrants them.
- Background service worker coordinates bounded scans, reconciliation, reminder scheduling, and notifications. Persist progress and delivery state so worker suspension does not lose work.
- Source adapters separately implement course discovery, Calendar, Assignments, Quizzes, Discussions, and Content. Choose authenticated extension requests or LMS content-script access only after observing what works; do not assume undocumented endpoints or session-cookie behavior.
- Pure domain modules normalize source claims, distinguish date meanings and precision, resolve identities, merge evidence, track changes, derive completion, and calculate reminders.
- Versioned local storage holds account-scoped courses, source claims, normalized items, candidates, user overrides, scan outcomes, and notification delivery records. Do not use cloud-synced storage.
- Manual completion and observed D2L completion remain separate fields. Unknown observations do not overwrite reliable prior submission evidence; display its age and uncertainty.
- Document extraction runs locally outside the service worker when necessary, with packaged parser assets. Select PDF and .docx libraries after checking compatibility and fixtures; no remote runtime code or document uploads.
- Validate message senders and payloads, restrict fetch targets and source links, and render untrusted excerpts as text.
- Expose only specific validated read operations in collection adapters and extension messaging, never an arbitrary authenticated request proxy. Allowlist destinations and observed read endpoints. Evaluate endpoint semantics, not just HTTP verbs: a GET can have side effects, and some read interfaces use POST. Exclude operations with intentional LMS mutations. Avoid broad host access, cookie-reading permissions, and credential extraction. Chrome host permissions are not inherently read-only; enforce read-only behavior in application code and verify network activity during the spike.
- Initial permissions: sidePanel, storage, alarms, notifications, and the LMS host. Add scripting or offscreen only if the validated collection/extraction approach requires them.

## Implementation phases and exit gates

### 0. Access and feasibility spike

Build the smallest unpacked extension that can exercise read-only LMS access from an actual extension context. Inspect representative courses and record source URLs/interfaces, pagination, date semantics, account identity, submission evidence, and required permissions. Test with and without an open LMS tab, an expired session, and a restarted browser.

Produce a coverage matrix and sanitized test fixtures. Include Calendar-linked and unlisted assignments, due versus closing dates, date-only items, quizzes/discussions, readable and scanned documents, and explicit submission evidence. Never include cookies, tokens, or full student documents in fixtures.

Exit: observed support or a documented limitation for every source. Resolve unsupported mandatory features before committing to the full build. Demonstrate a background scan and a notification; a normal browser-page read alone does not establish extension feasibility.

### 1. Domain model and persistence

Implement source-claim provenance, timestamp versus calendar-date types, account isolation, stable identities, versioned persistence, and separate user/observed completion state. Create fixtures and meaningful unit tests for false merges, source priority, conflicts, date-only handling, timezone boundaries, and failed-scan preservation.

Exit: domain rules work against sanitized fixtures without UI or live network dependencies.

### 2. Collection and reconciliation

Implement validated course and activity adapters, source-specific scan outcomes, conservative merging, conflict evidence, date history, and removal reconciliation. Bound concurrency and retries; prevent overlapping scans. Preserve local actions made while a scan runs.

Exit: representative live deadlines match their source and repeated scans are idempotent. Partial failure cannot delete records or overwrite check-offs.

### 3. Side-panel planner

Build onboarding, To-do, a narrow-width Week agenda, Month, shared course controls, item detail, and Settings. Include loading, empty, stale, signed-out, source-failure, conflict, and Updated states. Apply the installed design skills during this phase.

Exit: keyboard navigation, readable narrow layouts, consistent filters, source links, accurate date labels, and persistent manual completion work in an unpacked extension.

### 4. Verified assignment completion

Integrate only the submission states proven by phase 0. Preserve manual overrides, reverse automatic completion only on explicit reliable evidence, and expose unknown/stale status.

Exit: submitted, draft, unknown, withdrawn, and resubmitted cases never produce false automatic completion.

### Deferred phase: Syllabus discovery and review (post-MVP)

Discover likely documents, extract readable PDF/.docx/web text locally, and produce conservative candidates with short evidence snippets and source locations. Implement confirm, correct, dismiss, document revisions, and persistent review state. Attempt OCR only if included in approved scope and validated for performance and accuracy.

Exit: readable fixtures yield traceable review candidates; unsupported or ambiguous cases never become confident deadlines. Unconfirmed candidates cannot enter reminder scheduling.

### 5. Reminders and recovery

Implement day-of defaults for assignments, tests, quizzes, and exams, configurable lead times and reminder clock, course/type/global muting, submission rechecks, durable delivery deduplication, startup reconciliation, and missed-reminder behavior. Other activity types start muted. Reconcile schedules after date changes, completion, visibility changes, and settings edits. Preserve the underlying D2L activity type separately from its assessment category so, for example, an exam delivered through the Quiz tool can be classified without losing source identity; ambiguous categories need explicit handling during the spike.

Exit: restart, sleep, offline, expired login, notification denial, and changed-deadline tests do not generate obsolete or repeated notifications. Clearing data cancels scheduled work and prevents in-flight scans from repopulating storage.

### 6. Pilot and release review

Audit the packaged extension's permissions and network traffic during scans, refresh, submission checks, retries, and local check-offs. Confirm that only validated LMS read operations occur, local actions never issue LMS writes, and no planner data reaches third parties. Test that unknown operations and destinations are rejected. Keep operations with unverified side effects disabled. Do not retain raw authenticated traffic captures containing cookies, tokens, or student content in the repository or deliverables; record sanitized findings. Verify local-only storage, account isolation, and complete data clearing, including alarms and in-flight work. Record evidence and any limitations in the release checklist; do not describe Chrome host permissions as technically read-only.

Run the applicable D2L-only PRD acceptance scenarios against several course configurations. Defer syllabus extraction, syllabus conflicts, unreadable-document cases, and review-burden measures. Test conflicts using activity and linked Calendar claims instead. Record coverage, accuracy, refresh reliability, and limitations. Check distribution and privacy requirements before any public release.

Exit: no known false automatic completion, false merges, or unqualified wrong dates. Deliver an unpacked build, installation instructions, coverage matrix, and limitations. Public store submission is a separate release action.

## Platform references

- Side panel: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Alarm scheduling and lifecycle considerations: https://developer.chrome.com/docs/extensions/reference/api/alarms
- Extension network access and host permissions: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

These describe Chrome capabilities; they do not prove UNB session access. That remains phase 0's central gate.
