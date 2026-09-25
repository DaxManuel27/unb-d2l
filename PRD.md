# PRD: UNB Course Planner Chrome Extension

**Status:** Local planner implemented; live Brightspace integration and release validation pending  
**Date:** September 24, 2026

## Confirmed MVP scope update

- Privacy is a release requirement: planner data stays in the user's local Chrome profile, with no developer backend, telemetry, cloud sync, remote document processing, or third-party transmission. Network traffic is limited to validated Brightspace reads needed for the planner. Do not persist credentials, authentication cookies, or tokens. Do not place personal course data in logs, test fixtures, or diagnostics; use synthetic or sanitized fixtures. Verify these properties in the packaged extension before release.
- Verify read-only behavior by inspecting extension-originated requests and testing the allowed collection operations. Reject arbitrary destinations and operations; do not call endpoints that intentionally mutate Brightspace state. Verification must cover scans, refresh, submission-status checks, error recovery, and local check-offs. Any operation with unresolved side effects stays disabled until verified. Normal server access logging or automatic viewing records remain outside the extension's control.
- Brightspace access must be read-only wherever technically possible. Request only the Chrome permissions required for validated features. Never submit, edit, delete, mark read, or change completion or other state in Brightspace. Manual check-offs and preferences change extension-local data only. Normal site access may still produce server access logs or automatic viewing records; the extension cannot guarantee otherwise.
- Syllabus processing and review are deferred until after MVP. MVP does not discover or parse syllabus documents, perform OCR, create syllabus candidates, or show a Review needed workflow. Syllabus requirements retained below describe future work, not MVP acceptance requirements.
- MVP collects deadlines from D2L Calendar and accessible activity pages.
- Reminders default to 8 a.m. local on the deadline date for assignments, tests, quizzes, and exams. For timed deadlines at or before 8 a.m., remind one hour before due instead, even if that falls on the previous date. Other activity types are muted by default; students can change settings. No additional 24-hour or one-hour reminders are enabled by default.
- Validate with the product owner's courses first before expanding to a student pilot.
- After a missed reminder, notify once per item if its deadline is still upcoming; skip past deadlines. For date-only items, the due date remains eligible until the next local calendar day. Completion, muting, and delivery deduplication still apply.

This scope update takes precedence over syllabus references in the original detailed specification. Syllabus-only acceptance cases, extraction validation, evidence storage, and review-burden measures are deferred as well.

## Product goal

Give UNB students one reliable, course-organized place to see deadlines, plan their week, check off work, and receive reminders. The proposed MVP reads information the student can already access in UNB D2L Brightspace through their existing signed-in session, without a UNB-registered OAuth application. The technical validation below must prove this access pattern works reliably before implementation proceeds.

## Problem and users

Students find deadlines across D2L Calendar, course activity pages, and syllabuses. A date may appear in one source but not another. In the UNB account inspected for this project, Calendar listed upcoming events while Work To Do said there was no work to do. The extension is for students who want a consolidated view with clear links back to the source.

## MVP interface

The Chrome side panel provides:

1. **Calendar:** Clean month and week views inspired by the clarity of Google Calendar. Events use consistent course colours, concise titles, and readable due times.
2. **To-do:** An agenda of academic deadlines grouped into **Overdue, Today, This week, Next week, and Later**, with optional grouping and filtering by course. This is a view of collected academic items, not a personal task creator.
3. **Settings:** Reminder lead times, notifications by course and activity type, and course visibility.

Students can show all courses or select one. The default view favours current courses; past, future, and training courses remain available through course controls. Each item shows its title, course, **due date and time**, activity type, source, completion state, and a direct link to the D2L item or syllabus. A separate closing or availability date may be shown with its own label; it must never be presented as a due date.

## Course and deadline discovery

The extension discovers course names and IDs available to the student in UNB D2L. It then checks, where accessible:

- D2L Calendar events across enabled course calendars.
- Individual course activity pages for assignments, quizzes, labs, discussions, and other dated items.
- Syllabuses and schedules posted in course Content are deferred until after MVP.

Calendar is the starting source, but the extension also checks activity pages because instructors may create dated items that do not appear in Calendar. Work To Do is not treated as a complete source. Items without a due date can be listed separately if useful, but they do not receive deadline reminders.

### Syllabus search (post-MVP)

The extension searches readable PDF, Word, and web-based syllabus or course-schedule text for assignment, quiz, lab, exam, and other coursework dates. It captures the surrounding wording and document location so the student can verify each finding. It attempts local text recognition for scanned pages where practical. If a file cannot be read or scanned, the extension clearly says so and links to the original document; it never invents a date.

A date found only in a syllabus is labelled **From syllabus**. The student can confirm or correct that candidate. Until confirmed, it appears in the planner but does not trigger a reminder. This is the proposed safety default and remains an open product decision below.

### Merging and date changes

Items from multiple sources are merged when their course and activity identity match. The extension must avoid combining unrelated items that happen to share a name or date. The individual D2L activity's explicit due date takes priority, followed by a linked Calendar due date, then a confirmed syllabus date. Every displayed date retains its source link.

On refresh, if a known item's due date changes, show the new date prominently and the previous date crossed out. Recalculate its reminders. Do not treat an unsuccessful refresh as a deleted item.

## Completion and to-do behaviour

Students can check any item off manually. For assignments, the extension also reads the student's D2L submission status and marks the item complete when D2L explicitly confirms a submission. It does not infer submission merely because an assignment page opens, a grade exists, or a file was selected but not submitted. Before an assignment reminder, recheck submission status if D2L is reachable.

Show whether completion was **Submitted in D2L** or **Checked off by you**. Manual check-offs stay local and do not change D2L. A student can undo a manual check-off. Other activity types remain manually checkable until their D2L completion state is verified reliably.

The MVP has **no personal task creation**.

## Reminders and refresh

Students configure one or more reminder lead times on the Settings page. They can disable reminders for a course or activity type. Completed items do not generate further reminders. Notifications open the relevant D2L item when clicked.

The target is to refresh at least every 30 minutes while Chrome is open and shortly after Chrome starts if the last successful check is stale. This depends on a valid D2L session and must be proven on UNB's site. A student can also refresh manually. Browser sleep or an expired login can delay updates and reminders; the UI shows the last successful check time and any sign-in problem.

When offline after the current student's identity has been verified in this browser session, show the last successful list and keep local check-offs and settings. If signed out, retain cached records but hide them until the student's identity is verified again. Retry on the next scheduled or manual check. Never erase cached deadlines solely because D2L could not be reached.

## Privacy and access

The extension uses the student's existing D2L session and never asks for or stores a UNB password. It processes syllabus text on the student's device and stores only the data needed for the planner locally. It requests access only to `lms.unb.ca`, does not upload course files or deadlines to a developer server, and has no usage telemetry in the MVP. It identifies itself as independent of UNB and D2L. Students can clear the extension's saved data.

The extension only shows course materials and activity information the signed-in student is already permitted to access. It does not bypass hidden content or redistribute course files.

## MVP acceptance criteria

- Current courses can be selected individually or shown together; course names and colours are consistent across views.
- Calendar and To-do views show the same merged D2L deadline set.
- Each deadline has the source's due date and any specified due time, course, source label, and working source link. Closing dates are labelled separately; missing times are never invented.
- A dated activity absent from D2L Calendar can appear when found on its activity page.
- A matching assignment and linked Calendar event appear as one item.
- A changed due date shows the old and new values and updates reminder timing.
- A confirmed D2L assignment submission automatically marks that assignment complete; manual check-offs persist and can be undone.
- Reminder timing and course or activity-type muting can be changed in Settings.
- Last successful results remain visible while offline, and failures show a clear status without deleting cached items.
- Reminders default to day-of delivery for assignments, tests, quizzes, and exams; other activity types start muted.

## Validation before release

Test across several UNB courses with different instructor setups. Compare results against Calendar, Assignments, Quizzes, Discussions, Content, and syllabuses. Verify due-date accuracy, missing-calendar-item coverage, duplicate matching, submission detection, manual completion, date changes, reminders, startup and background refresh, expired sessions, offline behaviour, and readable versus scanned syllabus files. Record any activity type or file format the extension cannot cover.

## Confirmed product decisions

1. Default reminder time is 8 a.m. local, with a one-hour-before exception for timed deadlines at or before 8 a.m.
2. Validate with the product owner first. Broader student testing follows that validation.
3. Access constraint confirmed: technical validation and the extension must keep Brightspace interactions read-only wherever possible, with minimal permissions and no intentional LMS state changes.
4. Missed reminders produce one catch-up notification for a still-upcoming item, never a replay of past-deadline reminders.

## Detailed product specification

The sections below make the MVP requirements precise enough to plan and test. Where Brightspace behavior is uncertain, the requirement states the intended experience and the validation needed before committing to an implementation.

### User journeys

**First use**

1. The student opens the extension while signed in at UNB Brightspace.
2. A short introduction explains that the extension reads accessible course pages, stores planner data locally, and is independent of UNB.
3. The student starts a scan and sees progress by course and source. A partial result can appear before every syllabus has been checked.
4. The student reviews discovered courses, hides irrelevant ones, and chooses reminder settings.
5. Confirmed D2L deadlines populate Calendar and To-do. Syllabus-only findings appear as candidates needing review.

If the student is signed out, the extension links them to the UNB login and offers Retry. It never asks for a password.

**Daily use**

1. Open the side panel to Today and upcoming work.
2. Switch among To-do, Week, and Month; all three use the same collected items.
3. Filter to one course or all visible courses.
4. Open an item to see due information, source evidence, and a link to the original activity or file.
5. Check the item off manually, or see a verified D2L assignment submission automatically mark it complete.

**Reviewing a syllabus date (post-MVP)**

1. A candidate shows the proposed activity title and date, document name, nearby source text, and document link.
2. The student confirms, corrects, or dismisses it.
3. Confirmation or correction turns it into an active deadline; dismissal persists so the same finding does not reappear unchanged after each scan.
4. A candidate that is still unconfirmed cannot generate a reminder.

### Navigation and visual requirements

| Surface | Required behavior |
| --- | --- |
| To-do | Default view. Group items into Overdue, Today, This week, Next week, Later, and Review needed. Show academic items only. |
| Week | Seven-day view or agenda. Distinguish timed deadlines from date-only items. Include week navigation and Today. |
| Month | Month grid with concise course-coloured entries. Overflow opens a readable list for the selected day. |
| Item detail | Show current due date, source, direct link, completion evidence, other dated fields, last checked time, and date-change history. |
| Settings | Course visibility and colours, reminders, scanning status, privacy and data clearing. |

The side panel is the primary surface so a student can keep it open beside Brightspace. Use clear type, quiet surfaces, consistent alignment, keyboard access, and good contrast. Course colour supplements the written course name and is never the only identifier. The interface should remain useful at a narrow side-panel width.

The initial course selection should favour current courses when their active status can be determined. If active status is ambiguous, show the course and let the student hide it. Hiding a course removes it from active views and reminders without deleting its cached records. The same filter must apply to To-do, Week, and Month.

### Date meaning and precision

Every displayed date must retain what the source actually meant:

- **Due date:** Explicitly labelled due by the source, or a student-confirmed syllabus deadline.
- **Start / release date:** When an activity becomes available.
- **End / closing / lock date:** When access or submission closes. This is separate from a due date.
- **Event date:** A Calendar event with no proven due-date meaning.
- **Date only:** A source provides a day but no time; show “time not specified” rather than inventing 11:59 p.m. or midnight.

Show times in the student's local timezone and preserve the source timestamp and zone or offset when available. If Brightspace displays a time without explicit timezone metadata, validate its interpretation on UNB before converting it. A date range in a syllabus needs review; do not automatically select one end as the deadline.

An undated activity may appear in a separate “No due date” area if this does not overwhelm the planner. It cannot receive a due-date reminder.

### Source coverage

**Courses.** Collect the course ID, name, URL, and visibility to the signed-in student. Stable course IDs are used to keep filters, colours, and manual state attached to the right course.

**D2L Calendar.** Collect accessible event title, course, displayed date/time, event link, and linked activity, if any. An event becomes a to-do deadline only when its due-date meaning is clear. Calendar alone is not considered a complete inventory.

**Activity pages.** Inspect accessible Assignments, Quizzes, Discussions, and other dated course activity lists or detail pages. Capture explicit due dates plus separately labelled start/end/availability dates. Record stable activity IDs or URLs to support merging and later refresh. Coverage must be validated per activity type in real UNB courses.

**Syllabuses and schedules.** Search accessible Content for likely course outlines, syllabuses, schedules, weekly plans, and assessment calendars. Search readable PDF, Word, and web text for coursework dates. Try on-device OCR for scanned pages only if accuracy and performance are adequate. A large, protected, corrupt, unsupported, or inaccessible document is marked skipped or unreadable with a link to its source. The extension must not invent a date for it.

The extension should search for assignment, lab, quiz, discussion, exam, presentation, and project dates. It should avoid promoting unrelated dates such as document publication, office hours, reading week, or copyright. Relative dates, missing years, numeric date formats, and tables require careful interpretation or student review.

### Syllabus candidate record and review (post-MVP)

For each proposed finding, keep the course and document, document URL, page or Content location when available, nearby wording, proposed title and activity type, proposed date/time, extraction method (text or OCR), and why review is needed. Store only short evidence snippets needed for review; do not retain full copies of course documents in the planner cache.

Unconfirmed syllabus-only findings go into **Review needed**. They may appear in Calendar with a tentative style, but must never look identical to confirmed deadlines. They generate no reminder or automatic overdue warning. A student can confirm, correct, or dismiss them. A correction retains the original extracted wording so the student can understand why it was proposed.

If a matching D2L activity later provides an explicit due date, that date becomes current. The syllabus finding remains visible as supporting or conflicting evidence.

### Item model and merging rules

Each normalized item needs: a local ID; course ID/name; title; activity type; current due date/time and precision; other dated fields; one or more source references; D2L ID or URL if known; extraction and confirmation state; completion state and evidence; first seen, last seen, last successful check; previous due dates; and reminder delivery state.

Merge records using a shared D2L activity ID or direct activity URL first. A Calendar event linked to that activity can be merged with it. Without a stable ID, use a conservative combination of course, normalized title, type, and nearby date. Ambiguous items stay separate for review. Never merge across courses merely because the titles match, and never silently combine two different activities both called “Quiz 1.”

For one identified activity, the current explicit D2L activity due date has first priority, a linked Calendar due date second, and a confirmed syllabus date third. A student correction to a syllabus candidate applies when no higher-priority explicit date is available. Keep all source claims in the detail view. If sources disagree, show **Date conflict** with each source and date; the active date follows the priority rule but the conflict must be visible.

On a successful refresh, a changed due date updates all views and recalculates pending reminders. Show the current date and previous date in item detail, and mark the item Updated. Avoid repeated alerts for the same unchanged difference. A failed request or expired session is never interpreted as item deletion. If an item disappears from a successfully scanned source, mark it “Not found on latest scan” until a second successful scan confirms removal or the source clearly indicates deletion.

### Completion behavior

Manual check-off is available for every item. It shows **Checked off by you**, can be undone, persists locally, and has no effect on Brightspace.

For assignments, attempt to read the signed-in student's individual submission state. Show **Submitted in D2L** and automatically complete the item only when Brightspace explicitly confirms a completed submission. Visiting an assignment, selecting a file, saving a draft, seeing a grade, or passing the due date is insufficient. If status cannot be read, show Unknown rather than assuming submitted or unsubmitted. Preserve a separate manual check-off if the student used one.

If a later reliable check shows that a submission was withdrawn or is absent, remove automatic completion while retaining any separate manual check-off. The exact states and resubmission behavior need validation on UNB's instance. Quizzes, Discussions, and syllabus-only items remain manually checkable in the MVP unless a trustworthy per-student completion indicator is proven later.

Completed items stop new due-date reminders. Before an assignment reminder, recheck submission status when Brightspace is reachable. If it is not reachable, use the last known completion state but do not claim in notification text that the student has not submitted.

### Reminder rules

Students can set multiple lead times, disable all reminders, mute courses, and mute activity types. Default reminders occur at 8 a.m. local on the deadline date for assignments, tests, quizzes, and exams; other activity types start muted. Timed deadlines at or before 8 a.m. receive one reminder an hour before due instead, including on the previous date if necessary. A date-only reminder time is a **reminder time**, not an invented due time. Do not enable additional 24-hour or one-hour lead times by default.

On resume or startup, deliver at most one missed-reminder notification per eligible item if its deadline is still upcoming. Skip timed deadlines already reached or passed. Date-only items remain eligible on their due date and expire at the start of the next local day. Respect completion, all muting settings, and durable delivery deduplication before any catch-up notification.

A notification includes course, title, and the exact known due date/time, and opens the source when clicked. Deduplicate delivery so refresh or restart does not resend the same reminder. A changed due date invalidates reminders for the old date and schedules new ones. Declining browser notification permission must not block the planner.

The target refresh interval is at least every 30 minutes while Chrome runs, plus a startup check if stale. Show “Last checked” and “Last successful check” separately. Chrome sleep, browser closure, network loss, and a signed-out session can delay scanning or notifications; show that limitation in the UI rather than implying guaranteed delivery.

### Failure and stale-data states

| Situation | Required behavior |
| --- | --- |
| Signed out of UNB Brightspace | Retain cached items but hide them, show Sign in needed, link to UNB, and offer Retry. |
| Offline or temporary request failure | If the student's identity was verified in this browser session, keep showing the last successful list and manual state with a stale label; otherwise hide it until verification. Retry later. |
| One course fails while others succeed | Update successful courses; identify the failed course without clearing its cache. |
| Inaccessible page or file | Respect access controls; show the source could not be checked and provide its link when possible. |
| Unreadable or scanned syllabus | Attempt supported local extraction; otherwise mark unreadable with the original link. |
| Ambiguous date or duplicate | Require review rather than publishing a confident deadline or merging silently. |
| Brightspace layout changes | Detect extraction failure, retain cache, and mark the affected source unverified. |
| Browser closed or device asleep | Reconcile when Chrome resumes; do not promise exact notification delivery. |
| Course becomes unavailable | Retain useful cached history until a successful reconciliation and mark it stale. |

### Privacy and distribution details

The extension reads only course material already accessible to the signed-in student. It must not store a UNB password, authentication cookie, or token as application data. Limit requested host access to the UNB LMS and any file host proven necessary. Treat all course-page and syllabus text as untrusted content for display and extraction; never execute content found in a document.

Keep course titles, deadlines, evidence snippets, completion state, and settings local in the MVP. Clearing data removes those records and reminder history after the student confirms. The extension should clearly disclose that it is independent of UNB and D2L. Chrome Web Store and UNB policy requirements need checking before public distribution.

**Storage decision for MVP:** Persist normalized courses and deadlines, short syllabus evidence snippets, manual completion, reminder settings and delivery history, scan status, and course display preferences in the extension's `chrome.storage.local` area. This is storage in the student's Chrome profile on that device, not a UNB database or a developer server. Do not use `chrome.storage.sync` in the MVP, so the planner does not automatically follow the student to another computer. Keep full downloaded syllabuses and intermediate OCR output out of persistent storage. Do not request unlimited storage unless measured usage proves it necessary.

Restrict access to persisted records to trusted extension contexts where Chrome supports that setting; content scripts should pass extracted data to the extension instead of reading the whole planner cache. On a shared browser profile, never show one student's cached course data to a different signed-in UNB account. Associate saved data with the verified Brightspace user identity and hide prior data until the current identity is confirmed. If the identity cannot be checked, show a sign-in/verification state rather than displaying a previous user's cache.

Local records remain until the student uses **Clear saved data** or removes the extension. Clearing ordinary browsing history should not be presented as a way to erase extension storage. The clear-data action must remove all persisted planner records, settings, snippets, and reminder history for the extension.

### Expanded acceptance scenarios

1. With two accessible courses, the student can show all or one course consistently in To-do, Week, and Month; hiding one course removes its reminders without deleting its cache.
2. A D2L item with an explicit due timestamp shows the same date/time, course, type, and direct source link as Brightspace.
3. An activity absent from Calendar appears when found on its activity page.
4. A closing date and a date-only item are labelled accurately; neither receives an invented due time.
5. A Calendar event and activity linked by a stable ID become one item. Two unrelated “Quiz 1” activities stay separate.
6. A conflict between activity and syllabus dates is visible, while the active date follows the documented priority rule.
7. A changed due date updates all views and future reminders; the old value remains in item detail.
8. Readable syllabus cases produce reviewable candidates with evidence and links. Unconfirmed candidates do not generate reminders. Confirm, correct, and dismiss persist after refresh.
9. An unreadable document produces a clear status, never a fabricated deadline.
10. Manual check-off and undo persist after browser restart and do not modify D2L.
11. A verified assignment submission automatically completes the assignment. Unknown submission state does not.
12. Completed items send no new due-date reminders; reminder lead times and course/type mutes work as configured.
13. Signed-out, offline, and partial-failure scans preserve last successful data; signed-out data remains hidden until identity verification, while an offline student verified in this browser session sees a clear stale indicator.
14. Clearing local data removes cached planner records, snippets, manual state, settings, and reminder history.
15. A different UNB account signed in on the same Chrome profile cannot see the previous student's cached planner data.

### Technical validation before full implementation

With a consenting test account, verify course discovery; Calendar access; assignment, quiz, and discussion date access; Content file reading; per-student assignment submission status; session behavior from a Chrome extension; background refresh; and notification timing. Record the exact accessible pages or interfaces, permissions required, and observed failure modes. If a source cannot be accessed reliably, revise that feature's MVP scope before implementing it.

The test set should include a Calendar-linked assignment, an assignment absent from Calendar, a quiz or discussion with due and closing dates, a date-only item, readable syllabus, scanned syllabus, conflicting dates, changed due date, and confirmed student submission. Compare every displayed confirmed due date with its original D2L page. Resolve known false merges and false automatic completion before release. Test keyboard navigation and narrow side-panel layouts.

### Proposed work sequence

1. Access and feasibility spike on UNB Brightspace.
2. Course discovery, normalized item model, local storage, and source links.
3. Calendar and activity-page collection, merging, conflict display, and change tracking.
4. To-do, Week, Month, course filters, and item detail.
5. Manual completion and verified assignment submission detection.
6. Defer syllabus text extraction, candidate review, and OCR until after MVP.
7. Reminders, Settings, stale states, privacy review, and pilot testing.

### Pilot success measures

- **Coverage:** Share of known test-set deadlines found, reported separately by source type.
- **Accuracy:** Share of confirmed displayed due dates matching their original source. No known wrong date may ship as an unqualified confirmed deadline.
- **Review burden:** Number of syllabus candidates a student must confirm or dismiss per course.
- **Reliability:** Successful refresh rate and frequency of stale or sign-in-needed states.
- **Usefulness:** Whether students can identify upcoming work and open its source faster than their current multi-page workflow.

Record a baseline during the technical spike; do not promise numeric performance before one exists.
