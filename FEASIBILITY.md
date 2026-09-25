# Read-only feasibility record

Status: in progress; full implementation is gated on live extension validation.

## Signed-in inspection and manual reader

The user signed into a different Chrome profile from the initial sign-in tab. Located the signed-in homepage and inspected the following without submitting forms, changing settings, opening assignment submission forms, or starting quiz attempts:

- Homepage: visible course cards link to stable `/d2l/home/{courseId}` routes. This is the currently loaded subset, not proof of complete enrollment discovery.
- Account identity: the navigation's personal-menu Progress link includes a stable user ID at `/d2l/le/userprogress/{userId}/{orgId}/Summary`. The reader scopes identity extraction to that menu rather than arbitrary content links.
- Account Settings: the selected timezone option exposes an IANA timezone value. The initial pilot uses Atlantic time with daylight-saving transitions. No account settings were changed. Assignment timestamps without offsets require this per-account timezone before import.
- Assignment list: `/d2l/lms/dropbox/user/folders_list.d2l` contains explicit Due on text, separately labelled Available until text, and individual completion-status cells. Positive submission counts and Not Submitted are explicit signals. Some closed rows have no stable activity link and are skipped. Grades are not read or used as completion evidence.
- Calendar event detail: `/d2l/le/calendar/{courseId}/event/{eventId}/detailsview` exposes a Due-labelled `abbr[data-date]` epoch and a direct linked activity URL. A sampled event's activity ID matched its assignment-list row. Closing time is displayed separately. Machine timestamps may contain seconds while assignment text has only minute resolution; comparison now respects that precision.
- Quiz list: a visible quiz used a JavaScript summary action and exposed no due date on the list. No attempt was started. Quiz collection remains unsupported until a reliable read-only structure is verified.
- Calendar list: visible dates were available, but inspected list links did not expose stable event destinations as ordinary hrefs. The manual reader therefore accepts individual event details, not the consolidated list. Homepage widgets omit the year and are not promoted to confirmed dates.

Implemented these observed read structures in `extension/brightspace-reader.js` and strict normalization in `extension/brightspace.js`. All reads operate on already-loaded DOM, with no network API, page interaction, credential inspection, or script execution in the LMS main world. The extension requests temporary `activeTab` and `scripting` access. Actual Chrome loading and live reader execution remain pending; static/synthetic validation does not establish that final runtime gate.

Current automated result: 40 tests pass, plus syntax checks. New tests cover timezone conversion, ambiguous/nonexistent DST times, source identity, due/closing separation, account changes, minute-versus-second date matching, and rejection of unsupported pages. A regression test caught and fixed unrelated-page reads incorrectly advancing an item's last-checked time.

## Local implementation completed

- Implemented the side-panel To-do, Week, Month, details, course controls, and Settings views in `extension/`.
- Implemented and tested local storage messaging, account-scoped records, conservative identity merging, date changes/conflicts, manual and explicit observed completion, reminders, muting, catch-up, and delivery identities.
- The standalone browser preview was checked in Chrome at desktop and 360px widths. Verified manual check-off, completed-item visibility, date-conflict detail, month selection structure, settings, and shared hidden-course filtering in Week. No horizontal overflow was found at 360px; no browser console errors or warnings were reported during those checks.
- Actual extension loading, OS notifications, restart persistence in Chrome, and authenticated collection remain unverified. The local browser preview does not exercise those Chrome APIs. Synthetic background tests cover serialized writes, message origin rejection, data clearing, and network-disabled behavior.
- The product extension requests no persistent LMS host access. The manual reader is implemented but not yet exercised in an installed extension. Background collection and notification delivery remain disabled; no real course data has been imported into extension storage.

## Observed

- Opening the UNB LMS in the available daxmanuel.com Chrome profile redirected to the institution's Microsoft sign-in screen. No course page was available at that point. User sign-in is required; no credentials were inspected or stored.
- A minimal manual DOM-inspection probe is prepared in `spike/`. It reports structural counts only, with no network calls or persisted content.
- Automated validation: `npm test` passed all 40 synthetic tests (including the five probe tests); `npm run check` passed JavaScript syntax checks. The 25 planner tests also passed under America/Moncton and America/Vancouver, including daylight-saving dates. These checks do not substitute for actual Chrome network inspection or endpoint validation.

## Coverage and remaining evidence

| Capability | Status | Evidence required |
| --- | --- | --- |
| Signed-in course discovery | Loaded course links observed; manual reader implemented | Installed-extension execution and pagination; distinguish current and other courses |
| Calendar deadlines | Individual linked event structure observed; reader implemented | Installed-extension execution and broader event coverage |
| Assignment dates | Explicit due/closing fields and IDs observed; reader implemented | Installed-extension execution and additional course layouts |
| Quiz and discussion dates | Quiz list inspected; collectors deferred | Reliable dates and identities without starting attempts or changing read state |
| Assignment submission status | Explicit individual submission count and Not Submitted observed | Installed-extension execution; drafts, withdrawal, and group behavior remain unproven |
| Account identity | Personal-menu Progress link observed; scoped reader implemented | Installed-extension execution and account-switch validation |
| Manual probe in actual Chrome | Prepared, not loaded | Successful extension-context read and rejection of other origins |
| No LMS writes or third-party transmission | Static design only | Inspect live network initiators; record sanitized outcomes |
| Background access without LMS tab | Unproven, disabled | Validated read endpoints and session behavior from extension context |
| Restart, sleep, expired session | Pending | Cache preservation and safe reconciliation |
| Notification timing | Pending | Actual Chrome alarm and notification test after access validation |
| Syllabus processing | Deferred | Outside MVP |

No authenticated request endpoints are approved yet. Link-pattern counters in the probe are structural heuristics, not approval to fetch or navigate those destinations. Do not promote a successful DOM read to proof of background collection.

## Handling evidence

Retain sanitized findings only. Do not commit actual course lists, submission details, personal identifiers, document contents, cookies, tokens, raw HTML dumps, or authenticated network captures. Test fixtures use synthetic content. The intended product keeps user data in local extension storage; the current probe does not persist any of it.
# Automatic scanning update

Version 0.2.0 adds opt-in UNB-only host access and a durable, bounded queue of inactive browser tabs. Targets are strictly allowlisted homepage, account timezone, assignment-list, and Calendar-detail routes. Submission, Content, discussion, and quiz-attempt routes are excluded. Only observed discovery links and validated numeric course-home identities are scheduled. Session/account changes abort the queue; partial reads never infer removal. The UI reports partial coverage explicitly. Full enrollment pagination and quiz coverage remain unimplemented. Installed automatic scanning and absence of LMS learning-state changes have **not** yet been verified; notifications remain disabled.
