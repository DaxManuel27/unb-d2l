# UNB Course Planner

The local planner and a manual collector for already-open Brightspace pages are implemented. The collector is based on observed UNB page structures; actual installed-extension verification remains pending. Full background syncing is not enabled. See FEASIBILITY.md for evidence and remaining checks.

## Planner implementation

`extension/` is the unpacked Manifest V3 extension, with no runtime dependencies or build step. It includes:

- To-do groups, a seven-day agenda, a month calendar with selected-day details, and shared course filters.
- Manual check-off/undo, completed-item visibility, per-course visibility, colors, and muting.
- Settings for 8 a.m. day-of reminders, additional lead times, and activity-type muting.
- A tested domain model for source identity, date precision, conflicts, change history, account isolation, explicit submission evidence, and partial-scan reconciliation.
- A local Chrome storage boundary, serialized background actions, data clearing, and reminder calculation/deduplication.
- An explicitly labeled fictional preview. Preview records exist only in memory and never enter saved account data or notifications.

**Manual page collector:** reads course links and account identity from a loaded homepage, the timezone from Account Settings, dated assignments and explicit submission status from assignment lists, and linked deadlines from individual Calendar event details. It only inspects existing DOM in an isolated script context. It does not navigate pages, click controls, start attempts, submit work, fetch data, read credentials, or read arbitrary Content pages. Unsupported layouts, missing stable IDs, unknown timezones, and ambiguous dates are skipped with a status message. Every manual read is partial and cannot delete missing records.

**Not implemented or enabled yet:** complete multi-course discovery, Calendar list ingestion, quizzes/discussions collection, authenticated background refresh, live pre-reminder submission rechecks, and notification delivery. The extension has no persistent LMS host access and blocks outgoing connections. The scheduler and notification integration remain gated off by `COLLECTION_ENABLED`; changing that flag alone is not a valid integration. Do not enable it until source coverage, pre-reminder checks, notification permissions, and live network behavior pass validation.

### Open the interface

```sh
npm run dev
```

Open `http://127.0.0.1:4173` and choose **Explore a preview**. The server binds only to localhost. Browser preview settings and sample records are in memory; actual extension settings use `chrome.storage.local`.

### Load the planner in Chrome

1. Open `chrome://extensions` in the intended Chrome profile.
2. Enable Developer mode, choose Load unpacked, and select the project's `extension` directory.
3. Click the extension icon to open its side panel.

The planner requests `sidePanel`, `storage`, `alarms`, `activeTab`, and `scripting`. The last two allow a temporary isolated DOM read after clicking the extension toolbar icon; the reader itself restricts allowed LMS page paths. Chrome does not provide a read-only scripting permission, so this restriction is enforced by code and tests. Notifications are optional and are not requested while delivery is disabled. No cookie, credential, browsing-history, broad tab, or persistent host permissions are requested.

### Read your open Brightspace pages

1. Use the Chrome profile signed into UNB. Open the Brightspace homepage and click the planner's toolbar icon, then **Read page** to collect the loaded course links.
2. Open **Account Settings** from your Brightspace account menu and choose **Read page**. This reads the selected timezone without changing or saving anything in Brightspace.
3. Open a course's **Assignments** list and choose **Read page**. Only rows with stable assignment IDs and unambiguous due dates are imported. Explicit submission counts are kept separate from manual check-offs. Group-submission evidence is not assumed to be individual submission evidence.
4. Open a linked **Calendar event detail** and choose **Read page** to import its due timestamp. A matching assignment ID merges it with the existing assignment.

If page access is unavailable, click the planner toolbar icon again on the desired LMS tab. Reading a page does not refresh it from UNB, traverse pagination, or scan other courses. Load the source page normally before reading it again. Missing rows are never interpreted as deleted items in this mode. No real data appears in the localhost preview; only the extension stores collected data in the local Chrome profile.

### Code map

- `extension/core.js`: domain rules, source reconciliation, reminder calculation.
- `extension/background.js`: trusted extension messaging, local persistence, alarm integration.
- `extension/app.js`: side-panel views and local interactions.
- `extension/demo.js`: synthetic preview data isolated from the real store.
- `extension/brightspace-reader.js`: self-contained, allowlisted DOM reader with no network or page mutations.
- `extension/brightspace.js`: strict normalization, account isolation, and timezone-aware parsing for observed source formats.
- `tests/`: synthetic safety, domain, and background tests; no student data.

Native ES modules keep this first implementation directly loadable and dependency-free. The proposed React/TypeScript toolchain was not needed for the current small local UI. No remote fonts, scripts, packages, analytics, or processing services are used at runtime.

## Feasibility probe

`spike/` is a dependency-free, unpacked Manifest V3 extension. It inspects structural counts on the current UNB page after an explicit click. It does not extract deadlines yet, issue network requests, click or modify LMS controls, read credentials, or persist results.

The only permissions are `activeTab` and `scripting`: temporary access after invoking the extension and an isolated-world DOM reader. Chrome does not offer a read-only DOM permission; read-only behavior is enforced in the code. The probe has no background worker, persistent host permissions, storage permission, remote assets, or telemetry. Its extension-page CSP blocks connections. Content-script safety additionally relies on the reader code, not that CSP.

### Local checks

Requires Node.js 22 or newer. No installation step or dependencies are needed.

```sh
npm test
npm run check
```

For explicit timezone checks, run `TZ=America/Moncton node --test tests/planner.test.js` and `TZ=America/Vancouver node --test tests/planner.test.js`. To regenerate the packaged notification/toolbar PNG from its local procedural source, run `node scripts/generate-icon.mjs`.

### Load for validation

1. Open `chrome://extensions` in the profile you use for UNB.
2. Enable Developer mode and choose Load unpacked.
3. Select this project's `spike` directory.
4. Open an already accessible Brightspace course or activity-list page.
5. Open the probe from Chrome's extensions menu and choose Inspect this page.

Loading an unpacked extension grants it execution access; review `spike/reader.js` and `spike/popup.js` first. Keep this as a development probe, not a production installation.

Counts can be incomplete because of virtualized content, closed component roots, iframes, and unvalidated URL conventions. A successful count does not prove complete course discovery, date accuracy, session identity, submission detection, or background access. Closing the popup discards its results.

## Network verification

For the popup, open its DevTools Network panel, clear the entries, and inspect a page. No outgoing network requests should appear. In the LMS tab's Network panel, compare idle traffic against inspection: the site may independently poll or log activity. Inspect request initiators rather than treating all site traffic as extension traffic. Do not export or commit authenticated HAR files. Record only sanitized pass/fail observations.

Automated checks cover the reader in a restricted synthetic environment and manifest permissions. Real Chrome installation, network verification, and LMS coverage remain separate manual gates in FEASIBILITY.md.

Platform references: [temporary tab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [isolated script execution](https://developer.chrome.com/docs/extensions/reference/api/scripting), and [extension network access](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
# Automatic scan development build (0.2.0)

Reload the unpacked extension in `chrome://extensions`, reopen its panel, and choose **Connect Brightspace** (also available under Settings). Chrome asks for optional access to `https://lms.unb.ca/*` only. Sign in to Brightspace yourself first. The extension uses that profile's existing session; it never stores passwords or reads cookies.

The scanner opens and closes its own inactive tabs, reads supported DOM snapshots, and leaves your existing tabs alone. It reads the homepage, timezone settings, discovered course homepages, observed assignment-list links, and observed Calendar event-detail links. Progress is saved after each page; a recovery alarm resumes interrupted queues. Scans restart every 30 minutes while Chrome is running, unless a scan is still in progress. Pause under Settings; revoking UNB access also stops scanning. No network fetch proxy is exposed and the extension-page CSP still blocks fetches.

**This is not full coverage yet.** Only discovered courses/pages are included; pagination, quizzes, discussions, Content, and syllabi are not traversed. Scans stop at 150 pages and preserve cached records rather than infer deletions. Unsupported layouts and skipped rows are reported. Notifications remain disabled. A page load may generate normal LMS server logs; absence of learning-state changes still needs installed-build verification. Automated tests are not a substitute for that validation. The older manual-reader documentation below describes the retained **Read page** fallback.
